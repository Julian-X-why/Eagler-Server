import { Router } from "express";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const archiver: any = _require("archiver");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

const STANDALONE_SERVER = `#!/usr/bin/env node
// EaglerNet standalone server — serves the MC dashboard + WS relay
// Usage: node server.js [port]
const http  = require('http');
const path  = require('path');
const fs    = require('fs');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.argv[2] || process.env.PORT || '8080', 10);
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html':'text/html','.css':'text/css','.js':'application/javascript',
  '.json':'application/json','.png':'image/png','.ico':'image/x-icon',
  '.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff',
};

const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/' || !path.extname(url)) url = '/index.html';
  const file = path.join(PUBLIC, url);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// WS relay: EaglercraftX → this server → MC Web Worker
const wss = new WebSocketServer({ server, path: '/mc' });
const players = new Map();
let workerWs = null;

// Host connection (the server page itself connects here to register as host)
const wsHost = new WebSocketServer({ server, path: '/mc-host' });
wsHost.on('connection', ws => {
  workerWs = ws;
  console.log('[WS] Host connected');
  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'ws-send') {
        const pc = players.get(msg.id);
        if (pc?.readyState === 1) pc.send(Buffer.from(msg.data));
      } else if (msg.type === 'ws-disconnect') {
        const pc = players.get(msg.id);
        if (pc) { pc.close(); players.delete(msg.id); }
      }
    } catch {}
  });
  ws.on('close', () => { workerWs = null; });
});

wss.on('connection', (ws, req) => {
  const id = Math.random().toString(36).slice(2);
  players.set(id, ws);
  const ip = req.socket.remoteAddress || 'unknown';
  console.log('[WS] Player connected:', id, ip);
  if (workerWs?.readyState === 1)
    workerWs.send(JSON.stringify({ type: 'ws-player-connect', id, ip }));
  ws.on('message', data => {
    if (workerWs?.readyState === 1)
      workerWs.send(JSON.stringify({ type: 'ws-player-data', id, data: Array.from(new Uint8Array(data)) }));
  });
  ws.on('close', () => {
    players.delete(id);
    if (workerWs?.readyState === 1)
      workerWs.send(JSON.stringify({ type: 'ws-player-disconnect', id }));
  });
});

server.listen(PORT, () => console.log('EaglerNet running on http://localhost:' + PORT));
`;

const STANDALONE_PKG = JSON.stringify({
  name: "eaglernet-server",
  version: "1.0.0",
  description: "EaglerNet MC 1.5.2-1.12.2 browser server — standalone",
  main: "server.js",
  scripts: { start: "node server.js" },
  dependencies: { ws: "^8.18.0" },
  engines: { node: ">=18" },
}, null, 2);

const README = `# EaglerNet — MC 1.5.2–1.12.2 Browser Server

## Quick Start

1. Install dependencies:  \`npm install\`
2. Start the server:      \`node server.js [port]\`
3. Open your browser:     \`http://localhost:8080\`
4. Click **[ Start Server ]** in the dashboard.
5. Connect via EaglercraftX: **Multiplayer > Direct Connect** → paste the WS URL shown in the Connect tab.

## Architecture

- All Minecraft server logic runs in the browser as a Web Worker (pure JavaScript, no build step).
- Node.js serves static files and provides a WebSocket relay for IP-based connections.
- WebRTC DataChannels are also supported for peer-to-peer connections without port forwarding.

## Plugin System (BOTTLE v3)

Drop a \`.js\` file in \`public/plugins/<name>/plugin.js\` and call:

\`\`\`js
BOTTLE.register({ id: 'myplugin', name: 'My Plugin', version: '1.0', author: 'You' }, {
  'player.join'({ player }) { player.sendMessage('§aWelcome!'); },
  'player.chat'({ player, message }) { /* return false to cancel */ },
});
\`\`\`

## Supported Versions

- 1.5.2 (protocol 61), 1.6.4 (78), 1.7.10 (5), 1.8.9 (47)
- 1.9.4 (110), 1.10 (210), 1.11.2 (316), 1.12 (335), **1.12.2 (340) — native**
`;

router.get("/download", (_req, res) => {
  const publicDir = path.resolve(__dirname, "../../public");

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="eaglernet-server.zip"');

  const archive = archiver("zip", { zlib: { level: 6 } });

  archive.on("error", (err) => {
    if (!res.headersSent) res.status(500).send(err.message);
  });

  archive.pipe(res);

  archive.directory(publicDir, "public");
  archive.append(STANDALONE_SERVER, { name: "server.js" });
  archive.append(STANDALONE_PKG,    { name: "package.json" });
  archive.append(README,             { name: "README.md" });

  archive.finalize();
});

export default router;
