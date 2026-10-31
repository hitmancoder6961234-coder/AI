/**
 * Provider adapters for the agent. Plain `fetch`, no SDKs, one tiny interface:
 *
 *     llm.complete(messages) -> string
 *
 * Selection: AGENT_PROVIDER (gemini | anthropic | openai | openrouter | groq | together | mistral),
 * otherwise the first provider whose API key is present in the environment.
 * Keys are read from the environment only and are never logged or returned to the browser.
 */

export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteOptions {
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
}

export interface LLM {
  provider: string;
  model: string;
  complete(messages: ChatMsg[], opts?: CompleteOptions): Promise<string>;
}

const TIMEOUT_MS = 90_000;

function withTimeout(signal?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, t]) : t;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: withTimeout(signal),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const detail = json?.error?.message || json?.error || text.slice(0, 300);
    throw new Error(`LLM request failed (${res.status}): ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return json;
}

// --- OpenAI-compatible (OpenAI, OpenRouter, Groq, Together, Mistral) -------------------------

const OPENAI_FAMILY: Record<string, { baseUrl: string; model: string; keyEnv: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", keyEnv: "OPENAI_API_KEY" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", keyEnv: "OPENROUTER_API_KEY" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", keyEnv: "GROQ_API_KEY" },
  together: { baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", keyEnv: "TOGETHER_API_KEY" },
  mistral: { baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest", keyEnv: "MISTRAL_API_KEY" },
};

function openAiCompatible(provider: string, env: NodeJS.ProcessEnv): LLM {
  const cfg = OPENAI_FAMILY[provider];
  const key = env[cfg.keyEnv] || "";
  const model = env.AGENT_MODEL || cfg.model;
  const baseUrl = (env.AGENT_BASE_URL || cfg.baseUrl).replace(/\/+$/, "");
  return {
    provider,
    model,
    async complete(messages, opts = {}) {
      const json = await postJson(
        `${baseUrl}/chat/completions`,
        { authorization: `Bearer ${key}` },
        { model, messages, temperature: opts.temperature ?? 0.2, max_tokens: opts.maxTokens ?? 2048 },
        opts.signal
      );
      const out = json?.choices?.[0]?.message?.content;
      if (typeof out !== "string") throw new Error("LLM returned no content");
      return out;
    },
  };
}

// --- Anthropic -------------------------------------------------------------------------------

function anthropic(env: NodeJS.ProcessEnv): LLM {
  const key = env.ANTHROPIC_API_KEY || "";
  const model = env.AGENT_MODEL || "claude-sonnet-5-5";
  return {
    provider: "anthropic",
    model,
    async complete(messages, opts = {}) {
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const turns = messages.filter((m) => m.role !== "system");
      const json = await postJson(
        "https://api.anthropic.com/v1/messages",
        { "x-api-key": key, "anthropic-version": "2023-06-01" },
        { model, system, messages: turns, temperature: opts.temperature ?? 0.2, max_tokens: opts.maxTokens ?? 2048 },
        opts.signal
      );
      const out = (json?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      if (!out) throw new Error("LLM returned no content");
      return out;
    },
  };
}

// --- Google Gemini ---------------------------------------------------------------------------

function gemini(env: NodeJS.ProcessEnv): LLM {
  const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "";
  const model = env.AGENT_MODEL || "gemini-2.5-flash";
  return {
    provider: "gemini",
    model,
    async complete(messages, opts = {}) {
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const contents = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
      const json = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { "x-goog-api-key": key },
        {
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
          contents,
          generationConfig: { temperature: opts.temperature ?? 0.2, maxOutputTokens: opts.maxTokens ?? 2048 },
        },
        opts.signal
      );
      const out = (json?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
      if (!out) throw new Error("LLM returned no content");
      return out;
    },
  };
}

// --- Selection -------------------------------------------------------------------------------

const ORDER = ["gemini", "anthropic", "openai", "openrouter", "groq", "together", "mistral"] as const;

function hasKey(provider: string, env: NodeJS.ProcessEnv): boolean {
  if (provider === "gemini") return Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
  if (provider === "anthropic") return Boolean(env.ANTHROPIC_API_KEY);
  const cfg = OPENAI_FAMILY[provider];
  return Boolean(cfg && env[cfg.keyEnv]);
}

export function availableProviders(env: NodeJS.ProcessEnv = process.env): string[] {
  return ORDER.filter((p) => hasKey(p, env));
}

export function createLLM(env: NodeJS.ProcessEnv = process.env, requested?: string): LLM {
  const wanted = (requested || env.AGENT_PROVIDER || "").toLowerCase();
  const provider = wanted && (ORDER as readonly string[]).includes(wanted) ? wanted : availableProviders(env)[0];
  if (!provider || !hasKey(provider, env)) {
    throw new Error(
      "No AI provider key configured. Set one of GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY or MISTRAL_API_KEY."
    );
  }
  if (provider === "gemini") return gemini(env);
  if (provider === "anthropic") return anthropic(env);
  return openAiCompatible(provider, env);
}
