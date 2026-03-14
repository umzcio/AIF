/**
 * opencode Agent Runner
 *
 * Thin wrapper that spawns `opencode run --agent <name>` instead of
 * the tool-specific CLI dispatch in cli.js.
 */

import { spawn } from "child_process";
import { existsSync, symlinkSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { activeProcesses, MODEL_TIMEOUTS } from "../agents/shared/cli.js";
import log from "../logger.js";

const OPENCODE_CONFIG = process.env.OPENCODE_CONFIG_PATH || "/home/zach/opencode.json";

/**
 * Run an opencode agent definition against a codebase.
 *
 * @param {string} agentName - Agent name (matches .opencode/agent/<name>.md)
 * @param {string} codebasePath - Codebase directory
 * @param {object} opts
 * @param {string} [opts.runId] - Pipeline run ID for process tracking
 * @param {AbortSignal} [opts.signal] - AbortSignal for cancellation
 * @param {number} [opts.timeoutMs] - Timeout override
 * @param {function} [opts.onOutput] - Streaming callback: (lines: string[]) => void
 * @returns {Promise<{tool: string, output: string, exitCode: number, stderr: string}>}
 */
export function runOpencodeAgent(agentName, codebasePath, opts = {}) {
  const { runId, signal, timeoutMs, onOutput } = opts;
  const timeout = timeoutMs || MODEL_TIMEOUTS["opencode:kimi"] || 12 * 60 * 1000;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(`opencode:${agentName} cancelled before start`));
      return;
    }

    // Ensure opencode.json symlink exists
    const ocLink = join(codebasePath, "opencode.json");
    let createdLink = false;
    if (!existsSync(ocLink) && existsSync(OPENCODE_CONFIG)) {
      try { symlinkSync(OPENCODE_CONFIG, ocLink); createdLink = true; } catch {}
    }

    const args = [
      "run",
      "--agent", agentName,
      "--format", "json",
      "--dir", codebasePath,
      "Analyze this codebase following your instructions. Output ONLY the JSON as specified.",
    ];

    // Unique data dir to avoid SQLite lock conflicts
    const instanceDataDir = join(tmpdir(), `opencode-agent-${agentName}-${Date.now()}`);
    mkdirSync(instanceDataDir, { recursive: true });

    const env = {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      NODE_ENV: process.env.NODE_ENV,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      XDG_DATA_HOME: instanceDataDir,
    };

    const cleanup = () => { if (createdLink) try { unlinkSync(ocLink); } catch {} };

    const proc = spawn("opencode", args, {
      timeout,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.on("close", cleanup);
    proc.on("error", cleanup);

    // Track process for cancellation
    if (runId) {
      if (!activeProcesses.has(runId)) activeProcesses.set(runId, new Set());
      activeProcesses.get(runId).add(proc);
      const cleanupProc = () => {
        const procs = activeProcesses.get(runId);
        if (procs) { procs.delete(proc); if (procs.size === 0) activeProcesses.delete(runId); }
      };
      proc.on("close", cleanupProc);
      proc.on("error", cleanupProc);
    }

    // Listen for abort signal
    const onAbort = () => {
      try { proc.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 3000).unref();
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    let stdout = "";
    let stderr = "";
    let stdoutChunks = 0;
    let stderrChunks = 0;
    proc.stdout.on("data", (d) => { stdout += d.toString(); stdoutChunks++; });
    proc.stderr.on("data", (d) => { stderr += d.toString(); stderrChunks++; });

    // Throttled live output streaming
    let logBuffer = [];
    let logInterval = null;
    if (onOutput) {
      log.info("onOutput callback registered", { agent: agentName });
      const flush = () => {
        if (logBuffer.length > 0) {
          log.info("Flushing log lines", { agent: agentName, lines: logBuffer.length, stdoutChunks, stderrChunks });
          onOutput(logBuffer);
          logBuffer = [];
        }
      };
      const pushLines = (chunk) => {
        const text = chunk.toString().replace(/\x1b\[[0-9;]*m/g, "");
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (trimmed) logBuffer.push(trimmed);
        }
      };
      proc.stdout.on("data", pushLines);
      proc.stderr.on("data", pushLines);
      logInterval = setInterval(flush, 500);
      proc.on("close", () => { clearInterval(logInterval); flush(); });
    }

    proc.on("close", (code) => {
      log.info("Process closed", { agent: agentName, code, stdoutChunks, stderrChunks, stdoutLen: stdout.length, stderrLen: stderr.length });
      if (signal) signal.removeEventListener("abort", onAbort);
      if (signal?.aborted) { reject(new Error(`opencode:${agentName} cancelled`)); return; }

      if (!stdout && code === null) {
        reject(new Error(`opencode:${agentName} killed (likely timeout after ${timeout / 1000}s)`));
        return;
      }
      if (code !== 0 && code !== null) {
        const detail = stderr.slice(0, 500) || stdout.slice(0, 500) || "no output";
        reject(new Error(`opencode:${agentName} exited ${code}: ${detail}`));
        return;
      }
      if (!stdout) {
        reject(new Error(`opencode:${agentName} produced no output`));
        return;
      }
      resolve({ tool: `opencode:${agentName}`, output: stdout, exitCode: code, stderr });
    });

    proc.on("error", (err) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        reject(new Error(`opencode:${agentName} cancelled`));
      } else if (err.code === "ETIMEDOUT") {
        reject(new Error(`opencode:${agentName} timed out after ${timeout / 1000}s`));
      } else {
        reject(err);
      }
    });
  });
}
