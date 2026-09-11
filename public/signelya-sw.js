self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { body: event.data?.text() || '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'SIGNELYA', {
    body: data.body || 'Nouvelle alerte SIGNELYA',
    icon: '/signelya-icon-192.png',
    badge: '/signelya-icon-192.png',
    tag: data.tag || 'signelya-alert',
    renotify: true,
    data: { url: data.url || '/ecran-geant' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/ecran-geant', self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => client.url.startsWith(self.location.origin));
    if (existing) {
      existing.navigate(target);
      return existing.focus();
    }
    return clients.openWindow(target);
  }));
});
