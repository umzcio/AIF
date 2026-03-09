import express from "express";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { loadEnv } from "./agents/shared/cli.js";
import authMiddleware from "./auth/middleware.js";
import authRoutes from "./routes/auth.js";
import intakeRoutes from "./routes/intake.js";
import registryRoutes from "./routes/registry.js";
import pipelineRoutes from "./routes/pipeline.js";
import reportRoutes from "./routes/reports.js";
import reviewRoutes from "./routes/review.js";
import adminRoutes from "./routes/admin.js";
import { recoverOnStartup } from "./pipeline/queue.js";
import pool from "./db/pool.js";

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const BASE_PATH = process.env.BASE_PATH || "/aif";

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(cookieParser());

// Rate limiting
app.use(`${BASE_PATH}/api/auth`, rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many auth requests, try again later" } }));
app.use(`${BASE_PATH}/api`, rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests, try again later" } }));

// Health check (no auth) — includes DB connectivity
app.get(`${BASE_PATH}/api/health`, async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected", uptime: Math.round(process.uptime()) });
  } catch (err) {
    res.status(503).json({ status: "error", database: "disconnected", error: err.message });
  }
});

// Mount routes under base path
const api = express.Router();
api.use(authMiddleware);
api.use("/auth", authRoutes);
api.use("/intake", intakeRoutes);
api.use("/registry", registryRoutes);
api.use("/pipeline", pipelineRoutes);
api.use("/reports", reportRoutes);
api.use("/review", reviewRoutes);
api.use("/admin", adminRoutes);
app.use(`${BASE_PATH}/api`, api);

// Serve frontend static files (built Vite output)
const frontendDist = resolve(__dirname, "../../frontend/dist");
if (existsSync(frontendDist)) {
  app.use(BASE_PATH, express.static(frontendDist));
  // SPA fallback
  app.get(`${BASE_PATH}/*`, (req, res) => {
    res.sendFile(resolve(frontendDist, "index.html"));
  });
}

let server;

async function start() {
  await recoverOnStartup();
  server = app.listen(PORT, () => {
    console.log(`AIF Portal listening on :${PORT}${BASE_PATH}`);
  });
}

function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  if (server) {
    server.close(async () => {
      try { await pool.end(); } catch {}
      process.exit(0);
    });
    // Force exit after 30s if connections don't close
    setTimeout(() => process.exit(1), 30000).unref();
  } else {
    process.exit(0);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
