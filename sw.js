// שומר את האפליקציה ואת אריחי המפה, כדי שתעבוד גם בלי אינטרנט
const V = 'lisboa-v19', TILES = 'lisboa-tiles2';
const SHELL = ['./', 'index.html', 'app.css', 'i18n.js', 'i18n/en.js', 'i18n/es.js', 'app.js', 'data.js', 'trip.js', 'extras.js', 'group.js', 'show.js', 'backup.js', 'start.js', 'trips.js', 'notes.js', 'lic.js', 'icon.svg', 'icon-180.png', 'manifest.webmanifest', 'vendor/leaflet.js', 'vendor/leaflet.css',
  ...Array.from({ length: 34 }, (_, i) => `audio/pt/${i + 1}.mp3`)];   // ההקלטות בפורטוגזית, כדי שיעבדו גם בלי אינטרנט
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.host.endsWith('arcgisonline.com') || u.host === 'tile.openstreetmap.org' || u.host === 'upload.wikimedia.org') { // אריחי מפה: קודם מהמטמון
    e.respondWith(caches.open(TILES).then(async c => (await c.match(u.href)) ||
      fetch(e.request).then(r => { if (r.ok) c.put(u.href, r.clone()); return r; })));
    return;
  }
  const own = u.origin === location.origin;
  if (own && u.pathname.endsWith('version.json')) return;
  if (!own && !/fonts\.g/.test(u.host)) return;
  e.respondWith(caches.open(V).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: own });
    // קבצי האפליקציה תמיד נבדקים מול השרת (no-cache), כדי שעדכון יופיע מיד
    const net = (own ? fetch(e.request.url, { cache: 'no-cache' }) : fetch(e.request)).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return own ? (await net) || hit : hit || net;
  }));
});

// התראות: מציגים את ההודעה, ולחיצה פותחת את הצ׳אט באפליקציה
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch {}
  e.waitUntil(self.registration.showNotification(d.title || 'ליסבון שלנו', { body: d.body || 'הודעה חדשה', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'lisboa-chat', renotify: true, data: { go: 'group' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { c.postMessage({ go: 'chat' }); if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./#chat');
  })());
});
