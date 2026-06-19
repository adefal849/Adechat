// ══════════════════════════════════════════
//  ADÉCHAT — Service Worker (Mode Hors Ligne)
// ══════════════════════════════════════════

const CACHE_NAME = 'adechat-v1';
const CACHE_URLS = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700;800&family=Inter:wght@400;500;600&display=swap'
];

// ── INSTALL : mise en cache des ressources statiques ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE : suppression des anciens caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH : stratégie Cache First, réseau en fallback ──
self.addEventListener('fetch', event => {
  // Ne pas intercepter les requêtes API externes
  if (event.request.url.includes('googleapis.com') ||
      event.request.url.includes('generativelanguage') ||
      event.request.url.includes('graph.facebook.com') ||
      event.request.url.includes('pagead2.googlesyndication.com')) {
    return; // laisser passer sans interception
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        // Mettre en cache les nouvelles ressources GET réussies
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Fallback hors ligne : retourner dashboard.html pour les navigations
        if (event.request.mode === 'navigate') {
          return caches.match('/dashboard.html');
        }
      });
    })
  );
});

// ── BACKGROUND SYNC (quand connexion revient) ──
self.addEventListener('sync', event => {
  if (event.tag === 'sync-orders') {
    event.waitUntil(syncPendingData());
  }
});

async function syncPendingData() {
  // Logique de synchronisation avec Firebase/Supabase
  // À implémenter selon votre backend choisi
  console.log('[SW] Synchronisation des données en attente...');
}

// ── PUSH NOTIFICATIONS ──
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  const title = data.title || 'Adéchat';
  const options = {
    body:  data.body  || 'Nouvelle notification',
    icon:  data.icon  || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    data:  { url: data.url || '/dashboard.html' },
    vibrate: [100, 50, 100],
    actions: [
      { action: 'open',    title: 'Ouvrir' },
      { action: 'dismiss', title: 'Ignorer' }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action !== 'dismiss') {
    const url = event.notification.data?.url || '/dashboard.html';
    event.waitUntil(clients.openWindow(url));
  }
});
