/**
 * PowerPoint renderer for the Studio. Pure JavaScript (pptxgenjs); no office suite or browser needed.
 *
 * Slide types: title, content (bullets + optional visual), table, code, closing. Every content slide carries
 * speaker notes. Four themes mirror the app's atmospheres.
 */
import PptxGenJS from "pptxgenjs";
import type { DeckTheme, GeneratedImage, OutlineSlide } from "./types.js";

export interface ThemeSpec {
  id: DeckTheme;
  name: string;
  bg: string;
  panel: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  headFont: string;
  bodyFont: string;
  palette: string; // words, used for image prompts
}

export const THEMES: Record<DeckTheme, ThemeSpec> = {
  midnight: { id: "midnight", name: "Midnight", bg: "0B1020", panel: "141B34", text: "F1F5F9", muted: "94A3B8", accent: "38BDF8", accent2: "A78BFA", headFont: "Calibri", bodyFont: "Calibri", palette: "deep navy background with electric cyan and violet accents" },
  clean: { id: "clean", name: "Clean", bg: "FFFFFF", panel: "F3F4F6", text: "111827", muted: "6B7280", accent: "2563EB", accent2: "0EA5E9", headFont: "Calibri", bodyFont: "Calibri", palette: "white background with confident blue accents and light grey shapes" },
  crimson: { id: "crimson", name: "Crimson", bg: "12030A", panel: "2A0A12", text: "FFF1F2", muted: "E3A6AD", accent: "F43F5E", accent2: "FB923C", headFont: "Calibri", bodyFont: "Calibri", palette: "near-black background with crimson and ember-orange accents" },
  ocean: { id: "ocean", name: "Ocean", bg: "031632", panel: "06284F", text: "EAF6FF", muted: "96BFE0", accent: "38BDF8", accent2: "22D3EE", headFont: "Calibri", bodyFont: "Calibri", palette: "deep ocean blue background with aqua and teal highlights" },
};

export interface DeckInput {
  theme: DeckTheme;
  title: string;
  subtitle?: string;
  author?: string;
  institution?: string;
  date?: string;
  footer?: string;
  slides: OutlineSlide[];
  images: Record<string, GeneratedImage>; // by slide id
  tables: Record<string, string[][]>; // first row = header
  codes: Record<string, string>;
}

const W = 13.333;
const H = 7.5;

function placeImage(slide: any, img: GeneratedImage, box: { x: number; y: number; w: number; h: number }) {
  const iw = img.width || 1280;
  const ih = img.height || 720;
  const k = Math.min(box.w / iw, box.h / ih);
  const w = iw * k;
  const h = ih * k;
  slide.addImage({ data: `${img.mimeType};base64,${img.base64}`, x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h, altText: img.caption });
}

export async function renderDeck(input: DeckInput): Promise<Buffer> {
  const t = THEMES[input.theme] || THEMES.midnight;
  const pptx = new (PptxGenJS as any)();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = input.title;
  pptx.author = input.author || "Darkness AI";
  pptx.company = input.institution || "";

  const base = (): any => {
    const s = pptx.addSlide();
    s.background = { color: t.bg };
    return s;
  };
  const chrome = (s: any, n: number) => {
    s.addShape("rect" as any, { x: 0, y: 0, w: 0.16, h: H, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
    if (input.footer) s.addText(input.footer, { x: 0.6, y: H - 0.5, w: 8, h: 0.3, fontSize: 10, color: t.muted, fontFace: t.bodyFont });
    s.addText(String(n), { x: W - 1.1, y: H - 0.5, w: 0.6, h: 0.3, fontSize: 10, color: t.muted, align: "right", fontFace: t.bodyFont });
  };

  input.slides.forEach((slide, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === input.slides.length - 1 && /question|thank/i.test(slide.title + slide.message);
    const s = base();
    const img = input.images[slide.id];

    if (isFirst) {
      s.addShape("rect" as any, { x: 0, y: 0, w: W, h: H, fill: { color: t.bg }, line: { color: t.bg, width: 0 } });
      s.addShape("rect" as any, { x: 0.8, y: 3.95, w: 2.4, h: 0.08, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
      s.addText(input.title, { x: 0.8, y: 1.9, w: img ? 6.6 : W - 1.6, h: 2.0, fontSize: input.title.length > 40 ? 34 : 42, bold: true, color: t.text, fontFace: t.headFont, valign: "bottom" });
      s.addText(input.subtitle || slide.message || "", { x: 0.8, y: 4.2, w: img ? 6.6 : W - 1.6, h: 1.0, fontSize: 18, color: t.muted, fontFace: t.bodyFont, valign: "top" });
      const meta = [input.author, input.institution, input.date].filter(Boolean).join("   |   ");
      if (meta) s.addText(meta, { x: 0.8, y: 6.4, w: W - 1.6, h: 0.4, fontSize: 13, color: t.muted, fontFace: t.bodyFont });
      if (img) placeImage(s, img, { x: 7.8, y: 0.9, w: 4.9, h: 5.7 });
    } else if (isLast) {
      s.addShape("rect" as any, { x: W / 2 - 1.2, y: 4.1, w: 2.4, h: 0.08, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
      s.addText(slide.title, { x: 1, y: 2.3, w: W - 2, h: 1.6, fontSize: 46, bold: true, color: t.text, align: "center", fontFace: t.headFont, valign: "middle" });
      if (slide.message) s.addText(slide.message, { x: 1, y: 4.4, w: W - 2, h: 0.8, fontSize: 20, color: t.muted, align: "center", fontFace: t.bodyFont });
    } else {
      chrome(s, idx + 1);
      s.addText(slide.title, { x: 0.6, y: 0.35, w: W - 1.2, h: 1.1, fontSize: slide.title.length > 70 ? 24 : 30, bold: true, color: t.text, fontFace: t.headFont, valign: "middle" });
      s.addShape("rect" as any, { x: 0.6, y: 1.48, w: 1.2, h: 0.06, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });

      const kind = slide.visual.kind;
      const table = input.tables[slide.id];
      const code = input.codes[slide.id];
      const hasVisual = (kind === "image" || kind === "diagram") && Boolean(img);
      const bullets = slide.bullets.slice(0, 6);
      const textW = hasVisual ? 5.9 : W - 1.4;

      if (kind === "table" && table && table.length > 1) {
        const rows = table.slice(0, 11).map((r, ri) => r.map((c) => ({ text: String(c).slice(0, 70), options: ri === 0 ? { bold: true, color: t.bg, fill: { color: t.accent } } : { color: t.text, fill: { color: ri % 2 ? t.panel : t.bg } } })));
        if (bullets.length) s.addText(bullets.slice(0, 2).map((b) => ({ text: b, options: { bullet: true, breakLine: true } })), { x: 0.6, y: 1.75, w: W - 1.4, h: 0.9, fontSize: 16, color: t.text, fontFace: t.bodyFont, valign: "top" });
        s.addTable(rows as any, { x: 0.6, y: bullets.length ? 2.75 : 1.8, w: W - 1.4, fontSize: 12, fontFace: t.bodyFont, border: { type: "solid", color: t.muted, pt: 0.5 }, autoPage: false, colW: Array(table[0].length).fill((W - 1.4) / table[0].length) });
      } else if (kind === "code" && code) {
        if (bullets.length) s.addText(bullets.slice(0, 2).map((b) => ({ text: b, options: { bullet: true, breakLine: true } })), { x: 0.6, y: 1.75, w: W - 1.4, h: 0.9, fontSize: 16, color: t.text, fontFace: t.bodyFont, valign: "top" });
        s.addText(code.split("\n").slice(0, 16).join("\n"), { x: 0.6, y: bullets.length ? 2.75 : 1.8, w: W - 1.4, h: bullets.length ? 3.9 : 4.9, fontSize: 12, fontFace: "Consolas", color: t.text, fill: { color: t.panel }, valign: "top", margin: 12 });
      } else {
        const size = bullets.length <= 3 ? 22 : bullets.length === 4 ? 20 : 18;
        if (bullets.length) {
          s.addText(bullets.map((b) => ({ text: b, options: { bullet: { indent: 18 }, breakLine: true } })), { x: 0.6, y: 1.8, w: textW, h: 4.8, fontSize: size, color: t.text, fontFace: t.bodyFont, valign: "top", paraSpaceAfter: 12 });
        } else if (slide.message) {
          s.addText(slide.message, { x: 0.6, y: 1.9, w: textW, h: 4.6, fontSize: 24, color: t.text, fontFace: t.bodyFont, valign: "top" });
        }
        if (hasVisual && img) placeImage(s, img, { x: 6.8, y: 1.75, w: W - 7.4, h: 4.9 });
      }
    }
    if (slide.notes) s.addNotes(slide.notes);
  });

  const out = await pptx.write({ outputType: "nodebuffer" } as any);
  return Buffer.from(out as any);
}
