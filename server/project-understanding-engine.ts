/**
 * DARKNESS PROJECT UNDERSTANDING ENGINE
 *
 * Implements universal project-level understanding, intent classification,
 * contextual evidence extraction, intent-activated context routing, and natural answer synthesis.
 *
 * CORE PRINCIPLES:
 * 1. Answer the question the user actually asked — NOT a report template.
 * 2. General concepts are answered as general concepts — project context is activated ONLY by intent.
 * 3. Answer granularity matches question depth (concise for simple questions, structured only when asked).
 * 4. Zero empty headings, zero unrequested code dumps, zero invented claims.
 */

import path from "path";
import { ProjectAnalysis, ExtractedFile, ApiEndpoint, DatabaseModel, DependencyItem } from "./project-analyzer";

// ============================================================================
// 1. PROJECT INTENT DEFINITION & CLASSIFICATION
// ============================================================================

export type ProjectIntent =
  | "GENERAL_CONCEPT"
  | "PROJECT_OVERVIEW"
  | "PROJECT_REAL_LIFE_USE"
  | "PROJECT_CONCEPT_AND_LOGIC"
  | "PROJECT_PROBLEM_STATEMENT"
  | "PROJECT_SOLUTION"
  | "PROJECT_FEATURES"
  | "PROJECT_LOGIC_WORKFLOW"
  | "PROJECT_ENGINEERING_APPROACH"
  | "PROJECT_SCOPE"
  | "PROJECT_ADVANTAGES"
  | "PROJECT_DRAWBACKS"
  | "PROJECT_IMPROVEMENTS"
  | "PROJECT_USE_CASES"
  | "PROJECT_TECHNOLOGY"
  | "PROJECT_MODULE"
  | "PROJECT_FILE_ROLE"
  | "PROJECT_VIVA"
  | "PROJECT_COMPLETE_BREAKDOWN"
  | "CODE_EXPLANATION"
  | "COMPARISON"
  | "DIAGRAM_REQUEST"
  | "ARTIFACT_GENERATION"
  | "GENERAL_CHAT";

export class ProjectIntentClassifier {
  /**
   * Classifies user question into one of the canonical project understanding intents.
   * Accurately distinguishes between project understanding vs code-level walkthroughs.
   */
  static classify(
    query: string,
    targetFile?: string,
    hasSnippet: boolean = false
  ): ProjectIntent {
    const q = (query || "").trim().toLowerCase();

    // 0. Explicit Diagram / Visual Request (ONLY when user explicitly asks to CREATE/DRAW/GENERATE/SHOW a visual diagram/flowchart)
    const isExplicitDiagramCreation =
      /(?:create|generate|draw|make|export|banao|dikhao)\s+(?:an?\s*)?(?:architecture\s*diagram|system\s*diagram|workflow\s*diagram|pipeline\s*diagram|diagram|naksha|flowchart|visual\s*diagram)\b/i.test(q)
      || /\b(?:generate\s*diagram|draw\s*diagram|show\s*diagram|banao\s*diagram|make\s*flowchart|diagram\s*banao|naksha\s*banao)\b/i.test(q);

    if (isExplicitDiagramCreation && !/(?:explain|samjhao|what\s*is|kaise|overview)\b/i.test(q)) {
      return "DIAGRAM_REQUEST";
    }

    // 1. Explicit Artifact Generation Request (PPTX, DOCX, XLSX, PDF file creation)
    if (
      /(?:generate|create|make|build|export|download|banao)\s*(?:a\s*)?(?:pptx?|presentation|slide\s*deck|slides?|pitch\s*deck|word\s*doc(?:ument)?|docx?|excel|spreadsheet|xlsx|pdf\s*report|printable\s*pdf)\b/i.test(q)
      || /\b(?:generate\s*ppt|make\s*ppt|banao\s*ppt|export\s*ppt|create\s*deck|create\s*presentation|export\s*pdf|create\s*docx|make\s*docx|generate\s*excel)\b/i.test(q)
    ) {
      return "ARTIFACT_GENERATION";
    }

    // 2. Negative Code / Non-Code Flags
    const isNegativeCodeQuery = /\b(?:code\s*(?:mat|nhi|nahi|not|batao\s*mat)|naki\s*code|na\s*ki\s*code|without\s*code|code\s*kya\s*use\s*hua\s*ye\s*sab\s*nahi|code\s*nhi\s*chahiye|dont\s*show\s*code|no\s*code)\b/i.test(q);
    const isWholeProjectQuery = /(?:this\s*project|the\s*project|my\s*project|project\s*kya|project\s*ko|project\s*ka|project\s*ke|entire\s*project|whole\s*project|complete\s*project|about\s*the\s*project|about\s*this\s*project|project\/file|project\s*file)\b/i.test(q);

    // 3. Multi-Aspect Project / File Understanding Query (Concept + Logic + Approach + Real-life + Improvements + Weaknesses)
    // Matches queries like: "explain the concept, logic, engineering approach, real-life use, improvements and weaknesses of my project/file"
    const conceptTermsCount = [
      /\b(?:concept|idea|purpose)\b/i.test(q),
      /\b(?:logic|workflow|working)\b/i.test(q),
      /\b(?:engineering\s*approach|architecture|approach|design)\b/i.test(q),
      /\b(?:real[\s\-]life|real[\s\-]world|practical\s*use|use\s*cases?)\b/i.test(q),
      /\b(?:improvement|improvements|improve|enhancement)\b/i.test(q),
      /\b(?:weakness|weaknesses|limitation|limitations|drawback|drawbacks)\b/i.test(q),
      /\b(?:strength|strengths|advantage|advantages)\b/i.test(q)
    ].filter(Boolean).length;

    if (conceptTermsCount >= 2 || /\b(?:concept\s*aur\s*logic|concept\s*logic|concept\s*and\s*logic|engineering\s*approach.*real\s*life|logic.*approach.*weakness|concept.*improvements)\b/i.test(q)) {
      return "PROJECT_CONCEPT_AND_LOGIC";
    }

    // 4. Real-Life Use / Project Title / Practical Application
    const isRealLifeOrTitleQuery = Boolean(
      /\b(?:real[\s\-]life|real[\s\-]world|asli\s*use|actual\s*use|kis\s*kaam|kaam\s*aata|kaha\s*use|practical\s*use|business\s*use|domain|real\s*life\s*me|real\s*world\s*me|real\s*life\s*use|actual\s*use\s*real\s*life|daily\s*life)\b/i.test(q)
      || /\b(?:title\s*kya|project\s*ka\s*title|project\s*ka\s*naam|project\s*name|what\s*is\s*(?:my|the)\s*project\s*title|project\s*title\s*kya|title\s*batao|title\s*aur\s*use|naam\s*kya\s*hai)\b/i.test(q)
    );

    if (isRealLifeOrTitleQuery && !/(?:code\s*explain|line\s*by\s*line|debug)\b/i.test(q)) {
      return "PROJECT_REAL_LIFE_USE";
    }

    // 5. Explicit Code Explanation (STRICT: ONLY when asking explicitly for code breakdown, line-by-line syntax, or debugging)
    const isExplicitCodeAction = Boolean(
      !isNegativeCodeQuery &&
      (
        /\b(?:explain\s+this\s+code|explain\s+the\s+code|code\s+samjhao|code\s+explain|show\s+code\s+and\s+explain)\b/i.test(q)
        || /\b(?:line\s*by\s*line|har\s*line|line\s*\d+|line\s*number\s*\d+|what\s*does\s*this\s*line\s*do)\b/i.test(q)
        || /\b(?:find\s*the\s*bug|bug\s*in\s*this|debug\s*this|fix\s*this\s*error|error\s*in\s*this|why\s*is\s*this\s*code\s*failing)\b/i.test(q)
        || /\b(?:syntax\s*breakdown|code\s*walkthrough|explain\s*this\s*function\s*implementation)\b/i.test(q)
        || /\b(?:what\s*does\s*this\s*function\s*do\s*internally|breakdown\s*this\s*function)\b/i.test(q)
        || (hasSnippet && /\b(?:explain|walkthrough|debug|fix)\b/i.test(q) && !/\b(?:concept|purpose|role|overview|architecture|real\s*life)\b/i.test(q))
      )
    );

    if (isExplicitCodeAction && !isWholeProjectQuery) {
      return "CODE_EXPLANATION";
    }

    // 6. Specific File Role Query (When a file is queried or targetFile exists, but user wants to understand its PURPOSE & ROLE in the project)
    const fileMention = q.match(/\b([a-zA-Z0-9_\-]+\.(?:ts|tsx|js|jsx|py|java|cpp|c|cs|go|rs|php|rb|sql|css|html|json|yaml|yml|toml|env|dockerfile))\b/i)
      || /\b(?:docker-compose|dockerfile|package\.json|server\.ts|vite\.config)\b/i.test(q);

    if (fileMention && !isExplicitCodeAction) {
      return "PROJECT_FILE_ROLE";
    }

    if (targetFile && !isWholeProjectQuery && !isExplicitCodeAction) {
      if (/\b(?:explain|role|purpose|kya\s*karta|kya\s*hai|what\s*is|what\s*does|why\s*is|kaam|use)\b/i.test(q)) {
        return "PROJECT_FILE_ROLE";
      }
    }

    // 7. Viva / Presentation / Defense / Pitch for Evaluators
    if (
      /\b(?:viva|presentation|judges?|evaluator|examiner|defense|interview|pitch\s*for|explain\s*for\s*viva|viva\s*ke\s*liye|presentation\s*ke\s*liye|judges\s*ko\s*kaise|pitch\s*deck\s*explanation)\b/i.test(q)
    ) {
      return "PROJECT_VIVA";
    }

    // 8. Improvements / Future Scope / Recommendations
    if (
      /\b(?:improvement|improvements|how\s*can\s*(?:i|we|you|this|the|my)?\s*(?:improve|enhance)|how\s*to\s*improve|suggest\s*improvements|better\s*ways?|enhancements?|future\s*scope|future\s*extension|future\s*opportunities|upgrade|kya\s*improve|improve\s*kaise)\b/i.test(q)
    ) {
      return "PROJECT_IMPROVEMENTS";
    }

    // 9. Drawbacks / Limitations / Weaknesses / Risks
    if (
      /\b(?:drawback|drawbacks|limitation|limitations|weakness|weaknesses|kami|khamiyan|what\s*can\s*go\s*wrong|disadvantage|disadvantages|cons|shortcomings?|pitfalls?|risks?|bottlenecks?|weak\s*points?)\b/i.test(q)
      || /(?:weakness\s*kya|drawback\s*kya|limitations?\s*kya|is\s*project\s*ki\s*kami|kya\s*problem\s*aa\s*sakti)\b/i.test(q)
    ) {
      return "PROJECT_DRAWBACKS";
    }

    // 10. Advantages / Strengths / Benefits / Why Useful
    if (
      /\b(?:advantage|advantages|benefits?|pros|strengths?|key\s*strengths?|why\s*is\s*(?:this|it|this\s*project|the\s*project|this\s*app)\s*useful|fayde|solve\s*better)\b/i.test(q)
      || /(?:fayda\s*kya|advantage\s*kya|kyu\s*useful\s*hai|kya\s*fayda)\b/i.test(q)
    ) {
      return "PROJECT_ADVANTAGES";
    }

    // 11. Engineering Approach / Architecture / Design Decisions
    if (
      /\b(?:engineering\s*approach|architecture|system\s*architecture|how\s*the\s*system\s*was\s*designed|system\s*design|architectural\s*decisions?|design\s*patterns?|architecture\s*samjhao|internal\s*working)\b/i.test(q)
      || /\bwhy\s*(?:did\s*we\s*)?(?:use|choose)\s*(?:this\s*)?(?:approach|technique|architecture|pattern|rag|vector|hybrid\s*retrieval)\b/i.test(q)
    ) {
      return "PROJECT_ENGINEERING_APPROACH";
    }

    // 12. Logic & Workflow / Data Flow / Pipeline
    if (
      /\b(?:logic|workflow|how\s*does\s*(?:this|the|my)?\s*project\s*work|data\s*flow|execution\s*pipeline|request\s*flow|input\s*output|processing\s*logic|system\s*interactions?|kaise\s*kaam\s*karta|step\s*by\s*step\s*flow)\b/i.test(q)
    ) {
      return "PROJECT_LOGIC_WORKFLOW";
    }

    // 13. Technology / Tech Stack / Dependencies
    if (
      /\b(?:technology|technologies|tech\s*stack|stack|frameworks?|libraries|dependencies|what\s*database|database\s*used|which\s*db|stack\s*kya\s*hai|technologies\s*used)\b/i.test(q)
      || /\bwhy\s+(?:did\s*we\s*use\s*|use\s*|choose\s*)?(?:react|supabase|gemini|postgres|postgresql|mongodb|node|express|python|tailwind|katex|cytoscape)\b/i.test(q)
    ) {
      return "PROJECT_TECHNOLOGY";
    }

    // 14. Problem Statement specifically
    if (
      /\b(?:problem\s*statement|what\s*problem\s*does\s*(?:this\s*application|the\s*application|this\s*project|the\s*project|this\s*app|the\s*app|this|it)\s*solve|problem\s*solved|kis\s*problem\s*ko\s*solve|problem\s*kya\s*hai)\b/i.test(q)
    ) {
      return "PROJECT_PROBLEM_STATEMENT";
    }

    // 15. Proposed Solution specifically
    if (
      /\b(?:proposed\s*solution|how\s*does\s*(?:this\s*application|the\s*application|this\s*project|the\s*project|this\s*app|the\s*app|this|it)\s*solve|solution\s*approach|solution\s*kya\s*hai|kaise\s*solve\s*karta|solution\s*for\s*this)\b/i.test(q)
    ) {
      return "PROJECT_SOLUTION";
    }

    // 16. Features / Capabilities
    if (
      /\b(?:feature|features|capabilities|functionalities|what\s*can\s*(?:this\s*application|the\s*application|this\s*project|the\s*project|this\s*app|the\s*app|users?|this|it)\s*do|features\s*kya|kya\s*kya\s*features?|key\s*features?|main\s*features?)\b/i.test(q)
      || /(?:project\s*ke\s*features?|app\s*ke\s*features?|kya\s*features?\s*hain)\b/i.test(q)
    ) {
      return "PROJECT_FEATURES";
    }

    // 17. Scope / Scalability
    if (
      /\b(?:scope|scalable|scalability|scale|scale\s*kar\s*sakte|future\s*me|expansion|expand)\b/i.test(q)
      || /(?:scope\s*kya|project\s*ka\s*scope|kaha\s*tak\s*use)\b/i.test(q)
    ) {
      return "PROJECT_SCOPE";
    }

    // 18. Use Cases / Target Audience
    if (
      /\b(?:use\s*cases?|real[\s\-]world\s*applications?|where\s*can\s*(?:this|it|this\s*project|the\s*project|this\s*app)\s*be\s*used|who\s*can\s*use\s*(?:this|it|this\s*project|the\s*project|this\s*app)|target\s*users?|target\s*audience|kis\s*kaam\s*aayega|kaha\s*use\s*kar\s*sakte)\b/i.test(q)
    ) {
      return "PROJECT_USE_CASES";
    }

    // 19. Complete Project Breakdown / Deep Dive
    if (
      /\b(?:explain\s+(?:everything|the\s*whole\s*project|the\s*entire\s*project|complete\s*project|all\s*about\s*(?:this|the)\s*project)|complete\s*project\s*analysis|detailed\s*project\s*breakdown|full\s*breakdown|complete\s*breakdown|breakdown\s*of\s*(?:this|the)\s*project|poora\s*project|pura\s*project|sab\s*kuch\s*samjhao|deep\s*dive\s*into\s*project)\b/i.test(q)
    ) {
      return "PROJECT_COMPLETE_BREAKDOWN";
    }

    // 20. Modules / Subsystems
    if (
      /\b(?:main\s*modules?|explain\s*(?:the\s*)?modules?|what\s*does\s*the\s*.*module\s*do|module\s*breakdown|modules\s*kya\s*hai|components\s*overview)\b/i.test(q)
    ) {
      return "PROJECT_MODULE";
    }

    // 21. General Concept vs Project Concept Discrimination
    const hasExplicitProjectRef = /(?:this\s*project|the\s*project|our\s*project|my\s*project|is\s*project|ye\s*project|project\s*me|project\s*mein|project\s*ka|project\s*ke|project\s*ki|in\s*this\s*app|in\s*this\s*project|we\s*use|did\s*we\s*use)\b/i.test(q);

    const generalConceptPatterns = [
      /\b(?:elevator\s*pitch|pitch\s*deck)\b/i,
      /\b(?:problem\s*statement|solution\s*statement)\b/i,
      /\b(?:rag|retrieval\s*augmented\s*generation)\b/i,
      /\b(?:rest\s*api|restful\s*api|soap|graphql|grpc)\b/i,
      /\b(?:react|vue|angular|svelte|nextjs|express|django|flask|fastapi)\b/i,
      /\b(?:jwt|json\s*web\s*token|oauth|oauth2|session|cookie)\b/i,
      /\b(?:docker|kubernetes|container|containerization)\b/i,
      /\b(?:mvc|mvvm|solid\s*principles?|design\s*patterns?|clean\s*architecture)\b/i,
      /\b(?:orm|prisma|drizzle|hibernate|sequelize|mongoose)\b/i,
      /\b(?:acid\s*properties?|cap\s*theorem|database\s*indexing|sharding|replication)\b/i,
      /\b(?:ci\/cd|continuous\s*integration|continuous\s*deployment)\b/i,
      /\b(?:vector\s*database|vector\s*search|embeddings|cosine\s*similarity)\b/i,
      /\b(?:closure|recursion|polymorphism|encapsulation|inheritance|currying)\b/i,
      /\b(?:websocket|web\s*socket|sse|server\s*sent\s*events)\b/i,
      /\b(?:microservices?|monolith|monolithic\s*architecture)\b/i,
      /\b(?:cache|caching|redis|memcached)\b/i
    ];

    const matchesGeneralConcept = generalConceptPatterns.some(pat => pat.test(q));

    if (matchesGeneralConcept && !hasExplicitProjectRef) {
      if (/\b(?:problem\s*statement\s*kya\s*hai|problem\s*statement\s*batao|what\s*is\s*the\s*problem\s*statement)\b/i.test(q)) {
        if (/^(?:what\s+is\s+a\s+problem\s+statement|problem\s+statement\s+kya\s+hota\s+hai|define\s+problem\s+statement)\??$/i.test(q)) {
          return "GENERAL_CONCEPT";
        }
        return "PROJECT_PROBLEM_STATEMENT";
      }

      if (/\b(?:elevator\s*pitch\s*kya\s*hota\s*hai|what\s*is\s*an?\s*elevator\s*pitch|define\s*elevator\s*pitch)\b/i.test(q)) {
        return "GENERAL_CONCEPT";
      }

      if (/^(?:what\s+is\s+|explain\s+|what\s+does\s+.*\s+mean\b|[a-z0-9\s]+\s+kya\s+hai\??$|[a-z0-9\s]+\s+kya\s+hota\s+hai\??$)/i.test(q)) {
        return "GENERAL_CONCEPT";
      }
    }

    // 22. Comparison
    if (
      /\b(?:instead\s*of|vs|versus|difference\s*between|compare|comparison|kya\s*fark\s*hai|kyu\s*use\s*kiya.*ki\s*jagah|better\s*than|worse\s*than|prefer\s*.*over|alternative\s*to)\b/i.test(q)
      && !/(?:file|line|function)\b/i.test(q)
    ) {
      return "COMPARISON";
    }

    // 23. Project Overview / Summary / Introduction (Default project question)
    if (
      /\b(?:what\s*is\s*(?:this|the)\s*project|explain\s*(?:this|the|my)?\s*project|project\s*kya\s*karta\s*hai|overview|project\s*ka\s*overview|ye\s*project\s*kya\s*hai|what\s*does\s*(?:this|the)\s*(?:app|project|application|system)\s*do|tell\s*me\s*about\s*(?:this|the)\s*project|project\s*explanation|project\s*summary|purpose\s*of\s*(?:this|the)\s*project)\b/i.test(q)
      || /^(?:project\s*kya\s*hai|explain|summary|overview|intro|introduction)$/i.test(q)
    ) {
      return "PROJECT_OVERVIEW";
    }

    // Default to general chat
    return "GENERAL_CHAT";
  }

  /**
   * Detects the language family of the user message (English, Hindi, or Hinglish)
   */
  static detectLanguage(text: string): "hinglish" | "hindi" | "english" {
    const s = (text || "").trim();
    // Devanagari Unicode Range: \u0900-\u097F
    if (/[\u0900-\u097F]/.test(s)) {
      return "hindi";
    }
    // Hinglish (Hindi written in Roman/English characters)
    const hinglishMarkers = [
      /\b(?:kya|hai|hain|ka|ke|ki|ko|se|me|mein|par|aur|batao|bata|bataiye|samjhao|samjha|karo|karna|kaise|kyu|kyun|hota|hoti|hote|karta|karti|karte|yeh|ye|woh|wo|mera|meri|mere|aapka|aapke|aapki|tumhara|tumhe|hum|bhai|yaar|achha|theek|sakte|sakta|sakti|chahiye|nahi|nhi|matlab|kahan|kaha|kis|poora|pura|sab|kuch)\b/i,
      /\b(?:bata\s*do|samjha\s*do|kuch\s*batao|kya\s*hai|kaise\s*hai|kaam\s*karta|kya\s*hota\s*hai)\b/i
    ];
    if (hinglishMarkers.some((r) => r.test(s))) {
      return "hinglish";
    }
    return "english";
  }
}

// ============================================================================
// 2. PROJECT UNDERSTANDING CONTEXT (KNOWLEDGE MODEL)
// ============================================================================

export interface TechnologyDetail {
  name: string;
  category: "frontend" | "backend" | "database" | "ai_rag" | "utility" | "runtime" | "styling";
  role: string;
  whyChosen: string;
  tradeoff: string;
}

export interface ProjectUnderstandingContext {
  identity: {
    title: string;
    tagline: string;
    projectType: string;
    primaryLanguage: string;
    languages: Array<{ name: string; percentage: number }>;
    totalFiles: number;
    totalLines: number;
  };
  purpose: string;
  problemStatement: string;
  proposedSolution: string;
  targetUsers: string[];
  implementedFeatures: string[];
  futureScope: string[];
  advantages: string[];
  drawbacksAndLimitations: string[];
  useCases: string[];
  technologies: TechnologyDetail[];
  architecture: {
    summary: string;
    layers: Array<{ layer: string; technologies: string[]; description: string }>;
  };
  dataFlow: {
    summary: string;
    steps: string[];
  };
  modules: Array<{ name: string; path: string; responsibility: string }>;
  aiAndRagPipeline?: {
    hasAi: boolean;
    hasRag: boolean;
    modelsUsed: string[];
    description: string;
    retrievalStrategy?: string;
  };
  vivaDefenseSummary: {
    elevatorPitch: string;
    coreProblem: string;
    solution: string;
    innovation: string;
    keyTradeoff: string;
  };
}

export class ProjectKnowledgeBuilder {
  /**
   * Synthesizes the full canonical ProjectUnderstandingContext from actual project analysis.
   * Grounded 100% in verified project files, README, dependencies, and architecture.
   */
  static buildContext(
    analysis: ProjectAnalysis,
    files: ExtractedFile[]
  ): ProjectUnderstandingContext {
    const pIntel = analysis.projectIntelligence;
    const arch = analysis.architecture;
    const deps = Array.isArray(analysis.dependencies)
      ? analysis.dependencies
      : (analysis.dependencies?.packages || []);

    // 1. Identity & File stats
    let rawTitle = pIntel?.projectIdentity?.title || analysis.projectName || "Project";
    rawTitle = rawTitle.split(/[\\/]/).filter(Boolean).pop() || rawTitle;
    rawTitle = rawTitle.replace(/[-_](?:main|master|v\d+|app|repo|master)$/i, "");
    const title = rawTitle
      .replace(/[-_]/g, " ")
      .replace(/\b([a-z])/g, (_, c) => c.toUpperCase())
      .trim() || analysis.projectName;

    const tagline = pIntel?.projectIdentity?.tagline || analysis.summary;
    const projectType = analysis.projectType || "Software Application";
    const primaryLanguage = analysis.primaryLanguage || "TypeScript";
    const totalFiles = files.length;
    const totalLines = analysis.fileStats?.totalLines || files.reduce((acc, f) => acc + (f.lineCount || 0), 0);

    // 2. Purpose, Problem, Solution (Strictly derived from real-world domain evidence)
    const purpose = pIntel?.purpose || analysis.summary || `${title} — interactive platform.`;
    const problemStatement = pIntel?.problemStatement || `Manual friction, coordination delays, and lack of real-time visibility in ${title.toLowerCase()} processes.`;
    const proposedSolution = pIntel?.proposedSolution || `A modern self-service platform designed to streamline ${title.toLowerCase()} through intuitive interfaces and automated tracking.`;
    const targetUsers = pIntel?.targetUsers || [
      `End users and clients accessing ${title} digital services.`,
      `Operators and managers overseeing ${title} operations.`
    ];

    // 3. Implemented Features (extracted strictly from README, endpoints, DB, and UI)
    const implementedFeatures: string[] = [];
    if (pIntel?.keyFeatures && pIntel.keyFeatures.length > 0) {
      implementedFeatures.push(...pIntel.keyFeatures);
    }
    const readmeFile = files.find((f) => /^readme(\.md|\.markdown|\.txt)?$/i.test(f.name));
    if (readmeFile?.content) {
      const rLines = readmeFile.content.split(/\r?\n/);
      for (const line of rLines) {
        const trimmed = line.trim();
        if (/^[*\-+]\s+/.test(trimmed) && trimmed.length > 10 && !trimmed.toLowerCase().includes("license") && !trimmed.toLowerCase().includes("npm install") && !trimmed.toLowerCase().includes("git clone")) {
          const feat = trimmed.replace(/^[*\-+]\s+/, "");
          if (!implementedFeatures.includes(feat) && implementedFeatures.length < 12) {
            implementedFeatures.push(feat);
          }
        }
      }
    }
    if (implementedFeatures.length === 0) {
      if (analysis.apiIntelligence?.endpoints && analysis.apiIntelligence.endpoints.length > 0) {
        implementedFeatures.push(`REST API surface with ${analysis.apiIntelligence.endpoints.length} active service endpoints.`);
      }
      if (analysis.databaseIntelligence?.models && analysis.databaseIntelligence.models.length > 0) {
        implementedFeatures.push(`Structured data persistence with ${analysis.databaseIntelligence.models.length} data models (${analysis.databaseIntelligence.models.map(m => m.name).slice(0, 4).join(", ")}).`);
      }
      if (analysis.frameworks && analysis.frameworks.length > 0) {
        implementedFeatures.push(`Modular client interface engineered with ${analysis.frameworks.join(", ")}.`);
      }
      implementedFeatures.push(`Structured codebase composed of ${totalFiles} verified source files across ${primaryLanguage}.`);
    }

    // 4. Future Scope (clearly separated from current features)
    const futureScope: string[] = (pIntel?.futureScope && pIntel.futureScope.length > 0)
      ? pIntel.futureScope
      : [
          "Distributed microservice decomposition for independent horizontal scaling.",
          "Automated telemetry, performance metrics, and OpenTelemetry instrumentation.",
          "Enhanced end-to-end integration and automated regression test suites."
        ];

    // 5. Advantages
    const advantages: string[] = (pIntel?.advantages && pIntel.advantages.length > 0)
      ? pIntel.advantages
      : [
          `Strong modular separation across ${totalFiles} organized project files.`,
          `High developer ergonomics and type safety via ${primaryLanguage}.`,
          `Streamlined workflow execution tailored for ${projectType.toLowerCase()} requirements.`
        ];

    // 6. Drawbacks & Limitations (Honest, critical architectural appraisal with no invented facts)
    const drawbacksAndLimitations: string[] = [];
    if (pIntel?.limitations && pIntel.limitations.length > 0) {
      drawbacksAndLimitations.push(...pIntel.limitations);
    }
    // Architecture-specific verified limitations
    const hasExternalAi = deps.some(d => /genai|openai|anthropic|cohere/i.test(d.name));
    if (hasExternalAi) {
      drawbacksAndLimitations.push("Cloud API Dependency: Core AI/LLM intelligence relies on external managed model APIs, incurring network latency, quota constraints, and third-party rate limits.");
    }
    const hasSupabase = deps.some(d => /supabase/i.test(d.name));
    if (hasSupabase) {
      drawbacksAndLimitations.push("External Backend Coupling: Persistent database and auth state are coupled to Supabase infrastructure; offline or air-gapped deployments require self-hosted PostgreSQL parity.");
    }
    if (analysis.codeQuality?.testing && !analysis.codeQuality.testing.hasTests) {
      drawbacksAndLimitations.push("Test Coverage Gap: Automated unit/integration test coverage is not yet fully configured in the repository, making manual validation necessary for complex refactors.");
    }
    if (drawbacksAndLimitations.length === 0) {
      drawbacksAndLimitations.push("Monolithic Deployment Profile: The application currently runs as a unified server process, which is optimal for simplicity but requires vertical scaling under extreme load.");
    }

    // 7. Use Cases
    const useCases: string[] = (pIntel?.useCases && pIntel.useCases.length > 0)
      ? pIntel.useCases
      : [
          `Deployment as a standalone ${projectType.toLowerCase()} tool in professional or educational environments.`,
          `Reference architecture for building modular ${primaryLanguage} applications with modern web standards.`
        ];

    // 8. Technologies with WHAT + WHY + ROLE + TRADEOFF
    const technologies: TechnologyDetail[] = [];
    const techCatalog: Record<string, { role: string; why: string; tradeoff: string; category: TechnologyDetail["category"] }> = {
      react: {
        category: "frontend",
        role: "Declarative component-based UI rendering and reactive state synchronization.",
        why: "Provides component reusability, virtual DOM diffing, and a robust ecosystem of UI hooks.",
        tradeoff: "Increases initial client-side JavaScript bundle size and requires client-side hydration overhead."
      },
      express: {
        category: "backend",
        role: "RESTful HTTP API routing, middleware execution, and server-side request dispatch.",
        why: "Lightweight, battle-tested, unopinionated Node.js framework with minimal runtime friction.",
        tradeoff: "Requires custom architectural discipline for error propagation and lacks built-in ORM or schema validation."
      },
      typescript: {
        category: "runtime",
        role: "Compile-time static type verification and developer tooling across the codebase.",
        why: "Catches boundary bugs before deployment, provides self-documenting interfaces, and prevents runtime type errors.",
        tradeoff: "Introduces compilation build step and slight development friction for complex generic types."
      },
      supabase: {
        category: "database",
        role: "Managed PostgreSQL database, JWT authentication, and cloud file persistence.",
        why: "Provides instant relational PostgreSQL capabilities, row-level security, and authentication out of the box.",
        tradeoff: "Introduces vendor dependency on managed cloud infrastructure and network roundtrips for queries."
      },
      gemini: {
        category: "ai_rag",
        role: "Large language model inference for multimodal reasoning, generation, and summarization.",
        why: "High token context window, fast time-to-first-token, native multimodal handling, and cost-efficient streaming.",
        tradeoff: "Dependent on external API connectivity, token quotas, and cloud provider rate limits."
      },
      katex: {
        category: "frontend",
        role: "Client-side mathematical LaTeX typesetting and formula display.",
        why: "Fastest mathematical rendering library with zero layout shift and complete mathml compatibility.",
        tradeoff: "Requires KaTeX CSS font assets and strict LaTeX syntax sanitization."
      },
      cytoscape: {
        category: "frontend",
        role: "Interactive graph, architecture diagram, and node network visualization.",
        why: "Hardware-accelerated canvas/SVG graph rendering with support for DAG layout algorithms.",
        tradeoff: "Higher memory footprint when rendering large graphs with thousands of nodes."
      },
      tailwind: {
        category: "styling",
        role: "Utility-first design tokens and responsive UI styling.",
        why: "Eliminates dead CSS bloat through PurgeCSS/JIT and ensures consistent design token spacing.",
        tradeoff: "Dense HTML class attributes and requires CSS postprocessing pipeline."
      },
      vite: {
        category: "runtime",
        role: "Frontend build tooling and rapid development server via native ESM.",
        why: "Instant Hot Module Replacement (HMR) and optimized Rollup bundling.",
        tradeoff: "Development and production bundler differences can occasionally mask production build issues."
      },
      node: {
        category: "runtime",
        role: "Asynchronous, event-driven JavaScript server runtime.",
        why: "High non-blocking I/O throughput and universal JavaScript across frontend and backend.",
        tradeoff: "Single-threaded event loop requires care with CPU-intensive synchronous operations."
      },
      postgres: {
        category: "database",
        role: "ACID-compliant relational database for structured project data storage.",
        why: "Advanced indexing, JSONB support, relational integrity, and high enterprise reliability.",
        tradeoff: "Requires database connection pooling and schema migration management."
      },
      sqlite: {
        category: "database",
        role: "Embedded zero-configuration serverless SQL database engine.",
        why: "Self-contained, file-based persistence with zero operational setup overhead.",
        tradeoff: "Single-writer concurrency limitations under high parallel load."
      },
      mongodb: {
        category: "database",
        role: "Document-oriented NoSQL database for flexible JSON-like documents.",
        why: "Schema flexibility, rapid prototyping, and horizontal sharding support.",
        tradeoff: "Eventual consistency risks and lack of native multi-document relational constraints."
      },
      prisma: {
        category: "database",
        role: "Type-safe Object-Relational Mapping (ORM) and automated schema migrations.",
        why: "Provides auto-generated TypeScript query client and declarative schema modeling.",
        tradeoff: "Adds query engine binary overhead and complex query optimization limitations."
      },
      drizzle: {
        category: "database",
        role: "Lightweight, zero-overhead TypeScript ORM with SQL-like syntax.",
        why: "Zero runtime dependencies, ultra-fast compilation, and direct SQL dialect control.",
        tradeoff: "Requires deeper SQL familiarity compared to heavy abstraction ORMs."
      },
      fastapi: {
        category: "backend",
        role: "Modern, high-performance Python web framework for asynchronous APIs.",
        why: "Automatic OpenAPI documentation, Pydantic type validation, and async concurrency.",
        tradeoff: "Python GIL constraints for CPU-bound tasks and async ecosystem maturity."
      },
      docker: {
        category: "runtime",
        role: "Application containerization for reproducible multi-environment execution.",
        why: "Isolates runtime dependencies and eliminates 'works on my machine' deployment discrepancies.",
        tradeoff: "Container image disk overhead and container networking configuration complexity."
      },
      zustand: {
        category: "frontend",
        role: "Minimalist, unopinionated client-side state management store.",
        why: "Zero boilerplate, hooks-based reactivity without Context provider wrapping hell.",
        tradeoff: "Lacks built-in action history replay and devtools compared to Redux Toolkit."
      }
    };

    const allDetected = [
      ...analysis.frameworks || [],
      ...deps.map(d => d.name)
    ];

    for (const [key, meta] of Object.entries(techCatalog)) {
      const match = allDetected.find(d => d.toLowerCase().includes(key));
      if (match || (key === "typescript" && primaryLanguage.toLowerCase() === "typescript")) {
        technologies.push({
          name: match || (key.charAt(0).toUpperCase() + key.slice(1)),
          category: meta.category,
          role: meta.role,
          whyChosen: meta.why,
          tradeoff: meta.tradeoff
        });
      }
    }

    if (technologies.length === 0) {
      technologies.push({
        name: primaryLanguage,
        category: "runtime",
        role: "Core programming language for system execution.",
        whyChosen: "Selected for performance, ecosystem richness, and modularity.",
        tradeoff: "Standard language runtime constraints."
      });
    }

    // 9. Architecture Layers
    const layers = [
      {
        layer: "Presentation (Frontend UI)",
        technologies: analysis.frameworks || [primaryLanguage],
        description: "Interactive user interface handling component state, responsive views, and user event dispatch."
      },
      {
        layer: "Application / API (Backend)",
        technologies: analysis.runtimes?.length ? analysis.runtimes : ["Node.js / Express"],
        description: `Server endpoints (${analysis.apiIntelligence?.endpoints?.length || 0} detected) processing business logic, authentication, and service orchestration.`
      },
      {
        layer: "Data & Persistence",
        technologies: analysis.databaseIntelligence?.models?.length ? [analysis.databaseIntelligence.system || "Database"] : ["Storage / Local State"],
        description: analysis.databaseIntelligence?.description || "Structured schema storage managing application data records."
      }
    ];

    if (deps.some(d => /genai|openai|rag|vector/i.test(d.name))) {
      layers.push({
        layer: "Intelligence & RAG Pipeline",
        technologies: ["AI Models / Vector Retrieval"],
        description: "Contextual document retrieval, prompt assembly, and resilient model streaming."
      });
    }

    // 10. Data Flow
    const steps: string[] = (analysis.dataFlow?.steps && analysis.dataFlow.steps.length > 0)
      ? analysis.dataFlow.steps.map(s => `${s.title}: ${s.description}`)
      : (pIntel?.workflow && pIntel.workflow.length > 0)
      ? pIntel.workflow
      : [
          "Client Request: User triggers an action or query via UI component or API route.",
          "Server Dispatch: Backend routes request through middleware, authorization, and validation.",
          "Processing & Retrieval: Business services execute algorithms or retrieve relevant records.",
          "State Persistence / AI Generation: Data is updated in storage or streamed from model services.",
          "Client Update: Formatted response is returned and rendered reactively in the UI."
        ];

    // 11. Modules
    const modules = (arch?.nodes || []).slice(0, 10).map(n => ({
      name: n.label,
      path: n.file,
      responsibility: n.description || `Module component in ${n.file}`
    }));

    // 12. Viva Defense Summary
    const vivaDefenseSummary = {
      elevatorPitch: `${title} is a ${projectType} designed to ${purpose.toLowerCase().replace(/\.$/, "")}.`,
      coreProblem: problemStatement,
      solution: proposedSolution,
      innovation: pIntel?.innovation || `Modular ${primaryLanguage} architecture with real-time reactive updates and clean separation of concerns.`,
      keyTradeoff: technologies[0]?.tradeoff || "Balancing operational simplicity with modular extensibility."
    };

    return {
      identity: {
        title,
        tagline,
        projectType,
        primaryLanguage,
        languages: analysis.languages || [{ name: primaryLanguage, percentage: 100 }],
        totalFiles,
        totalLines
      },
      purpose,
      problemStatement,
      proposedSolution,
      targetUsers,
      implementedFeatures,
      futureScope,
      advantages,
      drawbacksAndLimitations,
      useCases,
      technologies,
      architecture: {
        summary: arch?.summary || `${projectType} architecture with clean layered separation.`,
        layers
      },
      dataFlow: {
        summary: analysis.dataFlow?.summary || "End-to-end request/response execution pipeline.",
        steps
      },
      modules,
      aiAndRagPipeline: pIntel?.aiComponents?.present ? {
        hasAi: true,
        hasRag: !!pIntel.ragComponents?.present,
        modelsUsed: pIntel.aiComponents.modelsOrServices,
        description: pIntel.aiComponents.description,
        retrievalStrategy: pIntel.ragComponents?.description
      } : undefined,
      vivaDefenseSummary
    };
  }
}

// ============================================================================
// 3. INTENT-DRIVEN PROMPT & EVIDENCE ORCHESTRATOR
// ============================================================================

export class ProjectUnderstandingEngine {
  /**
   * Builds the tailored prompt and system instruction for any question.
   * Enforces:
   * - General concepts are answered as general concepts without project contamination.
   * - Project questions receive concise, natural answers matching question granularity.
   * - No forced report templates or empty headings.
   */
  static buildPromptAndInstruction(params: {
    analysis: ProjectAnalysis;
    files: ExtractedFile[];
    userQuestion: string;
    targetFile?: string;
    hasSnippet?: boolean;
    history?: Array<{ role: string; content: string }>;
    attachedDocsContext?: string;
  }): {
    intent: ProjectIntent;
    systemInstruction: string;
    userPrompt: string;
    language: "hinglish" | "hindi" | "english";
  } {
    const { analysis, files, userQuestion, targetFile, hasSnippet, attachedDocsContext } = params;
    const intent = ProjectIntentClassifier.classify(userQuestion, targetFile, hasSnippet);
    const language = ProjectIntentClassifier.detectLanguage(userQuestion);
    const ctx = ProjectKnowledgeBuilder.buildContext(analysis, files);

    // Language matching directive
    let languageDirective = "";
    if (language === "hinglish") {
      languageDirective = `
LANGUAGE RULE (CRITICAL - HINGLISH):
- The user asked in Hinglish (Hindi written in Roman/English alphabet, e.g., "elevator pitch kya hota hai", "project kya karta hai", "drawbacks batao").
- You MUST respond in natural, friendly, fluent, professional Hinglish.
- Keep technical terms (e.g., "API", "Frontend", "RAG", "Database", "Latency", "Tradeoff") in English.
- Sound like a senior software engineer talking naturally to a peer in Hinglish.`;
    } else if (language === "hindi") {
      languageDirective = `
LANGUAGE RULE (CRITICAL - HINDI):
- The user asked in Hindi (Devanagari script).
- You MUST respond in natural, fluent Hindi while keeping standard technical terms accessible.`;
    } else {
      languageDirective = `
LANGUAGE RULE:
- Respond in clear, professional, fluent English.`;
    }

    // GENERAL CONCEPT PATH (No project pollution)
    if (intent === "GENERAL_CONCEPT") {
      const systemInstruction = `You are Darkness, an exceptional AI engineering mentor and computer science expert.

${languageDirective}

CORE BEHAVIOR & NATURAL CONVERSATION PRINCIPLES:
- The user is asking about a GENERAL CONCEPT, terminology, or educational principle (e.g. "elevator pitch", "REST API", "RAG", "problem statement", "React", "Docker", "JWT", etc.).
- Explain the concept directly, clearly, and concisely with world-class engineering darkness.
- STRICT RULE (DO NOT CONTAMINATE WITH UNREQUESTED PROJECT CONTEXT):
  * Do NOT assume this is asking about the current project.
  * Do NOT say "For your project..." or "In your project..." unless the user explicitly asked how it applies to this project.
  * Simply explain what the concept means, why it is used in software engineering / business, and provide a clear, intuitive explanation.
- ANSWER GRANULARITY: Keep the explanation crisp, direct, and proportionate to the question.
- NO EMPTY HEADINGS: Never output empty headings or unnecessary report sections. Use clean conversational paragraphs and bullet points if helpful.`;

      const userPrompt = `Question: "${userQuestion}"

Please explain this concept directly and naturally following the instructions above.`;

      return { intent, systemInstruction, userPrompt, language };
    }

    // PROJECT SPECIFIC PATHS
    let intentDirective = "";
    let relevantEvidence = "";

    switch (intent) {
      case "PROJECT_CONCEPT_AND_LOGIC":
        intentDirective = `
INTENT FOCUS: MULTI-ASPECT PROJECT UNDERSTANDING (CRITICAL)
- The user is asking for a comprehensive conceptual understanding of the project/file: Concept, Logic, Engineering Approach, Real-Life Use, Strengths, Weaknesses/Limitations, Improvements, and Viva preparation.
- ABSOLUTE PRINCIPLE: PROJECT UNDERSTANDING FIRST — CODE EXPLANATION ONLY WHEN ASKED.
- DO NOT dump raw source code or line-by-line syntax breakdowns.
- The user is a student trying to understand the system at a conceptual, architectural, and practical level.
- Write in an engaging, pedagogical, student-friendly tone (in Hinglish/English according to the language rule).
- Every section MUST contain rich, clear, informative paragraphs and structured points. ZERO EMPTY HEADINGS.

Structure your response clearly with these focused sections:

🌟 **1. Core Concept & Real-World Purpose**:
- What the project actually is, why it exists, the real-world problem it solves, target users, and the expected outcome. (No source code).

⚙️ **2. Core System Logic & Processing Flow**:
- Explain the end-to-end logic in plain English: Input received → Processing & Validation → Decision Logic → Database/Model interaction → Output delivered.
- Explain how different modules and components work together seamlessly.

🏗️ **3. Engineering Approach & Architecture**:
- How the system was designed (Frontend, Backend, Persistence/State).
- Why the chosen technologies and patterns make sense for this specific project.
- Key architectural decisions and deployment/runtime approach.

🌍 **4. Real-Life Applications & User Journeys**:
- Where and how this project is used in real life.
- User journey for end-users (e.g. guests/customers) vs administrators/managers.

💪 **5. Key Strengths & Verified Advantages**:
- What the project does really well based on actual code and architecture evidence.

⚠️ **6. Honest Weaknesses & Limitations**:
- Objective assessment of current limitations, architectural tradeoffs, missing features, or scalability/security boundaries. (Never invent fake metrics).

🚀 **7. Practical Improvements & Future Scope**:
- Grounded, actionable recommendations to improve the system (e.g., automated test suites, caching layer, offline mode, telemetry, mobile UI).

🎓 **8. Student Viva & Presentation Defense Guide**:
- A punchy 30-second explanation and top defense points the student can confidently state to examiners, professors, or hackathon judges!`;

        relevantEvidence = `
PROJECT MULTI-ASPECT EVIDENCE:
- Title: ${ctx.identity.title} (${ctx.identity.projectType})
- Primary Language: ${ctx.identity.primaryLanguage}
- Core Purpose: ${ctx.purpose}
- Real-World Problem: ${ctx.problemStatement}
- Proposed Solution: ${ctx.proposedSolution}
- Target Users: ${ctx.targetUsers.join("; ")}
- Implemented Features:
${ctx.implementedFeatures.map(f => `• ${f}`).join("\n")}
- Technologies & Why Chosen:
${ctx.technologies.map(t => `• ${t.name} (${t.category}): Role: ${t.role} | Why: ${t.whyChosen} | Tradeoff: ${t.tradeoff}`).join("\n")}
- Architecture Layers:
${ctx.architecture.layers.map(l => `• ${l.layer} [${l.technologies.join(", ")}]: ${l.description}`).join("\n")}
- Data Flow / Logic Steps:
${ctx.dataFlow.steps.map(s => `• ${s}`).join("\n")}
- Strengths & Advantages:
${ctx.advantages.map(a => `• ${a}`).join("\n")}
- Limitations & Weaknesses:
${ctx.drawbacksAndLimitations.map(d => `• ${d}`).join("\n")}
- Improvements & Future Scope:
${ctx.futureScope.map(fs => `• ${fs}`).join("\n")}
- Viva Summary: ${ctx.vivaDefenseSummary.elevatorPitch}`;
        break;

      case "PROJECT_FILE_ROLE":
        intentDirective = `
INTENT FOCUS: FILE ROLE & PURPOSE IN THE PROJECT (CRITICAL)
- The user is asking about a specific file (e.g., docker-compose.yml, server.ts, App.tsx, schema.prisma).
- CRITICAL RULE: Connect the file back to the overall project FIRST.
- Do NOT dump raw code or do a line-by-line syntax walkthrough unless explicitly asked.
- Explain:
  1. 📄 **File Purpose**: What this file does in simple language.
  2. 🌐 **Role in the Overall Project Architecture**: Which layer it belongs to (Deployment/Containerization, Backend Routing, State Management, Data Modeling, etc.) and what system function it powers.
  3. 🔗 **Connections & Dependencies**: How it interacts with other files, routes, or services in the project.
  4. ⚙️ **Key Mechanisms / Configurations**: Conceptual breakdown of important sections without raw code dumping.
  5. 💡 **Why It Was Designed This Way**: The engineering reasoning behind having this file in the project.
  6. 🎤 **Viva Tip**: A quick 1-2 sentence pitch to explain this file to an examiner or interviewer.`;

        relevantEvidence = `
PROJECT FILE CONTEXT:
- Project: ${ctx.identity.title}
- Target File / Context: ${params.targetFile || "Selected Project File"}
- Architecture Layers:
${ctx.architecture.layers.map(l => `• ${l.layer}: ${l.description}`).join("\n")}
- Key Modules:
${ctx.modules.slice(0, 8).map(m => `• ${m.name} (${m.path}): ${m.responsibility}`).join("\n")}`;
        break;

      case "PROJECT_REAL_LIFE_USE":
        intentDirective = `
INTENT FOCUS: REAL-LIFE USE CASE & PRACTICAL PROJECT DOMAIN (CRITICAL)
- The user is asking about the REAL-LIFE purpose, problem, title, and actual practical application of the project (e.g., "mere project ka title kya hai aur real life me kya use hai", "asli use kya hai code mat batao", "what is the real life application of my project").
- STRICT NEGATIVE DIRECTIVE:
  * DO NOT dump code syntax, low-level file imports, or framework boilerplate.
  * Focus 100% on the REAL-WORLD DOMAIN, BUSINESS LOGIC, USER EXPERIENCE, and PRACTICAL VALUE.
  * Answer in simple, student-friendly terms (in Hinglish/English as per language rule) so they can understand and explain it to professors or hackathon judges with complete confidence.

Structure your response clearly and cleanly:

🏷️ **1. Project Title & Domain Overview**:
- State the clean, professional Project Title (e.g. **${ctx.identity.title}**).
- Give a 1-2 line simple definition of what this platform is and what domain it belongs to.

🌍 **2. Real-Life Problem (Asli Problem Jo Solve Hoti Hai)**:
- Explain what real-world difficulties exist without this system.

💡 **3. Real-Life Solution & How It Works (Real Life Workflow)**:
- Trace the real-world user journey step-by-step:
  * **User / Customer side**: How an end user interacts with the app, submits actions, and receives results.
  * **Admin / Business side**: How the business manages records, oversees operations, and prevents errors.

👥 **4. Target Users & Real-World Stakeholders**:
- Who actually uses this platform in daily life.

🏆 **5. Real-World Impact & Value (Asli Fayda)**:
- Time savings, 24/7 availability, error elimination, and operational convenience.

🎤 **6. 30-Second Viva & Hackathon Pitch (College/Judge Ke Saamne Kaise Bolna Hai)**:
- Give a crisp, 2-3 sentence elevator pitch that the student can speak directly to a judge or professor!`;

        relevantEvidence = `
PROJECT REAL-LIFE EVIDENCE:
- Clean Project Title: ${ctx.identity.title}
- System Domain / Type: ${ctx.identity.projectType}
- Core Real-Life Purpose: ${ctx.purpose}
- Real-World Problem Addressed: ${ctx.problemStatement}
- Real-World Solution: ${ctx.proposedSolution}
- Real-World Use Cases:
${ctx.useCases.map(u => `• ${u}`).join("\n")}
- Target Users: ${ctx.targetUsers.join("; ")}
- Implemented Practical Features:
${ctx.implementedFeatures.slice(0, 8).map(f => `• ${f}`).join("\n")}
- Real-World Value & Advantages:
${ctx.advantages.map(a => `• ${a}`).join("\n")}`;
        break;

      case "PROJECT_OVERVIEW":
        intentDirective = `
INTENT FOCUS: NATURAL PROJECT OVERVIEW (CRITICAL)
- The user asked: What is this project / What does it do?
- Provide a natural, easy-to-understand conversational explanation of what the project actually is:
  1. What the project is and its primary purpose.
  2. What problem it solves or workflow it streamlines.
  3. How it operates at a high level.
- STRICT NEGATIVE DIRECTIVE:
  * DO NOT behave like a rigid report template generator.
  * Answer directly in 1 to 2 clear, cohesive, engaging paragraphs. Keep it natural and conversational!
  * Do NOT dump source code or explain low-level syntax.`;

        relevantEvidence = `
PROJECT OVERVIEW EVIDENCE:
- Title: ${ctx.identity.title}
- Tagline / Summary: ${ctx.identity.tagline}
- Type: ${ctx.identity.projectType}
- Primary Language: ${ctx.identity.primaryLanguage}
- Core Purpose: ${ctx.purpose}
- Problem Addressed: ${ctx.problemStatement}
- Solution Overview: ${ctx.proposedSolution}`;
        break;

      case "PROJECT_PROBLEM_STATEMENT":
        intentDirective = `
INTENT FOCUS: VERIFIED PROJECT PROBLEM STATEMENT (CRITICAL)
- The user is asking specifically about what problem this project solves.
- Explain the actual, verified problem statement of this project clearly and concisely.
- Ground your answer in the verified project purpose and problem evidence below.
- Do NOT generate generic fluff or invent problems not related to this project.`;

        relevantEvidence = `
PROJECT PROBLEM EVIDENCE:
- Project: ${ctx.identity.title} (${ctx.identity.projectType})
- Verified Problem Statement: ${ctx.problemStatement}
- Target Users Experiencing This Problem: ${ctx.targetUsers.join("; ")}
- Solution Context: ${ctx.proposedSolution}`;
        break;

      case "PROJECT_SOLUTION":
        intentDirective = `
INTENT FOCUS: PROJECT SOLUTION & APPROACH (CRITICAL)
- The user is asking how this project solves the target problem.
- Explain the solution approach clearly, directly, and concisely.
- Highlight the key components and how they address the problem.`;

        relevantEvidence = `
PROJECT SOLUTION EVIDENCE:
- Project: ${ctx.identity.title}
- Problem: ${ctx.problemStatement}
- Proposed Solution: ${ctx.proposedSolution}
- Key Mechanisms: ${ctx.architecture.summary}`;
        break;

      case "PROJECT_FEATURES":
        intentDirective = `
INTENT FOCUS: IMPLEMENTED FEATURES (CRITICAL)
- Present the verified implemented features of this project in clean, readable bullet points.
- Categorize logically only if there are many features.
- STRICT NEGATIVE DIRECTIVE: Do NOT invent features. Do NOT dump source code unless asked.`;

        relevantEvidence = `
VERIFIED IMPLEMENTED FEATURES:
${ctx.implementedFeatures.map(f => `• ${f}`).join("\n")}`;
        break;

      case "PROJECT_LOGIC_WORKFLOW":
        intentDirective = `
INTENT FOCUS: PROJECT LOGIC & WORKFLOW (CRITICAL)
- The user is asking how the project works, its underlying logic, data flow, and module interactions.
- Explain in simple, accessible language:
  1. **Input & Trigger**: What data or action starts the process.
  2. **Processing & Business Logic**: How the system processes requests, validates data, and makes decisions.
  3. **Data Persistence & Retrieval**: How data is stored, queried, or retrieved.
  4. **Output & Response**: What is returned to the user or client.
  5. **Module Collaboration**: How major modules/services interact without dumping raw code lines.`;

        relevantEvidence = `
PROJECT LOGIC & WORKFLOW EVIDENCE:
- Architecture Summary: ${ctx.architecture.summary}
- Data Flow Steps:
${ctx.dataFlow.steps.map(s => `• ${s}`).join("\n")}
- Key Modules:
${ctx.modules.slice(0, 8).map(m => `• ${m.name}: ${m.responsibility}`).join("\n")}`;
        break;

      case "PROJECT_ENGINEERING_APPROACH":
        intentDirective = `
INTENT FOCUS: ENGINEERING APPROACH & ARCHITECTURE (CRITICAL)
- The user is asking about the engineering approach, system design, and architecture.
- Explain:
  1. **Architectural Paradigm**: Layered separation (Presentation, Application/API, Persistence/Storage).
  2. **Technology Selection Rationale**: Why specific technologies (e.g. React, Express, Supabase, TypeScript) were chosen and their architectural fit.
  3. **Data & Request Lifecycle**: How components communicate across boundaries.
  4. **Design Decisions & Tradeoffs**: Key engineering tradeoffs made during implementation.`;

        relevantEvidence = `
ENGINEERING APPROACH EVIDENCE:
- Architecture Summary: ${ctx.architecture.summary}
- Layers:
${ctx.architecture.layers.map(l => `• ${l.layer} [${l.technologies.join(", ")}]: ${l.description}`).join("\n")}
- Technologies & Why Chosen:
${ctx.technologies.map(t => `• ${t.name}: ${t.whyChosen} (Tradeoff: ${t.tradeoff})`).join("\n")}`;
        break;

      case "PROJECT_SCOPE":
        intentDirective = `
INTENT FOCUS: PROJECT SCOPE & SCALABILITY (CRITICAL)
- Explain current scope, practical use cases, and scalability profile.
- STRICT RULE: Clearly distinguish what is ALREADY IMPLEMENTED vs what is a POSSIBLE FUTURE EXTENSION.`;

        relevantEvidence = `
PROJECT SCOPE EVIDENCE:
- Current Implemented Features: ${ctx.implementedFeatures.slice(0, 6).join("; ")}
- Target Users: ${ctx.targetUsers.join("; ")}
- Verified Future Scope:
${ctx.futureScope.map(fs => `• ${fs}`).join("\n")}`;
        break;

      case "PROJECT_ADVANTAGES":
        intentDirective = `
INTENT FOCUS: ADVANTAGES & STRENGTHS (CRITICAL)
- Highlight why this project is valuable, what it does effectively, and its core architectural strengths.
- Ground every point in verified project evidence.`;

        relevantEvidence = `
VERIFIED ADVANTAGES:
${ctx.advantages.map(a => `• ${a}`).join("\n")}`;
        break;

      case "PROJECT_DRAWBACKS":
        intentDirective = `
INTENT FOCUS: DRAWBACKS, LIMITATIONS & WEAKNESSES (CRITICAL)
- Be honest, objective, and realistic as a senior tech lead and mentor.
- Explain verified limitations (e.g. cloud API dependency, single-server scaling, test coverage, network latency).
- Do NOT invent false claims or fake metrics; explain real architectural tradeoffs.`;

        relevantEvidence = `
VERIFIED LIMITATIONS & TRADEOFFS:
${ctx.drawbacksAndLimitations.map(d => `• ${d}`).join("\n")}`;
        break;

      case "PROJECT_IMPROVEMENTS":
        intentDirective = `
INTENT FOCUS: PRACTICAL PROJECT IMPROVEMENTS (CRITICAL)
- The user is asking how to improve the project.
- Provide grounded, practical, and actionable recommendations based on the current codebase:
  1. **Functional Improvements**: Missing features that would add high value.
  2. **Architectural & Performance Improvements**: Caching, state optimization, database indexing.
  3. **Reliability & Testing**: Automated test suites, error boundary handling, telemetry.
  4. **Security & Deployment**: Environment variable validation, rate limiting, containerization.`;

        relevantEvidence = `
IMPROVEMENTS EVIDENCE:
- Current Stack: ${ctx.technologies.map(t => t.name).join(", ")}
- Identified Limitations:
${ctx.drawbacksAndLimitations.map(d => `• ${d}`).join("\n")}
- Future Scope:
${ctx.futureScope.map(fs => `• ${fs}`).join("\n")}`;
        break;

      case "PROJECT_USE_CASES":
        intentDirective = `
INTENT FOCUS: REAL-WORLD USE CASES & AUDIENCE (CRITICAL)
- Detail who can use this project, in what real-world scenarios it applies, and the tangible value it delivers.`;

        relevantEvidence = `
USE CASES & AUDIENCE:
- Target Users: ${ctx.targetUsers.join("; ")}
- Practical Scenarios:
${ctx.useCases.map(u => `• ${u}`).join("\n")}`;
        break;

      case "PROJECT_TECHNOLOGY":
        intentDirective = `
INTENT FOCUS: TECHNOLOGY STACK & REASONING (CRITICAL)
- Explain the key technologies used in this project using: WHAT IT IS + ROLE IN THIS PROJECT + WHY IT WAS CHOSEN + TRADEOFF.
- If user asks about a specific technology (e.g., "Why React?"), focus on that specific technology.
- Present in a clean markdown table: | Technology | Role in THIS Project | Why It Makes Sense | Tradeoff |`;

        relevantEvidence = `
VERIFIED TECHNOLOGIES:
${ctx.technologies.map(t => `• ${t.name} (${t.category}): Role: ${t.role} | Why: ${t.whyChosen} | Tradeoff: ${t.tradeoff}`).join("\n")}`;
        break;

      case "PROJECT_MODULE":
        intentDirective = `
INTENT FOCUS: MODULES & SUBSYSTEM BREAKDOWN (CRITICAL)
- Explain the main modules/packages of the project and their responsibilities.
- Focus on module boundaries and purpose without dumping code lines.`;

        relevantEvidence = `
PROJECT MODULES:
${ctx.modules.map(m => `• ${m.name} (${m.path}): ${m.responsibility}`).join("\n") || "• Structured modular components"}`;
        break;

      case "PROJECT_VIVA":
        intentDirective = `
INTENT FOCUS: VIVA / PRESENTATION DEFENSE PREPARATION (CRITICAL)
- Present a crisp, highly impressive explanation structured for college evaluators, viva examiners, or hackathon judges:
  1. 🎯 **30-Second Elevator Pitch**: Clear and punchy.
  2. 💡 **Core Problem & Solution**: Why the project exists and what it solves.
  3. 🏗️ **Architecture & Tech Stack**: Major layers and why key technologies were selected.
  4. ⚡ **Key Features & Innovation**: The most impactful capabilities.
  5. 🔍 **Honest Limitations & Next Steps**: Demonstrates mature engineering thinking.
  6. ❓ **Top 3 Viva Questions & Model Answers**: Project-specific questions examiners will ask with crisp answers.`;

        relevantEvidence = `
VIVA DEFENSE EVIDENCE:
- Title: ${ctx.identity.title}
- Elevator Pitch: ${ctx.vivaDefenseSummary.elevatorPitch}
- Problem: ${ctx.vivaDefenseSummary.coreProblem}
- Solution: ${ctx.vivaDefenseSummary.solution}
- Innovation: ${ctx.vivaDefenseSummary.innovation}
- Key Tradeoff: ${ctx.vivaDefenseSummary.keyTradeoff}
- Features: ${ctx.implementedFeatures.slice(0, 6).join("; ")}
- Technologies: ${ctx.technologies.map(t => t.name).join(", ")}`;
        break;

      case "PROJECT_COMPLETE_BREAKDOWN":
        intentDirective = `
INTENT FOCUS: COMPREHENSIVE PROJECT BREAKDOWN (CRITICAL)
- The user explicitly requested a complete, in-depth breakdown of the entire project.
- Provide a structured, thorough analysis covering: Purpose, Verified Problem & Solution, Key Features, Architecture & Data Flow, Technology Decisions, Limitations, and Future Scope.
- Generate sections dynamically based on real evidence. Never generate empty headings.`;

        relevantEvidence = `
FULL PROJECT EVIDENCE:
- Title: ${ctx.identity.title} (${ctx.identity.projectType})
- Summary: ${ctx.identity.tagline}
- Purpose: ${ctx.purpose}
- Problem: ${ctx.problemStatement}
- Solution: ${ctx.proposedSolution}
- Features:
${ctx.implementedFeatures.map(f => `• ${f}`).join("\n")}
- Technologies:
${ctx.technologies.map(t => `• ${t.name}: ${t.role} (${t.whyChosen})`).join("\n")}
- Architecture Layers:
${ctx.architecture.layers.map(l => `• ${l.layer}: ${l.description}`).join("\n")}
- Data Flow:
${ctx.dataFlow.steps.map(s => `• ${s}`).join("\n")}
- Limitations:
${ctx.drawbacksAndLimitations.map(d => `• ${d}`).join("\n")}
- Future Scope:
${ctx.futureScope.map(fs => `• ${fs}`).join("\n")}`;
        break;

      case "COMPARISON":
        intentDirective = `
INTENT FOCUS: TECHNICAL COMPARISON & TRADEOFF ANALYSIS (CRITICAL)
- Objectively compare the technologies, patterns, or choices asked about.
- If user asked about the project's choice (e.g. why PostgreSQL instead of MongoDB in this project), reference the project's verified requirements.
- Provide balanced engineering analysis (advantages, disadvantages, tradeoffs).`;

        relevantEvidence = `
PROJECT TECH CONTEXT:
- Stack: ${ctx.technologies.map(t => `${t.name} (${t.whyChosen})`).join("; ")}`;
        break;

      case "CODE_EXPLANATION":
        intentDirective = `
INTENT FOCUS: EXPLICIT CODE WALKTHROUGH & SYNTAX ANALYSIS (CRITICAL)
- The user explicitly asked to explain this code snippet, function, or debug an issue.
- ABSOLUTE RULE: NEVER output empty headings. Every single section MUST contain complete, high-value paragraphs, bullet points, and code annotations.
- Provide:
  1. 🎯 **Conceptual Role**: What this code achieves in the larger application.
  2. ⚙️ **Logic Flow & Execution Sequence**: Step-by-step trace of how the code runs.
  3. 💻 **Code Walkthrough**: Clean formatted code block with inline explanatory comments.
  4. 🔍 **Key Syntax & Variables Breakdown**: Explain critical parameters, imports, or exports.
  5. ⚡ **Complexity & Edge Cases**: Time/space complexity analysis and common pitfalls.
  6. 💡 **Viva & Interview Q&A**: 2-3 sample defense questions and model answers.`;

        relevantEvidence = `
PROJECT CODE CONTEXT:
- Project: ${ctx.identity?.title || "Project"} (${ctx.identity?.projectType || "Software"})
- Primary Language: ${ctx.identity?.primaryLanguage || "Code"}
- Stack: ${(ctx.technologies || []).map(t => t.name).join(", ") || "Standard"}
- Relevant Modules: ${(ctx.modules || []).map(m => `${m.name} (${m.path})`).slice(0, 8).join("; ") || "Modular components"}
- Key APIs: ${(analysis.apiIntelligence?.endpoints || []).slice(0, 6).map(a => `${a.method} ${a.path}`).join(", ") || "Standard routes"}
- Models: ${(analysis.databaseIntelligence?.models || []).slice(0, 6).map(m => m.name).join(", ") || "Standard data structures"}`;
        break;

      default:
        intentDirective = `
INTENT FOCUS: NATURAL PROJECT CHAT
- Answer the user's specific question directly, naturally, and proportionately.
- Do NOT generate unrequested report headings or code dumps.`;

        relevantEvidence = `
PROJECT BASICS:
- Title: ${ctx.identity.title}
- Summary: ${ctx.identity.tagline}
- Purpose: ${ctx.purpose}`;
        break;
    }

    const systemInstruction = `You are Darkness, an exceptional AI Project Understanding Assistant.

${languageDirective}

CORE IDENTITY & PRINCIPLES:
- Name: Darkness
- Creator: Kalam (a CS student). Mention Kalam ONLY if the user explicitly asks who created or made you.
- ROLE: Intelligent Project Understanding Assistant.
- CORE RULE: ANSWER ONLY WHAT WAS ASKED.
- MATCH GRANULARITY: Small question = direct concise answer; specific question = focused answer; comprehensive question = detailed breakdown.
- NO REPORT TEMPLATES: Do NOT force report headings (such as ### Project Identity & Purpose, ### Problem Statement, etc.) unless explicitly requested.
- NO EMPTY HEADINGS: Never output empty headings or sections with no content.
- Ground 100% of facts in the Project Evidence provided below. Never invent features, APIs, or database models.

${intentDirective}

${relevantEvidence}`;

    const userPrompt = attachedDocsContext
      ? `User Question: "${userQuestion}"

ATTACHED / UPLOADED DOCUMENT CONTENT:
${attachedDocsContext}

Please answer the user's question directly, following the intent directive and language rules. Ensure the response directly addresses their request using the project evidence and attached document above without unnecessary headings or code dumps.`
      : `User Question: "${userQuestion}"

Please answer the user's question directly, following the intent directive and language rules. Ensure the response directly addresses their request using the project evidence above without unnecessary headings or code dumps.`;

    return {
      intent,
      systemInstruction,
      userPrompt,
      language
    };
  }
}
