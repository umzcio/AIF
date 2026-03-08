/**
 * Shared CLI execution utilities for all agents.
 *
 * Provides: runCLI(), extractJSON(), loadEnv()
 * Used by Agent 1 (Code Analysis), Agent 2 (Accessibility), etc.
 */

import { spawn } from "child_process";
import { readFileSync, writeFileSync, existsSync, symlinkSync, unlinkSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { tmpdir } from "os";

const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes per pass (synthesis with dispute resolution can be slow)
const OPENCODE_CONFIG = process.env.OPENCODE_CONFIG_PATH || "/home/zach/opencode.json";

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
 */
export function runCLI(tool, prompt, codebasePath, outputDir) {
  return new Promise((resolve, reject) => {
    const outputFile = join(outputDir, `${tool.replace(/[^a-z0-9]/gi, "_")}.json`);
    let proc;
    let args;

    if (tool === "codex") {
      args = [
        "exec", prompt,
        "-m", process.env.CODEX_MODEL || "gpt-5.4-2026-03-05",
        "-C", codebasePath,
        "--sandbox", "read-only",
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        "-o", outputFile,
        "--ephemeral",
      ];
      proc = spawn("codex", args, {
        timeout: TIMEOUT_MS,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else if (tool === "gemini") {
      args = [
        "-p", prompt,
        "-y",
      ];
      proc = spawn("gemini", args, {
        timeout: TIMEOUT_MS,
        cwd: codebasePath,
        env: {
          ...process.env,
          GEMINI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else if (tool === "claude") {
      const claudeEnv = { ...process.env };
      delete claudeEnv.CLAUDECODE; // Allow nesting
      // For prompts under 120KB, pass directly via -p (spawn bypasses shell, safe for special chars).
      // For larger prompts, write to file and tell Claude to read it — avoids MAX_ARG_STRLEN (128KB).
      if (prompt.length <= 120000) {
        args = [
          "-p", prompt,
          "--output-format", "json",
          "--allowedTools", "Read,Glob,Grep,Bash(cat:*,ls:*,head:*,tail:*,wc:*,find:*,grep:*)",
        ];
        proc = spawn("claude", args, {
          timeout: TIMEOUT_MS,
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
          "--output-format", "json",
          "--allowedTools", "Read,Glob,Grep,Bash(cat:*,ls:*,head:*,tail:*,wc:*,find:*,grep:*)",
        ];
        proc = spawn("claude", args, {
          timeout: TIMEOUT_MS,
          cwd: codebasePath,
          env: claudeEnv,
          stdio: ["ignore", "pipe", "pipe"],
        });
      }
    } else if (tool === "qwen") {
      args = [
        "-p", prompt,
        "--approval-mode", "yolo",
      ];
      proc = spawn("qwen", args, {
        timeout: TIMEOUT_MS,
        cwd: codebasePath,
        env: {
          ...process.env,
          OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
        },
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
        timeout: TIMEOUT_MS,
        env: { ...process.env, XDG_DATA_HOME: instanceDataDir },
        stdio: ["ignore", "pipe", "pipe"],
      });
      proc.on("close", cleanup);
      proc.on("error", cleanup);
    } else {
      reject(new Error(`Unknown tool: ${tool}`));
      return;
    }

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
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
        reject(new Error(`${tool} killed (likely timeout after ${TIMEOUT_MS / 1000}s)`));
        return;
      }
      resolve({ tool, output: result, exitCode: code, stderr });
    });

    proc.on("error", (err) => {
      if (err.code === "ETIMEDOUT") {
        reject(new Error(`${tool} timed out after ${TIMEOUT_MS / 1000}s`));
      } else {
        reject(err);
      }
    });
  });
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
