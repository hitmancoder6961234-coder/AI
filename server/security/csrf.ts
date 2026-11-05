import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * CSRF guard for cookie-authenticated requests.
 *
 * The session lives in an HttpOnly cookie, which the browser attaches to ANY request to this site, including ones started
 * by another website. CORS only stops a foreign page from READING the answer; it does not stop a form post or a
 * text/plain fetch from changing state. So a state-changing request that relies on the cookie alone must come from this
 * site:
 *
 *   - safe methods (GET/HEAD/OPTIONS) are never blocked;
 *   - requests with an Authorization header are not using the ambient cookie, so they are not affected;
 *   - requests without a session cookie have nothing to forge;
 *   - otherwise the browser's Origin must match this site (Host, or X-Forwarded-Host behind the Vercel proxy) or be on the
 *     allow-list (CORS_ORIGINS). Browsers always send Origin on cross-origin POST/PUT/PATCH/DELETE; when it is missing we
 *     fall back to Sec-Fetch-Site, and plain non-browser clients (curl, server-to-server) are let through.
 */
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

function hostOf(origin: string): string {
  try { return new URL(origin).host.toLowerCase(); } catch { return ""; }
}

export function csrfOriginGuard(cookieName: string, extraOrigins: () => string[] = () => []): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE.has(req.method)) return next();
    if (req.headers.authorization) return next();
    const cookies = String(req.headers.cookie || "");
    if (!cookies.includes(`${cookieName}=`)) return next();

    const deny = () => res.status(403).json({ error: "This request did not come from this site.", code: "CROSS_ORIGIN_BLOCKED" });

    const origin = req.headers.origin;
    if (typeof origin === "string" && origin) {
      if (origin === "null") return deny();
      const h = hostOf(origin);
      const mine = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase();
      if (h && h === mine) return next();
      if (extraOrigins().some((o) => o.replace(/\/+$/, "").toLowerCase() === origin.toLowerCase())) return next();
      return deny();
    }
    // No Origin: same-origin navigations and non-browser clients. A browser still says where the request came from.
    const site = String(req.headers["sec-fetch-site"] || "");
    if (site === "cross-site") return deny();
    return next();
  };
}
