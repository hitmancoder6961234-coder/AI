/**
 * Aiven for PostgreSQL — durable, encrypted mirror of conversations.
 *
 * Why: Render's free/ephemeral disk loses the SQLite file on redeploy. Aiven keeps a managed,
 * backed-up copy. Message bodies are sealed with AES-256-GCM (security/vault.ts) BEFORE they
 * leave the process, so Aiven only ever stores ciphertext. Without PRIVACY_ENCRYPTION_KEY the
 * mirror stays disabled rather than silently storing plaintext (override: AIVEN_ALLOW_PLAINTEXT=true).
 *
 * Env:
 *   AIVEN_PG_URI   service URI from the Aiven console (postgres://user:pass@host:port/db?sslmode=require)
 *   AIVEN_CA_CERT  the project CA certificate, either the PEM text or a path to ca.pem
 *
 * The `pg` driver is imported lazily so the app starts fine when Aiven is not configured.
 */
import fs from "fs";
import { open, seal, vaultEnabled } from "./vault.js";

type PgPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
  end: () => Promise<void>;
};

let pool: PgPool | null = null;
let state: "disabled" | "starting" | "ready" | "error" = "disabled";
let lastError: string | null = null;
let queued = 0;

const MAX_QUEUE = 500;

export function aivenConfigured(): boolean {
  return Boolean((process.env.AIVEN_PG_URI || "").trim());
}

function mirrorAllowed(): boolean {
  return vaultEnabled() || (process.env.AIVEN_ALLOW_PLAINTEXT || "").toLowerCase() === "true";
}

function loadCa(): string | undefined {
  const raw = (process.env.AIVEN_CA_CERT || "").trim();
  if (!raw) return undefined;
  if (raw.includes("BEGIN CERTIFICATE")) return raw.replace(/\\n/g, "\n");
  try {
    return fs.readFileSync(raw, "utf8");
  } catch {
    throw new Error("AIVEN_CA_CERT is neither a PEM string nor a readable file path");
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clarity_conversations (
  id          TEXT PRIMARY KEY,
  user_hash   TEXT NOT NULL,
  title_sealed TEXT,
  updated_at  BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS clarity_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_hash       TEXT NOT NULL,
  role            TEXT NOT NULL,
  content_sealed  TEXT NOT NULL,
  created_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clarity_messages_conv ON clarity_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_clarity_messages_user ON clarity_messages (user_hash);
`;

/** Aiven never sees a raw user id: it is stored as a keyed HMAC-SHA256 (encryption key as the secret). */
async function userHash(userId: string): Promise<string> {
  const { createHmac } = await import("crypto");
  const pepper = process.env.PRIVACY_ENCRYPTION_KEY || "unkeyed";
  return createHmac("sha256", pepper).update(userId).digest("hex");
}

export async function initAiven(): Promise<void> {
  if (!aivenConfigured()) return;
  if (!mirrorAllowed()) {
    state = "disabled";
    lastError = "PRIVACY_ENCRYPTION_KEY is not set; refusing to mirror plaintext to Aiven";
    console.warn(`[Aiven] ${lastError}`);
    return;
  }
  state = "starting";
  try {
    const pg: any = await import("pg");
    const Pool = pg.Pool || pg.default?.Pool;
    const ca = loadCa();
    const connectionString = process.env.AIVEN_PG_URI!.trim().replace(/[?&]sslmode=[^&]*/i, "");
    pool = new Pool({
      connectionString,
      // Verify the server certificate against the Aiven project CA. Never disable verification.
      ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true },
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
    }) as PgPool;
    await pool.query(SCHEMA);
    state = "ready";
    lastError = null;
    console.log("[Aiven] PostgreSQL mirror ready (TLS verified, content encrypted)");
  } catch (err: any) {
    state = "error";
    lastError = String(err?.message || err);
    pool = null;
    console.warn("[Aiven] mirror disabled:", lastError);
  }
}

export function aivenStatus() {
  return { configured: aivenConfigured(), state, encrypted: vaultEnabled(), queued, error: lastError };
}

async function run(fn: (p: PgPool) => Promise<void>): Promise<void> {
  if (state !== "ready" || !pool) return;
  if (queued >= MAX_QUEUE) return; // back-pressure: the mirror is best-effort, never block chat
  queued++;
  try {
    await fn(pool);
  } catch (err: any) {
    lastError = String(err?.message || err);
    console.warn("[Aiven] mirror write failed:", lastError);
  } finally {
    queued--;
  }
}

export function mirrorMessage(m: {
  id: string;
  conversation_id: string;
  user_id?: string;
  role: string;
  content: string;
  created_at: number;
}): void {
  if (state !== "ready") return;
  void run(async (p) => {
    const uh = await userHash(m.user_id || "unknown");
    const sealed = vaultEnabled() ? seal(m.content, m.id) : m.content;
    await p.query(
      `INSERT INTO clarity_messages (id, conversation_id, user_hash, role, content_sealed, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET content_sealed = EXCLUDED.content_sealed`,
      [m.id, m.conversation_id, uh, m.role, sealed, m.created_at]
    );
  });
}

/** Remove everything mirrored for one user (called from the erase endpoint). */
export function eraseMirroredUser(userId: string): void {
  if (state !== "ready") return;
  void run(async (p) => {
    const uh = await userHash(userId);
    await p.query("DELETE FROM clarity_messages WHERE user_hash = $1", [uh]);
    await p.query("DELETE FROM clarity_conversations WHERE user_hash = $1", [uh]);
  });
}

/** Read back a conversation from the mirror (disaster recovery helper). */
export async function recoverConversation(conversationId: string): Promise<Array<{ id: string; role: string; content: string; created_at: number }>> {
  if (state !== "ready" || !pool) return [];
  const r = await pool.query(
    "SELECT id, role, content_sealed, created_at FROM clarity_messages WHERE conversation_id = $1 ORDER BY created_at",
    [conversationId]
  );
  return r.rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: vaultEnabled() ? open(row.content_sealed, row.id) : row.content_sealed,
    created_at: Number(row.created_at),
  }));
}
