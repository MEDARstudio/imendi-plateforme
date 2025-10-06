const CACHE_NAME = 'imendi-trans-v2';
const STATIC_CACHE = [
    '/',
    '/index.html',
    '/index.js',
    '/index.css',
    '/images/image300v1.png',
    '/images/image300v3.png',
    '/images/image500x200v1.png',
    '/images/image500x200v3.png',
    '/images/image32v3.png',
    '/images/image180v3.png',
    '/images/image192v3.png',
    '/images/image512v3.png',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

const SUPABASE_URL = 'https://cxjftikjoskdeakoxhgr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4amZ0aWtqb3NrZGVha294aGdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1MDA1OTgsImV4cCI6MjA3NTA3NjU5OH0.CS2iXOABcX4QPY472eXW8MkxoQJXDiC_WzKWPhFtISY';

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(STATIC_CACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('fetch', (event) => {
    // Strategy for API calls to Supabase
    if (event.request.url.startsWith(SUPABASE_URL)) {
        if (event.request.method !== 'GET') {
            return;
        }

        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    return caches.match(event.request).then(res => res || new Response(null, { status: 503, statusText: 'Service Unavailable' }));
                })
        );
    } else if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .catch(() => caches.match('/index.html'))
        );
    } else {
        event.respondWith(
            caches.match(event.request)
                .then((response) => response || fetch(event.request))
        );
    }
});

self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-bons') {
        event.waitUntil(syncBons());
    }
});

async function syncBons() {
    const db = await openDB();
    const items = await new Promise((resolve, reject) => {
        const transaction = db.transaction(['sync-queue'], 'readonly');
        const store = transaction.objectStore('sync-queue');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });

    if (!items || items.length === 0) {
        console.log('Sync queue is empty.');
        return;
    }
    
    console.log(`Syncing ${items.length} item(s)...`);

    const token = await getAccessToken();
    if (!token) {
        console.error('No access token for sync. Sync will be retried later.');
        throw new Error('No auth token for sync.');
    }

    for (const item of items) {
        try {
            const response = await fetch(`${SUPABASE_URL}/rest/v1/bons`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`,
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify(item.data)
            });

            if (response.ok) {
                console.log(`Successfully synced bon: ${item.data.id}`);
                await deleteFromQueue(db, item.id);
            } else {
                console.error(`Failed to sync bon ${item.data.id}. Status: ${response.status}`);
                const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
                console.error('Error details:', errorData);

                if (response.status === 401) {
                    throw new Error('Auth token expired during sync.');
                }
                
                if (response.status === 409) {
                    console.warn(`Bon ${item.data.id} caused a conflict (duplicate). Removing from sync queue.`);
                    await deleteFromQueue(db, item.id);
                    notifyClient(item.data.id, 'duplicate');
                } else if (response.status >= 400 && response.status < 500) {
                    console.warn(`Bon ${item.data.id} failed with a client error (${response.status}). Removing from sync queue.`);
                    await deleteFromQueue(db, item.id);
                    notifyClient(item.data.id, 'client_error');
                }
            }
        } catch (error) {
            console.error('A network or critical error occurred during sync. Sync will be retried.', error);
            throw error;
        }
    }
    console.log('Sync processing finished.');
}

async function deleteFromQueue(db, id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['sync-queue'], 'readwrite');
        tx.oncomplete = resolve;
        tx.onerror = (e) => reject(e.target.error);
        const store = tx.objectStore('sync-queue');
        store.delete(id);
    });
}

async function notifyClient(bonId, errorType) {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (!clients || clients.length === 0) return;

    const message = errorType === 'duplicate'
        ? `Le bon N° ${bonId} créé hors ligne existait déjà et n'a pas pu être synchronisé.`
        : `Le bon N° ${bonId} créé hors ligne contient une erreur et n'a pas pu être synchronisé.`;

    clients.forEach(client => {
        client.postMessage({ type: 'SYNC_ERROR', payload: { message } });
    });
}

async function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('IMENDITrans', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('sync-queue')) {
                db.createObjectStore('sync-queue', { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('app-state')) {
                db.createObjectStore('app-state');
            }
        };
    });
}

async function getAccessToken() {
    try {
        const db = await openDB();
        return await new Promise((resolve, reject) => {
            const transaction = db.transaction(['app-state'], 'readonly');
            const store = transaction.objectStore('app-state');
            const request = store.get('access_token');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('Failed to get access token from IndexedDB:', error);
        return null;
    }
}
