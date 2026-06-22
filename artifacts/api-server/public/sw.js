const CACHE = 'eaglernet-v7';
const ASSETS = [
  './', './index.html', './config.js', './manifest.json',
  './css/main.css',
  './js/dashboard.js', './js/plugin-api.js',
  './js/mc/buffer.js', './js/mc/nbt.js', './js/mc/noise.js',
  './js/mc/blocks.js', './js/mc/world.js', './js/mc/chunk.js',
  './js/mc/protocol.js', './js/mc/server.js',
  './plugins/nexuslink/plugin.js',
  './plugins/purityfilter/plugin.js',
  './plugins/integritycheck/plugin.js',
  './plugins/worldsculptor/plugin.js',
  './plugins/terrainguard/plugin.js',
  './plugins/voidportal/plugin.js',
  './plugins/authshield/plugin.js',
  './plugins/essentialcraft/plugin.js',
  './plugins/chatforge/plugin.js',
  './plugins/rankengine/plugin.js',
  './plugins/ecovault/plugin.js',
  './plugins/tradingpost/plugin.js',
  './plugins/clanforge/plugin.js',
  './plugins/banhammer/plugin.js',
  './plugins/vaultpack/plugin.js',
  './plugins/cronmaster/plugin.js',
  './plugins/welcomemat/plugin.js',
  './plugins/tabflair/plugin.js',
  './plugins/spawnmaster/plugin.js',
  './plugins/adminspy/plugin.js',
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
