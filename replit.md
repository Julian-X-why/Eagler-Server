# EaglerNet — MC 1.5.2–1.12.2 Browser Server

A Minecraft 1.5.2–1.12.2 compatible game server that runs **entirely in the browser** as pure static HTML/CSS/JS. No Node.js required for any game logic. Works offline, on Chromebooks, and on restricted networks.

## Run & Operate

- Open `/` (served by Express) to access the admin dashboard
- Click **Start Server** in the dashboard — the MC server launches in a Web Worker
- Node.js Express only serves static files + WS relay for IP connections
- `pnpm --filter @workspace/api-server run dev` — start the file server (port 8080)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (static file serving + WebSocket relay only)
- Browser: Vanilla JS Web Worker (game server), WebRTC DataChannels (player connections)
- No build step for browser JS — plain `.js` files loaded directly

## Where things live

```
artifacts/api-server/
├── public/               ← ALL game logic lives here (pure browser JS)
│   ├── index.html        ← Admin dashboard (open this)
│   ├── sw.js             ← Service worker (offline support, cache v6)
│   ├── css/main.css
│   ├── js/
│   │   ├── dashboard.js       ← Admin UI
│   │   ├── plugin-api.js      ← BOTTLE plugin API (EaglerForge alias kept for compat)
│   │   └── mc/
│   │       ├── buffer.js      ← MC data types (VarInt, VarLong, UUID, Position, Angle)
│   │       ├── nbt.js         ← NBT read/write (all 13 tag types)
│   │       ├── noise.js       ← Simplex noise (terrain generation)
│   │       ├── blocks.js      ← Block state IDs (1.12.2 global palette)
│   │       ├── world.js       ← World generation (terrain, caves, ores, trees)
│   │       ├── chunk.js       ← Chunk section palette encoder (1.9+ and legacy)
│   │       ├── protocol.js    ← Full multi-version protocol (1.5.2–1.12.2)
│   │       └── server.js      ← Game server Web Worker (tick loop, WebRTC, entity system)
│   └── plugins/
│       ├── eaglercraftxserver/plugin.js
│       ├── chatfilter/plugin.js
│       ├── anticheat/plugin.js
│       ├── worldedit/plugin.js
│       ├── worldguard/plugin.js
│       └── multiverse/plugin.js
└── src/
    └── app.ts            ← Express: static files + WS relay at /mc and /mc-host
```

## Architecture decisions

- **Pure browser JS, no build step** — game code loads as plain `.js` script imports in Web Worker
- **Web Worker for server** — MC server logic runs on background thread, never blocks UI
- **WebRTC DataChannels** — players connect peer-to-peer; works behind NAT/firewalls without port forwarding
- **BOTTLE plugin system** — plugins are plain `.js` files; `self.EaglerForge` aliased to `self.BOTTLE` for compatibility. EaglerForge mods are NOT supported.
- **Multi-version protocol** — real per-version packet ID tables: v17 (1.7.x), v18 (1.8.9), v19 (1.9/1.9.4), v110 (1.10/1.11), v112 (1.12/1.12.2)
- **Block state IDs** — `blockId * 16 + metadata` (MC 1.12.2 pre-flattening format)

## Full Gameplay Features

- **Players see each other** — Spawn Named Entity (0x0C/1.8) and Spawn Player (0x05/1.9+) sent on join; Destroy Entities on leave
- **Movement broadcasting** — Entity Relative Move + Entity Teleport (delta×32 byte for 1.8, delta×4096 short for 1.9+); Entity Head Look; 10Hz tick-based smooth broadcast
- **Block breaking** — Player Digging handled: instant in creative (status 0), finish-packet in survival (status 2)
- **Block placing** — Player Block Placement with held item tracking (Creative Inventory Action + Held Item Change)
- **Arm swing** — Animation C→S relayed as Animation S→C to nearby players
- **Inventory** — Empty Window Items packet sent on join (prevents client hang)
- **Proper chunk streaming** — Full radius of new chunks loaded when crossing chunk border (not just one)
- **Version-correct C→S remapping** — proto-specific switch: 340 (1.12.2), 335/338 (1.12/1.12.1), 107–316 (1.9–1.11), 47 (1.8), 4/5 (1.7)

## Product

- Admin dashboard at `/` — console, player list, plugin manager, WebRTC connect, world info
- MC 1.5.2–1.12.2 server with real terrain generation (simplex noise, caves, ores, trees, biomes)
- BOTTLE plugin API (player/chat/block events, world API)
- Offline support via Service Worker
- Compatible with EaglercraftX (WebRTC DataChannel) and Eaglercraft 1.8 (WebSocket relay)

## User preferences

- NO Node.js for game logic — all MC server code must be pure browser JavaScript
- Works from index.html — no build step, no npm, no install required for players
- Real MC 1.12.2 protocol (protocol version 340), not simulated
- BOTTLE = plugin loader. NOT EaglerForge. `self.EaglerForge = self.BOTTLE` alias kept only for plugin API compatibility
- EaglerForge mods explicitly NOT supported

## Gotchas

- WebRTC requires HTTPS or localhost — the service worker handles offline after first load
- The `importScripts()` chain in `server.js` must match the file paths exactly
- Block state IDs use `blockId * 16 + metadata` (MC 1.12.2 pre-flattening format)
- Legacy (1.5.2/1.6.x) uses 2-byte BE short framing; modern (1.7+) uses VarInt framing
- Asset cache version: `?v=7` on CSS/JS in index.html; SW cache `eaglernet-v6`
- Eaglercraft 1.8 clients connect via WebSocket relay; EaglercraftX connects via WebRTC DataChannel

## Pointers

- MC 1.12.2 protocol spec: https://wiki.vg/index.php?title=Protocol&oldid=13223
- MC 1.8 protocol spec: https://wiki.vg/index.php?title=Protocol&oldid=7368
- EaglercraftX WebRTC: uses standard RTCDataChannel with binary ordered mode
