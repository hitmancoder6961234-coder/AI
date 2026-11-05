import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import express from "express";

const R = await import("../server/recovery.js");
const M = await import("../server/mailer.js");
const { registerRecoveryRoutes } = await import("../server/recovery-routes.js");
const Admin = await import("../scripts/admin.mjs");

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, name TEXT, password TEXT, created_at INTEGER)");
  db.exec("CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id TEXT, created_at INTEGER, expires_at INTEGER)");
  R.ensureRecoveryTables(db);
  return db;
}
const addUser = (db: DatabaseSync, id: string, email: string) => db.prepare("INSERT INTO users (id, email, name, password, created_at) VALUES (?, ?, ?, 'x', ?)").run(id, email, "Name " + id, Date.now());

// ---- tokens --------------------------------------------------------------------------------------------------------------------------------

test("reset tokens: 256-bit, only the hash is stored, valid once, expire, and a new one cancels the older", () => {
  const db = freshDb(); addUser(db, "u1", "a@example.com");
  const { token, expiresAt } = R.createResetToken(db, "u1", { now: 1000 });
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(expiresAt, 1000 + 30 * 60_000);
  const stored = JSON.stringify(db.prepare("SELECT * FROM password_resets").all());
  assert.ok(!stored.includes(token), "the token itself is never stored");
  assert.ok(stored.includes(R.hashToken(token)));
  assert.equal(R.consumeResetToken(db, token, 2000), "u1");
  assert.equal(R.consumeResetToken(db, token, 2001), null, "single use");
  const t2 = R.createResetToken(db, "u1", { now: 3000 }).token, t3 = R.createResetToken(db, "u1", { now: 3001 }).token;
  assert.equal(R.consumeResetToken(db, t2, 3002), null, "a newer token cancels the older one");
  assert.equal(R.consumeResetToken(db, t3, 3002), "u1");
  const t4 = R.createResetToken(db, "u1", { now: 10_000 }).token;
  assert.equal(R.consumeResetToken(db, t4, 10_000 + 30 * 60_000 + 1), null, "expired after 30 minutes");
  for (const bad of [undefined, null, 5, "", "short", "x".repeat(43), "x".repeat(44), "../".repeat(15), { toString: () => t4 }]) assert.equal(R.consumeResetToken(db, bad as any, 10_001), null, String(bad));
  assert.equal(R.consumeResetToken(db, "A".repeat(43), 10_001), null, "an unknown well-formed token");
});

test("a token cannot be used twice even by two attempts at once", () => {
  const db = freshDb(); addUser(db, "u1", "a@example.com");
  const { token } = R.createResetToken(db, "u1");
  const results = [R.consumeResetToken(db, token), R.consumeResetToken(db, token), R.consumeResetToken(db, token)];
  assert.deepEqual(results.filter(Boolean), ["u1"]);
});

test("recovery tables: additive migration of users.disabled_at, purge of old tokens, and the limiter", () => {
  const db = freshDb();
  assert.ok((db.prepare("PRAGMA table_info(users)").all() as any[]).some((c) => c.name === "disabled_at"));
  R.ensureRecoveryTables(db); // idempotent
  addUser(db, "u1", "a@example.com");
  assert.equal(R.isDisabled(db, "u1"), false);
  db.prepare("UPDATE users SET disabled_at = 5 WHERE id = 'u1'").run();
  assert.equal(R.isDisabled(db, "u1"), true);
  R.createResetToken(db, "u1", { now: 1 });
  assert.equal(R.purgeResets(db, 1 + 3 * 86_400_000) >= 1, true, "expired tokens are purged");
  let t = 0; const w = new R.Window(2, 1000, () => t);
  assert.deepEqual([w.hit("k"), w.hit("k"), w.hit("k") > 0, w.hit("other")], [0, 0, true, 0]);
  t = 1500; assert.equal(w.hit("k"), 0, "the window slides");
});

// ---- mail configuration and the HTTP provider ---------------------------------------------------------------------------------------------

test("mail configuration: nothing configured means no mailer; every problem is named without echoing a value", () => {
  assert.equal(M.mailerFromEnv({}), null);
  assert.deepEqual(M.checkMailConfig({}), { configured: false, problems: [] });
  assert.match(M.checkMailConfig({ MAIL_PROVIDER: "carrier-pigeon" }).problems[0], /smtp or resend/);
  const resendMissing = M.checkMailConfig({ MAIL_PROVIDER: "resend" }).problems.join("|");
  assert.match(resendMissing, /MAIL_FROM/); assert.match(resendMissing, /PUBLIC_APP_URL/); assert.match(resendMissing, /RESEND_API_KEY/);
  assert.equal(M.mailerFromEnv({ MAIL_PROVIDER: "resend", MAIL_FROM: "x@example.com" }), null, "incomplete config is not a mailer");
  const ok = { MAIL_PROVIDER: "resend", MAIL_FROM: "Darkness <no-reply@example.com>", PUBLIC_APP_URL: "https://app.example.com", RESEND_API_KEY: "re_secret_value_123456" };
  assert.equal(M.checkMailConfig(ok).configured, true);
  assert.ok(!JSON.stringify(M.checkMailConfig({ ...ok, MAIL_FROM: "bad" })).includes("re_secret"));
  assert.match(M.checkMailConfig({ ...ok, PUBLIC_APP_URL: "http://app.example.com", NODE_ENV: "production" }).problems.join(), /https in production/);
  assert.equal(M.checkMailConfig({ ...ok, PUBLIC_APP_URL: "http://localhost:3000" }, false).configured, true, "http is fine outside production");
  const smtp = { MAIL_PROVIDER: "smtp", MAIL_FROM: "no-reply@example.com", PUBLIC_APP_URL: "https://app.example.com", SMTP_HOST: "mail.example.com" };
  assert.equal(M.checkMailConfig(smtp).configured, true);
  assert.match(M.checkMailConfig({ ...smtp, SMTP_USER: "u" }).problems.join(), /together/);
  assert.match(M.checkMailConfig({ ...smtp, SMTP_TLS: "none", NODE_ENV: "production" }).problems.join(), /localhost/);
  assert.equal(M.checkMailConfig({ ...smtp, SMTP_TLS: "none", SMTP_HOST: "localhost", NODE_ENV: "production" }).configured, true);
  assert.match(M.checkMailConfig({ ...smtp, SMTP_TLS: "maybe" }).problems.join(), /SMTP_TLS/);
  assert.match(M.checkMailConfig({ ...smtp, SMTP_PORT: "99999" }).problems.join(), /SMTP_PORT/);
});

test("addresses and headers: line breaks and malformed addresses are refused before anything is sent", async () => {
  for (const bad of ["a@b", "a b@example.com", "a@example.com\r\nBcc: evil@example.com", "a@example.com,b@example.com", "<a@example.com>", "a@@example.com", "", "x".repeat(300) + "@example.com"]) assert.throws(() => M.validateAddress(bad), M.MailError, JSON.stringify(bad.slice(0, 30)));
  assert.equal(M.validateAddress("  Person.Name+tag@sub.example.co.uk "), "Person.Name+tag@sub.example.co.uk");
  const sent: any[] = [];
  const mailer = M.mailerFromEnv({ MAIL_PROVIDER: "resend", MAIL_FROM: "Darkness <no-reply@example.com>", PUBLIC_APP_URL: "https://app.example.com", RESEND_API_KEY: "re_secret_value_123456" }, { fetchImpl: (async (u: any, init: any) => { sent.push({ u, init }); return new Response("{}", { status: 200 }); }) as any })!;
  await assert.rejects(() => mailer.send({ to: "a@example.com", subject: "Hi\r\nBcc: evil@example.com", text: "x" }), /line breaks/);
  await assert.rejects(() => mailer.send({ to: "a@example.com\r\nBcc: x@example.com", subject: "Hi", text: "x" }), M.MailError);
  assert.equal(sent.length, 0, "nothing reached the provider");
});

test("resend provider: correct request, the key only in the Authorization header, and failures never echo it", async () => {
  const calls: any[] = [];
  const env = { MAIL_PROVIDER: "resend", MAIL_FROM: "Darkness <no-reply@example.com>", PUBLIC_APP_URL: "https://app.example.com", RESEND_API_KEY: "re_secret_value_123456" };
  const ok = M.mailerFromEnv(env, { fetchImpl: (async (u: any, init: any) => { calls.push({ u, init }); return new Response('{"id":"1"}', { status: 200 }); }) as any })!;
  await ok.send({ to: "user@example.com", subject: "Subject", text: "Body" });
  assert.equal(calls[0].u, "https://api.resend.com/emails");
  assert.equal(calls[0].init.headers.Authorization, "Bearer re_secret_value_123456");
  assert.deepEqual(JSON.parse(calls[0].init.body), { from: "Darkness <no-reply@example.com>", to: ["user@example.com"], subject: "Subject", text: "Body" });
  assert.ok(!calls[0].init.body.includes("re_secret"));
  const refuse = M.mailerFromEnv(env, { fetchImpl: (async () => new Response("bad key re_secret_value_123456", { status: 403 })) as any })!;
  await assert.rejects(() => refuse.send({ to: "user@example.com", subject: "S", text: "B" }), (e: any) => e instanceof M.MailError && e.transient === false && !e.message.includes("re_secret"));
  const down = M.mailerFromEnv(env, { fetchImpl: (async () => { throw new Error("connect ECONNREFUSED with re_secret_value_123456"); }) as any })!;
  await assert.rejects(() => down.send({ to: "user@example.com", subject: "S", text: "B" }), (e: any) => e.transient === true && !e.message.includes("re_secret"));
  const busy = M.mailerFromEnv(env, { fetchImpl: (async () => new Response("", { status: 503 })) as any })!;
  await assert.rejects(() => busy.send({ to: "user@example.com", subject: "S", text: "B" }), (e: any) => e.transient === true);
});

// ---- a real SMTP conversation against a local fake server ------------------------------------------------------------------------------------

interface Captured { from: string; to: string[]; data: string; user?: string }
function startSmtp(opts: { startTls?: boolean; implicitTls?: boolean; authOk?: boolean; rejectRcpt?: boolean; cert?: { key: string; cert: string } } = {}) {
  const messages: Captured[] = []; const log: string[] = [];
  const handle = (sock: net.Socket) => {
    let buf = "", data = false, cur: Captured = { from: "", to: [], data: "" }, current: net.Socket = sock;
    const send = (s: string) => current.write(s + "\r\n");
    const onData = (d: Buffer) => {
      buf += d.toString("utf8");
      for (;;) {
        if (data) { const end = buf.indexOf("\r\n.\r\n"); if (end < 0) return; cur.data = buf.slice(0, end); buf = buf.slice(end + 5); data = false; messages.push(cur); cur = { from: "", to: [], data: "" }; send("250 queued"); continue; }
        const i = buf.indexOf("\r\n"); if (i < 0) return;
        const line = buf.slice(0, i); buf = buf.slice(i + 2); log.push(line.replace(/AUTH PLAIN \S+/, "AUTH PLAIN <redacted>"));
        const up = line.toUpperCase();
        if (up.startsWith("EHLO")) send("250-fake\r\n250-AUTH PLAIN" + (opts.startTls && !(current instanceof tls.TLSSocket) ? "\r\n250-STARTTLS" : "") + "\r\n250 8BITMIME");
        else if (up === "STARTTLS") { send("220 ready"); sock.removeListener("data", onData); const t = new tls.TLSSocket(sock, { isServer: true, key: opts.cert!.key, cert: opts.cert!.cert }); current = t; t.on("data", onData); t.on("error", () => {}); buf = ""; return; }
        else if (up.startsWith("AUTH PLAIN")) { const [, user] = Buffer.from(line.split(" ")[2], "base64").toString().split("\0"); cur.user = user; send(opts.authOk === false ? "535 bad credentials" : "235 ok"); }
        else if (up.startsWith("MAIL FROM:")) { cur.from = /<([^>]*)>/.exec(line)![1]; send("250 ok"); }
        else if (up.startsWith("RCPT TO:")) { if (opts.rejectRcpt) send("550 no such user"); else { cur.to.push(/<([^>]*)>/.exec(line)![1]); send("250 ok"); } }
        else if (up === "DATA") { data = true; send("354 go"); }
        else if (up === "QUIT") { send("221 bye"); current.end(); return; }
        else send("502 unknown");
      }
    };
    sock.on("data", onData); sock.on("error", () => {});
    send("220 fake ESMTP");
  };
  const server = opts.implicitTls ? tls.createServer({ key: opts.cert!.key, cert: opts.cert!.cert }, handle) : net.createServer(handle);
  return new Promise<{ port: number; messages: Captured[]; log: string[]; close: () => void }>((res) => server.listen(0, "127.0.0.1", () => res({ port: (server.address() as any).port, messages, log, close: () => server.close() })));
}
function makeCert(): { key: string; cert: string } | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "darkness-cert-"));
  const gitSsl = "C:\\Program Files\\Git\\usr\\bin\\openssl.exe";
  const r = spawnSync(fs.existsSync(gitSsl) ? gitSsl : "openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem"), "-days", "2", "-subj", "/CN=localhost"], { stdio: "ignore", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  if (r.status !== 0) return null;
  return { key: fs.readFileSync(path.join(dir, "k.pem"), "utf8"), cert: fs.readFileSync(path.join(dir, "c.pem"), "utf8") };
}
const base = (port: number, over: Record<string, unknown> = {}) => ({ host: "127.0.0.1", port, mode: "none" as const, from: "Darkness <no-reply@example.com>", timeoutMs: 4000, ...over });

test("smtp: the full conversation (login, envelope, DATA with dot-stuffing), headers are clean, and a non-ASCII subject is encoded", async () => {
  const srv = await startSmtp();
  try {
    await M._smtpSend(base(srv.port, { user: "mailer", pass: "s3cret" }), { to: "user@example.com", subject: "Réset • password", text: "Line one\n.A line that starts with a dot\nlast" });
    const m = srv.messages[0];
    assert.equal(m.from, "no-reply@example.com"); assert.deepEqual(m.to, ["user@example.com"]); assert.equal(m.user, "mailer");
    assert.match(m.data, /^From: Darkness <no-reply@example\.com>\r\nTo: user@example\.com\r\nSubject: =\?UTF-8\?B\?/);
    assert.ok([...m.data.split("\r\n\r\n")[0]].every((ch) => ch.charCodeAt(0) < 128), "headers are ASCII on the wire");
    assert.match(m.data, /\r\n\r\nLine one\r\n\.\.A line that starts with a dot\r\nlast/, "a line starting with '.' is dot-stuffed");
    assert.ok(!srv.log.join("\n").includes("s3cret"), "the password is not sent in the clear in the conversation log (AUTH PLAIN is base64 and redacted here)");
    // an injected recipient or header never reaches the wire
    await assert.rejects(() => M._smtpSend(base(srv.port), { to: "a@example.com>\r\nRCPT TO:<evil@example.com", subject: "x", text: "y" }), M.MailError);
    await assert.rejects(() => M._smtpSend(base(srv.port), { to: "a@example.com", subject: "x\r\nBcc: evil@example.com", text: "y" }), /line breaks/);
    assert.equal(srv.messages.length, 1);
  } finally { srv.close(); }
});

test("smtp: refusals and failures are reported as MailError (permanent vs transient) without hanging", async () => {
  const bad = await startSmtp({ authOk: false });
  await assert.rejects(() => M._smtpSend(base(bad.port, { user: "u", pass: "wrong" }), { to: "a@example.com", subject: "s", text: "t" }), (e: any) => e instanceof M.MailError && /login/.test(e.message) && e.transient === false);
  bad.close();
  const rcpt = await startSmtp({ rejectRcpt: true });
  await assert.rejects(() => M._smtpSend(base(rcpt.port), { to: "a@example.com", subject: "s", text: "t" }), (e: any) => /recipient/.test(e.message));
  rcpt.close();
  // nothing listens: transient
  const closed = await startSmtp(); const port = closed.port; closed.close(); await new Promise((r) => setTimeout(r, 50));
  await assert.rejects(() => M._smtpSend(base(port), { to: "a@example.com", subject: "s", text: "t" }), (e: any) => e instanceof M.MailError && e.transient === true);
  // a server that accepts the connection and says nothing
  const mute = net.createServer(() => {}); await new Promise<void>((r) => mute.listen(0, "127.0.0.1", r));
  const t0 = Date.now();
  await assert.rejects(() => M._smtpSend(base((mute.address() as any).port, { timeoutMs: 400 }), { to: "a@example.com", subject: "s", text: "t" }), /did not answer in time/);
  assert.ok(Date.now() - t0 < 3000); mute.close();
  // STARTTLS required but not offered: refuse rather than send credentials in clear text
  const plain = await startSmtp({ startTls: false });
  await assert.rejects(() => M._smtpSend(base(plain.port, { mode: "starttls", user: "u", pass: "p" }), { to: "a@example.com", subject: "s", text: "t" }), /does not offer STARTTLS/);
  assert.ok(!plain.log.some((l) => /AUTH/.test(l)), "no credentials were sent");
  plain.close();
});

const cert = makeCert();
test("smtp over TLS: STARTTLS upgrade and implicit TLS both deliver, with a login (self-signed test certificate generated at run time)", { skip: cert ? false : "openssl is not available to create a test certificate" }, async () => {
  const st = await startSmtp({ startTls: true, cert: cert! });
  try {
    await M._smtpSend(base(st.port, { mode: "starttls", user: "mailer", pass: "pw", rejectUnauthorized: false }), { to: "user@example.com", subject: "STARTTLS", text: "hello" });
    assert.equal(st.messages[0].user, "mailer"); assert.match(st.messages[0].data, /Subject: STARTTLS/);
    assert.ok(st.log.indexOf("STARTTLS") < st.log.findIndex((l) => /AUTH PLAIN/.test(l)), "login only after the TLS upgrade");
    // a certificate that is not trusted is refused by default
    await assert.rejects(() => M._smtpSend(base(st.port, { mode: "starttls" }), { to: "user@example.com", subject: "x", text: "y" }), M.MailError);
  } finally { st.close(); }
  const im = await startSmtp({ implicitTls: true, cert: cert! });
  try {
    await M._smtpSend(base(im.port, { mode: "implicit", user: "mailer", pass: "pw", rejectUnauthorized: false }), { to: "user@example.com", subject: "Implicit", text: "hello" });
    assert.match(im.messages[0].data, /Subject: Implicit/);
  } finally { im.close(); }
});

// ---- the HTTP routes -------------------------------------------------------------------------------------------------------------------------

async function withApp(opts: { mailer?: any; minLength?: number; strict?: boolean; now?: () => number }, fn: (ctx: any) => Promise<void>) {
  const db = freshDb(); addUser(db, "u1", "alice@example.com"); addUser(db, "u2", "bob@example.com");
  db.prepare("INSERT INTO sessions VALUES ('t1','u1',1,9999999999999), ('t2','u1',1,9999999999999), ('t3','u2',1,9999999999999)").run();
  const mails: any[] = [], events: string[] = [], passwords = new Map<string, string>(), cleared: string[] = [];
  const mailer = opts.mailer === undefined ? { provider: "resend", from: "x", send: async (m: any) => { mails.push(m); } } : opts.mailer;
  const app = express(); app.use(express.json());
  registerRecoveryRoutes(app, {
    db, getMailer: () => mailer, appUrl: () => "https://app.example.com/",
    findUserByEmail: (e) => { const r = db.prepare("SELECT id, email, name FROM users WHERE lower(email) = ?").get(e) as any; return r || null; },
    findUserById: (id) => (db.prepare("SELECT id, email, name FROM users WHERE id = ?").get(id) as any) || null,
    setPassword: (id, pw) => { passwords.set(id, pw); },
    revokeSessions: (id) => Number((db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id) as any).changes),
    clearLockout: (e) => { cleared.push(e); }, minLength: opts.minLength ?? 8, isCommonPassword: (p) => p === "password123", strict: opts.strict ?? true,
    log: (e) => events.push(e), now: opts.now,
  });
  const srv = http.createServer(app); await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(srv.address() as any).port}`;
  const post = (p: string, body: any) => fetch(url + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const settle = () => new Promise((r) => setTimeout(r, 60));
  try { await fn({ db, mails, events, passwords, cleared, post, settle, url }); } finally { srv.closeAllConnections?.(); srv.close(); }
}
const tokenIn = (mail: any) => /#token=([A-Za-z0-9_-]{43})/.exec(mail.text)![1];

test("forgot: the answer is identical for known and unknown addresses; mail goes only to the real account, with a one-time link", async () => {
  await withApp({}, async ({ mails, post, settle, db }) => {
    const known = await post("/api/auth/forgot", { email: "Alice@Example.com" });
    const unknown = await post("/api/auth/forgot", { email: "nobody@example.com" });
    assert.equal(known.status, 202); assert.equal(unknown.status, 202);
    assert.equal(await known.text(), await unknown.text(), "byte-identical answers: no way to tell which addresses have accounts");
    await settle();
    assert.equal(mails.length, 1, "only the real account got a mail");
    assert.equal(mails[0].to, "alice@example.com");
    assert.match(mails[0].text, /https:\/\/app\.example\.com\/reset\.html#token=/, "the token is in the URL fragment (never sent to a server or a Referer)");
    assert.ok(!/[?&]token=/.test(mails[0].text));
    assert.match(mails[0].text, /30 minutes/);
    assert.equal(R.consumeResetToken(db, tokenIn(mails[0])), "u1");
    assert.equal((await post("/api/auth/forgot", { email: "not-an-email" })).status, 400);
    assert.equal((await post("/api/auth/forgot", {})).status, 400);
    assert.equal((await post("/api/auth/forgot", { email: ["a@example.com"] })).status, 400);
  });
});

test("forgot: without a mail provider the server says so (501) instead of pretending", async () => {
  await withApp({ mailer: null }, async ({ post, url }) => {
    const r = await post("/api/auth/forgot", { email: "alice@example.com" });
    assert.equal(r.status, 501);
    assert.equal((await r.json()).code, "RECOVERY_NOT_CONFIGURED");
    assert.deepEqual(await (await fetch(url + "/api/auth/recovery")).json(), { available: false, method: "operator", linkMinutes: 30 });
  });
  await withApp({}, async ({ url }) => { assert.equal((await (await fetch(url + "/api/auth/recovery")).json()).available, true); });
});

test("forgot: limits per address and per IP, with Retry-After; a disabled account gets no mail; a mail failure is logged without the address", async () => {
  let t = 1_000_000;
  await withApp({ now: () => t }, async ({ post, mails, settle, db, events }) => {
    for (let i = 0; i < 3; i++) assert.equal((await post("/api/auth/forgot", { email: "alice@example.com" })).status, 202);
    const over = await post("/api/auth/forgot", { email: "alice@example.com" });
    assert.equal(over.status, 429); assert.ok(Number(over.headers.get("retry-after")) >= 1);
    t += 3_600_001;
    assert.equal((await post("/api/auth/forgot", { email: "alice@example.com" })).status, 202, "the window passes");
    await settle();
    const before = mails.length;
    db.prepare("UPDATE users SET disabled_at = 1 WHERE id = 'u2'").run();
    assert.equal((await post("/api/auth/forgot", { email: "bob@example.com" })).status, 202, "same answer for a disabled account");
    await settle(); assert.equal(mails.length, before, "but no mail");
    assert.ok(events.includes("reset_mail_sent"));
  });
  await withApp({ mailer: { provider: "smtp", from: "x", send: async () => { throw new M.MailError("mail server refused the recipient (550)"); } } }, async ({ post, settle, events }) => {
    assert.equal((await post("/api/auth/forgot", { email: "alice@example.com" })).status, 202, "the user is not told about delivery trouble");
    await settle(); assert.ok(events.includes("reset_mail_failed"));
  });
  await withApp({}, async ({ post }) => {
    let last = 0; for (let i = 0; i < 25; i++) last = (await post("/api/auth/forgot", { email: `user${i}@example.com` })).status;
    assert.equal(last, 429, "one IP cannot spray addresses");
  });
});

test("reset: new password stored, EVERY session of the account ended, lockout cleared, token spent, owner notified", async () => {
  await withApp({}, async ({ post, mails, settle, db, passwords, cleared }) => {
    await post("/api/auth/forgot", { email: "alice@example.com" }); await settle();
    const token = tokenIn(mails[0]);
    const r = await post("/api/auth/reset", { token, password: "a-brand-new-passphrase" });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, revokedSessions: 2 });
    assert.equal(passwords.get("u1"), "a-brand-new-passphrase");
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = 'u1'").get() as any).n, 0, "all of Alice's sessions are gone");
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = 'u2'").get() as any).n, 1, "Bob's are not touched");
    assert.deepEqual(cleared, ["alice@example.com"]);
    await settle();
    assert.ok(mails.some((m: any) => /password was changed/.test(m.subject)), "a notice goes to the account's address");
    const again = await post("/api/auth/reset", { token, password: "another-new-passphrase" });
    assert.equal(again.status, 400); assert.equal((await again.json()).code, "INVALID_TOKEN");
    assert.equal(passwords.get("u1"), "a-brand-new-passphrase", "the second attempt changed nothing");
  });
});

test("reset: weak or malformed input is refused WITHOUT spending the token; bad tokens all look alike; disabled accounts cannot reset", async () => {
  await withApp({}, async ({ post, mails, settle, db, passwords }) => {
    await post("/api/auth/forgot", { email: "alice@example.com" }); await settle();
    const token = tokenIn(mails[0]);
    for (const [pw, code] of [["short", "WEAK_PASSWORD"], ["password123", "WEAK_PASSWORD"], ["", "VALIDATION_ERROR"], ["x".repeat(1025), "VALIDATION_ERROR"], [42, "VALIDATION_ERROR"]] as any[]) {
      const r = await post("/api/auth/reset", { token, password: pw });
      assert.equal(r.status, 400); assert.equal((await r.json()).code, code, JSON.stringify(pw).slice(0, 20));
    }
    assert.equal(passwords.size, 0);
    assert.equal((await post("/api/auth/reset", { token, password: "a-good-long-passphrase" })).status, 200, "the token survived the typos");
    for (const bad of [undefined, "", "short", "A".repeat(43), { $ne: 1 }, ["x"]]) { const r = await post("/api/auth/reset", { token: bad, password: "a-good-long-passphrase" }); assert.deepEqual([r.status, (await r.json()).code], [400, "INVALID_TOKEN"]); }
    // a disabled account's token is dead
    const t2 = R.createResetToken(db, "u2").token;
    db.prepare("UPDATE users SET disabled_at = 1 WHERE id = 'u2'").run();
    const r = await post("/api/auth/reset", { token: t2, password: "a-good-long-passphrase" });
    assert.deepEqual([r.status, (await r.json()).code], [400, "INVALID_TOKEN"]);
    assert.ok(!passwords.has("u2"));
  });
});

test("reset: attempts per IP are limited, and answers are never cached", async () => {
  await withApp({}, async ({ post, url }) => {
    let last = 0; for (let i = 0; i < 31; i++) last = (await post("/api/auth/reset", { token: "A".repeat(43), password: "a-good-long-passphrase" })).status;
    assert.equal(last, 429);
    assert.equal((await fetch(url + "/api/auth/recovery")).headers.get("cache-control"), "no-store");
  });
});

// ---- operator tool -----------------------------------------------------------------------------------------------------------------------------

test("operator tool: a one-time link that the server accepts once, disable/enable, session revocation, and a masked listing", () => {
  const db = freshDb(); addUser(db, "u1", "alice@example.com"); addUser(db, "u2", "bob@example.com");
  db.prepare("INSERT INTO sessions VALUES ('t1','u1',1,?), ('t2','u1',1,?), ('t3','u2',1,?)").run(Date.now() + 1e6, Date.now() + 1e6, Date.now() + 1e6);
  const link = Admin.makeResetLink(db, "ALICE@example.com", "https://app.example.com/");
  assert.match(link.url, /^https:\/\/app\.example\.com\/reset\.html#token=[A-Za-z0-9_-]{43}$/);
  const token = link.url.split("token=")[1];
  assert.equal((db.prepare("SELECT via FROM password_resets").get() as any).via, "operator");
  assert.ok(!JSON.stringify(db.prepare("SELECT * FROM password_resets").all()).includes(token), "the link's token is not stored");
  assert.equal(R.consumeResetToken(db, token), "u1", "the server's recovery code accepts an operator link (same format and storage)");
  assert.equal(R.consumeResetToken(db, token), null);
  assert.throws(() => Admin.makeResetLink(db, "nobody@example.com"), /no account/);
  const listing = Admin.listUsers(db);
  assert.equal(listing.total, 2); assert.ok(listing.users.every((u: any) => /^.\*\*\*@example\.com$/.test(u.email)), "e-mails are masked"); assert.ok(!JSON.stringify(listing).includes("password"));
  assert.equal(Admin.revokeSessions(db, "alice@example.com"), 2);
  assert.deepEqual(Admin.setDisabled(db, "bob@example.com", true), { sessionsEnded: 1 });
  assert.equal(R.isDisabled(db, "u2"), true);
  assert.throws(() => Admin.makeResetLink(db, "bob@example.com"), /disabled/);
  Admin.setDisabled(db, "bob@example.com", false);
  assert.equal(R.isDisabled(db, "u2"), false);
  assert.equal(Admin.mask("alice@example.com"), "a***@example.com");
});
