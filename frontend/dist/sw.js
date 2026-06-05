// GymCheck Service Worker — handles push notifications and offline

const CACHE_NAME = 'gymcheck-v1';

// Install: skip waiting so new SW activates immediately
self.addEventListener('install', event => {
  self.skipWaiting();
});

// Activate: claim all clients
self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});

// Push event: show notification
self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'GymCheck 🏋️', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'GymCheck 🏋️';
  const options = {
    body: data.body || 'Je hebt een nieuw bericht',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: data.data || {},
    vibrate: [100, 50, 100],
    requireInteraction: false,
    tag: 'gymcheck-notification',
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click: open or focus the app
self.addEventListener('notificationclick', event => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // If app is already open, focus it
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open new window
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
