/**
 * EaglerNet MC Server — Pure Browser Web Worker
 * Protocol: 1.5.2 → 1.12.2 | Plugin API: BOTTLE
 * Runs 100% in the browser. No Node.js for game logic.
 *
 * Message protocol (dashboard ↔ worker):
 *   start          — { config }       start server with config
 *   command        — 'cmd string'     run admin console command
 *   create-offer   — (none)           generate WebRTC offer SDP
 *   accept-answer  — { id, answer }   complete WebRTC connection
 *   get-stats      — (none)           request stats update
 *   load-plugin-code — { code }       execute plugin JS string
 *   load-plugin    — { id, manifest, hooksStr } load pre-parsed plugin
 */
'use strict';

importScripts(
  '../../config.js',
  '../mc/buffer.js',
  '../mc/nbt.js',
  '../mc/noise.js',
  '../mc/blocks.js',
  '../mc/world.js',
  '../mc/chunk.js',
  '../mc/protocol.js',
);

// ── BOTTLE Plugin System (server/worker side) ─────────────
class BOTTLEServer {
  constructor(server) {
    this.server   = server;
    this._plugins = new Map(); // id → { manifest, hooks, enabled }
    this._events  = new Map(); // event → [handler, ...]
  }

  register(manifest, hooks) {
    const id = manifest.id || manifest.name.toLowerCase().replace(/\s+/g,'');
    if (this._plugins.has(id)) return id;
    this._plugins.set(id, { manifest, hooks: hooks||{}, enabled: true, id });
    for (const [evt, fn] of Object.entries(hooks||{})) {
      if (!this._events.has(evt)) this._events.set(evt, []);
      this._events.get(evt).push({ id, fn });
    }
    self.postMessage({ type:'log', level:'info', msg:`[BOTTLE] Loaded: ${manifest.name} v${manifest.version}` });
    self.postMessage({ type:'plugin.loaded', name: manifest.name, version: manifest.version, id });
    return id;
  }

  emit(event, data) {
    for (const { id, fn } of (this._events.get(event)||[])) {
      const p = this._plugins.get(id);
      if (!p?.enabled) continue;
      try {
        const result = fn.call(p.hooks, data);
        if (result === false) return false; // cancelled
      } catch(e) {
        self.postMessage({ type:'log', level:'error', msg:`[BOTTLE:${id}] ${event}: ${e.message}` });
      }
    }
    return true;
  }

  handleCommand(player, cmd, args) {
    for (const [, p] of this._plugins) {
      if (!p.enabled) continue;
      const fn = p.hooks?.command;
      if (fn) { try { if (fn.call(p.hooks, player, cmd, args)) return true; } catch{} }
    }
    return false;
  }

  enable(id)  { const p=this._plugins.get(id); if (p) p.enabled=true; }
  disable(id) { const p=this._plugins.get(id); if (p) p.enabled=false; }
  getList()   {
    return [...this._plugins.values()].map(p=>({
      id: p.id, name: p.manifest.name, version: p.manifest.version,
      enabled: p.enabled, builtin: p.manifest.builtin||false,
    }));
  }

  // Load serialized hook functions (sent from dashboard)
  loadSerialized(id, manifest, hooksStr) {
    const hooks = {};
    for (const [k, fnStr] of Object.entries(hooksStr||{})) {
      try { hooks[k] = new Function('return (' + fnStr + ')')(); } catch{}
    }
    this.register(manifest, hooks);
  }
}

// ── Main Server Class ─────────────────────────────────────
class EaglerNetServer {
  constructor(userConfig) {
    // Merge user config over the base ServerConfig from config.js
    this.config = Object.assign({}, ServerConfig, userConfig, {
      world: Object.assign({}, ServerConfig.world, userConfig?.world),
      bottle: Object.assign({}, ServerConfig.bottle, userConfig?.bottle),
      versions: Object.assign({}, ServerConfig.versions, userConfig?.versions),
      connection: Object.assign({}, ServerConfig.connection, userConfig?.connection),
      performance: Object.assign({}, ServerConfig.performance, userConfig?.performance),
    });

    // World seed: userConfig → ServerConfig → random
    const seed = userConfig?.seed ?? ServerConfig.world?.seed ?? Math.floor(Math.random()*2147483647);
    this.world   = new MCWorld(seed);
    this.players = new Map(); // uuid → PlayerSession
    this.BOTTLE  = new BOTTLEServer(this);
    this._entityId    = 1;
    this._tickCount   = 0;
    this._startTime   = Date.now();
    this._tpsHistory  = [];
    this._peerConns   = new Map();

    self.postMessage({ type:'ready', seed, spawnY: this.world.spawnY });
  }

  start() {
    // Load built-in plugins from config
    this._loadBuiltinPlugins();
    // Tick loop at 20 TPS
    setInterval(() => this._tick(), 50);
    self.postMessage({ type:'log', level:'info', msg:'EaglerNet started (20 TPS)' });
    self.postMessage({ type:'log', level:'info', msg:`World seed: ${this.world.seed}` });
    self.postMessage({ type:'log', level:'info', msg:`Spawn: ${Math.floor(this.world.spawnX)}, ${Math.floor(this.world.spawnY)}, ${Math.floor(this.world.spawnZ)}` });
    self.postMessage({ type:'log', level:'info', msg:`Supported: 1.5.2 → 1.12.2 | Plugin API: BOTTLE` });
  }

  _tick() {
    this._tickCount++;
    this.world.tick();
    this._tpsHistory.push(Date.now());
    while (this._tpsHistory.length > 20) this._tpsHistory.shift();
    this.BOTTLE.emit('server.tick', { tick: this._tickCount });
    if (this._tickCount % 200 === 0) self.postMessage({ type:'stats', data: this.getStats() });
    if (this._tickCount % 400 === 0) {
      for (const p of this.players.values()) p._sendTimeUpdate();
    }
  }

  // ── Built-in plugin loader ────────────────────────────────
  async _loadBuiltinPlugins() {
    const builtins = this.config.bottle?.builtins || {};
    const builtinFiles = {
      eaglercraftxserver: '../../plugins/eaglercraftxserver/plugin.js',
      chatfilter:         '../../plugins/chatfilter/plugin.js',
      anticheat:          '../../plugins/anticheat/plugin.js',
    };

    // Expose BOTTLE globally so plugin files can call BOTTLE.register()
    self.BOTTLE = {
      register: (manifest, hooks) => this.BOTTLE.register(manifest, hooks),
      version:  '1.0.0',
      apiVersion: 2,
    };
    self.EaglerForge = self.BOTTLE; // backward-compat alias

    for (const [id, enabled] of Object.entries(builtins)) {
      if (!enabled || !builtinFiles[id]) continue;
      try {
        importScripts(builtinFiles[id]);
        self.postMessage({ type:'log', level:'info', msg:`[BOTTLE] Auto-loaded builtin: ${id}` });
      } catch(e) {
        self.postMessage({ type:'log', level:'warn', msg:`[BOTTLE] Failed to load builtin '${id}': ${e.message}` });
      }
    }
  }

  // ── WebRTC ────────────────────────────────────────────────
  async createOffer() {
    const pc = new RTCPeerConnection({ iceServers: this.config.connection?.stunServers || [] });
    const peerId = 'peer_' + Math.random().toString(36).slice(2, 8);
    this._peerConns.set(peerId, pc);

    const channel = pc.createDataChannel('mc', { ordered: true });
    channel.binaryType = 'arraybuffer';
    channel.addEventListener('open', () => {
      if (this.players.size >= this.config.maxPlayers) { channel.close(); return; }
      new PlayerSession(channel, this, ++this._entityId);
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    return new Promise(resolve => {
      const done = () => resolve({ id: peerId, offer: pc.localDescription?.sdp || '' });
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') done();
      });
      setTimeout(done, 6000);
    });
  }

  async acceptAnswer(peerId, answerSDP) {
    const pc = this._peerConns.get(peerId);
    if (!pc) throw new Error('Unknown peer: ' + peerId);
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSDP });
  }

  // ── Player lifecycle ──────────────────────────────────────
  onPlayerJoin(session) {
    this.players.set(session.uuid, session);
    // Apply OP status from config
    if ((this.config.admin?.ops || []).includes(session.username)) session.isOp = true;
    // Check whitelist
    if (this.config.admin?.whitelist) {
      const wl = this.config.admin.whitelistedPlayers || [];
      if (!wl.includes(session.username)) {
        session.disconnect('You are not whitelisted on this server.');
        return;
      }
    }
    const msg = { text: session.username + ' joined the game', color:'yellow' };
    this.broadcast(msg);
    for (const other of this.players.values()) {
      other.sendPlayerListAdd(session);
      if (other !== session) session.sendPlayerListAdd(other);
    }
    const result = this.BOTTLE.emit('player.join', { player: session });
    self.postMessage({ type:'player.join', username: session.username, uuid: session.uuid,
      count: this.players.size, proto: session.proto, version: PROTO_NAMES[session.proto]||session.proto });
    self.postMessage({ type:'log', level:'info',
      msg:`${session.username} joined [${PROTO_NAMES[session.proto]||session.proto}] (${this.players.size}/${this.config.maxPlayers})` });
  }

  onPlayerLeave(session) {
    if (!this.players.has(session.uuid)) return;
    this.players.delete(session.uuid);
    this.broadcast({ text: session.username + ' left the game', color:'yellow' });
    for (const other of this.players.values()) other.sendPlayerListRemove(session.uuid);
    this.BOTTLE.emit('player.quit', { player: session });
    self.postMessage({ type:'player.quit', username: session.username, uuid: session.uuid, count: this.players.size });
    self.postMessage({ type:'log', level:'info', msg:`${session.username} left (${this.players.size}/${this.config.maxPlayers})` });
  }

  onChat(session, message) {
    const cancelled = this.BOTTLE.emit('player.chat', { player: session, message }) === false;
    if (cancelled) return;
    const component = { text:'', extra:[
      {text:'<',color:'white'},{text:session.username,color:'yellow'},{text:'> '+message,color:'white'}
    ]};
    this.broadcast(component);
    self.postMessage({ type:'chat', username: session.username, message, time: Date.now() });
  }

  onMove(session, x, y, z) {
    this.BOTTLE.emit('player.move', { player: session, x, y, z });
  }

  broadcast(component) {
    for (const p of this.players.values()) p.sendChatMessage(component, 0);
    self.postMessage({ type:'broadcast', message: JSON.stringify(component) });
  }

  handleCommand(session, cmd) {
    const parts = cmd.replace(/^\//,'').split(/\s+/);
    const name = parts[0].toLowerCase(), args = parts.slice(1);
    const send = (msg) => session.sendChatMessage({ text: msg }, 1);

    switch(name) {
      case 'help':
        send('§aCommands: §7/help /tps /players /seed /version /gamemode /tp /kick /say /op /plugins /bottle');
        return;
      case 'tps':
        send(`§aTPS: §f${this.getTPS().toFixed(2)} §7| Uptime: §f${this._fmtUptime(Date.now()-this._startTime)}`);
        return;
      case 'players': {
        const list = [...this.players.values()].map(p=>`${p.username}§7[${PROTO_NAMES[p.proto]||p.proto}]`).join(', ');
        send(`§aOnline §7(${this.players.size}/${this.config.maxPlayers}): §f${list||'none'}`);
        return;
      }
      case 'seed':  send(`§aSeed: §f${this.world.seed}`); return;
      case 'version': send(`§aEaglerNet §f1.12.2 §7| BOTTLE §f${self.BOTTLE?.version||'1.0.0'} §7| Protocol §f${session.proto} §7(${PROTO_NAMES[session.proto]||'?'})`); return;
      case 'gamemode': {
        if (!session.isOp) { send('§cNo permission.'); return; }
        const gm = parseInt(args[0]);
        if (isNaN(gm)||gm<0||gm>3) { send('§cUsage: /gamemode <0-3>'); return; }
        session.gamemode=gm; session._sendPlayerAbilities();
        send(`§aGamemode: §f${['Survival','Creative','Adventure','Spectator'][gm]}`);
        return;
      }
      case 'tp':
        if (args.length>=3) { session.teleport(parseFloat(args[0]),parseFloat(args[1]),parseFloat(args[2])); send('§aTeleported!'); }
        else send('§cUsage: /tp <x> <y> <z>');
        return;
      case 'kick': {
        if (!session.isOp) { send('§cNo permission.'); return; }
        const t=[...this.players.values()].find(p=>p.username.toLowerCase()===args[0]?.toLowerCase());
        t ? (t.kick(args.slice(1).join(' ')||'Kicked'), send(`§aKicked ${t.username}`)) : send('§cPlayer not found');
        return;
      }
      case 'say':   this.broadcast({text:'[Server] '+args.join(' '),color:'gray'}); return;
      case 'op':    if (!session.isOp) { send('§cNo permission.'); return; }
        const ot=[...this.players.values()].find(p=>p.username.toLowerCase()===args[0]?.toLowerCase());
        if (ot) { ot.isOp=true; ot.sendChatMessage({text:'§aYou are now an operator'},1); send(`§aOpped ${ot.username}`); }
        return;
      case 'plugins':
      case 'bottle':
        const list = this.BOTTLE.getList().map(p=>`${p.enabled?'§a':'§c'}${p.name}§7 v${p.version}${p.builtin?' §8[builtin]':''}`).join('\n');
        send('§6BOTTLE Plugins:\n' + (list||'§7none'));
        return;
      default:
        if (!this.BOTTLE.handleCommand(session, name, args)) {
          send(`§cUnknown command: /${name}. Try /help`);
        }
    }
  }

  // ── Admin console commands (from dashboard) ───────────────
  adminCommand(cmd) {
    const parts = cmd.replace(/^\//,'').split(/\s+/);
    const name = parts[0].toLowerCase(), args = parts.slice(1);
    const log = (m) => self.postMessage({ type:'log', level:'info', msg: m });

    switch(name) {
      case 'say':  this.broadcast({text:'[Server] '+args.join(' '),color:'gray'}); log(`[Console] say ${args.join(' ')}`); break;
      case 'kick': {
        const t=[...this.players.values()].find(p=>p.username.toLowerCase()===args[0]?.toLowerCase());
        if (t) t.kick(args.slice(1).join(' ')||'Kicked by server');
        log(t?`Kicked ${t.username}`:'Player not found');
        break;
      }
      case 'op': {
        const t=[...this.players.values()].find(p=>p.username.toLowerCase()===args[0]?.toLowerCase());
        if (t) { t.isOp=true; t.sendChatMessage({text:'§aYou are now an operator'},1); log(`Opped ${t.username}`); }
        break;
      }
      case 'deop': {
        const t=[...this.players.values()].find(p=>p.username.toLowerCase()===args[0]?.toLowerCase());
        if (t) { t.isOp=false; log(`De-opped ${t.username}`); }
        break;
      }
      case 'tps': log(`TPS: ${this.getTPS().toFixed(2)} | Uptime: ${this._fmtUptime(Date.now()-this._startTime)}`); break;
      case 'list': log(`Players (${this.players.size}/${this.config.maxPlayers}): ${[...this.players.values()].map(p=>p.username).join(', ')||'none'}`); break;
      case 'seed': log(`World seed: ${this.world.seed}`); break;
      case 'plugins': case 'bottle':
        log('BOTTLE Plugins: ' + this.BOTTLE.getList().map(p=>`${p.name} v${p.version}${p.enabled?'':' [disabled]'}`).join(', '));
        break;
      case 'stats': self.postMessage({type:'stats',data:this.getStats()}); break;
      case 'stop':
        for (const p of this.players.values()) p.disconnect('Server shutting down');
        self.postMessage({type:'stopped'});
        break;
      default:
        self.postMessage({type:'log',level:'warn',msg:`Unknown command: ${cmd}`});
    }
  }

  getTPS() {
    if (this._tpsHistory.length < 2) return 20;
    const e = this._tpsHistory[this._tpsHistory.length-1] - this._tpsHistory[0];
    return Math.min(20, Math.round((this._tpsHistory.length-1)/(e/1000)*100)/100);
  }

  getStats() {
    return {
      tps:     this.getTPS(),
      uptime:  Date.now()-this._startTime,
      tick:    this._tickCount,
      players: this.players.size,
      max:     this.config.maxPlayers,
      seed:    this.world.seed,
      motd:    this.config.motd,
      versions: '1.5.2 → 1.12.2',
      plugins: this.BOTTLE.getList().length,
    };
  }

  _fmtUptime(ms) {
    const s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60);
    return h>0?`${h}h ${m%60}m`:m>0?`${m}m ${s%60}s`:`${s}s`;
  }
}

// ── Worker message handler ─────────────────────────────────
let server;

self.addEventListener('message', async (e) => {
  const { type, data } = e.data || {};
  switch(type) {
    case 'start':
      server = new EaglerNetServer(data);
      server.start();
      break;
    case 'command':
      server?.adminCommand(data);
      break;
    case 'create-offer': {
      const r = await server?.createOffer();
      self.postMessage({ type:'offer-ready', id: r?.id, offer: r?.offer });
      break;
    }
    case 'accept-answer':
      await server?.acceptAnswer(data.id, data.answer);
      self.postMessage({ type:'log', level:'info', msg:`WebRTC answer accepted for ${data.id}` });
      break;
    case 'get-stats':
      self.postMessage({ type:'stats', data: server?.getStats() });
      break;
    case 'load-plugin-code': {
      // Execute raw plugin JS in worker context (BOTTLE.register available)
      if (!server) break;
      try {
        const fn = new Function('BOTTLE', 'EaglerForge', data.code);
        fn(self.BOTTLE, self.BOTTLE);
      } catch(e) {
        self.postMessage({ type:'log', level:'error', msg:`[BOTTLE] Plugin error: ${e.message}` });
      }
      break;
    }
    case 'load-plugin': {
      // Pre-parsed manifest + serialized hook functions
      if (!server) break;
      server.BOTTLE.loadSerialized(data.id, data.manifest, data.hooksStr);
      break;
    }
  }
});
