/**
 * Shared CLI execution utilities for all agents.
 *
 * Provides: runCLI(), runCLIWithRetry(), extractJSON(), loadEnv(),
 *           MODEL_TIMEOUTS, activeProcesses
 * Used by Agent 1 (Code Analysis), Agent 2 (Accessibility), etc.
 */

import { spawn } from "child_process";
import { readFileSync, writeFileSync, existsSync, symlinkSync, unlinkSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { tmpdir } from "os";
import log from "../../logger.js";

const OPENCODE_CONFIG = process.env.OPENCODE_CONFIG_PATH || "/home/zach/opencode.json";

/**
 * Build a filtered env object for a CLI tool.
 * Each tool only gets the API keys it needs, plus essential system vars.
 * Prevents prompt-injected agents from exfiltrating unrelated secrets.
 */
function filteredEnv(tool) {
  const base = { HOME: process.env.HOME, PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV };
  switch (tool) {
    case "codex":
      return { ...base, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
    case "gemini":
      return { ...base,
        GEMINI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY,
        GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      };
    case "claude": {
      const env = { ...base, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
      // Do NOT pass CLAUDECODE — allows nesting
      return env;
    }
    case "qwen":
      return { ...base, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY };
    default:
      // opencode:grok, opencode:kimi
      if (tool.startsWith("opencode:")) {
        return { ...base, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY };
      }
      return base;
  }
}

/**
 * Per-model timeout configuration (milliseconds).
 * Codex is consistently slowest (7-10 min), Grok fastest (~30-40s).
 * Claude synthesis can be slow with dispute resolution.
 */
export const MODEL_TIMEOUTS = {
  codex:           15 * 60 * 1000,  // 15 min (slow, large model)
  gemini:           8 * 60 * 1000,  // 8 min
  "opencode:grok":  3 * 60 * 1000,  // 3 min (fastest model)
  "opencode:kimi": 12 * 60 * 1000,  // 12 min (can be slow)
  qwen:             8 * 60 * 1000,  // 8 min
  claude:          15 * 60 * 1000,  // 15 min (synthesis)
};

/** Map of runId → Set<ChildProcess> for cancellation support. */
export const activeProcesses = new Map();

/**
 * Register a process for a run so it can be killed on cancel.
 */
function trackProcess(runId, proc) {
  if (!runId) return;
  if (!activeProcesses.has(runId)) activeProcesses.set(runId, new Set());
  activeProcesses.get(runId).add(proc);
  const cleanup = () => {
    const procs = activeProcesses.get(runId);
    if (procs) { procs.delete(proc); if (procs.size === 0) activeProcesses.delete(runId); }
  };
  proc.on("close", cleanup);
  proc.on("error", cleanup);
}

/**
 * Kill all processes for a run.
 */
export function killRunProcesses(runId) {
  const procs = activeProcesses.get(runId);
  if (!procs) return 0;
  let killed = 0;
  for (const proc of procs) {
    try { proc.kill("SIGTERM"); killed++; } catch {}
    // Force kill after 5s if still alive
    setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 5000).unref();
  }
  activeProcesses.delete(runId);
  return killed;
}

/**
 * Load .env into process.env.
 */
export function loadEnv() {
  const envPath = resolve(import.meta.dirname, "../../..", ".env");
  try {
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq);
      const val = trimmed.slice(eq + 1);
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}

/**
 * Run a single CLI tool against a codebase with a given prompt.
 * Returns the tool's text output.
 *
 * @param {string} tool - CLI tool name (codex, gemini, claude, qwen, opencode:grok, opencode:kimi)
 * @param {string} prompt - The prompt to send
 * @param {string} codebasePath - Absolute path to the codebase
 * @param {string} outputDir - Where to write output files
 * @param {object} [opts] - Options
 * @param {string} [opts.runId] - Pipeline run ID (for process tracking/cancellation)
 * @param {AbortSignal} [opts.signal] - AbortSignal for cancellation
 * @param {number} [opts.timeoutMs] - Override timeout for this call
 */
export function runCLI(tool, prompt, codebasePath, outputDir, opts = {}) {
  const { runId, signal, timeoutMs } = opts;
  const timeout = timeoutMs || MODEL_TIMEOUTS[tool] || 15 * 60 * 1000;

  return new Promise((resolve, reject) => {
    // Check if already cancelled
    if (signal?.aborted) {
      reject(new Error(`${tool} cancelled before start`));
      return;
    }

    const outputFile = join(outputDir, `${tool.replace(/[^a-z0-9]/gi, "_")}.json`);
    let proc;
    let args;

    if (tool === "codex") {
      args = [
        "exec", prompt,
        "-m", process.env.CODEX_MODEL || "gpt-5.4-2026-03-05",
        "-C", codebasePath,
        "--full-auto",
        "--sandbox", "read-only",
        "--skip-git-repo-check",
        "-o", outputFile,
        "--ephemeral",
      ];
      proc = spawn("codex", args, {
        timeout,
        cwd: codebasePath,
        env: filteredEnv("codex"),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else if (tool === "gemini") {
      args = [
        "-p", prompt,
        "-m", process.env.GEMINI_MODEL || "gemini-2.5-pro",
        "-y",
      ];
      proc = spawn("gemini", args, {
        timeout,
        cwd: codebasePath,
        env: filteredEnv("gemini"),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else if (tool === "claude") {
      const claudeEnv = filteredEnv("claude");
      const claudeModel = process.env.CLAUDE_MODEL || "claude-opus-4-6";
      // For prompts under 120KB, pass directly via -p (spawn bypasses shell, safe for special chars).
      // For larger prompts, write to file and tell Claude to read it — avoids MAX_ARG_STRLEN (128KB).
      if (prompt.length <= 120000) {
        args = [
          "-p", prompt,
          "-m", claudeModel,
          "--output-format", "json",
          "--allowedTools", "Read,Glob,Grep,Bash(cat:*,ls:*,head:*,tail:*,wc:*,find:*,grep:*)",
        ];
        proc = spawn("claude", args, {
          timeout,
          cwd: codebasePath,
          env: claudeEnv,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } else {
        const promptFile = join(outputDir, "_claude_prompt.txt");
        writeFileSync(promptFile, prompt);
        const metaPrompt = `Read the file at ${promptFile} — it contains your full instructions and input data. Follow every instruction in that file exactly. Output ONLY the JSON as specified.`;
        args = [
          "-p", metaPrompt,
          "-m", claudeModel,
          "--output-format", "json",
          "--allowedTools", "Read,Glob,Grep,Bash(cat:*,ls:*,head:*,tail:*,wc:*,find:*,grep:*)",
        ];
        proc = spawn("claude", args, {
          timeout,
          cwd: codebasePath,
          env: claudeEnv,
          stdio: ["ignore", "pipe", "pipe"],
        });
      }
    } else if (tool === "qwen") {
      args = [
        "-p", prompt,
        "-m", process.env.QWEN_MODEL || "openrouter/qwen/qwen3-coder",
        "--approval-mode", "suggest",
      ];
      proc = spawn("qwen", args, {
        timeout,
        cwd: codebasePath,
        env: filteredEnv("qwen"),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else if (tool.startsWith("opencode:")) {
      const model = tool.split(":")[1];
      const modelMap = {
        grok: "openrouter/x-ai/grok-code-fast-1",
        kimi: "openrouter/moonshotai/kimi-k2",
      };
      const ocLink = join(codebasePath, "opencode.json");
      let createdLink = false;
      if (!existsSync(ocLink) && existsSync(OPENCODE_CONFIG)) {
        try { symlinkSync(OPENCODE_CONFIG, ocLink); createdLink = true; } catch {}
      }
      args = [
        "run", prompt,
        "--format", "json",
        "-m", modelMap[model],
        "--dir", codebasePath,
      ];
      // Give each opencode instance its own data dir to avoid SQLite lock conflicts
      const instanceDataDir = join(tmpdir(), `opencode-${model}-${Date.now()}`);
      mkdirSync(instanceDataDir, { recursive: true });
      const cleanup = () => { if (createdLink) try { unlinkSync(ocLink); } catch {} };
      proc = spawn("opencode", args, {
        timeout,
        env: { ...filteredEnv(tool), XDG_DATA_HOME: instanceDataDir },
        stdio: ["ignore", "pipe", "pipe"],
      });
      proc.on("close", cleanup);
      proc.on("error", cleanup);
    } else {
      reject(new Error(`Unknown tool: ${tool}`));
      return;
    }

    // Track process for cancellation
    trackProcess(runId, proc);

    // Listen for abort signal
    const onAbort = () => {
      try { proc.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 3000).unref();
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);

      // Check if killed by cancellation
      if (signal?.aborted) {
        reject(new Error(`${tool} cancelled`));
        return;
      }

      let result = "";
      if (existsSync(outputFile)) {
        result = readFileSync(outputFile, "utf-8");
      } else {
        result = stdout;
      }

      if (!result && code !== 0) {
        reject(new Error(`${tool} exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      if (!result && code === null) {
        reject(new Error(`${tool} killed (likely timeout after ${timeout / 1000}s)`));
        return;
      }
      resolve({ tool, output: result, exitCode: code, stderr });
    });

    proc.on("error", (err) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        reject(new Error(`${tool} cancelled`));
      } else if (err.code === "ETIMEDOUT") {
        reject(new Error(`${tool} timed out after ${timeout / 1000}s`));
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Run a CLI tool with automatic retry on failure.
 *
 * @param {string} tool - CLI tool name
 * @param {string} prompt - The prompt
 * @param {string} codebasePath - Codebase path
 * @param {string} outputDir - Output directory
 * @param {object} [opts] - Options (same as runCLI plus retry options)
 * @param {number} [opts.maxRetries=1] - Max retry attempts (0 = no retry)
 * @param {number} [opts.retryDelayMs=5000] - Delay between retries
 * @param {function} [opts.onRetry] - Callback on retry: (attempt, error, tool) => void
 */
export async function runCLIWithRetry(tool, prompt, codebasePath, outputDir, opts = {}) {
  const { maxRetries = 1, retryDelayMs = 5000, onRetry, ...cliOpts } = opts;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await runCLI(tool, prompt, codebasePath, outputDir, cliOpts);
    } catch (err) {
      lastError = err;

      // Don't retry on cancellation
      if (err.message.includes("cancelled") || cliOpts.signal?.aborted) {
        throw err;
      }

      if (attempt < maxRetries) {
        log.warn("CLI pass failed, retrying", { tool, attempt: attempt + 1, maxAttempts: maxRetries + 1, error: err.message, retryDelaySec: retryDelayMs / 1000 });
        if (onRetry) onRetry(attempt + 1, err, tool);
        await new Promise(r => setTimeout(r, retryDelayMs));
      }
    }
  }
  throw lastError;
}

/**
 * Extract JSON from a tool's output.
 * Handles: raw JSON, Claude CLI JSON output, opencode JSONL events,
 * markdown fences, bare {...} blocks.
 */
export function extractJSON(text) {
  // Try direct parse — but check for Claude CLI wrapper first
  try {
    const parsed = JSON.parse(text);
    // Claude CLI --output-format json wraps in { type: "result", result: "..." }
    if (parsed.type === "result" && typeof parsed.result === "string") {
      try { return JSON.parse(parsed.result); } catch {}
      // Result may have markdown fences
      const fenceMatch = parsed.result.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (fenceMatch) {
        try { return JSON.parse(fenceMatch[1]); } catch {}
      }
      const bStart = parsed.result.indexOf("{");
      const bEnd = parsed.result.lastIndexOf("}");
      if (bStart !== -1 && bEnd > bStart) {
        try { return JSON.parse(parsed.result.slice(bStart, bEnd + 1)); } catch {}
      }
    }
    return parsed;
  } catch {}

  // opencode outputs JSONL events
  if (text.includes('"type":"tool_use"') || text.includes('"type":"step_') || text.includes('"type":"text"')) {
    const lines = text.split("\n");
    for (const line of lines) {
      try {
        const event = JSON.parse(line);

        const textContent = event?.part?.type === "text" && event?.part?.text;
        if (textContent && typeof textContent === "string") {
          const tStart = textContent.indexOf("{");
          const tEnd = textContent.lastIndexOf("}");
          if (tStart !== -1 && tEnd > tStart) {
            try { return JSON.parse(textContent.slice(tStart, tEnd + 1)); } catch {}
          }
        }

        const output = event?.part?.state?.output;
        if (output && typeof output === "string") {
          const taskMatch = output.match(/<task_result>\s*([\s\S]*?)\s*<\/task_result>/);
          if (taskMatch) {
            const inner = taskMatch[1];
            const jStart = inner.indexOf("{");
            const jEnd = inner.lastIndexOf("}");
            if (jStart !== -1 && jEnd > jStart) {
              try { return JSON.parse(inner.slice(jStart, jEnd + 1)); } catch {}
            }
          }
          const oStart = output.indexOf("{");
          const oEnd = output.lastIndexOf("}");
          if (oStart !== -1 && oEnd > oStart) {
            try { return JSON.parse(output.slice(oStart, oEnd + 1)); } catch {}
          }
        }
      } catch {}
    }
  }

  // Try markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch {}
  }

  // Try first { ... } block
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    try { return JSON.parse(text.slice(braceStart, braceEnd + 1)); } catch {}
  }

  return null;
}
