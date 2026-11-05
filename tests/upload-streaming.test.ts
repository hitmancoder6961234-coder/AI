import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import test, { after, before } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";

// A private temp area for this test file, and an idle timeout short enough for the stalled-upload case yet far above a CPU-starved test runner (400 ms failed when the machine was busy).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "darkness-upload-stream-test-"));
process.env.DARKNESS_UPLOAD_TMP = TMP;
process.env.DARKNESS_UPLOAD_IDLE_MS = "1500";

const { UPLOAD_PROFILES, uploaders, createUploader, wrapUploadMiddleware, _inFlightUploads } = await import("../server/upload-config.js");
const { UPLOAD_TMP_ROOT } = await import("../server/upload-temp.js");

const REQ_DIR = path.join(UPLOAD_TMP_ROOT, "req");
const tempFiles = () => (fs.existsSync(REQ_DIR) ? fs.readdirSync(REQ_DIR) : []);
const settle = async (until: () => boolean, ms = 10_000) => { const t0 = Date.now(); while (!until() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 25)); };

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), crypto.randomBytes(2048)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(512)]);
const PE = (() => { const h = Buffer.alloc(300); h.write("MZ", 0); h.writeUInt32LE(0x80, 0x3c); h.write("PE\0\0", 0x80, "latin1"); return h; })();

let server: http.Server;
let port = 0;
let seenDuringHandler: { exists: boolean; lazy: boolean; sameBytes: boolean } | null = null;

before(async () => {
  const app = express();
  const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
  app.post("/doc", wrapUploadMiddleware(uploaders.single.single("file"), "single"), (req, res) => {
    const f = req.file!;
    const desc = Object.getOwnPropertyDescriptor(f, "buffer");
    const existsBefore = fs.existsSync(f.path);
    const lazy = typeof desc?.get === "function"; // nothing loaded into memory yet
    const hash = sha(f.buffer);
    seenDuringHandler = { exists: existsBefore, lazy, sameBytes: false };
    res.json({ ok: true, size: f.size, sha: hash, name: f.originalname });
  });
  app.post("/project", wrapUploadMiddleware(uploaders.folder.array("files"), "folder"), (req, res) => res.json({ ok: true, names: (req.files as Express.Multer.File[]).map((f) => f.originalname) }));
  const tiny = createUploader({ fileSize: 1024, files: 1 });
  app.post("/tiny", wrapUploadMiddleware(tiny.single("file"), "single"), (_req, res) => res.json({ ok: true }));
  app.post("/slow", wrapUploadMiddleware(uploaders.single.single("file"), "single"), (_req, res) => res.json({ ok: true }));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
after(() => { server.close(); server.closeAllConnections?.(); fs.rmSync(TMP, { recursive: true, force: true }); });

const url = (p: string) => `http://127.0.0.1:${port}${p}`;
const send = (p: string, name: string, body: Buffer | string, extra: Record<string, string> = {}) => {
  const f = new FormData();
  f.append(p === "/project" ? "files" : "file", new Blob([typeof body === "string" ? body : new Uint8Array(body)]), name); // the folder route reads "files", the others "file"
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return fetch(url(p), { method: "POST", body: f });
};

test("a valid file streams to temp storage, is read lazily, and its temp file is gone afterwards", async () => {
  const r = await send("/doc", "report.pdf", PDF);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.size, PDF.length);
  assert.equal(j.sha, crypto.createHash("sha256").update(PDF).digest("hex"), "the handler reads exactly the bytes that were sent");
  assert.deepEqual(seenDuringHandler, { exists: true, lazy: true, sameBytes: false }, "a real temp file existed, and the file was not preloaded into memory");
  await settle(() => tempFiles().length === 0);
  assert.deepEqual(tempFiles(), [], "no temp file is left after a successful upload");
});

test("the real content is checked: wrong signature, disguised executable and binary-in-text are refused with 415 and leave nothing behind", async () => {
  const cases: Array<[string, string, Buffer | string, string]> = [
    ["/doc", "fake.pdf", "<html>definitely not a pdf</html>", "INVALID_FILE_SIGNATURE"],
    ["/doc", "fake.png", Buffer.from("plain text pretending to be an image"), "INVALID_FILE_SIGNATURE"],
    ["/doc", "photo.png", PE, "EXECUTABLE_CONTENT"],
    ["/doc", "tool.exe", PE, "EXECUTABLE_CONTENT"], // document routes never accept programs
    ["/doc", "notes.txt", Buffer.concat([Buffer.from("text"), Buffer.from([0, 1, 2, 0])]), "BINARY_IN_TEXT_FILE"],
    ["/project", "disguised.txt", PE, "EXECUTABLE_CONTENT"],
  ];
  for (const [route, name, body, code] of cases) {
    const r = await send(route, name, body);
    assert.equal(r.status, 415, `${name} on ${route}`);
    const j = await r.json();
    assert.equal(j.error, code, name);
    assert.match(j.message, new RegExp(name.replace(".", "\\.")));
  }
  await settle(() => tempFiles().length === 0);
  assert.deepEqual(tempFiles(), [], "refused uploads leave no temp files");
});

test("things that must keep working still do: a project route accepts a real .exe, images, code and unknown types", async () => {
  const f = new FormData();
  f.append("files", new Blob([PE]), "tool.exe");
  f.append("files", new Blob([PNG]), "logo.png");
  f.append("files", new Blob(["export const a = 1;\n"]), "src/a.js");
  f.append("files", new Blob([Buffer.from([1, 2, 3, 4, 0, 255])]), "data.bin");
  const r = await fetch(url("/project"), { method: "POST", body: f });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.names.length, 4);
  await settle(() => tempFiles().length === 0);
  assert.deepEqual(tempFiles(), []);
});

test("an oversized file is stopped while it streams in (413) and nothing is left on disk", async () => {
  const r = await send("/tiny", "big.txt", "x".repeat(5000));
  assert.equal(r.status, 413);
  assert.equal((await r.json()).error, "FILE_TOO_LARGE");
  await settle(() => tempFiles().length === 0);
  assert.deepEqual(tempFiles(), [], "the partial file was removed");
});

test("an upload interrupted half-way (client disconnects) leaves no temp file and frees its slot", async () => {
  const boundary = "----cut";
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="half.pdf"\r\nContent-Type: application/pdf\r\n\r\n`;
  const sock = net.connect(port, "127.0.0.1");
  await new Promise<void>((r) => sock.on("connect", () => r()));
  sock.write(`POST /slow HTTP/1.1\r\nHost: x\r\nContent-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: 500000\r\n\r\n${head}`);
  sock.write(Buffer.concat([Buffer.from("%PDF-1.4\n"), crypto.randomBytes(30_000)]));
  await settle(() => tempFiles().length > 0, 2000);
  assert.ok(tempFiles().length > 0, "a partial temp file exists while the upload is in progress");
  assert.equal(_inFlightUploads(), 1, "and it holds a slot");
  sock.destroy(); // the client drops the connection
  await settle(() => tempFiles().length === 0 && _inFlightUploads() === 0, 4000);
  assert.deepEqual(tempFiles(), [], "the interrupted upload's temp file was removed");
  assert.equal(_inFlightUploads(), 0, "the slot was released");
});

test("a stalled upload (connected, then silent) is cut off by the idle timeout and cleaned up", async () => {
  const boundary = "----stall";
  const sock = net.connect(port, "127.0.0.1");
  await new Promise<void>((r) => sock.on("connect", () => r()));
  let closed = false;
  sock.on("close", () => { closed = true; });
  sock.on("error", () => {});
  sock.write(`POST /slow HTTP/1.1\r\nHost: x\r\nContent-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: 500000\r\n\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="stall.pdf"\r\n\r\n%PDF-1.4 start`);
  await settle(() => closed, 8000);
  assert.ok(closed, "the server closed the silent connection");
  await settle(() => tempFiles().length === 0 && _inFlightUploads() === 0, 3000);
  assert.deepEqual(tempFiles(), []);
  assert.equal(_inFlightUploads(), 0);
});

test("profiles keep their limits: only the folder profile takes many files and none ship executables to document routes", () => {
  assert.ok(UPLOAD_PROFILES.folder.files >= 50 && UPLOAD_PROFILES.single.files === 1);
  assert.equal(UPLOAD_PROFILES.documents.blockExecutables, true);
  assert.equal(UPLOAD_PROFILES.single.blockExecutables, true);
  assert.equal(UPLOAD_PROFILES.archive.checkContent, false, "a chunk is a slice of a file; the joined archive is checked instead");
});
