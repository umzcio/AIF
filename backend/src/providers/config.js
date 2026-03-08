import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env manually (no dotenv dependency)
const envPath = resolve(import.meta.dirname, "../../.env");
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

export const PROVIDERS = {
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o",
    apiKey: () => process.env.OPENAI_API_KEY,
    format: "openai",
  },
  gemini: {
    name: "Gemini",
    model: "gemini-2.5-pro",
    apiKey: () => process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    format: "gemini",
  },
  grok: {
    name: "Grok",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    model: "x-ai/grok-code-fast-1",
    apiKey: () => process.env.OPENROUTER_API_KEY,
    format: "openai",
  },
  kimi: {
    name: "Kimi K2",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    model: "moonshotai/kimi-k2",
    apiKey: () => process.env.OPENROUTER_API_KEY,
    format: "openai",
  },
  qwen: {
    name: "Qwen3",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    model: "qwen/qwen3-32b",
    apiKey: () => process.env.OPENROUTER_API_KEY,
    format: "openai",
  },
  claude: {
    name: "Claude (Synthesis)",
    baseUrl: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-20250514",
    apiKey: () => process.env.ANTHROPIC_API_KEY,
    format: "anthropic",
  },
};

// Which models run passes, in order. Tier determines how many we use.
export const PASS_ROSTER = ["openai", "gemini", "grok", "kimi", "qwen"];

// Synthesis is always Claude
export const SYNTHESIS_PROVIDER = "claude";
