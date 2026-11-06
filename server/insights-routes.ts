import type express from "express";
import type { DatabaseSync } from "node:sqlite";
import { agentStats, clampDays, modelUsage } from "./insights.js";
import { isSealed } from "./security/secret-store.js";

/**
 * Read-only data for the Agent Workflow, Models usage and System status pages. Every query is scoped to the signed-in user; nothing server-wide
 * and nothing about other users is returned (no hostnames, paths, versions, other accounts' counts or credentials).
 *
 *   GET /api/agent/stats?days=14     runs, success / error rate, steps, duration, tools used, recent runs
 *   GET /api/usage/models?days=14    calls and ESTIMATED tokens per model, last used, daily series
 *   GET /api/system/status           readiness of the service, your own data and models, alerts derived from both
 */

export interface SystemDeps {
  getUserKey: (req: express.Request) => Promise<string | null>;
  /** readiness checks of this instance: names and ok / fail only (the details stay in the server log) */
  readiness: () => Promise<{ state: string; checks: Record<string, { required: boolean; status: "ok" | "fail"; ms: number }> }>;
  vaultEnabled: () => boolean;
  startedAt: number;
}

export interface Alert { level: "critical" | "warning" | "info"; code: string; title: string; detail: string; href?: string }

const one = (db: DatabaseSync, sql: string, ...a: any[]) => { try { return (db.prepare(sql).get(...a) as any) || {}; } catch { return {}; } };
const n = (v: unknown) => Number(v) || 0;

export function registerInsightsRoutes(app: express.Express, deps: SystemDeps & { db: DatabaseSync }): void {
  const { db } = deps;

  app.get("/api/agent/stats", async (req, res) => {
    const uid = await deps.getUserKey(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    res.json(agentStats(db, uid, clampDays(req.query.days)));
  });

  app.get("/api/usage/models", async (req, res) => {
    const uid = await deps.getUserKey(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    res.json(modelUsage(db, uid, clampDays(req.query.days)));
  });

  app.get("/api/system/status", async (req, res) => {
    const uid = await deps.getUserKey(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const ready = await deps.readiness();
    const mem = process.memoryUsage();

    const modelRows = (() => { try { return db.prepare("SELECT id, name, provider, enabled, status, api_key FROM models WHERE user_id = ?").all(uid) as any[]; } catch { return []; } })();
    const keyed = modelRows.filter((m) => m.api_key);
    const models = {
      total: modelRows.length,
      enabled: modelRows.filter((m) => n(m.enabled) === 1).length,
      withKey: keyed.length,
      sealedKeys: keyed.filter((m) => isSealed(m.api_key)).length,
      plaintextKeys: keyed.filter((m) => !isSealed(m.api_key)).length,
    };
    const own = {
      conversations: n(one(db, "SELECT COUNT(*) AS n FROM conversations WHERE user_id = ?", uid).n),
      copilotConversations: n(one(db, "SELECT COUNT(*) AS n FROM copilot_conversations WHERE user_id = ?", uid).n),
      projects: n(one(db, "SELECT COUNT(*) AS n FROM projects WHERE user_id = ?", uid).n),
      files: n(one(db, "SELECT COUNT(*) AS n FROM workspace_files WHERE user_id = ?", uid).n),
      agentRuns14d: n(one(db, "SELECT COUNT(*) AS n FROM agent_runs WHERE user_id = ? AND started_at >= ?", uid, Date.now() - 14 * 86_400_000).n),
    };

    const alerts: Alert[] = [];
    const failedRequired = Object.entries(ready.checks).filter(([, c]) => c.required && c.status === "fail").map(([k]) => k);
    const failedOptional = Object.entries(ready.checks).filter(([, c]) => !c.required && c.status === "fail").map(([k]) => k);
    if (ready.state === "not_ready" || failedRequired.length) alerts.push({ level: "critical", code: "service_not_ready", title: "The service is not ready", detail: `Required check failed: ${failedRequired.join(", ") || "unknown"}. Details are in the server log.` });
    if (ready.state === "draining") alerts.push({ level: "warning", code: "draining", title: "The server is shutting down", detail: "It is finishing in-flight requests and will stop accepting new ones." });
    if (failedOptional.length) alerts.push({ level: "warning", code: "optional_down", title: "An optional service is unavailable", detail: `${failedOptional.join(", ")} is down; the app keeps working without it.` });
    if (!models.total) alerts.push({ level: "warning", code: "no_models", title: "You have no models configured", detail: "Add a model to chat, compare answers and run agents.", href: "#/model" });
    else if (!models.enabled) alerts.push({ level: "warning", code: "no_enabled_models", title: "All of your models are disabled", detail: "Enable at least one on the Models page.", href: "#/model" });
    const bad = modelRows.filter((m) => n(m.enabled) === 1 && /error|unavailable|failed/i.test(String(m.status || "")));
    if (bad.length) alerts.push({ level: "warning", code: "model_status", title: `${bad.length} enabled model${bad.length === 1 ? "" : "s"} reported a problem`, detail: bad.slice(0, 3).map((m) => m.name || m.id).join(", "), href: "#/model" });
    if (models.plaintextKeys > 0 && !deps.vaultEnabled()) alerts.push({ level: "info", code: "keys_plaintext", title: `${models.plaintextKeys} of your API key${models.plaintextKeys === 1 ? " is" : "s are"} stored unencrypted`, detail: "The server operator can turn on encryption at rest (PRIVACY_ENCRYPTION_KEY); see DEPLOY.md." });
    if (models.sealedKeys > 0 && !deps.vaultEnabled()) alerts.push({ level: "critical", code: "keys_unreadable", title: "Encrypted API keys cannot be read", detail: "The server's encryption key is missing, so your saved model keys are unavailable until it is restored." });
    const st = agentStats(db, uid, 14);
    if (st.totals.runs >= 3 && st.totals.errorRate != null && st.totals.errorRate >= 0.5) alerts.push({ level: "warning", code: "agent_failures", title: "Most recent agent runs failed", detail: `${st.totals.failed} of ${st.totals.ok + st.totals.failed} finished runs failed in the last 14 days.`, href: "#/agents" });

    res.json({
      state: ready.state,
      checks: Object.entries(ready.checks).map(([name, c]) => ({ name, required: c.required, status: c.status, ms: c.ms })),
      process: { uptimeSec: Math.round((Date.now() - deps.startedAt) / 1000), memoryMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576) },
      encryption: deps.vaultEnabled() ? "on" : "off",
      models, own, alerts,
      generatedAt: Date.now(),
    });
  });
}
