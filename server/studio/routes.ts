/**
 * Project Studio API (signed-in users only; every project is ownership-checked by `loadProject`).
 *
 *   GET  /api/builder/prompts                     the inbuilt prompts + options the UI offers
 *   GET  /api/builder/projects                    the user's projects
 *   POST /api/builder/projects/:pid/brief         analyse the project -> brief, questions, recommendations
 *   POST /api/builder/projects/:pid/outline       outline for report + deck (accepts answers / feedback)
 *   POST /api/builder/projects/:pid/generate      start a build job -> { jobId }
 *   GET  /api/builder/jobs/:id                    progress + file list
 *   GET  /api/builder/jobs/:id/file?name=...      download one file
 *   POST /api/builder/jobs/:id/cancel
 *   POST /api/builder/image                       an image from the user's own words
 */
import crypto from "crypto";
import type { Express, Request, Response } from "express";
import { EXPORT_FORMATS, FORMAT_INFO, type ExportFormat } from "../documents/export.js";
import { normalizeBrief, normalizeOutline } from "./json.js";
import { type BuildRequest, type BuiltFile, type StudioEngine, imageFromWords, normalizeOptions, runBrief, runBuild, runOutline } from "./pipeline.js";
import { INBUILT_GUIDANCE, PROMPT_CATALOG } from "./prompts.js";
import { THEMES } from "./render-deck.js";
import type { DeckTheme, ExtraImage, ProjectContext } from "./types.js";

export interface StudioRouteDeps {
  getUserId: (req: Request) => string | null;
  listProjects: (userId: string) => Array<{ id: string; name: string; updatedAt?: number; fileCount?: number }>;
  /** Returns null when the project does not exist OR is not owned by this user. */
  loadProject: (userId: string, projectId: string) => Promise<ProjectContext | null>;
  getEngine: (userId: string) => StudioEngine;
}

interface Job {
  id: string;
  userId: string;
  projectId: string;
  state: "running" | "done" | "error" | "cancelled";
  pct: number;
  message: string;
  log: string[];
  warnings: string[];
  stats: Record<string, number | string>;
  files: BuiltFile[];
  error?: string;
  createdAt: number;
  ac: AbortController;
}

const jobs = new Map<string, Job>();
const JOB_TTL_MS = 60 * 60 * 1000;
const MAX_JOBS_PER_USER = 6;
const MAX_RUNNING_PER_USER = 2;
const REPORT_FORMATS: ExportFormat[] = ["docx", "pdf", "md", "html", "odt", "rtf", "txt"];

function sweep() {
  const now = Date.now();
  for (const [id, j] of jobs) if (now - j.createdAt > JOB_TTL_MS && j.state !== "running") jobs.delete(id);
}

const publicJob = (j: Job) => ({
  id: j.id,
  projectId: j.projectId,
  state: j.state,
  pct: j.pct,
  message: j.message,
  log: j.log.slice(-40),
  warnings: j.warnings,
  stats: j.stats,
  error: j.error,
  files: j.files.map((f) => ({ name: f.name, kind: f.kind, size: f.buffer.length, mime: f.mime })),
});

function asArray<T>(v: unknown, max: number): T[] {
  return Array.isArray(v) ? (v.slice(0, max) as T[]) : [];
}

export function registerStudioRoutes(app: Express, deps: StudioRouteDeps): void {
  const need = (req: Request, res: Response): string | null => {
    const uid = deps.getUserId(req);
    if (!uid) res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    return uid;
  };
  const project = async (req: Request, res: Response, uid: string): Promise<ProjectContext | null> => {
    const ctx = await deps.loadProject(uid, String(req.params.pid));
    if (!ctx) res.status(404).json({ error: "Project not found" });
    return ctx;
  };

  app.get("/api/builder/prompts", (req, res) => {
    if (!need(req, res)) return;
    res.json({
      inbuilt: INBUILT_GUIDANCE,
      layers: PROMPT_CATALOG.layers,
      themes: Object.values(THEMES).map((t) => ({ id: t.id, name: t.name, bg: t.bg, accent: t.accent })),
      reportFormats: REPORT_FORMATS.map((id) => ({ id, label: FORMAT_INFO[id].label })),
      lengths: ["concise", "standard", "detailed"],
      tones: ["formal", "plain", "persuasive"],
    });
  });

  app.get("/api/builder/projects", (req, res) => {
    const uid = need(req, res);
    if (!uid) return;
    res.json({ projects: deps.listProjects(uid) });
  });

  app.post("/api/builder/projects/:pid/brief", async (req, res) => {
    const uid = need(req, res);
    if (!uid) return;
    const ctx = await project(req, res, uid);
    if (!ctx) return;
    const ac = new AbortController();
    res.on("close", () => ac.abort());
    try {
      const engine = deps.getEngine(uid);
      const out = await runBrief(engine, ctx, normalizeOptions(req.body?.options), ac.signal);
      res.json({ ...out, mode: engine.llm ? "ai" : "offline", model: engine.llm ? `${engine.llm.provider} / ${engine.llm.model}` : null });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message || err).slice(0, 300) });
    }
  });

  app.post("/api/builder/projects/:pid/outline", async (req, res) => {
    const uid = need(req, res);
    if (!uid) return;
    const ctx = await project(req, res, uid);
    if (!ctx) return;
    const ac = new AbortController();
    res.on("close", () => ac.abort());
    try {
      const options = normalizeOptions(req.body?.options);
      const brief = normalizeBrief(req.body?.brief, ctx.name);
      const answers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.body?.answers && typeof req.body.answers === "object" ? req.body.answers : {}).slice(0, 12)) if (typeof v === "string") answers[String(k).slice(0, 30)] = v.slice(0, 600);
      const previous = req.body?.previous ? normalizeOutline(req.body.previous, { title: brief.title }) : null;
      const out = await runOutline(
        deps.getEngine(uid),
        ctx,
        brief,
        options,
        {
          answers,
          acceptedRecommendations: asArray<unknown>(req.body?.acceptedRecommendations, 10).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 400)),
          feedback: typeof req.body?.feedback === "string" ? req.body.feedback.slice(0, 2500) : undefined,
          previous: previous && previous.report.sections.length ? previous : null,
        },
        ac.signal
      );
      res.json(out);
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message || err).slice(0, 300) });
    }
  });

  app.post("/api/builder/projects/:pid/generate", async (req, res) => {
    const uid = need(req, res);
    if (!uid) return;
    const ctx = await project(req, res, uid);
    if (!ctx) return;
    sweep();
    const mine = [...jobs.values()].filter((j) => j.userId === uid);
    if (mine.filter((j) => j.state === "running").length >= MAX_RUNNING_PER_USER) return res.status(429).json({ error: "Two builds are already running. Wait for one to finish or cancel it.", code: "BUILD_BUSY" });
    if (mine.length >= MAX_JOBS_PER_USER) {
      const oldest = mine.filter((j) => j.state !== "running").sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest) jobs.delete(oldest.id);
    }

    const options = normalizeOptions(req.body?.options);
    const brief = normalizeBrief(req.body?.brief, ctx.name);
    const outline = normalizeOutline(req.body?.outline, { title: brief.title });
    if (outline.report.sections.length < 1) return res.status(400).json({ error: "The outline has no report sections" });
    const b = req.body?.build && typeof req.body.build === "object" ? req.body.build : {};
    const reportFormats = [...new Set(asArray<unknown>(b.reportFormats ?? ["docx", "pdf"], 8).filter((f): f is ExportFormat => typeof f === "string" && (REPORT_FORMATS as string[]).includes(f)))];
    const extraImages: ExtraImage[] = asArray<any>(b.extraImages, 6)
      .filter((x) => x && typeof x.words === "string" && x.words.trim())
      .map((x) => ({ words: String(x.words).trim().slice(0, 400), caption: typeof x.caption === "string" ? x.caption.slice(0, 160) : undefined }));
    const request: BuildRequest = {
      theme: (Object.keys(THEMES) as DeckTheme[]).includes(b.theme) ? b.theme : "midnight",
      reportFormats,
      deck: b.deck !== false,
      images: b.images !== false,
      extraImages,
      bundle: b.bundle !== false,
    };
    if (!reportFormats.length && !request.deck) return res.status(400).json({ error: "Choose at least one deliverable" });

    const job: Job = { id: crypto.randomBytes(12).toString("base64url"), userId: uid, projectId: ctx.id, state: "running", pct: 0, message: "Starting", log: [], warnings: [], stats: {}, files: [], createdAt: Date.now(), ac: new AbortController() };
    jobs.set(job.id, job);
    const engine = deps.getEngine(uid);
    void (async () => {
      try {
        const out = await runBuild(engine, ctx, brief, outline, options, request, (message, pct) => {
          job.message = message;
          job.pct = Math.max(job.pct, pct);
          job.log.push(message);
        }, job.ac.signal);
        job.files = out.files;
        job.warnings = out.warnings;
        job.stats = out.stats;
        job.state = "done";
        job.pct = 100;
        job.message = "Done";
      } catch (err: any) {
        job.state = job.ac.signal.aborted ? "cancelled" : "error";
        job.error = job.state === "cancelled" ? "Cancelled" : String(err?.message || err).slice(0, 300);
        job.message = job.error;
      }
    })();
    res.status(202).json({ jobId: job.id });
  });

  const ownJob = (req: Request, res: Response, uid: string): Job | null => {
    const j = jobs.get(String(req.params.id));
    if (!j || j.userId !== uid) {
      res.status(404).json({ error: "Job not found or expired" });
      return null;
    }
    return j;
  };

  app.get("/api/builder/jobs/:id", (req, res) => {
    const uid = need(req, res);
    if (!uid) return;
    const j = ownJob(req, res, uid);
    if (j) res.json(publicJob(j));
  });

  app.get("/api/builder/jobs/:id/file", (req, res) => {
    const uid = need(req, res);
    if (!uid) return;
    const j = ownJob(req, res, uid);
    if (!j) return;
    const f = j.files.find((x) => x.name === String(req.query.name || ""));
    if (!f) return res.status(404).json({ error: "File not found" });
    const leaf = f.name.split("/").pop() || "file";
    res.set({
      "Content-Type": f.mime,
      "Content-Disposition": `attachment; filename="${leaf.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(leaf)}`,
      "X-Content-Type-Options": "nosniff",
    });
    res.send(f.buffer);
  });

  app.post("/api/builder/jobs/:id/cancel", (req, res) => {
    const uid = need(req, res);
    if (!uid) return;
    const j = ownJob(req, res, uid);
    if (!j) return;
    if (j.state === "running") j.ac.abort();
    res.json({ ok: true });
  });

  app.post("/api/builder/image", async (req, res) => {
    const uid = need(req, res);
    if (!uid) return;
    const words = typeof req.body?.words === "string" ? req.body.words.trim().slice(0, 600) : "";
    if (words.length < 3) return res.status(400).json({ error: "Describe the image in a few words" });
    try {
      const theme: DeckTheme = (Object.keys(THEMES) as DeckTheme[]).includes(req.body?.theme) ? req.body.theme : "midnight";
      const aspect = ["16:9", "4:3", "1:1", "3:4", "9:16"].includes(req.body?.aspect) ? req.body.aspect : "16:9";
      const out = await imageFromWords(deps.getEngine(uid), words, { enhance: req.body?.enhance !== false, theme, options: normalizeOptions(req.body?.options), aspect });
      res.json({ prompt: out.prompt, caption: out.caption, image: `data:${out.mimeType};base64,${out.base64}`, width: out.width, height: out.height });
    } catch (err: any) {
      res.status(502).json({ error: `Image generation failed: ${String(err?.message || err).slice(0, 200)}` });
    }
  });

  void EXPORT_FORMATS;
}

/** Drop a user's jobs (called from account erase). */
export function eraseStudioUser(userId: string): number {
  let n = 0;
  for (const [id, j] of jobs) if (j.userId === userId) { j.ac.abort(); jobs.delete(id); n++; }
  return n;
}
