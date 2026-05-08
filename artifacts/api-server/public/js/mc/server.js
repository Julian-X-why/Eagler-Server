/**
 * EaglerNet MC Server — Pure Browser Web Worker
 * Protocol: 1.5.2 → 1.12.2  |  Plugin API: BOTTLE
 * Runs 100% in the browser. No Node.js for game logic.
 *
 * Transport options:
 *   1. WebRTC DataChannel   — peer-to-peer (EaglercraftX LAN)
 *   2. WS Relay ProxyChannel — relayed through the Node.js WS bridge
 *      so players can connect by IP address from the same network.
 *
 * Worker message protocol (dashboard ↔ worker):
 *   start               → { config }
 *   command             → 'cmd string'
 *   create-offer        → (none)
 *   accept-answer       → { id, answer }
 *   get-stats           → (none)
 *   load-plugin-code    → { code }
 *   load-plugin         → { id, manifest, hooksStr }
 *   ws-player-connect   → { id, ip }
 *   ws-player-data      → { id, data: ArrayBuffer }
 *   ws-player-disconnect→ { id }
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

// ── ProxyChannel — fake DataChannel that routes via postMessage ──
// The main thread relays raw bytes through the Node.js WS relay
// so players can connect by IP without WebRTC.
class ProxyChannel {
  constructor(playerId) {
    this.playerId    = playerId;
    this.readyState  = 'open';
    this._handlers   = { message: [], close: [], error: [] };
  }
  send(buffer) {
    // buffer may be an ArrayBuffer or Uint8Array — normalise
    const ab = buffer instanceof ArrayBuffer ? buffer
             : (buffer instanceof Uint8Array ? buffer.buffer : new Uint8Array(buffer).buffer);
    self.postMessage({ type: 'ws-send', id: this.playerId, data: ab }, [ab]);
  }
  close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    self.postMessage({ type: 'ws-disconnect', id: this.playerId });
  }
  addEventListener(evt, fn)    { (this._handlers[evt] = this._handlers[evt]||[]).push(fn); }
  removeEventListener(evt, fn) { this._handlers[evt] = (this._handlers[evt]||[]).filter(f=>f!==fn); }
  // Called by the worker event handler to push incoming data
  _receive(data) {
    const e = { data };
    for (const fn of this._handlers.message||[]) fn(e);
  }
  _close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    for (const fn of this._handlers.close||[]) fn({});
  }
}

// ── BOTTLE Plugin System (server/worker side) ────────────────
class BOTTLEServer {
  constructor(server) {
    this.server   = server;
    this._plugins = new Map();
    this._events  = new Map();
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
      try { const r = fn.call(p.hooks, data); if (r === false) return false; } catch(e) {
        self.postMessage({ type:'log', level:'error', msg:`[BOTTLE:${id}] ${event}: ${e.message}` });
      }
    }
    return true;
  }
  handleCommand(player, cmd, args) {
    for (const [, p] of this._plugins) {
      if (!p.enabled) continue;
      try { if (p.hooks?.command?.call(p.hooks, player, cmd, args)) return true; } catch{}
    }
    return false;
  }
  enable(id)  { const p=this._plugins.get(id); if(p) p.enabled=true; }
  disable(id) { const p=this._plugins.get(id); if(p) p.enabled=false; }
  getList()   {
    return [...this._plugins.values()].map(p=>({
      id:p.id, name:p.manifest.name, version:p.manifest.version,
      enabled:p.enabled, builtin:p.manifest.builtin||false,
    }));
  }
  loadSerialized(id, manifest, hooksStr) {
    const hooks = {};
    for (const [k, fnStr] of Object.entries(hooksStr||{})) {
      try { hooks[k] = new Function('return (' + fnStr + ')')(); } catch{}
    }
    this.register(manifest, hooks);
  }
}

// ── Main Server ──────────────────────────────────────────────
class EaglerNetServer {
  constructor(userConfig) {
    this.config = Object.assign({}, ServerConfig, userConfig, {
      world:       Object.assign({}, ServerConfig.world,       userConfig?.world),
      bottle:      Object.assign({}, ServerConfig.bottle,      userConfig?.bottle),
      versions:    Object.assign({}, ServerConfig.versions,    userConfig?.versions),
      connection:  Object.assign({}, ServerConfig.connection,  userConfig?.connection),
      performance: Object.assign({}, ServerConfig.performance, userConfig?.performance),
    });
    const seed = userConfig?.seed ?? ServerConfig.world?.seed ?? Math.floor(Math.random()*2147483647);
    this.world       = new MCWorld(seed);
    this.players     = new Map();   // uuid → PlayerSession
    this._proxyChans = new Map();   // wsPlayerId → ProxyChannel
    this.BOTTLE      = new BOTTLEServer(this);
    this._entityId   = 1;
    this._tickCount  = 0;
    this._startTime  = Date.now();
    this._tpsHistory = [];
    this._peerConns  = new Map();
    self.postMessage({ type:'ready', seed, spawnY: this.world.spawnY });
  }

  start() {
    this._loadBuiltinPlugins();
    setInterval(() => this._tick(), 50);
    self.postMessage({ type:'log', level:'info', msg:'EaglerNet started (20 TPS)' });
    self.postMessage({ type:'log', level:'info', msg:`World seed: ${this.world.seed}` });
    self.postMessage({ type:'log', level:'info', msg:`Spawn: ${Math.floor(this.world.spawnX)}, ${Math.floor(this.world.spawnY)}, ${Math.floor(this.world.spawnZ)}` });
    self.postMessage({ type:'log', level:'info', msg:`Supported: 1.5.2 → 1.12.2 | Plugin API: BOTTLE | WS relay: active` });
  }

  _tick() {
    this._tickCount++;
    this.world.tick();
    this._tpsHistory.push(Date.now());
    while (this._tpsHistory.length > 20) this._tpsHistory.shift();
    this.BOTTLE.emit('server.tick', { tick: this._tickCount });
    if (this._tickCount % 200 === 0) self.postMessage({ type:'stats', data: this.getStats() });
    if (this._tickCount % 400 === 0) for (const p of this.players.values()) p._sendTimeUpdate();
  }

  // ── WS relay — called from worker message handler ─────────
  onWsPlayerConnect(wsId, ip) {
    const chan = new ProxyChannel(wsId);
    this._proxyChans.set(wsId, chan);
    const session = new PlayerSession(chan, this, ++this._entityId);
    // Store wsId on session for clean-up
    session._wsId = wsId;
    self.postMessage({ type:'log', level:'info', msg:`WS player connecting from ${ip} [${wsId}]` });
  }

  onWsPlayerData(wsId, data) {
    const chan = this._proxyChans.get(wsId);
    if (chan) chan._receive(data);
  }

  onWsPlayerDisconnect(wsId) {
    const chan = this._proxyChans.get(wsId);
    if (chan) { chan._close(); this._proxyChans.delete(wsId); }
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
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState==='complete') done(); });
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
    if ((this.config.admin?.ops||[]).includes(session.username)) session.isOp = true;
    if (this.config.admin?.whitelist) {
      if (!(this.config.admin.whitelistedPlayers||[]).includes(session.username)) {
        session.disconnect('You are not whitelisted on this server.'); return;
      }
    }
    this.broadcast({ text: session.username + ' joined the game', color:'yellow' });
    for (const other of this.players.values()) {
      other.sendPlayerListAdd(session);
      if (other !== session) session.sendPlayerListAdd(other);
    }
    this.BOTTLE.emit('player.join', { player: session });
    self.postMessage({ type:'player.join', username:session.username, uuid:session.uuid,
      count:this.players.size, proto:session.proto, version:PROTO_NAMES[session.proto]||session.proto });
    self.postMessage({ type:'log', level:'info',
      msg:`${session.username} joined [${PROTO_NAMES[session.proto]||session.proto}] (${this.players.size}/${this.config.maxPlayers})` });
  }

  onPlayerLeave(session) {
    if (!this.players.has(session.uuid)) return;
    this.players.delete(session.uuid);
    // Also clean up proxy channel if this was a WS player
    if (session._wsId) this._proxyChans.delete(session._wsId);
    this.broadcast({ text: session.username + ' left the game', color:'yellow' });
    for (const other of this.players.values()) other.sendPlayerListRemove(session.uuid);
    this.BOTTLE.emit('player.quit', { player: session });
    self.postMessage({ type:'player.quit', username:session.username, uuid:session.uuid, count:this.players.size });
    self.postMessage({ type:'log', level:'info', msg:`${session.username} left (${this.players.size}/${this.config.maxPlayers})` });
  }

  onChat(session, message) {
    const ok = this.BOTTLE.emit('player.chat', { player: session, message });
    if (ok === false) return;
    const component = { text:'', extra:[
      {text:'<',color:'white'},{text:session.username,color:'yellow'},{text:'> '+message,color:'white'}
    ]};
    this.broadcast(component);
    self.postMessage({ type:'chat', username:session.username, message, time:Date.now() });
  }

  onMove(session, x, y, z) { this.BOTTLE.emit('player.move', { player: session, x, y, z }); }

  broadcast(component) {
    for (const p of this.players.values()) p.sendChatMessage(component, 0);
    self.postMessage({ type:'broadcast', message: JSON.stringify(component) });
  }

  handleCommand(session, cmd) {
    const parts = cmd.replace(/^\//,'').split(/\s+/);
    const name = parts[0].toLowerCase(), args = parts.slice(1);
    const send  = (msg) => session.sendChatMessage({ text: msg }, 1);
    switch(name) {
      case 'help':   send('§aCommands: §7/help /tps /players /seed /version /gamemode /tp /kick /say /op /plugins /bottle'); return;
      case 'tps':    send(`§aTPS: §f${this.getTPS().toFixed(2)} §7| Uptime: §f${this._fmtUptime(Date.now()-this._startTime)}`); return;
      case 'players': {
        const list=[...this.players.values()].map(p=>`${p.username}§7[${PROTO_NAMES[p.proto]||p.proto}]`).join(', ');
        send(`§aOnline §7(${this.players.size}/${this.config.maxPlayers}): §f${list||'none'}`); return;
      }
      case 'seed':    send(`§aSeed: §f${this.world.seed}`); return;
      case 'version': send(`§aEaglerNet §f1.12.2 §7| BOTTLE §f${self.BOTTLE?.version||'1.0.0'} §7| Proto §f${session.proto} §7(${PROTO_NAMES[session.proto]||'?'})`); return;
      case 'gamemode': {
        if (!session.isOp) { send('§cNo permission.'); return; }
        const gm=parseInt(args[0]); if(isNaN(gm)||gm<0||gm>3){send('§cUsage: /gamemode <0-3>');return;}
        session.gamemode=gm; session._sendPlayerAbilities();
        send(`§aGamemode: §f${['Survival','Creative','Adventure','Spectator'][gm]}`); return;
      }
      case 'tp':
        if (args.length>=3) { session.teleport(parseFloat(args[0]),parseFloat(args[1]),parseFloat(args[2])); send('§aTeleported!'); }
        else send('§cUsage: /tp <x> <y> <z>'); return;
      case 'kick': {
        if (!session.isOp) { send('§cNo permission.'); return; }
        const t=[...this.players.values()].find(p=>p.username.toLowerCase()===args[0]?.toLowerCase());
        t ? (t.kick(args.slice(1).join(' ')||'Kicked'), send(`§aKicked ${t.username}`)) : send('§cPlayer not found'); return;
      }
      case 'say':    this.broadcast({text:'[Server] '+args.join(' '),color:'gray'}); return;
      case 'op': {
        if (!session.isOp) { send('§cNo permission.'); return; }
        const t=[...this.players.values()].find(p=>p.username.toLowerCase()===args[0]?.toLowerCase());
        if (t) { t.isOp=true; t.sendChatMessage({text:'§aYou are now an operator'},1); send(`§aOpped ${t.username}`); } return;
      }
      case 'plugins': case 'bottle':
        send('§6BOTTLE Plugins:\n'+this.BOTTLE.getList().map(p=>`${p.enabled?'§a':'§c'}${p.name}§7 v${p.version}${p.builtin?' §8[builtin]':''}`).join('\n')); return;
      default:
        if (!this.BOTTLE.handleCommand(session, name, args)) send(`§cUnknown command: /${name}. Try /help`);
    }
  }

  adminCommand(cmd) {
    const parts=cmd.replace(/^\//,'').split(/\s+/), name=parts[0].toLowerCase(), args=parts.slice(1);
    const log=(m)=>self.postMessage({type:'log',level:'info',msg:m});
    switch(name) {
      case 'say':   this.broadcast({text:'[Server] '+args.join(' '),color:'gray'}); log(`[Console] say ${args.join(' ')}`); break;
      case 'kick': {
        const t=[...this.players.values()].find(p=>p.username.toLowerCase()===args[0]?.toLowerCase());
        if(t) t.kick(args.slice(1).join(' ')||'Kicked by server');
        log(t?`Kicked ${t.username}`:'Player not found'); break;
      }
      case 'op': {
        const t=[...this.players.values()].find(p=>p.username.toLowerCase()===args[0]?.toLowerCase());
        if(t){t.isOp=true;t.sendChatMessage({text:'§aYou are now an operator'},1);log(`Opped ${t.username}`);} break;
      }
      case 'deop': {
        const t=[...this.players.values()].find(p=>p.username.toLowerCase()===args[0]?.toLowerCase());
        if(t){t.isOp=false;log(`De-opped ${t.username}`);}break;
      }
      case 'tps':    log(`TPS: ${this.getTPS().toFixed(2)} | Uptime: ${this._fmtUptime(Date.now()-this._startTime)}`); break;
      case 'list':   log(`Players (${this.players.size}/${this.config.maxPlayers}): ${[...this.players.values()].map(p=>p.username).join(', ')||'none'}`); break;
      case 'seed':   log(`World seed: ${this.world.seed}`); break;
      case 'plugins': case 'bottle':
        log('BOTTLE Plugins: '+this.BOTTLE.getList().map(p=>`${p.name} v${p.version}${p.enabled?'':' [disabled]'}`).join(', ')); break;
      case 'stats':  self.postMessage({type:'stats',data:this.getStats()}); break;
      case 'stop':
        for(const p of this.players.values()) p.disconnect('Server shutting down');
        self.postMessage({type:'stopped'}); break;
      default: self.postMessage({type:'log',level:'warn',msg:`Unknown command: ${cmd}`});
    }
  }

  // ── Block update broadcasting ─────────────────────────────
  // updates: [{x, y, z, stateId}]
  broadcastBlockUpdates(updates) {
    if (!updates?.length) return;
    // Group by chunk so we can decide resend vs individual packets
    const byChunk = new Map();
    for (const u of updates) {
      const key = `${Math.floor(u.x/16)},${Math.floor(u.z/16)}`;
      if (!byChunk.has(key)) byChunk.set(key, []);
      byChunk.get(key).push(u);
    }
    for (const [key, chunkUpdates] of byChunk) {
      const [cx, cz] = key.split(',').map(Number);
      const chunk = this.world.getOrGenerateChunk(cx, cz);
      if (chunkUpdates.length > 256) {
        // Re-send whole chunk for large operations
        const pkt = buildChunkPacket(chunk);
        for (const player of this.players.values()) {
          const pcx = Math.floor(player.x/16), pcz = Math.floor(player.z/16);
          const dist = Math.max(Math.abs(pcx-cx), Math.abs(pcz-cz));
          if (dist <= (this.config.performance?.chunkRadius ?? 5) + 2) {
            player._sendRaw(pkt);
          }
        }
      } else {
        // Send individual block change packets (0x0B / 0x23 depending on version)
        for (const u of chunkUpdates) {
          const pos = this._encodePosition(u.x, u.y, u.z);
          for (const player of this.players.values()) {
            const pcx = Math.floor(player.x/16), pcz = Math.floor(player.z/16);
            const dist = Math.max(Math.abs(Math.floor(u.x/16)-pcx), Math.abs(Math.floor(u.z/16)-pcz));
            if (dist <= (this.config.performance?.chunkRadius ?? 5) + 2) {
              player._sendBlockChange(u.x, u.y, u.z, u.stateId);
            }
          }
        }
      }
    }
  }

  _encodePosition(x, y, z) {
    const bx = BigInt(x & 0x3FFFFFF), by = BigInt(y & 0xFFF), bz = BigInt(z & 0x3FFFFFF);
    return (bx << 38n) | (by << 26n) | bz;
  }

  _loadBuiltinPlugins() {
    const builtins = this.config.bottle?.builtins || {};
    const files = {
      eaglercraftxserver: '../../plugins/eaglercraftxserver/plugin.js',
      chatfilter:         '../../plugins/chatfilter/plugin.js',
      anticheat:          '../../plugins/anticheat/plugin.js',
      worldedit:          '../../plugins/worldedit/plugin.js',
      worldguard:         '../../plugins/worldguard/plugin.js',
      multiverse:         '../../plugins/multiverse/plugin.js',
    };

    // ── Extended BOTTLE world API exposed to all plugins ────
    const srv = this;
    self.BOTTLE = {
      register:   (m,h) => this.BOTTLE.register(m,h),
      version:    '1.0.0',
      apiVersion: 2,

      // World block access
      world: {
        get seed()  { return srv.world.seed; },
        getBlock:   (x,y,z)            => srv.world.getBlock(x,y,z),
        setBlock:   (x,y,z,sid)        => { srv.world.setBlock(x,y,z,sid); srv.broadcastBlockUpdates([{x,y,z,stateId:sid}]); },
        fillRegion: (x1,y1,z1,x2,y2,z2,sid,mask) => srv.world.fillRegion(x1,y1,z1,x2,y2,z2,sid,mask),
        getSpawn:   ()                 => ({ x:srv.world.spawnX, y:srv.world.spawnY, z:srv.world.spawnZ }),
        setSpawn:   (x,y,z)            => { srv.world.spawnX=x; srv.world.spawnY=y; srv.world.spawnZ=z; },
        get time()  { return srv.world.time; },
        set time(t) { srv.world.time = BigInt(t); },
      },

      // Player access
      getPlayers: () => [...srv.players.values()],
      getPlayer:  (name) => [...srv.players.values()].find(p=>p.username.toLowerCase()===name.toLowerCase()),
      broadcast:  (msg)  => srv.broadcast(typeof msg==='string'?{text:msg}:msg),
    };
    self.EaglerForge = self.BOTTLE;

    for (const [id, enabled] of Object.entries(builtins)) {
      if (!enabled || !files[id]) continue;
      try { importScripts(files[id]); }
      catch(e) { self.postMessage({type:'log',level:'warn',msg:`[BOTTLE] Failed builtin '${id}': ${e.message}`}); }
    }
  }

  getTPS() {
    if (this._tpsHistory.length<2) return 20;
    const e=this._tpsHistory[this._tpsHistory.length-1]-this._tpsHistory[0];
    return Math.min(20,Math.round((this._tpsHistory.length-1)/(e/1000)*100)/100);
  }

  getStats() {
    return { tps:this.getTPS(), uptime:Date.now()-this._startTime, tick:this._tickCount,
      players:this.players.size, max:this.config.maxPlayers, seed:this.world.seed,
      motd:this.config.motd, versions:'1.5.2 → 1.12.2', plugins:this.BOTTLE.getList().length };
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
      self.postMessage({ type:'offer-ready', id:r?.id, offer:r?.offer });
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
      if (!server) break;
      try { const fn=new Function('BOTTLE','EaglerForge',data.code); fn(self.BOTTLE,self.BOTTLE); }
      catch(e) { self.postMessage({type:'log',level:'error',msg:`[BOTTLE] Plugin error: ${e.message}`}); }
      break;
    }
    case 'load-plugin':
      if (server) server.BOTTLE.loadSerialized(data.id, data.manifest, data.hooksStr);
      break;

    // ── Block updates from plugins ───────────────────────────
    case 'block-updates':
      server?.broadcastBlockUpdates(data);
      break;

    // ── Multiverse messages ──────────────────────────────────
    case 'mv-world-change':
      // Player switched world — no-op for now (single-world server)
      break;
    case 'mv-create-world':
      self.postMessage({ type:'log', level:'info', msg:`[MV] Creating world '${data.name}' [${data.worldType}] seed:${data.seed}` });
      break;
    case 'mv-set-time':
      if (server) { try { server.world.time = BigInt(data.time); } catch{} }
      break;
    case 'mv-delete-world':
      self.postMessage({ type:'log', level:'info', msg:`[MV] Deleted world '${data.name}'` });
      break;

    // ── WS relay messages ────────────────────────────────────
    case 'ws-player-connect':
      server?.onWsPlayerConnect(data.id, data.ip);
      break;
    case 'ws-player-data':
      server?.onWsPlayerData(data.id, data.data);
      break;
    case 'ws-player-disconnect':
      server?.onWsPlayerDisconnect(data.id);
      break;
  }
});
