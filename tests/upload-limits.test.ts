import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test, { after, before } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { MAX_CONCURRENT_UPLOADS_PER_USER, UPLOAD_PROFILES, uploaders, wrapUploadMiddleware } from "../server/upload-config.js";

let server: http.Server;
let port = 0;

before(async () => {
  const app = express();
  app.post("/single", wrapUploadMiddleware(uploaders.single.single("file"), "single"), (req, res) => res.json({ ok: true, size: req.file?.size ?? 0 }));
  app.post("/folder", wrapUploadMiddleware(uploaders.folder.array("files"), "folder"), (req, res) => res.json({ ok: true, count: (req.files as unknown[] | undefined)?.length ?? 0 }));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
after(() => { server.close(); server.closeAllConnections?.(); });

const url = (p: string) => `http://127.0.0.1:${port}${p}`;
const form = (build: (f: FormData) => void) => { const f = new FormData(); build(f); return f; };

test("a normal single upload still works", async () => {
  const r = await fetch(url("/single"), { method: "POST", body: form((f) => f.append("file", new Blob(["hello"]), "a.txt")) });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, size: 5 });
});

test("the folder profile accepts a 50-file batch (what the web app sends)", async () => {
  const r = await fetch(url("/folder"), { method: "POST", body: form((f) => { for (let i = 0; i < 50; i++) f.append("files", new Blob(["x"]), `f${i}.txt`); }) });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).count, 50);
});

test("more files than the profile allows is refused with a clear 400", async () => {
  const r = await fetch(url("/single"), { method: "POST", body: form((f) => { f.append("file", new Blob(["1"]), "1.txt"); f.append("file", new Blob(["2"]), "2.txt"); }) });
  assert.equal(r.status, 400);
  assert.match((await r.json()).message, /more files or fields/);
  const many = await fetch(url("/folder"), { method: "POST", body: form((f) => { for (let i = 0; i <= UPLOAD_PROFILES.folder.files; i++) f.append("files", new Blob(["x"]), `f${i}.txt`); }) });
  assert.equal(many.status, 400, "101 files is over the folder profile");
});

test("a huge text field is refused (fields are never legitimately megabytes)", async () => {
  const r = await fetch(url("/single"), { method: "POST", body: form((f) => { f.append("note", "x".repeat(UPLOAD_PROFILES.single.fieldSize + 10)); f.append("file", new Blob(["1"]), "1.txt"); }) });
  assert.equal(r.status, 400);
});

test("a request that declares more bytes than the profile's aggregate cap is refused before its body is read", async () => {
  const status = await new Promise<number>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/single", method: "POST", headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(UPLOAD_PROFILES.single.maxRequestBytes + 1) } }, (res) => { res.resume(); resolve(res.statusCode || 0); });
    req.on("error", reject);
    req.write("--x\r\n"); // only a few bytes actually sent: the declared length alone must be enough to refuse it
  });
  assert.equal(status, 413);
});

test("one caller may only run a few uploads at once, and a finished or dropped upload frees its slot", async () => {
  const held: net.Socket[] = [];
  const open = () => new Promise<net.Socket>((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => {
      // an upload that starts and then stalls: the server keeps waiting for the rest of the declared body
      s.write(`POST /single HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer same-user\r\nContent-Type: multipart/form-data; boundary=x\r\nContent-Length: 5000\r\n\r\n--x\r\n`);
      setTimeout(() => resolve(s), 60);
    });
    held.push(s);
  });
  for (let i = 0; i < MAX_CONCURRENT_UPLOADS_PER_USER; i++) await open();

  const send = () => fetch(url("/single"), { method: "POST", headers: { authorization: "Bearer same-user" }, body: form((f) => f.append("file", new Blob(["ok"]), "ok.txt")) });
  const blocked = await send();
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error, "TOO_MANY_UPLOADS");
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);

  const other = await fetch(url("/single"), { method: "POST", headers: { authorization: "Bearer someone-else" }, body: form((f) => f.append("file", new Blob(["ok"]), "ok.txt")) });
  assert.equal(other.status, 200, "another caller is not affected");

  held.forEach((s) => s.destroy()); // clients give up: the slots must come back
  await new Promise((r) => setTimeout(r, 250));
  assert.equal((await send()).status, 200, "slots are released when uploads end");
});
