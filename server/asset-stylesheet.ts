/**
 * Base Stylesheet & Design Tokens for Exported Assets (PPT, Word DOCX, PDF, Technical Diagrams)
 *
 * Replaces all decorative AI-style graphics with a clean, executive aesthetic:
 * - Neutral color palettes (white, subtle slates, cool charcoals)
 * - Clear typography hierarchy and comfortable line spacing
 * - Professional technical diagram styles (crisp rectangular blocks, orthogonal connectors, no glowing drop-shadows or dark gradients)
 * - Strictly NO AI-generated decorative assets, cartoon emojis, or decorative clutter
 */

import { rgb, RGB, PDFPage, PDFFont } from "pdf-lib";
import {
  BorderStyle,
  HeadingLevel,
  AlignmentType,
  WidthType,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  ShadingType,
} from "docx";

// ============================================================
// 1. NEUTRAL COLOR PALETTES (HEX FOR PPTX & DOCX)
// ============================================================
export const ASSET_PALETTE = {
  // Canvas & Backgrounds
  canvas: "FFFFFF",             // Pure white canvas
  surface: "F8FAFC",            // Slate-50: Crisp container / card background
  surfaceSubtle: "F1F5F9",      // Slate-100: Table headers & subtle pills
  surfaceActive: "E2E8F0",      // Slate-200: Highlighted elements
  
  // High-Contrast Text (WCAG AA / AAA compliant)
  textPrimary: "0F172A",        // Slate-900: High-contrast primary headings & body
  textSecondary: "334155",      // Slate-700: Descriptive body & list items
  textMuted: "64748B",          // Slate-500: Captions, subtitles & metadata
  textInverse: "FFFFFF",        // Inverse white
  
  // Clean Borders & Separators
  borderHairline: "E2E8F0",     // Slate-200: 1px hairline dividers & rule lines
  borderMedium: "CBD5E1",       // Slate-300: Structured card borders & table grids
  borderStrong: "94A3B8",       // Slate-400: Active or focused container outlines
  
  // Executive Technical Accents (Muted & Neutral)
  accentCharcoal: "1E293B",     // Slate-800: Deep executive neutral
  accentSlate: "475569",        // Slate-600: Secondary technical accent & diagram connectors
  accentNavy: "1E3A8A",         // Deep navy: Reserved for primary identity mark
  accent: "1E3A8A",             // Default primary accent
  borderDark: "94A3B8",         // Strong border divider
  primary: "0F172A",
  secondary: "334155",
  muted: "64748B",
  
  // Table Shading
  tableHeaderBg: "F1F5F9",      // Header row fill
  tableAltRowBg: "FAFAFA",      // Subtle alternate row fill
  
  // Subtle Status Tokens (Muted, Non-Garish)
  statusVerified: {
    text: "166534",             // Green-800
    bg: "F0FDF4",               // Green-50
    border: "BBF7D0",           // Green-200
  },
  statusWarning: {
    text: "92400E",             // Amber-800
    bg: "FFFBEB",               // Amber-50
    border: "FDE68A",           // Amber-200
  },
  statusCritical: {
    text: "991B1B",             // Red-800
    bg: "FEF2F2",               // Red-50
    border: "FECACA",           // Red-200
  },
  statusNeutral: {
    text: "334155",             // Slate-700
    bg: "F1F5F9",               // Slate-100
    border: "CBD5E1",           // Slate-300
  },
} as const;

// ============================================================
// 2. PDF-LIB NATIVE RGB CONSTANTS
// ============================================================
export const PDF_PALETTE = {
  // Canonical neutral tokens
  canvas: rgb(1, 1, 1),
  surface: rgb(0.97, 0.98, 0.99),           // #F8FAFC
  surfaceSubtle: rgb(0.95, 0.96, 0.98),     // #F1F5F9
  textPrimary: rgb(0.06, 0.09, 0.16),       // #0F172A
  textSecondary: rgb(0.20, 0.25, 0.33),     // #334155
  textMuted: rgb(0.39, 0.45, 0.55),         // #64748B
  borderHairline: rgb(0.89, 0.91, 0.94),    // #E2E8F0
  borderMedium: rgb(0.80, 0.84, 0.88),      // #CBD5E1
  accentSlate: rgb(0.28, 0.33, 0.41),       // #475569
  accentNavy: rgb(0.12, 0.23, 0.54),        // #1E3A8A
  statusVerified: rgb(0.09, 0.40, 0.20),
  statusWarning: rgb(0.57, 0.25, 0.05),
  statusCritical: rgb(0.60, 0.11, 0.11),
  
  // Legacy / Direct Aliases for backward compatibility in PDF generator
  primary: rgb(0.06, 0.09, 0.16),
  secondary: rgb(0.20, 0.25, 0.33),
  text: rgb(0.20, 0.25, 0.33),
  muted: rgb(0.39, 0.45, 0.55),
  border: rgb(0.89, 0.91, 0.94),
  accent: rgb(0.28, 0.33, 0.41),
};

// ============================================================
// 3. TYPOGRAPHY & SIZING HIERARCHY
// ============================================================
export const ASSET_TYPOGRAPHY = {
  // Standard Professional System Font Families
  fontPresentation: "Segoe UI, Arial, sans-serif",
  fontDocument: "Calibri",
  fontTechnical: "Consolas, 'Courier New', monospace",
  
  // PowerPoint Sizes (Points)
  ppt: {
    deckTitle: 30,
    deckSubtitle: 13.5,
    slideTitle: 18,
    slideSubtitle: 11,
    cardTitle: 12.5,
    body: 10,
    bullet: 9.5,
    badge: 8.5,
    footer: 8.5,
    metricValue: 24,
    metricLabel: 9.5,
  },
  
  // Word Sizes (Half-points for DOCX API)
  docx: {
    docTitle: 26,             // pt
    docSubtitle: 12,
    h1: 15,
    h2: 12.5,
    h3: 11,
    body: 10,
    tableHeader: 9.5,
    caption: 8.5,
    metric: 18,
  },
  
  // PDF Sizes (Points)
  pdf: {
    title: 19,
    sectionHeading: 13,
    subheading: 10.5,
    body: 9.5,
    bullet: 9,
    metadata: 8.5,
    footer: 8,
  },
};

// ============================================================
// 4. POWERPOINT (PPTX) CLEAN BASE HELPERS
// ============================================================

export interface PptSlideHeaderOptions {
  category: string;
  title: string;
  subtitle: string;
}

/**
 * Adds a professional, clean header to a PPTX slide
 * Enforces neutral styling: clean category marker, dark slate heading, subtle rule divider.
 * No emojis or decorative clipart.
 */
export function addCleanPptHeader(slide: any, ppt: any, opt: PptSlideHeaderOptions): void {
  // Category Pill Badge (Clean Neutral)
  const catText = opt.category.toUpperCase();
  slide.addShape(ppt.ShapeType.roundRect, {
    x: 0.8, y: 0.35, w: 2.2, h: 0.26,
    fill: { color: ASSET_PALETTE.surfaceSubtle },
    line: { color: ASSET_PALETTE.borderMedium, width: 0.8 },
    rectRadius: 0.04,
  });
  slide.addText(catText, {
    x: 0.8, y: 0.35, w: 2.2, h: 0.26,
    fontSize: ASSET_TYPOGRAPHY.ppt.badge,
    bold: true,
    color: ASSET_PALETTE.textSecondary,
    align: "center",
    valign: "middle",
  });

  // Main Slide Title
  slide.addText(opt.title, {
    x: 0.8, y: 0.66, w: 8.4, h: 0.42,
    fontSize: ASSET_TYPOGRAPHY.ppt.slideTitle,
    bold: true,
    color: ASSET_PALETTE.textPrimary,
    valign: "middle",
  });

  // Subtitle
  slide.addText(opt.subtitle, {
    x: 0.8, y: 1.10, w: 8.4, h: 0.26,
    fontSize: ASSET_TYPOGRAPHY.ppt.slideSubtitle,
    color: ASSET_PALETTE.textMuted,
    valign: "middle",
  });

  // Clean Hairline Divider Line
  slide.addShape(ppt.ShapeType.line, {
    x: 0.8, y: 1.40, w: 8.4, h: 0,
    line: { color: ASSET_PALETTE.borderHairline, width: 0.9 },
  });
}

/**
 * Adds a standard, clean slide footer with page numbering
 */
export function addCleanPptFooter(slide: any, ppt: any, opt: { projectTitle: string; slideNum: number; totalSlides: number }): void {
  // Hairline separator
  slide.addShape(ppt.ShapeType.line, {
    x: 0.8, y: 5.12, w: 8.4, h: 0,
    line: { color: ASSET_PALETTE.borderHairline, width: 0.8 },
  });
  
  slide.addText(`${opt.projectTitle}  •  Technical Architecture & System Intelligence  •  Slide ${opt.slideNum} of ${opt.totalSlides}`, {
    x: 0.8, y: 5.18, w: 8.4, h: 0.26,
    fontSize: ASSET_TYPOGRAPHY.ppt.footer,
    color: ASSET_PALETTE.textMuted,
    valign: "middle",
  });
}

export interface PptContentCardOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  badgeText: string;
  title: string;
  description: string;
  bullets?: string[];
  statusLabel?: string;
  statusType?: "verified" | "warning" | "critical" | "neutral";
}

/**
 * Adds a clean, structured content card to a PPTX slide
 * Free of emojis, cartoon stickers, or glowing drop-shadows.
 */
export function addCleanPptCard(slide: any, ppt: any, opt: PptContentCardOptions): void {
  // Card Container Box
  slide.addShape(ppt.ShapeType.roundRect, {
    x: opt.x, y: opt.y, w: opt.w, h: opt.h,
    fill: { color: ASSET_PALETTE.surface },
    line: { color: ASSET_PALETTE.borderMedium, width: 0.9 },
    rectRadius: 0.05,
  });

  // Top Category Pill (Neutral)
  const pillW = Math.min(2.2, opt.w - 0.32);
  slide.addShape(ppt.ShapeType.roundRect, {
    x: opt.x + 0.16, y: opt.y + 0.16, w: pillW, h: 0.24,
    fill: { color: ASSET_PALETTE.canvas },
    line: { color: ASSET_PALETTE.borderHairline, width: 0.75 },
    rectRadius: 0.03,
  });
  slide.addText(opt.badgeText.toUpperCase(), {
    x: opt.x + 0.16, y: opt.y + 0.16, w: pillW, h: 0.24,
    fontSize: ASSET_TYPOGRAPHY.ppt.badge,
    bold: true,
    color: ASSET_PALETTE.textSecondary,
    align: "center",
    valign: "middle",
  });

  // Status Chip (if provided)
  if (opt.statusLabel) {
    const stColors = opt.statusType === "verified" ? ASSET_PALETTE.statusVerified
      : opt.statusType === "critical" ? ASSET_PALETTE.statusCritical
      : opt.statusType === "warning" ? ASSET_PALETTE.statusWarning
      : ASSET_PALETTE.statusNeutral;
      
    const stW = 1.2;
    slide.addShape(ppt.ShapeType.roundRect, {
      x: opt.x + opt.w - stW - 0.16, y: opt.y + 0.16, w: stW, h: 0.24,
      fill: { color: stColors.bg },
      line: { color: stColors.border, width: 0.75 },
      rectRadius: 0.03,
    });
    slide.addText(opt.statusLabel, {
      x: opt.x + opt.w - stW - 0.16, y: opt.y + 0.16, w: stW, h: 0.24,
      fontSize: 8,
      bold: true,
      color: stColors.text,
      align: "center",
      valign: "middle",
    });
  }

  // Card Title
  slide.addText(opt.title, {
    x: opt.x + 0.16, y: opt.y + 0.48, w: opt.w - 0.32, h: 0.34,
    fontSize: ASSET_TYPOGRAPHY.ppt.cardTitle,
    bold: true,
    color: ASSET_PALETTE.textPrimary,
    valign: "top",
  });

  // Card Description
  const hasBullets = opt.bullets && opt.bullets.length > 0;
  const descH = hasBullets ? 0.90 : opt.h - 0.95;
  slide.addText(opt.description, {
    x: opt.x + 0.16, y: opt.y + 0.86, w: opt.w - 0.32, h: descH,
    fontSize: ASSET_TYPOGRAPHY.ppt.body,
    color: ASSET_PALETTE.textSecondary,
    lineSpacing: 15,
    valign: "top",
  });

  // Optional Technical Bullets
  if (hasBullets) {
    const bulletY = opt.y + 1.82;
    const bulletText = opt.bullets!.map(b => `• ${b}`).join("\n");
    slide.addText(bulletText, {
      x: opt.x + 0.16, y: bulletY, w: opt.w - 0.32, h: opt.h - 1.90,
      fontSize: ASSET_TYPOGRAPHY.ppt.bullet,
      color: ASSET_PALETTE.accentSlate,
      lineSpacing: 14,
      valign: "top",
    });
  }
}

/**
 * Adds a clean, high-contrast metric card to PPTX
 */
export function addCleanPptMetric(slide: any, ppt: any, opt: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  value: string | number;
  subtext?: string;
}): void {
  slide.addShape(ppt.ShapeType.roundRect, {
    x: opt.x, y: opt.y, w: opt.w, h: opt.h,
    fill: { color: ASSET_PALETTE.surface },
    line: { color: ASSET_PALETTE.borderMedium, width: 0.9 },
    rectRadius: 0.04,
  });

  slide.addText(opt.label.toUpperCase(), {
    x: opt.x + 0.12, y: opt.y + 0.12, w: opt.w - 0.24, h: 0.22,
    fontSize: ASSET_TYPOGRAPHY.ppt.metricLabel,
    bold: true,
    color: ASSET_PALETTE.textMuted,
    align: "left",
  });

  slide.addText(String(opt.value), {
    x: opt.x + 0.12, y: opt.y + 0.34, w: opt.w - 0.24, h: 0.44,
    fontSize: ASSET_TYPOGRAPHY.ppt.metricValue,
    bold: true,
    color: ASSET_PALETTE.textPrimary,
    align: "left",
    valign: "middle",
  });

  if (opt.subtext) {
    slide.addText(opt.subtext, {
      x: opt.x + 0.12, y: opt.y + 0.80, w: opt.w - 0.24, h: 0.22,
      fontSize: 8.5,
      color: ASSET_PALETTE.accentSlate,
      align: "left",
    });
  }
}

// ============================================================
// 5. WORD (DOCX) CLEAN BASE HELPERS
// ============================================================

export const DOCX_STYLES = {
  default: {
    document: {
      run: {
        font: ASSET_TYPOGRAPHY.fontDocument,
        color: ASSET_PALETTE.textSecondary,
        size: ASSET_TYPOGRAPHY.docx.body * 2, // docx uses half-points
      },
      paragraph: {
        spacing: {
          line: 276, // 1.15 line spacing
          after: 120, // 6pt space after
        },
      },
    },
    heading1: {
      run: {
        font: ASSET_TYPOGRAPHY.fontDocument,
        bold: true,
        color: ASSET_PALETTE.textPrimary,
        size: ASSET_TYPOGRAPHY.docx.h1 * 2,
      },
      paragraph: {
        spacing: {
          before: 360,
          after: 140,
        },
      },
    },
    heading2: {
      run: {
        font: ASSET_TYPOGRAPHY.fontDocument,
        bold: true,
        color: ASSET_PALETTE.accentCharcoal,
        size: ASSET_TYPOGRAPHY.docx.h2 * 2,
      },
      paragraph: {
        spacing: {
          before: 240,
          after: 100,
        },
      },
    },
  },
};

export interface CleanDocxTableOptions {
  headers: string[];
  rows: (string | number)[][];
  columnWidths?: number[];
}

/**
 * Creates a clean professional Word document table with neutral borders and header shading
 * Supports both options object or direct (headers, rows) arguments.
 */
export function createCleanDocxTable(
  headersOrOpt: string[] | CleanDocxTableOptions,
  maybeRows?: (string | number)[][]
): Table {
  let headers: string[] = [];
  let rows: (string | number)[][] = [];

  if (Array.isArray(headersOrOpt)) {
    headers = headersOrOpt;
    rows = maybeRows || [];
  } else if (headersOrOpt && typeof headersOrOpt === "object") {
    headers = headersOrOpt.headers || [];
    rows = headersOrOpt.rows || [];
  }

  const tableBorders = {
    top: { style: BorderStyle.SINGLE, size: 1, color: ASSET_PALETTE.borderMedium },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: ASSET_PALETTE.borderMedium },
    left: { style: BorderStyle.NONE, size: 0, color: "auto" },
    right: { style: BorderStyle.NONE, size: 0, color: "auto" },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: ASSET_PALETTE.borderHairline },
    insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
  };

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h) =>
      new TableCell({
        shading: { type: ShadingType.CLEAR, fill: ASSET_PALETTE.tableHeaderBg },
        margins: { top: 120, bottom: 120, left: 140, right: 140 },
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: h,
                bold: true,
                color: ASSET_PALETTE.textPrimary,
                font: ASSET_TYPOGRAPHY.fontDocument,
                size: ASSET_TYPOGRAPHY.docx.tableHeader * 2,
              }),
            ],
          }),
        ],
      })
    ),
  });

  const dataRows = rows.map((row, idx) =>
    new TableRow({
      children: row.map((cell) =>
        new TableCell({
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: ASSET_PALETTE.tableAltRowBg } : undefined,
          margins: { top: 100, bottom: 100, left: 140, right: 140 },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: String(cell),
                  color: ASSET_PALETTE.textSecondary,
                  font: ASSET_TYPOGRAPHY.fontDocument,
                  size: ASSET_TYPOGRAPHY.docx.body * 2,
                }),
              ],
            }),
          ],
        })
      ),
    })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders,
    rows: [headerRow, ...dataRows],
  });
}

/**
 * Creates a clean technical callout box in Word for summary metrics or warnings
 */
export function createCleanDocxCallout(content: Paragraph[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: ASSET_PALETTE.borderMedium },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: ASSET_PALETTE.borderMedium },
      left: { style: BorderStyle.SINGLE, size: 4, color: ASSET_PALETTE.accentSlate },
      right: { style: BorderStyle.SINGLE, size: 1, color: ASSET_PALETTE.borderMedium },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: ASSET_PALETTE.surface },
            margins: { top: 140, bottom: 140, left: 180, right: 180 },
            children: content,
          }),
        ],
      }),
    ],
  });
}

// ============================================================
// 6. PDF CLEAN BASE DRAWING HELPERS
// ============================================================

export interface CleanPdfHeaderOptions {
  title: string;
  subtitle: string;
  metadata?: string;
}

/**
 * Draws an executive, clean header on a PDF page
 */
export function drawCleanPdfHeader(
  page: PDFPage,
  fontBold: PDFFont,
  fontRegular: PDFFont,
  opt: CleanPdfHeaderOptions
): number {
  const { width, height } = page.getSize();
  let y = height - 45;

  page.drawText(opt.title, {
    x: 50,
    y,
    size: ASSET_TYPOGRAPHY.pdf.title,
    font: fontBold,
    color: PDF_PALETTE.textPrimary,
  });
  y -= 20;

  page.drawText(opt.subtitle, {
    x: 50,
    y,
    size: ASSET_TYPOGRAPHY.pdf.subheading,
    font: fontRegular,
    color: PDF_PALETTE.textMuted,
  });
  y -= 16;

  if (opt.metadata) {
    page.drawText(opt.metadata, {
      x: 50,
      y,
      size: ASSET_TYPOGRAPHY.pdf.metadata,
      font: fontRegular,
      color: PDF_PALETTE.textSecondary,
    });
    y -= 14;
  }

  // Hairline separator
  page.drawLine({
    start: { x: 50, y },
    end: { x: width - 50, y },
    thickness: 1,
    color: PDF_PALETTE.borderHairline,
  });
  y -= 20;

  return y;
}

/**
 * Draws a clean PDF footer with page numbering and title
 */
export function drawCleanPdfFooter(
  page: PDFPage,
  fontRegular: PDFFont,
  opt: { projectTitle: string; pageNum: number; totalPages: number }
): void {
  const { width } = page.getSize();
  const y = 30;

  page.drawLine({
    start: { x: 50, y: y + 12 },
    end: { x: width - 50, y: y + 12 },
    thickness: 0.8,
    color: PDF_PALETTE.borderHairline,
  });

  page.drawText(`${opt.projectTitle}  •  System Architecture & Intelligence Report`, {
    x: 50,
    y,
    size: ASSET_TYPOGRAPHY.pdf.footer,
    font: fontRegular,
    color: PDF_PALETTE.textMuted,
  });

  const pageStr = `Page ${opt.pageNum} of ${opt.totalPages}`;
  const strWidth = fontRegular.widthOfTextAtSize(pageStr, ASSET_TYPOGRAPHY.pdf.footer);
  page.drawText(pageStr, {
    x: width - 50 - strWidth,
    y,
    size: ASSET_TYPOGRAPHY.pdf.footer,
    font: fontRegular,
    color: PDF_PALETTE.textMuted,
  });
}
