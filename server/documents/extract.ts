/**
 * Universal document extraction: turn (almost) any uploaded file into text the AI can read.
 *
 * `extractDocumentText` in rag-engine.ts already handles PDF, DOCX, XLSX/CSV and notebooks. This module
 * adds everything else and is called from that function, so every upload path (projects, knowledge base,
 * studio) gains the same coverage:
 *
 *   Office      pptx, odt, odp, ods, rtf, epub, legacy doc/xls/ppt (best effort, flagged)
 *   Web/markup  html, htm, xml, svg, tex, md, rst, org
 *   Data        json, jsonl, yaml, toml, ini, csv, tsv, log, sql, srt, vtt, ics, vcf
 *   Code        any text-like source file
 *   Archives    zip (nested supported files, with zip-bomb limits)
 *   Images      png, jpg, gif, webp, bmp, tiff (dimensions only; no OCR)
 *
 * Nothing here executes content. Every archive read is bounded in entries and bytes.
 */
import path from "path";
import AdmZip from "adm-zip";
import { htmlToText } from "../agent/safe-fetch.js";

export interface ExtraExtraction {
  text: string;
  kind: string;
  warnings?: string[];
}

const MAX_TEXT = 3_000_000;
const MAX_ZIP_ENTRIES = 300;
const MAX_ZIP_BYTES = 80 * 1024 * 1024;

export const UPLOAD_ACCEPT = [
  ".pdf", ".doc", ".docx", ".odt", ".rtf", ".txt", ".md", ".markdown", ".rst", ".tex", ".epub",
  ".ppt", ".pptx", ".odp", ".xls", ".xlsx", ".ods", ".csv", ".tsv",
  ".json", ".jsonl", ".xml", ".yaml", ".yml", ".toml", ".ini", ".env.example", ".log", ".sql",
  ".html", ".htm", ".css", ".svg", ".srt", ".vtt", ".ics", ".vcf", ".ipynb",
  ".zip", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff",
  ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".go", ".rs", ".rb", ".php",
  ".swift", ".kt", ".dart", ".r", ".sh", ".bat", ".ps1", ".lua", ".scala", ".vue", ".svelte",
];

const TEXT_EXT = new Set([
  ".txt", ".md", ".markdown", ".rst", ".org", ".tex", ".bib", ".csv", ".tsv", ".json", ".jsonl", ".ndjson", ".yaml", ".yml",
  ".toml", ".ini", ".cfg", ".conf", ".properties", ".log", ".sql", ".css", ".scss", ".less", ".srt", ".vtt", ".ics", ".vcf",
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".java", ".c", ".h", ".cpp", ".hpp", ".cc", ".cs", ".go", ".rs", ".rb",
  ".php", ".swift", ".kt", ".dart", ".r", ".sh", ".bash", ".zsh", ".bat", ".cmd", ".ps1", ".lua", ".scala", ".vue", ".svelte",
  ".gradle", ".make", ".mk", ".dockerfile", ".env", ".gitignore", ".editorconfig", ".tf", ".proto", ".graphql", ".gql",
]);

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".avif", ".ico"]);

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n\n[... truncated ...]` : text;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Looks like text? (no NUL bytes in the first 8 KB, mostly valid UTF-8) */
export function looksLikeText(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  let odd = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) return false;
    if (b < 7 || (b > 13 && b < 32 && b !== 27)) odd++;
  }
  return odd / Math.max(1, n) < 0.05;
}

function openZip(buf: Buffer): AdmZip {
  const zip = new AdmZip(buf);
  const entries = zip.getEntries();
  if (entries.length > MAX_ZIP_ENTRIES * 4) throw new Error("Archive has too many entries");
  let total = 0;
  for (const e of entries) {
    total += e.header.size;
    if (total > MAX_ZIP_BYTES) throw new Error("Archive expands to more than the allowed size");
  }
  return zip;
}

function entryText(zip: AdmZip, name: string): string {
  const e = zip.getEntry(name);
  return e ? e.getData().toString("utf8") : "";
}

// --- formats -----------------------------------------------------------------------------------

function pptx(buf: Buffer): ExtraExtraction {
  const zip = openZip(buf);
  const slides = zip
    .getEntries()
    .map((e) => ({ name: e.entryName, m: /^ppt\/slides\/slide(\d+)\.xml$/.exec(e.entryName) }))
    .filter((x) => x.m)
    .sort((a, b) => Number(a.m![1]) - Number(b.m![1]));
  const out: string[] = [];
  for (const s of slides) {
    const xml = entryText(zip, s.name);
    const paras = xml.split(/<\/a:p>/).map((p) => [...p.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1])).join(""));
    const body = paras.map((p) => p.trim()).filter(Boolean);
    const notes = decodeNotes(entryText(zip, `ppt/notesSlides/notesSlide${s.m![1]}.xml`));
    out.push(`## Slide ${s.m![1]}\n${body.join("\n")}${notes ? `\n\n_Speaker notes:_ ${notes}` : ""}`);
  }
  return { kind: "PowerPoint presentation", text: out.join("\n\n") || "(no text found in slides)" };
}

function decodeNotes(xml: string): string {
  return [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1])).join(" ").replace(/\s+/g, " ").trim();
}

function openDocument(buf: Buffer, label: string): ExtraExtraction {
  const zip = openZip(buf);
  const xml = entryText(zip, "content.xml");
  if (!xml) throw new Error("content.xml missing");
  const text = decodeXmlEntities(
    xml
      .replace(/<text:(h|p)[^>]*>/g, "\n")
      .replace(/<\/text:(h|p)>/g, "\n")
      .replace(/<text:tab\/>/g, "\t")
      .replace(/<text:line-break\/>/g, "\n")
      .replace(/<table:table-row[^>]*>/g, "\n")
      .replace(/<\/table:table-cell>/g, "\t")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { kind: label, text };
}

function rtf(buf: Buffer): ExtraExtraction {
  let s = buf.toString("latin1");
  s = s
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
    .replace(/\{\\\*[^{}]*\}/g, "")
    .replace(/\\(par|line)\b ?/g, "\n")
    .replace(/\\tab\b ?/g, "\t")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "");
  return { kind: "Rich Text", text: s.replace(/\n{3,}/g, "\n\n").trim() };
}

function epub(buf: Buffer): ExtraExtraction {
  const zip = openZip(buf);
  const pages = zip
    .getEntries()
    .filter((e) => /\.(x?html?)$/i.test(e.entryName) && !/nav\.x?html?$/i.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
  const text = pages.map((e) => htmlToText(e.getData().toString("utf8"))).filter(Boolean).join("\n\n");
  return { kind: "EPUB book", text };
}

/** Pull printable runs out of legacy OLE binaries (.doc/.xls/.ppt). Honest about the limits. */
function legacyBinary(buf: Buffer, kind: string): ExtraExtraction {
  const utf16: string[] = [];
  let run = "";
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const code = buf.readUInt16LE(i);
    if ((code >= 32 && code < 0xd800) || code === 9 || code === 10 || code === 13) run += String.fromCharCode(code);
    else {
      if (run.length >= 6) utf16.push(run);
      run = "";
    }
  }
  if (run.length >= 6) utf16.push(run);
  const ascii = buf.toString("latin1").match(/[\x20-\x7e\r\n\t]{12,}/g) || [];
  const best = utf16.join("\n").length > ascii.join("\n").length ? utf16 : ascii;
  const text = best.join("\n").replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    kind: `${kind} (legacy binary)`,
    text,
    warnings: ["Legacy binary Office format: text was recovered heuristically and may be incomplete or contain noise. Save as DOCX/XLSX/PPTX or PDF for best results."],
  };
}

async function image(buf: Buffer, ext: string, name: string): Promise<ExtraExtraction> {
  let dims = "";
  try {
    const sharp = (await import("sharp")).default;
    const m = await sharp(buf).metadata();
    dims = m.width && m.height ? `${m.width}x${m.height}px ${m.format}` : String(m.format || "");
  } catch {
    /* sharp optional */
  }
  return {
    kind: "Image",
    text: `[Image: ${name}${dims ? `, ${dims}` : ""}. Text inside images is not read automatically (no OCR); describe it in your prompt or use a vision-capable model.]`,
    warnings: ["No OCR: image text is not extracted."],
  };
}

async function zip(buf: Buffer, depth: number): Promise<ExtraExtraction> {
  const z = openZip(buf);
  const parts: string[] = [];
  const warnings: string[] = [];
  let used = 0;
  for (const e of z.getEntries()) {
    if (e.isDirectory || used >= MAX_ZIP_ENTRIES) continue;
    if (/(^|\/)(node_modules|\.git|__MACOSX|dist|build)\//.test(e.entryName)) continue;
    const ext = path.extname(e.entryName).toLowerCase();
    if (!UPLOAD_ACCEPT.includes(ext) && !TEXT_EXT.has(ext) && ext !== "") continue;
    if (e.header.size > 5 * 1024 * 1024) { warnings.push(`Skipped large entry ${e.entryName}`); continue; }
    used++;
    const data = e.getData();
    let text = "";
    if (depth < 1 && ext === ".zip") text = (await zip(data, depth + 1)).text;
    else {
      const r = await extractExtra(e.entryName, data, depth + 1);
      text = r ? r.text : data.toString("utf8");
    }
    if (text.trim()) parts.push(`### ${e.entryName}\n${text.slice(0, 60_000)}`);
  }
  return { kind: "ZIP archive", text: parts.join("\n\n") || "(no readable files inside the archive)", warnings };
}

// --- entry point -------------------------------------------------------------------------------

/**
 * Extract text from formats the core extractor does not handle. Returns null when the file should fall
 * back to plain UTF-8 decoding by the caller.
 */
export async function extractExtra(filename: string, buf: Buffer, depth = 0): Promise<ExtraExtraction | null> {
  const ext = path.extname(filename || "").toLowerCase();
  const base = path.basename(filename || "").toLowerCase();
  try {
    switch (ext) {
      case ".pptx": return pptx(buf);
      case ".odt": return openDocument(buf, "OpenDocument text");
      case ".odp": return openDocument(buf, "OpenDocument presentation");
      case ".ods": return openDocument(buf, "OpenDocument spreadsheet");
      case ".rtf": return rtf(buf);
      case ".epub": return epub(buf);
      case ".doc": return legacyBinary(buf, "Word document");
      case ".xls": return legacyBinary(buf, "Excel workbook");
      case ".ppt": return legacyBinary(buf, "PowerPoint presentation");
      case ".zip": return depth > 1 ? null : await zip(buf, depth);
      case ".html": case ".htm": case ".xhtml": return { kind: "HTML", text: htmlToText(buf.toString("utf8")) };
      case ".svg": return { kind: "SVG", text: buf.toString("utf8") };
      case ".xml": return { kind: "XML", text: buf.toString("utf8") };
      default: break;
    }
    if (IMAGE_EXT.has(ext)) return await image(buf, ext, path.basename(filename));
    if (TEXT_EXT.has(ext) || /^(dockerfile|makefile|readme|license|procfile)$/.test(base)) return { kind: "Text/source", text: buf.toString("utf8") };
    if ([".mp3", ".wav", ".mp4", ".mov", ".avi", ".mkv", ".m4a", ".flac", ".ogg"].includes(ext)) {
      return { kind: "Media", text: `[Media file ${path.basename(filename)}: audio/video is not transcribed.]`, warnings: ["Audio/video is not transcribed."] };
    }
    if ([".7z", ".rar", ".tar", ".gz", ".tgz", ".bz2", ".xz"].includes(ext)) {
      return { kind: "Archive", text: `[Archive ${path.basename(filename)}: this archive type cannot be unpacked here. Upload it as a .zip.]`, warnings: ["Unsupported archive type; use .zip."] };
    }
    if (ext && !looksLikeText(buf)) {
      return { kind: "Binary", text: `[Binary file ${path.basename(filename)} (${buf.length} bytes): not a readable document type.]`, warnings: ["Unreadable binary file."] };
    }
  } catch (err: any) {
    return { kind: "Unreadable", text: "", warnings: [`Could not read ${path.basename(filename)}: ${String(err?.message || err).slice(0, 200)}`] };
  }
  return null;
}

export async function extractAny(filename: string, buf: Buffer): Promise<ExtraExtraction> {
  const extra = await extractExtra(filename, buf);
  if (extra) return { ...extra, text: clip(extra.text) };
  return { kind: "Text", text: clip(buf.toString("utf8")) };
}
