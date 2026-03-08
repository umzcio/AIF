import { PROVIDERS } from "./config.js";
import { send } from "./adapters.js";

const testPrompt = [
  { role: "system", content: "You are a code reviewer. Be very brief — one sentence max." },
  { role: "user", content: 'What is the security issue here?\n\nconn.execute(f"SELECT * FROM users WHERE name = {name}")' },
];

async function testProvider(key) {
  const provider = PROVIDERS[key];
  const start = Date.now();
  try {
    const result = await send(provider, testPrompt, { maxTokens: 1024 });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const preview = result.content.trim().slice(0, 120);
    console.log(`✓ ${provider.name.padEnd(20)} ${elapsed}s  ${preview}`);
    return { key, ok: true, elapsed };
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`✗ ${provider.name.padEnd(20)} ${elapsed}s  ${err.message.slice(0, 100)}`);
    return { key, ok: false, error: err.message };
  }
}

console.log("Testing all providers...\n");

// All providers are API-based now — run in parallel
const all = await Promise.all(
  ["openai", "gemini", "grok", "kimi", "qwen", "claude"].map(testProvider)
);
const passed = all.filter((r) => r.ok).length;
console.log(`\n${passed}/${all.length} providers responding.`);
