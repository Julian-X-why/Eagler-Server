'use strict';
/* EaglerNet Admin Dashboard v4 — BOTTLE Plugin System | Minecraft-themed UI */

// ── State ──────────────────────────────────────────────────────
const state = {
  serverRunning: false,
  players: new Map(),
  stats: {},
  log: [],
  pendingOffer: null,
  relayStatus: 'disconnected',
  isStaticMode: false,
  activeFile: null,
  fileEditorDirty: false,
};
window._BOTTLE_players = state.players;
window.serverWorker    = null;

// ── Mode detection ─────────────────────────────────────────────
(function detectMode() {
  const h = location.hostname;
  const isLocal =
    h === 'localhost' || h === '127.0.0.1' ||
    h.endsWith('.replit.dev') || h.endsWith('.repl.co') ||
    h.endsWith('.repl.it')   || h.endsWith('.replit.app') ||
    h.endsWith('.replit.co');
  const isStaticHost =
    location.protocol === 'file:' ||
    h.endsWith('.github.io') || h.endsWith('.pages.dev') ||
    h.endsWith('.netlify.app') || h.endsWith('.vercel.app') ||
    h.endsWith('.surge.sh');
  state.isStaticMode = isStaticHost && !isLocal;
})();

// ── Utils ──────────────────────────────────────────────────────
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
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
window.copyText = function(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(()=>fallbackCopy(text));
  return fallbackCopy(text);
};
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value=text; ta.style.cssText='position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch {}
  document.body.removeChild(ta);
}

// ── Console log ────────────────────────────────────────────────
function addLog(msg, level='info') {
  const el = document.createElement('div');
  el.className = `log-line log-${level}`;
  const clean = escHtml(msg.replace(/§./g,''));
  el.innerHTML = `<span class="log-time">[${fmtTime()}]</span><span class="log-msg"> ${clean}</span>`;
  const log = $('console-log');
  if (log) {
    log.appendChild(el);
    if (log.scrollHeight - log.scrollTop - log.clientHeight < 120) log.scrollTop = log.scrollHeight;
  }
  if (state.log.length > 1200) state.log.shift();
  state.log.push({ time: Date.now(), level, msg });
}
window.addLog = addLog;

// ── Tab navigation ─────────────────────────────────────────────
function showTab(id) {
  qsa('.tab-content').forEach(t => t.classList.remove('active'));
  qsa('.nav-btn[data-tab]').forEach(b => b.classList.remove('active'));
  qsa('.bnav-btn[data-tab]').forEach(b => b.classList.remove('active'));
  $('tab-'+id)?.classList.add('active');
  qs(`.nav-btn[data-tab="${id}"]`)?.classList.add('active');
  qs(`.bnav-btn[data-tab="${id}"]`)?.classList.add('active');
  if (id === 'config')  loadConfigTab();
  if (id === 'files')   renderFileTree();
  if (id === 'play')    initPlayTab();
  closeSidebar();
}
qsa('[data-tab]').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

// ── Mobile sidebar ─────────────────────────────────────────────
function openSidebar()  { $('sidebar')?.classList.add('open'); $('sidebar-overlay')?.classList.add('open'); }
function closeSidebar() { $('sidebar')?.classList.remove('open'); $('sidebar-overlay')?.classList.remove('open'); }
$('btn-menu')?.addEventListener('click', openSidebar);
$('sidebar-overlay')?.addEventListener('click', closeSidebar);

// ── Getting Started banner ─────────────────────────────────────
const GS_KEY = 'eaglernet_gs_dismissed';
if (localStorage.getItem(GS_KEY)) $('gs-banner')?.remove();
$('gs-dismiss')?.addEventListener('click', () => {
  localStorage.setItem(GS_KEY,'1'); $('gs-banner')?.remove();
});

// ── Config tab ─────────────────────────────────────────────────
function loadConfigTab() {
  if (!window.BOTTLE?.serverProps) return;
  const all = BOTTLE.serverProps.getAll();
  qsa('[data-prop]').forEach(el => {
    const k = el.dataset.prop;
    if (k && all[k] !== undefined) el.value = all[k];
  });
  qsa('[data-prop-bool]').forEach(el => {
    const k = el.dataset.propBool;
    if (k) el.checked = all[k] === 'true';
  });
}
function saveConfigTab() {
  if (!window.BOTTLE?.serverProps) return;
  qsa('[data-prop]').forEach(el => {
    const k = el.dataset.prop;
    if (k) BOTTLE.serverProps.set(k, el.value);
  });
  qsa('[data-prop-bool]').forEach(el => {
    const k = el.dataset.propBool;
    if (k) BOTTLE.serverProps.set(k, el.checked ? 'true' : 'false');
  });
  notify('Configuration saved!');
  addLog('[Config] Server properties saved.', 'system');
}
function applyConfigLive() {
  saveConfigTab();
  if (!window.serverWorker) { notify('Server not running - settings will apply on next start.', 'warn'); return; }
  const props = BOTTLE.serverProps.getAll();
  window.serverWorker.postMessage({ type: 'server-props', data: props });
  notify('Settings applied to running server!');
  addLog('[Config] Settings pushed to running server.', 'system');
}
function resetConfigTab() {
  if (!confirm('Reset all settings to defaults?')) return;
  BOTTLE.serverProps.reset();
  loadConfigTab();
  notify('Reset to defaults.');
}
$('btn-save-config')?.addEventListener('click', saveConfigTab);
$('btn-apply-config')?.addEventListener('click', applyConfigLive);
$('btn-reset-config')?.addEventListener('click', resetConfigTab);

// ── Files tab ──────────────────────────────────────────────────
function renderFileTree() {
  const tree = $('file-tree');
  if (!tree || !window.BOTTLE?.vfs) return;
  const paths = BOTTLE.vfs.list().sort();
  const root = {};
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]]) node[parts[i]] = { _children: {} };
      node = node[parts[i]]._children || node[parts[i]];
    }
    const fname = parts[parts.length - 1];
    node[fname] = { _path: p, _file: true };
  }
  function renderNode(obj, depth=0) {
    let html = '';
    const entries = Object.entries(obj).filter(([k]) => !k.startsWith('_')).sort(([a],[b]) => {
      const aIsDir = !obj[a]._file;
      const bIsDir = !obj[b]._file;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.localeCompare(b);
    });
    for (const [name, val] of entries) {
      if (val._file) {
        const fpath = val._path;
        const active = state.activeFile === fpath ? ' active' : '';
        const canW = BOTTLE.vfs.canWrite(fpath);
        html += `<div class="file-node${active}" onclick="openFile('${escHtml(fpath)}')" style="padding-left:${8+depth*14}px">
          <span class="file-node-icon">${canW?'F':'R'}</span>
          <span>${escHtml(name)}</span>
        </div>`;
      } else {
        const children = val._children || val;
        html += `<div class="file-node folder" style="padding-left:${8+depth*14}px">
          <span class="file-node-icon">D</span>
          <span>${escHtml(name)}/</span>
        </div>`;
        html += renderNode(children, depth+1);
      }
    }
    return html;
  }
  tree.innerHTML = renderNode(root);
}

window.openFile = function(filePath) {
  const pane = $('file-editor-pane');
  if (!pane || !window.BOTTLE?.vfs) return;
  state.activeFile = filePath;
  renderFileTree();
  const content = BOTTLE.vfs.read(filePath);
  const canWrite = BOTTLE.vfs.canWrite(filePath);
  if (content === null) { pane.innerHTML = '<div class="file-editor-placeholder">File not found.</div>'; return; }
  pane.innerHTML = `
    <div class="file-editor-header">
      <span class="file-editor-path">${escHtml(filePath)}</span>
      <div class="file-editor-actions">
        ${canWrite ? `<button class="btn sm primary" onclick="saveCurrentFile()">Save</button>` : '<span style="font-size:.7rem;color:var(--dim)">read-only</span>'}
        <button class="btn sm" onclick="window.openFile('${escHtml(filePath)}')">Reload</button>
      </div>
    </div>
    <textarea id="file-editor-ta" class="file-editor-textarea${canWrite?'':' file-editor-readonly'}"
      ${canWrite?'':'readonly'}
      spellcheck="false">${escHtml(content)}</textarea>
    <div class="file-editor-status" id="file-editor-status">${canWrite ? 'Ready to edit' : 'Read-only'}</div>
  `;
  const ta = $('file-editor-ta');
  if (ta && canWrite) ta.addEventListener('input', () => {
    state.fileEditorDirty = true;
    const st = $('file-editor-status');
    if (st) st.textContent = 'Unsaved changes';
  });
};

window.saveCurrentFile = function() {
  if (!state.activeFile || !window.BOTTLE?.vfs) return;
  const ta = $('file-editor-ta');
  if (!ta) return;
  const ok = BOTTLE.vfs.write(state.activeFile, ta.value);
  const st = $('file-editor-status');
  if (ok) {
    if (st) st.textContent = 'Saved';
    state.fileEditorDirty = false;
    notify('File saved: ' + state.activeFile);
    addLog('[Files] Saved: ' + state.activeFile, 'system');
  } else {
    if (st) st.textContent = 'Save failed!';
    notify('Save failed', 'err');
  }
};

$('btn-files-reload')?.addEventListener('click', () => {
  renderFileTree();
  if (state.activeFile) window.openFile(state.activeFile);
});

// ── Plugin rendering ───────────────────────────────────────────
const PLUGIN_CATEGORIES = {
  nexuslink:'Core', purityfilter:'Core', integritycheck:'Core',
  worldsculptor:'World', terrainguard:'World', voidportal:'World', spawnmaster:'World',
  authshield:'Players', essentialcraft:'Players', welcomemat:'Players', tabflair:'Players',
  ecovault:'Economy', tradingpost:'Economy',
  chatforge:'Social', rankengine:'Social', clanforge:'Social',
  banhammer:'Admin', adminspy:'Admin', cronmaster:'Admin', vaultpack:'Admin',
};

function renderPlugins() {
  const container = $('plugins-container');
  if (!container || !window.BOTTLE) return;
  const plugins = BOTTLE.getPlugins();
  if (!plugins.length) {
    container.innerHTML = '<div class="empty-state" style="padding:40px"><div class="es-icon">[+]</div><strong>No plugins loaded yet...</strong></div>';
    return;
  }
  const groups = {};
  for (const p of plugins) {
    const cat = PLUGIN_CATEGORIES[p.id] || 'User Plugins';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(p);
  }
  const order = ['Core','World','Players','Economy','Social','Admin','User Plugins'];
  let html = '';
  for (const cat of order) {
    if (!groups[cat]?.length) continue;
    html += `<div class="plugin-section-label">-- ${cat} --</div>`;
    for (const p of groups[cat]) {
      const schema = p.configSchema || {};
      const hasConfig = Object.keys(schema).length > 0;
      const cfgFields = Object.entries(schema).map(([k,s]) => {
        const val = p.config.get(k);
        if (s.type === 'boolean') {
          return `<label class="cfg-field-row">
            <input type="checkbox" ${val ? 'checked' : ''} onchange="setCfgVal('${p.id}','${k}',this.checked)">
            <span>${escHtml(s.label)}</span>
            <span class="cfg-default">default: ${s.default}</span>
          </label>`;
        } else if (s.options) {
          return `<div class="cfg-field">
            <label>${escHtml(s.label)}</label>
            <select onchange="setCfgVal('${p.id}','${k}',this.value)">
              ${s.options.map(o=>`<option value="${o}" ${val==o?'selected':''}>${escHtml(String(o))}</option>`).join('')}
            </select>
          </div>`;
        } else {
          return `<div class="cfg-field">
            <label>${escHtml(s.label)}</label>
            <input type="${s.type==='number'?'number':'text'}" value="${escHtml(String(val??''))}"
              onchange="setCfgVal('${p.id}','${k}',${s.type==='number'?'parseFloat(this.value)||0':'this.value'})">
          </div>`;
        }
      }).join('');
      html += `<div class="plugin-tile" id="ptile-${p.id}">
        <div class="plugin-tile-header">
          <div class="plugin-tile-left">
            <div class="pt-dot ${p.enabled?'on':'off'}"></div>
            <div class="pt-info">
              <div class="pt-name">${escHtml(p.name)} <span class="pt-ver">v${escHtml(p.version)}</span></div>
              <div class="pt-desc">${escHtml(p.description)}</div>
              <div class="pt-author">by ${escHtml(p.author)}</div>
            </div>
          </div>
          <div class="plugin-tile-right">
            <button class="pt-toggle ${p.enabled?'on':''}" onclick="togglePlugin('${p.id}')">
              ${p.enabled ? 'Enabled' : 'Disabled'}
            </button>
            ${hasConfig ? `<button class="pt-config-btn" onclick="togglePluginConfig('${p.id}')">Config</button>` : ''}
          </div>
        </div>
        ${hasConfig ? `<div class="plugin-cfg-panel" id="plcfg-${p.id}" style="display:none">
          <div class="cfg-panel-inner">
            <div class="cfg-panel-title">Plugin Configuration</div>
            ${cfgFields}
          </div>
        </div>` : ''}
      </div>`;
    }
  }
  const userPlugins = plugins.filter(p => !PLUGIN_CATEGORIES[p.id]);
  if (!userPlugins.length) {
    html += `<div class="user-plugins-label">User Plugins</div>
      <div class="empty-state" style="padding:20px">
        <div class="es-icon">[+]</div>
        <strong>No custom plugins loaded</strong>
        <p>Drop a <code>.js</code> file below or click <strong>+ Load .js</strong></p>
      </div>`;
  }
  container.innerHTML = html;
}

window.togglePlugin = function(id) {
  const on = BOTTLE.toggle(id);
  notify(`${on ? 'Enabled' : 'Disabled'}: ${id}`);
  renderPlugins();
};
window.togglePluginConfig = function(id) {
  const panel = $('plcfg-'+id);
  if (!panel) return;
  panel.style.display = panel.style.display !== 'none' ? 'none' : 'block';
};
window.setCfgVal = function(pluginId, key, value) {
  const cfg = BOTTLE.getConfig(pluginId);
  if (cfg) { cfg.set(key, value); notify(`${pluginId}: ${key} = ${value}`); }
};

// ── Drop zone & file loading ───────────────────────────────────
const dropZone    = $('plugin-drop-zone');
const pluginInput = $('plugin-file-input');
$('btn-load-plugin')?.addEventListener('click', () => pluginInput?.click());
pluginInput?.addEventListener('change', e => {
  for (const file of e.target.files || []) loadPluginFile(file);
  pluginInput.value = '';
});
function setupDropZone(zone) {
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    for (const file of e.dataTransfer.files) loadPluginFile(file);
  });
  zone.addEventListener('click', () => pluginInput?.click());
}
setupDropZone(dropZone);
function loadPluginFile(file) {
  if (!file.name.endsWith('.js')) { notify('Only .js plugin files are supported', 'warn'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const code = e.target.result;
    const ok = BOTTLE.loadAndSend(code);
    if (ok) { notify('Plugin loaded: ' + file.name); renderPlugins(); }
    else     notify('Plugin error — check console', 'err');
  };
  reader.readAsText(file);
}

// ── Copy buttons ───────────────────────────────────────────────
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const src = $(btn.dataset.copy);
  if (!src) return;
  const text = src.tagName === 'TEXTAREA' ? src.value : src.textContent;
  copyText(text);
  const orig = btn.textContent;
  btn.textContent = 'Copied!'; btn.classList.add('copied');
  setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
});

// ── Console ────────────────────────────────────────────────────
function sendConsoleCommand() {
  const input = $('console-input');
  const cmd = input?.value.trim();
  if (!cmd) return;
  if (!window.serverWorker) { notify('Start the server first', 'warn'); return; }
  addLog('> ' + cmd, 'system');
  window.serverWorker.postMessage({ type:'command', data:cmd });
  input.value = '';
}
$('console-send')?.addEventListener('click', sendConsoleCommand);
$('console-input')?.addEventListener('keydown', e => { if(e.key==='Enter') sendConsoleCommand(); });

// ── Mode UI ────────────────────────────────────────────────────
function applyModeUI() {
  const badge    = $('mode-badge');
  const sb       = $('static-banner');
  const relayCard= $('relay-card');
  const modeLabel= $('connect-mode-label');
  const modeDesc = $('connect-mode-desc');
  if (state.isStaticMode) {
    if (badge) { badge.textContent = 'Static Mode'; badge.className = 'mode-badge static-mode'; }
    if (sb)         sb.style.display = 'flex';
    if (relayCard)  relayCard.style.display = 'none';
    const sgc = $('static-guide-card');
    if (sgc) sgc.style.display = '';
    if (modeLabel) modeLabel.textContent = 'Static Hosting';
    if (modeDesc)  modeDesc.innerHTML = '<strong style="color:var(--yellow)">No WS relay</strong> — static host detected. WebRTC works. Download the ZIP for self-hosting with relay support.';
    const hrh = $('h-relay-hstat');
    if (hrh) hrh.style.display = 'none';
  } else {
    if (badge) { badge.textContent = 'Relay Mode'; badge.className = 'mode-badge'; }
    if (modeLabel) modeLabel.textContent = 'Full Mode (Node.js relay active)';
    if (modeDesc)  modeDesc.innerHTML = '<strong style="color:var(--accent)">WS relay available</strong> — both WebRTC peer-to-peer and IP/URL connections work.';
    updateConnectionURLs();
  }
}

// ── WS Relay ───────────────────────────────────────────────────
let hostWS = null;
let relayReconnectTimer = null;

function connectRelay() {
  if (state.isStaticMode) return;
  if (hostWS && (hostWS.readyState===WebSocket.OPEN || hostWS.readyState===WebSocket.CONNECTING)) return;
  clearTimeout(relayReconnectTimer);
  const proto = location.protocol==='https:' ? 'wss:' : 'ws:';
  state.relayStatus = 'connecting';
  updateRelayUI();
  try { hostWS = new WebSocket(`${proto}//${location.host}/mc-host`); hostWS.binaryType='arraybuffer'; }
  catch { state.relayStatus='disconnected'; updateRelayUI(); scheduleRelayReconnect(); return; }
  hostWS.onopen = () => {
    state.relayStatus='connected'; updateRelayUI();
    hostWS.send(JSON.stringify({ type:'host-ready' }));
    addLog('[Relay] WS relay connected — players can connect by IP', 'info');
    updateConnectionURLs();
    updatePlayServerHint();
  };
  hostWS.onmessage = (e) => {
    if (!window.serverWorker || !state.serverRunning) return;
    try {
      const msg = JSON.parse(typeof e.data==='string' ? e.data : new TextDecoder().decode(e.data));
      switch(msg.type) {
        case 'player-connect':
          window.serverWorker.postMessage({ type:'ws-player-connect', data:{id:msg.id,ip:msg.ip} });
          addLog(`[Relay] Player connecting from ${msg.ip}`, 'info'); break;
        case 'player-data': {
          const raw = msg.data ? Uint8Array.from(atob(msg.data), c=>c.charCodeAt(0)).buffer : new ArrayBuffer(0);
          window.serverWorker.postMessage({ type:'ws-player-data', data:{id:msg.id,data:raw} }, [raw]); break;
        }
        case 'player-disconnect':
          window.serverWorker.postMessage({ type:'ws-player-disconnect', data:{id:msg.id} }); break;
      }
    } catch {}
  };
  hostWS.onclose = () => {
    state.relayStatus='disconnected'; updateRelayUI();
    if (state.serverRunning) addLog('[Relay] Relay disconnected — reconnecting...','warn');
    scheduleRelayReconnect();
  };
  hostWS.onerror = () => { state.relayStatus='disconnected'; updateRelayUI(); };
}
function scheduleRelayReconnect() {
  if (state.isStaticMode) return;
  clearTimeout(relayReconnectTimer);
  relayReconnectTimer = setTimeout(connectRelay, 4000);
}
function disconnectRelay() {
  clearTimeout(relayReconnectTimer);
  if (hostWS) { hostWS.close(); hostWS=null; }
  state.relayStatus='disconnected'; updateRelayUI();
}
function relayFromWorker(msg) {
  if (!hostWS || hostWS.readyState!==WebSocket.OPEN) return;
  if (msg.type==='ws-send') {
    const ab = msg.data instanceof ArrayBuffer ? msg.data : new Uint8Array(msg.data).buffer;
    const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
    hostWS.send(JSON.stringify({ type:'player-data', id:msg.id, data:b64 }));
  } else if (msg.type==='ws-disconnect') {
    hostWS.send(JSON.stringify({ type:'player-kick', id:msg.id, reason:'Disconnected' }));
  }
}
function updateRelayUI() {
  const colors={connected:'var(--green)',connecting:'var(--yellow)',disconnected:'var(--dim)'};
  const labels={connected:'Connected',connecting:'Connecting...',disconnected:'Disconnected'};
  const dot=$('relay-dot'), txt=$('relay-status-text'), hDot=$('h-relay-state');
  if (dot)  dot.style.background = colors[state.relayStatus];
  if (txt)  txt.textContent       = labels[state.relayStatus];
  if (hDot) { hDot.textContent=state.relayStatus==='connected'?'Connected':'Offline'; hDot.style.color=colors[state.relayStatus]; }
}
function updateConnectionURLs() {
  if (state.isStaticMode) return;
  const url = `${location.protocol==='https:'?'wss':'ws'}://${location.host}/mc`;
  const wssEl=$('wss-connect-url'); if(wssEl) wssEl.textContent=url;
  const wsEl=$('ws-connect-url');  if(wsEl)  wsEl.textContent=`ws://YOUR_LOCAL_IP:${location.port||'80'}/mc`;
}

// ── Play Tab ───────────────────────────────────────────────────
const PLAY_URL_KEY    = 'eaglernet_play_client_url';
const DEFAULT_CLIENT  = 'https://eaglercraft.com/mc/1.12.2-u3/';

function getServerURL() {
  if (state.isStaticMode) return '';
  return `${location.protocol==='https:'?'wss':'ws'}://${location.host}/mc`;
}

function initPlayTab() {
  const urlInput = $('play-client-url');
  if (urlInput && !urlInput.value) {
    urlInput.value = localStorage.getItem(PLAY_URL_KEY) || DEFAULT_CLIENT;
  }
  updatePlayServerHint();
}

function updatePlayServerHint() {
  const hint = $('play-server-hint');
  if (!hint) return;
  const url = getServerURL();
  hint.textContent = url ? ('Server: ' + url) : (state.isStaticMode ? 'Static mode - use WebRTC' : 'Start server to get URL');
}

function launchPlayClient() {
  const urlInput = $('play-client-url');
  const clientUrl = urlInput?.value.trim() || DEFAULT_CLIENT;
  if (!clientUrl) { notify('Enter a client URL first', 'warn'); return; }
  localStorage.setItem(PLAY_URL_KEY, clientUrl);

  const frame    = $('play-client-frame');
  const placeholder = $('play-placeholder');

  if (!frame) return;

  // Hide placeholder, show iframe
  if (placeholder) placeholder.style.display = 'none';
  frame.style.display = 'block';
  frame.src = clientUrl;

  // If iframe fails to load (X-Frame-Options), show fallback
  frame.onerror = () => {
    frame.style.display = 'none';
    if (placeholder) {
      placeholder.style.display = 'flex';
      const sub = placeholder.querySelector('.pp-sub');
      if (sub) sub.innerHTML = `<strong style="color:var(--red)">Could not embed client</strong> — the client URL blocked iframe embedding.<br>
        Use <strong>Open in New Tab</strong> and connect manually to:<br>
        <code style="font-size:.75rem;color:var(--accent)">${escHtml(getServerURL() || 'wss://your-server/mc')}</code>`;
    }
    notify('Could not embed client — use New Tab', 'warn');
  };

  addLog(`[Play] Launched client: ${clientUrl}`, 'system');
  notify('Client launched in Play tab');
}

function openClientNewTab() {
  const urlInput = $('play-client-url');
  const clientUrl = urlInput?.value.trim() || DEFAULT_CLIENT;
  if (!clientUrl) { notify('Enter a client URL first', 'warn'); return; }
  localStorage.setItem(PLAY_URL_KEY, clientUrl);
  window.open(clientUrl, '_blank', 'noopener');
  notify('Client opened in new tab — connect to: ' + (getServerURL() || 'your WS URL'));
}

$('btn-play-launch')?.addEventListener('click', launchPlayClient);
$('btn-play-newtab')?.addEventListener('click', openClientNewTab);
$('btn-play-launch2')?.addEventListener('click', launchPlayClient);
$('btn-play-newtab2')?.addEventListener('click', openClientNewTab);

// ── Server Worker ──────────────────────────────────────────────
function startServerWorker() {
  if (window.serverWorker) { notify('Server already running','warn'); return; }
  const props = window.BOTTLE?.serverProps?.getAll() || {};
  const seed   = parseInt(props['level-seed'] || '') || undefined;
  const maxP   = parseInt(props['max-players'] || '20');
  const gmode  = parseInt(props['gamemode'] || '0');
  const diff   = parseInt(props['difficulty'] || '1');
  const motd   = props['motd'] || undefined;
  addLog('Starting EaglerNet server...','system');
  try {
    const worker = new Worker('./js/mc/server.js');
    window.serverWorker = worker;
    worker.addEventListener('message', onWorkerMessage);
    worker.addEventListener('error', e => {
      addLog('Worker crash: ' + (e.message||'unknown'),'error');
      notify('Server worker crashed!','err');
      window.serverWorker=null; state.serverRunning=false; updateServerControls();
    });
    worker.postMessage({ type:'start', data:{ seed, motd, maxPlayers:maxP, world:{ defaultGamemode:gmode, difficulty:diff, seed } } });
    if (window.BOTTLE) {
      for (const p of BOTTLE.getPlugins()) {
        BOTTLE._sendToWorker(p.id, { ...p, name:p.name, version:p.version }, {}, p.config.getAll());
      }
    }
    state.serverRunning=true; updateServerControls();
    if (!state.isStaticMode) connectRelay();
    updatePlayServerHint();
    localStorage.setItem(GS_KEY,'1'); $('gs-banner')?.remove();
  } catch(e) {
    addLog('Failed to start: '+e.message,'error');
    notify('Could not start — check browser support (needs Web Workers)','err');
  }
}

function stopServer() {
  if (!window.serverWorker) return;
  window.serverWorker.postMessage({ type:'command', data:'stop' });
  setTimeout(() => {
    window.serverWorker?.terminate(); window.serverWorker=null;
    state.serverRunning=false; state.players.clear(); state.stats={};
    disconnectRelay(); updateServerControls(); updateSidebarStats(); renderPlayers();
    updatePlayServerHint();
    addLog('Server stopped.','system'); notify('Server stopped');
  }, 1200);
}

function restartServer() {
  addLog('Restarting server...','system');
  stopServer();
  setTimeout(() => startServerWorker(), 2000);
}

// ── Worker messages ────────────────────────────────────────────
function onWorkerMessage(e) {
  const msg = e.data || {};
  if (msg.type==='ws-send' || msg.type==='ws-disconnect') { relayFromWorker(msg); return; }
  switch(msg.type) {
    case 'ready':
      addLog(`World ready — seed: ${msg.seed}, spawn Y: ${msg.spawnY}`, 'system');
      break;
    case 'log':    addLog(msg.msg, msg.level||'info'); break;
    case 'stats':
      state.stats=msg.data||{}; updateSidebarStats(); updateHeroStats(); updateTopbarStats();
      break;
    case 'chat':   addLog(`<${msg.username}> ${msg.message}`, 'chat'); break;
    case 'broadcast':
      try { addLog(chatToPlain(JSON.parse(msg.message)),'info'); } catch { addLog(msg.message,'info'); }
      break;
    case 'player.join':
      state.players.set(msg.uuid, {
        username:msg.username, uuid:msg.uuid, gamemode:0, health:20, isOp:false,
        version:msg.version||'?', proto:msg.proto,
        x:0, y:64, z:0, world:'world',
      });
      renderPlayers(); updateHeroStats(); updateTopbarStats();
      break;
    case 'player.quit':
      state.players.delete(msg.uuid); renderPlayers(); updateHeroStats(); updateTopbarStats();
      break;
    case 'plugin.loaded':
      addLog(`[BOTTLE] Loaded: ${msg.name} v${msg.version}`,'info');
      renderPlugins(); updateSidebarStats();
      break;
    case 'offer-ready':
      state.pendingOffer={id:msg.id,offer:msg.offer};
      if ($('offer-code')) $('offer-code').textContent=msg.offer||'(generating...)';
      const os=$('offer-section'); if(os) os.style.display='';
      addLog('WebRTC offer ready — go to Connect tab.','info');
      notify('Offer ready — see Connect tab');
      break;
    case 'stopped': addLog('Server shut down cleanly.','system'); break;
  }
}

function chatToPlain(c) {
  if (typeof c==='string') return c;
  let t=(c.text||'').replace(/§./g,'');
  if (c.extra) for (const x of c.extra) t+=chatToPlain(x);
  return t;
}

// ── UI updates ─────────────────────────────────────────────────
function updateServerControls() {
  const r = state.serverRunning;
  $('btn-start-server').style.display    = r?'none':'';
  $('btn-stop-server').style.display     = r?'':'none';
  $('btn-restart-server').style.display  = r?'':'none';
  $('hero-start').style.display  = r?'none':'';
  $('hero-stop').style.display   = r?'':'none';
  const hs = $('hero-state');
  if (hs) { hs.textContent=r?'RUNNING':'STOPPED'; hs.className='hero-state '+(r?'running':'stopped'); }
  const hst = $('hero-stats'); if(hst) hst.style.display = r?'':'none';
  const tbs = $('topbar-stats'); if(tbs) tbs.style.display = r?'':'none';
  qs('.status-dot')?.classList.toggle('online', r);
  const txt = $('topbar-status'); if(txt) txt.textContent=r?'Running':'Stopped';
}

function updateSidebarStats() {
  const s=state.stats;
  const set=(id,v)=>{ const el=$(id); if(el) el.textContent=v; };
  set('ss-tps',     s.tps     != null ? s.tps.toFixed(1)        : '--');
  set('ss-players', s.players != null ? `${s.players}/${s.max}` : '--');
  set('ss-uptime',  s.uptime  != null ? fmtUptime(s.uptime)     : '--');
  set('ss-plugins', s.plugins != null ? String(s.plugins)       : '--');
  set('world-tps',    s.tps     != null ? s.tps.toFixed(2)        : '--');
  set('world-players',s.players != null ? `${s.players}/${s.max}` : '--');
  set('world-uptime', s.uptime  != null ? fmtUptime(s.uptime)     : '--');
  set('world-tick',   s.tick    != null ? String(s.tick)          : '--');
  set('world-seed',   s.seed    != null ? String(s.seed)          : '--');
  set('world-plugins',s.plugins != null ? String(s.plugins)       : '--');
}

function updateHeroStats() {
  const s=state.stats;
  const set=(id,v)=>{ const el=$(id); if(el) el.textContent=v; };
  set('h-tps',       s.tps     != null ? s.tps.toFixed(1) : '--');
  set('h-players',   s.players != null ? String(s.players): String(state.players.size));
  set('h-maxplayers',s.max     != null ? String(s.max)    : '20');
  set('h-uptime',    s.uptime  != null ? fmtUptime(s.uptime):'--');
  set('h-seed',      s.seed    != null ? String(s.seed)   : '--');
}

function updateTopbarStats() {
  const s=state.stats;
  const set=(id,v)=>{ const el=$(id); if(el) el.textContent=v; };
  set('ts-tps',     s.tps     != null ? s.tps.toFixed(1) : '20.0');
  set('ts-players', s.players != null ? String(s.players) : String(state.players.size));
  set('ts-max',     s.max     != null ? String(s.max)     : '20');
  set('ts-uptime',  s.uptime  != null ? fmtUptime(s.uptime):'0s');
  const dot=$('ts-tps-dot');
  if (dot) dot.style.background = (s.tps != null && s.tps < 15) ? 'var(--red)' : (s.tps != null && s.tps < 18) ? 'var(--yellow)' : 'var(--green)';
}

// ── Players ────────────────────────────────────────────────────
function renderPlayers() {
  const panel=$('players-panel');
  if (!panel) return;
  if (!state.players.size) {
    panel.innerHTML=`<div class="empty-state"><div class="es-icon">[P]</div><strong>No players online</strong><p>Start the server and connect to see players here.</p></div>`;
    return;
  }
  const gm=['Survival','Creative','Adventure','Spectator'];
  panel.innerHTML=[...state.players.values()].map(p=>`
    <div class="player-card">
      <div class="player-avatar">${escHtml((p.username||'?')[0].toUpperCase())}</div>
      <div class="player-info">
        <div class="player-name">${escHtml(p.username)}</div>
        <div class="player-meta">MC ${escHtml(p.version||'?')} &middot; proto ${p.proto||'?'} &middot; ${p.uuid.slice(0,8)}...</div>
        <div class="player-badges">
          ${p.isOp?'<span class="pbadge op">OP</span>':''}
          <span class="pbadge ${['survival','creative','',''][p.gamemode]||'survival'}">${gm[p.gamemode]||gm[0]}</span>
        </div>
      </div>
      <div class="player-actions">
        <button class="act-btn green" onclick="sendCmd('say Hello, ${escHtml(p.username)}!')">Ping</button>
        <button class="act-btn" onclick="sendCmd('op ${escHtml(p.username)}')">OP</button>
        <button class="act-btn" onclick="promptTeleport('${escHtml(p.username)}')">TP</button>
        <button class="act-btn" onclick="promptKitGive('${escHtml(p.username)}')">Kit</button>
        <button class="act-btn red" onclick="sendCmd('kick ${escHtml(p.username)} Kicked by admin')">Kick</button>
      </div>
    </div>`).join('');
}

window.promptTeleport = function(name) {
  const coords=prompt(`Teleport ${name} to (x y z):`,'0 64 0');
  if (!coords) return;
  const [x,y,z]=coords.trim().split(/\s+/);
  if(x&&y&&z) sendCmd(`tp ${name} ${x} ${y} ${z}`);
};
window.promptKitGive = function(name) {
  const kit=prompt(`Give kit to ${name}:`,'starter');
  if(kit) sendCmd(`kit ${kit} ${name}`);
};
window.promptBroadcast = function() {
  const msg=prompt('Broadcast to all players:','');
  if(msg) sendCmd('say '+msg);
};

function sendCmd(cmd) {
  if (!window.serverWorker) { notify('Server not running','warn'); return; }
  window.serverWorker.postMessage({ type:'command', data:cmd });
  addLog('> '+cmd,'system');
}
window.sendCmd = sendCmd;

// ── Start / Stop buttons ───────────────────────────────────────
$('btn-start-server')?.addEventListener('click', startServerWorker);
$('btn-stop-server')?.addEventListener('click', stopServer);
$('btn-restart-server')?.addEventListener('click', restartServer);
$('hero-start')?.addEventListener('click', startServerWorker);
$('hero-stop')?.addEventListener('click', stopServer);

// ── WebRTC ────────────────────────────────────────────────────
$('btn-create-offer')?.addEventListener('click', () => {
  if (!window.serverWorker) { notify('Start the server first','warn'); return; }
  window.serverWorker.postMessage({ type:'create-offer' });
  addLog('Generating WebRTC offer...','info');
});
$('btn-accept-answer')?.addEventListener('click', () => {
  const answer=$('answer-input')?.value.trim();
  if (!answer||!state.pendingOffer) { notify('No pending offer or empty answer','warn'); return; }
  window.serverWorker?.postMessage({ type:'accept-answer', data:{ id:state.pendingOffer.id, answer } });
  addLog('WebRTC answer submitted — connecting...','info');
});

// ── ZIP Download ───────────────────────────────────────────────
$('btn-download-zip')?.addEventListener('click', () => {
  addLog('[ZIP] Generating download...','info');
  notify('Preparing ZIP...');
  const a = document.createElement('a');
  a.href = '/api/download';
  a.download = 'eaglernet-server.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

// ── Built-in plugin loader ─────────────────────────────────────
const BUILTIN_PLUGINS = [
  'nexuslink', 'purityfilter', 'integritycheck',
  'worldsculptor', 'terrainguard', 'voidportal',
  'authshield', 'essentialcraft', 'chatforge',
  'rankengine', 'ecovault', 'tradingpost', 'clanforge',
  'banhammer', 'vaultpack', 'cronmaster', 'welcomemat',
  'tabflair', 'spawnmaster', 'adminspy',
];

async function loadBuiltinPlugins() {
  let loaded = 0;
  for (const name of BUILTIN_PLUGINS) {
    try {
      const resp = await fetch(`plugins/${name}/plugin.js`);
      if (!resp.ok) { console.warn(`[BOTTLE] Plugin ${name} not found (${resp.status})`); continue; }
      const code = await resp.text();
      if (BOTTLE.loadCode(code)) loaded++;
    } catch(e) { console.warn(`[BOTTLE] Error loading ${name}:`, e); }
  }
  addLog(`[BOTTLE] Loaded ${loaded}/${BUILTIN_PLUGINS.length} built-in plugins.`, 'system');
  renderPlugins();
  updateSidebarStats();
}

// ── Init ───────────────────────────────────────────────────────
applyModeUI();
loadConfigTab();
loadBuiltinPlugins();
if (!state.isStaticMode) connectRelay();
updateServerControls();
updatePlayServerHint();
