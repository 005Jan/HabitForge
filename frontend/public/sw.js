// sw.js — HabitForge Service Worker v2

const CACHE_NAME = 'habitforge-v10';
const APP_SHELL = [
    '/habits/',
    '/habits/index.html',
    '/habits/script.js',
    '/habits/style.css',
    '/habits/favicon-192x192.png',
    '/habits/favicon-512x512.png',
    '/habits/apple-touch-icon.png',
];

// Instal·la i pre-cacha l'app shell
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
    );
});

// Activa i neteja caches antigues
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Fetch: network-first per API, cache-first per app shell
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // API sempre per xarxa
    if (url.pathname.startsWith('/habits/api/')) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.ok && event.request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(event.request).then(r => r || caches.match('/habits/')))
    );
});

// Push: mostra notificació
self.addEventListener('push', event => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch(e) {}

    const title = data.title || 'HabitForge';
    const options = {
        body: data.body || 'Tens hàbits pendents avui! 💪',
        icon: '/habits/favicon-192x192.png',
        badge: '/habits/favicon-96x96.png',
        vibrate: [200, 100, 200],
        tag: 'habitforge-reminder',
        renotify: true,
        data: { url: '/habits/' },
        actions: [
            { action: 'open', title: 'Veure hàbits' },
            { action: 'close', title: 'Ignora' }
        ]
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// Clic a notificació: obre o enfoca l'app
self.addEventListener('notificationclick', event => {
    event.notification.close();
    if (event.action === 'close') return;

    const targetUrl = '/habits/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            for (const client of list) {
                if (client.url.startsWith(self.location.origin + '/habits') && 'focus' in client) {
                    return client.focus();
                }
            }
            return clients.openWindow(targetUrl);
        })
    );
});
