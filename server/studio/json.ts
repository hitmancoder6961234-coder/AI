/**
 * Tolerant JSON extraction + normalisers. Models wrap JSON in prose or fences, leave trailing commas, and
 * occasionally return the wrong shape - none of that may crash a build. Every normaliser returns a valid,
 * bounded structure from whatever it is given.
 */
import type { Brief, BriefQuestion, Outline, OutlineSection, OutlineSlide, Recommendation, SectionKind, VisualKind } from "./types.js";

export function extractJson(raw: string): any | null {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      try {
        return JSON.parse(s.replace(/,\s*([}\]])/g, "$1")); // trailing commas
      } catch {
        return undefined;
      }
    }
  };
  const direct = tryParse(text);
  if (direct !== undefined && typeof direct === "object") return direct;
  const starts: number[] = [];
  for (let i = 0; i < text.length && starts.length < 40; i++) if (text[i] === "{" || text[i] === "[") starts.push(i);
  for (const start of starts) {
    const open = text[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) {
        const v = tryParse(text.slice(start, i + 1));
        if (v !== undefined && typeof v === "object") return v;
        break;
      }
    }
  }
  return null;
}

const str = (v: unknown, max = 600, fallback = ""): string => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : fallback);
const arr = <T>(v: unknown, max: number, f: (x: any, i: number) => T | null): T[] =>
  (Array.isArray(v) ? v : []).slice(0, max).map(f).filter((x): x is T => x !== null);
const strs = (v: unknown, max: number, len = 400): string[] => arr(v, max, (x) => (typeof x === "string" && x.trim() ? x.trim().slice(0, len) : null));
const slug = (s: string, i: number) => (s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `item-${i + 1}`);

const KINDS: SectionKind[] = ["abstract", "introduction", "objectives", "requirements", "tech-stack", "architecture", "data-design", "api", "implementation", "testing", "security", "results", "limitations", "future-work", "conclusion", "references", "appendix-run", "other"];
const VISUALS: VisualKind[] = ["none", "image", "diagram", "table", "code"];

export function normalizeBrief(raw: any, fallbackTitle: string): Brief {
  const r = raw && typeof raw === "object" ? raw : {};
  const questions: BriefQuestion[] = arr(r.questions, 6, (q, i) =>
    q && typeof q === "object" && str(q.question)
      ? { id: str(q.id, 20) || `q${i + 1}`, question: str(q.question, 300), why: str(q.why, 300), options: strs(q.options, 5, 80), default: str(q.default, 120) }
      : null
  );
  const recs: Recommendation[] = arr(r.recommendations, 10, (x, i) =>
    x && typeof x === "object" && str(x.text)
      ? {
          id: str(x.id, 20) || `r${i + 1}`,
          type: (["improve-project", "improve-report", "add-section", "add-visual"].includes(x.type) ? x.type : "other") as Recommendation["type"],
          text: str(x.text, 400),
          impact: (["high", "medium", "low"].includes(x.impact) ? x.impact : "medium") as Recommendation["impact"],
        }
      : null
  );
  return {
    title: str(r.title, 140) || fallbackTitle,
    oneLiner: str(r.oneLiner, 240),
    projectType: str(r.projectType, 80) || "software project",
    audience: str(r.audience, 160),
    summary: str(r.summary, 1500),
    problem: str(r.problem, 900),
    solution: str(r.solution, 900),
    keyFeatures: arr(r.keyFeatures, 10, (f) => (f && typeof f === "object" && str(f.name) ? { name: str(f.name, 100), what: str(f.what, 400), evidence: strs(f.evidence, 4, 160) } : null)),
    architecture: str(r.architecture, 1200),
    techStack: arr(r.techStack, 14, (t) => (t && typeof t === "object" && str(t.technology) ? { layer: str(t.layer, 60), technology: str(t.technology, 80), why: str(t.why, 240) } : null)),
    strengths: strs(r.strengths, 6, 240),
    risksOrGaps: strs(r.risksOrGaps, 6, 240),
    questions,
    recommendations: recs,
    source: "ai",
  };
}

function normSection(s: any, i: number): OutlineSection | null {
  if (!s || typeof s !== "object" || !str(s.title)) return null;
  const title = str(s.title, 120);
  const kind = (KINDS.includes(s.kind) ? s.kind : "other") as SectionKind;
  const visual = (VISUALS.includes(s.visual) ? s.visual : "none") as VisualKind;
  return { id: slug(str(s.id) || title, i), kind, title, purpose: str(s.purpose, 300), keyPoints: strs(s.keyPoints, 8, 220), visual, imageIdea: visual === "image" ? str(s.imageIdea, 300) || title : undefined };
}

function normSlide(s: any, i: number): OutlineSlide | null {
  if (!s || typeof s !== "object" || !str(s.title)) return null;
  const v = s.visual && typeof s.visual === "object" ? s.visual : {};
  const kind = (VISUALS.includes(v.kind) ? v.kind : "none") as VisualKind;
  return {
    id: slug(str(s.id) || str(s.title), i),
    title: str(s.title, 110),
    message: str(s.message, 240),
    bullets: strs(s.bullets, 6, 140),
    visual: { kind, idea: kind === "image" ? str(v.idea, 300) || str(s.title, 110) : kind === "none" ? undefined : str(v.idea, 200) || undefined },
    notes: str(s.notes, 1200),
  };
}

export function normalizeOutline(raw: any, fallback: { title: string }): Outline {
  const r = raw && typeof raw === "object" ? raw : {};
  const rep = r.report && typeof r.report === "object" ? r.report : {};
  const deck = r.deck && typeof r.deck === "object" ? r.deck : {};
  const seen = new Set<string>();
  const unique = <T extends { id: string }>(items: T[]) =>
    items.map((it) => { let id = it.id, n = 2; while (seen.has(id)) id = `${it.id}-${n++}`; seen.add(id); return { ...it, id }; });
  seen.clear();
  const sections = unique(arr(rep.sections, 16, normSection));
  seen.clear();
  const slides = unique(arr(deck.slides, 24, normSlide));
  return {
    report: { title: str(rep.title, 160) || fallback.title, subtitle: str(rep.subtitle, 200), sections },
    deck: { title: str(deck.title, 160) || str(rep.title, 160) || fallback.title, subtitle: str(deck.subtitle, 200), slides },
  };
}

export function normalizeRecommendations(v: unknown): Recommendation[] {
  return arr(v, 10, (x, i) =>
    x && typeof x === "object" && str((x as any).text)
      ? {
          id: str((x as any).id, 20) || `r${i + 1}`,
          type: (["improve-project", "improve-report", "add-section", "add-visual"].includes((x as any).type) ? (x as any).type : "other") as Recommendation["type"],
          text: str((x as any).text, 400),
          impact: (["high", "medium", "low"].includes((x as any).impact) ? (x as any).impact : "medium") as Recommendation["impact"],
        }
      : null
  );
}
