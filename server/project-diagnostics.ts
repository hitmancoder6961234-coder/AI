import { transformSync } from "esbuild";
import path from "path";

export interface DiagnosticIssue {
  id: string;
  file: string;
  line: number;
  column: number;
  type: "CONFIRMED ERROR" | "POTENTIAL ISSUE" | "WARNING" | "SUGGESTION" | "NEEDS MANUAL VERIFICATION";
  severity: "error" | "warning" | "info";
  message: string;
  explanation: string;
  correction: string;
  currentCode?: string;
  suggestedCode?: string;
  patchedContent?: string;
  diff?: {
    before: string;
    after: string;
  };
}

export interface DiagnosticsResult {
  file: string;
  language: string;
  issues: DiagnosticIssue[];
  summary: {
    errors: number;
    warnings: number;
    suggestions: number;
    clean: boolean;
  };
}

export interface ProjectFileContext {
  filename: string;
  content: string;
  size: number;
}

export async function analyzeFileDiagnostics(
  targetFile: string,
  rawContent: string | any,
  projectFiles: ProjectFileContext[] = [],
  fastMode = false
): Promise<DiagnosticIssue[]> {
  const content = typeof rawContent === "string" ? rawContent : (rawContent ? String(rawContent) : "");
  const ext = path.extname(targetFile || "").toLowerCase();
  const issues: DiagnosticIssue[] = [];
  const lines = content.split(/\r?\n/);
  const safeFiles = Array.isArray(projectFiles) ? projectFiles : [];

  if (ext === ".json") analyzeJson(targetFile, content, lines, issues);
  else if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) analyzeJavaScriptTypeScript(targetFile, content, lines, ext, safeFiles, issues);
  else if ([".py", ".pyw"].includes(ext)) analyzePython(targetFile, content, lines, safeFiles, issues);
  else if ([".html", ".htm"].includes(ext)) analyzeHtml(targetFile, content, lines, issues);
  else if (ext === ".css") analyzeCss(targetFile, content, lines, issues);

  return issues;
}

function analyzeJson(targetFile: string, content: string, lines: string[], issues: DiagnosticIssue[]) {
  try {
    JSON.parse(content);
  } catch (err: any) {
    let errorLine = lines.length;
    let errorCol = 1;
    const errMsg = err?.message || String(err);
    const posMatch = errMsg.match(/position\s+(\d+)/i);
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      const sub = content.substring(0, pos);
      errorLine = sub.split("\n").length;
      errorCol = sub.split("\n").pop()!.length + 1;
    }
    issues.push({
      id: `json_parse_${errorLine}`,
      file: targetFile,
      line: errorLine,
      column: errorCol,
      type: "CONFIRMED ERROR",
      severity: "error",
      message: "Invalid JSON: " + errMsg,
      explanation: "Syntax error encountered while parsing JSON.",
      correction: "Ensure standard JSON format.",
      currentCode: lines[errorLine - 1] || "",
    });
  }
}

function analyzeJavaScriptTypeScript(targetFile: string, content: string, lines: string[], ext: string, projectFiles: ProjectFileContext[], issues: DiagnosticIssue[]) {
  let loader: "js" | "jsx" | "ts" | "tsx" = "js";
  if (ext === ".jsx") loader = "jsx";
  else if (ext === ".ts" || ext === ".mts" || ext === ".cts") loader = "ts";
  else if (ext === ".tsx") loader = "tsx";

  try {
    transformSync(content, { loader, sourcemap: false });
  } catch (err: any) {
    if (err.errors && Array.isArray(err.errors)) {
      for (const e of err.errors) {
        const line = e.location?.line || 1;
        const column = e.location?.column || 1;
        issues.push({
          id: `esbuild_${line}_${column}`,
          file: targetFile,
          line,
          column,
          type: "CONFIRMED ERROR",
          severity: "error",
          message: e.text || "Syntax error",
          explanation: `Compiler syntax error.`,
          correction: `Fix syntax on line ${line}.`,
          currentCode: e.location?.lineText || lines[line - 1] || ""
        });
      }
    }
  }
}

function analyzePython(targetFile: string, content: string, lines: string[], projectFiles: ProjectFileContext[], issues: DiagnosticIssue[]) {
  let openParens = 0;
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    for (const ch of trimmed) {
      if (ch === "(") openParens++;
      else if (ch === ")") openParens--;
    }
    const defClassMatch = trimmed.match(/^(async\s+def|def|class|if|elif|else|for|while|try|except|finally|with)\b(.*)$/);
    if (defClassMatch && openParens <= 0) {
      const keyword = defClassMatch[1];
      const rest = defClassMatch[2].trim();
      if (!rest.endsWith(":") && !trimmed.endsWith(":")) {
        const fixedLine = rawLine.replace(/\s*$/, ":");
        const copyLines = [...lines];
        copyLines[i] = fixedLine;
        issues.push({
          id: `py_colon_${i + 1}`,
          file: targetFile,
          line: i + 1,
          column: rawLine.length + 1,
          type: "CONFIRMED ERROR",
          severity: "error",
          message: `SyntaxError: expected ':' at end of '${keyword}' statement`,
          explanation: `In Python, '${keyword}' statements must terminate with a colon ':'.`,
          correction: `Add a colon ':'.`,
          currentCode: rawLine,
          suggestedCode: fixedLine,
          patchedContent: copyLines.join("\n")
        });
      }
    }
  }
}

function analyzeHtml(targetFile: string, content: string, lines: string[], issues: DiagnosticIssue[]) {
  const openTags: Array<{ tag: string; line: number }> = [];
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr", "!doctype"]);

  let cleaned = content.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
  cleaned = cleaned.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, m => m.replace(/[^\n]/g, ' '));
  cleaned = cleaned.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, m => m.replace(/[^\n]/g, ' '));
  
  const cleanLines = cleaned.split(/\r?\n/);
  const tagRegex = /<\/?([a-zA-Z0-9\-]+)(?:\s+(?:[^>"]|"[^"]*"|'[^']*')*)?(\/?)>/g;
  
  for (let i = 0; i < cleanLines.length; i++) {
    const lineStr = cleanLines[i];
    const origLineStr = lines[i];
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(lineStr)) !== null) {
      const full = match[0];
      const tag = match[1].toLowerCase();
      if (tag.startsWith("!") || tag.startsWith("?")) continue;

      const isSelfClosing = match[2] === "/" || voidTags.has(tag) || full.endsWith("/>");
      const isClosing = full.startsWith("</");

      if (isClosing) {
        if (openTags.length === 0) {
          issues.push({
            id: `html_unmatched_${i + 1}_${match.index}`,
            file: targetFile,
            line: i + 1,
            column: match.index + 1,
            type: "WARNING",
            severity: "warning",
            message: `Unexpected closing tag </${tag}>`,
            explanation: `Closing tag </${tag}> has no corresponding opening tag.`,
            correction: `Remove </${tag}> or add opening tag.`,
            suggestedCode: origLineStr.replace(`</${tag}>`, ``),
            currentCode: origLineStr,
          });
        } else {
          let foundIdx = -1;
          for(let j=openTags.length-1; j>=0; j--) {
             if (openTags[j].tag === tag) {
                foundIdx = j;
                break;
             }
          }
          if (foundIdx !== -1) {
             openTags.splice(foundIdx, openTags.length - foundIdx);
          } else {
            const last = openTags.pop()!;
            issues.push({
              id: `html_mismatch_${i + 1}_${match.index}`,
              file: targetFile,
              line: i + 1,
              column: match.index + 1,
              type: "WARNING",
              severity: "warning",
              message: `Mismatched tag: expected </${last.tag}> but found </${tag}>`,
              explanation: `The tag <${last.tag}> opened on line ${last.line} was closed with </${tag}>.`,
              correction: `Replace </${tag}> with </${last.tag}>.`,
              suggestedCode: origLineStr.replace(`</${tag}>`, `</${last.tag}>`),
              currentCode: origLineStr,
            });
          }
        }
      } else if (!isSelfClosing) {
        openTags.push({ tag, line: i + 1 });
      }
    }
  }
}

function analyzeCss(targetFile: string, content: string, lines: string[], issues: DiagnosticIssue[]) {
  let openBraces = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineStr = lines[i];
    for (const ch of lineStr) {
      if (ch === "{") openBraces++;
      else if (ch === "}") openBraces--;
    }
  }
  if (openBraces !== 0) {
    issues.push({
      id: "css_unbalanced_braces",
      file: targetFile,
      line: lines.length,
      column: 1,
      type: "CONFIRMED ERROR",
      severity: "error",
      message: `CSS Parse Error: ${openBraces > 0 ? "Missing closing brace '}'" : "Extra closing brace '}'"}`,
      explanation: "CSS rulesets must have balanced opening and closing braces '{' and '}'.",
      correction: openBraces > 0 ? "Add closing brace '}' at end of file" : "Remove extra closing brace",
      currentCode: lines[lines.length - 1] || "",
    });
  }
}
