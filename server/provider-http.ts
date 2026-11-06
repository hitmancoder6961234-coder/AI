import { redact } from "./security/redact.js";
import { logger } from "./observability/logger.js";

/**
 * Outbound calls to AI providers: timeouts, safe retries, classification and cancellation in one place.
 *
 * Timeouts       every call has one; a hung provider can never hold a request (or a socket) open for ever. Streaming calls
 *                have a time-to-first-byte timeout plus an IDLE timeout between chunks, so a provider that goes silent
 *                mid-answer is cut off too, instead of waiting for a total limit of many minutes.
 * Retries        only failures that are safe and useful to retry, and only BEFORE any answer has started to arrive:
 *                network errors, timeouts before the first byte, HTTP 408/429/500/502/503/504/529. Bounded attempts,
 *                exponential backoff with jitter, `Retry-After` honoured, and a total time budget. NEVER retried: 400/401/
 *                403/404/413/422 and other client errors (retrying cannot fix them and would burn quota), and anything after
 *                a stream has started delivering text (a retry would repeat or corrupt output).
 * Cancellation   the caller's AbortSignal ends the in-flight request, interrupts a backoff wait immediately, stops further
 *                attempts and releases the upstream connection and timers.
 * Messages       the provider's own error text is preserved (truncated, secrets removed), in the existing "HTTP <status>:
 *                <detail>" shape that the rest of the code already understands, plus a stable `kind` for programmatic use.
 */
export type ProviderErrorKind =
  | "timeout" | "idle_timeout" | "rate_limit" | "overloaded" | "server" | "network" | "auth" | "bad_request" | "not_found" | "cancelled" | "unknown";

export class ProviderError extends Error {
  kind: ProviderErrorKind;
  status?: number;
  retryable: boolean;
  attempts: number;
  retryAfterMs?: number;
  constructor(message: string, init: { kind: ProviderErrorKind; status?: number; retryable: boolean; attempts?: number; retryAfterMs?: number }) {
    super(message);
    this.name = init.kind === "cancelled" ? "AbortError" : "ProviderError";
    this.kind = init.kind;
    this.status = init.status;
    this.retryable = init.retryable;
    this.attempts = init.attempts ?? 1;
    this.retryAfterMs = init.retryAfterMs;
  }
}

export function classifyStatus(status: number): { kind: ProviderErrorKind; retryable: boolean } {
  if (status === 429) return { kind: "rate_limit", retryable: true };
  if (status === 529 || status === 503) return { kind: "overloaded", retryable: true };
  if (status === 408) return { kind: "timeout", retryable: true };
  if (status === 500 || status === 502 || status === 504) return { kind: "server", retryable: true };
  if (status === 401 || status === 403) return { kind: "auth", retryable: false };
  if (status === 404) return { kind: "not_found", retryable: false };
  if (status >= 400 && status < 500) return { kind: "bad_request", retryable: false };
  return { kind: "unknown", retryable: false };
}

/** Classify an arbitrary thrown value (SDK errors, our own errors, fetch errors). */
export function classifyError(err: any): { kind: ProviderErrorKind; retryable: boolean; status?: number } {
  if (err instanceof ProviderError) return { kind: err.kind, retryable: err.retryable, status: err.status };
  if (err?.name === "AbortError" || err?.message === "AbortError") return { kind: "cancelled", retryable: false };
  const text = String(err?.message || err || "").toLowerCase();
  const m = /\b(?:http|status)[ :]*([45]\d\d)\b|\b([45]\d\d)\b/.exec(String(err?.status ?? "") + " " + text);
  const status = Number(err?.status) || (m ? Number(m[1] || m[2]) : undefined);
  if (status) return { ...classifyStatus(status), status };
  if (/timed? ?out|etimedout|timeout/.test(text)) return { kind: "timeout", retryable: true };
  if (/econnreset|econnrefused|enotfound|eai_again|socket hang up|fetch failed|network|terminated/.test(text)) return { kind: "network", retryable: true };
  return { kind: "unknown", retryable: false };
}

export function defaults() {
  const n = (name: string, fallback: number) => {
    const v = parseInt(process.env[name] || "", 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    timeoutMs: n("PROVIDER_TIMEOUT_MS", 120_000), // whole request, non-streaming
    headersTimeoutMs: n("PROVIDER_HEADERS_TIMEOUT_MS", 60_000), // time to the first byte of a streaming answer
    streamIdleMs: n("PROVIDER_STREAM_IDLE_MS", 60_000), // longest silence allowed between chunks
    maxAttempts: n("PROVIDER_MAX_ATTEMPTS", 3),
    baseDelayMs: n("PROVIDER_RETRY_BASE_MS", 500),
    maxDelayMs: n("PROVIDER_RETRY_MAX_MS", 8_000),
    retryBudgetMs: n("PROVIDER_RETRY_BUDGET_MS", 30_000),
  };
}

export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, Math.round(secs * 1000));
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

/** Wait `ms`, but wake up at once (rejecting as cancelled) if the signal aborts. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(cancelled()); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function cancelled(attempts = 0): ProviderError {
  return new ProviderError("The request was cancelled.", { kind: "cancelled", retryable: false, attempts });
}

/** Remove anything that looks like a credential, including the exact auth header values of THIS request. */
export function scrubSecrets(text: string, init?: RequestInit): string {
  let out = redact(String(text ?? ""));
  const h = init?.headers as any;
  const values: string[] = [];
  if (h) {
    const entries: Array<[string, string]> = h instanceof Headers ? [...h.entries()] : Array.isArray(h) ? h : Object.entries(h);
    for (const [k, v] of entries) if (/authorization|api-?key|token|cookie/i.test(k) && typeof v === "string" && v.length >= 8) values.push(v, v.replace(/^Bearer\s+/i, ""));
  }
  for (const v of values) if (v.length >= 8) out = out.split(v).join("[redacted]");
  return out;
}

async function errorDetail(res: Response, init?: RequestInit): Promise<string> {
  let text = "";
  try { text = (await res.text()).slice(0, 2000); } catch { /* body unreadable */ }
  let detail = text;
  try {
    const j = JSON.parse(text);
    const d = j?.error?.message || (typeof j?.error === "string" ? j.error : undefined) || j?.message || j?.detail;
    if (d) detail = typeof d === "string" ? d : JSON.stringify(d);
  } catch { /* not JSON */ }
  detail = scrubSecrets(detail.replace(/\s+/g, " ").trim(), init);
  return detail.length > 300 ? detail.slice(0, 300) + "…" : detail || res.statusText || "no details";
}

export interface PolicyOptions {
  /** what is being called, for messages and logs (a provider or route name, never a secret) */
  label?: string;
  signal?: AbortSignal;
  /** non-streaming: limit for the whole call including reading the body */
  timeoutMs?: number;
  /** streaming: only the wait for the first byte is limited here; use iterateWithIdleTimeout for the rest */
  stream?: boolean;
  headersTimeoutMs?: number;
  /** 1 disables retries */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryBudgetMs?: number;
  /**
   * For callers that handle HTTP statuses themselves (a connectivity test): after the retry policy has run its course, return
   * the failing Response instead of throwing. Network failures and timeouts still throw.
   */
  returnErrorResponse?: boolean;
  /** test hooks */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  fetchImpl?: typeof fetch;
}

export async function fetchWithPolicy(url: string, init: RequestInit = {}, opts: PolicyOptions = {}): Promise<Response> {
  const d = defaults();
  const label = opts.label || "provider";
  const maxAttempts = Math.max(1, opts.maxAttempts ?? d.maxAttempts);
  const timeoutMs = opts.stream ? opts.headersTimeoutMs ?? d.headersTimeoutMs : opts.timeoutMs ?? d.timeoutMs;
  const baseDelay = opts.baseDelayMs ?? d.baseDelayMs;
  const maxDelay = opts.maxDelayMs ?? d.maxDelayMs;
  const budget = opts.retryBudgetMs ?? d.retryBudgetMs;
  const sleep = opts.sleep ?? abortableSleep;
  const random = opts.random ?? Math.random;
  const doFetch = opts.fetchImpl ?? fetch;
  const started = Date.now();
  let attempt = 0;

  for (;;) {
    attempt++;
    if (opts.signal?.aborted) throw cancelled(attempt - 1);

    const timeoutCtl = new AbortController();
    const timer = setTimeout(() => timeoutCtl.abort(), timeoutMs);
    timer.unref?.();
    const signal = opts.signal ? AbortSignal.any([timeoutCtl.signal, opts.signal]) : timeoutCtl.signal;

    let failure: ProviderError;
    let lastResponse: Response | undefined;
    try {
      const res = await doFetch(url, { ...init, signal });
      if (res.ok) {
        // streaming: headers arrived, so the first-byte limit is done with; the body is bounded by the idle timeout instead
        if (opts.stream) clearTimeout(timer);
        return res;
      }
      clearTimeout(timer);
      const { kind, retryable } = classifyStatus(res.status);
      const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      const detail = await errorDetail(opts.returnErrorResponse ? res.clone() : res, init);
      failure = new ProviderError(`HTTP ${res.status}: ${detail}`, { kind, status: res.status, retryable, attempts: attempt, retryAfterMs });
      lastResponse = res;
    } catch (err: any) {
      clearTimeout(timer);
      if (opts.signal?.aborted) throw cancelled(attempt);
      const timedOut = timeoutCtl.signal.aborted;
      failure = new ProviderError(
        timedOut ? `${label} did not respond within ${Math.round(timeoutMs / 1000)}s (timed out)` : `${label} network error: ${scrubSecrets(String(err?.cause?.code || err?.message || err), init).slice(0, 200)}`,
        { kind: timedOut ? "timeout" : "network", retryable: true, attempts: attempt },
      );
    }

    const giveUp = (): never | Response => {
      if (opts.returnErrorResponse && lastResponse) return lastResponse;
      throw failure;
    };
    if (!failure.retryable) return giveUp(); // a client error: retrying cannot fix it
    if (attempt >= maxAttempts) {
      failure.message += ` (after ${attempt} attempt${attempt === 1 ? "" : "s"})`;
      return giveUp();
    }
    const backoff = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
    const delay = failure.retryAfterMs != null ? failure.retryAfterMs : Math.round(backoff / 2 + random() * (backoff / 2)); // equal jitter
    if (delay > maxDelay * 2.5 || Date.now() - started + delay > budget) {
      // the provider asked for a longer pause than we are willing to wait: fail now with its message instead of hanging
      failure.message += ` (not retried: wait of ${Math.round(delay / 1000)}s exceeds the retry budget)`;
      return giveUp();
    }
    logger.warn("provider_retry", { label, attempt, maxAttempts, kind: failure.kind, status: failure.status, delayMs: delay });
    await sleep(delay, opts.signal); // rejects as "cancelled" if the caller aborts while waiting
  }
}

/**
 * Iterate the chunks of a fetch response body, failing if no chunk arrives for `idleMs` and stopping at once on abort.
 * In every exit path the reader is cancelled, which closes the upstream connection.
 */
export async function* iterateWithIdleTimeout(
  body: ReadableStream<Uint8Array>,
  opts: { idleMs?: number; signal?: AbortSignal; label?: string } = {},
): AsyncGenerator<Uint8Array> {
  const idleMs = opts.idleMs ?? defaults().streamIdleMs;
  const reader = body.getReader();
  try {
    for (;;) {
      let timer: NodeJS.Timeout | undefined;
      let onAbort: (() => void) | undefined;
      const r = await Promise.race([
        reader.read(),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new ProviderError(`${opts.label || "provider"} stopped sending data for ${Math.round(idleMs / 1000)}s (idle timeout)`, { kind: "idle_timeout", retryable: false })), idleMs); }),
        new Promise<never>((_, rej) => {
          if (!opts.signal) return;
          if (opts.signal.aborted) return rej(cancelled());
          onAbort = () => rej(cancelled());
          opts.signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
        if (onAbort) opts.signal?.removeEventListener("abort", onAbort);
      });
      if (r.done) return;
      yield r.value;
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

/** The same idle protection for an SDK's async iterator (Gemini): `onIdle` should abort the underlying request. */
export async function* withIdleTimeout<T>(iterable: AsyncIterable<T>, idleMs: number, onIdle: () => void, label = "provider"): AsyncGenerator<T> {
  const it = iterable[Symbol.asyncIterator]();
  try {
    for (;;) {
      let timer: NodeJS.Timeout | undefined;
      const r = await Promise.race([
        it.next(),
        new Promise<never>((_, rej) => { timer = setTimeout(() => { onIdle(); rej(new ProviderError(`${label} stopped sending data for ${Math.round(idleMs / 1000)}s (idle timeout)`, { kind: "idle_timeout", retryable: false })); }, idleMs); }),
      ]).finally(() => { if (timer) clearTimeout(timer); });
      if (r.done) return;
      yield r.value;
    }
  } finally {
    try { await it.return?.(); } catch { /* ignore */ }
  }
}

/**
 * A per-attempt AbortSignal that fires when the caller aborts OR the attempt's time limit passes. Aborting really cancels the
 * request (a `Promise.race` timeout only stops WAITING for it). Call dispose() when the attempt is over.
 */
export function attemptSignal(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; timedOut: () => boolean; abort: () => void; dispose: () => void } {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
  timer.unref?.();
  const signal = parent ? AbortSignal.any([ctl.signal, parent]) : ctl.signal;
  return { signal, timedOut: () => timedOut, abort: () => ctl.abort(), dispose: () => clearTimeout(timer) };
}
