import { Router } from "express";
import archiver from "archiver";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../../public");

const downloadRouter = Router();

const BUNDLE_SERVER_JS = `/**
 * EaglerNet — Self-hosted Node.js relay server
 * Serves the browser MC server + provides WS relay for IP-based connections.
 *
 * Quick start:
 *   npm install
 *   node server.js
 *   Open http://localhost:8080
 */
'use strict';
const http     = require('http');
const path     = require('path');
const fs       = require('fs');
const express  = require('express');
const { WebSocketServer } = require('ws');

const PORT    = process.env.PORT || 8080;
const PUBLIC  = path.join(__dirname, 'eaglernet-server');

const app    = express();
const server = http.createServer(app);

// Static files
app.use(express.static(PUBLIC));
app.get('/{*splat}', (req, res) => {
  // SPA fallback — serve index.html for any non-file request
  const fp = path.join(PUBLIC, req.path);
  if (fs.existsSync(fp) && fs.statSync(fp).isFile()) res.sendFile(fp);
  else res.sendFile(path.join(PUBLIC, 'index.html'));
});

// WS relay — EaglercraftX clients connect here
const mcRelay  = new Map(); // clientId → ws
const mcHosts  = new Set(); // host ws connections
let   hostWS   = null;
let   clientId = 0;

const wss = new WebSocketServer({ server, path: '/mc' });
wss.on('connection', (ws, req) => {
  const id = ++clientId;
  mcRelay.set(id, ws);
  console.log('[Relay] Player connected: ' + id);
  if (hostWS) hostWS.send(JSON.stringify({ type: 'player-connect', id, ip: req.socket.remoteAddress }));
  ws.on('message', (data) => {
    if (hostWS && hostWS.readyState === 1) {
      const b64 = Buffer.isBuffer(data) ? data.toString('base64') : Buffer.from(data).toString('base64');
      hostWS.send(JSON.stringify({ type: 'player-data', id, data: b64 }));
    }
  });
  ws.on('close', () => {
    mcRelay.delete(id);
    if (hostWS) hostWS.send(JSON.stringify({ type: 'player-disconnect', id }));
  });
});

// Host WebSocket — the browser server worker connects here
const hss = new WebSocketServer({ server, path: '/mc-host' });
hss.on('connection', (ws) => {
  hostWS = ws;
  console.log('[Relay] Host browser connected.');
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'player-data') {
        const client = mcRelay.get(msg.id);
        if (client && client.readyState === 1) {
          client.send(Buffer.from(msg.data, 'base64'));
        }
      } else if (msg.type === 'player-kick') {
        const client = mcRelay.get(msg.id);
        if (client) client.close();
      }
    } catch {}
  });
  ws.on('close', () => { hostWS = null; console.log('[Relay] Host disconnected.'); });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ███████╗ █████╗  ██████╗ ██╗     ███████╗██████╗ ███╗   ██╗███████╗████████╗');
  console.log('  ██╔════╝██╔══██╗██╔════╝ ██║     ██╔════╝██╔══██╗████╗  ██║██╔════╝╚══██╔══╝');
  console.log('  █████╗  ███████║██║  ███╗██║     █████╗  ██████╔╝██╔██╗ ██║█████╗     ██║   ');
  console.log('  ██╔══╝  ██╔══██║██║   ██║██║     ██╔══╝  ██╔══██╗██║╚██╗██║██╔══╝     ██║   ');
  console.log('  ███████╗██║  ██║╚██████╔╝███████╗███████╗██║  ██║██║ ╚████║███████╗   ██║   ');
  console.log('  ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝   ');
  console.log('');
  console.log('  EaglerNet MC 1.5.2-1.12.2 Browser Server');
  console.log('  Dashboard: http://localhost:' + PORT);
  console.log('  WS relay:  ws://localhost:' + PORT + '/mc');
  console.log('');
});
`;

const BUNDLE_PACKAGE_JSON = JSON.stringify({
  name: "eaglernet-server",
  version: "1.0.0",
  description: "EaglerNet MC 1.5.2–1.12.2 Browser Server — self-hostable package",
  main: "server.js",
  scripts: { start: "node server.js" },
  dependencies: {
    express: "^4.18.0",
    ws: "^8.0.0",
  },
}, null, 2);

const BUNDLE_README = `# EaglerNet Server

A Minecraft 1.5.2–1.12.2 compatible game server that runs **entirely in the browser**.
No game logic runs in Node.js — the server is pure browser JavaScript.

## Quick Start

\`\`\`bash
npm install
npm start
\`\`\`

Then open: **http://localhost:8080**

## Or: Open Directly in Browser

Open \`eaglernet-server/index.html\` directly for WebRTC-only mode (no WS relay, no IP connections).

## Connect with EaglercraftX

1. Start the server (click Start in the dashboard)
2. Copy the WebSocket URL from the **Connect** tab
3. In EaglercraftX: **Multiplayer → Direct Connect** → paste URL → Connect

WebSocket URL (when self-hosted): \`ws://YOUR_IP:8080/mc\`

## Plugin System

All 20 built-in plugins are included. Enable/configure them from the **Plugins** tab.
To load custom plugins: drag a \`.js\` file that calls \`BOTTLE.register()\` onto the Plugins tab.

## Architecture

- **Browser**: Game server runs in a Web Worker (pure JS, no Node.js for game logic)
- **WebRTC**: Peer-to-peer connections (no port forwarding needed)
- **WebSocket**: IP-based connections via Node.js relay (/mc endpoint)
- **BOTTLE**: Plugin loader (20 built-in plugins)

Compatible with **EaglercraftX 1.12.2 U3**.
`;

downloadRouter.get("/download", (req, res) => {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="eaglernet-server.zip"');

  const archive = archiver("zip", { zlib: { level: 6 } });

  archive.on("error", (err) => {
    if (!res.headersSent) res.status(500).send("ZIP generation failed: " + err.message);
  });

  archive.pipe(res);

  // All browser server files
  archive.directory(publicDir, "eaglernet-server");

  // Self-hosting relay server
  archive.append(BUNDLE_SERVER_JS,     { name: "server.js" });
  archive.append(BUNDLE_PACKAGE_JSON,  { name: "package.json" });
  archive.append(BUNDLE_README,        { name: "README.md" });

  archive.finalize();
});

export default downloadRouter;
