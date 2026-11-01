/**
 * DARKNESS FRONTEND RESPONSE DOCUMENT BUILDER
 * 
 * Standardizes output rendering across all chat surfaces in Darkness.
 * Ensures clean paragraph flow, semantic lists, and proper LaTeX math rendering
 * while thoroughly stripping raw Markdown artifacts globally to prevent raw leaks.
 */

import { AnswerEngine } from "./answer-engine.js";
import { markdown } from "../js/lib/markdown.js";

export class ResponseDocumentBuilder {
  /**
   * Standardizes the incoming response text before HTML rendering.
   * Cleans raw markdown artifacts, formats paragraphs, maps lists, and repairs LaTeX math syntax.
   */
  static build(text: string, options?: any): string {
    if (!text) return "";

    // 1. Core clean via AnswerEngine's sanitization rules
    let processed = AnswerEngine.sanitizeResponse(text);

    // 2. Normalize and repair LaTeX math delimiters and symbols
    processed = this.normalizeMathSyntax(processed);

    // 3. Prevent raw Markdown leak: convert malformed structural characters or stray artifacts
    processed = this.stripRawMarkdownLeaks(processed);

    // 4. Group headings dynamically to avoid empty or forced headings
    processed = this.regulateHeadings(processed);

    // 5. Delegate to the core markdown engine with an interception flag
    if (typeof window !== "undefined" && window.Darkness && window.Darkness.markdown && typeof window.Darkness.markdown.render === "function") {
      const renderOptions = { ...(options || {}), __intercepted: true };
      return window.Darkness.markdown.render(processed, renderOptions);
    }

    if (markdown && typeof markdown.render === "function") {
      return markdown.render(processed, { ...(options || {}), __intercepted: true });
    }

    // High-fidelity fallback HTML renderer if the custom markdown script is unavailable
    return this.fallbackHTMLRenderer(processed);
  }

  /**
   * Normalizes multiple styles of math expressions ($, $$, \[, \], \(, \))
   * into clean, standardized LaTeX blocks that the KaTeX engine can parse perfectly.
   */
  private static normalizeMathSyntax(text: string): string {
    let s = text;

    // Repair escaped backslashes in math macros
    s = s.replace(/\\\\frac/g, "\\frac")
         .replace(/\\\\left/g, "\\left")
         .replace(/\\\\right/g, "\\right")
         .replace(/\\\\text/g, "\\text")
         .replace(/\\\\begin/g, "\\begin")
         .replace(/\\\\end/g, "\\end")
         .replace(/\\\\sqrt/g, "\\sqrt");

    // Fix double-escaped parentheses or brackets
    s = s.replace(/\\\\\((\s*)/g, " \\( ")
         .replace(/(\s*)\\\\\)/g, " \\) ")
         .replace(/\\\\\[(\s*)/g, "\n\\[\n")
         .replace(/(\s*)\\\\\s*\]/g, "\n\\]\n");

    // Standardize all \( and \) to inline $ delimiters for high-fidelity parsing
    s = s.replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (match, expr) => {
      return `$ ${expr.trim()} $`;
    });

    // Standardize all \[ and \] to block $$ delimiters for high-fidelity display parsing
    s = s.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (match, expr) => {
      return `\n$$\n${expr.trim()}\n$$\n`;
    });

    // Clean empty block math delimiters
    s = s.replace(/\$\$\s*\$\$/g, "");

    return s;
  }

  /**
   * Strips raw markdown leftovers or symbols that leak as raw artifacts to the user.
   */
  private static stripRawMarkdownLeaks(text: string): string {
    let s = text;

    // Remove double-rendered svg or svgsvg artifacts
    s = s.replace(/svgsvg/gi, "");

    // Strip unparsed trailing double/triple asterisks from header text
    s = s.replace(/^(#{1,6}\s+.*?)\s*\*{2,}\s*$/gm, "$1");

    return s;
  }

  /**
   * Regulates markdown headings. Cleans up empty or dangling headings
   * without destroying structured mathematical steps or subsections.
   */
  private static regulateHeadings(text: string): string {
    const lines = text.split("\n");
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check for empty markdown heading (no text after hashes)
      if (/^#{1,6}\s*$/.test(trimmed)) {
        continue;
      }

      result.push(line);
    }

    return result.join("\n");
  }

  /**
   * Backup high-fidelity HTML renderer that standardizes paragraph flow and semantic lists
   * when the main markdown module is not loaded yet.
   */
  private static fallbackHTMLRenderer(text: string): string {
    const paragraphs = text.split(/\n\n+/);
    let html = '<div class="response-document">';

    paragraphs.forEach(p => {
      const trimmed = p.trim();
      if (!trimmed) return;

      // Handle Headings
      if (/^#{1,6}\s+(.+)$/.test(trimmed)) {
        const level = (trimmed.match(/^#+/) || ["#"])[0].length;
        const headingText = trimmed.replace(/^#+\s+/, "").trim();
        html += `<h${level} class="heading">${headingText}</h${level}>`;
        return;
      }

      // Handle Lists
      if (/^[-*+]\s+/.test(trimmed)) {
        html += '<ul class="list">';
        trimmed.split("\n").forEach(line => {
          const itemText = line.replace(/^[-*+]\s+/, "").trim();
          if (itemText) html += `<li>${itemText}</li>`;
        });
        html += "</ul>";
        return;
      }

      // Default Paragraph
      html += `<p class="paragraph">${trimmed.replace(/\n/g, "<br/>")}</p>`;
    });

    html += "</div>";
    return html;
  }
}
