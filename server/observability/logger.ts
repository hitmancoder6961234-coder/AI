import { AsyncLocalStorage } from "node:async_hooks";
import { redact } from "../security/redact.js";

/**
 * Structured logging.
 *
 * One JSON object per line in production (`LOG_FORMAT=json`, the default there), a readable line in development
 * (`LOG_FORMAT=pretty`). Every entry carries the id of the request that caused it when there is one, so a single user's
 * problem can be followed through the logs.
 *
 * What is NEVER written: API keys, tokens, passwords, cookies, authorization headers, and private user content (prompts,
 * messages, file text, request/response bodies, query strings, e-mail addresses). That is enforced in two layers, so a
 * careless call site cannot leak:
 *   1. by NAME: fields called prompt/content/message/body/query/token/password/... are replaced with "[redacted]";
 *   2. by VALUE: every remaining string goes through the same pattern redaction the console uses (keys, bearer tokens,
 *      session ids, JWTs, e-mails, IP addresses), and is truncated.
 * Log identifiers and counters (ids, status codes, durations, token COUNTS), not content.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface RequestContext {
  requestId: string;
  method: string;
  path: string;
  startedAt: number;
}
export const requestStore = new AsyncLocalStorage<RequestContext>();
export const currentRequest = (): RequestContext | undefined => requestStore.getStore();

/** Field names whose values are private or secret by nature (matched after removing `_`/`-` and lower-casing). */
const SENSITIVE_EXACT = new Set([
  "password", "passwd", "secret", "token", "authorization", "cookie", "setcookie", "credential", "credentials", "session", "sessionid",
  "prompt", "systemprompt", "systeminstruction", "content", "message", "messages", "text", "body", "query", "email", "history",
  "attachment", "attachments", "userinput", "input", "output", "completion", "response", "reply", "data", "headers",
]);
const SENSITIVE_SUFFIX = ["apikey", "password", "secret", "token", "authorization", "cookie"];

export function isSensitiveKey(key: string): boolean {
  const k = key.replace(/[_\-\s]/g, "").toLowerCase();
  if (SENSITIVE_EXACT.has(k)) return true;
  // "...Token" / "...ApiKey" are secrets; "...Tokens" (a count) is not
  return SENSITIVE_SUFFIX.some((s) => k.endsWith(s));
}

const MAX_STRING = 300;
const MAX_DEPTH = 4;

export function scrubValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    const r = redact(value);
    return r.length > MAX_STRING ? r.slice(0, MAX_STRING) + "…" : r;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Error) {
    const e = value as Error & { code?: unknown; status?: unknown; kind?: unknown };
    return { name: e.name, message: scrubValue(e.message), code: e.code, status: e.status, kind: e.kind };
  }
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrubValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out[k] = isSensitiveKey(k) ? "[redacted]" : scrubValue(v, depth + 1);
    }
    return out;
  }
  return String(typeof value);
}

export function scrubFields(fields: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (k === "err" || k === "error") out[k] = scrubValue(v); // errors are described, never dumped (no stack, no payload)
    else out[k] = isSensitiveKey(k) ? "[redacted]" : scrubValue(v);
  }
  return out;
}

type Sink = (line: string, level: LogLevel) => void;
const defaultSink: Sink = (line, level) => {
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
};
let sink: Sink = defaultSink;
/** Tests capture output through this. Pass nothing to restore the default. */
export function setLogSink(fn?: Sink): void {
  sink = fn || defaultSink;
}

const threshold = (): number => ORDER[(process.env.LOG_LEVEL as LogLevel) in ORDER ? (process.env.LOG_LEVEL as LogLevel) : "info"];
const format = (): "json" | "pretty" => {
  const f = (process.env.LOG_FORMAT || "").toLowerCase();
  if (f === "json" || f === "pretty") return f;
  return process.env.NODE_ENV === "production" ? "json" : "pretty";
};

export function log(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < threshold()) return;
  const ctx = currentRequest();
  const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, event };
  if (ctx) entry.requestId = ctx.requestId;
  Object.assign(entry, scrubFields(fields));
  if (format() === "json") {
    sink(JSON.stringify(entry), level);
  } else {
    const { ts, level: lv, event: ev, ...rest } = entry as Record<string, unknown>;
    const kv = Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" ");
    sink(`${String(ts).slice(11, 19)} ${String(lv).toUpperCase().padEnd(5)} ${String(ev)}${kv ? " " + kv : ""}`, level);
  }
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => log("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => log("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => log("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => log("error", event, fields),
};

let consolePatched = false;
/**
 * Prefix every console.* line with the request id while a request is being served, so the existing log statements across the
 * code base ("[Gemini Execution] ...") become traceable without touching each of them. Run AFTER the privacy redaction patch.
 */
export function installConsoleRequestId(): void {
  if (consolePatched) return;
  consolePatched = true;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const ctx = currentRequest();
      if (ctx && args.length > 0 && typeof args[0] === "string") return original(`[${ctx.requestId}] ${args[0]}`, ...args.slice(1));
      if (ctx) return original(`[${ctx.requestId}]`, ...args);
      return original(...args);
    };
  }
}
