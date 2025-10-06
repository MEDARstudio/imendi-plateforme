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

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(STATIC_CACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('fetch', (event) => {
    // Strategy for API calls to Supabase
    if (event.request.url.includes(SUPABASE_URL)) {
        // For non-GET requests (POST, PATCH, etc.), do not use the service worker.
        // Let the browser handle them directly. This is crucial for ensuring mutations
        // reach the server correctly when online. The app's own logic will queue them for
        // background sync if the request fails (i.e., when offline).
        if (event.request.method !== 'GET') {
            return;
        }

        // For GET requests, use a "network-first, then cache" strategy.
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // If the network request is successful, update the cache.
                    if (response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // If the network fails, serve the response from the cache.
                    return caches.match(event.request);
                })
        );
    } else if (event.request.mode === 'navigate') {
        // Strategy for page navigation
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response.ok) {
                        return response;
                    }
                    // If we get a 404 or other error, serve the app shell from cache.
                    return caches.match('/index.html');
                })
                .catch(() => {
                    // If the network is down, serve the app shell from cache.
                    return caches.match('/index.html');
                })
        );
    } else {
        // Strategy for static assets (CSS, JS, images)
        // Use a "cache-first" strategy for performance.
        event.respondWith(
            caches.match(event.request)
                .then((response) => {
                    return response || fetch(event.request);
                })
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
        request.onerror = () => reject(request.error);
    });
    
    if (!items || items.length === 0) {
        return;
    }

    const token = await getAccessToken();
    if (!token) {
        console.error('No access token available for sync. Sync will be retried later.');
        return;
    }
    
    for (const item of items) {
        try {
            const response = await fetch(`${SUPABASE_URL}/rest/v1/bons`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4amZ0aWtqb3NrZGVha294aGdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1MDA1OTgsImV4cCI6MjA3NTA3NjU5OH0.CS2iXOABcX4QPY472eXW8MkxoQJXDiC_WzKWPhFtISY',
                    'Authorization': `Bearer ${token}`,
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify(item.data)
            });
            
            if (response.ok) {
                // Remove from queue
                await new Promise((resolve, reject) => {
                    const writeTx = db.transaction(['sync-queue'], 'readwrite');
                    writeTx.oncomplete = resolve;
                    writeTx.onerror = reject;
                    const writeStore = writeTx.objectStore('sync-queue');
                    writeStore.delete(item.id);
                });
            } else {
                console.error('Failed to sync bon:', await response.text());
            }
        } catch (error) {
            console.error('Error syncing bon:', error);
        }
    }
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
