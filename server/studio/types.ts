/** Shared shapes for the Project Studio (project -> brief -> outline -> report + deck + images). */

export type LengthSetting = "concise" | "standard" | "detailed";
export type DeckTheme = "midnight" | "clean" | "crimson" | "ocean";
export type GuidanceMode = "inbuilt" | "custom";

export interface GuidanceChoice {
  mode: GuidanceMode;
  /** Only used when mode === "custom". Replaces the editable guidance layer; the output contract still applies. */
  text?: string;
}

export interface StudioOptions {
  audience: string; // e.g. "college examiners", "hiring manager", "client"
  purpose: string; // e.g. "final year project report", "portfolio", "case study"
  tone: "formal" | "plain" | "persuasive";
  length: LengthSetting;
  language: string; // output language, e.g. "English"
  author?: string;
  institution?: string;
  guidance: { report: GuidanceChoice; deck: GuidanceChoice; image: GuidanceChoice };
}

export interface BriefQuestion {
  id: string;
  question: string;
  why: string;
  options: string[];
  default: string;
}

export interface Recommendation {
  id: string;
  type: "improve-project" | "improve-report" | "add-section" | "add-visual" | "other";
  text: string;
  impact: "high" | "medium" | "low";
}

export interface Brief {
  title: string;
  oneLiner: string;
  projectType: string;
  audience: string;
  summary: string;
  problem: string;
  solution: string;
  keyFeatures: Array<{ name: string; what: string; evidence: string[] }>;
  architecture: string;
  techStack: Array<{ layer: string; technology: string; why: string }>;
  strengths: string[];
  risksOrGaps: string[];
  questions: BriefQuestion[];
  recommendations: Recommendation[];
  /** "ai" when a model wrote it, "offline" when it was derived from static analysis only. */
  source: "ai" | "offline";
}

export type SectionKind =
  | "abstract" | "introduction" | "objectives" | "requirements" | "tech-stack" | "architecture" | "data-design"
  | "api" | "implementation" | "testing" | "security" | "results" | "limitations" | "future-work" | "conclusion"
  | "references" | "appendix-run" | "other";

export type VisualKind = "none" | "image" | "diagram" | "table" | "code";

export interface OutlineSection {
  id: string;
  kind: SectionKind;
  title: string;
  purpose: string;
  keyPoints: string[];
  visual: VisualKind;
  imageIdea?: string;
}

export interface OutlineSlide {
  id: string;
  title: string; // a headline that states the takeaway
  message: string;
  bullets: string[];
  visual: { kind: VisualKind; idea?: string };
  notes: string;
}

export interface Outline {
  report: { title: string; subtitle: string; sections: OutlineSection[] };
  deck: { title: string; subtitle: string; slides: OutlineSlide[] };
}

export interface ExtraImage {
  words: string;
  caption?: string;
}

export interface ProjectContext {
  id: string;
  name: string;
  description?: string;
  idea?: string;
  files: Array<{ path: string; content: string; size?: number; isBinary?: boolean }>;
  analysis?: any;
}

export interface GeneratedImage {
  id: string;
  caption: string;
  prompt: string;
  mimeType: string;
  base64: string;
  width?: number;
  height?: number;
  source: "ai" | "diagram" | "placeholder";
}
