import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import { cleanupRequestTemps, requestTmpDir, trackTemp } from "./upload-temp.js";
import { readHead, validateSignature } from "./upload-validation.js";

/**
 * CANONICAL UPLOAD CONFIGURATION
 *
 * Strict maximum upload size: exactly 100 MB across the entire application.
 * 100 MB = 104,857,600 bytes.
 */
export const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024; // 104,857,600 bytes
export const MAX_UPLOAD_SIZE_MB = 100;
export const FILE_TOO_LARGE_ERROR = "FILE_TOO_LARGE";
export const FILE_TOO_LARGE_MESSAGE = "File is too large. Maximum allowed size is 100 MB.";

export const FILE_TOO_LARGE_PAYLOAD = {
  error: FILE_TOO_LARGE_ERROR,
  message: FILE_TOO_LARGE_MESSAGE,
  maxBytes: MAX_UPLOAD_SIZE_BYTES,
  maxMB: MAX_UPLOAD_SIZE_MB,
} as const;

/**
 * Check if a given file size in bytes exceeds the maximum allowed upload limit.
 */
export function isFileTooLarge(sizeInBytes?: number | null): boolean {
  if (typeof sizeInBytes !== "number" || isNaN(sizeInBytes)) return false;
  return sizeInBytes > MAX_UPLOAD_SIZE_BYTES;
}

/**
 * Check if any file in an array of Multer files or buffer sizes exceeds the limit.
 */
export function hasOversizedFile(files?: Array<{ size?: number; buffer?: Buffer }>): boolean {
  if (!files || !Array.isArray(files)) return false;
  return files.some((f) => {
    if (!f) return false;
    const s = typeof f.size === "number" ? f.size : (f.buffer?.length ?? 0);
    return isFileTooLarge(s);
  });
}

const MB = 1024 * 1024;

/**
 * Upload profiles. Every upload route picks the smallest profile that fits.
 *
 *   fileSize        largest single file (the canonical 100 MB product limit), enforced WHILE the file streams in
 *   files/fields/parts/fieldSize   multipart shape: a text field is never legitimately large
 *   maxRequestBytes aggregate cap for the whole request, checked from Content-Length BEFORE any body is read
 *   checkContent    verify the file's real content against its type (signature / text checks, server/upload-validation.ts)
 *   blockExecutables refuse executable programs outright (document routes)
 */
export const UPLOAD_PROFILES = {
  /** one document: import / convert / classic upload */
  single: { fileSize: MAX_UPLOAD_SIZE_BYTES, files: 1, fields: 20, fieldSize: 1 * MB, parts: 25, maxRequestBytes: MAX_UPLOAD_SIZE_BYTES + 5 * MB, checkContent: true, blockExecutables: true },
  /** a handful of documents at once: RAG upload, document extract (the UI allows 20) */
  documents: { fileSize: MAX_UPLOAD_SIZE_BYTES, files: 20, fields: 30, fieldSize: 1 * MB, parts: 60, maxRequestBytes: 250 * MB, checkContent: true, blockExecutables: true },
  /** folder / multi-file project import: the web app sends 50 files per request, so 100 leaves headroom */
  folder: { fileSize: MAX_UPLOAD_SIZE_BYTES, files: 100, fields: 250, fieldSize: 1 * MB, parts: 400, maxRequestBytes: 250 * MB, checkContent: true, blockExecutables: false },
  /** one ZIP, or one chunk of a ZIP (a chunk is a slice of the middle of a file, so it has no signature of its own) */
  archive: { fileSize: MAX_UPLOAD_SIZE_BYTES, files: 1, fields: 30, fieldSize: 1 * MB, parts: 40, maxRequestBytes: MAX_UPLOAD_SIZE_BYTES + 5 * MB, checkContent: false, blockExecutables: true },
} as const;

export type UploadProfileName = keyof typeof UPLOAD_PROFILES;

/**
 * File parts are streamed straight to a private temp folder; nothing is buffered in memory while a request is received.
 * Every temp file is registered against its request so it is removed when the response ends, whatever happened.
 */
function makeDiskStorage() {
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      try { cb(null, requestTmpDir()); } catch (e) { cb(e as Error, ""); }
    },
    filename: (req, _file, cb) => {
      const name = `${crypto.randomUUID()}.upload`;
      trackTemp(req as express.Request, path.join(requestTmpDir(), name));
      cb(null, name);
    },
  });
}

/** A Multer instance that streams to the private temp folder with the given limits (tests use it to try small limits). */
export function createUploader(limits: multer.Options["limits"]) {
  return multer({ storage: makeDiskStorage(), limits });
}

function makeUploader(name: UploadProfileName) {
  const p = UPLOAD_PROFILES[name];
  return createUploader({ fileSize: p.fileSize, files: p.files, fields: p.fields, fieldSize: p.fieldSize, parts: p.parts });
}

export const uploaders = {
  single: makeUploader("single"),
  documents: makeUploader("documents"),
  folder: makeUploader("folder"),
  archive: makeUploader("archive"),
};

/** @deprecated use `uploaders.<profile>`; kept so existing imports keep working, and bounded like the folder profile. */
export const sharedMulter = uploaders.folder;

/** Most uploads one signed-in browser may have in flight at once. */
export const MAX_CONCURRENT_UPLOADS_PER_USER = 3;
/** Most uploads the whole server will receive at once (each one occupies temp disk and a socket). */
export const MAX_CONCURRENT_UPLOADS_GLOBAL = 16;
/** A connection that sends nothing for this long while uploading is cut off (stalled or slow-loris clients). */
export const UPLOAD_IDLE_TIMEOUT_MS = 60_000;

const inFlight = new Map<string, number>();
let inFlightTotal = 0;

function uploaderKey(req: express.Request): string {
  const who = String(req.headers.authorization || req.headers.cookie || req.ip || "anon");
  return crypto.createHash("sha256").update(who).digest("hex").slice(0, 24);
}

/** Test hook: how many uploads are currently counted for a request's caller, and in total. */
export function _inFlightUploads(req?: express.Request): number {
  return req ? inFlight.get(uploaderKey(req)) || 0 : inFlightTotal;
}

/**
 * Give each uploaded file a `buffer` that is read from its temp file ON FIRST USE, so existing handlers keep working
 * unchanged while the request itself never holds file contents in memory. Only the most recently read file stays cached,
 * so a handler that walks its files one by one holds one file at a time rather than all of them.
 */
function attachLazyBuffers(files: Express.Multer.File[]): void {
  const cache = new Map<Express.Multer.File, Buffer>();
  for (const f of files) {
    if (!f || !f.path) continue;
    Object.defineProperty(f, "buffer", {
      configurable: true,
      enumerable: false,
      get() {
        let b = cache.get(f);
        if (!b) {
          b = fs.readFileSync(f.path);
          cache.clear();
          cache.set(f, b);
        }
        return b;
      },
    });
  }
}

function collectFiles(req: express.Request): Express.Multer.File[] {
  const all: Express.Multer.File[] = [];
  if (req.file) all.push(req.file);
  if (Array.isArray(req.files)) all.push(...(req.files as Express.Multer.File[]));
  else if (req.files && typeof req.files === "object") Object.values(req.files).forEach((v) => { if (Array.isArray(v)) all.push(...v); });
  return all;
}

export interface WrapOptions {
  /** override the profile's content check (the chunk route validates the assembled archive instead) */
  checkContent?: boolean;
}

/**
 * Express middleware wrapper around a Multer handler. In order, it:
 *   1. refuses a request whose declared size is over the profile's cap, before reading any of it;
 *   2. enforces the per-caller and server-wide concurrency limits;
 *   3. cuts off connections that stall;
 *   4. receives the files into temp storage, mapping Multer's errors to clear 4xx answers;
 *   5. verifies every file's real content against its type (415 INVALID_FILE_SIGNATURE / EXECUTABLE_CONTENT / ...);
 *   6. always removes the temp files and releases the slots when the response ends (success, failure or disconnect).
 */
export function wrapUploadMiddleware(multerHandler: express.RequestHandler, profile: UploadProfileName = "folder", options: WrapOptions = {}): express.RequestHandler {
  const cfg = UPLOAD_PROFILES[profile];
  const checkContent = options.checkContent ?? cfg.checkContent;
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // 1. Aggregate size (chunked requests carry no length; those are still bounded by per-file and file-count limits).
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > cfg.maxRequestBytes) {
      res.setHeader("Connection", "close");
      return res.status(413).json({ ...FILE_TOO_LARGE_PAYLOAD, message: `This upload is too large (more than ${Math.round(cfg.maxRequestBytes / MB)} MB in one request).` });
    }

    // 2. Concurrency.
    const key = uploaderKey(req);
    const running = inFlight.get(key) || 0;
    if (running >= MAX_CONCURRENT_UPLOADS_PER_USER) {
      res.setHeader("Retry-After", "5");
      return res.status(429).json({ error: "TOO_MANY_UPLOADS", message: "Too many uploads at once. Wait for the current ones to finish and try again." });
    }
    if (inFlightTotal >= MAX_CONCURRENT_UPLOADS_GLOBAL) {
      res.setHeader("Retry-After", "10");
      return res.status(503).json({ error: "SERVER_BUSY", message: "The server is receiving many uploads right now. Try again in a few seconds." });
    }
    inFlight.set(key, running + 1);
    inFlightTotal++;

    // 3. Stalled connections.
    const idleMs = Number(process.env.DARKNESS_UPLOAD_IDLE_MS) || UPLOAD_IDLE_TIMEOUT_MS;
    const sock = req.socket;
    const onIdle = () => { try { req.destroy(); } catch { /* already closed */ } };
    sock.setTimeout(idleMs);
    sock.on("timeout", onIdle);

    // 6. Whatever happens, free the slots and delete the temp files once the response is over (finish OR connection closed).
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const left = (inFlight.get(key) || 1) - 1;
      if (left <= 0) inFlight.delete(key);
      else inFlight.set(key, left);
      inFlightTotal = Math.max(0, inFlightTotal - 1);
      sock.off("timeout", onIdle);
      try { sock.setTimeout(0); } catch { /* socket gone */ }
      void cleanupRequestTemps(req);
    };
    res.once("finish", release);
    res.once("close", release);

    const fail = async (status: number, body: Record<string, unknown>) => {
      await cleanupRequestTemps(req);
      if (!res.headersSent) res.status(status).json(body);
    };

    // 4. Receive.
    multerHandler(req, res, async (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_FIELD_COUNT" || err.code === "LIMIT_FIELD_KEY" || err.code === "LIMIT_FIELD_VALUE" || err.code === "LIMIT_UNEXPECTED_FILE") {
          return fail(400, { error: err.code, message: "This upload has more files or fields than this action accepts." });
        }
        if (err.code === "LIMIT_FILE_SIZE" || err.code === "LIMIT_PART_COUNT" || err.type === "entity.too.large" || err.status === 413 || err.statusCode === 413) {
          return fail(413, { ...FILE_TOO_LARGE_PAYLOAD });
        }
        return fail(400, { error: err.message || "Upload failed" });
      }

      const files = collectFiles(req);
      for (const f of files) {
        const sz = typeof f.size === "number" ? f.size : 0;
        if (isFileTooLarge(sz)) return fail(413, { ...FILE_TOO_LARGE_PAYLOAD });
      }

      // 5. Content: what the bytes are has to agree with what the file claims to be.
      if (checkContent) {
        for (const f of files) {
          try {
            const verdict = validateSignature(f.originalname, await readHead(f.path), { blockExecutables: cfg.blockExecutables });
            if (!verdict.ok) return fail(415, { error: verdict.code, message: verdict.message, filename: path.basename(f.originalname || "") });
          } catch {
            return fail(400, { error: "UPLOAD_UNREADABLE", message: "The uploaded file could not be read. Please try again." });
          }
        }
      }

      attachLazyBuffers(files);
      next();
    });
  };
}
