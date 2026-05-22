/**
 * BOTTLE — EaglerNet Plugin Loader v3
 * ─────────────────────────────────────────────────────────────
 * Bukkit-style plugin API for EaglerNet browser servers.
 *
 * BOTTLE.register(manifest, hooks) → { config, on, off }
 *
 * Manifest fields:
 *   id, name, version, description, author, builtin?,
 *   config?: { key: { type, label, default, options? } }
 *
 * Event hooks (all cancellable events return false to cancel):
 *   'player.join'    { player }
 *   'player.quit'    { player }
 *   'player.chat'    { player, message }   → return false to cancel
 *   'player.move'    { player, x, y, z, yaw, pitch }
 *   'player.command' { player, cmd, args } → return false to cancel
 *   'block.break'    { player, x, y, z, blockId } → return false to cancel
 *   'block.place'    { player, x, y, z, blockId } → return false to cancel
 *   'server.tick'    { tick }
 *   'server.ready'   { seed, spawnY }
 *
 * Player API:
 *   player.username, .uuid, .entityId, .gamemode, .health,
 *   .x, .y, .z, .isOp, .world
 *   player.sendMessage(text)       — plain-text chat message
 *   player.sendRaw(component)      — raw JSON chat component
 *   player.kick(reason)
 *   player.teleport(x, y, z)
 *   player.setGamemode(0-3)
 *   player.setHealth(0-20)
 *   player.op() / player.deop()
 *
 * Server API:
 *   BOTTLE.broadcast(text)
 *   BOTTLE.getPlayers()
 *   BOTTLE.getPlayer(name)
 *   BOTTLE.getWorld()              — default world
 *   BOTTLE.schedule(fn, ticks)     — run fn after N ticks
 *   BOTTLE.repeat(fn, period)      — run fn every N ticks → id
 *   BOTTLE.cancel(id)              — cancel scheduled task
 *   BOTTLE.version  = '3.0.0'
 *   BOTTLE.apiVersion = 3
 *   BOTTLE.log(msg, level)
 *
 * Config API (main-thread only, auto-persisted to localStorage):
 *   plugin.config.get(key)
 *   plugin.config.set(key, value)
 *   plugin.config.getAll()
 *   plugin.config.schema()
 *   plugin.config.reset()
 *
 * Virtual File System (main-thread only):
 *   BOTTLE.vfs.register(path, { read, write? })
 *   BOTTLE.vfs.read(path)
 *   BOTTLE.vfs.write(path, content)
 *   BOTTLE.vfs.list()
 */

'use strict';

// ══════════════════════════════════════════════════════════════
//  PluginConfig — localStorage-backed per-plugin config store
// ══════════════════════════════════════════════════════════════
class PluginConfig {
  constructor(id, schema = {}) {
    this._id  = id;
    this._sch = schema;
    this._key = 'eaglernet_cfg_' + id;
    try { this._d = JSON.parse(localStorage.getItem(this._key) || '{}'); }
    catch { this._d = {}; }
  }
  get(k)       { return this._d[k] !== undefined ? this._d[k] : this._sch[k]?.default; }
  set(k, v)    {
    this._d[k] = v;
    try { localStorage.setItem(this._key, JSON.stringify(this._d)); } catch {}
    window.serverWorker?.postMessage({ type:'plugin-config', data:{ id:this._id, k, v } });
    window.BOTTLE?.emit('plugin:config-changed', { id:this._id, k, v });
  }
  getAll()     { const o={}; for(const k of Object.keys(this._sch)) o[k]=this.get(k); return o; }
  schema()     { return this._sch; }
  reset()      { this._d={}; try{ localStorage.removeItem(this._key); }catch{} }
  toJSON()     { return this.getAll(); }
}

// ══════════════════════════════════════════════════════════════
//  Virtual File System
// ══════════════════════════════════════════════════════════════
class VirtualFS {
  constructor() { this._files = new Map(); }
  register(path, handler) { this._files.set(path, handler); }
  read(path)    { return this._files.get(path)?.read?.() ?? null; }
  write(path, content) { return this._files.get(path)?.write?.(content) ?? false; }
  list()        { return [...this._files.keys()]; }
  exists(path)  { return this._files.has(path); }
  canWrite(path){ return typeof this._files.get(path)?.write === 'function'; }
}

// ══════════════════════════════════════════════════════════════
//  Main-thread BOTTLE implementation
// ══════════════════════════════════════════════════════════════
if (typeof window !== 'undefined') {
  const _plugins   = new Map();
  const _listeners = new Map();
  const _tasks     = new Map();
  let   _taskId    = 0;
  const _vfs       = new VirtualFS();

  // Server-properties virtual file (wired up after dashboard loads)
  const _sprops = (() => {
    const KEY = 'eaglernet_server_props';
    const DEFAULTS = {
      'server-name':       'EaglerNet',
      'motd':              '§aEaglerNet §7| MC 1.5.2–1.12.2 Browser Server',
      'max-players':       '20',
      'gamemode':          '0',
      'difficulty':        '1',
      'pvp':               'true',
      'spawn-protection':  '16',
      'view-distance':     '8',
      'allow-flight':      'false',
      'whitelist':         'false',
      'online-mode':       'false',
      'spawn-animals':     'true',
      'spawn-monsters':    'true',
      'generate-structures': 'true',
      'level-seed':        '',
      'level-type':        'DEFAULT',
      'level-name':        'world',
      'enable-command-block': 'false',
      'announce-player-achievements': 'true',
      'force-gamemode':    'false',
      'hardcore':          'false',
      'max-world-size':    '29999984',
    };
    let _d = null;
    function load() {
      if (_d) return _d;
      try { _d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch{}
      if (!_d) _d = { ...DEFAULTS };
      return _d;
    }
    return {
      get(k)   { return load()[k] ?? DEFAULTS[k] ?? ''; },
      set(k,v) { const d=load(); d[k]=v; localStorage.setItem(KEY, JSON.stringify(d)); },
      getAll() { return { ...DEFAULTS, ...load() }; },
      defaults(){ return { ...DEFAULTS }; },
      reset()  { _d=null; localStorage.removeItem(KEY); },
    };
  })();

  const BOTTLE_IMPL = {
    version:    '3.0.0',
    apiVersion: 3,

    // ── Registration ──────────────────────────────────────
    register(manifest, hooks) {
      const id = manifest.id || manifest.name.toLowerCase().replace(/\s+/g, '-');
      if (_plugins.has(id)) {
        console.warn(`[BOTTLE] Plugin '${id}' already registered`);
        return _plugins.get(id)._handle;
      }
      const schema = manifest.config || {};
      const cfg    = new PluginConfig(id, schema);
      const entry  = { manifest, hooks, enabled: true, id, cfg };
      _plugins.set(id, entry);

      // Register virtual config file
      _vfs.register(`plugins/${manifest.name}/config.json`, {
        read:  () => JSON.stringify(cfg.getAll(), null, 2),
        write: (content) => {
          try {
            const obj = JSON.parse(content);
            for (const [k, v] of Object.entries(obj)) cfg.set(k, v);
            return true;
          } catch { return false; }
        },
      });

      // Forward hooks to server worker if it's running
      if (window.serverWorker) this._sendToWorker(id, manifest, hooks, cfg.getAll());
      this.emit('plugin:loaded', { id, name: manifest.name });
      console.info(`[BOTTLE] Loaded: ${manifest.name} v${manifest.version}`);

      const handle = { config: cfg, id };
      entry._handle = handle;
      return handle;
    },

    _sendToWorker(id, manifest, hooks, config) {
      const hooksStr = {};
      for (const [k, v] of Object.entries(hooks || {})) {
        if (typeof v === 'function') hooksStr[k] = v.toString();
      }
      window.serverWorker?.postMessage({
        type: 'load-plugin',
        data: { id, manifest, hooksStr, config },
      });
    },

    // ── Event bus ────────────────────────────────────────
    on(event, handler) {
      if (!_listeners.has(event)) _listeners.set(event, new Set());
      _listeners.get(event).add(handler);
    },
    off(event, handler) { _listeners.get(event)?.delete(handler); },
    emit(event, data) {
      let cancelled = false;
      for (const h of (_listeners.get(event) || [])) {
        try { if (h(data) === false) cancelled = true; } catch(e) { console.warn('[BOTTLE event]', e); }
      }
      return !cancelled;
    },

    // ── Plugin list ──────────────────────────────────────
    getPlugins() {
      return [..._plugins.values()].map(p => ({
        id:          p.id,
        name:        p.manifest.name,
        version:     p.manifest.version,
        description: p.manifest.description || '',
        author:      p.manifest.author || 'EaglerNet',
        enabled:     p.enabled,
        builtin:     p.manifest.builtin !== false,
        config:      p.cfg,
        configSchema: p.manifest.config || {},
      }));
    },

    toggle(id) {
      const p = _plugins.get(id);
      if (!p) return false;
      p.enabled = !p.enabled;
      window.serverWorker?.postMessage({ type:'plugin-toggle', data:{ id, enabled: p.enabled } });
      return p.enabled;
    },

    getConfig(id) { return _plugins.get(id)?.cfg ?? null; },

    // ── Server commands ───────────────────────────────────
    broadcast(text) {
      window.serverWorker?.postMessage({ type:'command', data:'say ' + text });
    },
    getPlayers() { return window._BOTTLE_players ? [...window._BOTTLE_players.values()] : []; },
    getPlayer(name) {
      return window._BOTTLE_players
        ? [...window._BOTTLE_players.values()].find(p => p.username === name) ?? null
        : null;
    },

    // ── Plugin code loading ───────────────────────────────
    loadCode(code) {
      try {
        const fn = new Function('BOTTLE', 'EaglerForge', code);
        fn(this, this);
        return true;
      } catch(e) {
        console.error('[BOTTLE] Plugin load error:', e);
        return false;
      }
    },
    loadAndSend(code) {
      this.loadCode(code);
      window.serverWorker?.postMessage({ type:'load-plugin-code', data:{ code } });
    },

    // ── Virtual File System ───────────────────────────────
    vfs: _vfs,

    // ── Server Properties ─────────────────────────────────
    serverProps: _sprops,

    // ── Log ───────────────────────────────────────────────
    log(msg, level='info') {
      if (typeof window.addLog === 'function') window.addLog('[BOTTLE] ' + msg, level);
      else console.log('[BOTTLE]', msg);
    },
  };

  // Register core virtual files
  _vfs.register('server.properties', {
    read: () => {
      const all = _sprops.getAll();
      return Object.entries(all).map(([k,v]) => `${k}=${v}`).join('\n');
    },
    write: (content) => {
      for (const line of content.split('\n')) {
        const eq = line.indexOf('=');
        if (eq < 0 || line.startsWith('#')) continue;
        const k = line.slice(0, eq).trim();
        const v = line.slice(eq+1).trim();
        if (k) _sprops.set(k, v);
      }
      return true;
    },
  });
  _vfs.register('ops.json', {
    read: () => JSON.stringify(JSON.parse(localStorage.getItem('eaglernet_ops')||'[]'), null, 2),
    write: (c) => { try{ localStorage.setItem('eaglernet_ops', c); return true; }catch{ return false; } },
  });
  _vfs.register('whitelist.json', {
    read: () => JSON.stringify(JSON.parse(localStorage.getItem('eaglernet_whitelist')||'[]'), null, 2),
    write: (c) => { try{ localStorage.setItem('eaglernet_whitelist', c); return true; }catch{ return false; } },
  });
  _vfs.register('banned-players.json', {
    read: () => JSON.stringify(JSON.parse(localStorage.getItem('eaglernet_bans')||'[]'), null, 2),
    write: (c) => { try{ localStorage.setItem('eaglernet_bans', c); return true; }catch{ return false; } },
  });
  _vfs.register('banned-ips.json', {
    read: () => JSON.stringify(JSON.parse(localStorage.getItem('eaglernet_ipbans')||'[]'), null, 2),
    write: (c) => { try{ localStorage.setItem('eaglernet_ipbans', c); return true; }catch{ return false; } },
  });

  window.BOTTLE    = BOTTLE_IMPL;
  window.EaglerForge = BOTTLE_IMPL; // compat alias
}
