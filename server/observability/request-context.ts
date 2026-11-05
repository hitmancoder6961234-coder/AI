import crypto from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { logger, requestStore, type RequestContext } from "./logger.js";

/**
 * Request IDs.
 *
 * Every request gets an id (generated here, or taken from an incoming `X-Request-Id` when it is well formed, which lets the
 * Vercel proxy or a load balancer correlate its own logs with ours). The id is:
 *   - returned in the `X-Request-Id` response header,
 *   - added as `requestId` to every JSON ERROR body (status >= 400), so a user can quote it in a bug report,
 *   - attached to every log line written while the request is being served (see logger.ts),
 *   - and on the access log entry written when the response finishes.
 * Existing response shapes are unchanged: the field is only ever ADDED, and only to error bodies.
 */
export const REQUEST_ID_HEADER = "x-request-id";
const VALID_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function newRequestId(): string {
  return "req_" + crypto.randomBytes(9).toString("base64url");
}

/** Use the caller's id only if it is a plain token of sane length (never reflect arbitrary header content into logs). */
export function pickRequestId(incoming: unknown): string {
  const v = Array.isArray(incoming) ? incoming[0] : incoming;
  return typeof v === "string" && VALID_ID.test(v) ? v : newRequestId();
}

type Ctx = Request & { requestContext?: RequestContext; id?: string };

const QUIET = /^\/(?:api\/(?:health|ready|readyz|healthz)|assets\/|favicon|manifest|sw\.js|icon)/;

export function requestContext(opts: { accessLog?: boolean } = {}): RequestHandler {
  const accessLog = opts.accessLog ?? (process.env.LOG_ACCESS || "true").toLowerCase() !== "false";
  return (req: Request, res: Response, next: NextFunction) => {
    const id = pickRequestId(req.headers[REQUEST_ID_HEADER]);
    const path = (req.originalUrl || req.url || "").split("?")[0].slice(0, 200); // never the query string: it can carry tokens
    const ctx: RequestContext = { requestId: id, method: req.method, path, startedAt: Date.now() };
    (req as Ctx).requestContext = ctx;
    (req as Ctx).id = id;
    res.locals.requestId = id;
    res.setHeader("X-Request-Id", id);

    // Add the id to JSON error bodies without touching any route: wrap res.json once.
    const json = res.json.bind(res);
    res.json = ((body?: unknown) => {
      if (res.statusCode >= 400 && body && typeof body === "object" && !Array.isArray(body) && !("requestId" in (body as object))) {
        body = { ...(body as Record<string, unknown>), requestId: id };
      }
      return json(body);
    }) as typeof res.json;

    if (accessLog && !QUIET.test(path)) {
      res.on("finish", () => {
        const status = res.statusCode;
        const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
        requestStore.run(ctx, () => logger[level]("http_request", {
          method: req.method,
          route: path,
          status,
          durationMs: Date.now() - ctx.startedAt,
          bytes: Number(res.getHeader("content-length")) || undefined,
        }));
      });
      res.on("close", () => {
        if (!res.writableFinished) {
          requestStore.run(ctx, () => logger.warn("http_request_aborted", { method: req.method, route: path, durationMs: Date.now() - ctx.startedAt }));
        }
      });
    }
    requestStore.run(ctx, next);
  };
}

/**
 * Body parsers continue from the socket's own async context, which drops the request id. Place this right after them to
 * re-enter the request's context for everything that follows (route handlers, provider calls, their logs).
 */
export function rebindRequestContext(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const ctx = (req as Ctx).requestContext;
    if (ctx) requestStore.run(ctx, next);
    else next();
  };
}

/** Last-resort error handler: a JSON answer carrying the request id, and a log line without the stack or payload. */
export function jsonErrorHandler(): (err: any, req: Request, res: Response, next: NextFunction) => void {
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = Number(err?.status || err?.statusCode) >= 400 && Number(err?.status || err?.statusCode) < 600 ? Number(err.status || err.statusCode) : 500;
    const ctx = (req as Ctx).requestContext;
    requestStore.run(ctx || { requestId: (req as Ctx).id || newRequestId(), method: req.method, path: req.path, startedAt: Date.now() }, () =>
      (status >= 500 ? logger.error : logger.warn)("request_error", { status, err }),
    );
    // 4xx messages (malformed JSON, payload too large, ...) are safe and useful; 5xx never expose internals.
    const message = status < 500 ? String(err?.message || "Bad request").slice(0, 200) : "Internal server error";
    res.status(status).json({ error: message, code: status < 500 ? err?.type || "BAD_REQUEST" : "INTERNAL_ERROR" });
  };
}
