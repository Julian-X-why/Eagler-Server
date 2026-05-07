/**
 * EaglerNet MC 1.12.2 Server — Pure Browser Web Worker
 * Runs entirely in the browser. No Node.js required.
 * Players connect via WebRTC DataChannels (EaglercraftX LAN compatible).
 * Also supports BroadcastChannel for same-browser testing.
 */
'use strict';

importScripts(
  '../mc/buffer.js',
  '../mc/nbt.js',
  '../mc/noise.js',
  '../mc/blocks.js',
  '../mc/world.js',
  '../mc/chunk.js',
  '../mc/protocol.js',
  '../plugin-api.js',
);

class EaglerNetServer {
  constructor(config) {
    this.config = {
      motd:           '§aEaglerNet §7| 1.12.2 Browser Server',
      maxPlayers:     20,
      difficulty:     1,
      defaultGamemode: 0,
      seed:           Math.floor(Math.random() * 2147483647),
      viewDistance:   8,
      ...config,
    };

    this.world   = new MCWorld(this.config.seed);
    this.players = new Map(); // uuid → PlayerSession
    this.plugins = new EaglerForgeServer(this);
    this._entityId = 1;
    this._tickCount = 0;
    this._startTime = Date.now();
    this._tpsHistory = [];

    // WebRTC state
    this._peerConnections = new Map(); // id → RTCPeerConnection
    this._pendingOffer = null;

    self.postMessage({ type: 'ready', seed: this.config.seed, spawnY: this.world.spawnY });
  }

  start() {
    // 20 TPS tick loop
    setInterval(() => this._tick(), 50);
    self.postMessage({ type: 'log', level: 'info', msg: 'Server started (20 TPS)' });
    self.postMessage({ type: 'log', level: 'info', msg: `World seed: ${this.config.seed}` });
    self.postMessage({ type: 'log', level: 'info', msg: `Spawn: ${Math.floor(this.world.spawnX)}, ${Math.floor(this.world.spawnY)}, ${Math.floor(this.world.spawnZ)}` });
  }

  _tick() {
    this._tickCount++;
    this.world.tick();
    this._tpsHistory.push(Date.now());
    while (this._tpsHistory.length > 20) this._tpsHistory.shift();
    this.plugins.emit('server.tick', { tick: this._tickCount });

    if (this._tickCount % 200 === 0) { // Every 10s
      self.postMessage({ type: 'stats', data: this.getStats() });
    }
    if (this._tickCount % 400 === 0) { // Every 20s
      for (const p of this.players.values()) p._sendTimeUpdate();
    }
  }

  getTPS() {
    if (this._tpsHistory.length < 2) return 20;
    const elapsed = this._tpsHistory[this._tpsHistory.length-1] - this._tpsHistory[0];
    return Math.min(20, Math.round(((this._tpsHistory.length-1)/(elapsed/1000))*100)/100);
  }

  getStats() {
    return {
      tps:     this.getTPS(),
      uptime:  Date.now() - this._startTime,
      tick:    this._tickCount,
      players: this.players.size,
      max:     this.config.maxPlayers,
      seed:    this.config.seed,
      motd:    this.config.motd,
    };
  }

  // ── WebRTC: create offer for a player to join ─────────────
  async createOffer() {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ]
    });
    const id = 'peer_' + Math.random().toString(36).slice(2);
    this._peerConnections.set(id, pc);

    const channel = pc.createDataChannel('mc', { ordered: true });
    channel.binaryType = 'arraybuffer';

    channel.addEventListener('open', () => {
      self.postMessage({ type: 'log', level: 'info', msg: `WebRTC channel opened [${id}]` });
      if (this.players.size >= this.config.maxPlayers) {
        channel.close();
        return;
      }
      const session = new PlayerSession(channel, this, ++this._entityId);
      // Session registers itself via onPlayerJoin when login completes
    });

    // ICE gathering
    const offerSDP = await pc.createOffer();
    await pc.setLocalDescription(offerSDP);

    return new Promise((resolve) => {
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') {
          resolve({ id, offer: pc.localDescription.sdp });
        }
      });
      // Timeout fallback
      setTimeout(() => resolve({ id, offer: pc.localDescription?.sdp ?? '' }), 5000);
    });
  }

  // ── WebRTC: accept answer from a player ───────────────────
  async acceptAnswer(peerId, answerSDP) {
    const pc = this._peerConnections.get(peerId);
    if (!pc) throw new Error('Unknown peer: ' + peerId);
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSDP });
  }

  // ── BroadcastChannel: for same-browser testing ────────────
  setupBroadcast(channelName) {
    const bc = new BroadcastChannel(channelName);
    bc.addEventListener('message', (e) => {
      if (e.data?.type === 'connect') {
        // Create a mock DataChannel-like object wrapping BroadcastChannel
        const playerBc = new BroadcastChannel(e.data.replyChannel);
        const mockChannel = {
          readyState: 'open',
          send: (data) => playerBc.postMessage({ type:'data', data }),
          close: () => { playerBc.close(); },
          addEventListener: (evt, handler) => {
            if (evt === 'message') {
              bc.addEventListener('message', (ev) => {
                if (ev.data?.type==='data' && ev.data?.ch===e.data.replyChannel) handler(ev.data);
              });
            }
          },
        };
        new PlayerSession(mockChannel, this, ++this._entityId);
      }
    });
    self.postMessage({ type:'log', level:'info', msg:`BroadcastChannel server on: ${channelName}` });
  }

  // ── Player lifecycle ──────────────────────────────────────
  onPlayerJoin(session) {
    this.players.set(session.uuid, session);
    const joinMsg = { text: session.username + ' joined the game', color: 'yellow' };
    this.broadcast(joinMsg);
    // Update tab list for all players
    for (const other of this.players.values()) {
      other.sendPlayerListAdd(session);
      if (other !== session) session.sendPlayerListAdd(other);
    }
    self.postMessage({ type:'player.join', username: session.username, uuid: session.uuid, count: this.players.size });
    self.postMessage({ type:'log', level:'info', msg:`${session.username} joined (${this.players.size}/${this.config.maxPlayers})` });
    this.plugins.emit('player.join', { player: session });
  }

  onPlayerLeave(session) {
    if (!this.players.has(session.uuid)) return;
    this.players.delete(session.uuid);
    const quitMsg = { text: session.username + ' left the game', color: 'yellow' };
    this.broadcast(quitMsg);
    for (const other of this.players.values()) other.sendPlayerListRemove(session.uuid);
    self.postMessage({ type:'player.quit', username: session.username, uuid: session.uuid, count: this.players.size });
    self.postMessage({ type:'log', level:'info', msg:`${session.username} left (${this.players.size}/${this.config.maxPlayers})` });
    this.plugins.emit('player.quit', { player: session });
  }

  onChat(session, message) {
    const component = {
      text: '',
      extra: [
        { text: '<', color: 'white' },
        { text: session.username, color: 'yellow' },
        { text: '> ' + message, color: 'white' },
      ]
    };
    this.broadcast(component);
    self.postMessage({ type:'chat', username: session.username, message, time: Date.now() });
    this.plugins.emit('player.chat', { player: session, message });
  }

  onMove(session, x, y, z) {
    this.plugins.emit('player.move', { player: session, x, y, z });
  }

  broadcast(component) {
    for (const p of this.players.values()) p.sendChatMessage(component, 0);
    self.postMessage({ type:'broadcast', message: JSON.stringify(component) });
  }

  handleCommand(session, cmd) {
    const parts = cmd.replace(/^\//,'').split(/\s+/);
    const name = parts[0].toLowerCase();
    const args = parts.slice(1);
    const send = (msg) => session.sendChatMessage({ text: msg, color: 'yellow' }, 1);

    switch(name) {
      case 'help':
        send('§aEaglerNet Commands: /help /plugins /tps /players /gamemode /tp /kick /say /seed');
        return;
      case 'plugins':
        send('§7Plugins: ' + this.plugins.getList().map(p=>`§a${p.name}§7 v${p.version}`).join(', '));
        return;
      case 'tps':
        send(`§aTPS: ${this.getTPS().toFixed(2)} | Uptime: ${Math.floor((Date.now()-this._startTime)/60000)}m`);
        return;
      case 'players':
        const list = [...this.players.values()].map(p=>p.username).join(', ');
        send(`§aOnline (${this.players.size}/${this.config.maxPlayers}): §7${list||'none'}`);
        return;
      case 'gamemode':
        if (!session.isOp) { send('§cNo permission'); return; }
        const gm = parseInt(args[0]);
        if (isNaN(gm)||gm<0||gm>3) { send('Usage: /gamemode <0-3>'); return; }
        session.gamemode = gm;
        session._sendPlayerAbilities();
        send(`§aGamemode set to ${['Survival','Creative','Adventure','Spectator'][gm]}`);
        return;
      case 'tp':
        if (args.length>=3) {
          session.teleport(parseFloat(args[0]), parseFloat(args[1]), parseFloat(args[2]));
          send('§aTeleported!');
        } else { send('Usage: /tp <x> <y> <z>'); }
        return;
      case 'kick':
        const target = [...this.players.values()].find(p=>p.username.toLowerCase()===args[0]?.toLowerCase());
        if (target) { target.kick(args.slice(1).join(' ')||'Kicked by operator'); send('§aKicked '+target.username); }
        else send('§cPlayer not found');
        return;
      case 'say':
        this.broadcast({ text: '[Server] ' + args.join(' '), color: 'gray' });
        return;
      case 'seed':
        send(`§aSeed: §7${this.config.seed}`);
        return;
      default:
        const handled = this.plugins.handleCommand(session, name, args);
        if (!handled) send(`§cUnknown command: /${name}`);
    }
  }

  // ── Admin commands from dashboard ─────────────────────────
  adminCommand(cmd) {
    const parts = cmd.replace(/^\//,'').split(/\s+/);
    const name = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch(name) {
      case 'say':
        this.broadcast({ text: '[Server] ' + args.join(' '), color: 'gray' });
        self.postMessage({type:'log',level:'info',msg:`[Console] say ${args.join(' ')}`});
        break;
      case 'kick': {
        const t = [...this.players.values()].find(p=>p.username.toLowerCase()===args[0]?.toLowerCase());
        if (t) { t.kick(args.slice(1).join(' ')||'Kicked by server'); self.postMessage({type:'log',level:'info',msg:`Kicked ${t.username}`}); }
        break;
      }
      case 'op': {
        const t = [...this.players.values()].find(p=>p.username.toLowerCase()===args[0]?.toLowerCase());
        if (t) { t.isOp=true; t.sendChatMessage({text:'You are now an operator',color:'green'},1); }
        break;
      }
      case 'stats':
        self.postMessage({type:'stats',data:this.getStats()});
        break;
      case 'stop':
        for (const p of this.players.values()) p.disconnect('Server shutting down');
        self.postMessage({type:'stopped'});
        break;
      default:
        self.postMessage({type:'log',level:'warn',msg:`Unknown console command: ${cmd}`});
    }
  }
}

// ── Plugin API (server-side) ──────────────────────────────
class EaglerForgeServer {
  constructor(server) {
    this.server  = server;
    this._plugins = new Map();
    this._events  = new Map();
  }
  register(manifest, hooks) {
    const id = manifest.id || manifest.name;
    this._plugins.set(id, { manifest, hooks, enabled: true });
    for (const [evt, fn] of Object.entries(hooks||{})) {
      if (!this._events.has(evt)) this._events.set(evt, []);
      this._events.get(evt).push(fn);
    }
    self.postMessage({type:'log',level:'info',msg:`[EaglerForge] Loaded: ${manifest.name} v${manifest.version}`});
    self.postMessage({type:'plugin.loaded', name: manifest.name, version: manifest.version});
  }
  emit(event, data) {
    for (const fn of (this._events.get(event)||[])) { try { fn(data); } catch(e){} }
  }
  handleCommand(player, cmd, args) {
    for (const [,p] of this._plugins) {
      if (p.hooks?.command && p.hooks.command(player,cmd,args)) return true;
    }
    return false;
  }
  getList() {
    return [...this._plugins.values()].map(p=>({name:p.manifest.name,version:p.manifest.version,enabled:p.enabled}));
  }
}

// ── Worker message handler ─────────────────────────────────
let server;

self.addEventListener('message', async (e) => {
  const { type, data } = e.data;
  switch(type) {
    case 'start':
      server = new EaglerNetServer(data || {});
      server.start();
      break;
    case 'command':
      server?.adminCommand(data);
      break;
    case 'create-offer': {
      const result = await server?.createOffer();
      self.postMessage({ type:'offer-ready', id: result?.id, offer: result?.offer });
      break;
    }
    case 'accept-answer':
      await server?.acceptAnswer(data.id, data.answer);
      self.postMessage({type:'log',level:'info',msg:`Accepted answer for peer ${data.id}`});
      break;
    case 'get-stats':
      self.postMessage({ type:'stats', data: server?.getStats() });
      break;
    case 'load-plugin': {
      try {
        // Execute plugin code in worker context
        const fn = new Function('EaglerForge', 'server', data.code);
        fn({ register: (m,h) => server.plugins.register(m,h) }, server);
      } catch(e) {
        self.postMessage({type:'log',level:'error',msg:`Plugin error: ${e.message}`});
      }
      break;
    }
  }
});
