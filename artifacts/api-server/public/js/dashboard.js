'use strict';
/* EaglerNet Admin Dashboard — BOTTLE Plugin API | Pure Browser JS */

const state = {
  serverRunning: false,
  players: new Map(),
  stats: {},
  log: [],
  pendingOffer: null,
  relayStatus: 'disconnected', // 'disconnected' | 'connecting' | 'connected'
};
window.serverWorker = null;

// ── Utils ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const qs  = (s, ctx=document) => ctx.querySelector(s);
const qsa = (s, ctx=document) => [...ctx.querySelectorAll(s)];

function notify(msg, type='ok') {
  const el = document.createElement('div');
  el.className = 'notif ' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3100);
}
function fmtTime(d=new Date()) {
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}
function fmtUptime(ms) {
  const s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60);
  return h>0?`${h}h ${m%60}m`:m>0?`${m}m ${s%60}s`:`${s}s`;
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Console log ───────────────────────────────────────────
function addLog(msg, level='info') {
  const el = document.createElement('div');
  el.className = `log-line log-${level}`;
  el.innerHTML = `<span class="log-time">[${fmtTime()}]</span><span class="log-msg">${escHtml(msg)}</span>`;
  const log = $('console-log');
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  if (state.log.length > 1000) state.log.shift();
  state.log.push({ time: Date.now(), level, msg });
}

// ── Tab navigation ─────────────────────────────────────────
function showTab(id) {
  qsa('.tab-content').forEach(t => t.classList.remove('active'));
  qsa('.nav-btn').forEach(b => b.classList.remove('active'));
  $('tab-'+id)?.classList.add('active');
  qs(`.nav-btn[data-tab="${id}"]`)?.classList.add('active');
}
qsa('.nav-btn[data-tab]').forEach(btn =>
  btn.addEventListener('click', () => showTab(btn.dataset.tab)));

// ── WS Relay Client ─────────────────────────────────────────
// The Node.js server runs a WebSocket relay on /mc-host.
// The dashboard connects here so that MC clients connecting by
// IP address can be bridged into the browser Web Worker (game server).
let hostWS = null;
let relayReconnectTimer = null;

function connectRelay() {
  if (hostWS && (hostWS.readyState === WebSocket.OPEN || hostWS.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(relayReconnectTimer);

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl  = `${proto}//${location.host}/mc-host`;

  state.relayStatus = 'connecting';
  updateRelayUI();

  try {
    hostWS = new WebSocket(wsUrl);
    hostWS.binaryType = 'arraybuffer';
  } catch(e) {
    state.relayStatus = 'disconnected';
    updateRelayUI();
    scheduleRelayReconnect();
    return;
  }

  hostWS.onopen = () => {
    state.relayStatus = 'connected';
    updateRelayUI();
    hostWS.send(JSON.stringify({ type: 'host-ready' }));
    addLog('[Relay] WS relay connected — players can connect by IP address', 'info');
    updateConnectionURLs();
  };

  hostWS.onmessage = (e) => {
    if (!window.serverWorker || !state.serverRunning) return;
    try {
      const msg = JSON.parse(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data));
      switch (msg.type) {
        case 'player-connect':
          window.serverWorker.postMessage({ type: 'ws-player-connect', data: { id: msg.id, ip: msg.ip } });
          addLog(`[Relay] Player connecting from ${msg.ip} (${msg.id})`, 'info');
          break;
        case 'player-data': {
          const raw = msg.data ? Uint8Array.from(atob(msg.data), c => c.charCodeAt(0)).buffer : new ArrayBuffer(0);
          window.serverWorker.postMessage({ type: 'ws-player-data', data: { id: msg.id, data: raw } }, [raw]);
          break;
        }
        case 'player-disconnect':
          window.serverWorker.postMessage({ type: 'ws-player-disconnect', data: { id: msg.id } });
          addLog(`[Relay] Player disconnected (${msg.id})`, 'info');
          break;
      }
    } catch(err) {
      // Ignore bad messages
    }
  };

  hostWS.onclose = () => {
    state.relayStatus = 'disconnected';
    updateRelayUI();
    if (state.serverRunning) {
      addLog('[Relay] WS relay disconnected — reconnecting in 3s…', 'warn');
    }
    scheduleRelayReconnect();
  };

  hostWS.onerror = () => {
    state.relayStatus = 'disconnected';
    updateRelayUI();
  };
}

function scheduleRelayReconnect() {
  clearTimeout(relayReconnectTimer);
  relayReconnectTimer = setTimeout(connectRelay, 3000);
}

function disconnectRelay() {
  clearTimeout(relayReconnectTimer);
  if (hostWS) { hostWS.close(); hostWS = null; }
  state.relayStatus = 'disconnected';
  updateRelayUI();
}

// Forward worker→relay (ws-send, ws-disconnect)
function relayFromWorker(msg) {
  if (!hostWS || hostWS.readyState !== WebSocket.OPEN) return;
  switch (msg.type) {
    case 'ws-send': {
      const ab  = msg.data instanceof ArrayBuffer ? msg.data : new Uint8Array(msg.data).buffer;
      const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
      hostWS.send(JSON.stringify({ type: 'player-data', id: msg.id, data: b64 }));
      break;
    }
    case 'ws-disconnect':
      hostWS.send(JSON.stringify({ type: 'player-kick', id: msg.id, reason: 'Disconnected by server' }));
      break;
  }
}

function updateRelayUI() {
  const dot  = $('relay-dot');
  const text = $('relay-status-text');
  if (!dot || !text) return;
  const map = { connected: ['#4caf50','Connected'], connecting: ['#ff9800','Connecting…'], disconnected: ['#f44336','Disconnected'] };
  const [color, label] = map[state.relayStatus] || map.disconnected;
  dot.style.background = color;
  text.textContent = label;
}

function updateConnectionURLs() {
  const wsEl  = $('ws-connect-url');
  const wssEl = $('wss-connect-url');
  if (!wsEl && !wssEl) return;
  // Replit proxy URL (works from internet)
  const internetUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/mc`;
  if (wssEl) wssEl.textContent = internetUrl;
  // Local note
  if (wsEl) wsEl.textContent = 'ws://YOUR_LOCAL_IP:8080/mc  (for LAN players on same network)';
}

// ── Server Worker ──────────────────────────────────────────
function startServerWorker() {
  if (window.serverWorker) { notify('Server already running', 'err'); return; }

  const seed    = parseInt($('input-seed')?.value||'') || undefined;
  const motd    = $('input-motd')?.value.trim() || undefined;
  const maxP    = parseInt($('input-maxplayers')?.value||'20');
  const gmode   = parseInt($('input-gamemode')?.value||'0');
  const diff    = parseInt($('input-difficulty')?.value||'1');

  addLog('Starting EaglerNet server…', 'info');

  try {
    const worker = new Worker('./js/mc/server.js');
    window.serverWorker = worker;
    worker.addEventListener('message', onWorkerMessage);
    worker.addEventListener('error', e => {
      addLog('Worker error: ' + (e.message||'unknown'), 'error');
      notify('Server worker crashed!', 'err');
      window.serverWorker = null;
      state.serverRunning = false;
      updateServerControls();
    });
    worker.postMessage({ type:'start', data:{
      seed, motd, maxPlayers: maxP,
      world:{ defaultGamemode: gmode, difficulty: diff, seed },
    }});
    state.serverRunning = true;
    updateServerControls();
    // Connect relay so IP players can join
    connectRelay();
  } catch(e) {
    addLog('Failed to start worker: ' + e.message, 'error');
    notify('Could not start server — check browser support', 'err');
  }
}

function stopServer() {
  if (!window.serverWorker) return;
  window.serverWorker.postMessage({ type:'command', data:'stop' });
  setTimeout(() => {
    window.serverWorker?.terminate();
    window.serverWorker = null;
    state.serverRunning = false;
    state.players.clear();
    disconnectRelay();
    updateServerControls();
    renderPlayers();
    addLog('Server stopped.', 'warn');
    notify('Server stopped');
  }, 1200);
}

// ── Worker messages ─────────────────────────────────────────
function onWorkerMessage(e) {
  const msg = e.data || {};

  // WS relay forwarding (from worker → relay)
  if (msg.type === 'ws-send' || msg.type === 'ws-disconnect') {
    relayFromWorker(msg);
    return;
  }

  switch(msg.type) {
    case 'ready':
      addLog(`World ready — seed: ${msg.seed}, spawn Y: ${msg.spawnY}`, 'info');
      break;
    case 'log':
      addLog(msg.msg, msg.level||'info');
      break;
    case 'stats':
      state.stats = msg.data || {};
      updateSidebarStats();
      break;
    case 'chat':
      addLog(`<${msg.username}> ${msg.message}`, 'chat');
      break;
    case 'broadcast':
      try { addLog(chatToPlain(JSON.parse(msg.message)), 'info'); }
      catch { addLog(msg.message, 'info'); }
      break;
    case 'player.join':
      state.players.set(msg.uuid, {
        username: msg.username, uuid: msg.uuid,
        gamemode: 0, health: 20,
        version: msg.version || '?', proto: msg.proto,
      });
      renderPlayers();
      break;
    case 'player.quit':
      state.players.delete(msg.uuid);
      renderPlayers();
      break;
    case 'plugin.loaded':
      addLog(`[BOTTLE] Plugin loaded: ${msg.name} v${msg.version}`, 'info');
      notify(`Plugin loaded: ${msg.name}`);
      renderPlugins();
      break;
    case 'offer-ready':
      state.pendingOffer = { id: msg.id, offer: msg.offer };
      if ($('offer-code')) $('offer-code').textContent = msg.offer || '(generating…)';
      $('offer-section')?.style && ($('offer-section').style.display = '');
      addLog('WebRTC offer ready — share with player.', 'info');
      break;
    case 'stopped':
      addLog('Server shut down cleanly.', 'warn');
      break;
  }
}

function chatToPlain(c) {
  if (typeof c === 'string') return c;
  let t = (c.text||'').replace(/§./g,'');
  if (c.extra) for (const x of c.extra) t += chatToPlain(x);
  return t;
}

// ── Sidebar stats ──────────────────────────────────────────
function updateSidebarStats() {
  const s = state.stats;
  const set = (id, v) => { const el=$(id); if(el) el.textContent=v; };
  set('stat-tps',     s.tps    != null ? s.tps.toFixed(1)             : '—');
  set('stat-players', s.players != null ? `${s.players}/${s.max}`     : '—');
  set('stat-uptime',  s.uptime  != null ? fmtUptime(s.uptime)         : '—');
  set('stat-seed',    s.seed    != null ? String(s.seed)              : '—');
  set('stat-plugins', s.plugins != null ? String(s.plugins)           : '—');
}

function updateServerControls() {
  const r = state.serverRunning;
  $('btn-start-server').style.display = r ? 'none' : '';
  $('btn-stop-server').style.display  = r ? '' : 'none';
  qs('.status-dot')?.classList.toggle('online', r);
  qs('.status-text').textContent = r ? 'Server Running' : 'Stopped';
}

// ── Console ────────────────────────────────────────────────
function sendConsoleCommand() {
  const input = $('console-input');
  const cmd = input.value.trim();
  if (!cmd) return;
  if (!window.serverWorker) { notify('Start the server first!', 'err'); return; }
  addLog('> ' + cmd, 'info');
  window.serverWorker.postMessage({ type:'command', data: cmd });
  input.value = '';
}
$('console-send').addEventListener('click', sendConsoleCommand);
$('console-input').addEventListener('keydown', e => { if (e.key==='Enter') sendConsoleCommand(); });

// ── Start / Stop ───────────────────────────────────────────
$('btn-start-server').addEventListener('click', startServerWorker);
$('btn-stop-server').addEventListener('click', stopServer);

// ── Players ────────────────────────────────────────────────
function renderPlayers() {
  const panel = $('players-panel');
  if (!state.players.size) {
    panel.innerHTML = '<div class="empty-state">No players online.<br>Start the server and connect to see players here.</div>';
    return;
  }
  panel.innerHTML = [...state.players.values()].map(p => `
    <div class="player-card">
      <div class="player-avatar">&#x1F9D1;</div>
      <div class="player-info">
        <div class="player-name">${escHtml(p.username)}</div>
        <div class="player-meta">UUID: ${p.uuid.slice(0,16)}… | MC ${escHtml(p.version||'?')} | p${p.proto||'?'}</div>
      </div>
      <div class="player-actions">
        <button class="act-btn" onclick="sendCmd('say Hello, ${escHtml(p.username)}!')">Ping</button>
        <button class="act-btn" onclick="sendCmd('op ${escHtml(p.username)}')">OP</button>
        <button class="act-btn red" onclick="sendCmd('kick ${escHtml(p.username)} Kicked by admin')">Kick</button>
      </div>
    </div>`).join('');
}

function sendCmd(cmd) {
  if (!window.serverWorker) { notify('Server not running', 'err'); return; }
  window.serverWorker.postMessage({ type:'command', data: cmd });
  addLog('> ' + cmd, 'info');
}
window.sendCmd = sendCmd;

// ── Plugins (BOTTLE) ──────────────────────────────────────
function renderPlugins() {
  const panel = $('plugins-list');
  if (!panel) return;
  const plugins = BOTTLE.getPlugins().filter(p => !p.builtin);
  if (!plugins.length) {
    panel.innerHTML = '<div class="empty-state" style="padding:20px">No user plugins loaded.<br>Drop a .js plugin file below.</div>';
    return;
  }
  panel.innerHTML = plugins.map(p => `
    <div class="plugin-card">
      <div class="plugin-icon">&#9670;</div>
      <div class="plugin-info">
        <div class="plugin-name">${escHtml(p.name)}</div>
        <div class="plugin-desc">${escHtml(p.description)}</div>
        <div class="plugin-ver">v${escHtml(p.version)} by ${escHtml(p.author)} · BOTTLE API</div>
      </div>
      <button class="plugin-toggle ${p.enabled?'on':''}" onclick="togglePlugin('${p.id}')">
        ${p.enabled?'Enabled':'Disabled'}
      </button>
    </div>`).join('');
}
window.togglePlugin = function(id) {
  const on = BOTTLE.toggle(id);
  notify((on?'Enabled':'Disabled') + ' plugin: ' + id);
  renderPlugins();
};

// Drop zone
const dropZone = $('plugin-drop-zone');
if (dropZone) {
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
  dropZone.addEventListener('drop', async e => {
    e.preventDefault(); dropZone.classList.remove('over');
    for (const f of e.dataTransfer.files) await loadPluginFile(f);
  });
  dropZone.addEventListener('click', () => $('plugin-file-input')?.click());
}
$('plugin-file-input')?.addEventListener('change', async e => {
  for (const f of e.target.files) await loadPluginFile(f);
  e.target.value = '';
});
$('btn-load-plugin')?.addEventListener('click', () => $('plugin-file-input')?.click());

async function loadPluginFile(file) {
  if (!file.name.endsWith('.js')) { notify('Only .js plugin files', 'err'); return; }
  try {
    const code = await file.text();
    BOTTLE.loadCode(code);
    if (window.serverWorker) {
      window.serverWorker.postMessage({ type:'load-plugin-code', data:{ code } });
    }
    notify(`Loaded: ${file.name}`);
    renderPlugins();
  } catch(e) { notify('Plugin error: ' + e.message, 'err'); }
}

// ── WebRTC ─────────────────────────────────────────────────
$('btn-create-offer')?.addEventListener('click', () => {
  if (!window.serverWorker) { notify('Start the server first!', 'err'); return; }
  if ($('offer-code')) $('offer-code').textContent = 'Generating…';
  window.serverWorker.postMessage({ type:'create-offer' });
});
$('btn-copy-offer')?.addEventListener('click', () => {
  const t = $('offer-code')?.textContent;
  if (t) navigator.clipboard.writeText(t).then(() => notify('Offer copied!')).catch(() => notify('Copy failed', 'err'));
});
$('btn-accept-answer')?.addEventListener('click', () => {
  const ans = $('answer-input')?.value.trim();
  if (!ans || !state.pendingOffer) { notify('Paste player answer first', 'err'); return; }
  window.serverWorker?.postMessage({ type:'accept-answer', data:{ id: state.pendingOffer.id, answer: ans } });
  notify('Answer submitted…');
});

// Copy connection URL buttons
$('btn-copy-wss')?.addEventListener('click', () => {
  const t = $('wss-connect-url')?.textContent;
  if (t) navigator.clipboard.writeText(t).then(() => notify('URL copied!')).catch(() => notify('Copy failed', 'err'));
});
$('btn-copy-ws')?.addEventListener('click', () => {
  const t = $('ws-connect-url')?.textContent;
  if (t) navigator.clipboard.writeText(t.split(' ')[0]).then(() => notify('URL copied!')).catch(() => notify('Copy failed', 'err'));
});

// ── World/Config stats refresh ─────────────────────────────
function updateWorldTab() {
  const s = state.stats;
  const set = (id,v) => { const el=$(id); if(el) el.textContent=v; };
  set('world-seed',    s.seed    != null ? String(s.seed)          : '—');
  set('world-players', s.players != null ? `${s.players}/${s.max}` : '—');
  set('world-tps',     s.tps     != null ? s.tps.toFixed(2)        : '—');
  set('world-uptime',  s.uptime  != null ? fmtUptime(s.uptime)     : '—');
  set('world-tick',    s.tick    != null ? String(s.tick)          : '—');
  set('world-plugins', s.plugins != null ? String(s.plugins)       : '—');
}
setInterval(() => {
  if (window.serverWorker && state.serverRunning) {
    window.serverWorker.postMessage({ type:'get-stats' });
    updateWorldTab();
  }
}, 5000);

// ── Service Worker ─────────────────────────────────────────
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ── Init ──────────────────────────────────────────────────
connectRelay(); // Start relay immediately (auto-reconnects if server not up yet)
showTab('console');
updateServerControls();
updateRelayUI();
renderPlugins();
addLog('EaglerNet Dashboard ready. Click "Start Server" to launch the browser MC server.', 'info');
addLog('Plugin Loader: BOTTLE. Versions: 1.5.2 → 1.12.2. Use the Plugin Loader tab to add plugins.', 'info');
addLog('Built-in: WorldEdit (//pos1 //set //copy), WorldGuard (/rg define), Multiverse (/mv tp)', 'info');
