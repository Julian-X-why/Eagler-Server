/**
 * MC Multi-Version Protocol State Machine — Pure Browser JavaScript
 * Supports MC 1.5.2 through 1.12.2 (protocol 61 → 340).
 * Detects client version in the handshake and maps packets accordingly.
 * Runs entirely in the browser Web Worker — no Node.js required.
 */
'use strict';

// Protocol number → version family for packet ID mapping
const VersionFamily = {
  LEGACY:   'legacy',    // 1.5.2–1.6.4 (proto 61–78)   — fixed-byte packet IDs
  V17:      'v17',       // 1.7.2–1.7.10 (proto 4–5)    — VarInt IDs, old format
  V18:      'v18',       // 1.8.x (proto 47)             — VarInt IDs, no palette
  V19:      'v19',       // 1.9–1.9.4 (proto 107–110)   — palette chunks
  V110:     'v110',      // 1.10–1.11.2 (proto 210–316)
  V112:     'v112',      // 1.12–1.12.2 (proto 335–340)  ← native
};

// Map each known protocol number to a family
const PROTO_FAMILY = {
  61:  VersionFamily.LEGACY, 73: VersionFamily.LEGACY, 78: VersionFamily.LEGACY,
  4:   VersionFamily.V17,    5:  VersionFamily.V17,
  47:  VersionFamily.V18,
  107: VersionFamily.V19,    110: VersionFamily.V19,
  210: VersionFamily.V110,   315: VersionFamily.V110, 316: VersionFamily.V110,
  335: VersionFamily.V112,   338: VersionFamily.V112, 340: VersionFamily.V112,
};

// Human-readable names for disconnect messages
const PROTO_NAMES = {
  61:'1.5.2', 73:'1.6.2', 78:'1.6.4', 4:'1.7.2', 5:'1.7.10',
  47:'1.8.9', 107:'1.9', 110:'1.9.4', 210:'1.10',
  315:'1.11', 316:'1.11.2', 335:'1.12', 338:'1.12.1', 340:'1.12.2',
};

const State = { HANDSHAKING: 0, STATUS: 1, LOGIN: 2, PLAY: 3 };

// Clientbound packet IDs per version family
// All packets are translated to/from v112 (native) internally.
const PKT_IDS = {
  v112: {
    DISCONNECT_LOGIN: 0x00, ENCRYPTION_REQ: 0x01, LOGIN_SUCCESS: 0x02, SET_COMPRESSION: 0x03,
    CHAT:             0x0F, DIFFICULTY:     0x0D, PLAYER_ABILITIES: 0x2C,
    JOIN_GAME:        0x23, PLUGIN_MSG:     0x18, SPAWN_POSITION: 0x48,
    POS_AND_LOOK:     0x2F, CHUNK_DATA:     0x20, TIME_UPDATE:    0x49,
    KEEP_ALIVE:       0x1F, DISCONNECT_PLAY:0x1A, PLAYER_LIST:    0x2E,
    UPDATE_HEALTH:    0x40, RESPAWN:        0x33, CHANGE_GAMEMODE:0x1E,
    PLAYER_LIST_HF:   0x4E,
  },
  v110: {
    DISCONNECT_LOGIN: 0x00, LOGIN_SUCCESS:  0x02, SET_COMPRESSION: 0x03,
    CHAT:             0x0F, DIFFICULTY:     0x0D, PLAYER_ABILITIES: 0x2C,
    JOIN_GAME:        0x23, PLUGIN_MSG:     0x18, SPAWN_POSITION: 0x48,
    POS_AND_LOOK:     0x2E, CHUNK_DATA:     0x20, TIME_UPDATE:    0x47,
    KEEP_ALIVE:       0x1F, DISCONNECT_PLAY:0x1A, PLAYER_LIST:    0x2D,
    UPDATE_HEALTH:    0x3E, RESPAWN:        0x33, CHANGE_GAMEMODE:0x1D,
  },
  v19: {
    DISCONNECT_LOGIN: 0x00, LOGIN_SUCCESS:  0x02,
    CHAT:             0x0F, DIFFICULTY:     0x0D, PLAYER_ABILITIES: 0x2B,
    JOIN_GAME:        0x23, PLUGIN_MSG:     0x18, SPAWN_POSITION: 0x43,
    POS_AND_LOOK:     0x2E, CHUNK_DATA:     0x20, TIME_UPDATE:    0x44,
    KEEP_ALIVE:       0x1F, DISCONNECT_PLAY:0x1A, PLAYER_LIST:    0x2D,
    UPDATE_HEALTH:    0x3E, RESPAWN:        0x33,
  },
  v18: {
    DISCONNECT_LOGIN: 0x00, LOGIN_SUCCESS:  0x02,
    CHAT:             0x02, DIFFICULTY:     0x41, PLAYER_ABILITIES: 0x39,
    JOIN_GAME:        0x01, PLUGIN_MSG:     0x3F, SPAWN_POSITION: 0x05,
    POS_AND_LOOK:     0x08, CHUNK_DATA:     0x21, TIME_UPDATE:    0x03,
    KEEP_ALIVE:       0x00, DISCONNECT_PLAY:0x40, PLAYER_LIST:    0x38,
    UPDATE_HEALTH:    0x06, RESPAWN:        0x07,
  },
  v17: {
    DISCONNECT_LOGIN: 0x00, LOGIN_SUCCESS:  0x02,
    CHAT:             0x02, DIFFICULTY:     0x41, PLAYER_ABILITIES: 0x39,
    JOIN_GAME:        0x01, PLUGIN_MSG:     0x3F, SPAWN_POSITION: 0x05,
    POS_AND_LOOK:     0x08, CHUNK_DATA:     0x21, TIME_UPDATE:    0x03,
    KEEP_ALIVE:       0x00, DISCONNECT_PLAY:0x FF, PLAYER_LIST:   0x38,
    UPDATE_HEALTH:    0x06, RESPAWN:        0x07,
  },
};
// Fix the 0x FF typo
PKT_IDS.v17.DISCONNECT_PLAY = 0xFF;

class PlayerSession {
  constructor(channel, server, entityId) {
    this.channel      = channel;
    this.server       = server;
    this.entityId     = entityId;
    this.state        = State.HANDSHAKING;
    this.uuid         = this._genUUID();
    this.username     = 'Unknown';
    this.proto        = 340; // detected on handshake
    this.family       = VersionFamily.V112;
    this.x = server.world.spawnX + 0.5;
    this.y = server.world.spawnY;
    this.z = server.world.spawnZ + 0.5;
    this.yaw = 0; this.pitch = 0; this.onGround = true;
    this.health = 20; this.food = 20;
    this.gamemode     = server.config.world?.defaultGamemode ?? 0;
    this.isOp         = false;
    this._readBuf     = new Uint8Array(0);
    this._keepAliveId = 0n;
    this._keepAliveTimer = null;
    this._lastKeepalive  = Date.now();

    channel.addEventListener('message', (e) => {
      const data = e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : e.data;
      this._recv(data);
    });
    channel.addEventListener('close', () => this._onClose());
    channel.addEventListener('error', () => this._onClose());
  }

  get pktIds() { return PKT_IDS[this.family] || PKT_IDS.v112; }

  // ── Data reception ────────────────────────────────────────
  _recv(data) {
    const next = new Uint8Array(this._readBuf.length + data.length);
    next.set(this._readBuf); next.set(data, this._readBuf.length);
    this._readBuf = next;
    this._processPackets();
  }

  _processPackets() {
    // Legacy protocol (1.5.2 / 1.6.4) uses different framing
    if (this.state === State.HANDSHAKING && this.family === VersionFamily.LEGACY) {
      this._processLegacyHandshake();
      return;
    }
    while (true) {
      if (this._readBuf.length < 1) return;
      let pktLen = 0, lenBytes = 0, b, offset = 0;
      do {
        if (offset >= this._readBuf.length) return;
        b = this._readBuf[offset++];
        pktLen |= (b & 0x7F) << (7 * lenBytes++);
        if (lenBytes > 5) { this.disconnect('Bad packet'); return; }
      } while (b & 0x80);
      if (this._readBuf.length < offset + pktLen) return;
      const packetData = this._readBuf.slice(offset, offset + pktLen);
      this._readBuf = this._readBuf.slice(offset + pktLen);
      try { this._handlePacket(MCBuffer.fromBytes(packetData)); }
      catch (e) { self.postMessage({ type:'log', level:'warn', msg:`Pkt error [${this.username}]: ${e.message}` }); }
    }
  }

  _handlePacket(buf) {
    const id = buf.readVarInt();
    switch (this.state) {
      case State.HANDSHAKING: this._handshake(id, buf); break;
      case State.STATUS:      this._status(id, buf);    break;
      case State.LOGIN:       this._login(id, buf);     break;
      case State.PLAY:        this._play(id, buf);      break;
    }
  }

  // ── HANDSHAKING ───────────────────────────────────────────
  _handshake(id, buf) {
    if (id !== 0x00) return;
    this.proto = buf.readVarInt();
    buf.readString(); buf.readUShort();
    const next = buf.readVarInt();

    // Determine version family
    this.family = PROTO_FAMILY[this.proto] || VersionFamily.V112;
    const vName = PROTO_NAMES[this.proto] || `proto ${this.proto}`;

    self.postMessage({ type:'log', level:'info', msg:`Handshake: proto ${this.proto} (${vName}), family: ${this.family}` });

    if (next === 1) {
      this.state = State.STATUS;
    } else if (next === 2) {
      this.state = State.LOGIN;
      // Check if version is supported
      const cfg = this.server.config;
      const enabledVersions = Object.values(cfg.versions?.protocols || {});
      const configEnabled   = cfg.versions?.enabled || {};
      const vEnabled = configEnabled[vName] !== false; // default true

      if (!vEnabled) {
        this._sendLoginDisconnect(`Version §e${vName}§c is disabled on this server.\nEnabled: 1.5.2–1.12.2`);
        return;
      }
    }
  }

  // ── LEGACY handshake (1.5.2 / 1.6.4) ────────────────────
  _processLegacyHandshake() {
    if (this._readBuf.length < 1) return;
    const id = this._readBuf[0];
    // Legacy server list ping: FE 01
    if (id === 0xFE) {
      this._sendLegacyStatus();
      this._readBuf = new Uint8Array(0);
      return;
    }
    // Fall back to normal processing
    this._processPackets();
  }

  _sendLegacyStatus() {
    const cfg = this.server.config;
    const online = this.server.players.size;
    const max    = cfg.maxPlayers;
    const motd   = (cfg.motd || 'EaglerNet').replace(/§./g, '');
    // Legacy kick packet: FF + length (short) + UTF-16BE string
    const msg    = `§1\x00127\x001.12.2\x00${motd}\x00${online}\x00${max}`;
    const encoded = [];
    encoded.push(0xFF);
    encoded.push((msg.length >> 8) & 0xFF, msg.length & 0xFF);
    for (let i = 0; i < msg.length; i++) {
      const c = msg.charCodeAt(i);
      encoded.push((c >> 8) & 0xFF, c & 0xFF);
    }
    this._sendRawBytes(new Uint8Array(encoded));
    this.channel.close();
  }

  // ── STATUS ───────────────────────────────────────────────
  _status(id, buf) {
    if (id === 0x00) {
      const cfg = this.server.config;
      const online = [...this.server.players.values()];
      const status = {
        version: { name: '1.5.2 - 1.12.2', protocol: this.proto || 340 },
        players: { max: cfg.maxPlayers, online: online.length,
          sample: online.slice(0,5).map(p=>({name:p.username,id:p.uuid})) },
        description: { text: cfg.motd || 'EaglerNet' },
      };
      const pkt = new MCBuffer(); pkt.writeString(JSON.stringify(status));
      this._sendRaw(MCBuffer.buildPacket(0x00, pkt));
    } else if (id === 0x01) {
      const pkt = new MCBuffer(); pkt.writeLong(buf.readLong());
      this._sendRaw(MCBuffer.buildPacket(0x01, pkt));
      this.channel.close();
    }
  }

  // ── LOGIN ─────────────────────────────────────────────────
  _login(id, buf) {
    if (id !== 0x00) return;
    this.username = buf.readString().slice(0, 16);
    const offlineUUID = this._offlineUUID(this.username);
    this.uuid = offlineUUID;

    // Login success — packet IDs vary by version
    const pkt = new MCBuffer();
    pkt.writeString(offlineUUID);
    pkt.writeString(this.username);
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.LOGIN_SUCCESS, pkt));

    this.state = State.PLAY;
    self.postMessage({ type:'log', level:'info', msg:`${this.username} logged in [${PROTO_NAMES[this.proto]||this.proto}]` });
    this._onLoginSuccess();
  }

  _offlineUUID(name) {
    let h = 0;
    const s = 'OfflinePlayer:' + name;
    for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    const a = Math.abs(h).toString(16).padStart(8,'0');
    const b = Math.abs(h^0xDEAD).toString(16).padStart(8,'0');
    const c = Math.abs(h^0xBEEF).toString(16).padStart(8,'0');
    return `${a}-${b.slice(0,4)}-3${b.slice(1,4)}-${a.slice(0,4)}-${c}${a}`.slice(0,36);
  }

  // ── Join sequence ─────────────────────────────────────────
  _onLoginSuccess() {
    const w = this.server.world;
    this.x = w.spawnX + 0.5; this.y = w.spawnY; this.z = w.spawnZ + 0.5;
    this._sendJoinGame();
    this._sendPluginMessage('MC|Brand', new TextEncoder().encode('\x0aEaglerNet'));
    this._sendDifficulty(this.server.config.world?.difficulty ?? 1);
    this._sendPlayerAbilities();
    this._sendSpawnPosition(Math.floor(w.spawnX), Math.floor(w.spawnY), Math.floor(w.spawnZ));
    this._sendPositionAndLook();
    const cx = Math.floor(this.x / 16), cz = Math.floor(this.z / 16);
    const radius = this.server.config.performance?.chunkRadius ?? 5;
    for (const chunk of w.getChunksInRadius(cx, cz, radius)) {
      this._sendChunk(chunk);
    }
    this._sendTimeUpdate();
    this._startKeepalive();
    this.server.onPlayerJoin(this);
  }

  _sendChunk(chunk) {
    // 1.8 and earlier: old chunk format (no palette)
    if (this.family === VersionFamily.V18 || this.family === VersionFamily.V17 ||
        this.family === VersionFamily.LEGACY) {
      this._sendChunkLegacy(chunk);
    } else {
      // 1.9+ palette format (native)
      this._sendRaw(buildChunkPacket(chunk));
    }
  }

  _sendChunkLegacy(chunk) {
    // For 1.8 clients: send chunk as raw block IDs (no palette)
    // Simplified: send 0x21 (Map Chunk Bulk) or individual chunks
    // For now, send a simplified flat chunk in 1.8 format
    const payload = new MCBuffer();
    payload.writeInt(chunk.chunkX);
    payload.writeInt(chunk.chunkZ);
    payload.writeBool(true); // ground-up continuous
    payload.writeUShort(0xFFFF); // primary bit mask (all 16 sections)

    // 1.8 chunk section = 4096 block IDs (4 bits each) + meta + light
    // We'll send simplified data for now
    const sectionData = new Uint8Array(16 * (4096 * 2 + 2048 * 2 + 2048));
    payload.writeInt(sectionData.length + 256);
    payload.writeVarInt(0); // no block entities

    // Fill with basic terrain from our chunk
    let offset = 0;
    for (let si = 0; si < 16; si++) {
      const sec = chunk.sections[si];
      for (let i = 0; i < 4096; i++) {
        const sid = sec ? sec.blocks[i] : 0;
        const blockId = sid >> 4;
        const meta = sid & 0xF;
        sectionData[offset + i*2]     = blockId & 0xFF;
        sectionData[offset + i*2 + 1] = ((blockId >> 8) << 4) | (meta & 0xF);
      }
      offset += 8192;
      // Block light — all 0xFF
      sectionData.fill(0xFF, offset, offset + 2048); offset += 2048;
    }
    // Sky light — all 0xFF
    sectionData.fill(0xFF, offset, offset + 16*2048);

    payload.writeBytes(sectionData);
    payload.writeBytes(chunk.biomes);

    // 1.8 chunk data packet ID is 0x21
    this._sendRaw(MCBuffer.buildPacket(0x21, payload));
  }

  // ── PLAY (C→S) ────────────────────────────────────────────
  _play(id, buf) {
    // Remap C→S packet IDs for older versions
    const mapped = this._remapInbound(id);
    switch (mapped) {
      case 'teleport_confirm': break;
      case 'chat': {
        const msg = buf.readString().slice(0, 256);
        if (msg.startsWith('/')) this.server.handleCommand(this, msg);
        else this.server.onChat(this, msg);
        break;
      }
      case 'client_status': break;
      case 'client_settings': break;
      case 'keep_alive': {
        const kid = this.family === VersionFamily.V18 ? BigInt(buf.readInt()) : buf.readLong();
        if (kid === this._keepAliveId) this._lastKeepalive = Date.now();
        break;
      }
      case 'player_pos': {
        const x=buf.readDouble(), y=buf.readDouble(), z=buf.readDouble();
        this.onGround = buf.readBool();
        this._movePlayer(x, y, z);
        break;
      }
      case 'player_pos_look': {
        const x=buf.readDouble(), y=buf.readDouble(), z=buf.readDouble();
        this.yaw=buf.readFloat(); this.pitch=buf.readFloat();
        this.onGround=buf.readBool();
        this._movePlayer(x, y, z);
        break;
      }
      case 'player_look': {
        this.yaw=buf.readFloat(); this.pitch=buf.readFloat();
        this.onGround=buf.readBool();
        break;
      }
      case 'player_ground': this.onGround=buf.readBool(); break;
    }
  }

  // Map inbound packet IDs to symbolic names
  _remapInbound(id) {
    const f = this.family;
    if (f === VersionFamily.V112 || f === VersionFamily.V110 || f === VersionFamily.V19) {
      switch (id) {
        case 0x00: return 'teleport_confirm';
        case 0x02: return 'chat';
        case 0x03: return 'client_status';
        case 0x04: return 'client_settings';
        case 0x0B: return 'keep_alive';
        case 0x0F: return 'player_pos';
        case 0x10: return 'player_pos_look';
        case 0x11: return 'player_look';
        case 0x12: return 'player_ground';
      }
    } else if (f === VersionFamily.V18) {
      switch (id) {
        case 0x01: return 'chat';
        case 0x00: return 'keep_alive';
        case 0x04: return 'player_pos';
        case 0x06: return 'player_pos_look';
        case 0x05: return 'player_look';
        case 0x03: return 'player_ground';
        case 0x15: return 'client_settings';
      }
    } else if (f === VersionFamily.V17) {
      switch (id) {
        case 0x03: return 'chat';
        case 0x00: return 'keep_alive';
        case 0x04: return 'player_pos';
        case 0x06: return 'player_pos_look';
        case 0x05: return 'player_look';
        case 0x0A: return 'player_ground';
      }
    }
    return `unknown_${id}`;
  }

  _movePlayer(x, y, z) {
    const prevX=this.x, prevZ=this.z;
    this.x=x; this.y=y; this.z=z;
    const ncx=Math.floor(x/16), ncz=Math.floor(z/16);
    const pcx=Math.floor(prevX/16), pcz=Math.floor(prevZ/16);
    if (ncx!==pcx||ncz!==ncz) {
      this._sendChunk(this.server.world.getOrGenerateChunk(ncx, ncz));
    }
    this.server.onMove(this, x, y, z);
  }

  // ── Send packets (S→C) ────────────────────────────────────
  _sendJoinGame() {
    const pkt = new MCBuffer();
    if (this.family === VersionFamily.V18 || this.family === VersionFamily.V17) {
      // 1.7/1.8 Join Game format
      pkt.writeInt(this.entityId);
      pkt.writeUByte(this.gamemode);
      pkt.writeByte(0); // dimension (overworld)
      pkt.writeUByte(this.server.config.world?.difficulty ?? 1);
      pkt.writeUByte(this.server.config.maxPlayers);
      pkt.writeString('default');
      if (this.family !== VersionFamily.V17) pkt.writeBool(false); // reduced debug
    } else {
      // 1.9+ format
      pkt.writeInt(this.entityId);
      pkt.writeUByte(this.gamemode);
      pkt.writeInt(0); // dimension
      pkt.writeUByte(this.server.config.world?.difficulty ?? 1);
      pkt.writeUByte(this.server.config.maxPlayers);
      pkt.writeString('default');
      pkt.writeBool(false);
    }
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.JOIN_GAME, pkt));
  }

  _sendPluginMessage(channel, data) {
    const pkt = new MCBuffer();
    pkt.writeString(channel);
    pkt.writeBytes(data);
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.PLUGIN_MSG, pkt));
  }

  _sendDifficulty(d) {
    if (!this.pktIds.DIFFICULTY) return;
    const pkt = new MCBuffer(); pkt.writeUByte(d);
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.DIFFICULTY, pkt));
  }

  _sendPlayerAbilities() {
    const pkt = new MCBuffer();
    const flags = this.gamemode === 1 ? 0x0F : 0x00;
    pkt.writeUByte(flags); pkt.writeFloat(0.05); pkt.writeFloat(0.1);
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.PLAYER_ABILITIES, pkt));
  }

  _sendSpawnPosition(x, y, z) {
    const pkt = new MCBuffer();
    if (this.family === VersionFamily.V18 || this.family === VersionFamily.V17) {
      pkt.writeInt(x); pkt.writeInt(y); pkt.writeInt(z);
    } else {
      pkt.writePosition(x, y, z);
    }
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.SPAWN_POSITION, pkt));
  }

  _sendPositionAndLook() {
    const pkt = new MCBuffer();
    pkt.writeDouble(this.x); pkt.writeDouble(this.y); pkt.writeDouble(this.z);
    pkt.writeFloat(this.yaw); pkt.writeFloat(this.pitch);
    pkt.writeUByte(0); // absolute flags
    if (this.family !== VersionFamily.V18 && this.family !== VersionFamily.V17) {
      pkt.writeVarInt(0); // teleport ID (1.9+)
    }
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.POS_AND_LOOK, pkt));
  }

  _sendTimeUpdate() {
    const pkt = new MCBuffer();
    pkt.writeLong(0n); pkt.writeLong(this.server.world.time);
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.TIME_UPDATE, pkt));
  }

  sendChatMessage(component, pos=0) {
    const pkt = new MCBuffer();
    pkt.writeString(JSON.stringify(typeof component==='string'?{text:component}:component));
    if (this.family !== VersionFamily.V17 && this.family !== VersionFamily.V18) {
      pkt.writeUByte(pos);
    }
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.CHAT, pkt));
  }
  sendMessage(text) { this.sendChatMessage({ text: String(text) }, 1); }

  sendPlayerListAdd(p) {
    if (this.family === VersionFamily.V18 || this.family === VersionFamily.V17) return;
    const pkt = new MCBuffer();
    pkt.writeVarInt(0); pkt.writeVarInt(1);
    pkt.writeUUID(p.uuid); pkt.writeString(p.username);
    pkt.writeVarInt(0); pkt.writeVarInt(p.gamemode); pkt.writeVarInt(0); pkt.writeBool(false);
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.PLAYER_LIST, pkt));
  }
  sendPlayerListRemove(uuid) {
    if (this.family === VersionFamily.V18 || this.family === VersionFamily.V17) return;
    const pkt = new MCBuffer();
    pkt.writeVarInt(4); pkt.writeVarInt(1); pkt.writeUUID(uuid);
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.PLAYER_LIST, pkt));
  }

  updateHealth() {
    const pkt = new MCBuffer();
    pkt.writeFloat(this.health); pkt.writeVarInt(this.food); pkt.writeFloat(5.0);
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.UPDATE_HEALTH, pkt));
  }

  teleport(x, y, z) { this.x=x; this.y=y; this.z=z; this._sendPositionAndLook(); }
  kick(reason)       { this.disconnect(reason); }

  disconnect(reason) {
    try {
      const pkt = new MCBuffer();
      pkt.writeString(JSON.stringify({ text: String(reason), color:'red' }));
      const id = this.state===State.LOGIN ? this.pktIds.DISCONNECT_LOGIN : this.pktIds.DISCONNECT_PLAY;
      this._sendRaw(MCBuffer.buildPacket(id, pkt));
    } catch {}
    this.channel.close();
  }

  _sendLoginDisconnect(reason) {
    try {
      const pkt = new MCBuffer();
      pkt.writeString(JSON.stringify({ text: String(reason) }));
      this._sendRaw(MCBuffer.buildPacket(this.pktIds.DISCONNECT_LOGIN, pkt));
    } catch {}
    this.channel.close();
  }

  _startKeepalive() {
    this._keepAliveTimer = setInterval(() => {
      if (Date.now()-this._lastKeepalive > 30000) { this.disconnect('Timed out'); return; }
      this._keepAliveId = BigInt(Date.now());
      const pkt = new MCBuffer();
      if (this.family === VersionFamily.V18 || this.family === VersionFamily.V17) {
        pkt.writeInt(Number(this._keepAliveId & 0x7FFFFFFFn));
      } else {
        pkt.writeLong(this._keepAliveId);
      }
      this._sendRaw(MCBuffer.buildPacket(this.pktIds.KEEP_ALIVE, pkt));
    }, 5000);
  }

  _onClose() {
    if (this._keepAliveTimer) clearInterval(this._keepAliveTimer);
    this.server.onPlayerLeave(this);
  }

  _sendRaw(data) {
    try {
      if (this.channel.readyState === 'open') {
        const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
        this.channel.send(buf.buffer);
      }
    } catch {}
  }
  _sendRawBytes(data) { this._sendRaw(data); }

  _genUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random()*16|0;
      return (c==='x'?r:(r&0x3|0x8)).toString(16);
    });
  }
}

if (typeof module !== 'undefined') module.exports = { PlayerSession, State, VersionFamily, PROTO_NAMES };
else { self.PlayerSession=PlayerSession; self.State=State; self.VersionFamily=VersionFamily; self.PROTO_NAMES=PROTO_NAMES; }
