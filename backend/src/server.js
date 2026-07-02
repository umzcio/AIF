import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { loadEnv } from "./agents/shared/cli.js";
import log from "./logger.js";
import authMiddleware from "./auth/middleware.js";
import authRoutes from "./routes/auth.js";
import intakeRoutes from "./routes/intake.js";
import registryRoutes from "./routes/registry.js";
import pipelineRoutes from "./routes/pipeline.js";
import reportRoutes from "./routes/reports.js";
import reviewRoutes from "./routes/review.js";
import adminRoutes from "./routes/admin.js";
import analyticsRoutes from "./routes/analytics.js";
import notificationRoutes from "./routes/notifications.js";
import { recoverOnStartup } from "./pipeline/queue.js";
import pool from "./db/pool.js";
import { INSTITUTION_NAME, INSTITUTION_DOMAIN } from "./config.js";
import { verifySmtp } from "./notifications.js";

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const BASE_PATH = process.env.BASE_PATH || "/aif";

const app = express();
app.set("trust proxy", 1);

// Security headers via helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // breaks font loading if true
}));

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// CSRF protection: double-submit cookie pattern
// On every request, set a CSRF token cookie if missing.
// State-changing requests (POST/PUT/PATCH/DELETE) must include x-csrf-token header matching the cookie.
const CSRF_COOKIE = "aif_csrf";
app.use((req, res, next) => {
  // Set CSRF cookie if not present
  if (!req.cookies[CSRF_COOKIE]) {
    const token = crypto.randomBytes(24).toString("hex");
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false, // JS must read it
      secure: true,
      sameSite: "lax",
      path: BASE_PATH,
      maxAge: 86400 * 1000,
    });
    req.csrfToken = token;
  } else {
    req.csrfToken = req.cookies[CSRF_COOKIE];
  }

  // Skip CSRF check for safe methods, auth callbacks (redirects), SSE streams, and health
  const exempt = ["GET", "HEAD", "OPTIONS"];
  if (exempt.includes(req.method)) return next();
  if (req.path.includes("/auth/login") || req.path.includes("/auth/callback")) return next();
  if (req.path.endsWith("/stream")) return next();
  if (req.path.includes("/health")) return next();

  // File uploads via multipart may not include the header — check form field or header
  const headerToken = req.headers["x-csrf-token"];
  if (headerToken && headerToken === req.csrfToken) return next();

  // For multipart/form-data, also accept _csrf in body
  if (req.body?._csrf && req.body._csrf === req.csrfToken) return next();

  return res.status(403).json({ error: "CSRF token mismatch" });
});

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

// Public config endpoint — frontend reads institution-specific values at runtime
app.get(`${BASE_PATH}/api/config`, (req, res) => {
  res.json({ institutionName: INSTITUTION_NAME, institutionDomain: INSTITUTION_DOMAIN, basePath: BASE_PATH });
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
api.use("/analytics", analyticsRoutes);
api.use("/notifications", notificationRoutes);
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

// Catch-all error middleware — must be registered after all routes and the
// static/SPA fallback. Routes rejections funneled here via wrap() (see
// middleware/async-handler.js) instead of letting them crash the process.
app.use((err, req, res, next) => {
  // Postgres invalid text representation (e.g. malformed UUID path param)
  if (err && err.code === "22P02") {
    return res.status(400).json({ error: "Invalid identifier" });
  }
  log.error("Unhandled request error", { path: req.path, method: req.method, error: err?.message });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal error" });
});

// Backstop: log-and-continue instead of letting an unhandled rejection
// anywhere in the process (outside the Express request lifecycle) crash it.
process.on("unhandledRejection", (reason) => {
  log.error("Unhandled promise rejection (backstop)", { reason: reason?.message || String(reason) });
});

let server;

/** Validate required env vars and external dependencies before accepting traffic. */
async function preflight() {
  const issues = [];
  const warnings = [];

  // Required for server operation
  if (!process.env.JWT_SECRET && process.env.JWT_SECRET !== "") {
    // jwt.js handles this with process.exit — this is a backup check
  }
  if (!process.env.DATABASE_URL) issues.push("DATABASE_URL not set");

  // Required for pipeline (warn, don't block server)
  const pipelineKeys = {
    OPENAI_API_KEY: "Codex (GPT-5.4, pass 1)",
    OPENROUTER_API_KEY: "MiniMax + MiMo + Kimi + GLM via OpenRouter (passes 2-5)",
    ANTHROPIC_API_KEY: "Claude Code CLI (synthesis)",
  };
  for (const [key, label] of Object.entries(pipelineKeys)) {
    if (!process.env[key]) warnings.push(`${key} missing — ${label} passes will fail`);
  }

  // Check HECVAT template
  const hecvatPath = process.env.HECVAT_TEMPLATE_PATH || resolve(__dirname, "../../hecvat415.xlsx");
  if (!existsSync(hecvatPath)) warnings.push(`HECVAT template not found at ${hecvatPath}`);

  // DB connectivity
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    issues.push(`Database unreachable: ${err.message}`);
  }

  // Report critical issues
  if (issues.length > 0) {
    log.error("Preflight failed", { issues });
    process.exit(1);
  }

  // Verify SMTP connectivity before logging warnings
  const smtp = await verifySmtp();
  if (smtp.configured && !smtp.reachable) {
    warnings.push(`SMTP configured but unreachable: ${smtp.error}`);
  }

  if (warnings.length > 0) {
    log.warn("Preflight warnings", { warnings });
  }

  const authMode = process.env.AUTH_PROVIDER || (process.env.AUTH_BYPASS === "true" ? "bypass" : "cas");
  const emailStatus = !smtp.configured ? "disabled" : smtp.reachable ? `${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 25}` : "unreachable";
  const apiKeyCount = Object.keys(pipelineKeys).filter(k => process.env[k]).length;
  log.info("Preflight OK", { auth: authMode, email: emailStatus, pipelineKeys: `${apiKeyCount}/${Object.keys(pipelineKeys).length}` });
}

async function start() {
  await preflight();
  await recoverOnStartup();
  server = app.listen(PORT, () => {
    log.info("Server listening", { port: PORT, basePath: BASE_PATH });
  });
}

function shutdown(signal) {
  log.info("Shutdown initiated", { signal });
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
  log.error("Failed to start", { error: err.message });
  process.exit(1);
});
