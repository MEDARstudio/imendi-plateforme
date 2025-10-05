const CACHE_NAME = 'imendi-trans-v1';
const STATIC_CACHE = [
    '/',
    '/index.html',
    '/index.js',
    '/index.css',
    '/images/image300v1.png',
    '/images/image300v2.png',
    '/images/image500x200v2.png',
    '/images/image32v2.png',
    '/images/image180v2.png',
    '/images/image192v2.png',
    '/images/image512v2.png',
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
    if (event.request.url.includes(SUPABASE_URL)) {
        // Network-first for API calls
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // Cache successful responses
                    if (response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Return cached response if network fails
                    return caches.match(event.request);
                })
        );
    } else if (event.request.mode === 'navigate') {
        // Network-first for navigation
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response.ok) {
                        return response;
                    }
                    return caches.match('/index.html');
                })
                .catch(() => {
                    return caches.match('/index.html');
                })
        );
    } else {
        // Cache-first for static assets
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
    const transaction = db.transaction(['sync-queue'], 'readonly');
    const store = transaction.objectStore('sync-queue');
    const items = await store.getAll();
    
    for (const item of items) {
        try {
            const token = await getAccessToken();
            if (!token) {
                console.error('No access token available');
                continue;
            }
            
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
                const writeTx = db.transaction(['sync-queue'], 'readwrite');
                const writeStore = writeTx.objectStore('sync-queue');
                await writeStore.delete(item.id);
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
                const store = db.createObjectStore('sync-queue', { keyPath: 'id', autoIncrement: true });
                store.createIndex('type', 'type');
                store.createIndex('timestamp', 'timestamp');
            }
        };
    });
}

async function getAccessToken() {
    // This is a simplified version - in a real app you'd need proper token management
    // For now, we'll try to get it from clients
    const clients = await self.clients.matchAll();
    for (const client of clients) {
        // In a real implementation, you'd have a more sophisticated way to get the token
        // This is just a placeholder
    }
    // Return the token from storage - this is a workaround
    return await new Promise((resolve) => {
        // This won't work directly from service worker
        // The proper solution would be to have the main app sync the token
        resolve(null);
    });
}
