import type express from "express";
import type { DatabaseSync } from "node:sqlite";
import { COMPARE_PER_MINUTE } from "./compare-routes.js";
import { MAX_PROMPT_CHARS, runJobs, type CallModel, type CompareModel } from "./model-compare.js";
import {
  CATEGORIES, createPrompt, deletePrompt, exportPrompts, getPrompt, importPrompts, listPrompts, listVersions, parseVariables, PromptError,
  renderPrompt, restoreVersion, TEMPLATES, updatePrompt, MAX_BODY, MAX_PROMPTS,
} from "./prompts.js";

/**
 * Prompt Studio HTTP surface (all scoped to the signed-in user; another user's id answers 404).
 *
 *   GET    /api/prompts?category=&tag=&q=&favorite=true      the library + categories + limits
 *   GET    /api/prompts/templates                            built-in starting points (read-only)
 *   POST   /api/prompts                                      { title, body, category?, description?, tags?, note? }
 *   GET    /api/prompts/:id            PATCH /api/prompts/:id          DELETE /api/prompts/:id
 *   GET    /api/prompts/:id/versions   POST /api/prompts/:id/versions/:n/restore
 *   POST   /api/prompts/render         { body | promptId, values }   -> the filled-in text (no model is called)
 *   POST   /api/prompts/run            { body | promptId, values, modelIds: [1..3] }          -> one answer per model
 *   POST   /api/prompts/compare        { variants: [{label, body}] (2..3), values, modelId }  -> one answer per variant
 *   GET    /api/prompts/export         POST /api/prompts/import
 *
 * Running calls the user's own configured models with their own keys, so it has the Compare page's guards: at most 3 calls, an 8,000-character
 * prompt, one run in flight per user, 6 per minute, a per-model timeout, and a browser disconnect aborts every upstream request.
 */
export function registerPromptRoutes(app: express.Express, deps: {
  db: DatabaseSync;
  getUserKey: (req: express.Request) => Promise<string | null>;
  /** the account's own user id (models are keyed by it); getUserKey is the database key used for the library */
  getUserId: (req: express.Request) => Promise<string | null>;
  getModel: (userId: string, modelId: string) => (CompareModel & { enabled?: boolean }) | null;
  call: CallModel;
  timeoutMs?: number;
  now?: () => number;
}): void {
  const { db } = deps, now = deps.now ?? Date.now;
  const fail = (res: express.Response, e: unknown) => { if (e instanceof PromptError) return res.status(e.status).json({ error: e.message, code: e.code, ...(e.extra || {}) }); throw e; };
  const notFound = (res: express.Response) => res.status(404).json({ error: "Not found", type: "not_found" });
  const body = (req: express.Request): Record<string, unknown> => (req.body && typeof req.body === "object" ? req.body : {});
  const one = (v: unknown): string | undefined => (Array.isArray(v) ? String(v[0]) : typeof v === "string" ? v : undefined);
  const inFlight = new Set<string>();
  const recent = new Map<string, number[]>();

  /** 0 when the user may start a run now (the start is recorded); otherwise the seconds until they may. */
  function wait(uid: string): number {
    const t = now(), list = (recent.get(uid) || []).filter((x) => t - x < 60_000);
    if (list.length >= COMPARE_PER_MINUTE) { recent.set(uid, list); return Math.max(1, Math.ceil((60_000 - (t - list[0])) / 1000)); }
    list.push(t); recent.set(uid, list);
    return 0;
  }
  function resolveModels(uid: string, ids: unknown, min: number, max: number): CompareModel[] {
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) throw new PromptError("MODELS_REQUIRED", `Choose ${min === max ? min : `${min} to ${max}`} model${max === 1 ? "" : "s"}.`);
    const unique = [...new Set((ids as string[]).map((x) => x.trim()).filter(Boolean))];
    if (unique.length !== ids.length) throw new PromptError("INVALID_MODELS", "Each model can be chosen once, by its id.");
    if (unique.length < min || unique.length > max) throw new PromptError(unique.length > max ? "TOO_MANY_MODELS" : "TOO_FEW_MODELS", `Choose ${min === max ? min : `${min} to ${max}`} different model${max === 1 ? "" : "s"}.`);
    return unique.map((id) => {
      const m = deps.getModel(uid, id);
      if (!m) throw new PromptError("MODEL_NOT_FOUND", "One of the chosen models was not found in your account.", 404);
      if (m.enabled === false) throw new PromptError("MODEL_DISABLED", `Model "${m.name || m.id}" is disabled. Enable it first.`, 409);
      return m;
    });
  }
  /** Render and bound a prompt text for sending to a model. */
  function readyText(text: string, values: unknown): string {
    const out = renderPrompt(text, values && typeof values === "object" ? (values as Record<string, unknown>) : {});
    if (out.length > MAX_PROMPT_CHARS) throw new PromptError("PROMPT_TOO_LONG", `After filling in the variables the prompt is ${out.length.toLocaleString("en-US")} characters; a test run allows ${MAX_PROMPT_CHARS.toLocaleString("en-US")}.`, 413);
    return out;
  }
  async function guarded(req: express.Request, res: express.Response, uid: string, work: (signal: AbortSignal) => Promise<unknown>) {
    if (inFlight.has(uid)) return res.status(429).json({ error: "A prompt test is already running. Wait for it to finish.", code: "RUN_BUSY" });
    const w = wait(uid);
    if (w > 0) { res.setHeader("Retry-After", String(w)); return res.status(429).json({ error: `Too many test runs. Try again in ${w} seconds.`, code: "RUN_RATE_LIMIT" }); }
    inFlight.add(uid);
    const ctl = new AbortController();
    const onClose = () => { if (!res.writableEnded) ctl.abort(); };
    res.on("close", onClose);
    try { const out = await work(ctl.signal); if (!res.writableEnded && !res.destroyed) res.json(out); }
    finally { inFlight.delete(uid); res.off("close", onClose); }
  }

  // ---- static routes first ----
  app.get("/api/prompts/templates", async (req, res) => {
    if (!(await deps.getUserKey(req))) return res.status(401).json({ error: "Unauthorized" });
    res.json({ templates: TEMPLATES.map((t) => ({ ...t, variables: parseVariables(t.body) })), categories: CATEGORIES });
  });
  app.get("/api/prompts/export", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    res.setHeader("Content-Disposition", 'attachment; filename="darkness-prompts.json"');
    res.setHeader("Cache-Control", "no-store");
    res.json(exportPrompts(db, uid));
  });
  app.post("/api/prompts/import", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    try { res.json(importPrompts(db, uid, req.body)); } catch (e) { fail(res, e); }
  });
  app.post("/api/prompts/render", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const b = body(req);
    try {
      let text = typeof b.body === "string" ? b.body : "";
      if (!text && typeof b.promptId === "string") { const p = getPrompt(db, uid, b.promptId); if (!p) return notFound(res); text = p.body; }
      if (!text.trim()) throw new PromptError("BODY_REQUIRED", "The prompt text is empty.");
      if (text.length > MAX_BODY) throw new PromptError("BODY_TOO_LONG", "The prompt is too long.", 413);
      res.json({ variables: parseVariables(text), rendered: renderPrompt(text, (b.values && typeof b.values === "object" ? b.values : {}) as Record<string, unknown>) });
    } catch (e) { fail(res, e); }
  });
  app.post("/api/prompts/run", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const b = body(req);
    let models: CompareModel[], prompt: string;
    try {
      let text = typeof b.body === "string" ? b.body : "";
      if (!text && typeof b.promptId === "string") { const p = getPrompt(db, uid, b.promptId); if (!p) return notFound(res); text = p.body; }
      if (!text.trim()) throw new PromptError("BODY_REQUIRED", "The prompt text is empty.");
      prompt = readyText(text, b.values);
      models = resolveModels((await deps.getUserId(req)) || "", b.modelIds, 1, 3);
    } catch (e) { return fail(res, e); }
    await guarded(req, res, uid, async (signal) => ({ prompt: { characters: prompt.length }, results: await runJobs({ jobs: models.map((model) => ({ model, prompt })), call: deps.call, signal, timeoutMs: deps.timeoutMs }) }));
  });
  app.post("/api/prompts/compare", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const b = body(req);
    let model: CompareModel, jobs: Array<{ model: CompareModel; prompt: string; variant: string }>;
    try {
      const variants = Array.isArray(b.variants) ? b.variants : null;
      if (!variants || variants.length < 2 || variants.length > 3) throw new PromptError("VARIANTS_REQUIRED", "Compare 2 or 3 prompt variations.");
      [model] = resolveModels((await deps.getUserId(req)) || "", [b.modelId], 1, 1);
      jobs = variants.map((v: any, i: number) => {
        const label = typeof v?.label === "string" && v.label.trim() ? v.label.trim().slice(0, 40) : String.fromCharCode(65 + i);
        if (typeof v?.body !== "string" || !v.body.trim()) throw new PromptError("BODY_REQUIRED", `Variation ${label} is empty.`);
        return { model, prompt: readyText(v.body, b.values), variant: label };
      });
      if (new Set(jobs.map((j) => j.variant)).size !== jobs.length) throw new PromptError("DUPLICATE_LABEL", "Give each variation a different label.");
    } catch (e) { return fail(res, e); }
    await guarded(req, res, uid, async (signal) => ({ results: await runJobs({ jobs, call: deps.call, signal, timeoutMs: deps.timeoutMs }) }));
  });

  // ---- library ----
  app.get("/api/prompts", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    try { res.json({ prompts: listPrompts(db, uid, { category: one(req.query.category), tag: one(req.query.tag), q: one(req.query.q), favorite: one(req.query.favorite) === "true" }), categories: CATEGORIES, limits: { maxBody: MAX_BODY, maxPrompts: MAX_PROMPTS, maxPromptChars: MAX_PROMPT_CHARS } }); } catch (e) { fail(res, e); }
  });
  app.post("/api/prompts", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const b = body(req);
    try { res.status(201).json(createPrompt(db, uid, { title: b.title, body: b.body, category: b.category, description: b.description, tags: b.tags, note: b.note })); } catch (e) { fail(res, e); }
  });
  app.get("/api/prompts/:id", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const p = getPrompt(db, uid, String(req.params.id)); if (!p) return notFound(res); res.json(p);
  });
  app.patch("/api/prompts/:id", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const b = body(req), patch: Record<string, unknown> = {};
    for (const k of ["title", "body", "category", "description", "tags", "favorite", "note"]) if (k in b) patch[k] = b[k];
    if (!Object.keys(patch).length) return res.status(400).json({ error: "Nothing to change.", code: "EMPTY_PATCH" });
    try { const p = updatePrompt(db, uid, String(req.params.id), patch); if (!p) return notFound(res); res.json(p); } catch (e) { fail(res, e); }
  });
  app.delete("/api/prompts/:id", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    if (!deletePrompt(db, uid, String(req.params.id))) return notFound(res);
    res.json({ ok: true });
  });
  app.get("/api/prompts/:id/versions", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const v = listVersions(db, uid, String(req.params.id)); if (!v) return notFound(res); res.json({ versions: v });
  });
  app.post("/api/prompts/:id/versions/:n/restore", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    try { const p = restoreVersion(db, uid, String(req.params.id), Number(req.params.n)); if (!p) return notFound(res); res.json(p); } catch (e) { fail(res, e); }
  });
}
