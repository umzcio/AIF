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

const OPENCODE_CONFIG = process.env.OPENCODE_CONFIG_PATH || "";

/**
 * Build a minimal env for deterministic tool subprocesses (Snyk, Semgrep, ESLint, etc.).
 * Only includes essential system vars + any extras the caller specifies.
 * Prevents untrusted codebases from exfiltrating API keys via malicious configs.
 * @param {object} [extras] - Additional env vars the tool needs (e.g. { SNYK_TOKEN, NODE_PATH })
 * @returns {object} Filtered environment object
 */
export function toolEnv(extras = {}) {
  return { HOME: process.env.HOME, PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV, ...extras };
}

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
  "opencode:mimo":  5 * 60 * 1000,  // 5 min (MiMo-V2-Flash via OpenRouter)
  "opencode:minimax": 8 * 60 * 1000, // 8 min (MiniMax M2.5 via OpenRouter)
  "opencode:glm":   8 * 60 * 1000,  // 8 min (GLM-5 via OpenRouter)
  "opencode:kimi": 12 * 60 * 1000,  // 12 min (can be slow)
  claude:          25 * 60 * 1000,  // 25 min (synthesis — processes large merged reports)
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
 * @param {function} [opts.onOutput] - Streaming callback: (lines: string[]) => void, called at most every 500ms
 */
export function runCLI(tool, prompt, codebasePath, outputDir, opts = {}) {
  const { runId, signal, timeoutMs, onOutput } = opts;
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
        "--dangerously-bypass-approvals-and-sandbox",
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
          "--model", claudeModel,
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
          "--model", claudeModel,
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
        "--approval-mode", "yolo",
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
        // grok: "openrouter/x-ai/grok-code-fast-1",  // swapped for MiMo-V2-Flash
        mimo: "openrouter/xiaomi/mimo-v2-flash",
        minimax: "openrouter/minimax/minimax-m2.5",
        glm: "openrouter/z-ai/glm-5",
        kimi: "openrouter/moonshotai/kimi-k2",
      };
      const ocLink = join(codebasePath, "opencode.json");
      let createdLink = false;
      if (OPENCODE_CONFIG && !existsSync(ocLink) && existsSync(OPENCODE_CONFIG)) {
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
    let stdoutChunks = 0;
    let stderrChunks = 0;
    proc.stdout.on("data", (d) => { stdout += d.toString(); stdoutChunks++; });
    proc.stderr.on("data", (d) => { stderr += d.toString(); stderrChunks++; });

    // Throttled live output streaming
    let logBuffer = [];
    let logInterval = null;
    if (onOutput) {
      const flush = () => {
        if (logBuffer.length > 0) {
          onOutput(logBuffer);
          logBuffer = [];
        }
      };
      const pushLines = (chunk) => {
        const text = chunk.toString().replace(/\x1b\[[0-9;]*m/g, "");
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          // Filter out noisy JSONL events (raw model output, session metadata)
          if (trimmed.startsWith("{") && (trimmed.includes('"type":"text"') || trimmed.includes('"type":"step_') || trimmed.includes('"sessionID"') || trimmed.includes('"type":"result"'))) continue;
          // Filter very long lines (raw JSON blobs)
          if (trimmed.length > 500) continue;
          logBuffer.push(trimmed);
        }
      };
      proc.stdout.on("data", pushLines);
      proc.stderr.on("data", pushLines);
      logInterval = setInterval(flush, 500);
      proc.on("close", () => { clearInterval(logInterval); flush(); });
    }

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

      if (!result && code === null) {
        reject(new Error(`${tool} killed (likely timeout after ${timeout / 1000}s)`));
        return;
      }
      if (code !== 0 && code !== null) {
        // Non-zero exit is always a failure — even if the tool wrote output (e.g. opencode writes error JSON)
        const detail = stderr.slice(0, 500) || (result ? result.slice(0, 500) : "no output");
        reject(new Error(`${tool} exited ${code}: ${detail}`));
        return;
      }
      if (!result) {
        reject(new Error(`${tool} produced no output`));
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
  // Validate that parsed JSON looks like actual analysis output, not a CLI envelope
  const ANALYSIS_KEYS = ["findings", "issues", "wcagChecklist", "uiInventory", "inventory",
    "ariaAudit", "scorecard", "bugFindings", "summary", "scoringSignals", "questions",
    "userGuide", "adminGuide", "complianceSummary", "stackFindings"];

  function isAnalysisJSON(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
    return ANALYSIS_KEYS.some(k => k in obj);
  }

  // Try direct parse — but check for error responses and Claude CLI wrapper first
  try {
    const parsed = JSON.parse(text);
    // Reject API error responses (e.g. opencode writes {"type":"error","error":{...}} on 402/4xx)
    if (parsed.type === "error" && parsed.error) {
      log.warn("extractJSON: skipping API error response", { error: parsed.error?.data?.message || parsed.error?.message || "unknown" });
      return null;
    }
    // Reject opencode session metadata envelopes (step_finish, step_start, etc.)
    // These contain session/token info but NOT the analysis output
    if (parsed.type && parsed.type.startsWith("step_") && parsed.sessionID && parsed.part) {
      log.warn("extractJSON: skipping opencode session metadata", { type: parsed.type, sessionID: parsed.sessionID });
      // Fall through to JSONL parsing below — the real content may be in other events
    } else {
    // Claude CLI --output-format json wraps in { type: "result", result: "..." }
    if (parsed.type === "result" && typeof parsed.result === "string") {
      try { return JSON.parse(parsed.result); } catch {}
      // Result may have markdown fences
      const fenceMatch = parsed.result.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (fenceMatch) {
        try { return JSON.parse(fenceMatch[1]); } catch {}
      }
      // Try progressively later { positions — Claude often prefixes JSON with narrative text
      const bEnd = parsed.result.lastIndexOf("}");
      if (bEnd !== -1) {
        let pos = 0;
        while (pos < bEnd) {
          const bStart = parsed.result.indexOf("{", pos);
          if (bStart === -1 || bStart >= bEnd) break;
          try { return JSON.parse(parsed.result.slice(bStart, bEnd + 1)); } catch {}
          pos = bStart + 1;
        }
      }
    }
      if (isAnalysisJSON(parsed)) return parsed;
      log.warn("extractJSON: parsed valid JSON but missing analysis keys", { keys: Object.keys(parsed).slice(0, 5) });
    }
  } catch {}

  // opencode outputs JSONL events — text may be split across multiple events.
  // Models produce analysis JSON in different locations:
  //   1. Text events (most common) — narrative + JSON in the last text event
  //   2. Tool output state — when model uses tool-use to produce the report
  //   3. <task_result> tags in tool output
  // Strategy: collect ALL text content, try individual events first, then concatenate.
  if (text.includes('"type":"tool_use"') || text.includes('"type":"step_') || text.includes('"type":"text"')) {
    const lines = text.split("\n");
    let concatenatedText = "";
    const toolOutputs = [];

    for (const line of lines) {
      try {
        const event = JSON.parse(line);

        // Collect text fragments from text events
        const textContent = event?.part?.type === "text" && event?.part?.text;
        if (textContent && typeof textContent === "string") {
          concatenatedText += textContent;
          // Try extracting JSON from this individual event first
          const tStart = textContent.indexOf("{");
          const tEnd = textContent.lastIndexOf("}");
          if (tStart !== -1 && tEnd > tStart) {
            try {
              const p = JSON.parse(textContent.slice(tStart, tEnd + 1));
              if (isAnalysisJSON(p)) return p;
            } catch {}
          }
        }

        // Collect tool output state for later searching
        const output = event?.part?.state?.output;
        if (output && typeof output === "string" && output.length > 100) {
          toolOutputs.push(output);
          // Quick check: task_result tags
          const taskMatch = output.match(/<task_result>\s*([\s\S]*?)\s*<\/task_result>/);
          if (taskMatch) {
            const inner = taskMatch[1];
            const jStart = inner.indexOf("{");
            const jEnd = inner.lastIndexOf("}");
            if (jStart !== -1 && jEnd > jStart) {
              try {
                const p = JSON.parse(inner.slice(jStart, jEnd + 1));
                if (isAnalysisJSON(p)) return p;
              } catch {}
            }
          }
        }
      } catch {}
    }

    // Helper: try progressive brace matching on a string
    function tryBraceMatch(str) {
      // Try markdown fences first
      const fMatch = str.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (fMatch) {
        try {
          const p = JSON.parse(fMatch[1]);
          if (isAnalysisJSON(p)) return p;
        } catch {}
      }
      // Progressive brace matching from the end — try each { paired with last }
      const end = str.lastIndexOf("}");
      if (end !== -1) {
        let pos = 0;
        while (pos < end) {
          const start = str.indexOf("{", pos);
          if (start === -1 || start >= end) break;
          try {
            const p = JSON.parse(str.slice(start, end + 1));
            if (isAnalysisJSON(p)) return p;
          } catch {}
          pos = start + 1;
        }
      }
      return null;
    }

    // Try concatenated text events
    if (concatenatedText.length > 0) {
      const result = tryBraceMatch(concatenatedText);
      if (result) return result;
    }

    // Try each tool output (reverse order — last output most likely to contain the report)
    for (let i = toolOutputs.length - 1; i >= 0; i--) {
      const result = tryBraceMatch(toolOutputs[i]);
      if (result) return result;
    }

    // Last resort: concatenate text + all tool outputs and try again
    if (toolOutputs.length > 0) {
      const megaText = concatenatedText + "\n" + toolOutputs.join("\n");
      const result = tryBraceMatch(megaText);
      if (result) return result;
    }
  }

  // Try markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1]);
      if (isAnalysisJSON(parsed)) return parsed;
    } catch {}
  }

  // Try progressively later { positions — narrative text before JSON is common
  const braceEnd = text.lastIndexOf("}");
  if (braceEnd !== -1) {
    let pos = 0;
    while (pos < braceEnd) {
      const braceStart = text.indexOf("{", pos);
      if (braceStart === -1 || braceStart >= braceEnd) break;
      try {
        const parsed = JSON.parse(text.slice(braceStart, braceEnd + 1));
        if (isAnalysisJSON(parsed)) return parsed;
      } catch {}
      pos = braceStart + 1;
    }
  }

  return null;
}
