# EaglerNet — MC 1.12.2 Browser Server

A Minecraft 1.12.2-compatible game server that runs **entirely in the browser** as pure static HTML/CSS/JS. No Node.js required for any game logic. Works offline, on Chromebooks, and on restricted networks.

## Run & Operate

- Open `/` (served by Express) to access the admin dashboard
- Click **Start Server** in the dashboard — the MC server launches in a Web Worker
- Node.js Express only serves the static files; game logic is 100% browser JS
- `pnpm --filter @workspace/api-server run dev` — start the file server (port 8080)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (static file serving only)
- Browser: Vanilla JS Web Worker (game server), WebRTC DataChannels (player connections)
- No build step for browser JS — plain `.js` files loaded directly

## Where things live

```
artifacts/api-server/
├── public/               ← ALL game logic lives here (pure browser JS)
│   ├── index.html        ← Admin dashboard (open this)
│   ├── sw.js             ← Service worker (offline support)
│   ├── css/main.css
│   ├── js/
│   │   ├── dashboard.js       ← Admin UI
│   │   ├── plugin-api.js      ← EaglerForge plugin API
│   │   └── mc/
│   │       ├── buffer.js      ← MC data types (VarInt, VarLong, UUID, Position)
│   │       ├── nbt.js         ← NBT read/write (all 13 tag types)
│   │       ├── noise.js       ← Simplex noise (terrain generation)
│   │       ├── blocks.js      ← Block state IDs (1.12.2 global palette)
│   │       ├── world.js       ← World generation (terrain, caves, ores, trees)
│   │       ├── chunk.js       ← Chunk section palette encoder
│   │       ├── protocol.js    ← MC 1.12.2 protocol (state machine, protocol 340)
│   │       └── server.js      ← Game server Web Worker (tick loop, WebRTC)
│   └── plugins/
│       └── example-plugin/plugin.js
└── src/
    └── app.ts            ← Express: serves public/ as static files only
```

## Architecture decisions

- **Pure browser JS, no build step** — game code loads as plain `.js` script imports in Web Worker
- **Web Worker for server** — MC 1.12.2 server logic runs on background thread, never blocks UI
- **WebRTC DataChannels** — players connect peer-to-peer; works behind NAT/firewalls without port forwarding
- **EaglerForge plugin system** — plugins are plain `.js` files dropped into the dashboard; they run in the Web Worker alongside server logic
- **Protocol version 340** — real MC 1.12.2 protocol: VarInt framing, palette chunk format, NBT, login/play state machine

## Product

- Admin dashboard at `/` — console, player list, plugin manager, WebRTC connect, world info
- MC 1.12.2 server with real terrain generation (simplex noise, caves, ores, trees, biomes)
- EaglerForge-compatible plugin API (player events, chat events, commands)
- Offline support via Service Worker
- Compatible with EaglercraftX (WebRTC DataChannel connections)

## User preferences

- NO Node.js for game logic — all MC server code must be pure browser JavaScript
- Works from index.html — no build step, no npm, no install required for players
- Real MC 1.12.2 protocol (protocol version 340), not simulated

## Gotchas

- WebRTC requires HTTPS or localhost — the service worker handles offline after first load
- The `importScripts()` chain in `server.js` must match the file paths exactly
- Block state IDs use `blockId * 16 + metadata` (MC 1.12.2 pre-flattening format)
- Eaglercraft clients connect via WebSocket; EaglercraftX connects via WebRTC DataChannel

## Pointers

- MC 1.12.2 protocol spec: https://wiki.vg/index.php?title=Protocol&oldid=13223
- EaglercraftX WebRTC: uses standard RTCDataChannel with binary ordered mode
