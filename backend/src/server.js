import express from "express";
import cookieParser from "cookie-parser";
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

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const BASE_PATH = process.env.BASE_PATH || "/aif";

const app = express();
app.use(express.json());
app.use(cookieParser());

// Health check (no auth)
app.get(`${BASE_PATH}/api/health`, (req, res) => res.json({ status: "ok" }));

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

async function start() {
  await recoverOnStartup();
  app.listen(PORT, () => {
    console.log(`AIF Portal listening on :${PORT}${BASE_PATH}`);
  });
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
