import { Router } from "express";
import pool from "../db/pool.js";
import { requireRole } from "../auth/middleware.js";

const router = Router();

// All analytics routes require admin role
router.use(requireRole("admin"));

/**
 * GET /analytics/overview
 * High-level pipeline performance stats.
 */
router.get("/overview", async (req, res) => {
  const days = Math.min(Math.max(1, parseInt(req.query.days) || 90), 365);

  const [
    { rows: [runStats] },
    { rows: [costStats] },
    { rows: [passStats] },
    { rows: modelPerf },
    { rows: recentRuns },
  ] = await Promise.all([
    // Pipeline run stats
    pool.query(`
      SELECT
        COUNT(*) as total_runs,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (WHERE status = 'completed') as avg_duration_seconds,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)))
          FILTER (WHERE status = 'completed') as median_duration_seconds,
        AVG(retry_count) FILTER (WHERE status IN ('completed', 'failed')) as avg_retries
      FROM pipeline_runs WHERE queued_at >= NOW() - make_interval(days => $1)
    `, [days]),
    // Cost stats from pipeline_metrics
    pool.query(`
      SELECT
        COALESCE(SUM(estimated_cost_usd), 0) as total_cost,
        COALESCE(AVG(estimated_cost_usd), 0) as avg_cost_per_run,
        COALESCE(AVG(json_parse_failures), 0) as avg_parse_failures
      FROM pipeline_metrics pm
      JOIN pipeline_runs pr ON pm.run_id = pr.id
      WHERE pr.queued_at >= NOW() - make_interval(days => $1)
    `, [days]),
    // Pass-level stats
    pool.query(`
      SELECT
        COUNT(*) as total_passes,
        COUNT(*) FILTER (WHERE pr2.status = 'completed') as passes_completed,
        COUNT(*) FILTER (WHERE pr2.status = 'failed') as passes_failed,
        COUNT(*) FILTER (WHERE pr2.json_parsed = false AND pr2.status = 'completed') as json_parse_failures,
        AVG(pr2.elapsed_seconds) FILTER (WHERE pr2.status = 'completed') as avg_pass_seconds,
        AVG(attempt) as avg_attempts
      FROM pass_results pr2
      JOIN pipeline_runs pr ON pr2.run_id = pr.id
      WHERE pr.queued_at >= NOW() - make_interval(days => $1)
    `, [days]),
    // Per-model performance
    pool.query(`
      SELECT
        pr2.model_name,
        COUNT(*) as total_runs,
        COUNT(*) FILTER (WHERE pr2.status = 'completed') as successes,
        COUNT(*) FILTER (WHERE pr2.status = 'failed') as failures,
        COUNT(*) FILTER (WHERE pr2.json_parsed = false AND pr2.status = 'completed') as parse_failures,
        AVG(pr2.elapsed_seconds) FILTER (WHERE pr2.status = 'completed') as avg_seconds,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pr2.elapsed_seconds)
          FILTER (WHERE pr2.status = 'completed') as median_seconds,
        MIN(pr2.elapsed_seconds) FILTER (WHERE pr2.status = 'completed') as min_seconds,
        MAX(pr2.elapsed_seconds) FILTER (WHERE pr2.status = 'completed') as max_seconds,
        AVG(pr2.output_bytes) FILTER (WHERE pr2.status = 'completed') as avg_output_bytes,
        COUNT(*) FILTER (WHERE pr2.error_category = 'timeout') as timeouts,
        COUNT(*) FILTER (WHERE pr2.error_category = 'api_error') as api_errors
      FROM pass_results pr2
      JOIN pipeline_runs pr ON pr2.run_id = pr.id
      WHERE pr.queued_at >= NOW() - make_interval(days => $1)
      GROUP BY pr2.model_name
      ORDER BY pr2.model_name
    `, [days]),
    // Recent runs with metrics
    pool.query(`
      SELECT pr.id, pr.status, pr.track, pr.queued_at, pr.started_at, pr.completed_at,
        pr.retry_count, t.name as tool_name,
        pm.total_elapsed_seconds, pm.estimated_cost_usd, pm.models_succeeded, pm.models_failed,
        pm.json_parse_failures
      FROM pipeline_runs pr
      LEFT JOIN pipeline_metrics pm ON pr.id = pm.run_id
      LEFT JOIN tools t ON pr.tool_id = t.id
      WHERE pr.queued_at >= NOW() - make_interval(days => $1)
      ORDER BY pr.queued_at DESC
      LIMIT 50
    `, [days]),
  ]);

  res.json({
    period: { days },
    runs: {
      total: parseInt(runStats.total_runs),
      completed: parseInt(runStats.completed),
      failed: parseInt(runStats.failed),
      cancelled: parseInt(runStats.cancelled),
      avgDurationSeconds: parseFloat(runStats.avg_duration_seconds) || null,
      medianDurationSeconds: parseFloat(runStats.median_duration_seconds) || null,
      avgRetries: parseFloat(runStats.avg_retries) || 0,
    },
    cost: {
      total: parseFloat(costStats.total_cost),
      avgPerRun: parseFloat(costStats.avg_cost_per_run),
    },
    passes: {
      total: parseInt(passStats.total_passes),
      completed: parseInt(passStats.passes_completed),
      failed: parseInt(passStats.passes_failed),
      jsonParseFailures: parseInt(passStats.json_parse_failures),
      avgSeconds: parseFloat(passStats.avg_pass_seconds) || null,
      avgAttempts: parseFloat(passStats.avg_attempts) || 1,
    },
    models: modelPerf.map(m => ({
      name: m.model_name,
      totalRuns: parseInt(m.total_runs),
      successes: parseInt(m.successes),
      failures: parseInt(m.failures),
      parseFailures: parseInt(m.parse_failures),
      successRate: parseInt(m.total_runs) > 0 ? parseInt(m.successes) / parseInt(m.total_runs) : 0,
      avgSeconds: parseFloat(m.avg_seconds) || null,
      medianSeconds: parseFloat(m.median_seconds) || null,
      minSeconds: parseFloat(m.min_seconds) || null,
      maxSeconds: parseFloat(m.max_seconds) || null,
      avgOutputBytes: parseInt(m.avg_output_bytes) || 0,
      timeouts: parseInt(m.timeouts),
      apiErrors: parseInt(m.api_errors),
    })),
    recentRuns,
  });
});

/**
 * GET /analytics/model/:modelName
 * Detailed per-model history (pass-level detail).
 */
router.get("/model/:modelName", async (req, res) => {
  const modelName = req.params.modelName;
  const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 50), 200);
  const offset = Math.max(0, parseInt(req.query.offset) || 0);

  const { rows: passes } = await pool.query(
    `SELECT pr2.*, pr.track, t.name as tool_name, pr.status as run_status
     FROM pass_results pr2
     JOIN pipeline_runs pr ON pr2.run_id = pr.id
     LEFT JOIN tools t ON pr.tool_id = t.id
     WHERE pr2.model_name = $1
     ORDER BY pr2.created_at DESC
     LIMIT $2 OFFSET $3`,
    [modelName, limit, offset]
  );

  const { rows: [{ count }] } = await pool.query(
    "SELECT COUNT(*) FROM pass_results WHERE model_name = $1",
    [modelName]
  );

  // Error breakdown
  const { rows: errorBreakdown } = await pool.query(
    `SELECT error_category, COUNT(*) as count
     FROM pass_results WHERE model_name = $1 AND status = 'failed'
     GROUP BY error_category ORDER BY count DESC`,
    [modelName]
  );

  res.json({ passes, total: parseInt(count), limit, offset, errorBreakdown });
});

/**
 * GET /analytics/run/:runId
 * Per-run timing breakdown (Gantt-style data).
 */
router.get("/run/:runId", async (req, res) => {
  const runId = req.params.runId;

  const [
    { rows: [run] },
    { rows: agents },
    { rows: passes },
    { rows: [metrics] },
  ] = await Promise.all([
    pool.query(
      `SELECT pr.*, t.name as tool_name FROM pipeline_runs pr LEFT JOIN tools t ON pr.tool_id = t.id WHERE pr.id = $1`,
      [runId]
    ),
    pool.query(
      "SELECT * FROM agent_results WHERE run_id = $1 ORDER BY agent_index",
      [runId]
    ),
    pool.query(
      "SELECT * FROM pass_results WHERE run_id = $1 ORDER BY created_at",
      [runId]
    ),
    pool.query(
      "SELECT * FROM pipeline_metrics WHERE run_id = $1",
      [runId]
    ),
  ]);

  if (!run) return res.status(404).json({ error: "Run not found" });

  res.json({ run, agents, passes, metrics: metrics || null });
});

/**
 * GET /analytics/trends
 * Time-series data for pipeline performance over time.
 */
router.get("/trends", async (req, res) => {
  const days = Math.min(Math.max(7, parseInt(req.query.days) || 30), 365);
  const bucket = days <= 30 ? "day" : "week";

  const { rows: timeSeries } = await pool.query(`
    SELECT
      date_trunc($1, pr.queued_at) as period,
      COUNT(*) as runs,
      COUNT(*) FILTER (WHERE pr.status = 'completed') as completed,
      COUNT(*) FILTER (WHERE pr.status = 'failed') as failed,
      AVG(pm.total_elapsed_seconds) as avg_duration,
      SUM(pm.estimated_cost_usd) as total_cost,
      AVG(pm.estimated_cost_usd) as avg_cost
    FROM pipeline_runs pr
    LEFT JOIN pipeline_metrics pm ON pr.id = pm.run_id
    WHERE pr.queued_at >= NOW() - make_interval(days => $2)
    GROUP BY period
    ORDER BY period
  `, [bucket, days]);

  // Per-model trend
  const { rows: modelTrends } = await pool.query(`
    SELECT
      date_trunc($1, pr.queued_at) as period,
      pr2.model_name,
      COUNT(*) as runs,
      COUNT(*) FILTER (WHERE pr2.status = 'completed') as completed,
      AVG(pr2.elapsed_seconds) FILTER (WHERE pr2.status = 'completed') as avg_seconds
    FROM pass_results pr2
    JOIN pipeline_runs pr ON pr2.run_id = pr.id
    WHERE pr.queued_at >= NOW() - make_interval(days => $2)
    GROUP BY period, pr2.model_name
    ORDER BY period, pr2.model_name
  `, [bucket, days]);

  res.json({
    period: { days, bucket },
    timeSeries: timeSeries.map(r => ({
      period: r.period,
      runs: parseInt(r.runs),
      completed: parseInt(r.completed),
      failed: parseInt(r.failed),
      avgDuration: parseFloat(r.avg_duration) || null,
      totalCost: parseFloat(r.total_cost) || 0,
      avgCost: parseFloat(r.avg_cost) || 0,
    })),
    modelTrends: modelTrends.map(r => ({
      period: r.period,
      model: r.model_name,
      runs: parseInt(r.runs),
      completed: parseInt(r.completed),
      avgSeconds: parseFloat(r.avg_seconds) || null,
    })),
  });
});

export default router;
