import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CHUNK_ROOT, ensureUploadDirs } from "./upload-temp.js";

/**
 * Chunked ZIP uploads. The browser slices a big archive into 8 MB parts and posts them one by one; once all parts are here
 * they are joined and extracted.
 *
 * Safety rules (the old code built paths such as `upload_<uploadId>_<n>.part` in the shared system temp folder straight from
 * client input, so an uploadId like "../../x" could write outside it, two users could overwrite each other's parts, and an
 * abandoned upload left parts behind for ever):
 *   - uploadId must match a strict pattern and is only ever used as a directory name inside the caller's own folder;
 *   - chunk numbers must be integers in range and the part count is capped;
 *   - each user has their own folder and may have only a few unfinished uploads;
 *   - the running size is checked after every chunk, and the joined file must really be a ZIP;
 *   - parts are joined by streaming, never read whole into memory;
 *   - unfinished uploads are swept by server/upload-temp.ts after CHUNK_MAX_AGE_MS.
 */
export const UPLOAD_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const MAX_CHUNKS = 200;
export const MAX_ACTIVE_SESSIONS_PER_USER = 2;

export type ChunkResult =
  | { status: "uploading"; received: number }
  | { status: "complete"; zipPath: string }
  | { status: "error"; http: number; code: string; message: string };

const err = (http: number, code: string, message: string): ChunkResult => ({ status: "error", http, code, message });

function userDir(userKey: string): string {
  return path.join(CHUNK_ROOT, crypto.createHash("sha256").update(String(userKey)).digest("hex").slice(0, 24));
}
export function sessionDir(userKey: string, uploadId: string): string {
  if (!UPLOAD_ID_RE.test(uploadId)) throw new Error("invalid upload id");
  return path.join(userDir(userKey), uploadId);
}

/** Remove an upload session and everything in it. Never throws. */
export async function discardChunks(userKey: string, uploadId: string): Promise<void> {
  try {
    await fs.promises.rm(sessionDir(userKey, uploadId), { recursive: true, force: true });
  } catch { /* invalid id or already gone */ }
}

async function moveInto(src: string, dest: string): Promise<void> {
  try {
    await fs.promises.rename(src, dest);
  } catch {
    await fs.promises.copyFile(src, dest); // different device: copy then remove
    await fs.promises.unlink(src).catch(() => {});
  }
}

async function appendStream(src: string, ws: fs.WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const rs = fs.createReadStream(src);
    rs.on("error", reject);
    rs.on("end", resolve);
    rs.pipe(ws, { end: false });
  });
}

export async function acceptChunk(o: { userKey: string; uploadId: string; index: number; total: number; tmpPath: string; maxBytes: number }): Promise<ChunkResult> {
  const { userKey, uploadId, index, total, tmpPath, maxBytes } = o;
  if (!UPLOAD_ID_RE.test(String(uploadId))) return err(400, "INVALID_UPLOAD_ID", "The upload id is not valid.");
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || total > MAX_CHUNKS || index < 0 || index >= total) {
    return err(400, "INVALID_CHUNK", `Chunk numbers are out of range (1 to ${MAX_CHUNKS} parts).`);
  }

  ensureUploadDirs();
  const root = userDir(userKey);
  const dir = sessionDir(userKey, uploadId);
  await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(dir)) {
    const active = (await fs.promises.readdir(root).catch(() => [] as string[])).length;
    if (active >= MAX_ACTIVE_SESSIONS_PER_USER) {
      return err(429, "TOO_MANY_UPLOADS", "Too many unfinished uploads. Finish or wait for the others to expire.");
    }
    await fs.promises.mkdir(dir, { mode: 0o700 });
  }

  await moveInto(tmpPath, path.join(dir, `${index}.part`));
  const now = new Date();
  await fs.promises.utimes(dir, now, now).catch(() => {}); // this upload is alive: keep the sweeper away

  // Which parts are here, and how big are they together?
  const present = new Set<number>();
  let bytes = 0;
  for (const name of await fs.promises.readdir(dir)) {
    const m = /^(\d{1,3})\.part$/.exec(name);
    if (!m) continue;
    const n = Number(m[1]);
    if (n >= total) continue;
    present.add(n);
    bytes += (await fs.promises.stat(path.join(dir, name))).size;
  }
  if (bytes > maxBytes) {
    await discardChunks(userKey, uploadId);
    return err(413, "FILE_TOO_LARGE", "The archive is larger than the allowed size.");
  }
  if (present.size < total) return { status: "uploading", received: present.size };

  // All parts are here: join them by streaming.
  const zipPath = path.join(dir, "joined.zip");
  const ws = fs.createWriteStream(zipPath, { mode: 0o600 });
  try {
    for (let i = 0; i < total; i++) await appendStream(path.join(dir, `${i}.part`), ws);
    await new Promise<void>((resolve, reject) => { ws.on("error", reject); ws.end(resolve); });
  } catch (e) {
    ws.destroy();
    await discardChunks(userKey, uploadId);
    return err(500, "CHUNK_JOIN_FAILED", "The upload parts could not be joined. Please try again.");
  }
  for (let i = 0; i < total; i++) await fs.promises.unlink(path.join(dir, `${i}.part`)).catch(() => {});

  // The first bytes of a real ZIP are "PK"; refuse anything else before it goes near the extractor.
  const fh = await fs.promises.open(zipPath, "r");
  const head = Buffer.alloc(4);
  try { await fh.read(head, 0, 4, 0); } finally { await fh.close(); }
  if (head[0] !== 0x50 || head[1] !== 0x4b) {
    await discardChunks(userKey, uploadId);
    return err(415, "INVALID_FILE_SIGNATURE", "The uploaded file is not a valid ZIP archive.");
  }
  return { status: "complete", zipPath };
}
