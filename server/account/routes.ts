/**
 * Account + usage API (signed-in users only). Everything is scoped to the caller; nothing here reads another user's rows.
 *
 *   GET   /api/usage?days=14          activity counts built from what is actually stored (no token metering exists)
 *   GET   /api/account                profile + this device's session + how many other sessions are open
 *   PATCH /api/account                { name }
 *   POST  /api/account/password       { current, next }   signs every other device out
 *   GET   /api/account/sessions       open sessions (opaque ids, never the tokens)
 *   POST  /api/account/sessions/revoke-others
 */
import crypto from "crypto";
import type { Express, Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { LoginGuard, isCommonPassword } from "../security/login-guard.js";

export interface AccountDeps {
  db: DatabaseSync;
  getUserId: (req: Request) => string | null;
  /** The raw session token of this request (cookie or Bearer), or null. */
  getToken: (req: Request) => string | null;
  getUser: (uid: string) => { id: string; email: string; name: string; created_at: number } | null;
  setName: (uid: string, name: string) => void;
  /** Returns false when `current` is wrong; otherwise stores the new password. */
  changePassword: (uid: string, current: string, next: string) => boolean;
  /** Drops the session from memory, the database and any mirror. */
  dropSession: (token: string) => void;
  strict: boolean;
}

const DAY = 86_400_000;
const sid = (token: string) => crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

export function registerAccountRoutes(app: Express, d: AccountDeps): void {
  const pwGuard = new LoginGuard({ maxFails: 5, baseLockMs: 60_000, maxLockMs: 15 * 60_000 });

  const authed = (req: Request, res: Response): string | null => {
    const uid = d.getUserId(req);
    if (!uid) res.status(401).json({ error: "Sign in to continue", code: "UNAUTHORIZED" });
    return uid;
  };
  /** One failing query (older database, missing table) must not take the whole page down. */
  const rows = (sql: string, ...args: any[]): any[] => {
    try {
      return d.db.prepare(sql).all(...args) as any[];
    } catch {
      return [];
    }
  };
  const one = (sql: string, ...args: any[]): any => rows(sql, ...args)[0] || {};
  const sessionsOf = (uid: string) => rows("SELECT token, created_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC", uid, Date.now());

  app.get("/api/usage", (req, res) => {
    const uid = authed(req, res);
    if (!uid) return;
    const days = Math.min(90, Math.max(7, Math.floor(Number(req.query.days) || 14)));
    const now = Date.now();
    const start = new Date(now - (days - 1) * DAY);
    start.setHours(0, 0, 0, 0);
    const since = start.getTime();

    // Chat messages of the main workspace and of the Copilot, one row per calendar day (server-local time).
    const perDay = new Map<string, { user: number; assistant: number }>();
    for (let i = 0; i < days; i++) perDay.set(new Date(since + i * DAY).toISOString().slice(0, 10), { user: 0, assistant: 0 });
    const addDay = (r: any) => {
      const cell = perDay.get(String(r.day));
      if (cell) {
        cell.user += num(r.user_msgs);
        cell.assistant += num(r.assistant_msgs);
      }
    };
    rows(
      `SELECT strftime('%Y-%m-%d', m.created_at / 1000, 'unixepoch') AS day,
              SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END) AS user_msgs,
              SUM(CASE WHEN m.role = 'assistant' THEN 1 ELSE 0 END) AS assistant_msgs
         FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.user_id = ? AND m.created_at >= ? GROUP BY day`,
      uid,
      since,
    ).forEach(addDay);
    rows(
      `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day,
              SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS user_msgs,
              SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) AS assistant_msgs
         FROM copilot_messages WHERE user_id = ? AND created_at >= ? GROUP BY day`,
      uid,
      since,
    ).forEach(addDay);

    // Which models answered (assistant messages only; Copilot rows carry a model label).
    const byModel = new Map<string, number>();
    for (const r of rows(
      `SELECT COALESCE(NULLIF(m.model_id, ''), 'unknown') AS model, COUNT(*) AS n
         FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.user_id = ? AND m.role = 'assistant' AND m.created_at >= ? GROUP BY model`,
      uid,
      since,
    )) byModel.set(String(r.model), (byModel.get(String(r.model)) || 0) + num(r.n));
    for (const r of rows(
      `SELECT COALESCE(NULLIF(model, ''), 'copilot') AS model, COUNT(*) AS n
         FROM copilot_messages WHERE user_id = ? AND role = 'assistant' AND created_at >= ? GROUP BY model`,
      uid,
      since,
    )) byModel.set(String(r.model), (byModel.get(String(r.model)) || 0) + num(r.n));
    // Model ids are internal; show the names the user gave their models where we can.
    const names = new Map<string, string>();
    for (const r of rows("SELECT id, name FROM models WHERE user_id = ?", uid)) names.set(String(r.id), String(r.name));

    const totals = {
      conversations: num(one("SELECT COUNT(*) AS n FROM conversations WHERE user_id = ?", uid).n) + num(one("SELECT COUNT(*) AS n FROM copilot_conversations WHERE user_id = ?", uid).n),
      messages: num(one("SELECT COUNT(*) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.user_id = ?", uid).n) + num(one("SELECT COUNT(*) AS n FROM copilot_messages WHERE user_id = ?", uid).n),
      projects: num(one("SELECT COUNT(*) AS n FROM projects WHERE user_id = ?", uid).n),
      files: num(one("SELECT COUNT(*) AS n FROM workspace_files WHERE user_id = ?", uid).n),
      fileBytes: num(one("SELECT COALESCE(SUM(size), 0) AS n FROM workspace_files WHERE user_id = ?", uid).n),
      artifacts: num(one("SELECT COUNT(*) AS n FROM artifacts a JOIN projects p ON p.id = a.project_id WHERE p.user_id = ?", uid).n),
      models: num(one("SELECT COUNT(*) AS n FROM models WHERE user_id = ?", uid).n),
    };

    const series = Array.from(perDay, ([date, v]) => ({ date, userMessages: v.user, replies: v.assistant }));
    const windowTotal = series.reduce((a, b) => a + b.userMessages + b.replies, 0);
    // Compare with the window just before this one so the page can show a trend.
    const prev = num(
      one(
        `SELECT (SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.user_id = ? AND m.created_at >= ? AND m.created_at < ?)
              + (SELECT COUNT(*) FROM copilot_messages WHERE user_id = ? AND created_at >= ? AND created_at < ?) AS n`,
        uid, since - days * DAY, since, uid, since - days * DAY, since,
      ).n,
    );

    res.set("Cache-Control", "no-store");
    res.json({
      days,
      generatedAt: now,
      totals,
      window: { messages: windowTotal, previousMessages: prev },
      series,
      models: Array.from(byModel, ([id, count]) => ({ id, name: names.get(id) || (id === "unknown" ? "Not recorded" : id), count })).sort((a, b) => b.count - a.count).slice(0, 8),
      recent: rows("SELECT id, title, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 6", uid),
      // Honest about what is not measured so the page never has to invent a number.
      tokensMetered: false,
    });
  });

  app.get("/api/account", (req, res) => {
    const uid = authed(req, res);
    if (!uid) return;
    const user = d.getUser(uid);
    if (!user) return res.status(404).json({ error: "Account not found", code: "NOT_FOUND" });
    const token = d.getToken(req);
    const open = sessionsOf(uid);
    const mine = token ? open.find((s) => s.token === token) : null;
    res.set("Cache-Control", "no-store");
    res.json({
      user: { id: user.id, email: user.email, name: user.name, createdAt: user.created_at },
      session: mine ? { createdAt: num(mine.created_at), expiresAt: num(mine.expires_at) } : null,
      otherSessions: open.filter((s) => s.token !== token).length,
      privacyStrict: d.strict,
      passwordMinLength: d.strict ? 8 : 4,
    });
  });

  app.patch("/api/account", (req, res) => {
    const uid = authed(req, res);
    if (!uid) return;
    const raw = req.body?.name;
    if (typeof raw !== "string") return res.status(400).json({ error: "Enter a name", code: "VALIDATION_ERROR", field: "name" });
    const name = raw.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: "Enter a name", code: "VALIDATION_ERROR", field: "name" });
    d.setName(uid, name);
    res.json({ ok: true, name });
  });

  app.get("/api/account/sessions", (req, res) => {
    const uid = authed(req, res);
    if (!uid) return;
    const token = d.getToken(req);
    res.set("Cache-Control", "no-store");
    res.json({
      sessions: sessionsOf(uid).map((s) => ({ id: sid(s.token), createdAt: num(s.created_at), expiresAt: num(s.expires_at), current: s.token === token })),
    });
  });

  app.post("/api/account/sessions/revoke-others", (req, res) => {
    const uid = authed(req, res);
    if (!uid) return;
    const token = d.getToken(req);
    let n = 0;
    for (const s of sessionsOf(uid)) {
      if (s.token === token) continue;
      d.dropSession(s.token);
      n++;
    }
    res.json({ ok: true, revoked: n });
  });

  app.post("/api/account/password", (req, res) => {
    const uid = authed(req, res);
    if (!uid) return;
    const bad = (status: number, code: string, error: string, field: string, extra: Record<string, unknown> = {}) => res.status(status).json({ error, code, field, ...extra });
    const wait = pwGuard.check(uid);
    if (wait.locked) {
      res.set("Retry-After", String(wait.retryAfter));
      return bad(429, "ACCOUNT_LOCKED", `Too many wrong passwords. Try again in ${wait.retryAfter} seconds.`, "current", { retryAfter: wait.retryAfter });
    }
    const { current, next } = req.body || {};
    if (typeof current !== "string" || !current) return bad(400, "VALIDATION_ERROR", "Enter your current password", "current");
    if (typeof next !== "string" || !next) return bad(400, "VALIDATION_ERROR", "Enter a new password", "next");
    if (next.length > 1024) return bad(400, "VALIDATION_ERROR", "That password is too long (1024 characters at most)", "next");
    const min = d.strict ? 8 : 4;
    if (next.length < min) return bad(400, "WEAK_PASSWORD", `Use at least ${min} characters`, "next");
    if (d.strict && isCommonPassword(next)) return bad(400, "WEAK_PASSWORD", "That password is on the list of the most common ones. Choose something less guessable.", "next");
    if (next === current) return bad(400, "VALIDATION_ERROR", "The new password must be different from the current one", "next");
    if (!d.changePassword(uid, current, next)) {
      const r = pwGuard.fail(uid);
      if (r.locked) {
        res.set("Retry-After", String(r.retryAfter));
        return bad(429, "ACCOUNT_LOCKED", `Too many wrong passwords. Try again in ${r.retryAfter} seconds.`, "current", { retryAfter: r.retryAfter });
      }
      // 403, not 401: the web client treats any 401 as "session expired" and would sign the user out.
      return bad(403, "INVALID_CREDENTIALS", "Your current password isn't right", "current", { attemptsLeft: r.attemptsLeft });
    }
    pwGuard.success(uid);
    // A changed password should end every other sign-in, in case the old one was the problem.
    const token = d.getToken(req);
    let revoked = 0;
    for (const s of sessionsOf(uid)) {
      if (s.token === token) continue;
      d.dropSession(s.token);
      revoked++;
    }
    res.json({ ok: true, revokedSessions: revoked });
  });
}
