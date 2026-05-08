# EaglerNet — MC 1.5.2–1.12.2 Browser Server

A Minecraft 1.12.2-compatible game server that runs **100% in the browser** as
pure static HTML/CSS/JS.  No Java, no mods, no port forwarding.

---

## Quick Start

### Option A — Static only (no IP connections)

1. Copy the `public/` folder to any static file host (GitHub Pages, Nginx, etc.)
2. Open `index.html` in a browser
3. Click **Start Server** — the MC server launches in a Web Worker
4. Share a WebRTC offer with players (Connect tab)

### Option B — With Node.js relay (LAN / IP connections)

Requires Node.js 18+ and pnpm.

```bash
pnpm install
pnpm run dev          # starts on PORT (default 8080)
```

Open `http://localhost:8080` in your browser, then click **Start Server**.

Players on the same network can connect with:
```
ws://YOUR_LAN_IP:8080/mc
```

Eaglercraft clients connecting from the internet use:
```
wss://YOUR_DOMAIN/mc
```

---

## Features

| Feature | Details |
|---|---|
| **MC versions** | 1.5.2, 1.6.4, 1.7.10, 1.8.9, 1.9.4, 1.10, 1.11.2, 1.12, 1.12.2 |
| **Protocol** | Real MC protocol 340 (VarInt framing, palette chunks, NBT, login/play) |
| **Terrain** | Simplex noise — plains, forest, desert, taiga, ocean, mountains |
| **Caves** | 3D Perlin cave carving |
| **Ores** | Coal, iron, gold, diamond, redstone, lapis, emerald (MC 1.12.2 tables) |
| **Trees** | Oak, spruce, birch |
| **Connections** | WebRTC DataChannel (EaglercraftX) + WebSocket relay (LAN / IP) |
| **Offline** | Service Worker caches everything after first load |
| **Plugin API** | BOTTLE (EaglerForge alias for backward compat) |

---

## Built-in Plugins

All enabled by default (toggle in `public/config.js → bottle.builtins`):

### WorldEdit
Region selection, fill, copy/paste, undo, shapes.

| Command | Description |
|---|---|
| `//pos1` / `//pos2` | Set selection corners (at your feet) |
| `//set <block>` | Fill selection with a block |
| `//replace <old> <new>` | Replace one block type with another |
| `//walls <block>` | Build the walls of the selection |
| `//floor <block>` | Set the floor |
| `//ceil <block>` | Set the ceiling |
| `//copy` | Copy selection to clipboard |
| `//paste` | Paste clipboard at current position |
| `//undo` | Undo last operation (up to 20 levels) |
| `//sphere <block> <r>` | Filled sphere of radius r |
| `//hsphere <block> <r>` | Hollow sphere |
| `//cyl <block> <r> <h>` | Cylinder |
| `//stack <n> <dir>` | Stack selection n times (north/south/east/west/up/down) |
| `//count [block]` | Count blocks in selection |
| `//expand <dir> <n>` | Expand selection |
| `//info` | Block at feet + selection size |

Block names: `stone`, `grass`, `dirt`, `cobblestone`, `oak_planks`, `glass`,
`sand`, `gravel`, `oak_log`, `oak_leaves`, `obsidian`, `glowstone`, `wool`,
`diamond_block`, `gold_block`, `iron_block`, `netherrack`, `soul_sand`, …
(or use numeric block IDs like `1` for stone, `57` for diamond block)

### WorldGuard
Region protection with flags, members, and owners.

| Command | Description |
|---|---|
| `/rg define <name>` | Define region from WorldEdit selection (op only) |
| `/rg claim <name>` | Claim region as your own (size limited) |
| `/rg remove <name>` | Delete a region |
| `/rg list` | List all regions |
| `/rg info <name>` | Show region details |
| `/rg flag <name> <flag> <value>` | Set a flag |
| `/rg addmember <name> <player>` | Grant build access |
| `/rg addowner <name> <player>` | Grant management access |
| `/rg setpriority <name> <n>` | Overlap priority (higher wins) |
| `/rg here` | Show regions at your position |

Flags: `pvp`, `build`, `entry`, `exit`, `greeting`, `farewell`, `fire`, `mob-spawning`

### Multiverse Core
Multiple world management.

| Command | Description |
|---|---|
| `/mv create <name> [type]` | Create a world (normal/flat/amplified/nether/end) |
| `/mv list` | List all worlds |
| `/mv tp <world>` | Teleport to a world |
| `/mv info [world]` | World details |
| `/mv setspawn` | Set spawn in current world |
| `/mv spawn [world]` | Teleport to world spawn |
| `/mv delete <name>` | Delete a world (op only) |
| `/mv gamemode <world> <0-3>` | Set default gamemode |
| `/mv difficulty <world> <0-3>` | Set difficulty |
| `/mv time <world> <day\|night\|value>` | Set time |
| `/mv alias <world> <alias>` | Create world alias |
| `/mv who [world]` | Players in a world |

---

## Plugin API (BOTTLE)

Plugins are plain `.js` files. Drop them in the **BOTTLE Plugins** tab or place them
in `public/plugins/` and reference them in config.

```js
BOTTLE.register({
  id: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
  description: 'Does something cool',
  author: 'You',
}, {
  'player.join'({ player }) {
    player.sendMessage('§aWelcome, ' + player.username + '!');
  },
  'player.chat'({ player, message }) {
    // return false to cancel
  },
  'server.tick'({ tick }) {
    // runs every 50ms
  },
  command(player, cmd, args) {
    if (cmd !== 'hello') return false;
    player.sendMessage('§aHello!');
    return true;
  },
});
```

### World API (available to plugins as `BOTTLE.world`)

```js
BOTTLE.world.getBlock(x, y, z)         // → state ID
BOTTLE.world.setBlock(x, y, z, stateId) // sets + broadcasts
BOTTLE.world.fillRegion(x1,y1,z1, x2,y2,z2, stateId, [replaceMask])
BOTTLE.world.getSpawn()                 // → { x, y, z }
BOTTLE.world.setSpawn(x, y, z)
BOTTLE.world.seed                       // world seed (number)
BOTTLE.world.time                       // world time (BigInt)

BOTTLE.getPlayers()                     // → PlayerSession[]
BOTTLE.getPlayer(name)                  // → PlayerSession | undefined
BOTTLE.broadcast(message)              // → sends chat to all
```

---

## File Structure

```
eaglernet/
├── README.md
├── package.json
├── src/
│   ├── index.ts          ← Node.js entry (HTTP + WS relay)
│   └── app.ts            ← Express static file server
├── dist/                 ← compiled output (pnpm run build)
└── public/               ← ALL game logic (pure browser JS)
    ├── index.html         ← Open this to launch the dashboard
    ├── config.js          ← Server config (versions, plugins, world)
    ├── sw.js              ← Service worker (offline support)
    ├── manifest.json
    ├── css/main.css
    ├── js/
    │   ├── dashboard.js       ← Admin UI + WS relay client
    │   ├── plugin-api.js      ← BOTTLE API (browser context)
    │   └── mc/
    │       ├── buffer.js      ← VarInt, VarLong, UUID, Position
    │       ├── nbt.js         ← NBT read/write (all 13 tag types)
    │       ├── noise.js       ← Simplex noise
    │       ├── blocks.js      ← Block state IDs (1.12.2 global palette)
    │       ├── world.js       ← World generation + setBlock/getBlock
    │       ├── chunk.js       ← Chunk palette encoder
    │       ├── protocol.js    ← Multi-version state machine
    │       └── server.js      ← Game server Web Worker
    └── plugins/
        ├── worldedit/plugin.js      ← WorldEdit region editor
        ├── worldguard/plugin.js     ← Region protection
        ├── multiverse/plugin.js     ← Multi-world management
        ├── eaglercraftxserver/      ← EaglercraftX WebRTC support
        ├── chatfilter/              ← Profanity filter
        ├── anticheat/               ← Movement checks
        └── example-plugin/          ← Plugin template
```

---

## Connection Architecture

```
EaglercraftX client
   │
   ├─ WebRTC DataChannel ──────────────────→ Browser Web Worker
   │                                         (game server, 20 TPS)
   └─ WebSocket ──→ Node.js WS relay ──────→ Browser Web Worker
        /mc               /mc-host              (ProxyChannel)
```

All MC game logic runs in the browser. Node.js only serves static files and
relays raw bytes between WS clients and the browser host.

---

## License

MIT
