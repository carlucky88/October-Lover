// Service worker de October Lover: la app abre sin conexión y siempre intenta traer la versión más nueva.
// Al publicar cambios, sube el número de CACHE.
const CACHE = 'octubre-juntos-v9';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/styles.css',
  './js/app.js', './js/config.js', './js/content.js', './js/challenge.js', './js/db.js', './js/cloud.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // App propia: red primero, caché como respaldo sin conexión.
  if (url.origin === location.origin) {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(request, res.clone()));
          return res;
        })
        .catch(() => caches.match(request, { ignoreSearch: true })
          .then(hit => hit || caches.match('./index.html'))),
    );
    return;
  }

  // Librería de Supabase desde el CDN: caché primero (la versión no cambia a menudo).
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(
      caches.match(request).then(hit => hit || fetch(request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(request, res.clone()));
        return res;
      })),
    );
  }
  // Todo lo demás (API de Supabase) pasa directo a la red.
});

// Notificaciones push: avisos de la pareja (recuerdos, comentarios, cambio de tema).
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'October Lover', {
    body: data.body || '',
    tag: data.tag || undefined,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: data.url || './' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const open = list.find(c => c.url.startsWith(self.registration.scope));
      return open ? open.focus() : self.clients.openWindow(target);
    }),
  );
});
