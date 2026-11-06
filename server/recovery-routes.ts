import type express from "express";
import type { DatabaseSync } from "node:sqlite";
import { MailError, type Mailer } from "./mailer.js";
import { consumeResetToken, createResetToken, isDisabled, RESET_TTL_MS, TOKEN_RE, Window } from "./recovery.js";

/**
 * Account recovery by e-mail. Public routes (under /api/auth/), so they are built to leak nothing and to be hard to abuse:
 *
 *   GET  /api/auth/recovery   { available, method }   whether e-mail recovery is set up on this server (never any account information)
 *   POST /api/auth/forgot     { email }               answers the SAME 202 whether or not the address has an account; 501 when e-mail is not configured
 *   POST /api/auth/reset      { token, password }     sets the new password, ends EVERY session of the account, one use per token
 *
 * What it does not do: it does not pretend. With no mail provider configured, /forgot says so (501) and the page explains the operator-assisted
 * alternative (scripts/admin.mjs reset-link). Sending happens after the response is written, so timing does not reveal whether an account exists;
 * failures are logged without the address. Limits: 3 requests per address and 20 per IP per hour for /forgot; 30 attempts per IP per hour for /reset.
 */

export interface RecoveryDeps {
  db: DatabaseSync;
  getMailer: () => Mailer | null;
  /** where links in e-mails point (PUBLIC_APP_URL), without a trailing slash */
  appUrl: () => string;
  findUserByEmail: (email: string) => { id: string; email: string; name: string } | null;
  findUserById: (id: string) => { id: string; email: string; name: string } | null;
  /** store a new password for the user (hashing included) */
  setPassword: (userId: string, plain: string) => void;
  /** end every session of the user; returns how many */
  revokeSessions: (userId: string) => number;
  /** forget failed-login lockouts for this address (the user just proved control of it) */
  clearLockout: (email: string) => void;
  minLength: number;
  isCommonPassword: (pw: string) => boolean;
  strict: boolean;
  log?: (event: string, fields?: Record<string, unknown>) => void;
  now?: () => number;
}

const GENERIC = "If an account exists for that address, a reset link has been sent. It is valid for 30 minutes and works once.";
const EMAIL_SHAPE = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

export function registerRecoveryRoutes(app: express.Express, d: RecoveryDeps): void {
  const now = d.now ?? Date.now;
  const perEmail = new Window(3, 3_600_000, now), perIp = new Window(20, 3_600_000, now), resetIp = new Window(30, 3_600_000, now);
  const log = d.log ?? (() => {});
  const noStore = (res: express.Response) => res.setHeader("Cache-Control", "no-store");

  app.get("/api/auth/recovery", (_req, res) => {
    noStore(res);
    const available = !!d.getMailer();
    res.json({ available, method: available ? "email" : "operator", linkMinutes: Math.round(RESET_TTL_MS / 60_000) });
  });

  app.post("/api/auth/forgot", (req, res) => {
    noStore(res);
    const mailer = d.getMailer();
    if (!mailer) return res.status(501).json({ error: "Password reset by e-mail is not set up on this server. Ask the person who runs it for a one-time reset link.", code: "RECOVERY_NOT_CONFIGURED" });
    const raw = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!raw || raw.length > 320 || !EMAIL_SHAPE.test(raw)) return res.status(400).json({ error: "Enter a valid e-mail address.", code: "VALIDATION_ERROR", field: "email" });
    const wait = Math.max(perIp.hit(String(req.ip || "?")), perEmail.hit(raw));
    if (wait > 0) { res.setHeader("Retry-After", String(wait)); return res.status(429).json({ error: "Too many reset requests. Please try again later.", code: "RATE_LIMITED", retryAfter: wait }); }

    // the answer is written first and is identical either way; the work (and the e-mail) follows
    res.status(202).json({ ok: true, message: GENERIC });
    setImmediate(async () => {
      try {
        const user = d.findUserByEmail(raw);
        if (!user || isDisabled(d.db, user.id)) return;
        const { token } = createResetToken(d.db, user.id, { now: now(), via: "email" });
        const link = `${d.appUrl().replace(/\/+$/, "")}/reset.html#token=${token}`;
        await mailer.send({ to: user.email, subject: "Reset your Darkness AI password", text: `Hello${user.name ? " " + user.name : ""},\n\nSomeone asked to reset the password of your Darkness AI account. If it was you, open this link within 30 minutes (it works once):\n\n${link}\n\nIf it was not you, ignore this message: your password stays as it is.\n` });
        log("reset_mail_sent", {});
      } catch (e) {
        log("reset_mail_failed", { transient: e instanceof MailError ? e.transient : false, reason: e instanceof MailError ? e.message.slice(0, 100) : "error" });
      }
    });
  });

  app.post("/api/auth/reset", (req, res) => {
    noStore(res);
    const wait = resetIp.hit(String(req.ip || "?"));
    if (wait > 0) { res.setHeader("Retry-After", String(wait)); return res.status(429).json({ error: "Too many attempts. Please try again later.", code: "RATE_LIMITED", retryAfter: wait }); }
    const token = req.body?.token, password = req.body?.password;
    const bad = (status: number, code: string, error: string, field?: string) => res.status(status).json({ error, code, ...(field ? { field } : {}) });
    if (typeof password !== "string" || !password) return bad(400, "VALIDATION_ERROR", "Enter a new password.", "password");
    if (password.length > 1024) return bad(400, "VALIDATION_ERROR", "That password is too long (1024 characters at most).", "password");
    if (password.length < d.minLength) return bad(400, "WEAK_PASSWORD", `Use at least ${d.minLength} characters.`, "password");
    if (d.strict && d.isCommonPassword(password)) return bad(400, "WEAK_PASSWORD", "That password is on the list of the most common ones. Choose something less guessable.", "password");
    // the password is checked BEFORE the token is spent, so a typo'd weak password does not burn the link
    if (typeof token !== "string" || !TOKEN_RE.test(token)) return bad(400, "INVALID_TOKEN", "This reset link is not valid or has expired. Request a new one.");
    const userId = consumeResetToken(d.db, token, now());
    if (!userId || isDisabled(d.db, userId)) return bad(400, "INVALID_TOKEN", "This reset link is not valid or has expired. Request a new one.");
    d.setPassword(userId, password);
    const revoked = d.revokeSessions(userId);
    const user = d.findUserById(userId);
    if (user) d.clearLockout(user.email.toLowerCase());
    res.json({ ok: true, revokedSessions: revoked });
    log("password_reset", { revokedSessions: revoked });
    // tell the account's owner (best effort): if it was not them, this e-mail is how they find out
    const mailer = d.getMailer();
    if (mailer && user) setImmediate(() => { mailer.send({ to: user.email, subject: "Your Darkness AI password was changed", text: "The password of your Darkness AI account was just changed using a reset link, and every device was signed out.\n\nIf this was you, nothing more to do. If it was not, reset your password again right away and check who has access to your e-mail.\n" }).catch((e) => log("reset_notice_failed", { reason: e instanceof MailError ? e.message.slice(0, 100) : "error" })); });
  });
}
