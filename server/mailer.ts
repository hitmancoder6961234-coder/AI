import net from "node:net";
import tls from "node:tls";
import { scrubSecrets } from "./provider-http.js";

/**
 * Outgoing e-mail for account recovery. Configured ONLY through environment variables (secrets never live in the repository):
 *
 *   MAIL_PROVIDER=smtp | resend          (unset = e-mail is not configured: the app says so, it never pretends to send)
 *   MAIL_FROM=Darkness AI <no-reply@your-domain>
 *   PUBLIC_APP_URL=https://your-app.example         where the links in the e-mail point (https required in production)
 *   smtp:    SMTP_HOST, SMTP_PORT (587), SMTP_TLS=starttls | implicit | none (default starttls; none only for localhost or outside production),
 *            SMTP_USER, SMTP_PASS (optional pair)
 *   resend:  RESEND_API_KEY
 *
 * The SMTP client is a small, dependency-free implementation of the commands a transactional message needs (EHLO, STARTTLS, AUTH PLAIN, MAIL FROM,
 * RCPT TO, DATA with dot-stuffing). Header fields are checked for line breaks, so a crafted address or subject cannot inject headers or recipients.
 * Nothing here has been verified against a real provider in this repository's test environment: see docs/OPERATIONS-VERIFICATION.md.
 */

export interface MailMessage { to: string; subject: string; text: string }
export interface Mailer { provider: "smtp" | "resend"; from: string; send(msg: MailMessage): Promise<void> }

export class MailError extends Error { constructor(message: string, public transient = false) { super(message); } }

const EMAIL_RE = /^[^\s@<>"',;:\\()[\]]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?\.[A-Za-z]{2,}$/;
const bareAddress = (from: string) => { const m = /<([^>]+)>\s*$/.exec(from); return (m ? m[1] : from).trim(); };
const noBreaks = (s: string, what: string) => { if (/[\r\n\0]/.test(s)) throw new MailError(`${what} must not contain line breaks`); return s; };

export function validateAddress(a: string): string {
  const s = noBreaks(String(a).trim(), "address");
  if (!EMAIL_RE.test(s) || s.length > 254) throw new MailError("invalid e-mail address");
  return s;
}

export interface MailConfigReport { configured: boolean; provider?: string; problems: string[] }

/** What is wrong with the mail settings (names only, never values). `configured` means a message could be attempted. */
export function checkMailConfig(env: Record<string, string | undefined>, production = env.NODE_ENV === "production"): MailConfigReport {
  const p = (env.MAIL_PROVIDER || "").trim().toLowerCase();
  const problems: string[] = [];
  if (!p) return { configured: false, problems };
  if (p !== "smtp" && p !== "resend") return { configured: false, provider: p, problems: ["MAIL_PROVIDER must be smtp or resend"] };
  if (!(env.MAIL_FROM || "").trim()) problems.push("MAIL_FROM is required");
  else { try { validateAddress(bareAddress(env.MAIL_FROM!)); } catch { problems.push("MAIL_FROM is not a valid sender address"); } }
  const url = (env.PUBLIC_APP_URL || "").trim();
  if (!url) problems.push("PUBLIC_APP_URL is required (the reset link points there)");
  else if (!/^https?:\/\/[^\s/]+/.test(url)) problems.push("PUBLIC_APP_URL must be an http(s) URL");
  else if (production && !/^https:\/\//.test(url)) problems.push("PUBLIC_APP_URL must be https in production");
  if (p === "resend" && !(env.RESEND_API_KEY || "").trim()) problems.push("RESEND_API_KEY is required");
  if (p === "smtp") {
    if (!(env.SMTP_HOST || "").trim()) problems.push("SMTP_HOST is required");
    const mode = (env.SMTP_TLS || "starttls").toLowerCase();
    if (!["starttls", "implicit", "none"].includes(mode)) problems.push("SMTP_TLS must be starttls, implicit or none");
    if (mode === "none" && production && !/^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test((env.SMTP_HOST || "").trim())) problems.push("SMTP_TLS=none is only allowed for localhost in production (credentials would cross the network unencrypted)");
    if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASS)) problems.push("SMTP_USER and SMTP_PASS must be set together");
    const port = Number(env.SMTP_PORT || 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push("SMTP_PORT is not a valid port");
  }
  return { configured: problems.length === 0, provider: p, problems };
}

/** A mailer built from the environment, or null when e-mail is not (correctly) configured. */
export function mailerFromEnv(env: Record<string, string | undefined> = process.env, opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Mailer | null {
  const report = checkMailConfig(env);
  if (!report.configured) return null;
  const from = noBreaks(env.MAIL_FROM!.trim(), "MAIL_FROM");
  const timeoutMs = opts.timeoutMs ?? 15_000;
  if (report.provider === "resend") {
    const key = env.RESEND_API_KEY!.trim();
    const doFetch = opts.fetchImpl ?? fetch;
    return {
      provider: "resend", from,
      async send(msg) {
        const to = validateAddress(msg.to);
        const subject = noBreaks(msg.subject, "subject");
        let res: Response;
        try {
          res = await doFetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, text: msg.text }), signal: AbortSignal.timeout(timeoutMs) });
        } catch (e: any) { throw new MailError("mail provider unreachable: " + scrubSecrets(String(e?.cause?.code || e?.message || e), { headers: { Authorization: `Bearer ${key}` } }).slice(0, 120), true); }
        if (!res.ok) throw new MailError(`mail provider refused the message (HTTP ${res.status})`, res.status >= 500 || res.status === 429);
      },
    };
  }
  const host = env.SMTP_HOST!.trim(), port = Number(env.SMTP_PORT || 587), mode = (env.SMTP_TLS || "starttls").toLowerCase() as "starttls" | "implicit" | "none";
  const user = env.SMTP_USER, pass = env.SMTP_PASS;
  return { provider: "smtp", from, send: (msg) => smtpSend({ host, port, mode, user, pass, from, timeoutMs }, msg) };
}

// ---- minimal SMTP client ----------------------------------------------------------------------------------------------------------------------

interface SmtpOptions { host: string; port: number; mode: "starttls" | "implicit" | "none"; user?: string; pass?: string; from: string; timeoutMs: number; rejectUnauthorized?: boolean }

class Conn {
  private buf = ""; private waiters: Array<(l: string) => void> = []; private lines: string[] = []; private err: Error | null = null;
  constructor(public sock: net.Socket) { this.attach(sock); }
  attach(s: net.Socket) {
    this.sock = s; s.setEncoding("utf8");
    s.on("data", (d: string) => { this.buf += d; let i; while ((i = this.buf.indexOf("\r\n")) >= 0) { const l = this.buf.slice(0, i); this.buf = this.buf.slice(i + 2); const w = this.waiters.shift(); if (w) w(l); else this.lines.push(l); } });
    s.on("error", (e) => { this.err = e; this.waiters.splice(0).forEach((w) => w("")); });
    s.on("close", () => { if (!this.err) this.err = new Error("connection closed"); this.waiters.splice(0).forEach((w) => w("")); });
  }
  line(): Promise<string> {
    if (this.lines.length) return Promise.resolve(this.lines.shift()!);
    if (this.err) return Promise.reject(this.err);
    return new Promise((res, rej) => this.waiters.push((l) => (this.err && !l ? rej(this.err) : res(l))));
  }
  /** One (possibly multi-line) reply: its numeric code and lines. */
  async reply(): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    for (;;) { const l = await this.line(); lines.push(l); if (/^\d{3} /.test(l) || l.length < 4) return { code: Number(l.slice(0, 3)) || 0, lines }; }
  }
  write(s: string) { this.sock.write(s); }
}

async function smtpSend(o: SmtpOptions, msg: MailMessage): Promise<void> {
  const to = validateAddress(msg.to), fromAddr = validateAddress(bareAddress(o.from));
  const subject0 = noBreaks(msg.subject, "subject");
  const subject = /[^\x20-\x7e]/.test(subject0) ? `=?UTF-8?B?${Buffer.from(subject0, "utf8").toString("base64")}?=` : subject0;
  const fromHeader = noBreaks(o.from, "from");
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (err?: Error) => { if (done) return; done = true; clearTimeout(timer); try { conn?.sock.destroy(); } catch { /* closing */ }
      if (err) reject(err instanceof MailError ? err : new MailError("mail delivery failed: " + String(err.message).replace(/\s+/g, " ").slice(0, 120), true)); else resolve(); };
    const timer = setTimeout(() => finish(new MailError("mail server did not answer in time", true)), o.timeoutMs);
    let conn: Conn | null = null;
    const sock = o.mode === "implicit" ? tls.connect({ host: o.host, port: o.port, servername: o.host, rejectUnauthorized: o.rejectUnauthorized !== false }) : net.connect({ host: o.host, port: o.port });
    sock.on("error", (e) => finish(e));
    conn = new Conn(sock);
    (async () => {
      const expect = async (codes: number[], what: string) => { const r = await conn!.reply(); if (!codes.includes(r.code)) throw new MailError(`mail server refused ${what} (${r.code})`, r.code >= 400 && r.code < 500); return r; };
      await expect([220], "the connection");
      conn!.write("EHLO darkness.local\r\n"); let ehlo = await expect([250], "EHLO");
      if (o.mode === "starttls") {
        if (!ehlo.lines.some((l) => /STARTTLS/i.test(l))) throw new MailError("mail server does not offer STARTTLS; refusing to send credentials in clear text");
        conn!.write("STARTTLS\r\n"); await expect([220], "STARTTLS");
        const upgraded = tls.connect({ socket: conn!.sock, servername: o.host, rejectUnauthorized: o.rejectUnauthorized !== false });
        upgraded.on("error", (e) => finish(e));
        conn = new Conn(upgraded as unknown as net.Socket);
        await new Promise<void>((res, rej) => { upgraded.once("secureConnect", () => res()); upgraded.once("error", rej); });
        conn.write("EHLO darkness.local\r\n"); ehlo = await expect([250], "EHLO");
      }
      if (o.user && o.pass) {
        const plain = Buffer.from(`\0${o.user}\0${o.pass}`).toString("base64");
        conn.write(`AUTH PLAIN ${plain}\r\n`); await expect([235], "the login");
      }
      conn.write(`MAIL FROM:<${fromAddr}>\r\n`); await expect([250], "the sender");
      conn.write(`RCPT TO:<${to}>\r\n`); await expect([250, 251], "the recipient");
      conn.write("DATA\r\n"); await expect([354], "DATA");
      const body = msg.text.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
      const headers = [`From: ${fromHeader}`, `To: ${to}`, `Subject: ${subject}`, `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "Auto-Submitted: auto-generated"];
      conn.write(headers.join("\r\n") + "\r\n\r\n" + body + "\r\n.\r\n"); await expect([250], "the message");
      conn.write("QUIT\r\n");
      finish();
    })().catch((e) => finish(e));
  });
}

/** Exposed for tests: a transport-level override so a self-signed local test server can be used. */
export const _smtpSend = smtpSend;
