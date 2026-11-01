/**
 * Project Studio pipeline: brief -> outline -> (report + deck + images) -> files.
 *
 * Model access is injected (StudioEngine) so the whole pipeline is testable with a scripted fake model,
 * and so a missing model degrades to the offline engine instead of failing. Every AI step is wrapped:
 * if the model errors or returns something unusable, that step falls back to evidence-derived content and
 * a warning is recorded - a build always finishes.
 */
import AdmZip from "adm-zip";
import type { ChatMsg, LLM } from "../agent/providers.js";
import { exportDocument, type ExportFormat } from "../documents/export.js";
import { type Block, type DocModel, markdownToBlocks } from "../documents/model.js";
import { buildDossier, scrubSecrets } from "./dossier.js";
import { extractJson, normalizeBrief, normalizeOutline, normalizeRecommendations } from "./json.js";
import { offlineBrief, offlineOutline, offlineSection, offlineSlides } from "./offline.js";
import { INBUILT_GUIDANCE, briefMessages, deckMessages, enhanceWordsMessages, guidanceText, imagePromptMessages, outlineMessages, sectionMessages } from "./prompts.js";
import { THEMES, renderDeck } from "./render-deck.js";
import type { Brief, DeckTheme, ExtraImage, GeneratedImage, Outline, OutlineSection, OutlineSlide, ProjectContext, Recommendation, StudioOptions } from "./types.js";

export interface RawImage {
  mimeType: string;
  base64: string;
}

export interface StudioEngine {
  /** null = offline mode. */
  llm: LLM | null;
  makeImage: (prompt: string, aspect: "1:1" | "3:4" | "4:3" | "9:16" | "16:9") => Promise<RawImage>;
  makeDiagram: (ctx: ProjectContext) => Promise<RawImage | null>;
}

export const DEFAULT_OPTIONS: StudioOptions = {
  audience: "examiners and technical reviewers",
  purpose: "project report",
  tone: "formal",
  length: "standard",
  language: "English",
  guidance: { report: { mode: "inbuilt" }, deck: { mode: "inbuilt" }, image: { mode: "inbuilt" } },
};

export function normalizeOptions(raw: any): StudioOptions {
  const r = raw && typeof raw === "object" ? raw : {};
  const s = (v: unknown, max: number, d: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : d);
  const g = (v: any) => ({ mode: v?.mode === "custom" ? ("custom" as const) : ("inbuilt" as const), text: typeof v?.text === "string" ? v.text.slice(0, 8000) : undefined });
  return {
    audience: s(r.audience, 160, DEFAULT_OPTIONS.audience),
    purpose: s(r.purpose, 160, DEFAULT_OPTIONS.purpose),
    tone: ["formal", "plain", "persuasive"].includes(r.tone) ? r.tone : DEFAULT_OPTIONS.tone,
    length: ["concise", "standard", "detailed"].includes(r.length) ? r.length : DEFAULT_OPTIONS.length,
    language: s(r.language, 40, DEFAULT_OPTIONS.language),
    author: typeof r.author === "string" && r.author.trim() ? r.author.trim().slice(0, 120) : undefined,
    institution: typeof r.institution === "string" && r.institution.trim() ? r.institution.trim().slice(0, 160) : undefined,
    guidance: { report: g(r.guidance?.report), deck: g(r.guidance?.deck), image: g(r.guidance?.image) },
  };
}

// --- helpers -----------------------------------------------------------------------------------

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

async function askJson(llm: LLM, messages: ChatMsg[], maxTokens: number, signal?: AbortSignal): Promise<any> {
  const first = await llm.complete(messages, { maxTokens, temperature: 0.3, signal });
  const parsed = extractJson(first);
  if (parsed) return parsed;
  const retry = await llm.complete([...messages, { role: "assistant", content: first.slice(0, 6000) }, { role: "user", content: "That was not valid JSON for the requested shape. Reply again with ONLY the JSON object - no prose, no code fences." }], { maxTokens, temperature: 0.1, signal });
  const again = extractJson(retry);
  if (!again) throw new Error("The model did not return valid JSON");
  return again;
}

function cleanMarkdown(md: string, title: string): string {
  let t = md.trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i, "$1").trim();
  const heading = new RegExp(`^#{1,3}\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n+`, "i");
  t = t.replace(heading, "");
  return t;
}

const today = () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const errMsg = (e: unknown) => String((e as any)?.message || e).slice(0, 200);

async function normalizeImage(raw: RawImage, maxW = 1600): Promise<{ mimeType: string; base64: string; width: number; height: number }> {
  const sharp = (await import("sharp")).default;
  const input = Buffer.from(raw.base64, "base64");
  const img = /svg/i.test(raw.mimeType) ? sharp(input, { density: 144 }) : sharp(input);
  const png = await img.resize({ width: maxW, withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
  const meta = await sharp(png).metadata();
  return { mimeType: "image/png", base64: png.toString("base64"), width: meta.width || 1280, height: meta.height || 720 };
}

// --- step 1: brief -----------------------------------------------------------------------------

export async function runBrief(engine: StudioEngine, ctx: ProjectContext, options: StudioOptions, signal?: AbortSignal) {
  const warnings: string[] = [];
  const dossier = buildDossier(ctx);
  let brief: Brief;
  if (engine.llm) {
    try {
      brief = normalizeBrief(await askJson(engine.llm, briefMessages(dossier.text, options), 4096, signal), ctx.name);
    } catch (e) {
      warnings.push(`The AI model could not produce the brief (${errMsg(e)}); using an evidence-based brief instead.`);
      brief = offlineBrief(ctx, options);
    }
  } else {
    brief = offlineBrief(ctx, options);
    warnings.push("No AI model is configured: using offline mode. Add a model in Settings for deeper writing.");
  }
  if (!brief.questions.length) brief.questions = offlineBrief(ctx, options).questions;
  return { brief, facts: dossier.facts, warnings };
}

// --- step 2: outline ---------------------------------------------------------------------------

export interface OutlineInput {
  answers: Record<string, string>;
  acceptedRecommendations: string[];
  feedback?: string;
  previous?: Outline | null;
}

export async function runOutline(engine: StudioEngine, ctx: ProjectContext, brief: Brief, options: StudioOptions, input: OutlineInput, signal?: AbortSignal) {
  const warnings: string[] = [];
  let outline: Outline | null = null;
  let recommendations: Recommendation[] = [];
  if (engine.llm) {
    try {
      const dossier = buildDossier(ctx);
      const raw = await askJson(engine.llm, outlineMessages({ dossierText: dossier.text, brief, options, answers: input.answers, acceptedRecommendations: input.acceptedRecommendations, feedback: input.feedback, previous: input.previous }), 8192, signal);
      outline = normalizeOutline(raw, { title: brief.title });
      recommendations = normalizeRecommendations(raw?.recommendations);
      if (outline.report.sections.length < 3 || outline.deck.slides.length < 3) {
        warnings.push("The model's outline was too short; using the evidence-based outline.");
        outline = null;
      }
    } catch (e) {
      warnings.push(`The AI model could not produce the outline (${errMsg(e)}); using an evidence-based outline instead.`);
    }
  }
  if (!outline) outline = offlineOutline(brief, ctx, options);
  if (!recommendations.length) recommendations = brief.recommendations;
  return { outline, recommendations, warnings };
}

// --- step 3: build -----------------------------------------------------------------------------

export interface BuildRequest {
  theme: DeckTheme;
  reportFormats: ExportFormat[];
  deck: boolean;
  images: boolean;
  extraImages: ExtraImage[];
  bundle: boolean;
}

export interface BuiltFile {
  name: string;
  mime: string;
  buffer: Buffer;
  kind: "report" | "deck" | "image" | "bundle" | "notes";
}

function tablesFor(slides: OutlineSlide[], brief: Brief, ctx: ProjectContext): Record<string, string[][]> {
  const a = ctx.analysis || {};
  const out: Record<string, string[][]> = {};
  for (const s of slides) {
    if (s.visual.kind !== "table") continue;
    const key = `${s.id} ${s.title}`.toLowerCase();
    if (/stack|tech/.test(key) && brief.techStack.length) out[s.id] = [["Layer", "Technology", "Used for"], ...brief.techStack.slice(0, 10).map((t) => [t.layer, t.technology, t.why])];
    else if (/api|endpoint|interface/.test(key) && a.apiIntelligence?.endpoints?.length) out[s.id] = [["Method", "Path", "File"], ...a.apiIntelligence.endpoints.slice(0, 10).map((e: any) => [e.method, e.path, e.file])];
    else if (/data|model|schema/.test(key) && a.databaseIntelligence?.models?.length) out[s.id] = [["Entity", "Fields"], ...a.databaseIntelligence.models.slice(0, 10).map((m: any) => [m.name, (m.fields || []).slice(0, 5).map((f: any) => f.name).join(", ")])];
    else if (/test|quality|secur/.test(key) && a.codeQuality) out[s.id] = [["Check", "Result"], ["Quality score", `${a.codeQuality.score}/100`], ["Test files", String(a.codeQuality.testing?.testFilesCount ?? 0)], ["Security score", a.securityAnalysis ? `${a.securityAnalysis.score}/100` : "n/a"]];
    else if (brief.keyFeatures.length) out[s.id] = [["Feature", "What it does"], ...brief.keyFeatures.slice(0, 8).map((f) => [f.name, f.what])];
  }
  return out;
}

function pickCode(ctx: ProjectContext): string {
  const f = ctx.files.find((x) => /(^|\/)(main|index|app|server)\.(jsx?|tsx?|py|java|go)$/i.test(x.path) && x.content) || ctx.files.find((x) => /\.(jsx?|tsx?|py|java|go|rs|cs)$/i.test(x.path) && x.content);
  return f ? scrubSecrets(f.content.split(/\r?\n/).filter((l) => l.trim()).slice(0, 14).join("\n")) : "";
}

export async function runBuild(
  engine: StudioEngine,
  ctx: ProjectContext,
  brief: Brief,
  outlineIn: Outline,
  options: StudioOptions,
  req: BuildRequest,
  progress: (message: string, pct: number) => void,
  signal?: AbortSignal
): Promise<{ files: BuiltFile[]; warnings: string[]; stats: Record<string, number | string> }> {
  const warnings: string[] = [];
  const theme = THEMES[req.theme] || THEMES.midnight;
  const outline: Outline = JSON.parse(JSON.stringify(outlineIn));
  const dossier = buildDossier(ctx);
  const files: BuiltFile[] = [];
  const check = () => { if (signal?.aborted) throw new Error("Cancelled"); };

  // ---- report sections --------------------------------------------------------------------
  progress("Writing the report", 8);
  const sections = outline.report.sections;
  const bodies = new Map<string, string>();
  let done = 0;
  await mapLimit(sections, engine.llm ? 3 : 8, async (s: OutlineSection) => {
    check();
    let md = "";
    if (engine.llm) {
      try {
        md = cleanMarkdown(await engine.llm.complete(sectionMessages({ dossierText: dossier.text, brief, outline, section: s, options }), { maxTokens: 3500, temperature: 0.4, signal }), s.title);
      } catch (e) {
        warnings.push(`Section "${s.title}": model error (${errMsg(e)}); wrote it from the analysis instead.`);
      }
    }
    if (!md.trim()) md = offlineSection(s, brief, ctx);
    bodies.set(s.id, md);
    progress(`Wrote section ${++done}/${sections.length}: ${s.title}`, 8 + Math.round((done / sections.length) * 40));
  });

  // ---- deck content -----------------------------------------------------------------------
  let slides: OutlineSlide[] = outline.deck.slides;
  if (req.deck) {
    check();
    progress("Writing the slides", 50);
    let written = false;
    if (engine.llm) {
      try {
        const raw = await askJson(engine.llm, deckMessages({ dossierText: dossier.text, brief, outline, options }), 8192, signal);
        const byId = new Map<string, any>((Array.isArray(raw?.slides) ? raw.slides : []).map((x: any) => [String(x?.id), x]));
        slides = outline.deck.slides.map((s) => {
          const w = byId.get(s.id);
          if (!w) return s;
          const n = normalizeOutline({ deck: { slides: [{ ...s, ...w, id: s.id, visual: w.visual || s.visual }] } }, { title: "" }).deck.slides[0];
          return n ? { ...n, id: s.id } : s;
        });
        written = slides.some((s) => s.bullets.length);
      } catch (e) {
        warnings.push(`Slides: model error (${errMsg(e)}); wrote them from the analysis instead.`);
      }
    }
    if (engine.llm && !written) warnings.push("Slides: the model returned no usable slide content; wrote them from the analysis instead.");
    if (!written || !engine.llm) slides = offlineSlides({ ...outline, deck: { ...outline.deck, slides } }, brief, ctx);
  }

  // ---- images -----------------------------------------------------------------------------
  const figures = new Map<string, GeneratedImage>(); // key: "sec:<id>" | "slide:<id>" | "extra:<n>"
  const wantDiagram = sections.some((s) => s.visual === "diagram") || slides.some((s) => s.visual.kind === "diagram");
  if (wantDiagram) {
    progress("Drawing the architecture diagram", 58);
    try {
      const d = await engine.makeDiagram(ctx);
      if (d) {
        const n = await normalizeImage(d);
        const g: GeneratedImage = { id: "diagram", caption: "System architecture", prompt: "architecture diagram", ...n, source: "diagram" };
        for (const s of sections) if (s.visual === "diagram") figures.set(`sec:${s.id}`, { ...g, caption: `${s.title}: architecture overview` });
        for (const s of slides) if (s.visual.kind === "diagram") figures.set(`slide:${s.id}`, g);
      }
    } catch (e) {
      warnings.push(`Diagram: ${errMsg(e)}`);
    }
  }

  if (req.images || req.extraImages.length) {
    const cap = options.length === "concise" ? 4 : options.length === "standard" ? 8 : 12;
    const needs: Array<{ key: string; idea: string; context: string; caption: string; aspect: "16:9" | "4:3" | "1:1" }> = [];
    if (req.images) {
      for (const s of sections) if (s.visual === "image") needs.push({ key: `sec:${s.id}`, idea: s.imageIdea || s.title, context: `report section "${s.title}"`, caption: s.title, aspect: "16:9" });
      if (req.deck) for (const s of slides) if (s.visual.kind === "image" && s.visual.idea) needs.push({ key: `slide:${s.id}`, idea: s.visual.idea, context: `slide "${s.title}"`, caption: s.title, aspect: s.id === slides[0]?.id ? "4:3" : "4:3" });
    }
    const limited = needs.slice(0, cap);
    req.extraImages.slice(0, 6).forEach((x, i) => limited.push({ key: `extra:${i}`, idea: x.words, context: "an illustration requested directly by the user", caption: x.caption || x.words.slice(0, 80), aspect: "16:9" }));

    progress("Designing image prompts", 60);
    const prompts = new Map<string, { prompt: string; caption: string }>();
    if (engine.llm && limited.length) {
      try {
        const raw = await askJson(engine.llm, imagePromptMessages({ items: limited.map((n) => ({ id: n.key, idea: n.idea, context: n.context })), brief, themeName: theme.name, palette: theme.palette, options }), 3000, signal);
        for (const it of Array.isArray(raw?.images) ? raw.images : []) if (it?.id && typeof it.prompt === "string") prompts.set(String(it.id), { prompt: it.prompt.slice(0, 900), caption: typeof it.caption === "string" ? it.caption.slice(0, 160) : "" });
      } catch (e) {
        warnings.push(`Image prompts: model error (${errMsg(e)}); using direct prompts.`);
      }
    }
    let made = 0;
    await mapLimit(limited, 2, async (n) => {
      check();
      const p = prompts.get(n.key);
      const prompt = p?.prompt || `${n.idea}. Clean, modern editorial illustration, ${theme.palette}. No text, no letters, no logos, no watermark.`;
      try {
        const raw = await engine.makeImage(prompt, n.aspect);
        const img = await normalizeImage(raw);
        figures.set(n.key, { id: n.key, caption: p?.caption || n.caption, prompt, ...img, source: "ai" });
      } catch (e) {
        warnings.push(`Image "${n.caption.slice(0, 40)}": ${errMsg(e)}`);
      }
      progress(`Image ${++made}/${limited.length}`, 60 + Math.round((made / limited.length) * 20));
    });
  }

  // ---- assemble + render ------------------------------------------------------------------
  check();
  progress("Assembling documents", 82);
  const blocks: Block[] = [];
  let figNo = 0;
  const addFigure = (g: GeneratedImage | undefined) => {
    if (!g) return;
    figNo++;
    blocks.push({ t: "img", src: `data:${g.mimeType};base64,${g.base64}`, alt: g.caption, caption: `Figure ${figNo}: ${g.caption}` });
  };
  for (const s of sections) {
    blocks.push({ t: "h", level: 1, text: s.title });
    const parsed = markdownToBlocks(bodies.get(s.id) || "").filter((b) => !(b.t === "h" && b.level === 1 && b.text.trim().toLowerCase() === s.title.trim().toLowerCase()));
    const fig = figures.get(`sec:${s.id}`);
    const at = parsed.findIndex((b) => b.t === "p");
    if (fig && at >= 0) parsed.splice(at + 1, 0, { t: "img", src: `data:${fig.mimeType};base64,${fig.base64}`, alt: fig.caption, caption: `Figure ${++figNo}: ${fig.caption}` });
    else if (fig) { blocks.push(...parsed); addFigure(fig); continue; }
    blocks.push(...parsed);
  }
  // user-requested illustrations that belong to no section go in a figures appendix
  const extras = [...figures.entries()].filter(([k]) => k.startsWith("extra:")).map(([, v]) => v);
  if (extras.length) {
    blocks.push({ t: "h", level: 1, text: "Additional Figures" });
    extras.forEach(addFigure);
  }
  const doc: DocModel = {
    title: outline.report.title || brief.title,
    subtitle: outline.report.subtitle || undefined,
    author: [options.author, options.institution].filter(Boolean).join(", ") || undefined,
    date: today(),
    blocks,
  };

  progress("Rendering files", 86);
  const base = (doc.title || "project").replace(/[^\p{L}\p{N} _-]+/gu, "").trim().replace(/\s+/g, "_").slice(0, 60) || "project";
  for (const f of req.reportFormats) {
    check();
    const out = await exportDocument(doc, f);
    files.push({ name: `${base}_report.${f}`, mime: out.mime, buffer: out.buffer, kind: "report" });
  }
  if (req.deck) {
    const slideImages: Record<string, GeneratedImage> = {};
    for (const s of slides) {
      const g = figures.get(`slide:${s.id}`);
      if (g) slideImages[s.id] = g;
    }
    // user illustrations become closing image slides
    const deckSlides = [...slides];
    extras.forEach((g, i) => {
      const id = `extra-${i}`;
      deckSlides.splice(Math.max(1, deckSlides.length - 1), 0, { id, title: g.caption, message: "", bullets: [], visual: { kind: "image" }, notes: "" });
      slideImages[id] = g;
    });
    const buf = await renderDeck({
      theme: req.theme,
      title: outline.deck.title || doc.title,
      subtitle: outline.deck.subtitle || brief.oneLiner,
      author: options.author,
      institution: options.institution,
      date: today(),
      footer: brief.title,
      slides: deckSlides,
      images: slideImages,
      tables: tablesFor(deckSlides, brief, ctx),
      codes: Object.fromEntries(deckSlides.filter((s) => s.visual.kind === "code").map((s) => [s.id, pickCode(ctx)]).filter(([, c]) => c)),
    });
    files.push({ name: `${base}_presentation.pptx`, mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: buf, kind: "deck" });
  }
  let n = 0;
  let diagramSaved = false;
  for (const g of figures.values()) {
    if (g.source === "diagram") {
      if (diagramSaved) continue;
      diagramSaved = true;
      files.push({ name: "images/architecture-diagram.png", mime: "image/png", buffer: Buffer.from(g.base64, "base64"), kind: "image" });
      continue;
    }
    files.push({ name: `images/figure-${++n}.png`, mime: "image/png", buffer: Buffer.from(g.base64, "base64"), kind: "image" });
  }

  const notes = [
    `# How these files were produced`,
    ``,
    `Mode: ${engine.llm ? `AI (${engine.llm.provider} / ${engine.llm.model})` : "offline (derived from static analysis; no AI model configured)"}`,
    `Report guidance: ${options.guidance.report.mode === "custom" ? "your own prompt" : "Darkness inbuilt prompt"}`,
    `Deck guidance: ${options.guidance.deck.mode === "custom" ? "your own prompt" : "Darkness inbuilt prompt"}`,
    `Image guidance: ${options.guidance.image.mode === "custom" ? "your own prompt" : "Darkness inbuilt prompt"}`,
    ``,
    `Warnings:`,
    ...(warnings.length ? warnings.map((w) => `- ${w}`) : ["- none"]),
    ``,
    `## Report guidance used`,
    guidanceText("report", options.guidance.report),
    ``,
    `## Deck guidance used`,
    guidanceText("deck", options.guidance.deck),
    ``,
    `## Image guidance used`,
    guidanceText("image", options.guidance.image),
  ].join("\n");
  files.push({ name: "prompts-used.md", mime: "text/markdown; charset=utf-8", buffer: Buffer.from(notes, "utf8"), kind: "notes" });

  if (req.bundle) {
    const zip = new AdmZip();
    for (const f of files) zip.addFile(f.name, f.buffer);
    files.push({ name: `${base}_package.zip`, mime: "application/zip", buffer: zip.toBuffer(), kind: "bundle" });
  }
  progress("Done", 100);

  const words = [...bodies.values()].join(" ").split(/\s+/).filter(Boolean).length;
  return { files, warnings, stats: { sections: sections.length, slides: req.deck ? slides.length : 0, images: figures.size, words, mode: engine.llm ? "ai" : "offline" } };
}

// --- single image from the user's own words ----------------------------------------------------

export async function imageFromWords(engine: StudioEngine, words: string, opts: { enhance: boolean; theme: DeckTheme; options: StudioOptions; aspect?: "16:9" | "4:3" | "1:1" | "3:4" | "9:16" }) {
  const theme = THEMES[opts.theme] || THEMES.midnight;
  let prompt = words.trim().slice(0, 900);
  let caption = words.trim().slice(0, 80);
  if (opts.enhance && engine.llm) {
    try {
      const raw = await askJson(engine.llm, enhanceWordsMessages(words, theme.name, theme.palette, opts.options), 1200);
      const it = Array.isArray(raw?.images) ? raw.images[0] : null;
      if (it?.prompt) { prompt = String(it.prompt).slice(0, 900); if (it.caption) caption = String(it.caption).slice(0, 120); }
    } catch {
      /* fall back to the user's words */
    }
  } else if (opts.enhance) {
    prompt = `${prompt}. Clean, modern editorial illustration, ${theme.palette}. No text, no letters, no logos, no watermark.`;
  }
  const raw = await engine.makeImage(prompt, opts.aspect || "16:9");
  const img = await normalizeImage(raw);
  return { prompt, caption, ...img };
}

export { INBUILT_GUIDANCE };
