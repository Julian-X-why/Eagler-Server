'use strict';
/* EaglerNet Admin Dashboard — Pure Browser JavaScript */

// ── State ─────────────────────────────────────────────────
const state = {
  workerReady: false,
  serverRunning: false,
  players: new Map(),
  plugins: [],
  stats: {},
  log: [],
  pendingOffer: null,
};

window.serverWorker = null;

// ── Utility ───────────────────────────────────────────────
function $  (id) { return document.getElementById(id); }
function qs (sel, ctx=document) { return ctx.querySelector(sel); }
function qsa(sel, ctx=document) { return [...ctx.querySelectorAll(sel)]; }

function notify(msg, type='ok') {
  const el = document.createElement('div');
  el.className = 'notif ' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function fmtTime(d=new Date()) {
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

function fmtUptime(ms) {
  const s=Math.floor(ms/1000), m=Math.floor(s/60), h=Math.floor(m/60);
  return h>0 ? `${h}h ${m%60}m` : m>0 ? `${m}m ${s%60}s` : `${s}s`;
}

// ── Console log ───────────────────────────────────────────
function addLog(msg, level='info') {
  const el = document.createElement('div');
  el.className = `log-line log-${level}`;
  el.innerHTML = `<span class="log-time">[${fmtTime()}]</span><span class="log-msg">${escHtml(msg)}</span>`;
  const log = $('console-log');
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  state.log.push({ time: Date.now(), level, msg });
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Tab navigation ─────────────────────────────────────────
function showTab(id) {
  qsa('.tab-content').forEach(t => t.classList.remove('active'));
  qsa('.nav-btn').forEach(b => b.classList.remove('active'));
  $('tab-'+id)?.classList.add('active');
  qs(`.nav-btn[data-tab="${id}"]`)?.classList.add('active');
}

qsa('.nav-btn[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

// ── Server Worker ──────────────────────────────────────────
function startServerWorker() {
  if (window.serverWorker) {
    notify('Server is already running', 'err');
    return;
  }

  const seed = parseInt($('input-seed')?.value || '') || Math.floor(Math.random()*2147483647);
  const motd  = $('input-motd')?.value || '§aEaglerNet §71.12.2 Browser Server';
  const maxP  = parseInt($('input-maxplayers')?.value || '20');
  const gmode = parseInt($('input-gamemode')?.value || '0');

  addLog('Starting EaglerNet server...', 'info');
  addLog(`Seed: ${seed}`, 'info');

  const worker = new Worker('./js/mc/server.js');
  window.serverWorker = worker;

  worker.addEventListener('message', onWorkerMessage);
  worker.addEventListener('error', (e) => {
    addLog('Worker error: ' + e.message, 'error');
    notify('Server worker crashed!', 'err');
  });

  worker.postMessage({ type: 'start', data: { seed, motd, maxPlayers: maxP, defaultGamemode: gmode } });

  state.serverRunning = true;
  updateServerControls();
  // Update sidebar seed display
  updateSidebarStats();
}

function stopServer() {
  if (!window.serverWorker) return;
  window.serverWorker.postMessage({ type: 'command', data: 'stop' });
  setTimeout(() => {
    window.serverWorker?.terminate();
    window.serverWorker = null;
    state.serverRunning = false;
    state.players.clear();
    updateServerControls();
    renderPlayers();
    addLog('Server stopped.', 'warn');
    notify('Server stopped');
  }, 1000);
}

function onWorkerMessage(e) {
  const { type, data } = e;
  switch(type) {
    case 'ready':
      state.workerReady = true;
      addLog(`World ready — seed: ${e.seed}, spawn Y: ${e.spawnY}`, 'info');
      break;
    case 'log':
      addLog(e.msg, e.level || 'info');
      break;
    case 'stats':
      state.stats = e.data || data;
      updateSidebarStats();
      break;
    case 'chat':
      addLog(`<${e.username}> ${e.message}`, 'chat');
      break;
    case 'broadcast':
      // strip JSON chat to plain text for log
      try {
        const c = JSON.parse(e.message);
        addLog(chatToPlain(c), 'info');
      } catch { addLog(e.message, 'info'); }
      break;
    case 'player.join':
      state.players.set(e.uuid, { username: e.username, uuid: e.uuid, gamemode: 0, health: 20 });
      renderPlayers();
      addLog(`${e.username} joined (${e.count} online)`, 'info');
      break;
    case 'player.quit':
      state.players.delete(e.uuid);
      renderPlayers();
      addLog(`${e.username} left (${e.count} online)`, 'info');
      break;
    case 'plugin.loaded':
      state.plugins.push({ name: e.name, version: e.version, enabled: true });
      renderPlugins();
      notify(`Plugin loaded: ${e.name}`);
      break;
    case 'offer-ready':
      state.pendingOffer = { id: e.id, offer: e.offer };
      $('offer-code').textContent = e.offer || '(generating…)';
      $('offer-section').style.display = '';
      addLog('WebRTC offer generated. Share it with the player.', 'info');
      break;
    case 'stopped':
      addLog('Server shut down cleanly.', 'warn');
      break;
  }
}

function chatToPlain(c) {
  if (typeof c === 'string') return c;
  let t = c.text || '';
  if (c.extra) for (const ex of c.extra) t += chatToPlain(ex);
  return t.replace(/§./g,'');
}

// ── Sidebar stat display ───────────────────────────────────
function updateSidebarStats() {
  const s = state.stats;
  setText('stat-tps',     s.tps != null ? s.tps.toFixed(1) : '—');
  setText('stat-players', s.players != null ? `${s.players}/${s.max}` : '—');
  setText('stat-uptime',  s.uptime != null ? fmtUptime(s.uptime) : '—');
  setText('stat-seed',    s.seed   != null ? s.seed : '—');
}

function setText(id, v) { const el=$(id); if(el) el.textContent=v; }

function updateServerControls() {
  const running = state.serverRunning;
  $('btn-start-server').style.display  = running ? 'none' : '';
  $('btn-stop-server').style.display   = running ? '' : 'none';
  qs('.status-dot')?.classList.toggle('online', running);
  qs('.status-text').textContent = running ? 'Server Running' : 'Stopped';
}

// ── Console commands ───────────────────────────────────────
function sendConsoleCommand() {
  const input = $('console-input');
  const cmd = input.value.trim();
  if (!cmd) return;
  if (!window.serverWorker) { notify('Start the server first!', 'err'); return; }
  addLog('> ' + cmd, 'info');
  window.serverWorker.postMessage({ type: 'command', data: cmd });
  input.value = '';
}

$('console-send').addEventListener('click', sendConsoleCommand);
$('console-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendConsoleCommand(); });

// ── Server start/stop buttons ──────────────────────────────
$('btn-start-server').addEventListener('click', startServerWorker);
$('btn-stop-server').addEventListener('click', stopServer);

// ── Players tab ────────────────────────────────────────────
function renderPlayers() {
  const panel = $('players-panel');
  if (state.players.size === 0) {
    panel.innerHTML = '<div class="empty-state">No players online</div>';
    return;
  }
  panel.innerHTML = '';
  for (const p of state.players.values()) {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.innerHTML = `
      <div class="player-avatar">&#x1F9D1;</div>
      <div class="player-info">
        <div class="player-name">${escHtml(p.username)}</div>
        <div class="player-meta">UUID: ${p.uuid.slice(0,16)}…</div>
      </div>
      <div class="player-actions">
        <button class="act-btn" onclick="sendCmd('say Hello from ${escHtml(p.username)}!')">Ping</button>
        <button class="act-btn" onclick="sendCmd('op ${escHtml(p.username)}')">OP</button>
        <button class="act-btn red" onclick="sendCmd('kick ${escHtml(p.username)}')">Kick</button>
      </div>`;
    panel.appendChild(card);
  }
}

function sendCmd(cmd) {
  if (!window.serverWorker) { notify('Server not running', 'err'); return; }
  window.serverWorker.postMessage({ type: 'command', data: cmd });
  addLog('> ' + cmd, 'info');
}

// ── Plugins tab ────────────────────────────────────────────
function renderPlugins() {
  const panel = $('plugins-list');
  if (!panel) return;
  const plugins = EaglerForge.getPlugins();
  if (plugins.length === 0) {
    panel.innerHTML = '<div class="empty-state" style="padding:24px">No plugins loaded. Drop a .js file below.</div>';
    return;
  }
  panel.innerHTML = plugins.map(p => `
    <div class="plugin-card" id="plg-${p.id}">
      <div class="plugin-icon">&#9670;</div>
      <div class="plugin-info">
        <div class="plugin-name">${escHtml(p.name)}</div>
        <div class="plugin-desc">${escHtml(p.description)}</div>
        <div class="plugin-ver">v${p.version} by ${escHtml(p.author)}</div>
      </div>
      <button class="plugin-toggle ${p.enabled?'on':''}" onclick="togglePlugin('${p.id}')">
        ${p.enabled?'Enabled':'Disabled'}
      </button>
    </div>`).join('');
}

window.togglePlugin = function(id) {
  const enabled = EaglerForge.toggle(id);
  notify((enabled?'Enabled':'Disabled') + ' plugin');
  renderPlugins();
};

// Drop zone for plugin files
function setupDropZone() {
  const zone = $('plugin-drop-zone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', async e => {
    e.preventDefault(); zone.classList.remove('over');
    for (const file of [...e.dataTransfer.files]) await loadPluginFile(file);
  });
  zone.addEventListener('click', () => $('plugin-file-input')?.click());
  $('plugin-file-input')?.addEventListener('change', async e => {
    for (const file of [...e.target.files]) await loadPluginFile(file);
    e.target.value = '';
  });
  $('btn-load-plugin')?.addEventListener('click', () => $('plugin-file-input')?.click());
}

async function loadPluginFile(file) {
  if (!file.name.endsWith('.js')) { notify('Only .js plugin files', 'err'); return; }
  try {
    const code = await file.text();
    // Load in dashboard context
    EaglerForge.loadCode(code);
    // Send to worker if server is running
    if (window.serverWorker) {
      window.serverWorker.postMessage({ type: 'load-plugin', data: { code } });
    }
    notify(`Loaded: ${file.name}`);
    renderPlugins();
  } catch(e) { notify('Plugin error: ' + e.message, 'err'); }
}

// ── WebRTC connection tab ──────────────────────────────────
$('btn-create-offer')?.addEventListener('click', () => {
  if (!window.serverWorker) { notify('Start the server first!', 'err'); return; }
  $('offer-code').textContent = 'Generating…';
  window.serverWorker.postMessage({ type: 'create-offer' });
});

$('btn-copy-offer')?.addEventListener('click', () => {
  const text = $('offer-code').textContent;
  navigator.clipboard.writeText(text).then(() => notify('Copied offer!')).catch(() => {
    notify('Copy failed — select text manually', 'err');
  });
});

$('btn-accept-answer')?.addEventListener('click', () => {
  const answer = $('answer-input')?.value.trim();
  if (!answer || !state.pendingOffer) { notify('Paste the player answer first', 'err'); return; }
  window.serverWorker.postMessage({ type: 'accept-answer', data: { id: state.pendingOffer.id, answer } });
  notify('Answer submitted — waiting for connection...');
});

// ── World tab ──────────────────────────────────────────────
function updateWorldTab() {
  const s = state.stats;
  setText('world-seed',    s.seed ?? '—');
  setText('world-players', s.players != null ? `${s.players}/${s.max}` : '—');
  setText('world-tps',     s.tps != null ? s.tps.toFixed(2) : '—');
  setText('world-uptime',  s.uptime != null ? fmtUptime(s.uptime) : '—');
  setText('world-tick',    s.tick ?? '—');
}

// Refresh stats every 5 seconds
setInterval(() => {
  if (window.serverWorker && state.serverRunning) {
    window.serverWorker.postMessage({ type: 'get-stats' });
    updateWorldTab();
  }
}, 5000);

// ── Service Worker registration ────────────────────────────
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ── Init ─────────────────────────────────────────────────
setupDropZone();
showTab('console');
updateServerControls();
addLog('EaglerNet Dashboard ready. Click "Start Server" to begin.', 'info');
addLog('All game logic runs in your browser — no Node.js required.', 'info');
