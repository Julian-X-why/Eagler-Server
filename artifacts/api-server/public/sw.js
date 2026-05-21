const CACHE = 'eaglernet-v5';
const ASSETS = [
  './', './index.html', './config.js', './manifest.json',
  './css/main.css',
  './js/dashboard.js', './js/plugin-api.js',
  './js/mc/buffer.js', './js/mc/nbt.js', './js/mc/noise.js',
  './js/mc/blocks.js', './js/mc/world.js', './js/mc/chunk.js',
  './js/mc/protocol.js', './js/mc/server.js',
  './plugins/example-plugin/plugin.js',
  './plugins/eaglercraftxserver/plugin.js',
  './plugins/chatfilter/plugin.js',
  './plugins/anticheat/plugin.js',
  './plugins/worldedit/plugin.js',
  './plugins/worldguard/plugin.js',
  './plugins/multiverse/plugin.js',
];
self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{})).then(()=>self.skipWaiting())
));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));
self.addEventListener('fetch', e => {
  if (e.request.method!=='GET') return;
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{
    if (res&&res.status===200){ const clone=res.clone(); caches.open(CACHE).then(c=>c.put(e.request,clone)); }
    return res;
  }).catch(()=>caches.match('./index.html'))));
});
