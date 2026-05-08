import http from "http";
import { WebSocketServer, type WebSocket } from "ws";
import app from "./app.js";
import { logger } from "./lib/logger.js";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT: "${rawPort}"`);

// ── HTTP server (Express) ────────────────────────────────────
const server = http.createServer(app);

// ── WebSocket relay: two upgrade paths ──────────────────────
//   /mc-host  → the browser dashboard (game server host)
//   /mc       → Eaglercraft/MC clients connecting by IP
const wssHost   = new WebSocketServer({ noServer: true });   // browser host
const wssPlayer = new WebSocketServer({ noServer: true });   // player clients

// Map: playerId → player WebSocket
const players = new Map<string, WebSocket>();
let hostSocket: WebSocket | null = null;
let playerSeq  = 0;

// Route upgrades by path
server.on("upgrade", (req, socket, head) => {
  const url = req.url ?? "/";
  if (url === "/mc-host" || url === "/api/mc-host") {
    wssHost.handleUpgrade(req, socket, head, (ws) => wssHost.emit("connection", ws, req));
  } else if (url === "/mc" || url === "/api/mc" || url === "/") {
    wssPlayer.handleUpgrade(req, socket, head, (ws) => wssPlayer.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

// ── Host connection (browser dashboard) ─────────────────────
wssHost.on("connection", (ws) => {
  if (hostSocket) {
    // Only one host at a time — close the old one
    hostSocket.close(1001, "Replaced by new host");
  }
  hostSocket = ws;
  logger.info("Host connected");

  ws.on("message", (raw) => {
    // Messages from host → forward to appropriate player
    try {
      const msg = JSON.parse(raw.toString()) as {
        type: string; id?: string; data?: string; reason?: string;
      };
      if (msg.type === "player-data" && msg.id && msg.data) {
        const pw = players.get(msg.id);
        if (pw && pw.readyState === 1 /* OPEN */) {
          pw.send(Buffer.from(msg.data, "base64"));
        }
      } else if (msg.type === "player-kick" && msg.id) {
        const pw = players.get(msg.id);
        if (pw) { pw.close(1000, msg.reason ?? "Kicked"); players.delete(msg.id); }
      } else if (msg.type === "host-ready") {
        logger.info("Host ready — accepting player connections");
      }
    } catch (e) {
      logger.warn({ err: e }, "Bad host message");
    }
  });

  ws.on("close", () => {
    if (hostSocket === ws) {
      hostSocket = null;
      logger.info("Host disconnected — closing all player connections");
      for (const [id, pw] of players) {
        pw.close(1001, "Host gone");
        players.delete(id);
      }
    }
  });
  ws.on("error", (e) => logger.warn({ err: e }, "Host WS error"));
});

// ── Player connections (Eaglercraft / MC clients) ────────────
wssPlayer.on("connection", (ws, req) => {
  if (!hostSocket || hostSocket.readyState !== 1 /* OPEN */) {
    ws.close(1013, "Server not ready — start the server in the dashboard first");
    return;
  }

  const id = `p${++playerSeq}_${Date.now()}`;
  const ip = (req.headers["x-forwarded-for"] as string ?? req.socket.remoteAddress ?? "?")
    .split(",")[0]!.trim();
  players.set(id, ws);

  logger.info({ id, ip }, "Player connected via WS");

  // Notify host of new player
  hostSocket.send(JSON.stringify({ type: "player-connect", id, ip }));

  // Forward binary data from player → host
  ws.on("message", (raw, isBinary) => {
    if (!hostSocket || hostSocket.readyState !== 1) return;
    const buf = isBinary ? (raw as Buffer) : Buffer.from(raw.toString());
    hostSocket.send(JSON.stringify({
      type: "player-data",
      id,
      data: buf.toString("base64"),
    }));
  });

  ws.on("close", () => {
    players.delete(id);
    if (hostSocket?.readyState === 1) {
      hostSocket.send(JSON.stringify({ type: "player-disconnect", id }));
    }
    logger.info({ id }, "Player disconnected");
  });
  ws.on("error", (e) => logger.warn({ id, err: e }, "Player WS error"));
});

// ── Start ────────────────────────────────────────────────────
server.listen(port, () => {
  logger.info({ port }, "EaglerNet listening — WS relay active on /mc");
});
