// ============================================================
// Service Worker — Cockpit JS-Innov.IA
// Gère: push notifications, cache offline, background sync
// ============================================================

const CACHE_NAME = 'cockpit-v2-2026';
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json'];

// ─── Install: précache statique ─────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ─── Activate: nettoyage anciens caches ─────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─── Push: réception notification push ───────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'Cockpit JS-Innov.IA', body: 'Nouvelle notification', icon: '/icon-192.png', badge: '/icon-192.png', tag: 'cockpit-notif' };

  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    tag: data.tag || 'cockpit-notif',
    data: data.data || { url: '/' },
    actions: data.actions || [],
    vibrate: [100, 50, 100],
    requireInteraction: data.requireInteraction || false,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// ─── Notification click: ouvrir URL ─────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

// ─── Fetch: cache-first pour statiques, network-first pour API ─
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return;

  if (request.destination === 'style' || request.destination === 'script' || request.destination === 'image' || request.destination === 'font') {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
  }
});
