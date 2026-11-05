import express from "express";

/**
 * JSON / form body-size limits, chosen per route.
 *
 * Before: ONE global limit of 100 MB for every route, so a signed-in user could make the server buffer and parse a 100 MB body on routes whose
 * real payload is a few hundred bytes (sign-in, memory, prompts, models, ...). Now three tiers, each sized from what the route really carries:
 *
 *   default  1 MB    structured data: accounts, memory notes, prompts, models, conversation metadata, ids, settings
 *   ai       25 MB   requests that go to a model: a pasted document or a base64 image attachment (~18 MB of image) must fit
 *   files    100 MB  routes that carry file or export content as JSON (shared files, project files, document / slide / diagram exports):
 *                    the product's documented per-file maximum (MAX_UPLOAD_SIZE_BYTES). Bigger files use the multipart upload routes, which
 *                    stream to disk and have their own limits (upload-config.ts)
 *
 * An oversized body is refused from its Content-Length header before any of it is read; a body without a length (chunked) is cut off as soon as
 * it passes the limit. Operators can change a tier: JSON_LIMIT_DEFAULT_MB, JSON_LIMIT_AI_MB, JSON_LIMIT_FILES_MB (see docs/ENVIRONMENT-VARIABLES.md).
 */
export const MB = 1024 * 1024;
export type Tier = "default" | "ai" | "files";
export interface BodyLimits { default: number; ai: number; files: number }

export const DEFAULT_LIMITS: BodyLimits = { default: 1 * MB, ai: 25 * MB, files: 100 * MB };
/** How long the rest of a refused body is discarded (not stored) before the connection is closed. */
export const DRAIN_GRACE_MS = 2000;

const parseMb = (raw: string | undefined, fallback: number): number => {
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) && n > 0 && n <= 1024 ? Math.round(n * MB) : fallback; // anything unusable keeps the safe default
};

export function bodyLimitsFromEnv(env: Record<string, string | undefined> = process.env): BodyLimits {
  return {
    default: parseMb(env.JSON_LIMIT_DEFAULT_MB, DEFAULT_LIMITS.default),
    ai: parseMb(env.JSON_LIMIT_AI_MB, DEFAULT_LIMITS.ai),
    files: parseMb(env.JSON_LIMIT_FILES_MB, DEFAULT_LIMITS.files),
  };
}

// Routes that carry file or export content as JSON.
const FILES: RegExp[] = [
  /^\/api\/files\/shared$/,
  /^\/api\/projects$/,
  /^\/api\/projects\/[^/]+\/(files|apply-changes|artifacts|versions)$/,
  /^\/api\/artifacts\/[^/]+$/, // editing a generated artifact replaces its content
  /^\/api\/document\/export-(docx|pdf)$/,
  /^\/api\/documents\/export$/,
  /^\/api\/presentation\/export-pptx$/,
  /^\/api\/diagrams\/render-image$/,
];
// Routes whose request goes to a model (long prompts, pasted documents, image attachments), and the original app's API.
const AI: RegExp[] = [
  /^\/api\/chat$/,
  /^\/api\/conversations\/[^/]+\/(chat|regenerate|messages)$/,
  /^\/api\/conversations\/[^/]+\/messages\/[^/]+\/edit$/,
  /^\/api\/copilot\/chat$/,
  /^\/api\/studio\//,
  /^\/api\/document\/(ai-edit|ai-generate|stream-generate)$/,
  /^\/api\/presentation\/ai-/,
  /^\/api\/projects\/[^/]+\/(chat|generate|explain-architecture|diagnostics(\/.*)?|advisor\/.*)$/,
  /^\/api\/builder\//,
  /^\/api\/knowledge\/rag\/(ask|search)$/,
  /^\/api\/prompts\/(run|compare|render|import)$/,
  /^\/api\/memory\/import$/,
  /^\/api\/compare$/,
  /^\/api\/agent\//,
  /^\/api\/models\/test$/,
  /^\/classic-api\//,
];

export function tierOf(path: string): Tier {
  if (FILES.some((re) => re.test(path))) return "files";
  if (AI.some((re) => re.test(path))) return "ai";
  return "default";
}

export function limitFor(path: string, limits: BodyLimits = DEFAULT_LIMITS): number { return limits[tierOf(path)]; }

/** One middleware that parses JSON and URL-encoded bodies with the limit of the tier the request path belongs to. */
export function bodyParsers(limits: BodyLimits = bodyLimitsFromEnv()): express.RequestHandler {
  const json = { default: express.json({ limit: limits.default }), ai: express.json({ limit: limits.ai }), files: express.json({ limit: limits.files }) };
  const form = {
    default: express.urlencoded({ extended: true, limit: limits.default }),
    ai: express.urlencoded({ extended: true, limit: limits.ai }),
    files: express.urlencoded({ extended: true, limit: limits.files }),
  };
  return (req, res, next) => {
    const tier = tierOf(req.path);
    const limit = limits[tier];
    // Refuse early. Express's own parser rejects an oversized body only AFTER it has read (and thrown away) the whole request, so a client that
    // announces 100 MB, or streams chunks without end, would keep the connection busy. This guard answers 413 at once and closes the socket.
    // It applies to JSON and form bodies only: multipart uploads are not parsed here and have their own limits (upload-config.ts).
    if (req.is(["json", "urlencoded"])) {
      const refuse = () => {
        if (res.headersSent) return;
        res.status(413).json(tooLargePayload(limit));
        // Neither closing the socket at once NOR announcing "Connection: close" is safe: Node tears the socket down when that response ends, the
        // unread rest of a big upload then resets the connection and the client loses the 413 it is owed (seen as "fetch failed", intermittently,
        // for 26-30 MB bodies). So the connection stays open and the rest of the body is DISCARDED (never buffered) for a short, bounded grace
        // period; whatever is still unfinished after that is cut.
        req.resume();
        const cut = setTimeout(() => req.destroy(), DRAIN_GRACE_MS);
        cut.unref?.();
        req.once("end", () => clearTimeout(cut));
        req.once("close", () => clearTimeout(cut));
      };
      const declared = req.headers["content-length"];
      if (declared !== undefined) {
        const n = Number(declared);
        if (Number.isFinite(n) && n > limit) return refuse();
      } else if (req.headers["transfer-encoding"]) {
        let seen = 0; // chunked: no announced size, so count what arrives
        req.on("data", (chunk: Buffer) => { seen += chunk.length; if (seen > limit) refuse(); });
      }
    }
    json[tier](req, res, (err?: unknown) => (err ? next(err) : form[tier](req, res, next)));
  };
}

/** Error handler: a JSON / form body over its route's limit gets an accurate 413 (naming that route's limit) and the connection is closed. */
export const bodyTooLargeHandler: express.ErrorRequestHandler = (err, req, res, next) => {
  if (err && (err.type === "entity.too.large" || (res.headersSent && res.statusCode === 413))) {
    if (res.headersSent) return; // the early guard already answered; it also closes the connection after its grace period
    res.setHeader("Connection", "close"); // do not keep reading what the client is still sending
    res.status(413).json(tooLargePayload(err.limit));
    return;
  }
  next(err);
};

/** The answer for a body over the limit; shared by the server's error handler and the tests. */
export function tooLargePayload(limitBytes: number | undefined): { error: string; message: string; maxBytes: number; maxMB: number } {
  const bytes = Number(limitBytes) > 0 ? Number(limitBytes) : DEFAULT_LIMITS.default;
  const mb = Math.round((bytes / MB) * 10) / 10;
  return { error: "PAYLOAD_TOO_LARGE", message: `This request is larger than the ${mb} MB this endpoint accepts. Send less data, or use the file upload for large files.`, maxBytes: bytes, maxMB: mb };
}
