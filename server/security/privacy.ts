/**
 * Privacy & hardening layer.
 *
 *  - Strict identity mode: no anonymous access to user data (PRIVACY_STRICT, default ON).
 *  - Security headers, no-store caching on the API, rate limiting.
 *  - Log redaction: e-mails, bearer tokens, provider API keys and passwords never reach stdout.
 *  - Data-subject endpoints: policy, export, erase.
 *
 * Nothing here phones home. There is no analytics, no third-party tracker.
 */
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Secure by default: only an explicit PRIVACY_STRICT=false turns it off (local hacking only). */
export const PRIVACY_STRICT: boolean = (process.env.PRIVACY_STRICT || "true").toLowerCase() !== "false";

const isProd = process.env.NODE_ENV === "production";

function intEnv(name: string, fallback: number): number {
  const n = parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ---------------------------------------------------------------------------
// Log redaction
// ---------------------------------------------------------------------------

const REDACTIONS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]"],
  [/\bsess_[0-9]+_[a-f0-9]{16,}\b/gi, "[session]"],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[api-key]"],
  [/\bsk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{16,}\b/g, "[api-key]"],
  [/\bgsk_[A-Za-z0-9]{16,}\b/g, "[api-key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[api-key]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, "[jwt]"],
  [/(["']?(?:password|passwd|secret|api[_-]?key|token)["']?\s*[:=]\s*)(["'])[^"']*\2/gi, "$1$2[redacted]$2"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]"],
];

export function redact(input: string): string {
  let out = input;
  for (const [re, sub] of REDACTIONS) out = out.replace(re, sub);
  return out;
}

let consolePatched = false;

/** Route every console.* call through redact(). Idempotent. */
export function installLogRedaction(): void {
  if (consolePatched || (process.env.PRIVACY_LOG_REDACTION || "true") === "false") return;
  consolePatched = true;
  const wrap = (arg: unknown): unknown => {
    if (typeof arg === "string") return redact(arg);
    if (arg instanceof Error) {
      const clone = new Error(redact(arg.message));
      clone.name = arg.name;
      clone.stack = arg.stack ? redact(arg.stack) : undefined;
      return clone;
    }
    return arg;
  };
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => original(...args.map(wrap));
  }
}

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------

const CDN_SCRIPT = "https://cdn.jsdelivr.net https://cdnjs.cloudflare.com";
const CDN_STYLE = "https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com";

function buildCsp(): string {
  const extraConnect = (process.env.CSP_CONNECT_EXTRA || "").split(/[\s,]+/).filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    // The shipped UI relies on inline bootstrap snippets and Mermaid/KaTeX from CDNs.
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${CDN_SCRIPT}`,
    `style-src 'self' 'unsafe-inline' ${CDN_STYLE}`,
    "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' ${extraConnect}`.trim(),
    "frame-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

/** The original Darkness app loads Google Sign-In and assorted CDN libraries, so its policy is broader than the new UI's. */
const CSP_CLASSIC = [
  "default-src 'self' https: data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https:",
  "frame-src 'self' https://accounts.google.com blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join("; ");

function securityHeaders(): RequestHandler {
  const mode = (process.env.PRIVACY_CSP || "report-only").toLowerCase(); // enforce | report-only | off
  const csp = buildCsp();
  return (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=(), microphone=(self)"
    );
    if (isProd) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    const policy = req.path.startsWith("/classic") ? CSP_CLASSIC : csp;
    if (mode === "enforce") res.setHeader("Content-Security-Policy", policy);
    else if (mode !== "off") res.setHeader("Content-Security-Policy-Report-Only", policy);
    if (isApiPath(req.path)) {
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader("Pragma", "no-cache");
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Rate limiting (fixed window, in-memory — good for a single instance)
// ---------------------------------------------------------------------------

interface Bucket {
  count: number;
  resetAt: number;
}

export function rateLimit(opts: { windowMs: number; max: number; name: string }): RequestHandler {
  const buckets = new Map<string, Bucket>();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }, Math.max(opts.windowMs, 30_000));
  sweep.unref();

  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    const remaining = Math.max(0, opts.max - b.count);
    res.setHeader("RateLimit-Limit", String(opts.max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil((b.resetAt - now) / 1000)));
    if (b.count > opts.max) {
      res.setHeader("Retry-After", String(Math.ceil((b.resetAt - now) / 1000)));
      res.status(429).json({ error: "Too many requests. Please slow down.", code: "RATE_LIMITED", limiter: opts.name });
      return;
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Strict-mode auth gate
// ---------------------------------------------------------------------------

/** API paths that must work before a user has signed in. */
const PUBLIC_API = [
  /^\/api\/health$/,
  /^\/api\/debug\/ping$/,
  /^\/api\/config\//,
  /^\/api\/auth\//,
  /^\/api\/privacy\/policy$/,
  // The original Darkness API: health for the connection test, and share links (unguessable id = permission).
  /^\/classic-api\/api\/health$/,
  /^\/classic-api\/api\/share\/[A-Za-z0-9_-]+$/,
];

const isApiPath = (p: string) => p.startsWith("/api/") || p.startsWith("/classic-api/");

/** Diagnostic routes that disclose internals — closed completely in strict mode. */
const BLOCKED_IN_STRICT = [/^\/api\/debug\/(?!ping$)/, /^\/api\/chat\/diagnostics$/, /^\/api\/diagnostics\//];

export function extractToken(req: Request, cookieName: string): string | null {
  const fromCookie = (req as any).cookies?.[cookieName];
  if (fromCookie) return String(fromCookie);
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.substring(7).trim() || null;
  return null;
}

/**
 * The run engine executes user-supplied commands (spawn) and the preview route proxies to local
 * ports. On a multi-user server that is remote code execution for anyone who can sign up, so it is
 * OFF unless the operator opts in with ENABLE_RUN_ENGINE=true (private, single-user instances only).
 */
export const RUN_ENGINE_ENABLED = (process.env.ENABLE_RUN_ENGINE || "").toLowerCase() === "true";
const RUN_ENGINE_ROUTES = [
  /^\/api\/projects\/[^/]+\/(terminals|run|run\/status|stop)$/,
  /^\/api\/terminals\//,
  /^\/api\/preview\//,
];

export type SessionValidator = (token: string) => boolean | Promise<boolean>;

export function authGate(opts: { cookieName: string; isValidSession: SessionValidator }): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!PRIVACY_STRICT || !isApiPath(req.path) || req.method === "OPTIONS") return next();
    if (BLOCKED_IN_STRICT.some((re) => re.test(req.path))) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!RUN_ENGINE_ENABLED && RUN_ENGINE_ROUTES.some((re) => re.test(req.path))) {
      res.status(403).json({
        error: "Code execution is disabled on this deployment for security.",
        code: "RUN_ENGINE_DISABLED",
        hint: "Set ENABLE_RUN_ENGINE=true only on a private, single-user instance.",
      });
      return;
    }
    if (PUBLIC_API.some((re) => re.test(req.path))) return next();
    // The in-app preview proxy serves a user's own running project to an <iframe>,
    // which cannot attach headers — it is still bound to a signed-in session via the cookie.
    const token = extractToken(req, opts.cookieName);
    let valid = false;
    try {
      valid = Boolean(token && (await opts.isValidSession(token)));
    } catch {
      valid = false;
    }
    if (valid) return next();
    res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
  };
}

// ---------------------------------------------------------------------------
// Data-subject endpoints
// ---------------------------------------------------------------------------

export interface PrivacyRouteDeps {
  getUserId: (req: Request) => string | null;
  exportUser: (userId: string) => unknown;
  eraseUser: (userId: string) => Record<string, number>;
}

export const PRIVACY_POLICY = {
  product: "Darkness AI",
  summary:
    "Your chats, files and projects belong to you. They are stored only in this server's database, scoped to your account, and are never used for training or analytics by this application.",
  stored: [
    "Account: e-mail, display name, salted scrypt password hash",
    "Conversations and messages, uploaded files, generated artifacts, projects",
    "Model configurations you add (API keys are only ever used server-side)",
    "Short-lived session tokens (30 days, httpOnly cookie)",
  ],
  sentToThirdParties: [
    "The text you send is forwarded to the AI provider you select (Gemini, OpenAI, Anthropic, OpenRouter, Groq, …). Their privacy terms apply to that traffic.",
    "Agent web tools contact the websites you ask about. Private network addresses are blocked.",
  ],
  notCollected: ["No third-party analytics or trackers", "No advertising identifiers", "IP addresses are masked in server logs"],
  yourControls: {
    export: "GET /api/privacy/export  — download everything stored about you (JSON)",
    erase: "DELETE /api/privacy/erase with {\"confirm\":\"ERASE\"} — permanently delete your account and data",
  },
  retention: "Data is kept until you delete it. Erasure is immediate and irreversible.",
};

export function registerPrivacyRoutes(app: Express, deps: PrivacyRouteDeps): void {
  app.get("/api/privacy/policy", (_req, res) => {
    res.json({ strictMode: PRIVACY_STRICT, ...PRIVACY_POLICY });
  });

  app.get("/api/privacy/export", (req, res) => {
    const uid = deps.getUserId(req);
    if (!uid) return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    const payload = deps.exportUser(uid);
    res.setHeader("Content-Disposition", 'attachment; filename="my-data-export.json"');
    res.json({ exportedAt: new Date().toISOString(), ...(payload as object) });
  });

  app.delete("/api/privacy/erase", (req, res) => {
    const uid = deps.getUserId(req);
    if (!uid) return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    if (req.body?.confirm !== "ERASE") {
      return res.status(400).json({ error: 'Send {"confirm":"ERASE"} to permanently delete your account and data.' });
    }
    const removed = deps.eraseUser(uid);
    res.clearCookie("darkness_session", { path: "/" });
    res.json({ ok: true, removed });
  });
}

// ---------------------------------------------------------------------------
// One-call installer (runs before any route is registered)
// ---------------------------------------------------------------------------

export function applyPrivacyMiddleware(app: Express, opts: { cookieName: string; isValidSession: SessionValidator }): void {
  installLogRedaction();
  app.disable("x-powered-by");
  // Hops between the app and the real client: 1 on Render/Fly/Nginx, 2 when Vercel proxies to Render.
  app.set("trust proxy", intEnv("TRUST_PROXY_HOPS", isProd ? 1 : 0));
  app.use(securityHeaders());

  const apiLimit = rateLimit({ name: "api", windowMs: 60_000, max: intEnv("RATE_LIMIT_API_PER_MIN", 600) });
  const authLimit = rateLimit({ name: "auth", windowMs: 15 * 60_000, max: intEnv("RATE_LIMIT_AUTH_PER_15MIN", 20) });
  const aiLimit = rateLimit({ name: "ai", windowMs: 60_000, max: intEnv("RATE_LIMIT_AI_PER_MIN", 40) });
  app.use("/api/auth/login", authLimit);
  app.use("/api/auth/signup", authLimit);
  app.use("/api/agent/run", aiLimit);
  app.use(/^\/api\/(conversations\/[^/]+\/(chat|regenerate)|chat|studio\/chat|studio\/[a-z-]+\/(generate|brief|outline|recommend|image))$/, aiLimit);
  app.use(/^\/classic-api\/api\/(chat|chat\/stream|image|translate|search|code)$/, aiLimit);
  app.use("/api/", apiLimit);
  app.use("/classic-api/", apiLimit);

  app.use(authGate(opts));
}
