// APEX P1 Eligibility System - Service Worker
// Version: 1.0.0

const CACHE_NAME = 'apex-v1';
const STATIC_CACHE = 'apex-static-v1';
const DYNAMIC_CACHE = 'apex-dynamic-v1';

// Static assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/app.html',
  '/manifest.json',
  '/privacy-policy.html',
  '/terms.html',
  // External CDN resources
  'https://cdn.tailwindcss.com',
  'https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js',
  'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Static assets cached successfully');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Failed to cache static assets:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== STATIC_CACHE && name !== DYNAMIC_CACHE)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Service worker activated');
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache with network fallback
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip Clerk auth requests (must always go to network)
  if (url.hostname.includes('clerk')) {
    return;
  }
  
  // Skip Supabase API requests (must always go to network for fresh data)
  if (url.hostname.includes('supabase')) {
    event.respondWith(
      fetch(request)
        .catch(() => {
          // Return offline indicator for API requests
          return new Response(
            JSON.stringify({ error: 'offline', message: 'You are offline' }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
    return;
  }
  
  // For static assets - cache first, then network
  if (STATIC_ASSETS.some(asset => request.url.includes(asset)) || 
      request.url.includes('.html') || 
      request.url.includes('.css') || 
      request.url.includes('.js')) {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            // Return cached version and update in background
            event.waitUntil(
              fetch(request)
                .then((networkResponse) => {
                  if (networkResponse.ok) {
                    caches.open(STATIC_CACHE)
                      .then((cache) => cache.put(request, networkResponse));
                  }
                })
                .catch(() => {})
            );
            return cachedResponse;
          }
          
          // Not in cache - fetch from network
          return fetch(request)
            .then((networkResponse) => {
              if (networkResponse.ok) {
                const responseClone = networkResponse.clone();
                caches.open(STATIC_CACHE)
                  .then((cache) => cache.put(request, responseClone));
              }
              return networkResponse;
            })
            .catch(() => {
              // Return offline page for navigation requests
              if (request.mode === 'navigate') {
                return caches.match('/app.html');
              }
              return new Response('Offline', { status: 503 });
            });
        })
    );
    return;
  }
  
  // For images and other assets - network first, cache fallback
  if (request.destination === 'image') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(DYNAMIC_CACHE)
              .then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(request);
        })
    );
    return;
  }
  
  // Default: network first
  event.respondWith(
    fetch(request)
      .catch(() => caches.match(request))
  );
});

// Handle push notifications (future feature)
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  const data = event.data.json();
  
  const options = {
    body: data.body || 'New notification from APEX',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/app.html'
    },
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'close', title: 'Dismiss' }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'APEX', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'close') return;
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus existing window if available
        for (const client of clientList) {
          if (client.url.includes('/app.html') && 'focus' in client) {
            return client.focus();
          }
        }
        // Open new window
        if (clients.openWindow) {
          return clients.openWindow(event.notification.data.url || '/app.html');
        }
      })
  );
});

// Background sync (for offline form submissions)
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
  
  if (event.tag === 'sync-students') {
    event.waitUntil(syncStudentData());
  }
});

async function syncStudentData() {
  // Get pending changes from IndexedDB and sync with server
  console.log('[SW] Syncing student data...');
  // Implementation would go here
}

// Periodic background sync (if supported)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'update-data') {
    event.waitUntil(updateCachedData());
  }
});

async function updateCachedData() {
  console.log('[SW] Updating cached data...');
  // Refresh critical cached data
}

console.log('[SW] Service worker loaded');
