// オフラインでも地球儀が開けるようにアプリ本体をキャッシュする
const CACHE = 'globe-v2';
const CORE = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'vendor/globe.gl.min.js',
  'data/countries.json', 'data/borders.geojson', 'img/earth-blue-marble.jpg', 'img/earth-topology.png', 'img/night-sky.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // 国旗画像は一度見たらキャッシュ、自サイトはキャッシュ優先＋裏で更新
  if (u.origin === location.origin || u.hostname === 'flagcdn.com') {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});
