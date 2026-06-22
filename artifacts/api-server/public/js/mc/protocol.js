/**
 * MC Multi-Version Protocol State Machine — Pure Browser JavaScript
 * Supports MC 1.5.2 through 1.12.2 (protocol 61 → 340).
 *
 * Full-effort implementation:
 *   - Players see each other (Spawn Player / Named Entity, Destroy Entities)
 *   - Movement broadcasting (Entity Relative Move, Entity Teleport, Head Look)
 *   - Block breaking (Player Digging) and placing (Player Block Placement)
 *   - Arm-swing animation broadcast
 *   - Held-item tracking (Creative Inventory Action, Held Item Change)
 *   - Empty inventory sent on join (Window Items)
 *   - Proper chunk-radius loading on movement
 *   - All version families: v17, v18, v19, v110, v112 (legacy best-effort)
 */
'use strict';

const VersionFamily = {
  LEGACY: 'legacy', V17: 'v17', V18: 'v18', V19: 'v19', V110: 'v110', V112: 'v112',
};
const PROTO_FAMILY = {
  61: VersionFamily.LEGACY, 73: VersionFamily.LEGACY, 78: VersionFamily.LEGACY,
  4:  VersionFamily.V17,    5:  VersionFamily.V17,
  47: VersionFamily.V18,
  107: VersionFamily.V19, 110: VersionFamily.V19,
  210: VersionFamily.V110, 315: VersionFamily.V110, 316: VersionFamily.V110,
  335: VersionFamily.V112, 338: VersionFamily.V112, 340: VersionFamily.V112,
};
const PROTO_NAMES = {
  61: '1.5.2', 73: '1.6.2', 78: '1.6.4', 4: '1.7.2', 5: '1.7.10',
  47: '1.8.9', 107: '1.9', 110: '1.9.4', 210: '1.10',
  315: '1.11', 316: '1.11.2', 335: '1.12', 338: '1.12.1', 340: '1.12.2',
};
const State = { HANDSHAKING: 0, STATUS: 1, LOGIN: 2, PLAY: 3 };

// ─── S→C Packet ID tables ─────────────────────────────────────────────────
const PKT_IDS = {
  // MC 1.12 / 1.12.1 / 1.12.2 (335 / 338 / 340)
  v112: {
    DISCONNECT_LOGIN: 0x00, LOGIN_SUCCESS: 0x02,
    SPAWN_PLAYER:      0x05, ANIMATION_OUT:    0x06,
    BLOCK_CHANGE:      0x0B, CHAT:             0x0F,
    DIFFICULTY:        0x0D, WINDOW_ITEMS:     0x14,
    PLUGIN_MSG:        0x18, DISCONNECT_PLAY:  0x1A,
    KEEP_ALIVE:        0x1F, CHUNK_DATA:       0x20,
    JOIN_GAME:         0x23,
    ENTITY_REL_MOVE:       0x26,  // short × 4096
    ENTITY_REL_MOVE_LOOK:  0x27,
    ENTITY_LOOK:           0x28,
    PLAYER_ABILITIES:  0x2C, PLAYER_LIST:      0x2E,
    POS_AND_LOOK:      0x2F, DESTROY_ENTITIES: 0x32,
    RESPAWN:           0x33, ENTITY_HEAD_LOOK: 0x3A,
    ENTITY_METADATA:   0x3C, UPDATE_HEALTH:    0x40,
    SPAWN_POSITION:    0x48, TIME_UPDATE:      0x49,
    ENTITY_TELEPORT:   0x4C,
  },
  // MC 1.9 / 1.9.4 (107 / 110)  — entity packet IDs shifted down 1 from 1.12
  v19: {
    DISCONNECT_LOGIN: 0x00, LOGIN_SUCCESS: 0x02,
    SPAWN_PLAYER:      0x05, ANIMATION_OUT:    0x06,
    BLOCK_CHANGE:      0x0B, CHAT:             0x0F,
    DIFFICULTY:        0x0D, WINDOW_ITEMS:     0x13,
    PLUGIN_MSG:        0x18, DISCONNECT_PLAY:  0x1A,
    KEEP_ALIVE:        0x1F, CHUNK_DATA:       0x20,
    JOIN_GAME:         0x23,
    ENTITY_REL_MOVE:       0x25,
    ENTITY_REL_MOVE_LOOK:  0x26,
    ENTITY_LOOK:           0x27,
    PLAYER_ABILITIES:  0x2B, PLAYER_LIST:      0x2D,
    POS_AND_LOOK:      0x2E, DESTROY_ENTITIES: 0x31,
    RESPAWN:           0x32, ENTITY_HEAD_LOOK: 0x37,
    ENTITY_METADATA:   0x38, UPDATE_HEALTH:    0x3E,
    SPAWN_POSITION:    0x43, TIME_UPDATE:      0x44,
    ENTITY_TELEPORT:   0x49,
  },
  // MC 1.10 / 1.11 / 1.11.2 (210 / 315 / 316)
  v110: {
    DISCONNECT_LOGIN: 0x00, LOGIN_SUCCESS: 0x02,
    SPAWN_PLAYER:      0x05, ANIMATION_OUT:    0x06,
    BLOCK_CHANGE:      0x0B, CHAT:             0x0F,
    DIFFICULTY:        0x0D, WINDOW_ITEMS:     0x13,
    PLUGIN_MSG:        0x18, DISCONNECT_PLAY:  0x1A,
    KEEP_ALIVE:        0x1F, CHUNK_DATA:       0x20,
    JOIN_GAME:         0x23,
    ENTITY_REL_MOVE:       0x25,
    ENTITY_REL_MOVE_LOOK:  0x26,
    ENTITY_LOOK:           0x27,
    PLAYER_ABILITIES:  0x2C, PLAYER_LIST:      0x2D,
    POS_AND_LOOK:      0x2E, DESTROY_ENTITIES: 0x31,
    RESPAWN:           0x33, ENTITY_HEAD_LOOK: 0x39,
    ENTITY_METADATA:   0x3B, UPDATE_HEALTH:    0x3E,
    SPAWN_POSITION:    0x43, TIME_UPDATE:      0x44,
    ENTITY_TELEPORT:   0x49,
  },
  // MC 1.8 / 1.8.9 (47) — completely different ID set
  v18: {
    DISCONNECT_LOGIN: 0x00, LOGIN_SUCCESS: 0x02,
    SPAWN_PLAYER:      0x0C,  // Spawn Named Entity
    ANIMATION_OUT:     0x0B,
    BLOCK_CHANGE:      0x23, CHAT:             0x02,
    DIFFICULTY:        0x41, WINDOW_ITEMS:     0x30,
    PLUGIN_MSG:        0x3F, DISCONNECT_PLAY:  0x40,
    KEEP_ALIVE:        0x00, CHUNK_DATA:       0x21,
    JOIN_GAME:         0x01,
    ENTITY_REL_MOVE:       0x15,  // byte × 32
    ENTITY_REL_MOVE_LOOK:  0x17,
    ENTITY_LOOK:           0x16,
    PLAYER_ABILITIES:  0x39, PLAYER_LIST:      0x38,
    POS_AND_LOOK:      0x08, DESTROY_ENTITIES: 0x13,
    RESPAWN:           0x07, ENTITY_HEAD_LOOK: 0x19,
    ENTITY_METADATA:   0x1C, UPDATE_HEALTH:    0x06,
    SPAWN_POSITION:    0x05, TIME_UPDATE:      0x03,
    ENTITY_TELEPORT:   0x18,
  },
  // MC 1.7.x (4 / 5) — almost identical to 1.8
  v17: {
    DISCONNECT_LOGIN: 0x00, LOGIN_SUCCESS: 0x02,
    SPAWN_PLAYER:      0x0C,
    ANIMATION_OUT:     0x0B,
    BLOCK_CHANGE:      0x23, CHAT:             0x02,
    DIFFICULTY:        0x41, WINDOW_ITEMS:     0x30,
    PLUGIN_MSG:        0x3F, DISCONNECT_PLAY:  0xFF,
    KEEP_ALIVE:        0x00, CHUNK_DATA:       0x21,
    JOIN_GAME:         0x01,
    ENTITY_REL_MOVE:       0x15,
    ENTITY_REL_MOVE_LOOK:  0x17,
    ENTITY_LOOK:           0x16,
    PLAYER_ABILITIES:  0x39, PLAYER_LIST:      0x38,
    POS_AND_LOOK:      0x08, DESTROY_ENTITIES: 0x13,
    RESPAWN:           0x07, ENTITY_HEAD_LOOK: 0x19,
    ENTITY_METADATA:   0x1C, UPDATE_HEALTH:    0x06,
    SPAWN_POSITION:    0x05, TIME_UPDATE:      0x03,
    ENTITY_TELEPORT:   0x18,
  },
};

// ─── Face → block offset (for block placement) ──────────────────────────
const FACE_OFFSETS = [
  [0, -1, 0],  // 0 = bottom (place on bottom face = put block below clicked)
  [0,  1, 0],  // 1 = top
  [0,  0, -1], // 2 = north
  [0,  0,  1], // 3 = south
  [-1, 0,  0], // 4 = west
  [1,  0,  0], // 5 = east
];

// ─── PlayerSession ────────────────────────────────────────────────────────
class PlayerSession {
  constructor(channel, server, entityId) {
    this.channel    = channel;
    this.server     = server;
    this.entityId   = entityId;
    this.state      = State.HANDSHAKING;
    this.uuid       = this._genUUID();
    this.username   = 'Unknown';
    this.proto      = 340;
    this.family     = VersionFamily.V112;

    // Position / look
    this.x = server.world.spawnX + 0.5;
    this.y = server.world.spawnY;
    this.z = server.world.spawnZ + 0.5;
    this.yaw = 0; this.pitch = 0; this.onGround = true;

    // Last position we told other players about (for delta packets)
    this._lastSentX = this.x;
    this._lastSentY = this.y;
    this._lastSentZ = this.z;
    this._lastSentYaw   = 0;
    this._lastSentPitch = 0;

    // Game state
    this.health   = 20; this.food = 20;
    this.gamemode = server.config.world?.defaultGamemode ?? 0;
    this.isOp     = false;

    // Inventory (minimal: track held item for block placement)
    this._hotbarSlot = 0;
    this._heldItemId = 0;      // MC item/block ID (0 = empty)
    this._heldItemMeta = 0;

    // Internal
    this._wsId           = null;
    this._readBuf        = new Uint8Array(0);
    this._keepAliveId    = 0n;
    this._keepAliveTimer = null;
    this._lastKeepalive  = Date.now();
    this._worldName      = 'world';

    channel.addEventListener('message', (e) => {
      const raw = e.data;
      const data = raw instanceof ArrayBuffer ? new Uint8Array(raw)
                 : raw instanceof Uint8Array   ? raw
                 : new Uint8Array(raw);
      this._recv(data);
    });
    channel.addEventListener('close', () => this._onClose());
    channel.addEventListener('error', () => this._onClose());
  }

  get pktIds() {
    const f = this.family;
    if (f === VersionFamily.V112) return PKT_IDS.v112;
    if (f === VersionFamily.V110) return PKT_IDS.v110;
    if (f === VersionFamily.V19)  return PKT_IDS.v19;
    if (f === VersionFamily.V18)  return PKT_IDS.v18;
    return PKT_IDS.v17;
  }

  // ── Receive & frame ──────────────────────────────────────────
  _recv(data) {
    const next = new Uint8Array(this._readBuf.length + data.length);
    next.set(this._readBuf); next.set(data, this._readBuf.length);
    this._readBuf = next;
    this._processPackets();
  }

  _processPackets() {
    while (true) {
      if (this._readBuf.length < 1) return;

      // ── EaglercraftX pre-handshake detection ────────────────
      // EaglercraftX clients send a 2-byte BE length packet BEFORE
      // the standard MC VarInt-framed handshake.
      // Detect: first byte = 0x00 (high byte of a small 2-byte length)
      // and second byte is small (≤ 64), indicating a short pre-handshake packet.
      if (!this._frameDetected) {
        if (this._readBuf.length < 2) return;
        if (this._readBuf[0] === 0x00 && this._readBuf[1] <= 0x40) {
          this._eaglerMode = true;
        }
        this._frameDetected = true;
      }

      // ── EaglercraftX 2-byte framing (pre-handshake only) ────
      if (this._eaglerMode) {
        if (this._readBuf.length < 2) return;
        const pktLen = (this._readBuf[0] << 8) | this._readBuf[1];
        if (this._readBuf.length < 2 + pktLen) return;
        const pkt = this._readBuf.slice(2, 2 + pktLen);
        this._readBuf = this._readBuf.slice(2 + pktLen);
        const done = this._handleEaglerPreHandshake(pkt);
        if (done) return; // switched to VarInt mode for MC play
        continue;
      }

      // Legacy (1.5.2/1.6.x) uses 2-byte big-endian length prefix
      if (this.family === VersionFamily.LEGACY && this.state === State.PLAY) {
        if (this._readBuf.length < 3) return;
        const pktLen = (this._readBuf[0] << 8) | this._readBuf[1];
        if (this._readBuf.length < 2 + pktLen) return;
        const pkt = this._readBuf.slice(2, 2 + pktLen);
        this._readBuf = this._readBuf.slice(2 + pktLen);
        try { this._handlePacket(MCBuffer.fromBytes(pkt)); } catch {}
        continue;
      }
      // Modern: VarInt-prefixed length
      let pktLen = 0, lenBytes = 0, b, offset = 0;
      do {
        if (offset >= this._readBuf.length) return;
        b = this._readBuf[offset++];
        pktLen |= (b & 0x7F) << (7 * lenBytes++);
        if (lenBytes > 5) { this.disconnect('Bad VarInt length'); return; }
      } while (b & 0x80);
      if (this._readBuf.length < offset + pktLen) return;
      const packetData = this._readBuf.slice(offset, offset + pktLen);
      this._readBuf   = this._readBuf.slice(offset + pktLen);
      try { this._handlePacket(MCBuffer.fromBytes(packetData)); }
      catch (e) {
        self.postMessage({ type: 'log', level: 'warn',
          msg: `Pkt err [${this.username}]: ${e.message}` });
      }
    }
  }

  // ── EaglercraftX pre-handshake handler ───────────────────────
  // Implements the EaglercraftX WebSocket protocol (2-byte length prefix).
  // Returns true when the pre-handshake is complete and we switch to MC play.
  _handleEaglerPreHandshake(pkt) {
    if (pkt.length === 0) return false;
    const type = pkt[0];

    if (type === 0x01) {
      // Server info request → respond with server MOTD
      const cfg = this.server.config;
      const online = [...this.server.players.values()];
      const info = {
        name:    cfg.motd || 'EaglerNet',
        cracked: true,
        motd:    cfg.motd || 'EaglerNet',
        online:  online.length,
        max:     cfg.maxPlayers,
        vers:    'EaglerNet 1.12.2',
        time:    Date.now(),
      };
      const json      = JSON.stringify(info);
      const jsonBytes = new TextEncoder().encode(json);
      const resp      = new Uint8Array(2 + 1 + jsonBytes.length);
      const len       = 1 + jsonBytes.length;
      resp[0] = (len >> 8) & 0xFF;
      resp[1] =  len       & 0xFF;
      resp[2] = 0x01;
      resp.set(jsonBytes, 3);
      this._sendRawBytes(resp);
      return false;
    }

    if (type === 0x02) {
      // Login request: payload = username bytes (after the type byte)
      const usernameBytes = pkt.slice(1);
      this.username = new TextDecoder().decode(usernameBytes).replace(/\0/g, '').slice(0, 16) || 'Player';
      this.uuid     = this._offlineUUID(this.username);

      // Send login OK (type 0x02, 1 byte payload = 0x00 = success)
      this._sendRawBytes(new Uint8Array([0x00, 0x01, 0x02]));

      // Switch to standard MC play (VarInt framing from here on)
      this._eaglerMode = false;
      this.proto  = 340;
      this.family = VersionFamily.V112;
      this.state  = State.PLAY;
      self.postMessage({ type: 'log', level: 'info',
        msg: `${this.username} logged in [EaglercraftX / 1.12.2]` });
      this._onLoginSuccess();
      return true; // stop processing; MC play packets arrive next
    }

    return false;
  }

  // Send raw bytes without any framing (used for EaglercraftX pre-handshake)
  _sendRawBytes(bytes) {
    try {
      if (this.channel.readyState === 'open') {
        const ab = bytes instanceof Uint8Array ? bytes.buffer : new Uint8Array(bytes).buffer;
        this.channel.send(ab);
      }
    } catch {}
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

  // ── Handshake ────────────────────────────────────────────────
  _handshake(id, buf) {
    if (id !== 0x00) return;
    this.proto  = buf.readVarInt();
    buf.readString(); buf.readUShort();
    const next  = buf.readVarInt();
    this.family = PROTO_FAMILY[this.proto] || VersionFamily.V112;
    const vName = PROTO_NAMES[this.proto] || `proto ${this.proto}`;
    self.postMessage({ type: 'log', level: 'info',
      msg: `Handshake: proto ${this.proto} (${vName}), family: ${this.family}` });
    if (next === 1) { this.state = State.STATUS; }
    else if (next === 2) {
      this.state = State.LOGIN;
      const cfg = this.server.config;
      if ((cfg.versions?.enabled || {})[vName] === false) {
        this._sendLoginDisconnect(`Version §e${vName}§c is disabled.`); return;
      }
    }
  }

  // ── Status (ping / MOTD) ─────────────────────────────────────
  _status(id, buf) {
    if (id === 0x00) {
      const cfg    = this.server.config;
      const online = [...this.server.players.values()];
      const status = {
        version:     { name: '1.5.2–1.12.2', protocol: this.proto || 340 },
        players:     { max: cfg.maxPlayers, online: online.length,
          sample: online.slice(0, 5).map(p => ({ name: p.username, id: p.uuid })) },
        description: { text: cfg.motd || 'EaglerNet' },
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

  // ── Login ────────────────────────────────────────────────────
  _login(id, buf) {
    if (id !== 0x00) return;
    this.username = buf.readString().slice(0, 16);
    this.uuid     = this._offlineUUID(this.username);
    const pkt = new MCBuffer();
    pkt.writeString(this.uuid);
    pkt.writeString(this.username);
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.LOGIN_SUCCESS, pkt));
    this.state = State.PLAY;
    self.postMessage({ type: 'log', level: 'info',
      msg: `${this.username} logged in [${PROTO_NAMES[this.proto] || this.proto}]` });
    this._onLoginSuccess();
  }

  _offlineUUID(name) {
    let h = 0;
    const s = 'OfflinePlayer:' + name;
    for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    const a = Math.abs(h).toString(16).padStart(8, '0');
    const b = Math.abs(h ^ 0xDEAD).toString(16).padStart(8, '0');
    const c = Math.abs(h ^ 0xBEEF).toString(16).padStart(8, '0');
    return `${a}-${b.slice(0,4)}-3${b.slice(1,4)}-${a.slice(0,4)}-${c}${a}`.slice(0, 36);
  }

  // ── Login success → send world state ─────────────────────────
  _onLoginSuccess() {
    const w  = this.server.world;
    this.x   = w.spawnX + 0.5;
    this.y   = w.spawnY;
    this.z   = w.spawnZ + 0.5;
    this._lastSentX = this.x;
    this._lastSentY = this.y;
    this._lastSentZ = this.z;

    this._sendJoinGame();
    this._sendPluginMessage('MC|Brand', new TextEncoder().encode('\x0aEaglerNet'));
    this._sendDifficulty(this.server.config.world?.difficulty ?? 1);
    this._sendPlayerAbilities();
    this._sendSpawnPosition(Math.floor(w.spawnX), Math.floor(w.spawnY), Math.floor(w.spawnZ));
    this._sendPositionAndLook();

    // Send initial chunk radius
    const cx     = Math.floor(this.x / 16), cz = Math.floor(this.z / 16);
    const radius = this.server.config.performance?.chunkRadius ?? 6;
    for (const chunk of w.getChunksInRadius(cx, cz, radius)) {
      this._sendChunk(chunk);
    }

    this._sendTimeUpdate();
    this._sendWindowItems();     // Empty inventory — prevents client hang
    this._startKeepalive();
    this.server.onPlayerJoin(this);
  }

  // ── Play packet dispatch ──────────────────────────────────────
  _play(id, buf) {
    const name = this._remapInbound(id);
    switch (name) {
      // ── Required: basic protocol maintenance ─────────────────
      case 'teleport_confirm': break;   // 1.9+ after PosAndLook, ignored
      case 'client_status':   break;   // respawn / request stats

      case 'keep_alive': {
        const kid = (this.family === VersionFamily.V18 || this.family === VersionFamily.V17)
          ? BigInt(buf.readInt()) : buf.readLong();
        if (kid === this._keepAliveId) this._lastKeepalive = Date.now();
        break;
      }

      // ── Chat / commands ───────────────────────────────────────
      case 'chat': {
        const msg = buf.readString().slice(0, 256);
        if (msg.startsWith('/')) this.server.handleCommand(this, msg);
        else this.server.onChat(this, msg);
        break;
      }

      // ── Movement ──────────────────────────────────────────────
      case 'player_pos': {
        const x = buf.readDouble(), y = buf.readDouble(), z = buf.readDouble();
        this.onGround = buf.readBool();
        this._movePlayer(x, y, z, this.yaw, this.pitch, false);
        break;
      }
      case 'player_pos_look': {
        const x = buf.readDouble(), y = buf.readDouble(), z = buf.readDouble();
        this.yaw = buf.readFloat(); this.pitch = buf.readFloat();
        this.onGround = buf.readBool();
        this._movePlayer(x, y, z, this.yaw, this.pitch, true);
        break;
      }
      case 'player_look': {
        this.yaw = buf.readFloat(); this.pitch = buf.readFloat();
        this.onGround = buf.readBool();
        this._movePlayer(this.x, this.y, this.z, this.yaw, this.pitch, true);
        break;
      }
      case 'player_ground': {
        this.onGround = buf.readBool();
        break;
      }

      // ── Block breaking ────────────────────────────────────────
      case 'player_digging': {
        if (this.family === VersionFamily.V18 || this.family === VersionFamily.V17) {
          const status = buf.readByte();
          const x = buf.readInt(), y = buf.readUByte(), z = buf.readInt();
          buf.readByte(); // face
          this._handleDigging(status, x, y, z);
        } else {
          const status = buf.readVarInt();
          const pos    = buf.readPosition();
          buf.readByte(); // face
          this._handleDigging(status, pos.x, pos.y, pos.z);
        }
        break;
      }

      // ── Block placing ─────────────────────────────────────────
      case 'block_placement': {
        try {
          if (this.family === VersionFamily.V18 || this.family === VersionFamily.V17) {
            const x = buf.readInt(), y = buf.readUByte(), z = buf.readInt();
            const face = buf.readByte();
            // Skip slot (heldItem): short(-1=empty or id), if id>0: byte count, short damage, nbt
            const slotId = buf.readShort();
            if (slotId > 0) {
              buf.readByte(); buf.readShort(); buf.readByte(); // skip item data
            }
            buf.readByte(); buf.readByte(); buf.readByte(); // cursor x/y/z bytes
            if (face >= 0 && face <= 5) this._handleBlockPlacement(x, y, z, face);
          } else {
            const hand = buf.readVarInt();
            const pos  = buf.readPosition();
            const face = buf.readVarInt();
            buf.readFloat(); buf.readFloat(); buf.readFloat(); // cursor x/y/z
            if (buf.readableBytes > 0) buf.readBool(); // insideBlock
            if (hand === 0 && face >= 0 && face <= 5) {
              this._handleBlockPlacement(pos.x, pos.y, pos.z, face);
            }
          }
        } catch {} // malformed placement: ignore
        break;
      }

      // ── Arm swing (animation C→S) ─────────────────────────────
      case 'animation_c2s': {
        if (this.family !== VersionFamily.V18 && this.family !== VersionFamily.V17) {
          try { buf.readVarInt(); } catch {} // hand: 0=main, 1=offhand
        }
        this.server.broadcastAnimation(this, 0); // 0 = swing main arm
        break;
      }

      // ── Held item change ──────────────────────────────────────
      case 'held_item_change': {
        const slot = buf.readShort();
        if (slot >= 0 && slot <= 8) {
          this._hotbarSlot = slot;
          this._heldItemId   = 0;
          this._heldItemMeta = 0;
        }
        break;
      }

      // ── Creative inventory action ─────────────────────────────
      case 'creative_inventory': {
        try {
          const slot   = buf.readShort();
          const itemId = buf.readShort();
          if (itemId > 0) {
            buf.readByte();  // count
            const dmg = buf.readShort();
            // Skip optional NBT
            if (buf.readableBytes > 0) {
              const nbtFlag = buf.readByte();
              if (nbtFlag > 0) { /* skip NBT bytes; treat as no data */ }
            }
            // If this slot is in the hotbar and matches active slot, update held item
            if (slot >= 36 && slot <= 44 && (slot - 36) === this._hotbarSlot) {
              this._heldItemId   = itemId;
              this._heldItemMeta = dmg;
            }
          } else if (slot >= 36 && slot <= 44 && (slot - 36) === this._hotbarSlot) {
            this._heldItemId   = 0;
            this._heldItemMeta = 0;
          }
        } catch {}
        break;
      }

      // ── Client settings (read to keep stream in sync) ─────────
      case 'client_settings': {
        try {
          buf.readString();  // locale
          buf.readByte();    // view distance
          buf.readVarInt();  // chat mode
          buf.readBool();    // chat colours
          buf.readUByte();   // skin parts flags
          if (this.family !== VersionFamily.V18 && this.family !== VersionFamily.V17) {
            buf.readVarInt(); // main hand (0=left, 1=right)
          }
        } catch {}
        break;
      }

      // ── Plugin messages C→S (absorb without logging) ─────────
      case 'plugin_msg_c2s': {
        try {
          const ch = buf.readString();
          // Eaglercraft sends MC|Register, MC|Brand etc. — silently accept
          void ch;
        } catch {}
        break;
      }

      default: break; // silently ignore unhandled packets
    }
  }

  // ── Inbound packet ID → logical name ─────────────────────────
  _remapInbound(id) {
    const f = this.family;
    if (f === VersionFamily.V112 || f === VersionFamily.V110 || f === VersionFamily.V19) {
      // 1.12.2 (340) C→S packet IDs — slightly different from 1.12 (335).
      // We support both by checking the proto version directly.
      let m;
      if (this.proto >= 340) {
        // MC 1.12.2 (proto 340)
        m = {
          0x00: 'teleport_confirm',
          0x03: 'chat',
          0x04: 'client_status',
          0x05: 'client_settings',
          0x0A: 'plugin_msg_c2s',
          0x0C: 'keep_alive',
          0x0D: 'player_ground',
          0x0E: 'player_pos',
          0x0F: 'player_pos_look',
          0x10: 'player_look',
          0x15: 'player_digging',
          0x1B: 'held_item_change',
          0x1C: 'creative_inventory',
          0x1E: 'animation_c2s',
          0x20: 'block_placement',
        };
      } else if (this.proto >= 335) {
        // MC 1.12 / 1.12.1 (proto 335 / 338)
        m = {
          0x00: 'teleport_confirm',
          0x02: 'chat',
          0x03: 'client_status',
          0x04: 'client_settings',
          0x18: 'plugin_msg_c2s',
          0x0B: 'keep_alive',
          0x0F: 'player_pos',
          0x10: 'player_pos_look',
          0x11: 'player_look',
          0x12: 'player_ground',
          0x14: 'player_digging',
          0x1A: 'animation_c2s',
          0x1B: 'creative_inventory',
          0x1C: 'block_placement',
          0x1F: 'held_item_change',
        };
      } else {
        // MC 1.9 / 1.9.4 / 1.10 / 1.11 (proto 107–316)
        // C→S IDs for 1.9: https://wiki.vg/index.php?title=Protocol&oldid=7368
        m = {
          0x00: 'teleport_confirm',
          0x02: 'chat',
          0x03: 'client_status',
          0x04: 'client_settings',
          0x09: 'plugin_msg_c2s',
          0x0B: 'keep_alive',
          0x0C: 'player_ground',
          0x0D: 'player_pos',
          0x0E: 'player_pos_look',
          0x0F: 'player_look',
          0x13: 'player_digging',
          0x17: 'held_item_change',
          0x18: 'creative_inventory',
          0x1A: 'animation_c2s',
          0x1C: 'block_placement',
        };
      }
      return m[id] ?? `unknown_${id}`;
    } else if (f === VersionFamily.V18) {
      return {
        0x00: 'keep_alive',      0x01: 'chat',
        0x03: 'player_ground',   0x04: 'player_pos',
        0x05: 'player_look',     0x06: 'player_pos_look',
        0x07: 'player_digging',  0x08: 'block_placement',
        0x09: 'held_item_change',0x0B: 'animation_c2s',
        0x10: 'creative_inventory', 0x15: 'client_settings',
      }[id] ?? `unknown_${id}`;
    } else if (f === VersionFamily.V17) {
      return {
        0x00: 'keep_alive',   0x03: 'chat',
        0x0A: 'player_ground',0x04: 'player_pos',
        0x05: 'player_look',  0x06: 'player_pos_look',
        0x07: 'player_digging',0x08: 'block_placement',
        0x09: 'held_item_change',0x0B: 'animation_c2s',
        0x10: 'creative_inventory',
      }[id] ?? `unknown_${id}`;
    }
    return `unknown_${id}`;
  }

  // ── Movement: chunk loading + entity move broadcast ───────────
  _movePlayer(x, y, z, yaw, pitch, rotated) {
    const prevX = this.x, prevZ = this.z;
    const prevCX = Math.floor(prevX / 16), prevCZ = Math.floor(prevZ / 16);
    this.x = x; this.y = y; this.z = z;
    this.yaw = yaw; this.pitch = pitch;

    const ncx = Math.floor(x / 16), ncz = Math.floor(z / 16);
    const radius = this.server.config.performance?.chunkRadius ?? 6;

    // Load newly visible chunks when crossing a chunk border
    if (ncx !== prevCX || ncz !== prevCZ) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const cx = ncx + dx, cz = ncz + dz;
          // Only send chunks that weren't in the old view radius
          if (Math.abs(cx - prevCX) > radius || Math.abs(cz - prevCZ) > radius) {
            this._sendChunk(this.server.world.getOrGenerateChunk(cx, cz));
          }
        }
      }
    }

    // Broadcast our new position/look to nearby players
    this.server.broadcastEntityMove(this, rotated);
    this.server.onMove(this, x, y, z);
  }

  // ── Block digging handler ─────────────────────────────────────
  _handleDigging(status, x, y, z) {
    // status 0 = start digging, 1 = cancel, 2 = finish
    // Creative: break instantly on start. Survival: break on finish.
    if ((status === 0 && this.gamemode === 1) || (status === 2 && this.gamemode === 0)) {
      const allow = this.server.BOTTLE.emit('block.break', { player: this, x, y, z });
      if (allow === false) return;
      this.server.world.setBlock(x, y, z, 0);
      this.server.broadcastBlockUpdates([{ x, y, z, stateId: 0 }]);
    }
  }

  // ── Block placement handler ───────────────────────────────────
  _handleBlockPlacement(bx, by, bz, face) {
    const itemId = this._heldItemId;
    if (!itemId || itemId <= 0) return;

    // Compute the target position (block adjacent to clicked face)
    const [ox, oy, oz] = FACE_OFFSETS[face] || [0, 0, 0];
    const tx = bx + ox, ty = by + oy, tz = bz + oz;
    if (ty < 0 || ty > 255) return;

    // Don't overwrite non-air blocks (the client wouldn't either)
    if (this.server.world.getBlock(tx, ty, tz) !== 0) return;

    // Compute state ID (itemId * 16 + meta for pre-flattening 1.12.2)
    const stateId = (itemId & 0xFFF) * 16 + (this._heldItemMeta & 0xF);
    const allow = this.server.BOTTLE.emit('block.place', { player: this, x: tx, y: ty, z: tz, stateId });
    if (allow === false) return;

    this.server.world.setBlock(tx, ty, tz, stateId);
    this.server.broadcastBlockUpdates([{ x: tx, y: ty, z: tz, stateId }]);
  }

  // ═══════════════════════════════════════════════════════════════
  // OUTBOUND — send packets to THIS player's client
  // ═══════════════════════════════════════════════════════════════

  _sendJoinGame() {
    const pkt = new MCBuffer();
    const f = this.family;
    if (f === VersionFamily.V18 || f === VersionFamily.V17) {
      pkt.writeInt(this.entityId);
      pkt.writeUByte(this.gamemode);
      pkt.writeByte(0);  // dimension 0 = overworld
      pkt.writeUByte(this.server.config.world?.difficulty ?? 1);
      pkt.writeUByte(this.server.config.maxPlayers);
      pkt.writeString('default');
      if (f !== VersionFamily.V17) pkt.writeBool(false); // reduced debug
    } else {
      pkt.writeInt(this.entityId);
      pkt.writeUByte(this.gamemode);
      pkt.writeInt(0);   // dimension
      pkt.writeUByte(this.server.config.world?.difficulty ?? 1);
      pkt.writeUByte(this.server.config.maxPlayers);
      pkt.writeString('default');
      pkt.writeBool(false); // reduced debug info
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
    const pkt = new MCBuffer();
    pkt.writeUByte(d);
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.DIFFICULTY, pkt));
  }

  _sendPlayerAbilities() {
    const pkt   = new MCBuffer();
    const flags = this.gamemode === 1 ? 0x0F : 0x00; // creative = fly + instant break
    pkt.writeUByte(flags);
    pkt.writeFloat(this.gamemode === 1 ? 0.1 : 0.05); // fly speed
    pkt.writeFloat(0.1); // walk speed
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.PLAYER_ABILITIES, pkt));
  }

  _sendSpawnPosition(x, y, z) {
    const pkt = new MCBuffer();
    const f = this.family;
    if (f === VersionFamily.V18 || f === VersionFamily.V17) {
      pkt.writeInt(x); pkt.writeInt(y); pkt.writeInt(z);
    } else {
      pkt.writePosition(x, y, z);
    }
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.SPAWN_POSITION, pkt));
  }

  _sendPositionAndLook(teleportId) {
    const pkt = new MCBuffer();
    pkt.writeDouble(this.x); pkt.writeDouble(this.y); pkt.writeDouble(this.z);
    pkt.writeFloat(this.yaw); pkt.writeFloat(this.pitch);
    pkt.writeUByte(0); // flags (all absolute)
    const f = this.family;
    if (f !== VersionFamily.V18 && f !== VersionFamily.V17) {
      pkt.writeVarInt(teleportId ?? 0); // teleport ID (1.9+)
    }
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.POS_AND_LOOK, pkt));
  }

  _sendTimeUpdate() {
    const pkt = new MCBuffer();
    pkt.writeLong(0n); // world age
    pkt.writeLong(this.server.world.time);
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.TIME_UPDATE, pkt));
  }

  // Sends an empty player inventory so the client doesn't get confused.
  _sendWindowItems() {
    const pkt = new MCBuffer();
    pkt.writeByte(0); // window ID 0 = player inventory
    const slots = (this.family === VersionFamily.V18 || this.family === VersionFamily.V17) ? 45 : 46;
    pkt.writeShort(slots);
    for (let i = 0; i < slots; i++) pkt.writeShort(-1); // -1 = empty slot
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.WINDOW_ITEMS, pkt));
  }

  // ── Block change (server → client) ───────────────────────────
  _sendBlockChange(x, y, z, stateId) {
    try {
      const pkt = new MCBuffer();
      const f = this.family;
      if (f === VersionFamily.V18 || f === VersionFamily.V17) {
        pkt.writeInt(x); pkt.writeUByte(y); pkt.writeInt(z);
        pkt.writeVarInt(stateId >> 4);  // block ID
        pkt.writeUByte(stateId & 0xF);  // meta
      } else {
        // 1.9+: packed position + state ID
        pkt.writePosition(x, y, z);
        pkt.writeVarInt(stateId);
      }
      this._sendRaw(MCBuffer.buildPacket(this.pktIds.BLOCK_CHANGE, pkt));
    } catch {}
  }

  // ── Player list add / remove ──────────────────────────────────
  sendPlayerListAdd(p) {
    const f = this.family;
    if (f === VersionFamily.V18 || f === VersionFamily.V17) {
      // 1.8 Player List Item: String name, Boolean online, Short ping
      const pkt = new MCBuffer();
      pkt.writeString(p.username); pkt.writeBool(true); pkt.writeShort(0);
      this._sendRaw(MCBuffer.buildPacket(this.pktIds.PLAYER_LIST, pkt));
      return;
    }
    const pkt = new MCBuffer();
    pkt.writeVarInt(0); // action: add player
    pkt.writeVarInt(1); // count
    pkt.writeUUID(p.uuid);
    pkt.writeString(p.username);
    pkt.writeVarInt(0); // no properties
    pkt.writeVarInt(p.gamemode);
    pkt.writeVarInt(0); // ping
    pkt.writeBool(false); // no display name
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.PLAYER_LIST, pkt));
  }

  sendPlayerListRemove(uuid) {
    const f = this.family;
    if (f === VersionFamily.V18 || f === VersionFamily.V17) {
      const p = this.server.players.get(uuid);
      if (!p) return;
      const pkt = new MCBuffer();
      pkt.writeString(p.username); pkt.writeBool(false); pkt.writeShort(0);
      this._sendRaw(MCBuffer.buildPacket(this.pktIds.PLAYER_LIST, pkt));
      return;
    }
    const pkt = new MCBuffer();
    pkt.writeVarInt(4); // action: remove player
    pkt.writeVarInt(1);
    pkt.writeUUID(uuid);
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.PLAYER_LIST, pkt));
  }

  // ═══════════════════════════════════════════════════════════════
  // ENTITY PACKETS — sent FROM this session TO a target player
  // "spawnTo(target)" = make ME appear on TARGET's screen
  // ═══════════════════════════════════════════════════════════════

  spawnTo(target) {
    try {
      const pkt = new MCBuffer();
      const tf  = target.family;
      if (tf === VersionFamily.V18 || tf === VersionFamily.V17) {
        // 0x0C Spawn Named Entity (1.8)
        pkt.writeVarInt(this.entityId);
        pkt.writeString(this.uuid);        // UUID as string
        pkt.writeString(this.username);    // player name
        pkt.writeVarInt(0);                // number of properties (0 = offline)
        pkt.writeInt(Math.floor(this.x * 32));
        pkt.writeInt(Math.floor(this.y * 32));
        pkt.writeInt(Math.floor(this.z * 32));
        pkt.writeAngle(this.yaw);
        pkt.writeAngle(this.pitch);
        pkt.writeShort(0);   // current item (0 = empty)
        pkt.writeUByte(0x7F); // end of entity metadata
      } else {
        // 0x05 Spawn Player (1.9+)
        pkt.writeVarInt(this.entityId);
        pkt.writeUUID(this.uuid);
        pkt.writeDouble(this.x);
        pkt.writeDouble(this.y);
        pkt.writeDouble(this.z);
        pkt.writeAngle(this.yaw);
        pkt.writeAngle(this.pitch);
        // Minimal player metadata: just the end marker
        // (0xFF = end for 1.9+, 0x7F for 1.8 — handled above)
        pkt.writeUByte(0xFF);
      }
      target._sendRaw(MCBuffer.buildPacket(target.pktIds.SPAWN_PLAYER, pkt));
    } catch (e) {
      self.postMessage({ type: 'log', level: 'warn',
        msg: `spawnTo failed [${this.username}→${target.username}]: ${e.message}` });
    }
  }

  despawnFrom(target) {
    try {
      const pkt = new MCBuffer();
      const tf  = target.family;
      if (tf === VersionFamily.V18 || tf === VersionFamily.V17) {
        // 1.8: byte count + int[] entity IDs
        pkt.writeUByte(1);
        pkt.writeInt(this.entityId);
      } else {
        // 1.9+: varint count + varint[] entity IDs
        pkt.writeVarInt(1);
        pkt.writeVarInt(this.entityId);
      }
      target._sendRaw(MCBuffer.buildPacket(target.pktIds.DESTROY_ENTITIES, pkt));
    } catch {}
  }

  // Send my current position/look to a target as an entity move/teleport packet.
  sendEntityMoveTo(target) {
    try {
      const dx = this.x - this._lastSentX;
      const dy = this.y - this._lastSentY;
      const dz = this.z - this._lastSentZ;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      const tf = target.family;

      const pkt = new MCBuffer();

      if (tf === VersionFamily.V18 || tf === VersionFamily.V17) {
        if (dist > 4.0) {
          // 0x18 Entity Teleport (1.8): fixed-point × 32
          pkt.writeVarInt(this.entityId);
          pkt.writeInt(Math.floor(this.x * 32));
          pkt.writeInt(Math.floor(this.y * 32));
          pkt.writeInt(Math.floor(this.z * 32));
          pkt.writeAngle(this.yaw);
          pkt.writeAngle(this.pitch);
          pkt.writeBool(this.onGround);
          target._sendRaw(MCBuffer.buildPacket(target.pktIds.ENTITY_TELEPORT, pkt));
        } else {
          // 0x17 Entity Look And Relative Move (1.8): byte delta × 32
          const bx = Math.max(-128, Math.min(127, Math.round(dx * 32)));
          const by = Math.max(-128, Math.min(127, Math.round(dy * 32)));
          const bz = Math.max(-128, Math.min(127, Math.round(dz * 32)));
          pkt.writeVarInt(this.entityId);
          pkt.writeByte(bx); pkt.writeByte(by); pkt.writeByte(bz);
          pkt.writeAngle(this.yaw);
          pkt.writeAngle(this.pitch);
          target._sendRaw(MCBuffer.buildPacket(target.pktIds.ENTITY_REL_MOVE_LOOK, pkt));
        }
      } else {
        // 1.9+: fixed-point × 4096 (short deltas)
        if (dist > 8.0) {
          // Entity Teleport (1.9+)
          pkt.writeVarInt(this.entityId);
          pkt.writeDouble(this.x);
          pkt.writeDouble(this.y);
          pkt.writeDouble(this.z);
          pkt.writeAngle(this.yaw);
          pkt.writeAngle(this.pitch);
          pkt.writeBool(this.onGround);
          target._sendRaw(MCBuffer.buildPacket(target.pktIds.ENTITY_TELEPORT, pkt));
        } else {
          const sx = Math.max(-32768, Math.min(32767, Math.round(dx * 4096)));
          const sy = Math.max(-32768, Math.min(32767, Math.round(dy * 4096)));
          const sz = Math.max(-32768, Math.min(32767, Math.round(dz * 4096)));
          pkt.writeVarInt(this.entityId);
          pkt.writeShort(sx); pkt.writeShort(sy); pkt.writeShort(sz);
          pkt.writeAngle(this.yaw);
          pkt.writeAngle(this.pitch);
          pkt.writeBool(this.onGround);
          target._sendRaw(MCBuffer.buildPacket(target.pktIds.ENTITY_REL_MOVE_LOOK, pkt));
        }
      }
    } catch {}
  }

  // Send head-yaw rotation to target
  sendEntityHeadLookTo(target) {
    try {
      const pkt = new MCBuffer();
      pkt.writeVarInt(this.entityId);
      pkt.writeAngle(this.yaw);
      target._sendRaw(MCBuffer.buildPacket(target.pktIds.ENTITY_HEAD_LOOK, pkt));
    } catch {}
  }

  // ── Chunk sending ─────────────────────────────────────────────
  _sendChunk(chunk) {
    const f = this.family;
    if (f === VersionFamily.V18 || f === VersionFamily.V17 || f === VersionFamily.LEGACY) {
      this._sendChunkLegacy(chunk);
    } else {
      this._sendRaw(buildChunkPacket(chunk));
    }
  }

  _sendChunkLegacy(chunk) {
    // 1.7/1.8 chunk format: flat block IDs + metadata (no palette)
    const payload = new MCBuffer();
    payload.writeInt(chunk.chunkX);
    payload.writeInt(chunk.chunkZ);
    payload.writeBool(true);   // ground-up continuous
    payload.writeUShort(0xFFFF); // primary bit mask: all 16 sections

    const sectionData = new Uint8Array(16 * (4096 * 2 + 2048 * 2 + 2048));
    let offset = 0;
    for (let si = 0; si < 16; si++) {
      const sec = chunk.sections[si];
      // Block data (2 bytes per block: high nibble of second byte = upper block ID, low nibble = meta)
      for (let i = 0; i < 4096; i++) {
        const sid = sec ? sec.blocks[i] : 0;
        const blockId = sid >> 4, meta = sid & 0xF;
        sectionData[offset + i * 2]     = blockId & 0xFF;
        sectionData[offset + i * 2 + 1] = ((blockId >> 8) & 0xF) | (meta << 4);
      }
      offset += 8192;
      // Block light: all 0xFF (max brightness)
      sectionData.fill(0xFF, offset, offset + 2048); offset += 2048;
    }
    // Sky light: all 0xFF
    sectionData.fill(0xFF, offset, offset + 16 * 2048);

    payload.writeInt(sectionData.length + 256); // data length
    payload.writeVarInt(0); // unused in 1.8
    payload.writeBytes(sectionData);
    payload.writeBytes(chunk.biomes); // 256 biome bytes
    this._sendRaw(MCBuffer.buildPacket(0x21, payload));
  }

  // ── Chat + health ─────────────────────────────────────────────
  sendChatMessage(component, pos = 0) {
    const pkt = new MCBuffer();
    pkt.writeString(JSON.stringify(typeof component === 'string' ? { text: component } : component));
    const f = this.family;
    if (f !== VersionFamily.V17 && f !== VersionFamily.V18) pkt.writeUByte(pos);
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.CHAT, pkt));
  }
  sendMessage(text)  { this.sendChatMessage({ text: String(text) }, 1); }

  updateHealth() {
    const pkt = new MCBuffer();
    pkt.writeFloat(this.health);
    pkt.writeVarInt(this.food);
    pkt.writeFloat(5.0);
    this._sendRaw(MCBuffer.buildPacket(this.pktIds.UPDATE_HEALTH, pkt));
  }

  // ── Teleport / kick / disconnect ──────────────────────────────
  teleport(x, y, z) {
    this.x = x; this.y = y; this.z = z;
    this._lastSentX = x; this._lastSentY = y; this._lastSentZ = z;
    this._sendPositionAndLook();
  }
  kick(reason)       { this.disconnect(reason); }
  disconnect(reason) {
    try {
      const pkt = new MCBuffer();
      pkt.writeString(JSON.stringify({ text: String(reason), color: 'red' }));
      const id = this.state === State.LOGIN
        ? this.pktIds.DISCONNECT_LOGIN : this.pktIds.DISCONNECT_PLAY;
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

  // ── Keep-alive ────────────────────────────────────────────────
  _startKeepalive() {
    this._keepAliveTimer = setInterval(() => {
      if (Date.now() - this._lastKeepalive > 30000) {
        this.disconnect('Timed out'); return;
      }
      this._keepAliveId = BigInt(Date.now());
      const pkt = new MCBuffer();
      const f = this.family;
      if (f === VersionFamily.V18 || f === VersionFamily.V17) {
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

  _genUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
}

if (typeof module !== 'undefined') {
  module.exports = { PlayerSession, State, VersionFamily, PROTO_NAMES };
} else {
  self.PlayerSession = PlayerSession;
  self.State         = State;
  self.VersionFamily = VersionFamily;
  self.PROTO_NAMES   = PROTO_NAMES;
}
