/**
 * Provider adapters shared by the agent, the original Darkness endpoints and the Project Studio.
 * Plain `fetch`, no SDKs, one tiny interface:
 *
 *     llm.complete(messages) -> string
 *
 * Two ways to get one:
 *   - createLLMFromConfig({provider, apiKey, baseUrl, model})   a user's own configured model
 *   - createLLM(env, requested?)                                the server's keys (AGENT_PROVIDER, or the
 *                                                               first provider that has a key)
 * Keys are never logged or returned to the browser.
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

export interface LLMConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

const TIMEOUT_MS = 120_000;

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

// --- adapters --------------------------------------------------------------------------------

function openAiCompatible(cfg: LLMConfig & { baseUrl: string }): LLM {
  const baseUrl = cfg.baseUrl.replace(/\/+$/, "");
  return {
    provider: cfg.provider,
    model: cfg.model,
    async complete(messages, opts = {}) {
      const json = await postJson(
        `${baseUrl}/chat/completions`,
        { authorization: `Bearer ${cfg.apiKey}` },
        { model: cfg.model, messages, temperature: opts.temperature ?? 0.2, max_tokens: opts.maxTokens ?? 4096 },
        opts.signal
      );
      const out = json?.choices?.[0]?.message?.content;
      if (typeof out !== "string") throw new Error("LLM returned no content");
      return out;
    },
  };
}

function anthropicLLM(cfg: LLMConfig): LLM {
  const baseUrl = (cfg.baseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "");
  return {
    provider: cfg.provider,
    model: cfg.model,
    async complete(messages, opts = {}) {
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const turns = messages.filter((m) => m.role !== "system");
      const json = await postJson(
        `${baseUrl}/messages`,
        { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
        { model: cfg.model, system, messages: turns, temperature: opts.temperature ?? 0.2, max_tokens: opts.maxTokens ?? 4096 },
        opts.signal
      );
      const out = (json?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      if (!out) throw new Error("LLM returned no content");
      return out;
    },
  };
}

function geminiNative(cfg: LLMConfig): LLM {
  return {
    provider: cfg.provider,
    model: cfg.model,
    async complete(messages, opts = {}) {
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const contents = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
      const json = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
        { "x-goog-api-key": cfg.apiKey },
        {
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
          contents,
          generationConfig: { temperature: opts.temperature ?? 0.2, maxOutputTokens: opts.maxTokens ?? 4096 },
        },
        opts.signal
      );
      const out = (json?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
      if (!out) throw new Error("LLM returned no content");
      return out;
    },
  };
}

// --- defaults per provider ---------------------------------------------------------------------

const OPENAI_FAMILY: Record<string, { baseUrl: string; model: string; keyEnv: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", keyEnv: "OPENAI_API_KEY" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", keyEnv: "OPENROUTER_API_KEY" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", keyEnv: "GROQ_API_KEY" },
  together: { baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", keyEnv: "TOGETHER_API_KEY" },
  mistral: { baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest", keyEnv: "MISTRAL_API_KEY" },
};

const ORDER = ["gemini", "anthropic", "openai", "openrouter", "groq", "together", "mistral"] as const;

/** Build an LLM from an explicit configuration (a user's own model, or env-derived). */
export function createLLMFromConfig(cfg: LLMConfig): LLM {
  const provider = (cfg.provider || "").toLowerCase();
  if (!cfg.apiKey) throw new Error("No API key configured for this model");
  if (!cfg.model) throw new Error("No model name configured");
  if (provider === "anthropic") return anthropicLLM(cfg);
  // A native Gemini key against Google's own endpoint; a custom base URL means "OpenAI-compatible".
  if (provider === "gemini" && (!cfg.baseUrl || /generativelanguage\.googleapis\.com\/v1beta\/?$/.test(cfg.baseUrl))) {
    return geminiNative(cfg);
  }
  const baseUrl = cfg.baseUrl || OPENAI_FAMILY[provider]?.baseUrl;
  if (!baseUrl) throw new Error(`Provider "${cfg.provider}" needs a base URL`);
  return openAiCompatible({ ...cfg, baseUrl });
}

function hasKey(provider: string, env: NodeJS.ProcessEnv): boolean {
  if (provider === "gemini") return Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
  if (provider === "anthropic") return Boolean(env.ANTHROPIC_API_KEY);
  const cfg = OPENAI_FAMILY[provider];
  return Boolean(cfg && env[cfg.keyEnv]);
}

export function availableProviders(env: NodeJS.ProcessEnv = process.env): string[] {
  return ORDER.filter((p) => hasKey(p, env));
}

/** An LLM from the server's own environment keys. */
export function createLLM(env: NodeJS.ProcessEnv = process.env, requested?: string): LLM {
  const wanted = (requested || env.AGENT_PROVIDER || "").toLowerCase();
  const provider = wanted && (ORDER as readonly string[]).includes(wanted) ? wanted : availableProviders(env)[0];
  if (!provider || !hasKey(provider, env)) {
    throw new Error(
      "No AI provider is configured. Add a model in Settings, or set one of GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY or MISTRAL_API_KEY on the server."
    );
  }
  if (provider === "gemini") {
    return createLLMFromConfig({ provider, apiKey: (env.GEMINI_API_KEY || env.GOOGLE_API_KEY)!, model: env.AGENT_MODEL || "gemini-2.5-flash" });
  }
  if (provider === "anthropic") {
    return createLLMFromConfig({ provider, apiKey: env.ANTHROPIC_API_KEY!, model: env.AGENT_MODEL || "claude-sonnet-5-5" });
  }
  const d = OPENAI_FAMILY[provider];
  return createLLMFromConfig({ provider, apiKey: env[d.keyEnv]!, model: env.AGENT_MODEL || d.model, baseUrl: env.AGENT_BASE_URL || d.baseUrl });
}
