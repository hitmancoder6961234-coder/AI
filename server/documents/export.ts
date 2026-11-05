/**
 * Render a DocModel into any of: docx, pdf, pptx, xlsx, odt, rtf, html, md, txt, csv, json.
 * Pure JavaScript (no headless browser, no office suite), so it runs on Render/Docker as-is.
 *
 * PDF note: pdfmake ships Roboto (Latin, Cyrillic, Greek). Scripts such as Devanagari, Arabic or CJK need a
 * different font - use DOCX or HTML for those.
 */
import { createRequire } from "module";
import path from "path";
import AdmZip from "adm-zip";
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, HeadingLevel, ImageRun, LevelFormat, PageBreak,
  PageNumber, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";
import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";
import { type Block, type DocModel, type Run, docToMarkdown, parseInline, stripInline } from "./model.js";

export const EXPORT_FORMATS = ["docx", "pdf", "pptx", "xlsx", "odt", "rtf", "html", "md", "txt", "csv", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const FORMAT_INFO: Record<ExportFormat, { mime: string; label: string }> = {
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word document" },
  pdf: { mime: "application/pdf", label: "PDF" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", label: "PowerPoint" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Excel workbook" },
  odt: { mime: "application/vnd.oasis.opendocument.text", label: "OpenDocument text" },
  rtf: { mime: "application/rtf", label: "Rich Text" },
  html: { mime: "text/html; charset=utf-8", label: "HTML page" },
  md: { mime: "text/markdown; charset=utf-8", label: "Markdown" },
  txt: { mime: "text/plain; charset=utf-8", label: "Plain text" },
  csv: { mime: "text/csv; charset=utf-8", label: "CSV (tables)" },
  json: { mime: "application/json", label: "JSON" },
};

export interface ExportResult {
  buffer: Buffer;
  mime: string;
  ext: ExportFormat;
  filename: string;
}

export function safeFilename(title: string, ext: string): string {
  const base = (title || "document").replace(/[^\p{L}\p{N}._ -]+/gu, "").trim().replace(/\s+/g, "_").slice(0, 80) || "document";
  return `${base}.${ext}`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// --- images ------------------------------------------------------------------------------------

interface LoadedImage {
  data: Buffer;
  type: "png" | "jpg" | "gif" | "bmp";
  width: number;
  height: number;
  dataUri: string;
}

/** Only embedded (data:) images are loaded; remote URLs are never fetched during export. */
async function loadImage(src: string): Promise<LoadedImage | null> {
  const m = /^data:image\/(png|jpe?g|gif|bmp|webp|svg\+xml);base64,(.+)$/i.exec(src);
  if (!m) return null;
  let data = Buffer.from(m[2], "base64");
  if (data.length > 12 * 1024 * 1024) return null;
  try {
    const sharp = (await import("sharp")).default;
    const kind = m[1].toLowerCase();
    // DOCX/PPTX/PDF handle PNG/JPEG reliably: normalise everything else to PNG.
    let type: LoadedImage["type"] = kind === "png" ? "png" : kind.startsWith("jp") ? "jpg" : "png";
    if (kind !== "png" && !kind.startsWith("jp")) data = await sharp(data).png().toBuffer();
    const meta = await sharp(data).metadata();
    const mime = type === "png" ? "image/png" : "image/jpeg";
    return { data, type, width: meta.width || 800, height: meta.height || 450, dataUri: `data:${mime};base64,${data.toString("base64")}` };
  } catch {
    return null;
  }
}

function fit(w: number, h: number, maxW: number, maxH: number): { width: number; height: number } {
  const k = Math.min(maxW / w, maxH / h, 1);
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

// --- DOCX --------------------------------------------------------------------------------------

const INK = "1F2937";
const ACCENT = "2563EB";

function docxRuns(text: string, base: { size?: number; color?: string; bold?: boolean } = {}): (TextRun | ExternalHyperlink)[] {
  return parseInline(text).map((r: Run) => {
    const run = new TextRun({
      text: r.text,
      bold: r.bold || base.bold,
      italics: r.italic,
      font: r.code ? "Consolas" : undefined,
      size: r.code ? 20 : base.size,
      color: r.link ? "0563C1" : base.color,
      underline: r.link ? {} : undefined,
      shading: r.code ? { type: ShadingType.CLEAR, fill: "EEF2F7", color: "auto" } : undefined,
    });
    return r.link ? new ExternalHyperlink({ link: r.link, children: [run] }) : run;
  });
}

async function toDocx(doc: DocModel): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  const headings = doc.blocks.filter((b): b is Extract<Block, { t: "h" }> => b.t === "h" && b.level <= 2);

  // cover
  children.push(new Paragraph({ spacing: { before: 3200 }, children: [] }));
  children.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 240 }, children: [new TextRun({ text: doc.title, bold: true, size: 64, color: INK })] }));
  children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 8 } }, children: [] }));
  if (doc.subtitle) children.push(new Paragraph({ spacing: { before: 240 }, children: [new TextRun({ text: doc.subtitle, size: 30, color: "4B5563" })] }));
  const meta = [doc.author, doc.date].filter(Boolean).join("  |  ");
  if (meta) children.push(new Paragraph({ spacing: { before: 360 }, children: [new TextRun({ text: meta, size: 22, color: "6B7280" })] }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // contents (static list: reliable in Word, LibreOffice and viewers)
  if (headings.length >= 3) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "Contents", bold: true, color: INK })] }));
    for (const h of headings) {
      children.push(new Paragraph({ indent: { left: h.level === 2 ? 480 : 0 }, spacing: { after: 60 }, children: [new TextRun({ text: stripInline(h.text), bold: h.level === 1, size: h.level === 1 ? 24 : 22 })] }));
    }
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  let listInstance = 0;
  const hl = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
  const hsize = [0, 36, 30, 26, 24];

  for (const b of doc.blocks) {
    switch (b.t) {
      case "h":
        children.push(new Paragraph({ heading: hl[b.level], spacing: { before: b.level === 1 ? 360 : 240, after: 120 }, keepNext: true, children: docxRuns(b.text, { size: hsize[b.level], color: b.level === 1 ? ACCENT : INK, bold: true }) }));
        break;
      case "p":
        children.push(new Paragraph({ spacing: { after: 140, line: 300 }, children: docxRuns(b.text) }));
        break;
      case "ul":
        for (const it of b.items) children.push(new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 60 }, children: docxRuns(it) }));
        children.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
        break;
      case "ol": {
        listInstance++;
        for (const it of b.items) children.push(new Paragraph({ numbering: { reference: "numbers", level: 0, instance: listInstance }, spacing: { after: 60 }, children: docxRuns(it) }));
        children.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
        break;
      }
      case "code":
        for (const line of (b.text || " ").split("\n")) {
          children.push(new Paragraph({
            shading: { type: ShadingType.CLEAR, fill: "F3F4F6", color: "auto" },
            spacing: { after: 0 },
            indent: { left: 120, right: 120 },
            children: [new TextRun({ text: line.length ? line : " ", font: "Consolas", size: 18 })],
          }));
        }
        children.push(new Paragraph({ spacing: { after: 140 }, children: [] }));
        break;
      case "quote":
        children.push(new Paragraph({ indent: { left: 480 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 12 } }, spacing: { after: 140 }, children: docxRuns(b.text).map((r) => r) }));
        break;
      case "table": {
        const cols = Math.max(1, b.header.length);
        const cell = (t: string, head: boolean) =>
          new TableCell({
            width: { size: Math.floor(100 / cols), type: WidthType.PERCENTAGE },
            margins: { top: 70, bottom: 70, left: 110, right: 110 },
            shading: head ? { type: ShadingType.CLEAR, fill: INK, color: "auto" } : undefined,
            children: [new Paragraph({ children: docxRuns(t, head ? { bold: true, color: "FFFFFF", size: 20 } : { size: 20 }) })],
          });
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ tableHeader: true, children: b.header.map((h) => cell(h, true)) }), ...b.rows.map((r) => new TableRow({ children: r.map((c) => cell(c, false)) }))] }));
        children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
        break;
      }
      case "img": {
        const img = await loadImage(b.src);
        if (!img) { children.push(new Paragraph({ children: [new TextRun({ text: `[Image: ${b.alt || "figure"}]`, italics: true, color: "6B7280" })] })); break; }
        const size = fit(img.width, img.height, 560, 380);
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, keepNext: true, children: [new ImageRun({ type: img.type, data: img.data, transformation: size, altText: { title: b.alt || "figure", description: b.caption || b.alt || "figure", name: "figure" } })] }));
        if (b.caption) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 180 }, children: [new TextRun({ text: b.caption, italics: true, size: 20, color: "6B7280" })] }));
        break;
      }
      case "hr":
        children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "D1D5DB", space: 4 } }, spacing: { after: 160 }, children: [] }));
        break;
      case "pagebreak":
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
    }
  }

  const document = new Document({
    creator: doc.author || "Darkness AI",
    title: doc.title,
    description: doc.subtitle || "",
    styles: { default: { document: { run: { font: "Calibri", size: 22, color: "111827" } } } },
    numbering: {
      config: [
        { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        { reference: "numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1300, bottom: 1300, left: 1300, right: 1300 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "6B7280" })] })] }) },
      children,
    }],
  });
  return Buffer.from(await Packer.toBuffer(document));
}

// --- PDF (pdfmake) -----------------------------------------------------------------------------

let pdfEngine: any = null;
function getPdfEngine(): any {
  if (pdfEngine) return pdfEngine;
  const req = createRequire(import.meta.url);
  const pdfmake = req("pdfmake");
  const dir = path.join(path.dirname(req.resolve("pdfmake/package.json")), "fonts", "Roboto");
  pdfmake.addFonts({
    Roboto: {
      normal: path.join(dir, "Roboto-Regular.ttf"),
      bold: path.join(dir, "Roboto-Medium.ttf"),
      italics: path.join(dir, "Roboto-Italic.ttf"),
      bolditalics: path.join(dir, "Roboto-MediumItalic.ttf"),
    },
  });
  pdfEngine = pdfmake;
  return pdfEngine;
}

function pdfText(text: string, extra: Record<string, unknown> = {}): any[] {
  return parseInline(text).map((r) => ({
    text: r.text,
    bold: r.bold || extra.bold,
    italics: r.italic,
    fontSize: r.code ? 9.5 : extra.fontSize,
    background: r.code ? "#EEF2F7" : undefined,
    color: r.link ? "#0563C1" : extra.color,
    link: r.link,
    decoration: r.link ? "underline" : undefined,
  }));
}

async function toPdf(doc: DocModel): Promise<Buffer> {
  const content: any[] = [];
  content.push({ text: doc.title, fontSize: 30, bold: true, color: "#1F2937", margin: [0, 180, 0, 10] });
  content.push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: 160, y2: 0, lineWidth: 3, lineColor: "#2563EB" }], margin: [0, 0, 0, 14] });
  if (doc.subtitle) content.push({ text: doc.subtitle, fontSize: 15, color: "#4B5563", margin: [0, 0, 0, 14] });
  const meta = [doc.author, doc.date].filter(Boolean).join("   |   ");
  if (meta) content.push({ text: meta, fontSize: 11, color: "#6B7280" });
  content.push({ text: "", pageBreak: "after" });

  const toc = doc.blocks.filter((b): b is Extract<Block, { t: "h" }> => b.t === "h" && b.level <= 2);
  if (toc.length >= 3) {
    content.push({ text: "Contents", fontSize: 20, bold: true, color: "#1F2937", margin: [0, 0, 0, 10] });
    for (const h of toc) content.push({ text: stripInline(h.text), bold: h.level === 1, fontSize: h.level === 1 ? 12 : 11, margin: [h.level === 2 ? 16 : 0, 0, 0, 4] });
    content.push({ text: "", pageBreak: "after" });
  }

  const hsize = [0, 21, 16.5, 14, 12.5];
  for (const b of doc.blocks) {
    switch (b.t) {
      case "h": content.push({ text: pdfText(b.text, { bold: true, color: b.level === 1 ? "#2563EB" : "#1F2937" }), fontSize: hsize[b.level], margin: [0, b.level === 1 ? 16 : 10, 0, 6], keepWithNext: true } as any); break;
      case "p": content.push({ text: pdfText(b.text), fontSize: 10.5, lineHeight: 1.35, margin: [0, 0, 0, 7] }); break;
      case "ul": content.push({ ul: b.items.map((i) => ({ text: pdfText(i) })), fontSize: 10.5, margin: [4, 0, 0, 8] }); break;
      case "ol": content.push({ ol: b.items.map((i) => ({ text: pdfText(i) })), fontSize: 10.5, margin: [4, 0, 0, 8] }); break;
      case "code": content.push({ table: { widths: ["*"], body: [[{ text: b.text || " ", fontSize: 8.5, preserveLeadingSpaces: true }]] }, layout: { fillColor: () => "#F3F4F6", hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 }, margin: [0, 0, 0, 9] }); break;
      case "quote": content.push({ table: { widths: ["*"], body: [[{ text: pdfText(b.text), italics: true, fontSize: 10.5, color: "#374151" }]] }, layout: { hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 3 : 0), vLineColor: () => "#2563EB", paddingLeft: () => 10 }, margin: [6, 0, 0, 9] }); break;
      case "table": {
        const head = b.header.map((h) => ({ text: stripInline(h), bold: true, color: "#FFFFFF", fillColor: "#1F2937", fontSize: 9.5 }));
        const rows = b.rows.map((r) => r.map((c) => ({ text: pdfText(c), fontSize: 9.5 })));
        content.push({ table: { headerRows: 1, widths: b.header.map(() => "*"), body: [head, ...rows] }, layout: { hLineColor: () => "#E5E7EB", vLineColor: () => "#E5E7EB", paddingTop: () => 4, paddingBottom: () => 4 }, margin: [0, 0, 0, 10] });
        break;
      }
      case "img": {
        const img = await loadImage(b.src);
        if (!img) { content.push({ text: `[Image: ${b.alt || "figure"}]`, italics: true, color: "#6B7280", margin: [0, 0, 0, 8] }); break; }
        const size = fit(img.width, img.height, 460, 330);
        content.push({ image: img.dataUri, width: size.width, alignment: "center", margin: [0, 6, 0, b.caption ? 3 : 10] });
        if (b.caption) content.push({ text: b.caption, italics: true, fontSize: 9, color: "#6B7280", alignment: "center", margin: [0, 0, 0, 10] });
        break;
      }
      case "hr": content.push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.7, lineColor: "#D1D5DB" }], margin: [0, 4, 0, 10] }); break;
      case "pagebreak": content.push({ text: "", pageBreak: "after" }); break;
    }
  }

  const def = {
    info: { title: doc.title, author: doc.author || "Darkness AI", subject: doc.subtitle || "" },
    pageSize: "A4",
    pageMargins: [40, 50, 40, 55],
    defaultStyle: { font: "Roboto", fontSize: 10.5, color: "#111827" },
    footer: (page: number, count: number) => (page === 1 ? null : { text: `${page} / ${count}`, alignment: "center", fontSize: 8.5, color: "#6B7280", margin: [0, 18, 0, 0] }),
    content,
  };
  const out = await getPdfEngine().createPdf(def).getBuffer();
  return Buffer.from(out);
}

// --- PPTX (generic documents; the Studio has a richer deck renderer) -----------------------------

async function toPptx(doc: DocModel): Promise<Buffer> {
  const pptx = new (PptxGenJS as any)();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = doc.title;
  pptx.author = doc.author || "Darkness AI";
  const W = 13.33;
  const title = pptx.addSlide();
  title.background = { color: "0B1020" };
  title.addText(doc.title, { x: 0.8, y: 2.3, w: W - 1.6, h: 1.6, fontSize: 40, bold: true, color: "FFFFFF", fontFace: "Calibri" });
  title.addShape("rect" as any, { x: 0.8, y: 3.95, w: 2.2, h: 0.07, fill: { color: "38BDF8" }, line: { color: "38BDF8" } });
  if (doc.subtitle) title.addText(doc.subtitle, { x: 0.8, y: 4.15, w: W - 1.6, h: 0.8, fontSize: 20, color: "A5B4D6", fontFace: "Calibri" });
  const meta = [doc.author, doc.date].filter(Boolean).join("  |  ");
  if (meta) title.addText(meta, { x: 0.8, y: 6.5, w: W - 1.6, h: 0.4, fontSize: 12, color: "7C8DB5" });

  const section = (heading: string) => {
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    s.addShape("rect" as any, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: "2563EB" }, line: { color: "2563EB" } });
    s.addText(heading, { x: 0.6, y: 0.35, w: W - 1.2, h: 0.9, fontSize: 28, bold: true, color: "1F2937", fontFace: "Calibri", fit: "shrink" });
    return s;
  };

  let current = section(doc.title);
  let bullets: string[] = [];
  let heading = doc.title;
  let slideNo = 0;
  const flushBullets = () => {
    if (!bullets.length) return;
    for (let i = 0; i < bullets.length; i += 7) {
      const s = i === 0 ? current : section(`${heading} (cont.)`);
      s.addText(bullets.slice(i, i + 7).map((t) => ({ text: stripInline(t), options: { bullet: true, breakLine: true } })), { x: 0.7, y: 1.5, w: W - 1.4, h: 5.3, fontSize: 18, color: "111827", valign: "top", fontFace: "Calibri", paraSpaceAfter: 8 });
    }
    bullets = [];
  };

  for (const b of doc.blocks) {
    if (b.t === "h" && b.level <= 2) {
      flushBullets();
      heading = stripInline(b.text);
      current = section(heading);
      slideNo++;
    } else if (b.t === "h") bullets.push(`**${b.text}**`);
    else if (b.t === "p") bullets.push(b.text.length > 260 ? b.text.slice(0, 257) + "..." : b.text);
    else if (b.t === "ul" || b.t === "ol") bullets.push(...b.items);
    else if (b.t === "quote") bullets.push(`"${b.text}"`);
    else if (b.t === "table") {
      flushBullets();
      const s = section(`${heading}`);
      const rows = [b.header.map((h) => ({ text: stripInline(h), options: { bold: true, color: "FFFFFF", fill: { color: "1F2937" } } })), ...b.rows.slice(0, 12).map((r) => r.map((c) => ({ text: stripInline(c) })))];
      s.addTable(rows as any, { x: 0.6, y: 1.5, w: W - 1.2, fontSize: 12, border: { type: "solid", color: "E5E7EB", pt: 0.75 }, autoPage: false });
    } else if (b.t === "img") {
      flushBullets();
      const img = await loadImage(b.src);
      if (img) {
        const s = section(b.caption || heading);
        const size = fit(img.width, img.height, 11.5, 5.4);
        const k = 96;
        s.addImage({ data: img.dataUri, x: (W - size.width / k * 1) / 2 > 0 ? (W - size.width / k) / 2 : 0.5, y: 1.5, w: size.width / k, h: size.height / k });
      }
    } else if (b.t === "code") {
      flushBullets();
      const s = section(heading);
      s.addText(b.text.split("\n").slice(0, 18).join("\n"), { x: 0.7, y: 1.5, w: W - 1.4, h: 5.2, fontSize: 12, fontFace: "Consolas", color: "111827", fill: { color: "F3F4F6" }, valign: "top" });
    }
  }
  flushBullets();
  void slideNo;
  const out = await pptx.write({ outputType: "nodebuffer" } as any);
  return Buffer.from(out as any);
}

// --- XLSX / CSV --------------------------------------------------------------------------------

function tablesOf(doc: DocModel): Array<{ name: string; header: string[]; rows: string[][] }> {
  const out: Array<{ name: string; header: string[]; rows: string[][] }> = [];
  let heading = "Table";
  for (const b of doc.blocks) {
    if (b.t === "h") heading = stripInline(b.text);
    if (b.t === "table") out.push({ name: heading, header: b.header.map(stripInline), rows: b.rows.map((r) => r.map(stripInline)) });
  }
  return out;
}

async function toXlsx(doc: DocModel): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = doc.author || "Darkness AI";
  wb.title = doc.title;
  const used = new Set<string>();
  const sheetName = (raw: string) => {
    let n = raw.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "Sheet";
    let k = 1;
    const base = n;
    while (used.has(n.toLowerCase())) n = `${base.slice(0, 25)}_${++k}`;
    used.add(n.toLowerCase());
    return n;
  };
  const tables = tablesOf(doc);
  tables.forEach((t) => {
    const ws = wb.addWorksheet(sheetName(t.name));
    ws.addRow(t.header);
    t.rows.forEach((r) => ws.addRow(r));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, t.header.length) } };
    t.header.forEach((h, i) => {
      const widest = Math.max(h.length, ...t.rows.map((r) => (r[i] || "").length));
      ws.getColumn(i + 1).width = Math.min(60, Math.max(10, widest + 2));
    });
  });
  const ws = wb.addWorksheet(sheetName(tables.length ? "Document" : "Content"), { views: [{ showGridLines: false }] });
  ws.columns = [{ header: "Type", key: "t", width: 12 }, { header: "Content", key: "c", width: 120 }];
  ws.getRow(1).font = { bold: true };
  ws.addRow({ t: "Title", c: doc.title });
  for (const b of doc.blocks) {
    if (b.t === "h") ws.addRow({ t: `Heading ${b.level}`, c: stripInline(b.text) });
    else if (b.t === "p" || b.t === "quote") ws.addRow({ t: b.t === "p" ? "Text" : "Quote", c: stripInline(b.text) });
    else if (b.t === "ul" || b.t === "ol") b.items.forEach((i) => ws.addRow({ t: "List", c: stripInline(i) }));
    else if (b.t === "code") ws.addRow({ t: "Code", c: b.text });
  }
  ws.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function toCsv(doc: DocModel): Buffer {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const tables = tablesOf(doc);
  let rows: string[][];
  if (tables.length) {
    rows = [];
    tables.forEach((t, i) => {
      if (tables.length > 1) rows.push([`# ${t.name}`]);
      rows.push(t.header, ...t.rows);
      if (i < tables.length - 1) rows.push([]);
    });
  } else {
    rows = [["Type", "Content"], ["Title", doc.title]];
    for (const b of doc.blocks) {
      if (b.t === "h") rows.push([`Heading ${b.level}`, stripInline(b.text)]);
      else if (b.t === "p") rows.push(["Text", stripInline(b.text)]);
      else if (b.t === "ul" || b.t === "ol") b.items.forEach((i) => rows.push(["List", stripInline(i)]));
    }
  }
  return Buffer.from("﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n"), "utf8");
}

// --- ODT ---------------------------------------------------------------------------------------

function odtInline(text: string): string {
  return parseInline(text)
    .map((r) => {
      const t = esc(r.text);
      if (r.bold && r.italic) return `<text:span text:style-name="BI">${t}</text:span>`;
      if (r.bold) return `<text:span text:style-name="B">${t}</text:span>`;
      if (r.italic) return `<text:span text:style-name="I">${t}</text:span>`;
      if (r.code) return `<text:span text:style-name="C">${t}</text:span>`;
      if (r.link) return `<text:a xlink:type="simple" xlink:href="${esc(r.link)}">${t}</text:a>`;
      return t;
    })
    .join("");
}

function toOdt(doc: DocModel): Buffer {
  const body: string[] = [];
  body.push(`<text:p text:style-name="Title">${esc(doc.title)}</text:p>`);
  if (doc.subtitle) body.push(`<text:p text:style-name="Subtitle">${esc(doc.subtitle)}</text:p>`);
  for (const b of doc.blocks) {
    if (b.t === "h") body.push(`<text:h text:outline-level="${b.level}" text:style-name="Heading_20_${b.level}">${odtInline(b.text)}</text:h>`);
    else if (b.t === "p") body.push(`<text:p>${odtInline(b.text)}</text:p>`);
    else if (b.t === "quote") body.push(`<text:p text:style-name="Quote">${odtInline(b.text)}</text:p>`);
    else if (b.t === "code") b.text.split("\n").forEach((l) => body.push(`<text:p text:style-name="Code">${esc(l) || " "}</text:p>`));
    else if (b.t === "ul" || b.t === "ol") body.push(`<text:list>${b.items.map((i, n) => `<text:list-item><text:p>${b.t === "ol" ? `${n + 1}. ` : "• "}${odtInline(i)}</text:p></text:list-item>`).join("")}</text:list>`);
    else if (b.t === "table") {
      const row = (cells: string[], head = false) => `<table:table-row>${cells.map((c) => `<table:table-cell office:value-type="string"><text:p${head ? ' text:style-name="B0"' : ""}>${odtInline(c)}</text:p></table:table-cell>`).join("")}</table:table-row>`;
      body.push(`<table:table table:name="T${body.length}"><table:table-column table:number-columns-repeated="${b.header.length}"/>${row(b.header, true)}${b.rows.map((r) => row(r)).join("")}</table:table>`);
    } else if (b.t === "hr") body.push(`<text:p>———</text:p>`);
    else if (b.t === "img") body.push(`<text:p text:style-name="Caption">[Image: ${esc(b.alt || b.caption || "figure")}]</text:p>`);
  }
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.2">
<office:automatic-styles>
<style:style style:name="B" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="I" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="BI" style:family="text"><style:text-properties fo:font-weight="bold" fo:font-style="italic"/></style:style>
<style:style style:name="C" style:family="text"><style:text-properties style:font-name="Courier New" fo:font-family="Courier New"/></style:style>
<style:style style:name="B0" style:family="paragraph"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="Title" style:family="paragraph"><style:text-properties fo:font-size="26pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Subtitle" style:family="paragraph"><style:text-properties fo:font-size="15pt" fo:color="#4B5563"/></style:style>
<style:style style:name="Quote" style:family="paragraph"><style:paragraph-properties fo:margin-left="0.6cm"/><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="Code" style:family="paragraph"><style:paragraph-properties fo:background-color="#f3f4f6"/><style:text-properties style:font-name="Courier New" fo:font-family="Courier New" fo:font-size="9pt"/></style:style>
<style:style style:name="Caption" style:family="paragraph"><style:text-properties fo:font-style="italic" fo:color="#6b7280"/></style:style>
<style:style style:name="Heading_20_1" style:family="paragraph"><style:text-properties fo:font-size="18pt" fo:font-weight="bold" fo:color="#2563eb"/></style:style>
<style:style style:name="Heading_20_2" style:family="paragraph"><style:text-properties fo:font-size="14pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading_20_3" style:family="paragraph"><style:text-properties fo:font-size="12pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading_20_4" style:family="paragraph"><style:text-properties fo:font-size="11pt" fo:font-weight="bold"/></style:style>
</office:automatic-styles>
<office:body><office:text>${body.join("")}</office:text></office:body>
</office:document-content>`;
  const zip = new AdmZip();
  zip.addFile("mimetype", Buffer.from("application/vnd.oasis.opendocument.text"));
  zip.addFile("META-INF/manifest.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`));
  zip.addFile("content.xml", Buffer.from(content, "utf8"));
  const mt = zip.getEntry("mimetype");
  if (mt) mt.header.method = 0; // ODF requires the mimetype entry stored, not deflated
  return zip.toBuffer();
}

// --- RTF ---------------------------------------------------------------------------------------

function rtfEscape(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "\\" || ch === "{" || ch === "}") out += "\\" + ch;
    else if (c > 127) out += `\\u${c > 32767 ? c - 65536 : c}?`;
    else out += ch;
  }
  return out;
}

function rtfInline(text: string): string {
  return parseInline(text).map((r) => {
    const t = rtfEscape(r.text);
    if (r.bold) return `{\\b ${t}}`;
    if (r.italic) return `{\\i ${t}}`;
    if (r.code) return `{\\f1 ${t}}`;
    return t;
  }).join("");
}

function toRtf(doc: DocModel): Buffer {
  const out: string[] = ["{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}{\\f1 Consolas;}}\\fs22"];
  out.push(`\\pard\\sa200{\\b\\fs52 ${rtfEscape(doc.title)}}\\par`);
  if (doc.subtitle) out.push(`\\pard\\sa200{\\fs28 ${rtfEscape(doc.subtitle)}}\\par`);
  const sizes = [0, 36, 30, 26, 24];
  for (const b of doc.blocks) {
    if (b.t === "h") out.push(`\\pard\\sb240\\sa120{\\b\\fs${sizes[b.level]} ${rtfInline(b.text)}}\\par`);
    else if (b.t === "p") out.push(`\\pard\\sa140 ${rtfInline(b.text)}\\par`);
    else if (b.t === "quote") out.push(`\\pard\\li480\\sa140{\\i ${rtfInline(b.text)}}\\par`);
    else if (b.t === "code") b.text.split("\n").forEach((l) => out.push(`\\pard{\\f1\\fs18 ${rtfEscape(l)}}\\par`));
    else if (b.t === "ul") b.items.forEach((i) => out.push(`\\pard\\li360\\fi-360\\sa60\\bullet\\tab ${rtfInline(i)}\\par`));
    else if (b.t === "ol") b.items.forEach((i, n) => out.push(`\\pard\\li360\\fi-360\\sa60 ${n + 1}.\\tab ${rtfInline(i)}\\par`));
    else if (b.t === "table") {
      out.push(`\\pard{\\b ${b.header.map(rtfEscape).join("\\tab ")}}\\par`);
      b.rows.forEach((r) => out.push(`\\pard ${r.map((c) => rtfEscape(stripInline(c))).join("\\tab ")}\\par`));
    } else if (b.t === "hr") out.push("\\pard\\brdrb\\brdrs\\brdrw10\\par");
    else if (b.t === "img") out.push(`\\pard{\\i [Image: ${rtfEscape(b.alt || b.caption || "figure")}]}\\par`);
  }
  out.push("}");
  return Buffer.from(out.join("\n"), "latin1");
}

// --- HTML / MD / TXT / JSON ------------------------------------------------------------------

function htmlInline(text: string): string {
  return parseInline(text).map((r) => {
    let t = esc(r.text);
    if (r.code) t = `<code>${t}</code>`;
    if (r.bold) t = `<strong>${t}</strong>`;
    if (r.italic) t = `<em>${t}</em>`;
    if (r.link) t = `<a href="${esc(r.link)}" rel="noopener noreferrer">${t}</a>`;
    return t;
  }).join("");
}

function toHtml(doc: DocModel): Buffer {
  const parts: string[] = [];
  for (const b of doc.blocks) {
    switch (b.t) {
      case "h": parts.push(`<h${b.level}>${htmlInline(b.text)}</h${b.level}>`); break;
      case "p": parts.push(`<p>${htmlInline(b.text)}</p>`); break;
      case "ul": parts.push(`<ul>${b.items.map((i) => `<li>${htmlInline(i)}</li>`).join("")}</ul>`); break;
      case "ol": parts.push(`<ol>${b.items.map((i) => `<li>${htmlInline(i)}</li>`).join("")}</ol>`); break;
      case "code": parts.push(`<pre><code>${esc(b.text)}</code></pre>`); break;
      case "quote": parts.push(`<blockquote>${htmlInline(b.text)}</blockquote>`); break;
      case "table": parts.push(`<div class="tw"><table><thead><tr>${b.header.map((h) => `<th>${htmlInline(h)}</th>`).join("")}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${htmlInline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`); break;
      case "img": if (b.src.startsWith("data:image/")) parts.push(`<figure><img alt="${esc(b.alt || "")}" src="${b.src}">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`); break;
      case "hr": parts.push("<hr>"); break;
      case "pagebreak": parts.push('<div class="pb"></div>'); break;
    }
  }
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(doc.title)}</title>
<style>
:root{--ink:#111827;--muted:#6b7280;--accent:#2563eb;--line:#e5e7eb}
*{box-sizing:border-box}body{margin:0;background:#f3f4f6;color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:860px;margin:32px auto;background:#fff;padding:56px 64px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.08)}
header{border-bottom:3px solid var(--accent);padding-bottom:20px;margin-bottom:28px}header h1{font-size:2.3rem;line-height:1.15;margin:0 0 8px}
header p{margin:4px 0;color:var(--muted)}h1,h2,h3,h4{line-height:1.25}h2{color:var(--accent);margin-top:2.2rem}
code{background:#eef2f7;padding:.1em .35em;border-radius:4px;font:.88em ui-monospace,Consolas,monospace}
pre{background:#f3f4f6;padding:14px 16px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}
blockquote{margin:1rem 0;padding:.2rem 1rem;border-left:4px solid var(--accent);color:#374151;background:#f8fafc}
.tw{overflow:auto}table{border-collapse:collapse;width:100%;font-size:.94rem}th{background:#1f2937;color:#fff;text-align:left}
th,td{border:1px solid var(--line);padding:8px 12px;vertical-align:top}figure{margin:1.5rem 0;text-align:center}figure img{max-width:100%;border-radius:8px}
figcaption{color:var(--muted);font-size:.9rem;margin-top:6px}hr{border:0;border-top:1px solid var(--line);margin:2rem 0}.pb{break-after:page}
@media print{body{background:#fff}main{box-shadow:none;margin:0;padding:0;max-width:none}h2{break-after:avoid}pre,table,figure{break-inside:avoid}}
@media (max-width:640px){main{padding:28px 20px;margin:0;border-radius:0}}
</style></head><body><main>
<header><h1>${esc(doc.title)}</h1>${doc.subtitle ? `<p>${esc(doc.subtitle)}</p>` : ""}${[doc.author, doc.date].filter(Boolean).length ? `<p>${esc([doc.author, doc.date].filter(Boolean).join(" · "))}</p>` : ""}</header>
${parts.join("\n")}
</main></body></html>`;
  return Buffer.from(html, "utf8");
}

function toPlain(doc: DocModel): string {
  return docToMarkdown(doc)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "[$1]")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1");
}

// --- entry point -------------------------------------------------------------------------------

export function isExportFormat(v: unknown): v is ExportFormat {
  return typeof v === "string" && (EXPORT_FORMATS as readonly string[]).includes(v);
}

export async function exportDocument(doc: DocModel, format: ExportFormat): Promise<ExportResult> {
  let buffer: Buffer;
  switch (format) {
    case "docx": buffer = await toDocx(doc); break;
    case "pdf": buffer = await toPdf(doc); break;
    case "pptx": buffer = await toPptx(doc); break;
    case "xlsx": buffer = await toXlsx(doc); break;
    case "odt": buffer = toOdt(doc); break;
    case "rtf": buffer = toRtf(doc); break;
    case "html": buffer = toHtml(doc); break;
    case "csv": buffer = toCsv(doc); break;
    case "md": buffer = Buffer.from(docToMarkdown(doc), "utf8"); break;
    case "txt": buffer = Buffer.from(toPlain(doc), "utf8"); break;
    case "json": buffer = Buffer.from(JSON.stringify(doc, null, 2), "utf8"); break;
    default: throw new Error(`Unsupported export format: ${String(format)}`);
  }
  return { buffer, mime: FORMAT_INFO[format].mime, ext: format, filename: safeFilename(doc.title, format) };
}
