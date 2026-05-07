/**
 * EaglerNet Server Configuration
 * ─────────────────────────────────────────────────────────────
 * Edit this file to configure your server.
 * Loaded by both the dashboard and the server Web Worker.
 * All game logic runs in the browser — NO Node.js required.
 */
'use strict';

const ServerConfig = {

  // ── Server Info ───────────────────────────────────────────
  motd:       '§aEaglerNet §8▌ §7Browser MC Server §8▌ §aBOTTLE Plugins',
  maxPlayers: 20,
  serverName: 'EaglerNet',

  // ── Version Support (1.5.2 → 1.12.2) ─────────────────────
  // Players connecting with any of these protocol versions will be allowed.
  versions: {
    // Toggle each version family on/off
    enabled: {
      '1.5.2':  true,   // protocol 61
      '1.6.4':  true,   // protocol 78
      '1.7.10': true,   // protocol 5
      '1.8.9':  true,   // protocol 47
      '1.9.4':  true,   // protocol 110
      '1.10':   true,   // protocol 210
      '1.11.2': true,   // protocol 316
      '1.12':   true,   // protocol 335
      '1.12.2': true,   // protocol 340
    },
    // Preferred/canonical version for world format
    native: '1.12.2',
    // Map of MC version string → protocol number
    protocols: {
      '1.5.2':  61,
      '1.6.2':  73,
      '1.6.4':  78,
      '1.7.2':  4,
      '1.7.10': 5,
      '1.8':    47,
      '1.8.9':  47,
      '1.9':    107,
      '1.9.4':  110,
      '1.10':   210,
      '1.11':   315,
      '1.11.2': 316,
      '1.12':   335,
      '1.12.1': 338,
      '1.12.2': 340,
    },
    // Human-readable names shown in disconnect messages
    names: {
      61:  '1.5.2',  78:  '1.6.4',  5:  '1.7.10',
      47:  '1.8.9',  107: '1.9',    110: '1.9.4',
      210: '1.10',   315: '1.11',   316: '1.11.2',
      335: '1.12',   338: '1.12.1', 340: '1.12.2',
    },
  },

  // ── World ─────────────────────────────────────────────────
  world: {
    seed:           null,       // null = random each start
    type:           'default',  // 'default' | 'flat' | 'amplified'
    difficulty:     1,          // 0=peaceful 1=easy 2=normal 3=hard
    defaultGamemode: 0,         // 0=survival 1=creative 2=adventure 3=spectator
    viewDistance:   8,
    spawnProtection: 16,
    allowNether:    true,
    allowEnd:       true,
  },

  // ── BOTTLE Plugin System ───────────────────────────────────
  bottle: {
    enabled:      true,
    pluginDir:    'plugins/',
    autoLoad:     true,
    // Built-in plugins bundled with EaglerNet
    // Set to true to enable them at startup
    builtins: {
      eaglercraftxserver: true,   // EaglercraftX WebRTC + skin + voice support
      chatfilter:         false,  // Built-in chat profanity filter
      anticheat:          false,  // Basic movement/speed anti-cheat
      motd:               true,   // Dynamic MOTD with player count
      tablist:            true,   // Custom tab-list header/footer
    },
  },

  // ── Connection / WebRTC ───────────────────────────────────
  connection: {
    stunServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ],
    rtcOrdered:     true,   // ordered DataChannel delivery
    rtcMaxRetransmits: null, // null = reliable (unlimited retransmits)
    connectionTimeout: 30,   // seconds before timing out WebRTC setup
  },

  // ── Admin ─────────────────────────────────────────────────
  admin: {
    ops:      [],     // list of usernames with operator status
    whitelist: false, // if true, only whitelistedPlayers can join
    whitelistedPlayers: [],
    bannedPlayers: [],
    bannedIPs:     [],
  },

  // ── Chat ──────────────────────────────────────────────────
  chat: {
    format:         '<%s> %s',   // %s = username, %s = message
    maxLength:      256,
    cooldownMs:     500,
    commands:       true,
    colors:         true,        // allow §color codes in chat
  },

  // ── Performance ───────────────────────────────────────────
  performance: {
    tps:           20,     // target ticks per second
    chunkRadius:   5,      // chunks sent to player on join
    maxChunkCache: 1024,   // max chunks kept in memory
  },

};

// Validate and freeze the config
(function validateConfig() {
  if (ServerConfig.maxPlayers < 1)  ServerConfig.maxPlayers = 1;
  if (ServerConfig.maxPlayers > 100) ServerConfig.maxPlayers = 100;
  if (![0,1,2,3].includes(ServerConfig.world.difficulty)) ServerConfig.world.difficulty = 1;
  if (![0,1,2,3].includes(ServerConfig.world.defaultGamemode)) ServerConfig.world.defaultGamemode = 0;
})();

if (typeof module !== 'undefined') module.exports = { ServerConfig };
else self.ServerConfig = ServerConfig;
