import { fetchWithPolicy, ProviderError } from "./provider-http.js";
import { generateGeminiWithResilience } from "./gemini-resilience.js";
import { redact } from "./security/redact.js";

/**
 * Model comparison: one prompt, 2-3 of the user's own configured models, answered side by side.
 *
 * Rules (docs/PRODUCT-PLAN.md, feature C):
 *  - never more than MAX_COMPARE_MODELS models or MAX_PROMPT_CHARS characters (every model is a paid provider call);
 *  - models run in parallel, each with its own timeout; one failing or slow never fails or delays the others;
 *  - cancelling (the caller's signal, e.g. the browser disconnecting) aborts every upstream call at once;
 *  - an API key never leaves this module: error text is scrubbed of the model's own key and of anything that looks like a credential;
 *  - nothing is written to a conversation: this is a read-only experiment.
 *
 * The orchestration (`runComparison`) is provider-agnostic and takes the call as a parameter so it is tested without a network.
 */

export const MIN_COMPARE_MODELS = 2;
export const MAX_COMPARE_MODELS = 3;
export const MAX_PROMPT_CHARS = 8000;
export const MAX_ANSWER_CHARS = 20000;
export const COMPARE_MAX_TOKENS = 1024;
export const DEFAULT_MODEL_TIMEOUT_MS = 60_000;

export class CompareError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

/** The part of a configured model the comparison needs. The key is only ever passed to the provider call. */
export interface CompareModel {
  id: string;
  name?: string;
  provider?: string;
  modelName?: string;
  baseUrl?: string;
  apiKey?: string;
  defaultTemperature?: number;
}

export type CallModel = (model: CompareModel, prompt: string, opts: { signal: AbortSignal; maxTokens: number; timeoutMs: number }) => Promise<string>;

export type CompareFinish = "done" | "error" | "timeout" | "cancelled";
export interface CompareResult {
  modelId: string;
  label: string;
  provider: string;
  /** set when the job belongs to a named prompt variant (Prompt Studio), so results can be matched back */
  variant?: string;
  finish: CompareFinish;
  text?: string;
  /** the answer was cut at MAX_ANSWER_CHARS */
  truncated?: boolean;
  error?: string;
  latencyMs: number;
}

/** Validate a request body. Returns the cleaned prompt and distinct model ids, or throws a CompareError with a clear reason. */
export function validateCompareRequest(body: unknown): { prompt: string; modelIds: string[] } {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const prompt = typeof b.prompt === "string" ? b.prompt.trim() : "";
  if (!prompt) throw new CompareError("EMPTY_PROMPT", "Write a prompt to compare.");
  if (prompt.length > MAX_PROMPT_CHARS) throw new CompareError("PROMPT_TOO_LONG", `The prompt is too long for a comparison (max ${MAX_PROMPT_CHARS} characters).`, 413);
  if (!Array.isArray(b.modelIds)) throw new CompareError("MODELS_REQUIRED", `Choose ${MIN_COMPARE_MODELS} or ${MAX_COMPARE_MODELS} models.`);
  const modelIds = [...new Set(b.modelIds.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean))];
  if (modelIds.length !== (b.modelIds as unknown[]).length) throw new CompareError("INVALID_MODELS", "Each model can be chosen once, by its id.");
  if (modelIds.length < MIN_COMPARE_MODELS) throw new CompareError("TOO_FEW_MODELS", `Choose at least ${MIN_COMPARE_MODELS} different models.`);
  if (modelIds.length > MAX_COMPARE_MODELS) throw new CompareError("TOO_MANY_MODELS", `A comparison runs at most ${MAX_COMPARE_MODELS} models (each is a separate provider call).`);
  if (modelIds.some((id) => id.length > 200)) throw new CompareError("INVALID_MODELS", "Invalid model id.");
  return { prompt, modelIds };
}

/** Error text that is safe to show: no credential of this model, nothing that looks like one, and a bounded length. */
export function safeError(err: unknown, model: CompareModel): string {
  let msg = String((err as any)?.message ?? err ?? "Request failed");
  const key = (model.apiKey || "").trim();
  if (key.length >= 6) msg = msg.split(key).join("[redacted]");
  msg = redact(msg).replace(/\s+/g, " ").trim();
  return msg.length > 300 ? msg.slice(0, 300) + "…" : msg || "Request failed";
}

/**
 * Run a list of jobs (one model + one prompt each) in parallel. Always resolves with one result per model, in the order given: a model that fails,
 * times out or is cancelled yields an error result instead of rejecting.
 */
export async function runJobs(args: {
  jobs: Array<{ model: CompareModel; prompt: string; variant?: string }>;
  call: CallModel;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxTokens?: number;
  now?: () => number;
}): Promise<CompareResult[]> {
  const { jobs, call, signal } = args;
  const timeoutMs = args.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;
  const maxTokens = args.maxTokens ?? COMPARE_MAX_TOKENS;
  const now = args.now ?? Date.now;

  return Promise.all(jobs.map(async ({ model, prompt, variant }): Promise<CompareResult> => {
    const started = now();
    const base = { modelId: model.id, label: model.name || model.modelName || model.id, provider: model.provider || "custom", ...(variant ? { variant } : {}) };
    const own = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; own.abort(); }, timeoutMs);
    timer.unref?.();
    const link = signal ? AbortSignal.any([own.signal, signal]) : own.signal;
    try {
      if (signal?.aborted) return { ...base, finish: "cancelled", error: "Cancelled.", latencyMs: 0 };
      // race the provider call against our own abort, so a provider that ignores the signal still cannot hold the comparison
      const aborted = new Promise<never>((_, reject) => {
        const onAbort = () => reject(Object.assign(new Error(timedOut ? "timeout" : "cancelled"), { name: "AbortError" }));
        if (link.aborted) onAbort(); else link.addEventListener("abort", onAbort, { once: true });
      });
      const raw = await Promise.race([call(model, prompt, { signal: link, maxTokens, timeoutMs }), aborted]);
      let text = typeof raw === "string" ? raw.trim() : "";
      if (!text) return { ...base, finish: "error", error: "The model returned an empty answer.", latencyMs: now() - started };
      const truncated = text.length > MAX_ANSWER_CHARS;
      if (truncated) text = text.slice(0, MAX_ANSWER_CHARS);
      return { ...base, finish: "done", text, ...(truncated ? { truncated } : {}), latencyMs: now() - started };
    } catch (err: any) {
      const latencyMs = now() - started;
      if (timedOut || (err instanceof ProviderError && err.kind === "timeout")) return { ...base, finish: "timeout", error: `No answer within ${Math.round(timeoutMs / 1000)} seconds.`, latencyMs };
      if (signal?.aborted || (err instanceof ProviderError && err.kind === "cancelled")) return { ...base, finish: "cancelled", error: "Cancelled.", latencyMs };
      return { ...base, finish: "error", error: safeError(err, model), latencyMs };
    } finally {
      clearTimeout(timer);
      own.abort(); // release anything still listening, and close any upstream request the provider call left open
    }
  }));
}

/** The same prompt on several models (the Compare page). */
export function runComparison(args: { models: CompareModel[]; prompt: string; call: CallModel; signal?: AbortSignal; timeoutMs?: number; maxTokens?: number; now?: () => number }): Promise<CompareResult[]> {
  const { models, prompt, ...rest } = args;
  return runJobs({ ...rest, jobs: models.map((model) => ({ model, prompt })) });
}

function placeholderKey(key: string): boolean {
  return !key || key.includes("•") || key.toLowerCase() === "placeholder";
}

/** Extract the answer text from an OpenAI-compatible, non-streaming chat completion. */
export function extractCompletionText(j: any): string {
  const choice = j?.choices?.[0];
  const content = choice?.message?.content ?? choice?.text;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p: any) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : "")).join("");
  return "";
}

/**
 * The real provider call: Gemini through its resilient wrapper, everything else as an OpenAI-compatible chat completion through
 * `fetchWithPolicy` (timeouts, bounded retries, key scrubbing in errors). `resolveBaseUrl` is the server's provider table.
 */
export function createModelCaller(deps: { resolveBaseUrl: (m: CompareModel) => string }): CallModel {
  return async (model, prompt, { signal, maxTokens, timeoutMs }) => {
    const provider = String(model.provider || "").toLowerCase();
    if (provider === "gemini") {
      const out = await generateGeminiWithResilience({
        apiKey: (model.apiKey || "").trim() || undefined,
        modelName: model.modelName || model.id,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { maxOutputTokens: maxTokens },
        timeoutMs,
        abortSignal: signal,
      });
      return out.text;
    }
    const baseUrl = deps.resolveBaseUrl(model);
    if (!baseUrl) throw new Error("This model has no base URL configured.");
    const apiKey = (model.apiKey || "").trim();
    if (provider !== "ollama" && placeholderKey(apiKey)) throw new Error("No API key is configured for this model.");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetchWithPolicy(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model.modelName || model.id,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        max_tokens: maxTokens,
        temperature: model.defaultTemperature ?? 0.7,
      }),
    }, { label: "model provider", timeoutMs, maxAttempts: 2, signal });
    return extractCompletionText(await res.json());
  };
}
