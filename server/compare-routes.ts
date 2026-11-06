import type express from "express";
import { CompareError, runComparison, validateCompareRequest, type CallModel, type CompareModel } from "./model-compare.js";

/**
 * POST /api/compare   { prompt, modelIds: [2..3] }  ->  { results: [{ modelId, label, provider, finish, text?, error?, latencyMs }] }
 *
 * Runs one prompt on models the signed-in user has already configured. Models belonging to someone else, or unknown, read as
 * "not found" (the same answer for both). The response never contains an API key: results carry only the model's id, label and
 * provider. Because every call is billed by the provider, a user may have one comparison in flight at a time and at most
 * COMPARE_PER_MINUTE per minute. A browser disconnect aborts every upstream call.
 */

export const COMPARE_PER_MINUTE = 6;

export function registerCompareRoutes(app: express.Express, deps: {
  getUserId: (req: express.Request) => Promise<string | null>;
  getModel: (userId: string, modelId: string) => (CompareModel & { enabled?: boolean }) | null;
  call: CallModel;
  timeoutMs?: number;
  now?: () => number;
}): void {
  const now = deps.now ?? Date.now;
  const inFlight = new Set<string>();
  const recent = new Map<string, number[]>();

  /** 0 when the user may start a comparison now (and the start is recorded); otherwise the seconds until they may. */
  function retryAfterSeconds(uid: string): number {
    const t = now();
    const list = (recent.get(uid) || []).filter((x) => t - x < 60_000);
    if (list.length >= COMPARE_PER_MINUTE) {
      recent.set(uid, list);
      return Math.max(1, Math.ceil((60_000 - (t - list[0])) / 1000));
    }
    list.push(t);
    recent.set(uid, list);
    if (recent.size > 5000) for (const [k, v] of recent) if (!v.some((x) => t - x < 60_000)) recent.delete(k);
    return 0;
  }

  app.post("/api/compare", async (req, res) => {
    const uid = await deps.getUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    let parsed;
    try { parsed = validateCompareRequest(req.body); }
    catch (e) {
      if (e instanceof CompareError) return res.status(e.status).json({ error: e.message, code: e.code });
      throw e;
    }

    const models: CompareModel[] = [];
    for (const id of parsed.modelIds) {
      const m = deps.getModel(uid, id);
      if (!m) return res.status(404).json({ error: "One of the chosen models was not found in your account.", code: "MODEL_NOT_FOUND" });
      if (m.enabled === false) return res.status(409).json({ error: `Model "${m.name || m.id}" is disabled. Enable it first.`, code: "MODEL_DISABLED" });
      models.push(m);
    }

    if (inFlight.has(uid)) return res.status(429).json({ error: "A comparison is already running. Wait for it to finish.", code: "COMPARE_BUSY" });
    const wait = retryAfterSeconds(uid);
    if (wait > 0) {
      res.setHeader("Retry-After", String(wait));
      return res.status(429).json({ error: `Too many comparisons. Try again in ${wait} seconds.`, code: "COMPARE_RATE_LIMIT" });
    }

    inFlight.add(uid);
    const ctl = new AbortController();
    const onClose = () => { if (!res.writableEnded) ctl.abort(); };
    res.on("close", onClose);
    try {
      const results = await runComparison({ models, prompt: parsed.prompt, call: deps.call, signal: ctl.signal, timeoutMs: deps.timeoutMs });
      if (!res.writableEnded && !res.destroyed) res.json({ results });
    } finally {
      inFlight.delete(uid);
      res.off("close", onClose);
    }
  });
}
