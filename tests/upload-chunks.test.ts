import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import test, { after } from "node:test";
import AdmZip from "adm-zip";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "darkness-chunks-test-"));
process.env.DARKNESS_UPLOAD_TMP = TMP;

const { acceptChunk, discardChunks, MAX_CHUNKS, MAX_ACTIVE_SESSIONS_PER_USER, sessionDir } = await import("../server/upload-chunks.js");
const { CHUNK_ROOT, UPLOAD_TMP_ROOT, sweepUploads, CHUNK_MAX_AGE_MS, ensureUploadDirs } = await import("../server/upload-temp.js");
const { extractZipSecurely } = await import("../server/project-analyzer.js");
ensureUploadDirs();
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const BIG = 100 * 1024 * 1024;
/** Write `bytes` to a throwaway "uploaded chunk" file, like the temp file the upload middleware hands over. */
let n = 0;
const chunkFile = (bytes: Buffer) => { const p = path.join(TMP, `incoming-${n++}.upload`); fs.writeFileSync(p, bytes); return p; };
const zipBytes = () => { const z = new AdmZip(); z.addFile("proj/a.txt", Buffer.from("alpha".repeat(5000))); z.addFile("proj/b.txt", Buffer.from("beta".repeat(5000))); return z.toBuffer(); };
const parts = (buf: Buffer, k: number) => { const size = Math.ceil(buf.length / k); return Array.from({ length: k }, (_, i) => buf.subarray(i * size, (i + 1) * size)); };

test("a normal chunked upload joins the parts into the original ZIP, and the extractor accepts it", async () => {
  const original = zipBytes();
  const pieces = parts(original, 3);
  const id = "up_1700000000000_abc123xyz";
  let r = await acceptChunk({ userKey: "u1", uploadId: id, index: 0, total: 3, tmpPath: chunkFile(pieces[0]), maxBytes: BIG });
  assert.deepEqual(r, { status: "uploading", received: 1 });
  r = await acceptChunk({ userKey: "u1", uploadId: id, index: 2, total: 3, tmpPath: chunkFile(pieces[2]), maxBytes: BIG }); // out of order is fine
  assert.deepEqual(r, { status: "uploading", received: 2 });
  r = await acceptChunk({ userKey: "u1", uploadId: id, index: 1, total: 3, tmpPath: chunkFile(pieces[1]), maxBytes: BIG });
  assert.equal(r.status, "complete");
  if (r.status !== "complete") return;
  const joined = fs.readFileSync(r.zipPath);
  assert.ok(joined.equals(original), "the joined file is byte-for-byte the original");
  assert.deepEqual(fs.readdirSync(path.dirname(r.zipPath)), ["joined.zip"], "the part files were removed after joining");
  const ex = extractZipSecurely(joined);
  assert.equal(ex.error, undefined);
  assert.deepEqual(ex.files.map((f) => f.path).sort(), ["a.txt", "b.txt"]);
  await discardChunks("u1", id);
  assert.equal(fs.existsSync(path.dirname(r.zipPath)), false, "the upload folder is removed when the caller is done");
});

test("an uploadId can never escape the upload folder (the old code built a path straight from it)", async () => {
  const before = fs.readdirSync(TMP).sort();
  for (const id of ["../../evil", "..\\..\\evil", "a/b", "/etc/passwd", "short", "x".repeat(65), "has space ok_12", "dots..dots..dots", "null\0byte_12345", ""]) {
    const r = await acceptChunk({ userKey: "u1", uploadId: id, index: 0, total: 1, tmpPath: chunkFile(Buffer.from("PK")), maxBytes: BIG });
    assert.equal(r.status, "error", JSON.stringify(id));
    if (r.status === "error") assert.equal(r.code, "INVALID_UPLOAD_ID");
  }
  assert.throws(() => sessionDir("u1", "../../evil"), /invalid upload id/);
  const after = fs.readdirSync(TMP).sort();
  assert.ok(!after.includes("evil") && after.filter((x) => !x.startsWith("incoming-")).join() === before.filter((x) => !x.startsWith("incoming-")).join(), "nothing was created outside the upload folder");
});

test("chunk numbers must be sane integers and the part count is capped", async () => {
  const id = "up_1700000000001_numbers01";
  const bad: Array<[number, number]> = [[0, 0], [0, MAX_CHUNKS + 1], [-1, 3], [3, 3], [5, 3], [1.5, 3], [0, 2.5], [NaN, 3], [0, Infinity]];
  for (const [index, total] of bad) {
    const r = await acceptChunk({ userKey: "u2", uploadId: id, index, total, tmpPath: chunkFile(Buffer.from("PKxx")), maxBytes: BIG });
    assert.equal(r.status, "error", `index ${index} of ${total}`);
    if (r.status === "error") assert.equal(r.code, "INVALID_CHUNK");
  }
});

test("a joined file that is not a ZIP is refused and removed; an oversized upload is refused and removed", async () => {
  const id = "up_1700000000002_notzip001";
  let r = await acceptChunk({ userKey: "u3", uploadId: id, index: 0, total: 1, tmpPath: chunkFile(Buffer.from("this is not a zip archive at all")), maxBytes: BIG });
  assert.equal(r.status, "error");
  if (r.status === "error") { assert.equal(r.http, 415); assert.equal(r.code, "INVALID_FILE_SIGNATURE"); }
  assert.equal(fs.existsSync(sessionDir("u3", id)), false, "nothing is kept");

  const id2 = "up_1700000000003_toobig001";
  r = await acceptChunk({ userKey: "u3", uploadId: id2, index: 0, total: 2, tmpPath: chunkFile(Buffer.alloc(4096, 0x50)), maxBytes: 3000 });
  assert.equal(r.status, "error");
  if (r.status === "error") assert.equal(r.http, 413);
  assert.equal(fs.existsSync(sessionDir("u3", id2)), false);
});

test("users are isolated, and one user may only have a few unfinished uploads", async () => {
  const id = "up_1700000000004_shared001";
  const buf = zipBytes();
  const [p1, p2] = parts(buf, 2);
  // the same upload id for two different users never mixes their parts
  await acceptChunk({ userKey: "alice", uploadId: id, index: 0, total: 2, tmpPath: chunkFile(p1), maxBytes: BIG });
  const bobFirst = await acceptChunk({ userKey: "bob", uploadId: id, index: 1, total: 2, tmpPath: chunkFile(p2), maxBytes: BIG });
  assert.deepEqual(bobFirst, { status: "uploading", received: 1 }, "bob's part does not complete alice's upload");
  assert.notEqual(sessionDir("alice", id), sessionDir("bob", id));
  await discardChunks("alice", id); await discardChunks("bob", id);

  const user = "carol";
  for (let i = 0; i < MAX_ACTIVE_SESSIONS_PER_USER; i++) {
    const r = await acceptChunk({ userKey: user, uploadId: `up_1700000000010_slot000${i}`, index: 0, total: 2, tmpPath: chunkFile(Buffer.from("PKab")), maxBytes: BIG });
    assert.equal(r.status, "uploading");
  }
  const over = await acceptChunk({ userKey: user, uploadId: "up_1700000000010_slot9999", index: 0, total: 2, tmpPath: chunkFile(Buffer.from("PKab")), maxBytes: BIG });
  assert.equal(over.status, "error");
  if (over.status === "error") assert.equal(over.http, 429);
  // an existing session can still continue
  const more = await acceptChunk({ userKey: user, uploadId: "up_1700000000010_slot0000", index: 1, total: 3, tmpPath: chunkFile(Buffer.from("PKab")), maxBytes: BIG });
  assert.equal(more.status, "uploading");
});

test("abandoned uploads are swept after a while; live ones are left alone", async () => {
  const stale = sessionDir("dave", "up_1700000000020_stale0001");
  const live = sessionDir("dave", "up_1700000000020_live00001");
  for (const d of [stale, live]) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "0.part"), "PKpart"); }
  const old = new Date(Date.now() - CHUNK_MAX_AGE_MS - 60_000);
  fs.utimesSync(stale, old, old);
  const removed = sweepUploads();
  assert.ok(removed >= 1);
  assert.equal(fs.existsSync(stale), false, "the abandoned upload is gone");
  assert.equal(fs.existsSync(live), true, "an upload that is still active is kept");
  assert.ok(UPLOAD_TMP_ROOT.startsWith(TMP) && CHUNK_ROOT.startsWith(UPLOAD_TMP_ROOT));
});
