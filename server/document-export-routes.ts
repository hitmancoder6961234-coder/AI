import fs from "fs";
import path from "path";
import express from "express";
import { uploaders, wrapUploadMiddleware } from "./upload-config.js";
import { detectKind } from "./upload-validation.js";

/**
 * Word document import/export routes: DOCX import (Mammoth), DOCX export (docx library) and PDF export (headless Chrome).
 * Moved verbatim out of server.ts (it had no dependency on server state: only the express app and the upload middleware).
 * Auth is applied by the global gate before these routes, like every /api route.
 */
export function registerDocumentExportRoutes(app: express.Express): void {
  // 1. Import DOCX via Mammoth
  app.post("/api/document/import-docx", wrapUploadMiddleware(uploaders.single.single("file"), "single"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const mammoth = await import("mammoth");
      const result = await mammoth.convertToHtml({ buffer: req.file.buffer });
      res.json({
        html: result.value,
        warnings: result.messages.map(m => m.message)
      });
    } catch (err: any) {
      console.error("DOCX import error:", err);
      res.status(500).json({ error: err.message || "Failed to import DOCX" });
    }
  });

  // 2. Export DOCX via Docx Library
  app.post("/api/document/export-docx", async (req, res) => {
    try {
      const { title, orientation, marginSize } = req.body || {};
      const contentHtml = req.body?.contentHtml || req.body?.html || "";
      const docx = await import("docx");

      const children: any[] = [];

      // Cover Page Title
      children.push(
        new docx.Paragraph({
          text: title || "Untitled Document",
          heading: docx.HeadingLevel.TITLE,
          alignment: docx.AlignmentType.CENTER,
          spacing: { before: 800, after: 600 }
        })
      );

      // Helper to clean HTML text
      const cleanTextTags = (htmlStr: string): string => {
        return htmlStr
          .replace(/<[^>]*>/g, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .trim();
      };

      // Extract top-level elements cleanly (including tables, headings, paragraphs, and explicit page breaks)
      const processed = (contentHtml || "")
        .replace(/<div[^>]*page-break-after:\s*always[^>]*><\/div>/gi, "\n[PAGE_BREAK]\n")
        .replace(/<br\s*\/?>/gi, "\n");

      // Regex split on top-level block elements (h1-h3, p, lists, tables, explicit page breaks)
      const blockRegex = /(<h[1-3][^>]*>[\s\S]*?<\/h[1-3]>|<p[^>]*>[\s\S]*?<\/p>|<ul[^>]*>[\s\S]*?<\/ul>|<ol[^>]*>[\s\S]*?<\/ol>|<table[^>]*>[\s\S]*?<\/table>|\[PAGE_BREAK\])/gi;

      let match;
      let lastIndex = 0;
      const blocks: string[] = [];

      while ((match = blockRegex.exec(processed)) !== null) {
        const textBefore = processed.substring(lastIndex, match.index).trim();
        if (textBefore) {
          blocks.push(textBefore);
        }
        blocks.push(match[1]);
        lastIndex = blockRegex.lastIndex;
      }
      const remainingText = processed.substring(lastIndex).trim();
      if (remainingText) {
        blocks.push(remainingText);
      }

      for (const block of blocks) {
        const trimmedBlock = block.trim();
        if (!trimmedBlock) continue;

        if (trimmedBlock === "[PAGE_BREAK]") {
          children.push(
            new docx.Paragraph({
              children: [new docx.PageBreak()]
            })
          );
          continue;
        }

        // H1
        const h1Match = trimmedBlock.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (h1Match) {
          children.push(
            new docx.Paragraph({
              text: cleanTextTags(h1Match[1]),
              heading: docx.HeadingLevel.HEADING_1,
              keepNext: true,
              keepLines: true,
              spacing: { before: 240, after: 120 }
            })
          );
          continue;
        }

        // H2
        const h2Match = trimmedBlock.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
        if (h2Match) {
          children.push(
            new docx.Paragraph({
              text: cleanTextTags(h2Match[1]),
              heading: docx.HeadingLevel.HEADING_2,
              keepNext: true,
              keepLines: true,
              spacing: { before: 180, after: 80 }
            })
          );
          continue;
        }

        // H3
        const h3Match = trimmedBlock.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
        if (h3Match) {
          children.push(
            new docx.Paragraph({
              text: cleanTextTags(h3Match[1]),
              heading: docx.HeadingLevel.HEADING_3,
              keepNext: true,
              keepLines: true,
              spacing: { before: 140, after: 60 }
            })
          );
          continue;
        }

        // Lists
        const listMatch = trimmedBlock.match(/<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/i);
        if (listMatch) {
          const listContent = listMatch[2];
          const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
          let liMatch;
          while ((liMatch = liRegex.exec(listContent)) !== null) {
            children.push(
              new docx.Paragraph({
                text: cleanTextTags(liMatch[1]),
                bullet: { level: 0 },
                keepLines: true,
                spacing: { after: 100 }
              })
            );
          }
          continue;
        }

        // Tables
        const tableMatch = trimmedBlock.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
        if (tableMatch) {
          const tableContent = tableMatch[1];
          const rows: any[] = [];
          const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
          let trMatch;

          while ((trMatch = trRegex.exec(tableContent)) !== null) {
            const rowContent = trMatch[1];
            const cells: any[] = [];
            const tdRegex = /<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi;
            let tdMatch;

            while ((tdMatch = tdRegex.exec(rowContent)) !== null) {
              const isHeader = tdMatch[1].toLowerCase() === "th";
              cells.push(
                new docx.TableCell({
                  children: [
                    new docx.Paragraph({
                      text: cleanTextTags(tdMatch[2]),
                      keepLines: true,
                      spacing: { before: 100, after: 100 }
                    })
                  ],
                  shading: isHeader ? { fill: "F3F4F6" } : undefined
                })
              );
            }

            if (cells.length > 0) {
              rows.push(
                new docx.TableRow({
                  children: cells,
                  cantSplit: true // Prevent row from splitting across pages
                })
              );
            }
          }

          if (rows.length > 0) {
            children.push(
              new docx.Table({
                rows,
                width: {
                  size: 100,
                  type: docx.WidthType.PERCENTAGE
                }
              })
            );
          }
          continue;
        }

        // Images in DOCX
        const imgMatch = trimmedBlock.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
        if (imgMatch) {
          const imgSrc = imgMatch[1];
          let imageBuffer: Buffer | null = null;
          try {
            if (imgSrc.startsWith("data:image/")) {
              const base64Data = imgSrc.replace(/^data:image\/\w+;base64,/, "");
              imageBuffer = Buffer.from(base64Data, "base64");
            } else if (imgSrc.startsWith("/uploads/") || imgSrc.startsWith("uploads/")) {
              const cleanPath = imgSrc.startsWith("/") ? imgSrc.slice(1) : imgSrc;
              // The src comes from the HTML being exported: keep it inside web/public/uploads (it used to be joined onto web/public
              // unchecked, so "uploads/../../x" could embed any readable file in the document).
              const uploadsRoot = path.resolve(process.cwd(), "web", "public", "uploads");
              const fullPath = path.resolve(process.cwd(), "web", "public", cleanPath);
              if (fullPath.startsWith(uploadsRoot + path.sep) && fs.existsSync(fullPath)) {
                imageBuffer = fs.readFileSync(fullPath);
              }
            }
          } catch (imgErr) {
            console.warn("Failed to process DOCX image:", imgErr);
          }

          // docx needs the image type (without it the picture is stored as "...undefined" and Word cannot show it); only real images are embedded
          const docxImageType = imageBuffer ? ({ png: "png", jpeg: "jpg", gif: "gif", bmp: "bmp" } as const)[detectKind(imageBuffer) as "png" | "jpeg" | "gif" | "bmp"] : undefined;
          if (imageBuffer && docxImageType) {
            children.push(
              new docx.Paragraph({
                children: [
                  new docx.ImageRun({
                    type: docxImageType,
                    data: imageBuffer,
                    transformation: {
                      width: 480,
                      height: 270
                    }
                  })
                ],
                alignment: docx.AlignmentType.CENTER,
                spacing: { before: 200, after: 200 }
              })
            );
            continue;
          }
        }

        // Default Paragraph
        const pMatch = trimmedBlock.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        const textContent = pMatch ? pMatch[1] : trimmedBlock;
        const cleanText = cleanTextTags(textContent);
        if (cleanText) {
          children.push(
            new docx.Paragraph({
              text: cleanText,
              keepLines: true,
              spacing: { after: 140 }
            })
          );
        }
      }

      // Determine correct twips dimensions to prevent MS Word corruption on landscape
      let width = 11906; // standard A4 width
      let height = 16838; // standard A4 height
      if (orientation === "landscape") {
        width = 16838;
        height = 11906;
      }

      const doc = new docx.Document({
        sections: [{
          properties: {
            page: {
              size: {
                orientation: orientation === "landscape" ? docx.PageOrientation.LANDSCAPE : docx.PageOrientation.PORTRAIT,
                width,
                height
              },
              margin: { // docx's option is `margin` (singular); `margins` was ignored, so the chosen margin never applied
                top: marginSize === "wide" ? 2000 : marginSize === "narrow" ? 800 : 1440,
                bottom: marginSize === "wide" ? 2000 : marginSize === "narrow" ? 800 : 1440,
                left: marginSize === "wide" ? 2000 : marginSize === "narrow" ? 800 : 1440,
                right: marginSize === "wide" ? 2000 : marginSize === "narrow" ? 800 : 1440,
              }
            }
          },
          children: children
        }]
      });

      const buffer = await docx.Packer.toBuffer(doc);
      res.setHeader("Content-Disposition", `attachment; filename="${(title || "document").toLowerCase().replace(/[^a-z0-9]/g, "_")}.docx"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.send(buffer);
    } catch (err: any) {
      console.error("DOCX export error:", err);
      res.status(500).json({ error: err.message || "Failed to export DOCX" });
    }
  });

  // 3. Export PDF via Puppeteer PDF Generation
  app.post("/api/document/export-pdf", async (req, res) => {
    try {
      const { title, orientation, marginSize } = req.body || {};
      const contentHtml = req.body?.contentHtml || req.body?.html || "";
      const puppeteer = await import("puppeteer");

      const padding = marginSize === "wide" ? "2.5cm 3cm" : marginSize === "narrow" ? "1cm 1.2cm" : "1.8cm 2cm";

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>${title || "Document"}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
            @page {
              size: ${orientation === "landscape" ? "A4 landscape" : "A4 portrait"};
              margin: 0;
            }
            body {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              color: #111827;
              background: #ffffff;
              margin: 0;
              padding: ${padding};
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              font-size: 15px;
              line-height: 1.6;
            }
            h1 { font-size: 24px; font-weight: 700; margin-top: 24px; margin-bottom: 12px; color: #111827; page-break-after: avoid; break-after: avoid; }
            h2 { font-size: 18px; font-weight: 700; margin-top: 18px; margin-bottom: 8px; color: #1f2937; page-break-after: avoid; break-after: avoid; }
            h3 { font-size: 15px; font-weight: 600; margin-top: 14px; margin-bottom: 6px; color: #374151; page-break-after: avoid; break-after: avoid; }
            p { margin-top: 0; margin-bottom: 12px; page-break-inside: avoid; break-inside: avoid; }
            ul, ol { margin-top: 0; margin-bottom: 12px; padding-left: 20px; }
            li { margin-bottom: 4px; page-break-inside: avoid; break-inside: avoid; }
            table { width: 100%; border-collapse: collapse; margin: 16px 0; page-break-inside: auto; break-inside: auto; }
            tr { page-break-inside: avoid; break-inside: avoid; }
            th, td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; }
            th { background-color: #f3f4f6; font-weight: 600; }
            img { max-width: 100%; height: auto; border-radius: 4px; page-break-inside: avoid; break-inside: avoid; }
            .no-print {
              page-break-after: always;
              break-after: page;
              height: 0;
              margin: 0;
              padding: 0;
              border: none;
              visibility: hidden;
            }
            .message__content--code-explanation {
              border-left: 4px solid #4f46e5;
              padding: 12px;
              margin: 12px 0;
              background: #f9fafb;
              border-radius: 4px;
            }
          </style>
        </head>
        <body>
          ${contentHtml || ""}
        </body>
        </html>
      `;

      const browser = await puppeteer.default.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
      });
      const page = await browser.newPage();

      // Use 'load' and set a lower timeout to prevent hanging on slow network requests (like fonts or external images)
      try {
        await page.setContent(html, { waitUntil: "load", timeout: 8000 });
      } catch (timeoutErr) {
        console.warn("Puppeteer content loading timed out (partial assets might not load), continuing to PDF export anyway", timeoutErr);
      }

      const buffer = await page.pdf({
        format: "A4",
        landscape: orientation === "landscape",
        printBackground: true
      });

      await browser.close();

      res.setHeader("Content-Disposition", `attachment; filename="${(title || "document").toLowerCase().replace(/[^a-z0-9]/g, "_")}.pdf"`);
      res.setHeader("Content-Type", "application/pdf");
      res.send(buffer);
    } catch (err: any) {
      console.error("PDF export error:", err);
      // The raw message of a missing browser names the Chrome version and the install steps (and the cache path): keep it in the log
      if (/could not find (chrome|chromium)|executable doesn't exist|failed to launch the browser/i.test(String(err?.message || ""))) {
        return res.status(503).json({ error: "PDF export is not available on this server (no browser engine installed). Use Download as DOCX instead.", code: "PDF_ENGINE_UNAVAILABLE" });
      }
      res.status(500).json({ error: err.message || "Failed to export PDF" });
    }
  });
}
