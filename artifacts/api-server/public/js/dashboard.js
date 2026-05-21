'use strict';
/* EaglerNet Admin Dashboard — BOTTLE Plugin Loader | Pure Browser JS */

// ── State ──────────────────────────────────────────────────
const state = {
  serverRunning: false,
  players: new Map(),
  stats: {},
  log: [],
  pendingOffer: null,
  relayStatus: 'disconnected',
  isStaticMode: false,
};
window.serverWorker = null;

// ── Static mode detection ──────────────────────────────────
// Determines if we're on a static host (GitHub Pages, file://, etc.)
// where the Node.js WS relay won't be available.
// localhost / 127.0.0.1 always means Node.js is serving → NOT static.
// Replit previews use *.replit.dev or *.repl.co → NOT static.
(function detectMode() {
  const h = location.hostname;
  const isLocal =
    h === 'localhost' || h === '127.0.0.1' ||
    h.endsWith('.replit.dev') || h.endsWith('.repl.co') ||
    h.endsWith('.repl.it')   || h.endsWith('.replit.app') ||
    h.endsWith('.replit.co');
  const isStaticHost =
    location.protocol === 'file:' ||
    h.endsWith('.github.io')   ||
    h.endsWith('.pages.dev')   ||
    h.endsWith('.netlify.app') ||
    h.endsWith('.vercel.app')  ||
    h.endsWith('.surge.sh');
  state.isStaticMode = isStaticHost && !isLocal;
})();

// ── Utils ──────────────────────────────────────────────────
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
window.copyText = function(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
};
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch {}
  document.body.removeChild(ta);
}

// ── Console log ────────────────────────────────────────────
function addLog(msg, level='info') {
  const el = document.createElement('div');
  el.className = `log-line log-${level}`;
  // Strip MC colour codes for display
  const clean = escHtml(msg.replace(/§./g, ''));
  el.innerHTML = `<span class="log-time">[${fmtTime()}]</span><span class="log-msg">${clean}</span>`;
  const log = $('console-log');
  log.appendChild(el);
  // Auto-scroll only if near bottom
  if (log.scrollHeight - log.scrollTop - log.clientHeight < 120) {
    log.scrollTop = log.scrollHeight;
  }
  if (state.log.length > 1200) state.log.shift();
  state.log.push({ time: Date.now(), level, msg });
}

// ── Tab navigation ──────────────────────────────────────────
function showTab(id) {
  qsa('.tab-content').forEach(t => t.classList.remove('active'));
  qsa('.nav-btn[data-tab]').forEach(b => b.classList.remove('active'));
  qsa('.bnav-btn[data-tab]').forEach(b => b.classList.remove('active'));
  $('tab-'+id)?.classList.add('active');
  qs(`.nav-btn[data-tab="${id}"]`)?.classList.add('active');
  qs(`.bnav-btn[data-tab="${id}"]`)?.classList.add('active');
  closeSidebar(); // auto-close on mobile after navigation
}

qsa('[data-tab]').forEach(btn =>
  btn.addEventListener('click', () => showTab(btn.dataset.tab)));

// ── Mobile sidebar ──────────────────────────────────────────
function openSidebar() {
  $('sidebar').classList.add('open');
  $('sidebar-overlay').classList.add('open');
}
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').classList.remove('open');
}
$('btn-menu')?.addEventListener('click', openSidebar);
$('sidebar-overlay')?.addEventListener('click', closeSidebar);

// ── Getting Started banner ──────────────────────────────────
const GS_KEY = 'eaglernet_gs_dismissed';
if (localStorage.getItem(GS_KEY)) {
  $('gs-banner')?.remove();
}
$('gs-dismiss')?.addEventListener('click', () => {
  localStorage.setItem(GS_KEY, '1');
  $('gs-banner')?.remove();
});

// ── Mode UI setup ───────────────────────────────────────────
function applyModeUI() {
  const badge  = $('mode-badge');
  const sBanner = $('static-banner');
  const sGuide  = $('static-guide-card');
  const relayCard = $('relay-card');
  const modeLabel = $('connect-mode-label');
  const modeDesc  = $('connect-mode-desc');

  if (state.isStaticMode) {
    if (badge) { badge.textContent = '📦 Static Mode'; badge.className = 'mode-badge static-mode'; }
    sBanner?.style && (sBanner.style.display = 'flex');
    sGuide?.style  && (sGuide.style.display = '');
    relayCard?.style && (relayCard.style.display = 'none');
    if (modeLabel) modeLabel.textContent = 'Static Hosting';
    if (modeDesc)  modeDesc.innerHTML =
      '<strong style="color:var(--yellow)">⚠ No WS relay</strong> — this page is served from a static host. ' +
      'WebRTC peer-to-peer connections work perfectly. For IP/URL connections, deploy the included Node.js server ' +
      '(<code style="font-family:var(--mono);color:var(--accent)">pnpm run dev</code> locally or on a VPS).';
    if ($('h-relay-hstat')) $('h-relay-hstat').style.display = 'none';
  } else {
    if (badge) { badge.textContent = '⚡ Relay Mode'; badge.className = 'mode-badge relay'; }
    if (modeLabel) modeLabel.textContent = 'Full Mode (Node.js relay active)';
    if (modeDesc)  modeDesc.innerHTML =
      '<strong style="color:var(--accent)">✓ WS relay available</strong> — both WebRTC peer-to-peer <em>and</em> ' +
      'IP/URL connections work. Share the URLs from the <em>Connect by IP</em> card below with players.';
    if ($('h-relay-hstat')) $('h-relay-hstat').style.display = '';
    updateConnectionURLs();
  }
}

// ── WS Relay Client ─────────────────────────────────────────
let hostWS = null;
let relayReconnectTimer = null;

function connectRelay() {
  if (state.isStaticMode) return; // no relay in static mode
  if (hostWS && (hostWS.readyState === WebSocket.OPEN || hostWS.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(relayReconnectTimer);

  const proto  = location.protocol === 'https:' ? 'wss:' : 'ws:';
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
    addLog('[Relay] WS relay connected — players can connect by IP', 'info');
    updateConnectionURLs();
  };

  hostWS.onmessage = (e) => {
    if (!window.serverWorker || !state.serverRunning) return;
    try {
      const msg = JSON.parse(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data));
      switch (msg.type) {
        case 'player-connect':
          window.serverWorker.postMessage({ type: 'ws-player-connect', data: { id: msg.id, ip: msg.ip } });
          addLog(`[Relay] Player connecting from ${msg.ip}`, 'info');
          break;
        case 'player-data': {
          const raw = msg.data ? Uint8Array.from(atob(msg.data), c => c.charCodeAt(0)).buffer : new ArrayBuffer(0);
          window.serverWorker.postMessage({ type: 'ws-player-data', data: { id: msg.id, data: raw } }, [raw]);
          break;
        }
        case 'player-disconnect':
          window.serverWorker.postMessage({ type: 'ws-player-disconnect', data: { id: msg.id } });
          break;
      }
    } catch { /* ignore bad messages */ }
  };

  hostWS.onclose = () => {
    state.relayStatus = 'disconnected';
    updateRelayUI();
    if (state.serverRunning) addLog('[Relay] Relay disconnected — reconnecting…', 'warn');
    scheduleRelayReconnect();
  };
  hostWS.onerror = () => {
    state.relayStatus = 'disconnected';
    updateRelayUI();
  };
}

function scheduleRelayReconnect() {
  if (state.isStaticMode) return;
  clearTimeout(relayReconnectTimer);
  relayReconnectTimer = setTimeout(connectRelay, 4000);
}

function disconnectRelay() {
  clearTimeout(relayReconnectTimer);
  if (hostWS) { hostWS.close(); hostWS = null; }
  state.relayStatus = 'disconnected';
  updateRelayUI();
}

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
  const hDot = $('h-relay-state');
  const colors = { connected:'var(--green)', connecting:'var(--yellow)', disconnected:'var(--dim)' };
  const labels = { connected:'Connected', connecting:'Connecting…', disconnected:'Disconnected' };
  if (dot) dot.style.background = colors[state.relayStatus] || colors.disconnected;
  if (text) text.textContent = labels[state.relayStatus] || 'Disconnected';
  if (hDot) {
    hDot.textContent = labels[state.relayStatus] === 'Connected' ? 'Connected' : 'Offline';
    hDot.style.color = colors[state.relayStatus];
  }
  // Also update topbar dot glow if relay status is relevant
}

function updateConnectionURLs() {
  if (state.isStaticMode) return;
  const internetUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/mc`;
  const wsEl = $('wss-connect-url');
  if (wsEl) wsEl.textContent = internetUrl;
  const lanEl = $('ws-connect-url');
  if (lanEl) lanEl.textContent = 'ws://YOUR_LOCAL_IP:' + (location.port || '80') + '/mc';
}

// ── Copy buttons ────────────────────────────────────────────
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const src = $(btn.dataset.copy);
  if (!src) return;
  const text = src.tagName === 'TEXTAREA' ? src.value : src.textContent;
  copyText(text);
  btn.textContent = '✓ Copied!';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = btn.dataset.copy === 'offer-code' ? '📋 Copy Offer' : 'Copy';
    btn.classList.remove('copied');
  }, 2000);
});

// ── Server Worker ───────────────────────────────────────────
function startServerWorker() {
  if (window.serverWorker) { notify('Server already running', 'warn'); return; }

  const seed   = parseInt($('input-seed')?.value || '') || undefined;
  const motd   = $('input-motd')?.value.trim() || undefined;
  const maxP   = parseInt($('input-maxplayers')?.value || '20');
  const gmode  = parseInt($('input-gamemode')?.value  || '0');
  const diff   = parseInt($('input-difficulty')?.value || '1');

  addLog('Starting EaglerNet…', 'system');

  try {
    const worker = new Worker('./js/mc/server.js');
    window.serverWorker = worker;
    worker.addEventListener('message', onWorkerMessage);
    worker.addEventListener('error', e => {
      addLog('Worker crash: ' + (e.message || 'unknown error'), 'error');
      addLog('Check browser console for details. Ensure all JS files are reachable.', 'warn');
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
    if (!state.isStaticMode) connectRelay();
    // Dismiss getting started after first server start
    localStorage.setItem(GS_KEY, '1');
    $('gs-banner')?.remove();
  } catch(e) {
    addLog('Failed to start: ' + e.message, 'error');
    notify('Could not start — check browser support (needs Web Workers)', 'err');
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
    state.stats = {};
    disconnectRelay();
    updateServerControls();
    updateSidebarStats();
    renderPlayers();
    addLog('Server stopped.', 'system');
    notify('Server stopped');
  }, 1200);
}

// ── Worker messages ─────────────────────────────────────────
function onWorkerMessage(e) {
  const msg = e.data || {};

  if (msg.type === 'ws-send' || msg.type === 'ws-disconnect') {
    relayFromWorker(msg);
    return;
  }

  switch(msg.type) {
    case 'ready':
      addLog(`World ready — seed: ${msg.seed}, spawn Y: ${msg.spawnY}`, 'system');
      break;
    case 'log':
      addLog(msg.msg, msg.level || 'info');
      break;
    case 'stats':
      state.stats = msg.data || {};
      updateSidebarStats();
      updateHeroStats();
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
        gamemode: 0, health: 20, isOp: false,
        version: msg.version || '?', proto: msg.proto,
      });
      renderPlayers();
      updateHeroStats();
      break;
    case 'player.quit':
      state.players.delete(msg.uuid);
      renderPlayers();
      updateHeroStats();
      break;
    case 'plugin.loaded':
      addLog(`[BOTTLE] Loaded: ${msg.name} v${msg.version}`, 'info');
      notify(`Plugin loaded: ${msg.name}`);
      renderPlugins();
      updateSidebarStats();
      break;
    case 'offer-ready':
      state.pendingOffer = { id: msg.id, offer: msg.offer };
      if ($('offer-code')) $('offer-code').textContent = msg.offer || '(generating…)';
      $('offer-section')?.style && ($('offer-section').style.display = '');
      addLog('WebRTC offer ready — share with player.', 'info');
      notify('Offer ready — go to Connect tab');
      break;
    case 'stopped':
      addLog('Server shut down cleanly.', 'system');
      break;
  }
}

function chatToPlain(c) {
  if (typeof c === 'string') return c;
  let t = (c.text || '').replace(/§./g, '');
  if (c.extra) for (const x of c.extra) t += chatToPlain(x);
  return t;
}

// ── UI updates ──────────────────────────────────────────────
function updateServerControls() {
  const r = state.serverRunning;
  // Topbar buttons
  $('btn-start-server').style.display = r ? 'none' : '';
  $('btn-stop-server').style.display  = r ? '' : 'none';
  // Hero buttons
  $('hero-start').style.display = r ? 'none' : '';
  $('hero-stop').style.display  = r ? '' : 'none';
  // Hero state badge
  const heroState = $('hero-state');
  if (heroState) {
    heroState.textContent = r ? 'RUNNING' : 'STOPPED';
    heroState.className   = 'hero-state ' + (r ? 'running' : 'stopped');
  }
  // Hero stats row
  const heroStats = $('hero-stats');
  if (heroStats) heroStats.style.display = r ? '' : 'none';
  // Status dot + text
  qs('.status-dot')?.classList.toggle('online', r);
  const txt = qs('#topbar-status') || qs('.status-text');
  if (txt) txt.textContent = r ? 'Running' : 'Stopped';
}

function updateSidebarStats() {
  const s = state.stats;
  const set = (id, v) => { const el=$(id); if(el) el.textContent = v; };
  set('ss-tps',     s.tps     != null ? s.tps.toFixed(1)          : '—');
  set('ss-players', s.players != null ? `${s.players}/${s.max}`   : '—');
  set('ss-uptime',  s.uptime  != null ? fmtUptime(s.uptime)       : '—');
  set('ss-plugins', s.plugins != null ? String(s.plugins)         : '—');

  // World tab
  set('world-tps',     s.tps     != null ? s.tps.toFixed(2)         : '—');
  set('world-players', s.players != null ? `${s.players}/${s.max}`  : '—');
  set('world-uptime',  s.uptime  != null ? fmtUptime(s.uptime)      : '—');
  set('world-tick',    s.tick    != null ? String(s.tick)           : '—');
  set('world-seed',    s.seed    != null ? String(s.seed)           : '—');
  set('world-plugins', s.plugins != null ? String(s.plugins)        : '—');
}

function updateHeroStats() {
  const s = state.stats;
  const set = (id, v) => { const el=$(id); if(el) el.textContent = v; };
  set('h-tps',        s.tps     != null ? s.tps.toFixed(1)  : '—');
  set('h-players',    s.players != null ? String(s.players)  : String(state.players.size));
  set('h-maxplayers', s.max     != null ? String(s.max)      : '20');
  set('h-uptime',     s.uptime  != null ? fmtUptime(s.uptime) : '—');
  set('h-seed',       s.seed    != null ? String(s.seed)     : '—');
}

// ── Console ─────────────────────────────────────────────────
function sendConsoleCommand() {
  const input = $('console-input');
  const cmd = input.value.trim();
  if (!cmd) return;
  if (!window.serverWorker) { notify('Start the server first', 'warn'); return; }
  addLog('> ' + cmd, 'system');
  window.serverWorker.postMessage({ type:'command', data: cmd });
  input.value = '';
}
$('console-send').addEventListener('click', sendConsoleCommand);
$('console-input').addEventListener('keydown', e => { if (e.key==='Enter') sendConsoleCommand(); });

// ── Start / Stop (all buttons) ──────────────────────────────
$('btn-start-server').addEventListener('click', startServerWorker);
$('btn-stop-server').addEventListener('click', stopServer);
$('hero-start').addEventListener('click', startServerWorker);
$('hero-stop').addEventListener('click', stopServer);

// ── Players ─────────────────────────────────────────────────
function renderPlayers() {
  const panel = $('players-panel');
  if (!state.players.size) {
    panel.innerHTML = `<div class="empty-state">
      <div class="es-icon">👤</div>
      <strong>No players online</strong>
      Start the server and connect to see players here.
    </div>`;
    return;
  }
  const gm = ['Survival','Creative','Adventure','Spectator'];
  panel.innerHTML = [...state.players.values()].map(p => `
    <div class="player-card">
      <div class="player-avatar">👤</div>
      <div class="player-info">
        <div class="player-name">${escHtml(p.username)}</div>
        <div class="player-meta">MC ${escHtml(p.version||'?')} · proto ${p.proto||'?'} · UUID ${p.uuid.slice(0,8)}…</div>
        <div class="player-badges">
          ${p.isOp ? '<span class="pbadge op">OP</span>' : ''}
          <span class="pbadge ${['survival','creative','',''][p.gamemode]||'survival'}">${gm[p.gamemode]||gm[0]}</span>
        </div>
      </div>
      <div class="player-actions">
        <button class="act-btn green" onclick="sendCmd('say Hello, ${escHtml(p.username)}!')">Ping</button>
        <button class="act-btn" onclick="sendCmd('op ${escHtml(p.username)}')">OP</button>
        <button class="act-btn" onclick="promptTeleport('${escHtml(p.username)}')">TP</button>
        <button class="act-btn red" onclick="sendCmd('kick ${escHtml(p.username)} Kicked by admin')">Kick</button>
      </div>
    </div>`).join('');
}

window.promptTeleport = function(name) {
  const coords = prompt(`Teleport ${name} to (x y z):`, '0 64 0');
  if (!coords) return;
  const [x,y,z] = coords.trim().split(/\s+/);
  if (x&&y&&z) sendCmd(`tp ${name} ${x} ${y} ${z}`);
};

function sendCmd(cmd) {
  if (!window.serverWorker) { notify('Server not running', 'warn'); return; }
  window.serverWorker.postMessage({ type:'command', data: cmd });
  addLog('> ' + cmd, 'system');
}
window.sendCmd = sendCmd;

// ── Plugins ─────────────────────────────────────────────────
function renderPlugins() {
  const panel = $('plugins-list');
  if (!panel) return;
  const plugins = BOTTLE.getPlugins().filter(p => !p.builtin);
  if (!plugins.length) {
    panel.innerHTML = `<div class="empty-state" style="padding:24px">
      <div class="es-icon">◆</div>
      <strong>No user plugins loaded</strong>
      Drop a <code style="font-family:var(--mono);color:var(--accent)">.js</code> file below or click <strong>+ Load Plugin</strong>.
    </div>`;
    return;
  }
  panel.innerHTML = plugins.map(p => `
    <div class="plugin-card">
      <div class="plugin-icon">◆</div>
      <div class="plugin-info">
        <div class="plugin-name">${escHtml(p.name)}</div>
        <div class="plugin-desc">${escHtml(p.description || '—')}</div>
        <div class="plugin-ver">
          v${escHtml(p.version)}
          <span class="plugin-author">by ${escHtml(p.author || 'Unknown')}</span>
        </div>
      </div>
      <button class="plugin-toggle ${p.enabled?'on':''}" onclick="togglePlugin('${escHtml(p.id)}')">
        ${p.enabled ? 'Enabled' : 'Disabled'}
      </button>
    </div>`).join('');
}

window.togglePlugin = function(id) {
  const on = BOTTLE.toggle(id);
  notify((on ? 'Enabled' : 'Disabled') + ': ' + id);
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

// ── WebRTC ──────────────────────────────────────────────────
$('btn-create-offer')?.addEventListener('click', () => {
  if (!window.serverWorker) { notify('Start the server first', 'warn'); return; }
  if ($('offer-code')) $('offer-code').textContent = 'Generating… (up to 6s)';
  window.serverWorker.postMessage({ type:'create-offer' });
  addLog('Generating WebRTC offer…', 'system');
});
$('btn-accept-answer')?.addEventListener('click', () => {
  const ans = $('answer-input')?.value.trim();
  if (!ans || !state.pendingOffer) { notify('Paste player answer first', 'err'); return; }
  window.serverWorker?.postMessage({ type:'accept-answer', data:{ id: state.pendingOffer.id, answer: ans } });
  notify('Answer submitted…');
  addLog('WebRTC answer submitted — waiting for connection.', 'system');
});

// ── Stats polling ────────────────────────────────────────────
setInterval(() => {
  if (window.serverWorker && state.serverRunning) {
    window.serverWorker.postMessage({ type:'get-stats' });
  }
}, 4000);

// ── Service Worker ───────────────────────────────────────────
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ── Init ─────────────────────────────────────────────────────
applyModeUI();
showTab('console');
updateServerControls();
updateRelayUI();
renderPlugins();

if (!state.isStaticMode) {
  // Try relay early; it will retry silently until server is up
  connectRelay();
  addLog('EaglerNet ready — click Start Server to launch. WS relay will connect automatically.', 'system');
} else {
  addLog('EaglerNet ready (static mode) — click Start Server. WebRTC connections available via the Connect tab.', 'system');
}
addLog(`Versions: 1.5.2 → 1.12.2  |  Plugins: WorldEdit, WorldGuard, Multiverse (built-in)`, 'system');
