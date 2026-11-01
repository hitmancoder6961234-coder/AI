/**
 * Offline (no-model) generation. When no AI model is configured the Studio still produces a real, honest
 * report and deck from the project analysis alone: every sentence here is derived from evidence, nothing is
 * invented, and unknowns are stated. The result is labelled "offline" in the UI so the user knows a model
 * would write with more depth.
 */
import type { Brief, Outline, OutlineSection, OutlineSlide, ProjectContext, StudioOptions } from "./types.js";

const first = (s: string, n = 220) => {
  const t = (s || "").replace(/\s+/g, " ").trim();
  const dot = t.search(/[.!?](\s|$)/);
  const cut = dot > 20 && dot < n ? t.slice(0, dot + 1) : t.slice(0, n);
  return cut;
};
const list = (items: string[]) => items.map((i) => `- ${i}`).join("\n");
const cell = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const table = (head: string[], rows: unknown[][]) => `| ${head.join(" | ")} |\n| ${head.map(() => "---").join(" | ")} |\n${rows.map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n")}`;

function featuresOf(ctx: ProjectContext): Brief["keyFeatures"] {
  const a = ctx.analysis || {};
  const out: Brief["keyFeatures"] = [];
  const eps: any[] = a.apiIntelligence?.endpoints || [];
  const groups = new Map<string, any[]>();
  for (const e of eps) {
    const seg = String(e.path || "/").split("/").filter(Boolean).slice(0, 2).join("/") || "/";
    groups.set(seg, [...(groups.get(seg) || []), e]);
  }
  [...groups.entries()].sort((x, y) => y[1].length - x[1].length).slice(0, 5).forEach(([seg, list]) =>
    out.push({ name: `/${seg} interface`, what: `${list.length} endpoint${list.length > 1 ? "s" : ""} (${[...new Set(list.map((e) => e.method))].join(", ")}) implemented in ${[...new Set(list.map((e) => e.file))].slice(0, 2).join(", ")}.`, evidence: [...new Set(list.map((e) => e.file as string))].slice(0, 3) })
  );
  for (const m of (a.databaseIntelligence?.models || []).slice(0, 2)) out.push({ name: `${m.name} data model`, what: `Persists ${(m.fields || []).slice(0, 5).map((f: any) => f.name).join(", ")}.`, evidence: [m.file] });
  for (const insight of (a.knowledgeBase?.keyInsights || []).slice(0, Math.max(0, 6 - out.length))) out.push({ name: first(String(insight), 60), what: String(insight).slice(0, 240), evidence: [] });
  return out.slice(0, 8);
}

const TECH_WORDS: Array<[RegExp, string, string]> = [
  [/\bnode(?:\.js)?\b/i, "Backend", "Node.js"], [/\bexpress\b/i, "Backend", "Express"], [/\bdjango\b/i, "Backend", "Django"], [/\bflask\b/i, "Backend", "Flask"],
  [/\bspring(?: boot)?\b/i, "Backend", "Spring Boot"], [/\blaravel\b/i, "Backend", "Laravel"], [/\bfastapi\b/i, "Backend", "FastAPI"],
  [/\breact(?:\.js)?\b/i, "Frontend", "React"], [/\bangular\b/i, "Frontend", "Angular"], [/\bvue(?:\.js)?\b/i, "Frontend", "Vue"], [/\bflutter\b/i, "Mobile", "Flutter"],
  [/\bandroid\b/i, "Mobile", "Android"], [/\bpostgres(?:ql)?\b/i, "Database", "PostgreSQL"], [/\bmysql\b/i, "Database", "MySQL"], [/\bmongo(?:db)?\b/i, "Database", "MongoDB"],
  [/\bsqlite\b/i, "Database", "SQLite"], [/\bfirebase\b/i, "Backend", "Firebase"], [/\besp32\b/i, "Hardware", "ESP32"], [/\barduino\b/i, "Hardware", "Arduino"],
  [/\braspberry pi\b/i, "Hardware", "Raspberry Pi"], [/\bpython\b/i, "Language", "Python"], [/\bjava\b/i, "Language", "Java"], [/\btensorflow\b/i, "ML", "TensorFlow"],
  [/\bpytorch\b/i, "ML", "PyTorch"], [/\bmqtt\b/i, "Protocol", "MQTT"], [/\bdocker\b/i, "Infrastructure", "Docker"], [/\baws\b/i, "Cloud", "AWS"],
];

/** The owner's own description of the project: an explicit idea, or an IDEA.md / README written by hand. */
function ownerIdea(ctx: ProjectContext): string {
  if (ctx.idea?.trim()) return ctx.idea.trim();
  const f = ctx.files.find((x) => /(^|\/)idea\.md$/i.test(x.path)) || ctx.files.find((x) => /(^|\/)readme(\.md|\.txt)?$/i.test(x.path));
  return (f?.content || "").replace(/^#\s.*\n+/, "").trim();
}

const sentences = (t: string) => t.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 12);

export function offlineBrief(ctx: ProjectContext, o: StudioOptions): Brief {
  const a = ctx.analysis || {};
  const hasCode = Number(a.fileStats?.codeFilesCount || 0) > 0;
  const idea = ownerIdea(ctx);
  const sents = sentences(idea);

  // --- tech stack: detected from code when there is code, otherwise only what the owner's text names
  const stack: Brief["techStack"] = [];
  if (hasCode) {
    (a.languages || []).slice(0, 3).forEach((l: any) => stack.push({ layer: "Language", technology: l.name, why: `${Math.round(l.percentage)}% of the code (${l.filesCount} files)` }));
    (a.frameworks || []).slice(0, 8).forEach((f: string) => stack.push({ layer: "Framework/Library", technology: f, why: "Detected in the project's dependencies or imports" }));
    (a.runtimes || []).slice(0, 2).forEach((r: string) => stack.push({ layer: "Runtime", technology: r, why: "Detected runtime" }));
    if (a.databaseIntelligence?.detected) stack.push({ layer: "Database", technology: a.databaseIntelligence.system || "Database", why: `${(a.databaseIntelligence.models || []).length} model(s) detected` });
  } else {
    for (const [re, layer, name] of TECH_WORDS) if (re.test(idea) && !stack.some((s) => s.technology === name)) stack.push({ layer, technology: name, why: "Named in your description" });
  }

  const gaps: string[] = [];
  if (!hasCode) gaps.push("No source code was provided, so the implementation is described from your description only; upload the code for a deeper report.");
  if (hasCode && a.codeQuality && !a.codeQuality.testing?.hasTests) gaps.push("No automated tests were detected.");
  if (hasCode) (a.securityAnalysis?.findings || []).slice(0, 3).forEach((f: any) => gaps.push(`${f.title} (${f.file})`));
  if (hasCode) (a.codeQuality?.issues || []).slice(0, 2).forEach((i: any) => gaps.push(`${i.title} (${i.file})`));
  if (hasCode && !ctx.files.some((f) => /readme/i.test(f.path))) gaps.push("No README was found, so setup and usage are undocumented.");

  const strengths: string[] = [];
  if (hasCode && a.codeQuality?.testing?.hasTests) strengths.push(`${a.codeQuality.testing.testFilesCount} automated test file(s) present.`);
  if (hasCode && a.databaseIntelligence?.detected) strengths.push(`A defined data layer (${a.databaseIntelligence.system || "database"}).`);
  if (hasCode && a.apiIntelligence?.endpoints?.length) strengths.push(`${a.apiIntelligence.endpoints.length} documented API endpoints.`);
  if (hasCode && a.fileStats) strengths.push(`${a.fileStats.codeFilesCount} code files across ${a.fileStats.totalFiles} files.`);

  const summary = hasCode ? String(a.summary || idea || ctx.description || `${ctx.name} is a software project.`) : idea || ctx.description || `${ctx.name} is a software project.`;
  const features = hasCode
    ? featuresOf(ctx)
    : sents.slice(0, 5).map((t) => ({ name: t.split(" ").slice(0, 6).join(" ").replace(/[.,;:]$/, ""), what: t.slice(0, 240), evidence: [] as string[] }));
  const architecture = hasCode && a.architecture?.nodes?.length
    ? String(a.architecture.summary || "")
    : hasCode
      ? "The architecture could not be inferred automatically from the uploaded files."
      : "No implementation was provided, so the design is described as planned in your description.";

  return {
    title: ctx.name,
    oneLiner: first(summary),
    projectType: hasCode ? a.projectType || "software project" : "planned software project",
    audience: o.audience,
    summary: summary.slice(0, 900),
    problem: sents[0] ? sents[0].slice(0, 400) : "The problem statement was not found; add it in your answers or documents for a stronger introduction.",
    solution: (sents.slice(1, 3).join(" ") || sents[0] || first(summary, 400)).slice(0, 500),
    keyFeatures: features,
    architecture,
    techStack: stack,
    strengths,
    risksOrGaps: gaps,
    questions: [
      { id: "q1", question: "Does your institution or client require a specific report format?", why: "Section order and headings may be mandated.", options: ["No, use the standard structure", "Yes, I will paste the required headings"], default: "No, use the standard structure" },
      { id: "q2", question: "Do you have results, screenshots or test output to include?", why: "The report must not invent results; real evidence makes the Results section credible.", options: ["Not yet", "Yes, I will add them afterwards"], default: "Not yet" },
      { id: "q3", question: "Who is the presentation for?", why: "Controls depth and vocabulary.", options: ["Examiners / viva", "Clients", "Technical peers"], default: "Examiners / viva" },
    ],
    recommendations: [
      ...(!hasCode ? [{ id: "r0", type: "improve-project" as const, text: "Upload the source code (or a GitHub link) so the report can explain the real implementation.", impact: "high" as const }] : []),
      ...(hasCode && !a.codeQuality?.testing?.hasTests ? [{ id: "r1", type: "improve-project" as const, text: "Add automated tests for the core logic and cite the results in the Testing section.", impact: "high" as const }] : []),
      ...(hasCode ? [{ id: "r2", type: "add-visual" as const, text: "Include the architecture diagram in the System Design section.", impact: "medium" as const }] : []),
      { id: "r3", type: "improve-report" as const, text: "Add real screenshots or measured results; offline mode cannot invent them.", impact: "high" as const },
      { id: "r4", type: "improve-report" as const, text: "Connect an AI model (Model page) so sections are written with deeper reasoning than static analysis allows.", impact: "medium" as const },
    ],
    source: "offline",
  };
}

const S = (id: string, kind: OutlineSection["kind"], title: string, purpose: string, keyPoints: string[], visual: OutlineSection["visual"] = "none", imageIdea?: string): OutlineSection => ({ id, kind, title, purpose, keyPoints, visual, imageIdea });

export function offlineOutline(brief: Brief, ctx: ProjectContext, o: StudioOptions): Outline {
  const a = ctx.analysis || {};
  const hasApi = Boolean(a.apiIntelligence?.endpoints?.length);
  const hasDb = Boolean(a.databaseIntelligence?.detected);
  const sections: OutlineSection[] = [
    S("abstract", "abstract", "Abstract", "Summarise the project in one paragraph.", [brief.oneLiner]),
    S("introduction", "introduction", "Introduction", "State the problem, motivation and scope.", [brief.problem, brief.solution]),
    S("objectives", "objectives", "Objectives", "List what the project set out to do.", brief.keyFeatures.slice(0, 5).map((f) => f.name)),
    S("tech-stack", "tech-stack", "Technology Stack", "Explain what each technology is used for.", brief.techStack.slice(0, 6).map((t) => t.technology), "table"),
    S("architecture", "architecture", "System Architecture", "Describe how the system is organised and how data flows.", [brief.architecture], a.architecture?.nodes?.length ? "diagram" : "none"),
    ...(hasDb ? [S("data-design", "data-design", "Data Design", "Document the stored entities and relations.", [], "table")] : []),
    ...(hasApi ? [S("api", "api", "Interfaces and API", "Inventory the endpoints.", [], "table")] : []),
    S("implementation", "implementation", "Implementation", "Explain the key modules.", brief.keyFeatures.slice(0, 5).map((f) => f.name)),
    S("testing", "testing", "Testing and Quality", "Report the testing evidence and code quality.", []),
    S("security", "security", "Security and Privacy", "Report the security scan and safeguards.", []),
    S("limitations", "limitations", "Limitations", "Be candid about known gaps.", brief.risksOrGaps.slice(0, 5)),
    S("future-work", "future-work", "Future Work", "Propose concrete next steps.", brief.recommendations.slice(0, 4).map((r) => r.text)),
    S("conclusion", "conclusion", "Conclusion", "Close the report.", [brief.oneLiner]),
    S("appendix-run", "appendix-run", "Appendix: Running the Project", "Give setup and run instructions.", []),
  ];
  const cut = o.length === "concise" ? ["objectives", "security", "future-work", "appendix-run"] : [];
  const kept = sections.filter((s) => !cut.includes(s.id));
  const slides: OutlineSlide[] = [
    { id: "title", title: brief.title, message: brief.oneLiner, bullets: [], visual: { kind: "none" }, notes: "" },
    { id: "problem", title: "The problem this project addresses", message: brief.problem, bullets: [], visual: { kind: "image", idea: `A clear conceptual illustration of the problem: ${first(brief.problem, 120)}` }, notes: "" },
    { id: "solution", title: "The solution in one sentence", message: brief.solution, bullets: [], visual: { kind: "none" }, notes: "" },
    { id: "features", title: "What the system does", message: "Key features", bullets: [], visual: { kind: "none" }, notes: "" },
    { id: "architecture", title: "How the system is organised", message: brief.architecture, bullets: [], visual: a.architecture?.nodes?.length ? { kind: "diagram", idea: "System architecture" } : { kind: "none" }, notes: "" },
    { id: "stack", title: "Technology choices", message: "The stack", bullets: [], visual: { kind: "table" }, notes: "" },
    ...(hasApi ? [{ id: "api", title: "The interfaces the system exposes", message: "Endpoints", bullets: [], visual: { kind: "table" as const }, notes: "" }] : []),
    { id: "quality", title: "How quality and security were checked", message: "Testing and security", bullets: [], visual: { kind: "none" as const }, notes: "" },
    { id: "limits", title: "Honest limitations and next steps", message: "What comes next", bullets: [], visual: { kind: "none" as const }, notes: "" },
    { id: "thanks", title: "Questions", message: "Thank you", bullets: [], visual: { kind: "none" as const }, notes: "" },
  ];
  return { report: { title: brief.title, subtitle: o.purpose ? o.purpose[0].toUpperCase() + o.purpose.slice(1) : "Project report", sections: kept }, deck: { title: brief.title, subtitle: brief.oneLiner, slides } };
}

export function offlineSection(s: OutlineSection, brief: Brief, ctx: ProjectContext): string {
  const a = ctx.analysis || {};
  const eps: any[] = a.apiIntelligence?.endpoints || [];
  switch (s.kind) {
    case "abstract": return `${brief.summary}\n\n${brief.solution}`;
    case "introduction": return `${brief.problem}\n\n${brief.solution}\n\nThe project is a ${brief.projectType}${a.primaryLanguage ? ` written mainly in ${a.primaryLanguage}` : ""}${a.fileStats ? `, comprising ${a.fileStats.totalFiles} files and about ${a.fileStats.totalLines.toLocaleString()} lines` : ""}.`;
    case "objectives": return `The project's objectives, as evidenced by what is implemented, are:\n\n${list(brief.keyFeatures.slice(0, 6).map((f) => `**${f.name}** - ${f.what}`)) || "- Objectives could not be inferred; add them to your answers."}`;
    case "requirements": return table(["ID", "Requirement", "Evidence"], brief.keyFeatures.map((f, i) => [`FR-${i + 1}`, f.name, f.evidence.join(", ") || "-"]));
    case "tech-stack": return `${brief.techStack.length ? table(["Layer", "Technology", "Role in this project"], brief.techStack.map((t) => [t.layer, t.technology, t.why])) : "No technologies could be detected automatically."}`;
    case "architecture": {
      const nodes: any[] = a.architecture?.nodes || [];
      return `${brief.architecture}${nodes.length ? `\n\nThe analyzer identified these components:\n\n${list(nodes.slice(0, 12).map((n) => `**${n.label || n.name || n.id}**${n.type ? ` (${n.type})` : ""}`))}` : ""}${a.dataFlow?.summary ? `\n\n${a.dataFlow.summary}` : ""}`;
    }
    case "data-design": {
      const models: any[] = a.databaseIntelligence?.models || [];
      return models.length ? `${a.databaseIntelligence?.description || ""}\n\n${table(["Entity", "File", "Fields"], models.slice(0, 20).map((m) => [m.name, m.file, (m.fields || []).map((f: any) => `${f.name}: ${f.type}`).join(", ")]))}` : "No database models were detected in the uploaded files.";
    }
    case "api": return eps.length ? `The system exposes ${eps.length} endpoint${eps.length > 1 ? "s" : ""}.\n\n${table(["Method", "Path", "Defined in", "Auth"], eps.slice(0, 40).map((e) => [e.method, `\`${e.path}\``, `\`${e.file}\``, e.authRequired ? "required" : "-"]))}` : "No HTTP endpoints were detected.";
    case "implementation": return brief.keyFeatures.length ? brief.keyFeatures.map((f) => `### ${f.name}\n\n${f.what}${f.evidence.length ? `\n\nImplemented in ${f.evidence.map((e) => `\`${e}\``).join(", ")}.` : ""}`).join("\n\n") : "The key modules could not be summarised automatically.";
    case "testing": {
      const t = a.codeQuality?.testing;
      const issues: any[] = a.codeQuality?.issues || [];
      return `${t?.hasTests ? `${t.testFilesCount} test file(s) were found${t.testFrameworks?.length ? `, using ${t.testFrameworks.join(", ")}` : ""}.` : "No automated tests were detected in the uploaded files."} ${a.codeQuality ? `The static quality score is ${a.codeQuality.score}/100. ${a.codeQuality.summary || ""}` : ""}${issues.length ? `\n\nMost notable quality issues:\n\n${table(["Issue", "File", "Why it matters"], issues.slice(0, 6).map((i) => [i.title, `\`${i.file}\``, i.whyItMatters]))}` : ""}\n\n*Measured results (coverage, benchmarks) are not part of the uploaded evidence and are therefore not stated.*`;
    }
    case "security": {
      const sec = a.securityAnalysis;
      const f: any[] = sec?.findings || [];
      return sec ? `The automated scan scored the project ${sec.score}/100. ${sec.summary || ""}${f.length ? `\n\n${table(["Finding", "Severity", "File"], f.slice(0, 8).map((x) => [x.title, x.severity, `\`${x.file}\``]))}` : "\n\nNo findings were reported."}` : "No security analysis data is available.";
    }
    case "results": return brief.strengths.length ? `What the evidence shows works:\n\n${list(brief.strengths)}` : "No results data was supplied.";
    case "limitations": return brief.risksOrGaps.length ? list(brief.risksOrGaps) : "No specific limitations were detected automatically.";
    case "future-work": return list(brief.recommendations.filter((r) => r.type === "improve-project" || r.type === "other").map((r) => r.text).concat(brief.risksOrGaps.slice(0, 3).map((g) => `Address: ${g}`))) || "Future work was not specified.";
    case "conclusion": return `${brief.summary}\n\n${brief.strengths.length ? `The strongest aspects are ${brief.strengths.slice(0, 2).join(" ").toLowerCase()}` : ""} ${brief.risksOrGaps.length ? `The main areas to improve are listed under Limitations.` : ""}`.trim();
    case "references": return "No external sources were supplied with the project.";
    case "appendix-run": return a.knowledgeBase?.quickStartGuide ? String(a.knowledgeBase.quickStartGuide) : `Install the dependencies and start the project using its ${(a.buildTools || ["build"]).join("/")} tooling. Exact commands were not detected; add them to your README.`;
    default: return `${s.purpose}\n\n${list(s.keyPoints)}`.trim();
  }
}

export function offlineSlides(outline: Outline, brief: Brief, ctx: ProjectContext): OutlineSlide[] {
  const a = ctx.analysis || {};
  const eps: any[] = a.apiIntelligence?.endpoints || [];
  const bulletsFor = (id: string): string[] => {
    switch (id) {
      case "features": return brief.keyFeatures.slice(0, 5).map((f) => f.name);
      case "stack": return brief.techStack.slice(0, 5).map((t) => `${t.technology}: ${t.why}`.slice(0, 80));
      case "api": return eps.slice(0, 5).map((e) => `${e.method} ${e.path}`);
      case "quality": return [a.codeQuality?.testing?.hasTests ? `${a.codeQuality.testing.testFilesCount} automated test files` : "No automated tests yet", a.codeQuality ? `Quality score ${a.codeQuality.score}/100` : "", a.securityAnalysis ? `Security score ${a.securityAnalysis.score}/100` : ""].filter(Boolean);
      case "limits": return [...brief.risksOrGaps.slice(0, 3), ...brief.recommendations.slice(0, 2).map((r) => r.text)].map((s) => s.slice(0, 90));
      case "architecture": return [first(brief.architecture, 90)];
      case "problem": return [first(brief.problem, 90)];
      case "solution": return [first(brief.solution, 90)];
      default: return [];
    }
  };
  return outline.deck.slides.map((s) => ({ ...s, bullets: s.bullets.length ? s.bullets : bulletsFor(s.id), notes: s.notes || `${s.message}`.slice(0, 400) }));
}
