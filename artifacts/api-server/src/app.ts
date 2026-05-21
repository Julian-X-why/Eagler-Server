import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the pure-browser MC 1.12.2 server dashboard as static files.
// ALL game logic runs in the browser — this just serves HTML/CSS/JS files.
const publicDir = path.join(__dirname, "../public");

// Development: prevent browsers from caching index.html so asset version
// query params (?v=N) are always re-evaluated.
const htmlCacheOpts =
  process.env.NODE_ENV !== "production"
    ? { setHeaders: (res: import("http").ServerResponse, path: string) => {
        if (path.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
          res.setHeader("Pragma", "no-cache");
        }
      }}
    : {};

// The proxy routes /api/* → this server without rewriting, so we must
// serve static files under BOTH "/" and "/api/" to cover relative asset
// paths that the browser resolves as /api/css/... , /api/js/... , etc.
app.use("/api", express.static(publicDir, htmlCacheOpts));
app.use(express.static(publicDir, htmlCacheOpts));

app.use("/api", router);

// Fallback: serve index.html for any non-API route
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

export default app;
