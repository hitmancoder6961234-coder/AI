import { GoogleGenAI } from "@google/genai";
import { abortableSleep, defaults as providerDefaults, withIdleTimeout } from "./provider-http.js";

export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

const DEPRECATED_MODEL_MAP: Record<string, string> = {
  "gemini-3.5-flash-lite": "gemini-3.1-flash-lite",
  "gemini-3.6-flash": "gemini-3.1-flash-lite",
  "gemini-2.5-flash": "gemini-3.1-flash-lite",
  "gemini-2.5-pro": "gemini-3.1-pro-preview",
  "gemini-2.0-flash": "gemini-3.1-flash-lite",
  "gemini-2.0-pro": "gemini-3.1-pro-preview",
  "gemini-2.0-flash-thinking": "gemini-3.1-flash-lite",
  "gemini-1.5-flash": "gemini-3.1-flash-lite",
  "gemini-1.5-pro": "gemini-3.1-pro-preview",
  "gemini-pro": "gemini-3.1-flash-lite",
};

export function resolveSupportedGeminiModel(modelName?: string): string {
  let name = (modelName || process.env.DEFAULT_GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  if (name.startsWith("models/")) {
    name = name.substring("models/".length);
  }
  if (DEPRECATED_MODEL_MAP[name]) {
    return DEPRECATED_MODEL_MAP[name];
  }
  return name || DEFAULT_GEMINI_MODEL;
}


export function getEffectiveGeminiApiKey(customKey?: string): string {
  const isValidKey = (k?: string) => Boolean(
    k &&
    typeof k === "string" &&
    k.trim().length > 15 &&
    !k.includes("...") &&
    !k.toLowerCase().includes("dummy") &&
    !k.toLowerCase().includes("placeholder") &&
    !k.toLowerCase().includes("invalid_key")
  );

  if (isValidKey(customKey)) {
    return customKey!.trim();
  }

  const envCandidates = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_GENAI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.API_KEY,
    process.env.VITE_GEMINI_API_KEY,
    process.env.VITE_GOOGLE_API_KEY,
  ];

  for (const envVal of envCandidates) {
    if (isValidKey(envVal)) {
      return envVal!.trim();
    }
  }

  return "";
}

export function getEffectiveGeminiClient(customKey?: string): GoogleGenAI {
  const apiKey = getEffectiveGeminiApiKey(customKey);
  return new GoogleGenAI({
    apiKey: apiKey || undefined,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

/**
 * Formats API errors into clean, normalized user-friendly messages without exposing secrets or stack traces.
 */
export function formatApiError(err: any): string {
  if (!err) return "An unknown error occurred";
  let msg = err.message || (typeof err === "string" ? err : JSON.stringify(err));

  // Sanitize any secrets/keys if accidentally present in error message
  msg = msg.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, "Bearer [REDACTED]");
  msg = msg.replace(/(key|apiKey|secret|token)=([A-Za-z0-9_\-\.]+)/gi, "$1=[REDACTED]");

  // Recursively unwrap nested JSON error strings from API responses
  for (let i = 0; i < 4; i++) {
    const jsonMatch = msg.match(/\{[\s\S]*\}/);
    if (!jsonMatch) break;
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.error) {
        if (typeof parsed.error === "string") {
          msg = parsed.error;
        } else if (parsed.error.message) {
          msg = parsed.error.message;
        } else {
          msg = JSON.stringify(parsed.error);
        }
      } else if (parsed.message) {
        msg = parsed.message;
      } else {
        break;
      }
    } catch {
      break;
    }
  }

  const status = String(err.status || err.code || "");
  const combined = `${status} ${msg}`.toLowerCase();

  if (combined.includes("model_credential_not_configured") || combined.includes("api key is not configured")) {
    return "Gemini API key is not configured in server environment. Please set GEMINI_API_KEY.";
  }

  if (
    combined.includes("401") ||
    combined.includes("unauthorized") ||
    combined.includes("invalid api key") ||
    combined.includes("api_key_invalid") ||
    combined.includes("api key not valid")
  ) {
    return "Model authentication failed. Please verify that a valid GEMINI_API_KEY is configured.";
  }
  if (
    combined.includes("403") ||
    combined.includes("permission_denied") ||
    combined.includes("access denied")
  ) {
    return "Model access was denied by the provider. Please check API permissions.";
  }
  if (
    combined.includes("404") ||
    combined.includes("not_found") ||
    combined.includes("is not found") ||
    combined.includes("model_not_found")
  ) {
    return "Configured model was not found or is no longer available.";
  }
  if (
    combined.includes("429") ||
    combined.includes("rate limit") ||
    combined.includes("quota") ||
    combined.includes("resource_exhausted")
  ) {
    return "Provider rate limit reached. Please wait a moment and try again.";
  }
  if (
    combined.includes("503") ||
    combined.includes("500") ||
    combined.includes("502") ||
    combined.includes("overloaded") ||
    combined.includes("unavailable") ||
    combined.includes("high demand") ||
    combined.includes("spikes in demand")
  ) {
    return "Provider is temporarily unavailable. Please try again.";
  }
  if (
    combined.includes("504") ||
    combined.includes("timeout") ||
    combined.includes("timed out") ||
    combined.includes("etimedout")
  ) {
    return "Model request timed out. Please try again.";
  }

  // Return clean, single-line error without stack trace
  const cleanLine = msg.split("\n")[0].trim();
  if (cleanLine && cleanLine.length > 0 && !cleanLine.startsWith("Error:")) {
    return cleanLine.substring(0, 300);
  } else if (cleanLine && cleanLine.startsWith("Error:")) {
    return cleanLine.substring(6).trim().substring(0, 300);
  }

  return "An error occurred while processing your request.";
}

/**
 * Checks if an error is transient/retryable (503 Service Unavailable, 429 Rate Limit, network timeout, prefill queue, etc.).
 * Returns FALSE for client configuration errors (401, 403, 404, invalid model, invalid API key).
 */
export function isRetryableError(err: any): boolean {
  if (!err) return false;
  const status = String(err.status || err.code || "");
  const msg = String(err.message || (typeof err === "string" ? err : JSON.stringify(err)));
  const text = `${status} ${msg}`.toLowerCase();

  // Non-retryable configuration & auth errors
  if (
    text.includes("model_credential_not_configured") ||
    text.includes("401") ||
    text.includes("403") ||
    text.includes("404") ||
    text.includes("unauthorized") ||
    text.includes("permission_denied") ||
    text.includes("invalid api key") ||
    text.includes("api_key_invalid") ||
    text.includes("not found") ||
    text.includes("not_found") ||
    text.includes("is not found") ||
    text.includes("invalid_argument") ||
    text.includes("deprecated")
  ) {
    return false;
  }

  // Transient server / capacity / network errors
  return (
    text.includes("503") ||
    text.includes("500") ||
    text.includes("502") ||
    text.includes("504") ||
    text.includes("unavailable") ||
    text.includes("high demand") ||
    text.includes("spikes in demand") ||
    text.includes("overloaded") ||
    text.includes("prefill") ||
    text.includes("queue") ||
    text.includes("retryable") ||
    text.includes("429") ||
    text.includes("resource_exhausted") ||
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("econnreset") ||
    text.includes("etimedout")
  );
}

/**
 * Single-model resolver (no fallbacks to unconfigured models).
 */
export function getGeminiModelCascade(primaryModel?: string): string[] {
  const norm = (primaryModel || "").trim();
  return norm ? [norm] : [];
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMsg: string): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(errorMsg);
      (err as any).status = 504;
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export interface GeminiStreamOptions {
  apiKey?: string;
  modelName?: string;
  contents: any;
  systemInstruction?: string;
  config?: Record<string, any>;
  enableSearchGrounding?: boolean;
  onChunk: (text: string) => void;
  onGroundingMetadata?: (metadata: { queries: string[]; sources: Array<{ title: string; url: string }> }) => void;
  initialTimeoutMs?: number;
  abortSignal?: AbortSignal;
}

/**
 * Streams content strictly using the user's configured model.
 * Retries the SAME configured model for transient errors only (503, 429, timeout).
 * Does NOT switch models automatically.
 */
export async function streamGeminiWithResilience(options: GeminiStreamOptions): Promise<{ modelUsed: string }> {
  const {
    apiKey,
    modelName,
    contents,
    systemInstruction,
    config = {},
    onChunk,
    initialTimeoutMs = 60000,
  } = options;

  let candidateModel = resolveSupportedGeminiModel(modelName);
  const isValidKey = (k?: string) => Boolean(k && k.length > 20 && !k.includes("...") && !k.toLowerCase().includes("invalid") && !k.toLowerCase().includes("dummy") && !k.toLowerCase().includes("placeholder"));
  let currentApiKey = (isValidKey(apiKey) ? apiKey! : null) || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

  if (!currentApiKey) {
    throw new Error("Gemini API Key is not configured in server environment.");
  }

  const normalizedContents = typeof contents === "string" 
    ? [{ role: "user", parts: [{ text: contents }] }] 
    : contents;

  const maxAttempts = 3;
  let lastError: any = null;
  let hasStreamed = false;
  // One controller per attempt: aborting it really cancels the HTTP request (a timeout by itself only stops us waiting for it).
  let attemptCtl: AbortController | undefined;

  let ai = new GoogleGenAI({
    apiKey: currentApiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (options.abortSignal?.aborted) {
        throw new Error("AbortError");
      }

      const streamConfig: any = { maxOutputTokens: 8192, ...config };
      if (systemInstruction) {
        streamConfig.systemInstruction = systemInstruction;
      }
      if (options.enableSearchGrounding) {
        streamConfig.tools = streamConfig.tools || [];
        if (!streamConfig.tools.some((t: any) => t.googleSearch)) {
          streamConfig.tools.push({ googleSearch: {} });
        }
      }

      attemptCtl = new AbortController();
      streamConfig.abortSignal = options.abortSignal ? AbortSignal.any([attemptCtl.signal, options.abortSignal]) : attemptCtl.signal;

      const streamPromise = ai.models.generateContentStream({
        model: candidateModel,
        contents: normalizedContents,
        config: streamConfig,
      });

      const responseStream = await withTimeout(
        streamPromise,
        initialTimeoutMs,
        `Connection to model '${candidateModel}' timed out after ${initialTimeoutMs}ms`
      );

      // a model that goes silent mid-answer is cut off after the idle limit instead of holding the request open
      for await (const chunk of withIdleTimeout(responseStream, providerDefaults().streamIdleMs, () => attemptCtl?.abort(), "Gemini")) {
        if (options.abortSignal?.aborted) {
          throw new Error("AbortError");
        }

        const candidate = chunk.candidates?.[0];
        const grounding = candidate?.groundingMetadata;
        if (grounding && options.onGroundingMetadata) {
          const queries = grounding.webSearchQueries || [];
          const chunks = grounding.groundingChunks || [];
          const sources = chunks.map((c: any) => ({
            title: c.web?.title || c.web?.uri || "Web Source",
            url: c.web?.uri || "",
          })).filter((s: any) => s.url);

          if (queries.length > 0 || sources.length > 0) {
            options.onGroundingMetadata({ queries, sources });
          }
        }

        const rawText = chunk.text || "";
        const text = rawText.replace(/svgsvg/gi, 'svg');
        if (text) {
          hasStreamed = true;
          onChunk(text);
        }
      }

      return { modelUsed: candidateModel };
    } catch (err: any) {
      attemptCtl?.abort(); // release the request and its connection whatever went wrong
      lastError = err;

      if (options.abortSignal?.aborted || err.message === "AbortError" || err.name === "AbortError") {
        throw err;
      }

      // If tokens were already sent to client, cannot retry mid-stream
      if (hasStreamed) {
        throw err;
      }

      const errStr = String(err?.message || err).toLowerCase();

      // Check for Invalid API Key and self-heal by using system environment key
      const isApiKeyInvalid = errStr.includes("api_key_invalid") || errStr.includes("api key not valid") || errStr.includes("invalid api key") || (errStr.includes("400") && errStr.includes("invalid_argument") && errStr.includes("key"));
      const serverEnvKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
      if (isApiKeyInvalid && currentApiKey !== serverEnvKey && serverEnvKey) {
        console.warn(`[Gemini Resilience] Custom model API key invalid. Falling back to valid server environment GEMINI_API_KEY...`);
        currentApiKey = serverEnvKey;
        ai = new GoogleGenAI({
          apiKey: currentApiKey,
          httpOptions: { headers: { "User-Agent": "aistudio-build" } },
        });
        continue;
      }
      if (
        (errStr.includes("404") || errStr.includes("not_found") || errStr.includes("is not found") || errStr.includes("no longer available") || errStr.includes("deprecated")) &&
        candidateModel !== DEFAULT_GEMINI_MODEL
      ) {
        console.warn(`[Gemini Execution] Model '${candidateModel}' unavailable/deprecated. Self-healing fallback to '${DEFAULT_GEMINI_MODEL}'...`);
        candidateModel = DEFAULT_GEMINI_MODEL;
        continue;
      }

      if (
        (errStr.includes("503") || errStr.includes("high demand") || errStr.includes("spikes in demand") || errStr.includes("unavailable")) &&
        candidateModel === "gemini-3.8-flash"
      ) {
        console.warn(`[Gemini Execution] Model 'gemini-3.8-flash' is experiencing high demand. Falling back to 'gemini-3.6-flash'...`);
        candidateModel = "gemini-3.1-flash-lite";
        continue;
      }

      const retryable = isRetryableError(err);

      if (
        (errStr.includes("429") || errStr.includes("quota")) &&
        (errStr.includes("resource_exhausted") || errStr.includes("quota_exceeded"))
      ) {
        if (candidateModel === "gemini-3.1-pro-preview" || candidateModel === "gemini-3.1-pro") {
          console.warn("[Gemini Execution] Quota exceeded on gemini-3.1-pro-preview, falling back to gemini-3.8-flash...");
          candidateModel = "gemini-3.8-flash";
          continue;
        } else if (candidateModel === "gemini-3.8-flash") {
          console.warn("[Gemini Execution] Quota exceeded on gemini-3.8-flash, falling back to gemini-3.1-flash-lite...");
          candidateModel = "gemini-3.1-flash-lite";
          continue;
        } else if (candidateModel === "gemini-3.1-flash-lite") {
          console.warn("[Gemini Execution] Quota exceeded on gemini-3.1-flash-lite, falling back to gemini-2.5-flash...");
          candidateModel = "gemini-2.5-flash";
          continue;
        }
      }

      if (retryable && attempt < maxAttempts) {
        console.warn(
          `[Gemini Execution] Model '${candidateModel}' attempt ${attempt}/${maxAttempts} encountered transient error: ${err.message || err}. Retrying same model...`
        );
        const errStr = String(err?.message || err).toLowerCase();
        const isRateLimitOrOverload = errStr.includes("429") || errStr.includes("quota") || errStr.includes("overloaded") || errStr.includes("prefill") || errStr.includes("503");
        const delay = isRateLimitOrOverload ? 600 * attempt : 350 * Math.pow(1.4, attempt);
        await abortableSleep(delay, options.abortSignal); // stops at once if the user cancelled while we were waiting
        continue;
      }

      // Non-retryable error (e.g. 401, 403, 404) or attempts exhausted -> throw original error for this model
      throw err;
    }
  }

  throw lastError || new Error(`Model '${candidateModel}' failed to respond.`);
}

export interface GeminiGenerateOptions {
  apiKey?: string;
  modelName?: string;
  contents: any;
  systemInstruction?: string;
  config?: Record<string, any>;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}

/**
 * Generates single-turn content strictly using the user's configured model.
 * Retries the SAME configured model for transient errors only (503, 429, timeout).
 * Does NOT switch models automatically.
 */
export async function generateGeminiWithResilience(
  options: GeminiGenerateOptions
): Promise<{ text: string; modelUsed: string; response: any }> {
  const {
    apiKey,
    modelName,
    contents,
    systemInstruction,
    config = {},
    timeoutMs = 90000,
  } = options;

  let candidateModel = resolveSupportedGeminiModel(modelName);
  const isValidKey = (k?: string) => Boolean(k && k.length > 20 && !k.includes("...") && !k.toLowerCase().includes("invalid") && !k.toLowerCase().includes("dummy") && !k.toLowerCase().includes("placeholder"));
  let currentApiKey = (isValidKey(apiKey) ? apiKey! : null) || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

  if (!currentApiKey) {
    throw new Error("Gemini API Key is not configured in server environment.");
  }

  const normalizedContents = typeof contents === "string" 
    ? [{ role: "user", parts: [{ text: contents }] }] 
    : contents;

  const maxAttempts = 3;
  let lastError: any = null;
  let attemptCtl: AbortController | undefined;

  let ai = new GoogleGenAI({
    apiKey: currentApiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (options.abortSignal?.aborted) {
        throw new Error("AbortError");
      }

      const genConfig: any = { ...config };
      if (systemInstruction) {
        genConfig.systemInstruction = systemInstruction;
      }

      attemptCtl = new AbortController();
      genConfig.abortSignal = options.abortSignal ? AbortSignal.any([attemptCtl.signal, options.abortSignal]) : attemptCtl.signal;

      const callPromise = ai.models.generateContent({
        model: candidateModel,
        contents: normalizedContents,
        config: genConfig,
      });

      const response = await withTimeout(
        callPromise,
        timeoutMs,
        `Model '${candidateModel}' generation timed out after ${timeoutMs}ms`
      );

      if (options.abortSignal?.aborted) {
        throw new Error("AbortError");
      }

      const rawText = response.text || "";
      const text = rawText.replace(/svgsvg/gi, 'svg');
      return {
        text,
        modelUsed: candidateModel,
        response,
      };
    } catch (err: any) {
      attemptCtl?.abort(); // a timed-out call is really cancelled, not left running
      lastError = err;

      if (options.abortSignal?.aborted || err.message === "AbortError" || err.name === "AbortError") {
        throw err;
      }

      const errStr = String(err?.message || err).toLowerCase();
      const isApiKeyInvalid = errStr.includes("api_key_invalid") || errStr.includes("api key not valid") || errStr.includes("invalid api key") || errStr.includes("api key") || (errStr.includes("400") && errStr.includes("invalid_argument") && (errStr.includes("key") || errStr.includes("api")));
      const serverEnvKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
      if (isApiKeyInvalid && currentApiKey !== serverEnvKey && serverEnvKey) {
        console.warn(`[Gemini Resilience] Custom model API key invalid in generateContent. Falling back to valid server environment GEMINI_API_KEY...`);
        currentApiKey = serverEnvKey;
        ai = new GoogleGenAI({
          apiKey: currentApiKey,
          httpOptions: { headers: { "User-Agent": "aistudio-build" } },
        });
        continue;
      }
      if (
        (errStr.includes("404") || errStr.includes("not_found") || errStr.includes("is not found") || errStr.includes("no longer available") || errStr.includes("deprecated")) &&
        candidateModel !== DEFAULT_GEMINI_MODEL
      ) {
        console.warn(`[Gemini Execution] Model '${candidateModel}' unavailable/deprecated. Self-healing fallback to '${DEFAULT_GEMINI_MODEL}'...`);
        candidateModel = DEFAULT_GEMINI_MODEL;
        continue;
      }

      if (
        (errStr.includes("503") || errStr.includes("high demand") || errStr.includes("spikes in demand") || errStr.includes("unavailable")) &&
        candidateModel === "gemini-3.8-flash"
      ) {
        console.warn(`[Gemini Execution] Model 'gemini-3.8-flash' is experiencing high demand. Falling back to 'gemini-3.6-flash'...`);
        candidateModel = "gemini-3.1-flash-lite";
        continue;
      }

      const retryable = isRetryableError(err);

      if (
        (errStr.includes("429") || errStr.includes("quota")) &&
        (errStr.includes("resource_exhausted") || errStr.includes("quota_exceeded"))
      ) {
        if (candidateModel === "gemini-3.1-pro-preview" || candidateModel === "gemini-3.1-pro") {
          console.warn("[Gemini Execution] Quota exceeded on gemini-3.1-pro-preview, falling back to gemini-3.8-flash...");
          candidateModel = "gemini-3.8-flash";
          continue;
        } else if (candidateModel === "gemini-3.8-flash") {
          console.warn("[Gemini Execution] Quota exceeded on gemini-3.8-flash, falling back to gemini-3.1-flash-lite...");
          candidateModel = "gemini-3.1-flash-lite";
          continue;
        } else if (candidateModel === "gemini-3.1-flash-lite") {
          console.warn("[Gemini Execution] Quota exceeded on gemini-3.1-flash-lite, falling back to gemini-2.5-flash...");
          candidateModel = "gemini-2.5-flash";
          continue;
        }
      }

      if (retryable && attempt < maxAttempts) {
        console.warn(
          `[Gemini Execution] Model '${candidateModel}' generate attempt ${attempt}/${maxAttempts} encountered transient error: ${err.message || err}. Retrying same model...`
        );
        const errStr = String(err?.message || err).toLowerCase();
        const isRateLimitOrOverload = errStr.includes("429") || errStr.includes("quota") || errStr.includes("overloaded") || errStr.includes("prefill") || errStr.includes("503");
        const delay = isRateLimitOrOverload ? 600 * attempt : 350 * Math.pow(1.4, attempt);
        await abortableSleep(delay, options.abortSignal);
        continue;
      }

      // Non-retryable or max attempts reached -> throw error
      throw err;
    }
  }

  throw lastError || new Error(`Model '${candidateModel}' failed to generate content.`);
}

export function shouldPerformWebResearch(params: {
  userQuestion: string;
  intent?: string;
  format?: string;
  hasProjectFiles?: boolean;
}): boolean {
  const q = (params.userQuestion || "").toLowerCase().trim();
  const intent = (params.intent || "").toUpperCase();

  // 1. Explicit user request to search/find/look up online
  if (/\b(search|find|look up|google|internet|web|online|recent|latest|current|trends|news|today|2025|2026)\b/i.test(q)) {
    return true;
  }

  // 2. Explicit research-heavy PPT / DOCX / Report request without project context
  if ((intent === "PPT_GENERATION" || intent === "DOCX_GENERATION" || params.format === "pptx" || params.format === "docx") && !params.hasProjectFiles) {
    if (!/^\s*(my project|this file|code|local)\b/i.test(q)) {
      return true;
    }
  }

  return false;
}
