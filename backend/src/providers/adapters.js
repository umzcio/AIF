/**
 * Provider adapters — normalize all LLM APIs to:
 *   send(provider, messages, options) → { content, usage, raw }
 *
 * Three formats: openai (covers OpenAI, Grok, Kimi, Qwen), gemini, anthropic
 */

async function sendOpenAI(provider, messages, options = {}) {
  const res = await fetch(provider.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey()}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.2,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${provider.name} ${res.status}: ${body}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content || "",
    usage: data.usage || {},
    raw: data,
  };
}

async function sendGemini(provider, messages, options = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${provider.apiKey()}`;

  // Convert openai-style messages to Gemini format
  const systemParts = [];
  const contents = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      systemParts.push({ text: msg.content });
    } else {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }
  }

  const body = {
    contents,
    generationConfig: {
      maxOutputTokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.2,
      thinkingConfig: { thinkingBudget: 1024 },
    },
  };
  if (systemParts.length) {
    body.systemInstruction = { parts: systemParts };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`${provider.name} ${res.status}: ${errBody}`);
  }
  const data = await res.json();
  // Filter out thinking parts — only keep parts without the "thought" flag
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => !p.thought).map((p) => p.text).join("");
  return {
    content: text,
    usage: data.usageMetadata || {},
    raw: data,
  };
}

async function sendAnthropic(provider, messages, options = {}) {
  // Separate system message
  let system;
  const filtered = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      system = msg.content;
    } else {
      filtered.push(msg);
    }
  }

  const body = {
    model: provider.model,
    max_tokens: options.maxTokens || 4096,
    messages: filtered,
  };
  if (system) body.system = system;

  const res = await fetch(provider.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`${provider.name} ${res.status}: ${errBody}`);
  }
  const data = await res.json();
  const text = data.content?.map((b) => b.text).join("") || "";
  return {
    content: text,
    usage: data.usage || {},
    raw: data,
  };
}

const FORMAT_MAP = {
  openai: sendOpenAI,
  gemini: sendGemini,
  anthropic: sendAnthropic,
};

/**
 * Send a prompt to any configured provider.
 * @param {object} provider - Entry from PROVIDERS config
 * @param {Array} messages - [{role, content}, ...]
 * @param {object} options - {maxTokens, temperature}
 * @returns {Promise<{content: string, usage: object, raw: object}>}
 */
export async function send(provider, messages, options = {}) {
  const adapter = FORMAT_MAP[provider.format];
  if (!adapter) throw new Error(`Unknown format: ${provider.format}`);
  return adapter(provider, messages, options);
}
