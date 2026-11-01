/**
 * Build the "project dossier": a compact, secret-scrubbed, budgeted digest of a project that every Studio
 * prompt is grounded in. It is evidence, never instructions - prompts wrap it in <project_evidence> tags and
 * tell the model to ignore any directions found inside.
 */
import type { ProjectContext } from "./types.js";

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[redacted-key]"],
  [/\bsk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{16,}\b/g, "[redacted-key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[redacted-key]"],
  [/\bgsk_[A-Za-z0-9]{16,}\b/g, "[redacted-key]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-key]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, "[redacted-jwt]"],
  [/(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@/gi, "$1://[redacted]@"],
  [/(["']?(?:password|passwd|secret|api[_-]?key|access[_-]?token|private[_-]?key|client[_-]?secret)["']?\s*[:=]\s*)(["'])[^"'\n]{4,}\2/gi, "$1$2[redacted]$2"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted-private-key]"],
];

export function scrubSecrets(text: string): string {
  let out = text;
  for (const [re, sub] of SECRET_PATTERNS) out = out.replace(re, sub);
  return out;
}

const DOC_EXT = /\.(md|markdown|rst|txt|adoc|pdf|docx?|pptx?|odt|rtf|epub)$/i;
const CODE_EXT = /\.(jsx?|tsx?|mjs|cjs|py|java|kt|go|rs|rb|php|cs|cpp|c|h|swift|dart|vue|svelte|sql|sh|ps1|html|css|scss)$/i;
const CONFIG_NAMES = /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|pom\.xml|build\.gradle|go\.mod|cargo\.toml|composer\.json|gemfile|dockerfile|docker-compose\.ya?ml|vercel\.json|render\.ya?ml|\.env\.example|tsconfig\.json|vite\.config\.[jt]s|next\.config\.[jt]s|webpack\.config\.js|manifest\.json)$/i;
const SKIP_PATH = /(^|\/)(node_modules|\.git|dist|build|coverage|__pycache__|\.next|vendor|target|venv|\.venv)\//;
const LOCKFILES = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|composer\.lock|cargo\.lock)$/i;

function importance(path: string, size: number): number {
  const p = path.toLowerCase();
  let s = 0;
  if (/(^|\/)(readme|index|main|app|server|manage|wsgi|asgi|program)\.[a-z]+$/.test(p)) s += 50;
  if (/(route|controller|handler|api|endpoint|view)s?[./_-]/.test(p) || /\/(routes|controllers|api|handlers)\//.test(p)) s += 35;
  if (/(model|schema|entity|migration|db|database|store)s?[./_-]/.test(p) || /\/(models|schemas|entities)\//.test(p)) s += 30;
  if (/(service|core|engine|lib|util|helper|auth|middleware)s?[./_-]/.test(p) || /\/(services|core|lib)\//.test(p)) s += 20;
  if (/(test|spec|__tests__|mock|fixture)/.test(p)) s -= 25;
  if (/\.(min|bundle)\./.test(p) || size > 120_000) s -= 60;
  s -= Math.min(15, p.split("/").length * 2);
  return s;
}

function treeOf(paths: string[], max = 110): string {
  const shown = paths.slice(0, max);
  const lines = shown.map((p) => `  ${p}`);
  if (paths.length > max) lines.push(`  ... and ${paths.length - max} more files`);
  return lines.join("\n");
}

function head(content: string, lines: number, chars: number): string {
  const slice = content.split(/\r?\n/).slice(0, lines).join("\n");
  return slice.length > chars ? slice.slice(0, chars) + "\n[... truncated]" : slice;
}

export interface Dossier {
  text: string;
  facts: { fileCount: number; codeFiles: number; docFiles: number; chars: number; truncated: boolean };
}

export function buildDossier(ctx: ProjectContext, budget = 60_000): Dossier {
  const a = ctx.analysis || {};
  const files = ctx.files.filter((f) => !SKIP_PATH.test(f.path) && !LOCKFILES.test(f.path));
  const paths = files.map((f) => f.path).sort();
  const sections: string[] = [];

  // 1 - identity
  const id: string[] = [`PROJECT NAME: ${ctx.name}`];
  if (ctx.description) id.push(`DESCRIPTION: ${ctx.description}`);
  if (ctx.idea) id.push(`OWNER'S OWN DESCRIPTION OF THE IDEA:\n${ctx.idea.slice(0, 6000)}`);
  if (a.projectType) id.push(`DETECTED TYPE: ${a.projectType}`);
  if (a.primaryLanguage) id.push(`PRIMARY LANGUAGE: ${a.primaryLanguage}`);
  if (a.languages?.length) id.push(`LANGUAGES: ${a.languages.slice(0, 6).map((l: any) => `${l.name} ${Math.round(l.percentage)}%`).join(", ")}`);
  if (a.frameworks?.length) id.push(`FRAMEWORKS/LIBRARIES: ${a.frameworks.slice(0, 20).join(", ")}`);
  if (a.runtimes?.length) id.push(`RUNTIMES: ${a.runtimes.join(", ")}`);
  if (a.buildTools?.length) id.push(`BUILD TOOLS: ${a.buildTools.join(", ")}`);
  if (a.fileStats) id.push(`SIZE: ${a.fileStats.totalFiles} files, ${a.fileStats.totalLines} lines, ${a.fileStats.codeFilesCount} code files`);
  if (a.summary) id.push(`ANALYZER SUMMARY: ${String(a.summary).slice(0, 1200)}`);
  sections.push(`## IDENTITY\n${id.join("\n")}`);

  // 2 - structure
  if (paths.length) sections.push(`## FILE TREE\n${treeOf(paths)}`);

  // 3 - owner documents (requirements, rubrics, templates, prior reports): highest-value context
  const docs = files.filter((f) => DOC_EXT.test(f.path) && f.content?.trim());
  docs.sort((x, y) => (/readme/i.test(y.path) ? 1 : 0) - (/readme/i.test(x.path) ? 1 : 0) || y.content.length - x.content.length);
  let docBudget = 15_000;
  const docParts: string[] = [];
  for (const d of docs) {
    if (docBudget <= 500) break;
    const take = Math.min(d.content.length, /readme/i.test(d.path) ? 6000 : Math.min(5000, docBudget));
    docParts.push(`### ${d.path}\n${scrubSecrets(d.content.slice(0, take))}${take < d.content.length ? "\n[... truncated]" : ""}`);
    docBudget -= take;
  }
  if (docParts.length) sections.push(`## OWNER DOCUMENTS (requirements, notes, existing write-ups)\n${docParts.join("\n\n")}`);

  // 4 - structured facts from the analyzer
  const facts: string[] = [];
  const eps = a.apiIntelligence?.endpoints as any[] | undefined;
  if (eps?.length) facts.push(`API ENDPOINTS (${eps.length}):\n` + eps.slice(0, 40).map((e) => `  ${e.method} ${e.path}  (${e.file}:${e.line})${e.authRequired ? " [auth]" : ""}`).join("\n"));
  const models = a.databaseIntelligence?.models as any[] | undefined;
  if (a.databaseIntelligence?.detected) facts.push(`DATABASE: ${a.databaseIntelligence.system || "detected"}${models?.length ? `\n` + models.slice(0, 20).map((m) => `  ${m.name} (${m.file}): ${(m.fields || []).slice(0, 12).map((f: any) => `${f.name}:${f.type}`).join(", ")}`).join("\n") : ""}`);
  const deps = a.dependencies?.packages as any[] | undefined;
  if (deps?.length) facts.push(`DEPENDENCIES (${a.dependencies.total}): ` + deps.slice(0, 40).map((d) => `${d.name}${d.version ? "@" + d.version : ""}`).join(", "));
  if (a.codeQuality) facts.push(`TESTING: ${a.codeQuality.testing?.hasTests ? `${a.codeQuality.testing.testFilesCount} test files (${(a.codeQuality.testing.testFrameworks || []).join(", ") || "framework unknown"})` : "no automated tests detected"}; quality score ${a.codeQuality.score}/100`);
  if (a.securityAnalysis) facts.push(`SECURITY SCAN: score ${a.securityAnalysis.score}/100; ${a.securityAnalysis.findings?.length || 0} findings. ${String(a.securityAnalysis.summary || "").slice(0, 300)}`);
  if (a.architecture?.summary) facts.push(`ARCHITECTURE (analyzer): ${String(a.architecture.summary).slice(0, 900)}`);
  if (a.dataFlow?.summary) facts.push(`DATA FLOW (analyzer): ${String(a.dataFlow.summary).slice(0, 600)}`);
  if (a.knowledgeBase?.keyInsights?.length) facts.push(`KEY INSIGHTS: ${a.knowledgeBase.keyInsights.slice(0, 8).join(" | ")}`);
  if (facts.length) sections.push(`## STRUCTURED FACTS\n${facts.join("\n\n")}`);

  // 5 - configuration and key source excerpts
  const cfg = files.filter((f) => CONFIG_NAMES.test(f.path) && f.content);
  const cfgParts = cfg.slice(0, 6).map((f) => `### ${f.path}\n${scrubSecrets(head(f.content, 60, 2200))}`);
  if (cfgParts.length) sections.push(`## CONFIGURATION FILES\n${cfgParts.join("\n\n")}`);

  const code = files
    .filter((f) => CODE_EXT.test(f.path) && !f.isBinary && f.content && !CONFIG_NAMES.test(f.path))
    .map((f) => ({ f, s: importance(f.path, f.size ?? f.content.length) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, 14);
  const codeParts = code.map(({ f }) => `### ${f.path}\n\`\`\`\n${scrubSecrets(head(f.content, 90, 3200))}\n\`\`\``);
  if (codeParts.length) sections.push(`## KEY SOURCE EXCERPTS (most important files first; excerpts only)\n${codeParts.join("\n\n")}`);

  let text = sections.join("\n\n");
  const truncated = text.length > budget;
  if (truncated) text = text.slice(0, budget) + "\n\n[... dossier truncated to fit the context budget]";
  return {
    text,
    facts: { fileCount: files.length, codeFiles: files.filter((f) => CODE_EXT.test(f.path)).length, docFiles: docs.length, chars: text.length, truncated },
  };
}
