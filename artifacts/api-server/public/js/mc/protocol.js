/**
 * MC 1.12.2 Protocol State Machine — Pure Browser JavaScript
 * Protocol version 340. Handles all MC protocol states over WebRTC DataChannel.
 * HANDSHAKING → STATUS | LOGIN → PLAY
 *
 * Works over WebRTC DataChannels (binary, ordered, reliable).
 * Compatible with EaglercraftX LAN connections.
 */
'use strict';

const PROTOCOL_VERSION = 340; // MC 1.12.2

const State = { HANDSHAKING:0, STATUS:1, LOGIN:2, PLAY:3 };

class PlayerSession {
  constructor(channel, server, entityId) {
    this.channel   = channel; // RTCDataChannel or BroadcastChannel
    this.server    = server;
    this.entityId  = entityId;
    this.state     = State.HANDSHAKING;
    this.uuid      = this._genUUID();
    this.username  = 'Unknown';
    this.x = server.world.spawnX + 0.5;
    this.y = server.world.spawnY;
    this.z = server.world.spawnZ + 0.5;
    this.yaw = 0; this.pitch = 0; this.onGround = true;
    this.health = 20; this.food = 20;
    this.gamemode = server.config.defaultGamemode;
    this.isOp = false;
    this._readBuf = new Uint8Array(0);
    this._keepAliveId = 0n;
    this._keepAliveTimer = null;
    this._lastKeepalive = Date.now();

    channel.addEventListener('message', (e) => {
      const data = e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : e.data;
      this._recv(data);
    });
    channel.addEventListener('close', () => this._onClose());
    channel.addEventListener('error', () => this._onClose());
  }

  // ── Incoming data ─────────────────────────────────────────
  _recv(data) {
    const next = new Uint8Array(this._readBuf.length + data.length);
    next.set(this._readBuf); next.set(data, this._readBuf.length);
    this._readBuf = next;
    this._processPackets();
  }

  _processPackets() {
    while (true) {
      if (this._readBuf.length < 1) return;
      // Parse packet length VarInt
      let pktLen=0, lenBytes=0, b, offset=0;
      do {
        if (offset >= this._readBuf.length) return;
        b = this._readBuf[offset++];
        pktLen |= (b & 0x7F) << (7*lenBytes++);
        if (lenBytes > 5) { this.disconnect('Bad packet'); return; }
      } while (b & 0x80);
      if (this._readBuf.length < offset + pktLen) return;
      const packetData = this._readBuf.slice(offset, offset + pktLen);
      this._readBuf = this._readBuf.slice(offset + pktLen);
      try { this._handlePacket(MCBuffer.fromBytes(packetData)); }
      catch(e) { self.postMessage({type:'log',level:'warn',msg:`Packet error [${this.username}]: ${e.message}`}); }
    }
  }

  _handlePacket(buf) {
    const id = buf.readVarInt();
    switch(this.state) {
      case State.HANDSHAKING: this._handshake(id, buf); break;
      case State.STATUS:      this._status(id, buf);    break;
      case State.LOGIN:       this._login(id, buf);     break;
      case State.PLAY:        this._play(id, buf);      break;
    }
  }

  // ── HANDSHAKING ───────────────────────────────────────────
  _handshake(id, buf) {
    if (id !== 0x00) return;
    const proto = buf.readVarInt();
    buf.readString(); buf.readUShort();
    const next = buf.readVarInt();
    if (next === 1) { this.state = State.STATUS; }
    else if (next === 2) {
      this.state = State.LOGIN;
      if (proto !== PROTOCOL_VERSION) {
        this._sendLoginDisconnect(`Outdated ${proto < PROTOCOL_VERSION ? 'client' : 'server'}! Use 1.12.2`);
      }
    }
  }

  // ── STATUS ───────────────────────────────────────────────
  _status(id, buf) {
    if (id === 0x00) {
      const cfg = this.server.config;
      const onlinePlayers = [...this.server.players.values()];
      const status = {
        version: { name:'1.12.2', protocol: PROTOCOL_VERSION },
        players: {
          max: cfg.maxPlayers, online: onlinePlayers.length,
          sample: onlinePlayers.slice(0,5).map(p=>({name:p.username,id:p.uuid})),
        },
        description: { text: cfg.motd },
      };
      const pkt = new MCBuffer();
      pkt.writeString(JSON.stringify(status));
      this._sendRaw(MCBuffer.buildPacket(0x00, pkt));
    } else if (id === 0x01) {
      const pkt = new MCBuffer();
      pkt.writeLong(buf.readLong());
      this._sendRaw(MCBuffer.buildPacket(0x01, pkt));
      this.channel.close();
    }
  }

  // ── LOGIN ─────────────────────────────────────────────────
  _login(id, buf) {
    if (id !== 0x00) return;
    this.username = buf.readString().slice(0, 16);
    // Offline UUID (deterministic from username)
    const offlineUUID = this._offlineUUID(this.username);
    this.uuid = offlineUUID;
    // Send Login Success (0x02)
    const pkt = new MCBuffer();
    pkt.writeString(offlineUUID);
    pkt.writeString(this.username);
    this._sendRaw(MCBuffer.buildPacket(0x02, pkt));
    this.state = State.PLAY;
    self.postMessage({type:'log',level:'info',msg:`${this.username} logged in (offline mode)`});
    this._onLoginSuccess();
  }

  _offlineUUID(name) {
    let h = 0;
    const s = 'OfflinePlayer:' + name;
    for (let i=0;i<s.length;i++) h=Math.imul(31,h)+s.charCodeAt(i)|0;
    const a = Math.abs(h).toString(16).padStart(8,'0');
    const b = Math.abs(h^0xDEAD).toString(16).padStart(8,'0');
    const c = Math.abs(h^0xBEEF).toString(16).padStart(8,'0');
    return `${a}-${b.slice(0,4)}-3${b.slice(1,4)}-${a.slice(0,4)}-${c}${a}`.slice(0,36);
  }

  _onLoginSuccess() {
    const w = this.server.world;
    this.x = w.spawnX + 0.5; this.y = w.spawnY; this.z = w.spawnZ + 0.5;

    this._sendJoinGame();
    this._sendPluginMessage('MC|Brand', new TextEncoder().encode('\x0aEaglerNet'));
    this._sendDifficulty(this.server.config.difficulty);
    this._sendPlayerAbilities();
    this._sendSpawnPosition(Math.floor(w.spawnX), Math.floor(w.spawnY), Math.floor(w.spawnZ));
    this._sendPositionAndLook();

    // Send chunks
    const cx = Math.floor(this.x/16), cz = Math.floor(this.z/16);
    for (const chunk of w.getChunksInRadius(cx, cz, 5)) {
      this._sendRaw(buildChunkPacket(chunk));
    }
    this._sendTimeUpdate();
    this._startKeepalive();
    this.server.onPlayerJoin(this);
  }

  // ── PLAY (C→S) ────────────────────────────────────────────
  _play(id, buf) {
    switch(id) {
      case 0x00: break; // Teleport confirm
      case 0x02: { // Chat
        const msg = buf.readString().slice(0,256);
        if (msg.startsWith('/')) this.server.handleCommand(this, msg);
        else this.server.onChat(this, msg);
        break;
      }
      case 0x03: break; // Client status
      case 0x04: break; // Client settings
      case 0x0B: { // Keep alive
        const kid = buf.readLong();
        if (kid === this._keepAliveId) this._lastKeepalive = Date.now();
        break;
      }
      case 0x0F: { // Player position
        const x=buf.readDouble(),y=buf.readDouble(),z=buf.readDouble();
        this.onGround=buf.readBool();
        this._movePlayer(x,y,z);
        break;
      }
      case 0x10: { // Player position+look
        const x=buf.readDouble(),y=buf.readDouble(),z=buf.readDouble();
        this.yaw=buf.readFloat(); this.pitch=buf.readFloat();
        this.onGround=buf.readBool();
        this._movePlayer(x,y,z);
        break;
      }
      case 0x11: { // Player look
        this.yaw=buf.readFloat(); this.pitch=buf.readFloat();
        this.onGround=buf.readBool();
        break;
      }
      case 0x12: this.onGround=buf.readBool(); break;
    }
  }

  _movePlayer(x, y, z) {
    const prevX=this.x, prevZ=this.z;
    this.x=x; this.y=y; this.z=z;
    // Load new chunks on chunk boundary crossing
    const ncx=Math.floor(x/16), ncz=Math.floor(z/16);
    const pcx=Math.floor(prevX/16), pcz=Math.floor(prevZ/16);
    if (ncx!==pcx||ncz!==pcz) {
      this._sendRaw(buildChunkPacket(this.server.world.getOrGenerateChunk(ncx,ncz)));
    }
    this.server.onMove(this,x,y,z);
  }

  // ── Send packets (S→C) ────────────────────────────────────
  _sendJoinGame() {
    const pkt = new MCBuffer();
    pkt.writeInt(this.entityId);        // Entity ID
    pkt.writeUByte(this.gamemode);      // Gamemode
    pkt.writeInt(0);                    // Dimension (overworld)
    pkt.writeUByte(this.server.config.difficulty);
    pkt.writeUByte(this.server.config.maxPlayers);
    pkt.writeString('default');         // Level type
    pkt.writeBool(false);               // Reduced debug info
    this._sendRaw(MCBuffer.buildPacket(0x23, pkt));
  }

  _sendPluginMessage(channel, data) {
    const pkt = new MCBuffer();
    pkt.writeString(channel);
    pkt.writeBytes(data);
    this._sendRaw(MCBuffer.buildPacket(0x18, pkt));
  }

  _sendDifficulty(d) {
    const pkt=new MCBuffer(); pkt.writeUByte(d);
    this._sendRaw(MCBuffer.buildPacket(0x0D, pkt));
  }

  _sendPlayerAbilities() {
    const pkt=new MCBuffer();
    const flags = this.gamemode===1 ? 0x0F : 0x00;
    pkt.writeUByte(flags);
    pkt.writeFloat(0.05); pkt.writeFloat(0.1);
    this._sendRaw(MCBuffer.buildPacket(0x2C, pkt));
  }

  _sendSpawnPosition(x, y, z) {
    const pkt=new MCBuffer(); pkt.writePosition(x,y,z);
    this._sendRaw(MCBuffer.buildPacket(0x48, pkt));
  }

  _sendPositionAndLook() {
    const pkt=new MCBuffer();
    pkt.writeDouble(this.x); pkt.writeDouble(this.y); pkt.writeDouble(this.z);
    pkt.writeFloat(this.yaw); pkt.writeFloat(this.pitch);
    pkt.writeUByte(0); // absolute
    pkt.writeVarInt(0); // teleport ID
    this._sendRaw(MCBuffer.buildPacket(0x2F, pkt));
  }

  _sendTimeUpdate() {
    const pkt=new MCBuffer();
    pkt.writeLong(0n); pkt.writeLong(this.server.world.time);
    this._sendRaw(MCBuffer.buildPacket(0x49, pkt));
  }

  sendChatMessage(component, pos=0) {
    const pkt=new MCBuffer();
    pkt.writeString(JSON.stringify(typeof component==='string'?{text:component}:component));
    pkt.writeUByte(pos);
    this._sendRaw(MCBuffer.buildPacket(0x0F, pkt));
  }

  sendPlayerListAdd(p) {
    const pkt=new MCBuffer();
    pkt.writeVarInt(0); pkt.writeVarInt(1);
    pkt.writeUUID(p.uuid); pkt.writeString(p.username);
    pkt.writeVarInt(0); pkt.writeVarInt(p.gamemode); pkt.writeVarInt(0); pkt.writeBool(false);
    this._sendRaw(MCBuffer.buildPacket(0x2E, pkt));
  }

  sendPlayerListRemove(uuid) {
    const pkt=new MCBuffer();
    pkt.writeVarInt(4); pkt.writeVarInt(1); pkt.writeUUID(uuid);
    this._sendRaw(MCBuffer.buildPacket(0x2E, pkt));
  }

  updateHealth() {
    const pkt=new MCBuffer();
    pkt.writeFloat(this.health); pkt.writeVarInt(this.food); pkt.writeFloat(5.0);
    this._sendRaw(MCBuffer.buildPacket(0x40, pkt));
  }

  teleport(x,y,z) {
    this.x=x; this.y=y; this.z=z;
    this._sendPositionAndLook();
  }

  kick(reason) { this.disconnect(reason); }

  disconnect(reason) {
    try {
      if (this.state===State.PLAY) {
        const pkt=new MCBuffer();
        pkt.writeString(JSON.stringify({text:reason,color:'red'}));
        this._sendRaw(MCBuffer.buildPacket(0x1A, pkt));
      }
    } catch{}
    this.channel.close();
  }

  _sendLoginDisconnect(reason) {
    const pkt=new MCBuffer();
    pkt.writeString(JSON.stringify({text:reason}));
    this._sendRaw(MCBuffer.buildPacket(0x00, pkt));
    this.channel.close();
  }

  _startKeepalive() {
    this._keepAliveTimer = setInterval(() => {
      if (Date.now()-this._lastKeepalive > 30000) { this.disconnect('Timed out'); return; }
      this._keepAliveId = BigInt(Date.now());
      const pkt=new MCBuffer(); pkt.writeLong(this._keepAliveId);
      this._sendRaw(MCBuffer.buildPacket(0x1F, pkt));
    }, 5000);
  }

  _onClose() {
    if (this._keepAliveTimer) clearInterval(this._keepAliveTimer);
    this.server.onPlayerLeave(this);
  }

  _sendRaw(data) {
    try {
      if (this.channel.readyState==='open') this.channel.send(data.buffer ?? data);
    } catch{}
  }

  _genUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
      const r=Math.random()*16|0;
      return (c==='x'?r:(r&0x3|0x8)).toString(16);
    });
  }
}

if(typeof module!=='undefined') module.exports={PlayerSession,State,PROTOCOL_VERSION};
else { self.PlayerSession=PlayerSession; self.State=State; self.PROTOCOL_VERSION=PROTOCOL_VERSION; }
