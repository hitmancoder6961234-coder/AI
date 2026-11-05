import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Request } from "express";

/**
 * Temporary storage for uploads.
 *
 * Uploaded file parts are streamed to this private folder instead of being held in memory. Every temp file is registered
 * against its request and deleted when the response ends (success, failure OR the client dropping the connection). A sweep
 * at start-up removes anything a crashed process left behind, and a periodic sweep removes anything abandoned later
 * (for example chunks of a ZIP upload that was never finished).
 */
export const UPLOAD_TMP_ROOT = path.join(process.env.DARKNESS_UPLOAD_TMP || os.tmpdir(), "darkness-uploads");
const REQUEST_DIR = path.join(UPLOAD_TMP_ROOT, "req");
export const CHUNK_ROOT = path.join(UPLOAD_TMP_ROOT, "chunks");

/** Plain request temp files older than this are orphans (a request never legitimately lasts this long). */
export const REQUEST_TMP_MAX_AGE_MS = 20 * 60 * 1000;
/** A chunked upload must finish within this long of its last chunk. */
export const CHUNK_MAX_AGE_MS = 60 * 60 * 1000;

export function ensureUploadDirs(): void {
  for (const d of [UPLOAD_TMP_ROOT, REQUEST_DIR, CHUNK_ROOT]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
}

export function requestTmpDir(): string {
  ensureUploadDirs();
  return REQUEST_DIR;
}

type Tracked = Request & { __uploadTemps?: string[] };

/** Remember a temp file so it is removed when the request is over. */
export function trackTemp(req: Request, file: string): void {
  const r = req as Tracked;
  (r.__uploadTemps ||= []).push(file);
}

/** Delete every temp file registered for this request. Never throws. */
export async function cleanupRequestTemps(req: Request): Promise<void> {
  const r = req as Tracked;
  const list = r.__uploadTemps || [];
  r.__uploadTemps = [];
  await Promise.all(list.map((p) => fs.promises.unlink(p).catch(() => {})));
}

/** Temp files currently registered (tests). */
export function trackedTemps(req: Request): string[] {
  return ((req as Tracked).__uploadTemps || []).slice();
}

function rmQuiet(p: string): void {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
}

/** Remove entries under `dir` whose last change is older than `maxAgeMs`. Returns how many were removed. */
export function sweepDir(dir: string, maxAgeMs: number, now = Date.now()): number {
  let removed = 0;
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return 0; }
  for (const name of names) {
    const p = path.join(dir, name);
    try {
      const st = fs.statSync(p);
      // a directory's own mtime only changes when entries are added/removed, which is exactly "last chunk arrived"
      if (now - st.mtimeMs > maxAgeMs) { rmQuiet(p); removed++; }
    } catch { /* vanished */ }
  }
  return removed;
}

/** Remove abandoned uploads: stale request temps and stale chunk sessions (per-user folders are tidied when empty). */
export function sweepUploads(now = Date.now()): number {
  let removed = sweepDir(REQUEST_DIR, REQUEST_TMP_MAX_AGE_MS, now);
  let users: string[] = [];
  try { users = fs.readdirSync(CHUNK_ROOT); } catch { users = []; }
  for (const u of users) {
    const userDir = path.join(CHUNK_ROOT, u);
    removed += sweepDir(userDir, CHUNK_MAX_AGE_MS, now);
    try { if (fs.readdirSync(userDir).length === 0) fs.rmdirSync(userDir); } catch { /* not empty / gone */ }
  }
  return removed;
}

/** At start-up nothing is in flight, so everything left behind is an orphan. */
export function purgeUploadTemps(): void {
  rmQuiet(UPLOAD_TMP_ROOT);
  ensureUploadDirs();
}

let timer: NodeJS.Timeout | null = null;
export function startUploadSweeper(intervalMs = 10 * 60 * 1000): void {
  if (timer) return;
  purgeUploadTemps();
  timer = setInterval(() => { try { sweepUploads(); } catch { /* never crash the server over housekeeping */ } }, intervalMs);
  timer.unref();
}
export function stopUploadSweeper(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
