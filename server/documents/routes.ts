/**
 * Document endpoints (signed-in users only):
 *
 *   GET  /api/documents/formats   what can be uploaded and exported
 *   POST /api/documents/extract   multipart "files"  -> text of each file
 *   POST /api/documents/export    {title, markdown | blocks, format | formats[]} -> file (or .zip for several)
 *   POST /api/documents/convert   multipart "file" + ?to=pdf|docx|... -> converted file
 */
import AdmZip from "adm-zip";
import multer from "multer";
import path from "path";
import type { Express, Request, Response } from "express";
import { MAX_UPLOAD_SIZE_BYTES, MAX_UPLOAD_SIZE_MB } from "../upload-config.js";
import { UPLOAD_ACCEPT } from "./extract.js";
import { EXPORT_FORMATS, FORMAT_INFO, exportDocument, isExportFormat, safeFilename, type ExportFormat } from "./export.js";
import { type Block, type DocModel, markdownToDoc } from "./model.js";

export interface DocumentRouteDeps {
  getUserId: (req: Request) => string | null;
  /** Same extractor the knowledge base and project uploads use. */
  extractText: (filename: string, buf: Buffer) => Promise<{ text: string; error?: string }>;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_SIZE_BYTES, files: 20 } });
const MAX_MARKDOWN = 4_000_000;

function sendFile(res: Response, f: { buffer: Buffer; mime: string; filename: string }) {
  res.setHeader("Content-Type", f.mime);
  res.setHeader("Content-Disposition", `attachment; filename="${f.filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(f.buffer);
}

function cleanBlocks(input: unknown): Block[] | null {
  if (!Array.isArray(input)) return null;
  const ok = new Set(["h", "p", "ul", "ol", "code", "table", "quote", "img", "hr", "pagebreak"]);
  const out = input.filter((b) => b && typeof b === "object" && ok.has((b as any).t)).slice(0, 5000) as Block[];
  return out;
}

export function docFromBody(body: any): DocModel | { error: string } {
  const title = String(body?.title || "Document").slice(0, 200);
  if (typeof body?.markdown === "string") {
    if (body.markdown.length > MAX_MARKDOWN) return { error: "Document is too large" };
    const doc = markdownToDoc(body.markdown, title);
    if (body.title) doc.title = title;
    doc.subtitle = body.subtitle ? String(body.subtitle).slice(0, 300) : undefined;
    doc.author = body.author ? String(body.author).slice(0, 120) : undefined;
    doc.date = body.date ? String(body.date).slice(0, 60) : undefined;
    return doc;
  }
  const blocks = cleanBlocks(body?.blocks);
  if (blocks) {
    return { title, subtitle: body.subtitle, author: body.author, date: body.date, blocks };
  }
  return { error: "Provide `markdown` or `blocks`" };
}

export function registerDocumentRoutes(app: Express, deps: DocumentRouteDeps): void {
  const need = (req: Request, res: Response): string | null => {
    const uid = deps.getUserId(req);
    if (!uid) res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    return uid;
  };

  app.get("/api/documents/formats", (req, res) => {
    if (!need(req, res)) return;
    res.json({
      import: { accept: UPLOAD_ACCEPT, maxMB: MAX_UPLOAD_SIZE_MB, notes: ["Images are accepted but not OCR-read.", "Legacy .doc/.xls/.ppt are read heuristically; prefer DOCX/XLSX/PPTX or PDF."] },
      export: EXPORT_FORMATS.map((id) => ({ id, label: FORMAT_INFO[id].label, mime: FORMAT_INFO[id].mime })),
    });
  });

  app.post("/api/documents/extract", upload.array("files", 20), async (req, res) => {
    if (!need(req, res)) return;
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) return res.status(400).json({ error: "No files uploaded" });
    const results = [];
    for (const f of files) {
      const name = path.basename(f.originalname || "file");
      try {
        const r = await deps.extractText(name, f.buffer);
        const text = (r.text || "").slice(0, 600_000);
        results.push({ filename: name, size: f.size, chars: text.length, text, error: r.error });
      } catch (err: any) {
        results.push({ filename: name, size: f.size, chars: 0, text: "", error: String(err?.message || err).slice(0, 200) });
      }
    }
    res.json({ success: true, files: results });
  });

  app.post("/api/documents/export", async (req, res) => {
    if (!need(req, res)) return;
    const doc = docFromBody(req.body);
    if ("error" in doc) return res.status(400).json({ error: doc.error });
    const requested: unknown[] = Array.isArray(req.body?.formats) ? req.body.formats : [req.body?.format ?? "docx"];
    const formats = [...new Set(requested.filter(isExportFormat))] as ExportFormat[];
    if (!formats.length) return res.status(400).json({ error: `format must be one of: ${EXPORT_FORMATS.join(", ")}` });
    try {
      if (formats.length === 1) return sendFile(res, await exportDocument(doc, formats[0]));
      const zip = new AdmZip();
      for (const f of formats) {
        const out = await exportDocument(doc, f);
        zip.addFile(out.filename, out.buffer);
      }
      sendFile(res, { buffer: zip.toBuffer(), mime: "application/zip", filename: safeFilename(`${doc.title}_export`, "zip") });
    } catch (err: any) {
      res.status(500).json({ error: `Export failed: ${String(err?.message || err).slice(0, 200)}` });
    }
  });

  app.post("/api/documents/convert", upload.single("file"), async (req, res) => {
    if (!need(req, res)) return;
    const f = req.file;
    const to = String(req.query.to || req.body?.to || "");
    if (!f) return res.status(400).json({ error: "No file uploaded" });
    if (!isExportFormat(to)) return res.status(400).json({ error: `?to= must be one of: ${EXPORT_FORMATS.join(", ")}` });
    try {
      const name = path.basename(f.originalname || "document");
      const r = await deps.extractText(name, f.buffer);
      if (!r.text) return res.status(422).json({ error: r.error || "No readable text found in this file" });
      const looksMarkdown = /\.(md|markdown)$/i.test(name) || /^#{1,3}\s/m.test(r.text);
      const text = looksMarkdown ? r.text : r.text.split(/\n{2,}/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean).join("\n\n");
      const doc = markdownToDoc(text, name.replace(/\.[^.]+$/, ""));
      doc.title = name.replace(/\.[^.]+$/, "") || doc.title;
      sendFile(res, await exportDocument(doc, to));
    } catch (err: any) {
      res.status(500).json({ error: `Conversion failed: ${String(err?.message || err).slice(0, 200)}` });
    }
  });
}
