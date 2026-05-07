/**
 * EaglerNet Service Worker — Offline Support
 * Caches all server files so the server runs completely offline.
 */
const CACHE = 'eaglernet-v1';
const ASSETS = [
  './', './index.html', './manifest.json',
  './css/main.css',
  './js/dashboard.js', './js/plugin-api.js',
  './js/mc/buffer.js', './js/mc/nbt.js', './js/mc/noise.js',
  './js/mc/blocks.js', './js/mc/world.js', './js/mc/chunk.js',
  './js/mc/protocol.js', './js/mc/server.js',
  './plugins/example-plugin/plugin.js',
];
self.addEventListener('install',  e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{})).then(()=>self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method!=='GET') return;
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{
    if(res&&res.status===200){const c=res.clone();caches.open(CACHE).then(ca=>ca.put(e.request,c));}
    return res;
  }).catch(()=>caches.match('./index.html'))));
});
