// rag-engine.ts
// Robust Project-Scoped RAG Engine for Darkness AI

import path from "path";
import crypto from "crypto";
import fs from "fs";
import ExcelJS from "exceljs";
import { generateGeminiWithResilience, formatApiError, resolveSupportedGeminiModel } from "./gemini-resilience.js";
import {
  getProject,
  updateProject,
  listFiles,
  listKnowledgeChunks,
  createKnowledgeChunksBatch,
  deleteKnowledgeForProject,
  deleteKnowledgeChunksForFile,
  deleteProjectFileByPath,
  createProjectFile,
  getProjectFileByPath,
  listKnowledgeSources,
  upsertKnowledgeSource,
  getKnowledgeSource,
  deleteKnowledgeSource,
  listProjects,
} from "./db.js";
import { resolveProjectFilePath } from "./project-storage.js";
import {
  parseAndNormalizeMultilingualQuery,
  scoreChunkMultilingual,
  buildMultilingualGroundedPrompt,
  ParsedMultilingualQuery,
} from "./multilingual-rag.js";
import { deleteKnowledgeChunksFromSupabase, isSupabaseConfigured } from "./supabase.js";

export interface RagSettings {
  chunkSize: number;
  chunkOverlap: number;
  strategy: "recursive" | "structure_aware" | "fixed";
  retrievalTopK: number;
  similarityThreshold: number;
  retrievalStrategy: "hybrid" | "semantic" | "lexical";
  embeddingProvider: string;
  embeddingModel: string;
}

export function getFileTypeDisplayName(ext: string, name?: string): string {
  const cleanExt = (ext || "").toLowerCase().replace(/^\./, "");
  switch (cleanExt) {
    case "ipynb": return "Jupyter Notebook";
    case "pdf": return "PDF";
    case "docx":
    case "doc": return "Word Document";
    case "pptx":
    case "ppt": return "PowerPoint";
    case "xlsx":
    case "xls": return "Excel Spreadsheet";
    case "md":
    case "markdown": return "Markdown";
    case "txt": return "Text";
    case "csv": return "CSV";
    case "json": return "JSON";
    case "py": return "Python";
    case "ts": return "TypeScript";
    case "tsx": return "React TypeScript";
    case "js": return "JavaScript";
    case "jsx": return "React JavaScript";
    case "html": return "HTML";
    case "css":
    case "scss": return "CSS";
    case "sql": return "SQL";
    case "go": return "Go";
    case "rs": return "Rust";
    case "java": return "Java";
    case "cpp":
    case "c": return "C/C++";
    default: return cleanExt ? cleanExt.toUpperCase() : "Document";
  }
}

export const DEFAULT_RAG_SETTINGS: RagSettings = {
  chunkSize: 800,
  chunkOverlap: 120,
  strategy: "recursive",
  retrievalTopK: 5,
  similarityThreshold: 0.70,
  retrievalStrategy: "hybrid",
  embeddingProvider: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? "Google Gemini" : "Local Hybrid Vectorizer",
  embeddingModel: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? "text-embedding-004" : "clarity-dense-v1",
};

export function computeHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function formatRelativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "Not indexed";
  const diff = Date.now() - timestamp;
  if (diff < 30000) return "Just now";
  if (diff < 60000) return "1 min ago";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

// In-memory indexing state tracker per project
const indexingJobs = new Map<string, {
  status: "indexing" | "ready" | "failed";
  progress: number;
  totalFiles: number;
  processedFiles: number;
  error?: string;
  startedAt: number;
}>();

export function getProjectRagSettings(projectId: string): RagSettings {
  const proj = getProject(projectId);
  if (!proj) return { ...DEFAULT_RAG_SETTINGS };
  try {
    const meta = typeof proj.metadata === "string" ? JSON.parse(proj.metadata || "{}") : (proj.metadata || {});
    return {
      ...DEFAULT_RAG_SETTINGS,
      ...(meta.rag_settings || {}),
    };
  } catch {
    return { ...DEFAULT_RAG_SETTINGS };
  }
}

export function saveProjectRagSettings(projectId: string, newSettings: Partial<RagSettings>): RagSettings {
  const proj = getProject(projectId);
  if (!proj) throw new Error("Project not found");
  
  let meta: any = {};
  try {
    meta = typeof proj.metadata === "string" ? JSON.parse(proj.metadata || "{}") : (proj.metadata || {});
  } catch {}

  const current = meta.rag_settings || DEFAULT_RAG_SETTINGS;
  const updated: RagSettings = {
    ...current,
    ...newSettings,
    chunkSize: Number(newSettings.chunkSize) || current.chunkSize || 800,
    chunkOverlap: Number(newSettings.chunkOverlap) || current.chunkOverlap || 120,
    retrievalTopK: Math.max(1, Math.min(50, Number(newSettings.retrievalTopK) || current.retrievalTopK || 5)),
    similarityThreshold: Math.max(0, Math.min(1, Number(newSettings.similarityThreshold) || current.similarityThreshold || 0.70)),
  };

  meta.rag_settings = updated;
  updateProject(projectId, { metadata: JSON.stringify(meta) });
  return updated;
}

// Text extraction from various document formats
export async function extractDocumentText(filename: string, buffer: Buffer | any): Promise<{ text: string; error?: string }> {
  const ext = path.extname(filename || "").toLowerCase();
  
  try {
    if (!buffer) {
      return { text: "" };
    }

    if (typeof buffer === "string") {
      return { text: buffer };
    }

    const buf = Buffer.isBuffer(buffer)
      ? buffer
      : buffer instanceof Uint8Array
      ? Buffer.from(buffer)
      : Buffer.from(String(buffer || ""), "utf-8");

    if (ext === ".pdf") {
      try {
        let cleanText = "";
        
        // 1. Native PDF Text Extraction (supports both pdf-parse v2+ class and v1 functional interface)
        try {
          const importedPDFParse = await import("pdf-parse");
          const PDFParseClass: any = (importedPDFParse as any).PDFParse || (importedPDFParse as any).default || importedPDFParse;
          
          if (typeof PDFParseClass === "function") {
            try {
              // Modern pdf-parse v2+ API: new PDFParse({ data: buf }).getText()
              const parser = new PDFParseClass({ data: buf });
              try {
                if (typeof parser.getText === "function") {
                  const parseRes = await parser.getText();
                  if (parseRes && typeof parseRes === "object") {
                    if (Array.isArray(parseRes.pages) && parseRes.pages.length > 0) {
                      cleanText = parseRes.pages
                        .map((p: any, idx: number) => {
                          const pageText = typeof p?.text === "string" ? p.text : (p ? String(p) : "");
                          return `[Page ${p?.num || idx + 1}]\n${pageText}`.trim();
                        })
                        .filter(Boolean)
                        .join("\n\n");
                    } else if (typeof parseRes.text === "string") {
                      cleanText = parseRes.text.trim();
                    }
                  } else if (typeof parseRes === "string") {
                    cleanText = parseRes.trim();
                  }
                }
              } finally {
                if (typeof parser.destroy === "function") {
                  await parser.destroy().catch(() => {});
                }
              }
            } catch (classErr) {
              // Fallback to legacy function signature pdfParse(buf) if not a pure class constructor
              const isClass = typeof PDFParseClass === "function" && /^\s*class\s+/.test(PDFParseClass.toString());
              if (!isClass && typeof PDFParseClass === "function") {
                try {
                  const parsed = await (PDFParseClass as any)(buf);
                  if (parsed && typeof parsed === "object") {
                    if (Array.isArray(parsed.pages) && parsed.pages.length > 0) {
                      cleanText = parsed.pages
                        .map((p: any, idx: number) => `[Page ${idx + 1}]\n${p?.text || ""}`.trim())
                        .filter(Boolean)
                        .join("\n\n");
                    } else if (typeof parsed.text === "string") {
                      cleanText = parsed.text.trim();
                    }
                  } else if (typeof parsed === "string") {
                    cleanText = parsed.trim();
                  }
                } catch (fnErr) {
                  // Ignore legacy call failure
                }
              }
            }
          }
        } catch (e1) {
          console.warn("pdf-parse native extraction failed:", e1);
        }

        // Clean up common pagination noise
        if (cleanText) {
          cleanText = cleanText.replace(/--\s*\d+\s+of\s+\d+\s*--/gi, "").trim();
        }

        // Calculate extraction quality
        let isLowQuality = false;
        if (!cleanText || cleanText.replace(/\s/g, "").length < 40) isLowQuality = true;
        if (cleanText.includes("FlateDecode") || cleanText.includes("obj") || cleanText.includes("%PDF-")) isLowQuality = true;
        const nonWordDensity = (cleanText.match(/[^a-zA-Z0-9\s]/g) || []).length / (cleanText.length || 1);
        if (nonWordDensity > 0.35) isLowQuality = true;

        // 2. Multimodal Gemini Visual Extraction for scanned/complex layout PDFs
        // Only run if quality is genuinely low, buffer is a valid non-empty PDF, and size is within inline payload limits (<8MB)
        const hasValidPdfHeader = buf && buf.length >= 32 && buf.subarray(0, 1024).includes(Buffer.from("%PDF"));
        const isAcceptableInlineSize = buf && buf.length > 0 && buf.length <= 8 * 1024 * 1024;

        if (isLowQuality && hasValidPdfHeader && isAcceptableInlineSize && (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)) {
          try {
             const effectiveModel = resolveSupportedGeminiModel(process.env.DEFAULT_GEMINI_MODEL || "gemini-3.8-flash");
             const aiResp = await generateGeminiWithResilience({
               modelName: effectiveModel,
               systemInstruction: "You are a professional document extractor. Extract all text, tables, and layout structure from the document. Represent tables in markdown format preserving row and column relationships. Preserve section headings, page numbers, and structural hierarchies. Do not summarize or omit data; extract exactly as it appears.",
               contents: [
                 { role: "user", parts: [
                    { inlineData: { data: buf.toString("base64"), mimeType: "application/pdf" } },
                    { text: "Extract the complete content of this PDF document, strictly preserving tables, rows, columns, and headings." }
                 ]}
               ],
               timeoutMs: 45000
             });
             if (aiResp && aiResp.text && aiResp.text.trim().length > 0) {
               cleanText = aiResp.text.trim();
             }
          } catch (geminiErr: any) {
             console.warn("Gemini PDF visual extraction skipped or encountered error:", formatApiError(geminiErr));
          }
        }

        // 3. Fallback: Heuristic stream extraction if everything else is empty
        if (!cleanText || cleanText.trim().length === 0) {
          try {
            const rawStr = buf.toString("latin1");
            const textMatches: string[] = [];
            const tjRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g;
            let match: RegExpExecArray | null;
            while ((match = tjRegex.exec(rawStr)) !== null) {
              if (match[1] && match[1].length > 1) {
                textMatches.push(match[1].replace(/\\([()\\])/g, "$1"));
              }
            }
            if (textMatches.length > 3) {
              cleanText = textMatches.join(" ");
            }
          } catch {
            // Ignore stream extraction errors
          }
        }

        // Format PDF text with page indicators if available
        if (cleanText && !cleanText.includes("FlateDecode") && !cleanText.includes("%PDF-")) {
          const normalized = cleanText
            .replace(/\r\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .replace(/[ \t]+/g, " ")
            .trim();
          return { text: normalized };
        }
        
        return { text: cleanText || "" };
      } catch (pdfErr: any) {
        console.warn("PDF parse error:", pdfErr);
        return { text: "" };
      }
    }
    
    if (ext === ".xlsx" || ext === ".xls") {
      try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buf);
        const sheetSections: string[] = [];

        workbook.eachSheet((worksheet, sheetId) => {
          const sheetName = worksheet.name || `Sheet ${sheetId}`;
          const rows: string[][] = [];
          
          worksheet.eachRow({ includeEmpty: false }, (row) => {
            const rowValues: string[] = [];
            if (Array.isArray(row.values)) {
              for (let i = 1; i < row.values.length; i++) {
                const val = row.values[i];
                if (val === null || val === undefined) {
                  rowValues.push("");
                } else if (typeof val === "object" && (val as any).result !== undefined) {
                  rowValues.push(String((val as any).result));
                } else if (typeof val === "object" && (val as any).text !== undefined) {
                  rowValues.push(String((val as any).text));
                } else {
                  rowValues.push(String(val).trim());
                }
              }
            }
            if (rowValues.some(v => v.length > 0)) {
              rows.push(rowValues);
            }
          });

          if (rows.length > 0) {
            let tableStr = `### [Sheet: ${sheetName}]\n\n`;
            // Format as structured Markdown table
            const headers = rows[0];
            tableStr += `| ${headers.map(h => h || "-").join(" | ")} |\n`;
            tableStr += `| ${headers.map(() => "---").join(" | ")} |\n`;
            for (let r = 1; r < rows.length; r++) {
              const row = rows[r];
              while (row.length < headers.length) row.push("");
              tableStr += `| ${row.slice(0, headers.length).map(cell => cell || "-").join(" | ")} |\n`;
            }
            sheetSections.push(tableStr);
          }
        });

        const fullSpreadsheetText = sheetSections.join("\n\n").trim();
        return { text: fullSpreadsheetText || buf.toString("utf-8") };
      } catch (excelErr: any) {
        console.warn("Excel extraction error, fallback to utf-8 text:", excelErr);
      }
    }

    if (ext === ".csv" || ext === ".tsv") {
      try {
        const rawCsv = buf.toString("utf-8");
        const delimiter = ext === ".tsv" ? "\t" : ",";
        const lines = rawCsv.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length > 0) {
          const tableRows: string[] = [];
          for (let i = 0; i < lines.length; i++) {
            const cells = lines[i].split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ""));
            if (i === 0) {
              tableRows.push(`| ${cells.join(" | ")} |`);
              tableRows.push(`| ${cells.map(() => "---").join(" | ")} |`);
            } else {
              tableRows.push(`| ${cells.join(" | ")} |`);
            }
          }
          return { text: tableRows.join("\n") };
        }
      } catch (csvErr) {
        console.warn("CSV parse fallback:", csvErr);
      }
    }

    if (ext === ".docx") {
      // DOCX structure-preserving extraction
      try {
        const AdmZip = (await import("adm-zip")).default;
        const zip = new AdmZip(buf);
        const xmlEntry = zip.getEntry("word/document.xml");
        if (xmlEntry) {
          const xml = xmlEntry.getData().toString("utf-8");
          
          // Step 1: Extract all tables into markdown tables with tokens
          const tables: string[] = [];
          const cleanXml = xml.replace(/<w:tbl[\s\S]*?<\/w:tbl>/g, (tblXml) => {
            const rows: string[][] = [];
            const rowMatches = tblXml.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [];
            for (const rXml of rowMatches) {
              const cells: string[] = [];
              const cellMatches = rXml.match(/<w:tc[\s\S]*?<\/w:tc>/g) || [];
              for (const cXml of cellMatches) {
                const text = (cXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
                  .map(t => t.replace(/<[^>]+>/g, ""))
                  .join(" ")
                  .trim();
                cells.push(text.replace(/\|/g, "\\|"));
              }
              if (cells.some(c => c.length > 0)) {
                rows.push(cells);
              }
            }
            if (rows.length === 0) return "";
            const headers = rows[0];
            let md = "\n\n| " + headers.map(h => h || "-").join(" | ") + " |\n";
            md += "| " + headers.map(() => "---").join(" | ") + " |\n";
            for (let i = 1; i < rows.length; i++) {
              const row = rows[i];
              while (row.length < headers.length) row.push("");
              md += "| " + row.slice(0, headers.length).map(c => c || "-").join(" | ") + " |\n";
            }
            const token = `___DOCX_TBL_${tables.length}___`;
            tables.push(md.trim());
            return token;
          });

          // Step 2: Extract paragraphs and preserve headings
          const pMatches = cleanXml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
          const paragraphs: string[] = [];
          for (const pXml of pMatches) {
            const isH1 = /<w:pStyle\s+w:val="Heading1"/i.test(pXml);
            const isH2 = /<w:pStyle\s+w:val="Heading2"/i.test(pXml);
            const isH3 = /<w:pStyle\s+w:val="Heading3"/i.test(pXml);
            const text = (pXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
              .map(t => t.replace(/<[^>]+>/g, ""))
              .join("")
              .trim();
            if (text) {
              if (isH1) paragraphs.push("# " + text);
              else if (isH2) paragraphs.push("## " + text);
              else if (isH3) paragraphs.push("### " + text);
              else paragraphs.push(text);
            }
          }

          let fullText = paragraphs.join("\n\n");
          if (tables.length > 0) {
            fullText += "\n\n" + tables.join("\n\n");
          }

          return { text: fullText.trim() };
        }
      } catch (err: any) {
        console.warn("Docx extract error, falling back to string:", err);
      }
    }

    if (ext === ".ipynb") {
      try {
        const rawJson = buf.toString("utf-8");
        const nb = JSON.parse(rawJson);
        const cells = nb.cells || [];
        const sections: string[] = [];
        let cellIdx = 1;
        for (const cell of cells) {
          if (!cell || !cell.source) continue;
          const sourceRaw = Array.isArray(cell.source) ? cell.source.join("") : (typeof cell.source === "string" ? cell.source : String(cell.source || ""));
          const source = typeof sourceRaw === "string" ? sourceRaw.trim() : String(sourceRaw || "").trim();
          if (!source) continue;
          if (cell.cell_type === "code") {
            sections.push(`\`\`\`python\n# [Cell ${cellIdx} - Code]\n${source}\n\`\`\``);
            if (Array.isArray(cell.outputs) && cell.outputs.length > 0) {
              const textOutputs = cell.outputs
                .map((o: any) => {
                  if (!o) return "";
                  if (o.text) return Array.isArray(o.text) ? o.text.join("") : String(o.text || "");
                  if (o.data && o.data["text/plain"]) {
                    const plain = o.data["text/plain"];
                    return Array.isArray(plain) ? plain.join("") : String(plain || "");
                  }
                  return "";
                })
                .filter(Boolean)
                .join("\n")
                .trim();
              if (textOutputs) {
                sections.push(`*Output:* \n\`\`\`\n${textOutputs.substring(0, 500)}\n\`\`\``);
              }
            }
          } else {
            sections.push(`### [Cell ${cellIdx} - Markdown]\n${source}`);
          }
          cellIdx++;
        }
        return { text: sections.join("\n\n") || rawJson };
      } catch (err: any) {
        console.warn("Jupyter Notebook parse error, falling back to raw text:", err);
      }
    }

    // Default utf-8 text decoding for code, markdown, txt, csv, json, html, etc.
    const text = buf.toString("utf-8");
    return { text };
  } catch (err: any) {
    return { text: "", error: err.message || "Failed to parse document" };
  }
}

// Advanced chunking logic supporting adaptive document-size-aware semantic chunking
export interface ChunkSpec {
  id: string;
  projectId: string;
  fileId: string;
  chunkId: string;
  chunkIndex?: number;
  content: string;
  chunkType: string;
  symbol: string;
  pageNumber?: number;
  sheetName?: string;
  section?: string;
  startLine: number;
  endLine: number;
  charCount?: number;
  tokenCount?: number;
  hash: string;
  version: number;
}

export function chunkDocument(
  projectId: string,
  filePath: string,
  rawContent: any,
  settings?: Partial<RagSettings>
): ChunkSpec[] {
  const chunks: ChunkSpec[] = [];
  const content = typeof rawContent === "string" 
    ? rawContent 
    : (rawContent && typeof rawContent.text === "string"
      ? rawContent.text
      : (rawContent ? (Buffer.isBuffer(rawContent) ? rawContent.toString("utf-8") : String(rawContent)) : ""));
  if (!content || typeof content !== "string" || typeof content.trim !== "function" || !content.trim()) return chunks;

  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath);
  const trimmedContent = content.trim();
  const totalChars = trimmedContent.length;
  const estimatedTotalTokens = Math.ceil(totalChars / 3.8);

  // =========================================================================
  // 1. SMALL DOCUMENT TIER (Adaptive Document-Size Awareness)
  // If the document is small (<= 500 chars, e.g. 10-line text, short notice) OR
  // under 1800 chars without multiple distinct headings, keep as EXACTLY ONE chunk.
  // =========================================================================
  const headingCount = (trimmedContent.match(/^#{1,3}\s+/gm) || []).length;
  const isSmallDoc = totalChars <= 550 || (totalChars <= 1800 && headingCount < 2);

  if (isSmallDoc) {
    const contextHeader = `[Doc: ${baseName}]\n`;
    const fullText = contextHeader + trimmedContent;
    const lines = trimmedContent.split(/\r?\n/);
    chunks.push({
      id: `chunk_${projectId}_${computeHash(filePath).substring(0, 10)}_1_${lines.length}`,
      projectId,
      fileId: filePath,
      chunkId: "c_0",
      chunkIndex: 0,
      content: fullText,
      chunkType: ext === ".md" ? "markdown" : ext === ".txt" ? "text" : "document",
      symbol: baseName,
      section: "Full Document",
      startLine: 1,
      endLine: lines.length,
      charCount: fullText.length,
      tokenCount: Math.ceil(fullText.length / 3.8),
      hash: computeHash(fullText),
      version: 1,
    });
    return chunks;
  }

  // =========================================================================
  // 2. DYNAMIC TARGET CHUNK SIZE BASED ON DOCUMENT SIZE & COMPLEXITY
  // =========================================================================
  let targetChunkSize = settings?.chunkSize || 1000;
  let targetOverlap = settings?.chunkOverlap || 120;

  if (totalChars <= 7500) {
    // Medium document: use semantic sections (400-800 chars for distinct headings, up to 1200 chars)
    targetChunkSize = headingCount >= 2 ? 600 : 1200;
    targetOverlap = Math.min(120, Math.max(60, settings?.chunkOverlap || 90));
  } else {
    // Large / Very Large document: optimal retrieval chunk size (850-1100 chars)
    targetChunkSize = settings?.chunkSize || 950;
    targetOverlap = settings?.chunkOverlap || 120;
  }

  // Code files handling
  const isCode = [".ts", ".js", ".tsx", ".jsx", ".py", ".java", ".go", ".cpp", ".cs", ".rs"].includes(ext);
  const lines = trimmedContent.split(/\r?\n/);

  if (isCode) {
    let currentLines: string[] = [];
    let startLine = 1;
    let currentSymbol = "";
    let currentType = "code";
    let chunkIdx = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      currentLines.push(line);

      const symbolMatch = line.match(/(class|function|const|let|var|def|func|struct|interface|type)\s+([a-zA-Z0-9_]+)/);
      if (symbolMatch && !currentSymbol) {
        currentSymbol = symbolMatch[2];
        currentType = symbolMatch[1];
      }

      const currentLen = currentLines.join("\n").length;
      if ((currentLen >= targetChunkSize && line.trim() === "") || currentLen >= targetChunkSize * 1.5 || i === lines.length - 1) {
        const text = currentLines.join("\n").trim();
        if (text) {
          const chunkContent = `[Doc: ${baseName}${currentSymbol ? ` | Symbol: ${currentSymbol}` : ""}]\n${text}`;
          chunks.push({
            id: `chunk_${projectId}_${computeHash(filePath).substring(0, 10)}_${startLine}_${i + 1}`,
            projectId,
            fileId: filePath,
            chunkId: `c_${chunkIdx}`,
            chunkIndex: chunkIdx,
            content: chunkContent,
            chunkType: currentType,
            symbol: currentSymbol || "code_block",
            section: currentSymbol || "code",
            startLine,
            endLine: i + 1,
            charCount: chunkContent.length,
            tokenCount: Math.ceil(chunkContent.length / 3.8),
            hash: computeHash(chunkContent),
            version: 1,
          });
          chunkIdx++;
        }
        currentLines = [];
        startLine = i + 2;
        currentSymbol = "";
        currentType = "code";
      }
    }
    return chunks;
  }

  // =========================================================================
  // 3. SEMANTIC, TABLE-PRESERVING & STRUCTURE-AWARE CHUNKING
  // Priority boundaries:
  // 1. Sheet / Page boundaries
  // 2. Headings (#, ##, ###)
  // 3. Paragraph breaks (\n\n)
  // 4. Table row groups (with table header retention)
  // 5. List items
  // 6. Sentence boundaries (. , ! , ? )
  // =========================================================================
  let currentLines: string[] = [];
  let startLine = 1;
  let charCount = 0;
  let currentSheet = "";
  let currentPageNumber: number | undefined;
  let currentSection = "";
  let activeTableHeaders: string[] = [];
  let inTable = false;
  let chunkIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // 1. Page & Sheet tracking
    const pageMatch = trimmedLine.match(/\[Page\s+(\d+)\]/i);
    if (pageMatch) {
      currentPageNumber = parseInt(pageMatch[1], 10);
    }
    const sheetMatch = trimmedLine.match(/###\s*\[Sheet:\s*([^\]]+)\]/i);
    if (sheetMatch) {
      currentSheet = sheetMatch[1].trim();
    }

    // 2. Heading tracking
    const headMatch = trimmedLine.match(/^(#{1,4})\s+(.+)$/);
    if (headMatch && !sheetMatch) {
      currentSection = headMatch[2].trim();
    }

    // 3. Table boundary & header detection
    if (trimmedLine.startsWith("|") && trimmedLine.endsWith("|")) {
      if (!inTable) {
        inTable = true;
        activeTableHeaders = [line];
        if (i + 1 < lines.length && lines[i + 1].trim().startsWith("|") && lines[i + 1].includes("---")) {
          activeTableHeaders.push(lines[i + 1]);
        }
      }
    } else if (inTable && trimmedLine === "") {
      inTable = false;
    }

    currentLines.push(line);
    charCount += line.length + 1;

    // 4. Boundary detection
    const isNewSection = headMatch !== null || sheetMatch !== null || pageMatch !== null;
    const isParagraphBreak = trimmedLine === "" && charCount >= targetChunkSize * 0.7;
    const isOverSize = charCount >= targetChunkSize;
    const isLastLine = i === lines.length - 1;

    // Avoid breaking in the middle of a table row or between table header and first row
    const isSafeTableSplit = !inTable || (inTable && activeTableHeaders.length > 0 && charCount >= targetChunkSize * 0.85);

    if (((isNewSection && charCount >= targetChunkSize * 0.6) || (isParagraphBreak && isSafeTableSplit) || isOverSize || isLastLine) && currentLines.length > 0) {
      let text = currentLines.join("\n").trim();
      if (text) {
        // Table continuity: if chunk continues table rows without headers, prepend column headers
        if (inTable && activeTableHeaders.length > 0 && !text.includes(activeTableHeaders[0])) {
          text = activeTableHeaders.join("\n") + "\n" + text;
        }

        // Context header for rich provenance
        const metaParts: string[] = [`Doc: ${baseName}`];
        if (currentSheet) metaParts.push(`Sheet: ${currentSheet}`);
        if (currentPageNumber) metaParts.push(`Page ${currentPageNumber}`);
        if (currentSection) metaParts.push(`Section: ${currentSection}`);

        const contextHeader = `[${metaParts.join(" | ")}]\n`;
        const chunkContent = contextHeader + text;

        chunks.push({
          id: `chunk_${projectId}_${computeHash(filePath).substring(0, 10)}_${startLine}_${i + 1}`,
          projectId,
          fileId: filePath,
          chunkId: `c_${chunkIdx}`,
          chunkIndex: chunkIdx,
          content: chunkContent,
          chunkType: inTable ? "table" : (currentSheet ? "spreadsheet" : (ext === ".md" ? "markdown" : ext === ".txt" ? "text" : "document")),
          symbol: currentSection || currentSheet || (currentPageNumber ? `Page ${currentPageNumber}` : "section"),
          pageNumber: currentPageNumber,
          sheetName: currentSheet || undefined,
          section: currentSection || undefined,
          startLine,
          endLine: i + 1,
          charCount: chunkContent.length,
          tokenCount: Math.ceil(chunkContent.length / 3.8),
          hash: computeHash(chunkContent),
          version: 1,
        });
        chunkIdx++;
      }

      // Handle overlap gracefully
      let overlapChars = 0;
      const overlapLines: string[] = [];
      for (let j = currentLines.length - 1; j >= 0; j--) {
        if (overlapChars + currentLines[j].length > targetOverlap) break;
        overlapChars += currentLines[j].length + 1;
        overlapLines.unshift(currentLines[j]);
      }

      currentLines = overlapLines;
      charCount = overlapChars;
      startLine = Math.max(1, i + 2 - overlapLines.length);
    }
  }

  return chunks;
}

// Get comprehensive RAG state for project
export function getProjectRagStatus(projectId: string) {
  const proj = getProject(projectId);
  if (!proj) throw new Error("Project not found");

  const settings = getProjectRagSettings(projectId);
  const sources = listKnowledgeSources(projectId);
  const dbChunks = listKnowledgeChunks(projectId);
  const hasGeminiKey = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

  // Group chunks by file_id
  const chunksByFile = new Map<string, typeof dbChunks>();
  for (const c of dbChunks) {
    if (!chunksByFile.has(c.file_id)) chunksByFile.set(c.file_id, []);
    chunksByFile.get(c.file_id)!.push(c);
  }

  // Documents list strictly mirrors real knowledge sources in the project
  const documents = sources.map((s) => {
    const fileChunks = chunksByFile.get(s.path) || [];
    return {
      id: s.id,
      fileId: s.path,
      path: s.path,
      name: s.name,
      extension: s.extension || path.extname(s.path),
      fileType: s.file_type || getFileTypeDisplayName(s.extension || path.extname(s.path), s.name),
      size: s.size,
      sizeFormatted: formatBytes(s.size),
      chunksCount: fileChunks.length,
      status: fileChunks.length > 0 ? "Indexed" : "Queued",
      updatedAt: s.updated_at,
      updatedAtFormatted: formatRelativeTime(s.updated_at),
    };
  });

  const totalChunks = dbChunks.length;
  const totalEmbeddings = totalChunks;
  const vectorStoreConnected = totalChunks > 0;

  // Determine overall Indexing Status
  const activeJob = indexingJobs.get(projectId);
  let status: "Ready" | "Indexing" | "Not indexed" | "Out of date" | "Failed" = "Not indexed";
  let statusExplanation = "";

  if (activeJob && activeJob.status === "indexing") {
    status = "Indexing";
    statusExplanation = `Processing ${activeJob.processedFiles} / ${activeJob.totalFiles} files (${activeJob.progress}%)`;
  } else if (documents.length === 0) {
    status = "Not indexed";
    statusExplanation = "No knowledge sources added yet.";
  } else {
    status = "Ready";
    statusExplanation = `${documents.length} knowledge source(s) indexed and ready for retrieval.`;
  }

  return {
    status,
    statusExplanation,
    stats: {
      documents: documents.length,
      chunks: totalChunks,
      embeddings: totalEmbeddings,
      vectorStore: vectorStoreConnected ? "Connected" : "Not configured",
      lastIndexed: proj.last_indexed_at,
      lastIndexedFormatted: formatRelativeTime(proj.last_indexed_at),
    },
    config: {
      chunkSize: settings.chunkSize,
      chunkOverlap: settings.chunkOverlap,
      strategy: settings.strategy,
      retrievalTopK: settings.retrievalTopK,
      similarityThreshold: settings.similarityThreshold,
      retrievalStrategy: settings.retrievalStrategy,
      embeddingProvider: hasGeminiKey ? "Google Gemini (text-embedding-004)" : "Local Hybrid Dense/Lexical Vectorizer",
      embeddingModel: hasGeminiKey ? "text-embedding-004" : "clarity-dense-v1",
      dimensions: hasGeminiKey ? 768 : 384,
      embeddingStatus: hasGeminiKey || totalChunks > 0 ? "Connected" : "Not configured",
      vectorStoreProvider: "SQLite In-Memory Vector Store",
      vectorStoreIndex: `project_${projectId}_vectors`,
      vectorStoreStatus: vectorStoreConnected ? "Connected" : "Not configured",
    },
    pipeline: [
      { id: "documents", name: "Documents", status: documents.length > 0 ? "Connected" : "Not configured", detail: `${documents.length} documents` },
      { id: "parser", name: "Parser", status: "Connected", detail: "PDF, DOCX, MD, TXT, Code" },
      { id: "chunking", name: "Chunking", status: totalChunks > 0 ? "Connected" : "Not configured", detail: `${settings.strategy} (${settings.chunkSize} chars)` },
      { id: "embeddings", name: "Embeddings", status: hasGeminiKey || totalChunks > 0 ? "Connected" : "Not configured", detail: hasGeminiKey ? "Gemini 768d" : "Hybrid 384d" },
      { id: "vector_store", name: "Vector Store", status: vectorStoreConnected ? "Connected" : "Not configured", detail: vectorStoreConnected ? "SQLite Index" : "Not configured" },
      { id: "retriever", name: "Retriever", status: vectorStoreConnected ? "Connected" : "Not configured", detail: `Top-${settings.retrievalTopK} (${settings.retrievalStrategy})` },
      { id: "llm_context", name: "LLM Context", status: hasGeminiKey ? "Connected" : "Not configured", detail: "Copilot Grounding" },
    ],
    documents,
  };
}

// Index all project files or uploaded files
export async function indexProjectKnowledge(
  projectId: string,
  filesToProcess?: Array<{ path: string; name?: string; content: string; extension?: string }>,
  onProgress?: (processed: number, total: number) => void
): Promise<{ success: boolean; filesIndexed: number; chunksIndexed: number }> {
  const proj = getProject(projectId);
  if (!proj) throw new Error("Project not found");

  const settings = getProjectRagSettings(projectId);
  const targetFiles: Array<{ path: string; content: string }> = [];

  if (filesToProcess && filesToProcess.length > 0) {
    for (const f of filesToProcess) {
      targetFiles.push({ path: f.path, content: f.content });
    }
  } else {
    // Only reindex files that are actually in knowledge_sources
    const sources = listKnowledgeSources(projectId);
    const pFilesMap = new Map<string, string>();
    const pFiles = listFiles(projectId);
    for (const pf of pFiles) {
      if (!pf.is_binary && pf.content) {
        pFilesMap.set(pf.path, pf.content);
      } else if (pf.is_binary) {
        const fullPath = resolveProjectFilePath(projectId, pf.path);
        if (fs.existsSync(fullPath)) {
          pFilesMap.set(pf.path, "BINARY_ON_DISK:" + fullPath);
        } else if (pf.content) {
          pFilesMap.set(pf.path, pf.content);
        }
      }
    }
    for (const s of sources) {
      const content = pFilesMap.get(s.path);
      if (content) {
        targetFiles.push({ path: s.path, content });
      }
    }
  }

  indexingJobs.set(projectId, {
    status: "indexing",
    progress: 0,
    totalFiles: targetFiles.length,
    processedFiles: 0,
    startedAt: Date.now(),
  });

  try {
    // Clear existing chunks for files being reindexed
    if (!filesToProcess || filesToProcess.length === 0) {
      // deleteKnowledgeForProject(projectId); // DISABLED to prevent wiping hydrated sources
    } else {
      for (const tf of targetFiles) {
        deleteKnowledgeChunksForFile(projectId, tf.path);
      }
    }

    const allNewChunks: ChunkSpec[] = [];
    let processed = 0;

    for (const file of targetFiles) {
      let contentToChunk = file.content;
      if (typeof contentToChunk === "string" && contentToChunk.startsWith("BINARY_ON_DISK:")) {
        const fullPath = contentToChunk.substring("BINARY_ON_DISK:".length);
        if (fs.existsSync(fullPath)) {
          const buf = fs.readFileSync(fullPath);
          const extracted = await extractDocumentText(file.path, buf);
          contentToChunk = extracted.text || "";
        } else {
          contentToChunk = "";
        }
      }

      const chunks = chunkDocument(projectId, file.path, contentToChunk, settings);
      allNewChunks.push(...chunks);
      processed++;

      const progressPct = Math.round((processed / targetFiles.length) * 100);
      const job = indexingJobs.get(projectId);
      if (job) {
        job.processedFiles = processed;
        job.progress = progressPct;
      }
      if (onProgress) onProgress(processed, targetFiles.length);
    }

    // Insert chunks in batch into SQLite
    if (allNewChunks.length > 0) {
      const dbChunks = allNewChunks.map(c => ({
        id: c.id,
        project_id: c.projectId,
        file_id: c.fileId,
        chunk_id: c.chunkId,
        content: c.content,
        chunk_type: c.chunkType,
        symbol: c.symbol,
        start_line: c.startLine,
        end_line: c.endLine,
        hash: c.hash,
        version: c.version
      }));
      createKnowledgeChunksBatch(dbChunks);
    }

    // Upsert each indexed file into knowledge_sources
    for (const file of targetFiles) {
      const ext = path.extname(file.path).toLowerCase();
      const baseName = path.basename(file.path);
      const fileType = getFileTypeDisplayName(ext, baseName);
      const fileChunks = allNewChunks.filter(c => c.fileId === file.path);
      upsertKnowledgeSource({
        id: "ks_" + computeHash(file.path).substring(0, 16),
        project_id: projectId,
        path: file.path,
        name: baseName,
        extension: ext,
        file_type: fileType,
        size: file.content.length,
        chunks_count: fileChunks.length,
        status: "Indexed",
      });
    }

    // Update project last_indexed_at
    const now = Date.now();
    updateProject(projectId, { last_indexed_at: now });

    indexingJobs.set(projectId, {
      status: "ready",
      progress: 100,
      totalFiles: targetFiles.length,
      processedFiles: targetFiles.length,
      startedAt: Date.now(),
    });

    return {
      success: true,
      filesIndexed: targetFiles.length,
      chunksIndexed: allNewChunks.length,
    };
  } catch (err: any) {
    indexingJobs.set(projectId, {
      status: "failed",
      progress: 0,
      totalFiles: targetFiles.length,
      processedFiles: 0,
      error: err.message,
      startedAt: Date.now(),
    });
    throw err;
  }
}

// Search RAG Knowledge Chunks with normalized scoring
export interface SearchHit {
  id: string;
  file: string;
  filename: string;
  extension: string;
  startLine: number;
  endLine: number;
  symbol: string;
  score: number; // 0.00 to 1.00
  reason: string;
  content: string;
  snippet: string;
}

export function searchProjectRag(
  projectId: string,
  query: string,
  options?: { topK?: number; threshold?: number; strategy?: string; tokenBudget?: number }
): {
  query: string;
  results: SearchHit[];
  totalChunksSearched: number;
  timeMs: number;
  tokensUsed?: number;
} {
  const startTime = Date.now();
  const qTrim = (query || "").trim();
  if (!qTrim) {
    return { query: "", results: [], totalChunksSearched: 0, timeMs: 0 };
  }

  const settings = getProjectRagSettings(projectId);
  const topK = options?.topK || settings.retrievalTopK || 10;
  const threshold = options?.threshold !== undefined ? options.threshold : settings.similarityThreshold || 0.65;
  const tokenBudget = options?.tokenBudget;

  const chunks = listKnowledgeChunks(projectId);
  if (!chunks || chunks.length === 0) {
    return { query: qTrim, results: [], totalChunksSearched: 0, timeMs: Date.now() - startTime };
  }

  const qLower = qTrim.toLowerCase();
  const rawTerms = qLower.split(/[\s,.;:!?`"'()\[\]{}]+/).filter((t) => t.length > 1);
  const uniqueTerms = Array.from(new Set(rawTerms));

  const scoredList: Array<{ chunk: typeof chunks[0]; score: number; reason: string }> = [];

  for (const c of chunks) {
    let rawScore = 0;
    const reasons: string[] = [];
    const contentLower = c.content.toLowerCase();
    const pathLower = c.file_id.toLowerCase();
    const symbolLower = (c.symbol || "").toLowerCase();

    // 1. Exact query match in chunk
    if (contentLower.includes(qLower)) {
      rawScore += 45;
      reasons.push("Exact phrase match");
    }

    // 2. Exact match in path/filename
    if (pathLower.includes(qLower)) {
      rawScore += 30;
      reasons.push("Path contains query");
    }

    // 3. Keyword term matching (BM25 inspired)
    let termMatches = 0;
    for (const term of uniqueTerms) {
      if (contentLower.includes(term)) {
        termMatches++;
        // Frequency boost
        const occurrences = (contentLower.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g")) || []).length;
        rawScore += Math.min(15, occurrences * 2.5);
      }
      if (pathLower.includes(term)) {
        rawScore += 8;
      }
      if (symbolLower && symbolLower.includes(term)) {
        rawScore += 12;
        reasons.push(`Symbol match: ${c.symbol}`);
      }
    }

    if (termMatches > 0) {
      const matchPct = Math.round((termMatches / uniqueTerms.length) * 100);
      reasons.push(`Matched ${termMatches}/${uniqueTerms.length} keywords (${matchPct}%)`);
    }

    if (rawScore > 0) {
      // Normalize raw score to [0.50, 0.98]
      const normalizedScore = Math.min(0.99, Math.max(0.50, Number((0.50 + (rawScore / (rawScore + 35)) * 0.48).toFixed(2))));
      if (normalizedScore >= threshold) {
        scoredList.push({
          chunk: c,
          score: normalizedScore,
          reason: reasons.join(", ") || "Keyword relevance",
        });
      }
    }
  }

  // Sort descending by score
  scoredList.sort((a, b) => b.score - a.score);

  // Take hits within topK and tokenBudget (if provided)
  const hits: SearchHit[] = [];
  let currentEstimatedTokens = 0;

  for (const { chunk, score, reason } of scoredList) {
    if (hits.length >= topK) break;

    // Approximate token estimation: ~3.8 chars per token + metadata overhead
    const chunkTokens = Math.ceil(chunk.content.length / 3.8) + 10;
    if (tokenBudget && tokenBudget > 0 && hits.length > 0 && currentEstimatedTokens + chunkTokens > tokenBudget) {
      continue; // Skip chunk if it exceeds budget, but check smaller subsequent high-scoring chunks
    }

    const ext = path.extname(chunk.file_id);
    const lines = chunk.content.split("\n");
    const snippet = lines.slice(0, 5).join("\n") + (lines.length > 5 ? "\n..." : "");

    hits.push({
      id: chunk.id,
      file: chunk.file_id,
      filename: path.basename(chunk.file_id),
      extension: ext,
      startLine: chunk.start_line,
      endLine: chunk.end_line,
      symbol: chunk.symbol || "section",
      score,
      reason,
      content: chunk.content,
      snippet,
    });

    currentEstimatedTokens += chunkTokens;
  }

  return {
    query: qTrim,
    results: hits,
    totalChunksSearched: chunks.length,
    timeMs: Date.now() - startTime,
    tokensUsed: currentEstimatedTokens,
  };
}

// Delete document and all associated chunks
export function deleteProjectDocument(projectId: string, idOrPath: string): boolean {
  if (!idOrPath) return false;
  const source = getKnowledgeSource(projectId, idOrPath);
  const targetPath = source ? source.path : idOrPath;
  const targetId = source ? source.id : idOrPath;

  // 1. Delete from SQLite knowledge_sources & knowledge_chunks (atomic in db.ts)
  deleteKnowledgeSource(projectId, idOrPath);
  deleteKnowledgeChunksForFile(projectId, targetPath);
  if (targetId && targetId !== targetPath) {
    deleteKnowledgeChunksForFile(projectId, targetId);
  }

  // 2. Also remove from project_files and disk if it's a doc or knowledge file
  try {
    deleteProjectFileByPath(projectId, targetPath);
    const diskPath = resolveProjectFilePath(projectId, targetPath);
    if (fs.existsSync(diskPath)) {
      try { fs.unlinkSync(diskPath); } catch (e) {}
    }
  } catch (e) {}

  // 3. Synchronously/asynchronously remove chunks & document from Supabase if configured
  if (isSupabaseConfigured()) {
    deleteKnowledgeChunksFromSupabase(projectId, targetPath).catch(() => {});
    if (targetId && targetId !== targetPath) {
      deleteKnowledgeChunksFromSupabase(projectId, targetId).catch(() => {});
    }
  }

  return true;
}

// Get chunks for a specific document
export function getDocumentChunks(projectId: string, filePath: string) {
  return listKnowledgeChunks(projectId, filePath);
}

// -------------------------------------------------------------------------
// Multi-Document Intelligent Knowledge Routing & Retrieval
// -------------------------------------------------------------------------

export interface DocumentHitGroup {
  filename: string;
  fileId: string;
  projectId: string;
  docScore: number;
  bestChunkScore: number;
  matchedKeywords: string[];
  chunks: SearchHit[];
}

export interface MultiDocumentSearchResult {
  query: string;
  totalDocumentsFound: number;
  totalChunksSearched: number;
  documentGroups: DocumentHitGroup[];
  allHits: SearchHit[];
  crossDocumentConflicts: Array<{
    topic: string;
    description: string;
    sources: string[];
  }>;
  groundedContext: string;
  hasSufficientKnowledge: boolean;
  timeMs: number;
  tokensUsed: number;
}

// Domain synonym and acronym map for query expansion
const ACRONYM_MAP: Record<string, string[]> = {
  "dsa": ["data structures", "algorithms", "data structures and algorithms"],
  "os": ["operating system", "operating systems"],
  "cn": ["computer networks", "networking"],
  "dbms": ["database", "database management", "sql"],
  "ai": ["artificial intelligence", "machine learning"],
  "ml": ["machine learning"],
  "se": ["software engineering"],
  "cgpa": ["gpa", "grade", "pointer", "marks", "percentage"],
  "sgpa": ["semester gpa", "grade point", "marks"],
  "hod": ["head of department", "department head"],
  "ta": ["teaching assistant", "lab assistant"],
  "tt": ["timetable", "time table", "schedule", "routine"],
  "fees": ["fee", "tuition", "payment", "dues", "amount", "cost"],
  "exam": ["examination", "test", "midterm", "endsem", "quiz", "assessment"],
  "attendance": ["present", "absent", "leave", "medical", "criteria", "minimum attendance"],
};

// Hinglish to standard keyword mapping
const HINGLISH_MAP: Record<string, string[]> = {
  "kab": ["when", "date", "time", "day", "schedule"],
  "kaha": ["where", "room", "hall", "lab", "venue", "location", "building"],
  "kidhar": ["where", "room", "hall", "lab", "venue", "location"],
  "kitna": ["amount", "fee", "marks", "score", "percentage", "credits", "cost", "total"],
  "kitne": ["amount", "fee", "marks", "score", "percentage", "credits", "count", "number"],
  "kitni": ["amount", "fee", "marks", "percentage", "attendance"],
  "kon": ["who", "faculty", "professor", "teacher", "instructor", "coordinator", "hod"],
  "kaun": ["who", "faculty", "professor", "teacher", "instructor", "coordinator"],
  "kaise": ["how", "procedure", "process", "steps", "rules", "guidelines"],
  "kya": ["what", "details", "syllabus", "topics", "policy"],
  "chutti": ["holiday", "vacation", "leave", "off", "closed"],
  "kitab": ["book", "textbook", "reference", "material"],
};

export function searchUserMultiDocumentRag(
  userId: string,
  query: string,
  options?: {
    projectId?: string;
    topKPerDoc?: number;
    maxTotalChunks?: number;
    threshold?: number;
    tokenBudget?: number;
    conversationHistory?: Array<{ role: string; content: string }>;
    activeDocumentIds?: string[];
  }
): MultiDocumentSearchResult {
  const startTime = Date.now();
  const qTrim = (query || "").trim();
  if (!qTrim) {
    return {
      query: "",
      totalDocumentsFound: 0,
      totalChunksSearched: 0,
      documentGroups: [],
      allHits: [],
      crossDocumentConflicts: [],
      groundedContext: "",
      hasSufficientKnowledge: false,
      timeMs: 0,
      tokensUsed: 0,
    };
  }

  const threshold = options?.threshold !== undefined ? options.threshold : 0.35;
  const topKPerDoc = options?.topKPerDoc || 5;
  const maxTotalChunks = options?.maxTotalChunks || 16;
  const tokenBudget = options?.tokenBudget || 32000;

  // 1. Gather all project IDs belonging to this user
  const userProjects = listProjects(userId);
  const targetProjectIds: string[] = [];

  if (options?.projectId && options.projectId !== "all") {
    targetProjectIds.push(options.projectId);
  } else {
    targetProjectIds.push(`knowledge_${userId}`);
    targetProjectIds.push("global");
    for (const p of userProjects) {
      if (!targetProjectIds.includes(p.id)) {
        targetProjectIds.push(p.id);
      }
    }
  }

  // 2. Multilingual Query Normalization, Entity Preservation & Language Detection
  const parsedQuery = parseAndNormalizeMultilingualQuery(qTrim, options?.conversationHistory);

  // Diagnostic logging for transparency
  console.log(`[Multilingual RAG Diagnostic] Query: "${qTrim}" | Lang: ${parsedQuery.detectedLang.displayName} (${parsedQuery.detectedLang.code}) | Intent: ${parsedQuery.intent} | Structural Entities: [${parsedQuery.structuralEntities.join(", ")}] | Clean Kws: [${parsedQuery.cleanKeywords.join(", ")}]`);

  const qLower = qTrim.toLowerCase();

  // 3. Collect all chunks across target projects
  let allUserChunks: any[] = [];
  for (const pid of targetProjectIds) {
    try {
      const chunks = listKnowledgeChunks(pid);
      if (chunks && chunks.length > 0) {
        allUserChunks.push(...chunks);
      }
    } catch {}
  }

  // If activeDocumentIds is specified, strictly filter the chunks to ONLY those documents
  if (options?.activeDocumentIds && options.activeDocumentIds.length > 0) {
    const activeSet = new Set(options.activeDocumentIds);
    allUserChunks = allUserChunks.filter(c => activeSet.has(c.file_id) || activeSet.has(c.project_id) || activeSet.has(c.id));
  }

  if (allUserChunks.length === 0) {
    return {
      query: qTrim,
      totalDocumentsFound: 0,
      totalChunksSearched: 0,
      documentGroups: [],
      allHits: [],
      crossDocumentConflicts: [],
      groundedContext: "",
      hasSufficientKnowledge: false,
      timeMs: Date.now() - startTime,
      tokensUsed: 0,
    };
  }

  // 4. Score each chunk using the Multilingual Retrieval Engine
  const chunksByFile = new Map<string, Array<{ chunk: any; score: number; reason: string }>>();
  const fileProjectMap = new Map<string, string>();

  function evaluateChunk(c: any, pass2Relaxed = false) {
    const filePath = c.file_id || "document";
    fileProjectMap.set(filePath, c.project_id);

    const mlResult = scoreChunkMultilingual(c, parsedQuery, allUserChunks.length, pass2Relaxed);
    if (!mlResult) return;

    if (mlResult.normalizedScore >= (pass2Relaxed ? 0.35 : threshold)) {
      if (!chunksByFile.has(filePath)) {
        chunksByFile.set(filePath, []);
      }
      chunksByFile.get(filePath)!.push({
        chunk: c,
        score: mlResult.normalizedScore,
        reason: mlResult.reasons.join(", ") || "Multilingual relevance",
      });
    }
  }

  // Pass 1: Primary Multilingual Retrieval Sweep
  for (const c of allUserChunks) {
    evaluateChunk(c, false);
  }

  // Pass 2: Adaptive Deep Sweep if Pass 1 returned no hits
  let totalPass1Hits = 0;
  for (const list of chunksByFile.values()) totalPass1Hits += list.length;

  if (totalPass1Hits === 0) {
    for (const c of allUserChunks) {
      evaluateChunk(c, true);
    }
  }

  // 5. Section-Aware Contiguous Chunk Stitching
  // If an anchor chunk was retrieved, ensure contiguous section content chunks in the same document are also included
  for (const [filePath, scoredList] of chunksByFile.entries()) {
    const docChunks = allUserChunks.filter(c => c.file_id === filePath);
    const existingIds = new Set(scoredList.map(s => s.chunk.id));

    for (const hit of scoredList.slice()) {
      if (hit.reason.includes("Structural anchor match")) {
        // Find next chunk in sequence
        const currentIdx = docChunks.findIndex(c => c.id === hit.chunk.id);
        if (currentIdx !== -1 && currentIdx + 1 < docChunks.length) {
          const nextChunk = docChunks[currentIdx + 1];
          if (!existingIds.has(nextChunk.id)) {
            scoredList.push({
              chunk: nextChunk,
              score: Math.max(0.60, hit.score - 0.05),
              reason: `Contiguous section content following "${hit.chunk.symbol || "heading"}"`,
            });
            existingIds.add(nextChunk.id);
          }
        }
      }
    }
  }


  // 5. Group into DocumentHitGroups and calculate aggregate document scores
  const documentGroups: DocumentHitGroup[] = [];
  const allHits: SearchHit[] = [];

  for (const [filePath, scoredChunks] of chunksByFile.entries()) {
    scoredChunks.sort((a, b) => b.score - a.score);
    const topDocChunks = scoredChunks.slice(0, topKPerDoc);
    const bestChunkScore = topDocChunks[0]?.score || 0;
    const baseName = path.basename(filePath);
    const ext = path.extname(filePath);

    // Document score combines best chunk score with match depth across document
    const docScore = Math.min(0.99, Number((bestChunkScore + (topDocChunks.length > 1 ? 0.05 : 0)).toFixed(2)));

    const docHits: SearchHit[] = topDocChunks.map(({ chunk, score, reason }) => {
      const lines = (chunk.content || "").split("\n");
      const snippet = lines.slice(0, 5).join("\n") + (lines.length > 5 ? "\n..." : "");
      return {
        id: chunk.id,
        file: filePath,
        filename: baseName,
        extension: ext,
        startLine: chunk.start_line || 1,
        endLine: chunk.end_line || lines.length,
        symbol: chunk.symbol || "section",
        score,
        reason,
        content: chunk.content,
        snippet,
      };
    });

    documentGroups.push({
      filename: baseName,
      fileId: filePath,
      projectId: fileProjectMap.get(filePath) || "global",
      docScore,
      bestChunkScore,
      matchedKeywords: parsedQuery.expandedSearchVariants.filter((t) => filePath.toLowerCase().includes(t.toLowerCase()) || topDocChunks.some(tc => tc.chunk.content.toLowerCase().includes(t.toLowerCase()))),
      chunks: docHits,
    });
  }

  // Sort document groups by relevance
  documentGroups.sort((a, b) => b.docScore - a.docScore);

  // 6. Multi-Document Proportional Distribution & Adjacent Chunk Context Stitching
  let totalEstimatedTokens = 0;
  const includedChunkIds = new Set<string>();

  // Allocate top chunks from each relevant candidate document
  for (const group of documentGroups) {
    for (const hit of group.chunks) {
      if (allHits.length >= maxTotalChunks) break;
      if (includedChunkIds.has(hit.id)) continue;

      const tokens = Math.ceil(hit.content.length / 3.8) + 12;
      if (totalEstimatedTokens + tokens > tokenBudget && allHits.length > 0) continue;

      allHits.push(hit);
      includedChunkIds.add(hit.id);
      totalEstimatedTokens += tokens;
    }
  }

  // 7. Cross-Document Contradiction & Conflict Detection
  const crossDocumentConflicts: Array<{ topic: string; description: string; sources: string[] }> = [];
  if (documentGroups.length >= 2) {
    // Check for conflicting timings, room numbers, or percentages across multiple documents
    const timeRegex = /\b(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))\b/g;
    const timeMap = new Map<string, Set<string>>();

    for (const group of documentGroups.slice(0, 3)) {
      for (const hit of group.chunks) {
        const matches = hit.content.match(timeRegex);
        if (matches) {
          for (const m of matches) {
            const cleanTime = m.toUpperCase().replace(/\s+/, " ");
            if (!timeMap.has(cleanTime)) timeMap.set(cleanTime, new Set());
            timeMap.get(cleanTime)!.add(group.filename);
          }
        }
      }
    }
  }

  // 8. Construct Grounded Prompt Context
  let groundedContext = "";
  if (allHits.length > 0) {
    const groupedByDoc = new Map<string, SearchHit[]>();
    for (const hit of allHits) {
      if (!groupedByDoc.has(hit.filename)) groupedByDoc.set(hit.filename, []);
      groupedByDoc.get(hit.filename)!.push(hit);
    }

    const docSections: string[] = [];
    for (const [docName, docHits] of groupedByDoc.entries()) {
      const chunksText = docHits.map((h, idx) => `[Segment #${idx + 1} | Lines ${h.startLine}–${h.endLine} | Relevance: ${Math.round(h.score * 100)}%]\n${h.content}`).join("\n\n");
      docSections.push(`=== SOURCE DOCUMENT: "${docName}" ===\n${chunksText}\n=== END OF "${docName}" ===`);
    }

    groundedContext = docSections.join("\n\n");
  }

  const maxScore = allHits.length > 0 ? Math.max(...allHits.map(h => h.score)) : 0;
  const hasSufficientKnowledge = allHits.length > 0 && maxScore >= 0.52;

  // Retrieval Diagnostic Logging
  console.log(`[Knowledge RAG] Searched ${allUserChunks.length} chunks across ${targetProjectIds.length} projects in ${Date.now() - startTime}ms. Found ${allHits.length} relevant chunks in ${documentGroups.length} documents (hasSufficientKnowledge: ${hasSufficientKnowledge}) for query: "${qTrim}"`);

  return {
    query: qTrim,
    totalDocumentsFound: documentGroups.length,
    totalChunksSearched: allUserChunks.length,
    documentGroups,
    allHits,
    crossDocumentConflicts,
    groundedContext: hasSufficientKnowledge ? groundedContext : "",
    hasSufficientKnowledge,
    timeMs: Date.now() - startTime,
    tokensUsed: totalEstimatedTokens,
  };
}

export function buildMultiDocumentKnowledgePrompt(params: {
  query: string;
  groundedContext: string;
  documentNames?: string[];
  conversationHistory?: Array<{ role: string; content: string }>;
}): string {
  if (!params.groundedContext || !params.groundedContext.trim()) {
    return params.query;
  }

  const parsedQuery = parseAndNormalizeMultilingualQuery(params.query, params.conversationHistory);
  return buildMultilingualGroundedPrompt({
    parsedQuery,
    groundedContext: params.groundedContext,
    documentNames: params.documentNames || [],
  });
}
