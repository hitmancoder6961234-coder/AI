/**
 * CLARITY UNIFIED ANSWER ENGINE
 * 
 * The single, central AnswerEngine class shared across all backend and frontend chat surfaces.
 * Dynamically plans response structures based on query intent and available context,
 * strictly avoiding hard-coded report templates, eliminating empty headings,
 * and ensuring rich, natural, and high-density explanations.
 */

import path from "path";

export type UnifiedIntent =
  | "GREETING_OR_CHITCHAT"
  | "PROJECT_REAL_WORLD_USE"
  | "PROJECT_CONCEPT_AND_LOGIC"
  | "PROJECT_FILE_ROLE"
  | "PROJECT_PROBLEM_STATEMENT"
  | "PROJECT_SOLUTION"
  | "PROJECT_FEATURES"
  | "PROJECT_LOGIC_WORKFLOW"
  | "PROJECT_ENGINEERING_APPROACH"
  | "PROJECT_IMPROVEMENTS"
  | "PROJECT_VIVA"
  | "PROJECT_ARCHITECTURE_QUERY"
  | "PROJECT_DATA_FLOW"
  | "PROJECT_FILE_STRUCTURE"
  | "PROJECT_DEPENDENCY_ANALYSIS"
  | "PROJECT_API_ROUTE"
  | "CODE_EXPLANATION"
  | "CONCEPTUAL_EXPLANATION"
  | "MATH_ALGORITHMIC_SOLVER"
  | "DOCUMENT_RAG_QUERY"
  | "IMAGE_GENERATION"
  | "DIAGRAM_REQUEST"
  | "ARTIFACT_GENERATION"
  | "GENERAL_CHAT";

export interface AnswerEngineContext {
  projectId?: string | null;
  hasFiles?: boolean;
  fileIds?: string[];
  history?: Array<{ role: string; content: string }>;
  attachedDocs?: string;
  hasKnowledgeBase?: boolean;
  targetFile?: string;
}

export interface ResponsePlan {
  intent: UnifiedIntent;
  systemInstruction: string;
  promptText: string;
  suggestedHeadingHierarchy: string[];
  resolvedContext?: ResolvedContextResult;
}

export interface ResolvedContextResult {
  isFollowUp: boolean;
  requiresClarification?: boolean;
  activeTopic?: string | null;
  resolvedQuery: string;
  overrideIntent?: UnifiedIntent;
}

export class AnswerEngine {
  /**
   * RESOLVE FOLLOW-UP CONTEXT
   * Analyzes prior conversation history to resolve pronouns, short follow-up directives,
   * active learning modes, and active topics BEFORE intent classification.
   */
  static resolveFollowUpContext(
    query: string,
    history?: Array<{ role: string; content: string }>
  ): ResolvedContextResult {
    const rawQuery = (query || "").trim();
    const q = rawQuery.toLowerCase();

    if (!history || !Array.isArray(history) || history.length === 0) {
      if (/^(?:continue|aage\s*batao|next|go\s*on|carry\s*on|more)\b\??$/i.test(q)) {
        return {
          isFollowUp: true,
          requiresClarification: true,
          resolvedQuery: "What specific topic or question would you like to discuss or continue?",
          activeTopic: null,
        };
      }
      return { isFollowUp: false, resolvedQuery: rawQuery };
    }

    const recentTurns = history.slice(-6);
    const lastAssistantMsg = [...recentTurns].reverse().find(m => (m.role || "").toLowerCase() === "assistant" || (m.role || "").toLowerCase() === "model")?.content || "";
    const lastUserMsg = [...recentTurns].reverse().find(m => (m.role || "").toLowerCase() === "user" && m.content !== rawQuery)?.content || "";

    let activeTopic = "";
    
    // Method 1: Scan recent turns backwards for heading or subject
    for (let i = recentTurns.length - 1; i >= 0; i--) {
      const turnMsg = recentTurns[i].content || "";
      const hMatch = turnMsg.match(/#{1,6}\s*(?:[^\n#]+?\b(?:of|about|for|on)\s+)?([A-Za-z0-9_ -]{3,40})/i);
      if (hMatch && hMatch[1]) {
        const candidate = hMatch[1].replace(/^(🧠|💡|📌|🎯|📝|🧮|✅|⚠️|Definition|Overview|Concept|Topic|Part\s*[A-Z]):?\s*/i, "").trim();
        if (candidate.length > 2 && !/^(summary|details|key points|example|final answer|solution)$/i.test(candidate)) {
          activeTopic = candidate;
          break;
        }
      }
    }

    // Method 2: Extract main subject from recent user question
    if (!activeTopic && lastUserMsg) {
      const userClean = lastUserMsg.replace(/^(?:explain|teach|what is|how to|tell me about|samjhao|batao|make notes for|solve)\s+/i, "").trim();
      if (userClean.length > 2) {
        activeTopic = userClean.split(/[\?\.\n]/)[0].substring(0, 50).trim();
      }
    }

    if (!activeTopic && lastAssistantMsg) {
      const firstLine = lastAssistantMsg.split("\n").find(l => l.trim().length > 0) || "";
      activeTopic = firstLine.replace(/^#{1,6}\s*/, "").substring(0, 50).trim();
    }

    // Check for explicit topic change (excluding directives)
    const newTopicMatch = q.match(/^(?:now\s+)?(?:back\s+to|return\s+to|go\s+back\s+to|switch\s+to|explain|tell\s+me\s+about|what\s+is|how\s+does|teach\s+me|change\s+topic\s+to|let's\s+talk\s+about|samjhao)\s+([a-zA-Z0-9_\s\-]{3,40})/i);
    if (newTopicMatch) {
      const potentialNewTopic = newTopicMatch[1].trim();
      const isDirectivePhrase = /^(?:step\s*\d+|part\s*[a-z0-9]+|each\s*line|line\s*by\s*line|with\s*an?\s*example|in\s*simple|more|notes|quiz)/i.test(potentialNewTopic);
      const isDifferentTopic = Boolean(activeTopic && !activeTopic.toLowerCase().includes(potentialNewTopic.toLowerCase()) && !potentialNewTopic.toLowerCase().includes(activeTopic.toLowerCase()));
      if (isDifferentTopic && !isDirectivePhrase) {
        return {
          isFollowUp: false,
          activeTopic: potentialNewTopic,
          resolvedQuery: rawQuery,
        };
      }
    }

    // Directives
    const isExampleRequest = /^(?:give|show|provide)?\s*(?:me\s*)?(?:an?\s*)?(?:example|practical\s*example|real\s*world\s*example|code\s*example|udaaharan)\b/i.test(q) || /^\b(?:example|udaaharan)\b/i.test(q);
    const isNotesRequest = /\b(?:give\s*(?:me\s*)?notes|make\s*(?:short\s*)?notes|study\s*notes|exam\s*notes|revision\s*notes|notes\s*banao)\b/i.test(q);
    const isQuizRequest = /\b(?:now\s*)?(?:quiz\s*me|ask\s*(?:me\s*)?questions?|test\s*me|practice\s*questions?|questions?\s*poocho)\b/i.test(q);
    const isSimplerRequest = /\b(?:make\s*it\s*simpler|explain\s*in\s*simpler\s*words|easy\s*words?\s*me|simple\s*words?\s*me|easy\s*samjhao)\b/i.test(q);
    const isWhyRequest = /^\b(?:why|why\s*is\s*this|why\s*do\s*we\s*use|kyu|kyun)\b\??$/i.test(q);
    const isPracticalUseRequest = /\b(?:iska\s*practical\s*use|practical\s*use|real\s*world\s*use|kaha\s*use\s*hota|asli\s*use)\b/i.test(q);
    const isAdvantagesRequest = /\b(?:advantages?|benefits?|pros|plus\s*points?|faayde|faayda)\b/i.test(q);
    const isStepRequest = q.match(/\b(?:explain|detail|breakdown)\s*(?:the\s*)?(?:step|part)\s*(\d+|one|two|three|1|2|3)\b/i) || q.match(/^step\s*(\d+|one|two|three|1|2|3)\b/i);
    const isContinueRequest = /^(?:continue|aage\s*batao|next|go\s*on|carry\s*on)\b\??$/i.test(q);
    const isLineByLineRequest = /\b(?:explain\s*each\s*line|line\s*by\s*line|har\s*line)\b/i.test(q);

    if (isAdvantagesRequest && activeTopic) {
      return {
        isFollowUp: true,
        activeTopic,
        resolvedQuery: `What are the key advantages, benefits, and positive trade-offs of ${activeTopic}?`,
        overrideIntent: "CONCEPTUAL_EXPLANATION",
      };
    }

    if (isExampleRequest && activeTopic) {
      return {
        isFollowUp: true,
        activeTopic,
        resolvedQuery: `Provide a clear, practical, real-world example and demonstration specifically for ${activeTopic}.`,
        overrideIntent: "CONCEPTUAL_EXPLANATION",
      };
    }

    if (isNotesRequest && activeTopic) {
      return {
        isFollowUp: true,
        activeTopic,
        resolvedQuery: `Create structured, comprehensive study and exam notes specifically for ${activeTopic}.`,
        overrideIntent: "STUDY_EXAM_NOTES",
      };
    }

    if (isQuizRequest && activeTopic) {
      return {
        isFollowUp: true,
        activeTopic,
        resolvedQuery: `Ask me 3 practice questions on ${activeTopic} to test my understanding, one by one.`,
        overrideIntent: "CONCEPTUAL_EXPLANATION",
      };
    }

    if (isSimplerRequest && activeTopic) {
      return {
        isFollowUp: true,
        activeTopic,
        resolvedQuery: `Explain ${activeTopic} in even simpler, beginner-friendly terms with an intuitive analogy.`,
        overrideIntent: "CONCEPTUAL_EXPLANATION",
      };
    }

    if (isWhyRequest && activeTopic) {
      return {
        isFollowUp: true,
        activeTopic,
        resolvedQuery: `Why is ${activeTopic} used, what specific problem does it solve, and what happens if we do not use it?`,
        overrideIntent: "CONCEPTUAL_EXPLANATION",
      };
    }

    if (isPracticalUseRequest && activeTopic) {
      return {
        isFollowUp: true,
        activeTopic,
        resolvedQuery: `What are the practical real-world use cases, industry applications, and daily life impact of ${activeTopic}?`,
        overrideIntent: "PROJECT_REAL_WORLD_USE",
      };
    }

    if (isStepRequest && activeTopic) {
      const stepNum = isStepRequest[1];
      return {
        isFollowUp: true,
        activeTopic,
        resolvedQuery: `Explain Step ${stepNum} of the previous ${activeTopic} solution/calculation in detail.`,
        overrideIntent: "MATH_ALGORITHMIC_SOLVER",
      };
    }

    if (isContinueRequest && activeTopic) {
      return {
        isFollowUp: true,
        activeTopic,
        resolvedQuery: `Continue the explanation of ${activeTopic} from where we left off, covering the next subtopic or next step.`,
        overrideIntent: "CONCEPTUAL_EXPLANATION",
      };
    }

    if (isLineByLineRequest && activeTopic) {
      return {
        isFollowUp: true,
        activeTopic,
        resolvedQuery: `Provide a line-by-line breakdown of the code for ${activeTopic}.`,
        overrideIntent: "CODE_EXPLANATION",
      };
    }

    if (/\b(it|its|this|that|their|iska|iske|isse|ye|yeh|unke)\b/i.test(q) && activeTopic) {
      return {
        isFollowUp: true,
        activeTopic,
        resolvedQuery: `${rawQuery} (Context: regarding ${activeTopic})`,
      };
    }

    return {
      isFollowUp: false,
      activeTopic,
      resolvedQuery: rawQuery,
    };
  }

  /**
   * INFER CONTEXTUAL FOLLOW-UP ACTION CHIPS
   * Dynamically recommends 2-3 relevant action chips for the current answer.
   */
  static getSuggestedActions(
    intent: UnifiedIntent,
    topic?: string | null,
    textMsg?: string
  ): string[] {
    const q = (textMsg || "").toLowerCase();
    if (/no\s*(?:follow\s*up|additional\s*question|extra\s*question|more\s*questions)|concise\s*only|answer\s*only/i.test(q)) {
      return [];
    }

    const actions: string[] = [];

    if (intent === "STUDY_EXAM_NOTES") {
      actions.push("Try a practice question", "Show another example", "Explain in simpler words");
    } else if (intent === "MATH_ALGORITHMIC_SOLVER") {
      actions.push("Explain step 2 in detail", "Verify solution another way", "Try another problem");
    } else if (intent === "CODE_EXPLANATION") {
      actions.push("Explain each line", "Show practical example", "Make short notes");
    } else if (intent === "PROJECT_REAL_WORLD_USE") {
      actions.push("Show practical example", "Make study notes", "Try a practice question");
    } else if (intent.startsWith("PROJECT_")) {
      actions.push("Explain data flow", "Check security boundaries", "Prepare viva questions");
    } else if (intent === "DOCUMENT_RAG_QUERY") {
      actions.push("Summarize key findings", "Make study notes", "Ask 3 practice questions");
    } else {
      actions.push("Try a practice question", "Show practical example", "Make short notes");
    }

    return actions;
  }
  /**
   * 1. CLASSIFY QUERY INTENT
   * Analyzes both the query and contextual signals to determine the true semantic intent.
   * Prevents incorrect routing (e.g., routing architecture queries to general image generation).
   */
  static classifyIntent(query: string, context?: AnswerEngineContext): UnifiedIntent {
    const q = (query || "").trim().toLowerCase();
    const projectId = context?.projectId;

    // --- A. Explicit Document Artifact requests ---
    if (
      /(?:generate|create|make|build|export|download|banao)\s*(?:a\s*)?(?:pptx?|presentation|slide\s*deck|slides?|pitch\s*deck|word\s*doc(?:ument)?|docx?|excel|spreadsheet|xlsx|pdf\s*report|printable\s*pdf)\b/i.test(q) ||
      /\b(?:generate\s*ppt|make\s*ppt|banao\s*ppt|export\s*ppt|create\s*deck|create\s*presentation|export\s*pdf|create\s*docx|make\s*docx|generate\s*excel)\b/i.test(q)
    ) {
      return "ARTIFACT_GENERATION";
    }

    // --- B. Explicit Diagram/Visual creation (flowcharts, Mermaid SVGs) ---
    const isExplicitDiagramRequest =
      /(?:create|generate|draw|make|export|banao|dikhao)\s+(?:an?\s*)?(?:architecture\s*diagram|system\s*diagram|workflow\s*diagram|pipeline\s*diagram|diagram|naksha|flowchart|visual\s*diagram)\b/i.test(q) ||
      /\b(?:generate\s*diagram|draw\s*diagram|show\s*diagram|banao\s*diagram|make\s*flowchart|diagram\s*banao|naksha\s*banao)\b/i.test(q);

    if (isExplicitDiagramRequest && !/(?:explain|samjhao|what\s*is|kaise|overview)\b/i.test(q)) {
      return "DIAGRAM_REQUEST";
    }

    // --- C. Explicit Image Generation (Visual artwork, photorealism, nano-banana-image requests) ---
    // Only route to image generation if the user explicitly wants an illustrative or artistic image
    // AND it has absolutely nothing to do with architecture, systems, or code flow.
    const isArtisticImageRequest =
      /\b(?:generate|create|make|draw|illustrate|render|banao)\s+(?:an?\s+)?(?:image|picture|photo|illustration|sketch|portrait|scenery|painting|wallpaper|server\s*room\s*photo|clipart)\b/i.test(q) ||
      /\b(?:futuristic\s*ai|modern\s*ai\s*lab|illustration\s*of|painting\s*of|photo\s*of|draw\s+a|make\s+an\s+image)\b/i.test(q);

    const hasArchitectureOrSystemKeywords =
      /\b(?:architecture|structure|system|data\s*flow|pipeline|flowchart|mermaid|uml|schema|db|database|database\s*schema|infrastructure|backend|frontend|api|routing|request\s*flow|code|file|folder)\b/i.test(q);

    if (isArtisticImageRequest && !hasArchitectureOrSystemKeywords) {
      return "IMAGE_GENERATION";
    }

    // --- D. Project Context-Specific Intents ---
    if (projectId || context?.hasFiles) {
      // 1. Negative code flags
      const isNegativeCodeQuery = /\b(?:code\s*(?:mat|nhi|nahi|not|batao\s*mat)|naki\s*code|na\s*ki\s*code|without\s*code|code\s*kya\s*use\s*hua\s*ye\s*sab\s*nahi|code\s*nhi\s*chahiye|dont\s*show\s*code|no\s*code)\b/i.test(q);
      const isWholeProjectQuery = /(?:this\s*project|the\s*project|my\s*project|project\s*kya|project\s*ko|project\s*ka|project\s*ke|entire\s*project|whole\s*project|complete\s*project|about\s*the\s*project|about\s*this\s*project|project\/file|project\s*file)\b/i.test(q);

      // 0. Selected Code or Specific Code Snippet Walkthrough (HIGHEST PRIORITY)
      if (
        !isNegativeCodeQuery &&
        (
          /\b(?:selected\s*code|this\s*selected\s*code|explain\s+this\s+code|what\s+does\s+this\s+code\s+do|what\s+does\s+this\s+do|explain\s+this\s+selected\s+code|explain\s+what\s+this\s+code\s+does|code\s+snippet|why\s+is\s+this\s+used|can\s+this\s+be\s+optimized)\b/i.test(q) ||
          q.includes("```")
        )
      ) {
        return "CODE_EXPLANATION";
      }

      // 2. Multi-Aspect Conceptual Understanding (Concept + Logic + Approach + Real-life + Improvements + Weaknesses)
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

      // 3. Real-Life Use Cases, Project Title, and Domain Impact (Without Code)
      if (
        /\b(?:real[\s\-]life|real[\s\-]world|asli\s*use|actual\s*use|kis\s*kaam|kaam\s*aata|kaha\s*use|practical\s*use|business\s*use|domain|daily\s*life)\b/i.test(q) ||
        isNegativeCodeQuery ||
        /\b(?:title\s*kya|project\s*ka\s*title|project\s*ka\s*naam|project\s*name|what\s*is\s*(?:my|the)\s*project\s*title|project\s*title\s*kya|title\s*batao|title\s*aur\s*use|naam\s*kya\s*hai)\b/i.test(q)
      ) {
        return "PROJECT_REAL_WORLD_USE";
      }

      // 4. Viva / Defense Preparation
      if (/\b(?:viva|presentation|judges?|evaluator|examiner|defense|interview|pitch\s*for|explain\s*for\s*viva|viva\s*ke\s*liye|presentation\s*ke\s*liye)\b/i.test(q)) {
        return "PROJECT_VIVA";
      }

      // 5. Improvements & Future Scope
      if (/\b(?:improvement|improvements|how\s*can\s*(?:i|we|you|this|the|my)?\s*(?:improve|enhance)|how\s*to\s*improve|suggest\s*improvements|better\s*ways?|enhancements?|future\s*scope|future\s*extension)\b/i.test(q)) {
        return "PROJECT_IMPROVEMENTS";
      }

      // 6. Explicit Code Walkthrough (STRICT: only when asked for code, line by line, or debugging)
      const isExplicitCodeAction = Boolean(
        !isNegativeCodeQuery &&
        (
          /\b(?:explain\s+this\s+code|explain\s+the\s+code|code\s+samjhao|code\s+explain|show\s+code\s+and\s+explain)\b/i.test(q)
          || /\b(?:line\s*by\s*line|har\s*line|line\s*\d+|line\s*number\s*\d+|what\s*does\s*this\s*line\s*do)\b/i.test(q)
          || /\b(?:find\s*the\s*bug|bug\s*in\s*this|debug\s*this|fix\s*this\s*error|error\s*in\s*this|why\s*is\s*this\s*code\s*failing)\b/i.test(q)
          || /\b(?:syntax\s*breakdown|code\s*walkthrough|explain\s*this\s*function\s*implementation)\b/i.test(q)
        )
      );

      if (isExplicitCodeAction && !isWholeProjectQuery) {
        return "CODE_EXPLANATION";
      }

      // 7. File Role Query (when a file is mentioned, explain its role in the project)
      const fileMention = q.match(/\b([a-zA-Z0-9_\-]+\.(?:ts|tsx|js|jsx|py|java|cpp|c|cs|go|rs|php|rb|sql|css|html|json|yaml|yml|toml|env|dockerfile))\b/i)
        || /\b(?:docker-compose|dockerfile|package\.json|server\.ts|vite\.config)\b/i.test(q);

      if (fileMention && !isExplicitCodeAction) {
        return "PROJECT_FILE_ROLE";
      }

      if (context?.targetFile && !isWholeProjectQuery && !isExplicitCodeAction) {
        return "PROJECT_FILE_ROLE";
      }

      // 8. Problem Statement
      if (/\b(?:problem\s*statement|what\s*problem\s*does|problem\s*solved|kis\s*problem\s*ko\s*solve|problem\s*kya\s*hai)\b/i.test(q)) {
        return "PROJECT_PROBLEM_STATEMENT";
      }

      // 9. Proposed Solution
      if (/\b(?:proposed\s*solution|how\s*does\s*.*solve|solution\s*approach|solution\s*kya\s*hai|kaise\s*solve)\b/i.test(q)) {
        return "PROJECT_SOLUTION";
      }

      // 10. Features & Capabilities
      if (/\b(?:feature|features|capabilities|functionalities|what\s*can\s*.*do|features\s*kya|kya\s*kya\s*features?)\b/i.test(q)) {
        return "PROJECT_FEATURES";
      }

      // 11. Logic & Workflow
      if (/\b(?:logic|workflow|how\s+does\s+(?:the|this|my)\s+project\s+work|data\s*flow|request\s*flow|pipeline|step\s+by\s+step\s+flow|input\s*output)\b/i.test(q)) {
        return "PROJECT_LOGIC_WORKFLOW";
      }

      // 12. Architecture & Engineering Approach
      if (
        /\b(?:engineering\s*approach|architecture|system\s+architecture|connection|connects?|communicates?|integration|interconnect|subsystems?|design)\b/i.test(q) ||
        /\b(?:explain\s+system\s+architecture|show\s+me\s+the\s+architecture|explain\s+the\s+architecture)\b/i.test(q)
      ) {
        return "PROJECT_ENGINEERING_APPROACH";
      }

      // Check for File or Folder Structure
      if (
        /\b(?:file\s*structure|folder\s*structure|project\s*structure|directory\s*tree|directories|structure\s*of\s*files)\b/i.test(q)
      ) {
        return "PROJECT_FILE_STRUCTURE";
      }

      // Check for Dependencies & Technologies used
      if (
        /\b(?:dependency|dependencies|package\.json|package|package-lock|npm|libraries|frameworks|technologies|tech\s*stack|database|postgres|supabase|prisma|drizzle|express|react|vite)\b/i.test(q)
      ) {
        return "PROJECT_DEPENDENCY_ANALYSIS";
      }

      // Check for API Endpoints & Routes
      if (
        /\b(?:api|endpoints?|routes?|controllers?|request|response|get|post|put|delete|express\s+route|handler)\b/i.test(q)
      ) {
        return "PROJECT_API_ROUTE";
      }
    }

    // --- E. Standard Chat & Universal Analytical Intents ---
    // Greetings/Simple chitchat
    if (/^(?:hi|hello|hey|greetings|good\s*(?:morning|afternoon|evening)|yo|hola|who\s*are\s*you|what\s*is\s*your\s*name)\b\??$/i.test(q)) {
      return "GREETING_OR_CHITCHAT";
    }

    // Mathematical or algorithmic patterns
    if (
      /(?:solve|calculate|compute|evaluate|find)\s+([0-9xXyYzZ+\-*/^=().\s]{3,})/i.test(q) ||
      /\b(?:recurrence|master\s*method|master\s*theorem|asymptotic|big-o|complexity|induction|limit)\b/i.test(q)
    ) {
      return "MATH_ALGORITHMIC_SOLVER";
    }

    // Comparison & Differences
    if (
      /\b(?:difference\s+between|vs\b|versus\b|comparison\b|compare\b)\b/i.test(q)
    ) {
      return "CONCEPT_COMPARISON";
    }

    // Study & Exam Notes
    if (
      /\b(?:make\s*(?:exam\s*)?notes|give\s*(?:me\s*)?notes|study\s*notes|exam\s*notes|revision\s*notes|study\s*guide|notes\s*on|notes\s*for)\b/i.test(q)
    ) {
      return "STUDY_EXAM_NOTES";
    }

    // Conceptual & Educational Explanations (Universal & Multilingual)
    if (
      /^(?:explain|describe|what\s+is|what\s+are|how\s+does|how\s+to|why\s+do|define|meaning\s+of)\b/i.test(q) ||
      /\b(?:kya\s*(?:hota|hoti|hote|hai)|kise\s*kehte|samjhao|batao|matlab\s*kya|meaning\s*kya|concept\s*of)\b/i.test(q) ||
      /\b(?:probability|probab|statistics|calculus|algorithm|data\s*structure|recursion|polymorphism|inheritance|encapsulation|machine\s*learning|deep\s*learning|neural\s*network)\b/i.test(q)
    ) {
      return "CONCEPTUAL_EXPLANATION";
    }

    // Document RAG Query (if knowledge document attachments are present)
    if (context?.hasKnowledgeBase || context?.attachedDocs) {
      return "DOCUMENT_RAG_QUERY";
    }

    return "GENERAL_CHAT";
  }

  /**
   * 2. DYNAMICALLY PLAN RESPONSE STRUCTURE
   * Returns tailored system instructions, adjusted user prompts, and quality rules.
   * Completely avoids hardcoded templates, ensuring high-density conversation.
   */
  static planResponse(query: string, intent: UnifiedIntent, context?: AnswerEngineContext): ResponsePlan {
    let systemInstruction = "";
    let promptText = query;
    let suggestedHeadingHierarchy: string[] = [];

    // Base constraints that apply to all generations
    const baseConstraints = `
=== SMART CHAT RESPONSE & ADAPTIVE STRUCTURE DISCIPLINE ===
1. READABILITY & SCANNABILITY (NO PARAGRAPH WALLS):
   - Keep paragraphs short (1–3 sentences max).
   - Use bullet points for distinct items/facts and numbered lists for sequential steps.
   - Use bold text sparingly for key terms.
   - Use clear markdown headings (##, ###) to separate main ideas.
   - MATCH USER LANGUAGE & TONE: If the user asks in Hinglish (e.g. "machine learning kya hai samjhao" or "code samjhao"), respond naturally in clean Hinglish while maintaining full technical accuracy and clean markdown structure!

2. ADAPTIVE RESPONSE STRUCTURE (PARAGRAPH IS NOT THE DEFAULT):
   - Adapt the response format to the specific intent of the question:
     * Concept Learning ("Explain X", "What is X?"):
       - 🧠 **Definition**: Crisp, beginner-friendly 1-2 sentence definition.
       - 💡 **Simple Explanation**: Intuitive breakdown with short paragraphs or bullets.
       - 📝 **Real-World Example**: Concrete practical example or analogy.
       - 🎯 **Key Points / Takeaway**: 3-4 bullet points summarizing the core concept.
     * Step-by-Step Tasks & Instructions:
       - Use numbered steps (1., 2., 3.). Include expected results or tips where helpful.
     * Math Problems & Calculations ("Solve...", "Calculate..."):
       - 1. **Given**: List parameters and variables.
       - 2. **Formula**: Display LaTeX formula in isolated block ($$ ... $$).
       - 3. **Step-by-Step Calculation**: Dedicated calculation steps on separate lines.
       - 4. ✅ **Final Answer**: Clearly highlighted result.
       - 5. 🔍 **Verification / Sanity Check**: Quick verification.
     * Code Explanation (ONLY WHEN EXPLICITLY REQUESTED):
       - Purpose of code → Key logic / parameters → Execution flow → Short takeaway.
     * Concept Comparison ("Compare X and Y", "Difference between X and Y"):
       - Brief introduction → Comparison Table (| Feature | Option A | Option B | Best Used When |) → Key Tradeoffs & 🎯 **Key Takeaway**.
     * Build & Verify / Terminal Output:
       - Actual command → Execution status & Exit code → Relevant logs/errors → Verification result → Next step.
     * Project Analysis:
       - Ground claims strictly in actual project files and evidence. Clearly state unknowns or assumptions.
     * Practice Mode & Learning Loop:
       - Ask the learner to attempt an answer, then provide constructive feedback and hints before giving complete answers.

3. FORMULA RENDERING & PRECISION:
   - For standalone or major equations, ALWAYS use display math blocks ($$ ... $$) on dedicated lines.
   - For inline variables and small expressions, use inline math ($...$).
   - NEVER output raw unformatted LaTeX text without proper math wrapping.

4. SEMANTIC CALLOUTS & VISUAL ANCHORS:
   - Use meaningful visual callouts:
     * 💡 **Tip:** ... (or 💡 **Exam Tip:** ...)
     * ⚠️ **Common Mistake:** ...
     * 📌 **Remember:** ... or 🎯 **Key Takeaway:** ...
     * ✅ **Final Answer:** ...
     * 📝 **Example:** ...
     * 🧮 **Calculation:** ...

5. ZERO EMPTY HEADINGS & CONCISE COMPLETENESS:
   - Never output empty headings. Explain every introduced section fully.
   - Match response length to question complexity (4-line crisp answers for simple questions, thorough breakdowns for complex tasks).
`;

    switch (intent) {
      case "GREETING_OR_CHITCHAT":
        systemInstruction = `You are Clarity, an elegant, helpful, and highly intelligent AI software engineering assistant.
Keep your response warm, natural, and brief. Introduce your capabilities (code analysis, system architecture, RAG grounding, document generation, and problem-solving) when asked, or ask how you can help.`;
        suggestedHeadingHierarchy = [];
        break;

      case "PROJECT_CONCEPT_AND_LOGIC":
        systemInstruction = `You are Clarity, an expert AI Project Understanding Mentor and Hackathon Advisor.
The user wants to deeply UNDERSTAND THE PROJECT (Concept, System Logic, Engineering Approach, Real-Life Use, Strengths, Limitations/Weaknesses, Improvements, and Viva Defense).
CRITICAL DIRECTIVE:
1. Prioritize project understanding and domain intuition first.
2. DO NOT dump raw source code or perform low-level syntax line breakdowns.
3. Teach like an intelligent mentor preparing a student for high-stakes evaluations.
4. Provide substantive, high-value paragraphs and structured analysis under each section. ZERO EMPTY HEADINGS.`;
        suggestedHeadingHierarchy = [
          "Core Concept & Purpose",
          "Core System Logic & Processing Flow",
          "Engineering Approach & Architecture",
          "Real-Life Applications & User Journeys",
          "Key Strengths & Advantages",
          "Honest Limitations & Tradeoffs",
          "Practical Improvements & Future Scope",
          "Student Viva & Defense Guide"
        ];
        break;

      case "PROJECT_FILE_ROLE":
        systemInstruction = `You are Clarity, an expert Project Understanding Mentor.
The user is asking about a specific file in their project.
CRITICAL DIRECTIVE:
1. Connect the file back to the overall project role and architecture FIRST.
2. Explain what the file is, its responsibility in the overall application, which layer it belongs to, and how it interacts with other files and services.
3. DO NOT output line-by-line syntax dumps unless explicitly requested.`;
        suggestedHeadingHierarchy = ["File Purpose & Role", "Architecture Layer & Placement", "System Connections & Dependencies", "Core Mechanism Overview"];
        break;

      case "PROJECT_LOGIC_WORKFLOW":
        systemInstruction = `You are a Lead Software Engineer explaining system execution.
Explain the core logic and workflow in clear, accessible language:
- Input & Trigger -> Validation -> Processing Logic -> Persistence -> Client Response.
- How modules collaborate to process user requests end-to-end.`;
        suggestedHeadingHierarchy = ["System Logic Overview", "Step-by-Step Request Lifecycle", "Module Collaboration"];
        break;

      case "PROJECT_PROBLEM_STATEMENT":
        systemInstruction = `You are a Project Strategy and Product Lead.
Explain the verified problem statement of this project clearly and concisely.
Ground your response in the actual problem the software is designed to solve.
Avoid generic fluff or invented claims.`;
        suggestedHeadingHierarchy = ["Problem Statement Overview", "Target User Challenges", "Real-World Friction"];
        break;

      case "PROJECT_SOLUTION":
        systemInstruction = `You are a Lead Solutions Architect.
Explain how the project solves its target problem.
Highlight the primary mechanisms, workflow, and core value delivered.`;
        suggestedHeadingHierarchy = ["Proposed Solution", "Core Mechanism", "Solution Impact"];
        break;

      case "PROJECT_FEATURES":
        systemInstruction = `You are a Product Manager and Tech Lead.
List and explain the verified implemented features of the application.
Highlight what each feature does and why it is useful in clean, scannable bullet points.`;
        suggestedHeadingHierarchy = ["Core Implemented Features", "Key Capabilities"];
        break;

      case "PROJECT_ENGINEERING_APPROACH":
        systemInstruction = `You are a Principal Software Architect explaining engineering decisions.
Explain:
- Architectural paradigm and layer separation (Presentation, Application, Storage/Intelligence).
- Why specific technologies and patterns were selected for this project.
- Key design decisions and architectural tradeoffs.`;
        suggestedHeadingHierarchy = ["Architectural Design", "Technology Selection Rationale", "Design Tradeoffs"];
        break;

      case "PROJECT_IMPROVEMENTS":
        systemInstruction = `You are a Senior Tech Lead providing practical code and system improvements.
Provide concrete, actionable, and grounded recommendations:
- Functional enhancements
- Performance & caching optimization
- Testing & reliability hardening
- Security & deployment best practices.`;
        suggestedHeadingHierarchy = ["Functional Enhancements", "Performance & Optimization", "Reliability & Testing", "Security & Deployment"];
        break;

      case "PROJECT_VIVA":
        systemInstruction = `You are a CS Professor and Hackathon Mentor preparing a student for viva and demo defense.
Provide:
- 30-Second Elevator Pitch
- Core Problem & Solution Summary
- Architecture & Tech Stack Rationale
- Top Viva Questions with high-scoring Model Answers.`;
        suggestedHeadingHierarchy = ["Elevator Pitch", "Core Architecture & Stack Rationale", "Top Viva Questions & Answers"];
        break;

      case "PROJECT_REAL_WORLD_USE":
        systemInstruction = `You are Clarity, an expert AI Project Intelligence and Hackathon Mentor.
The user is asking about the REAL-WORLD application, practical problem solved, project title, and business value of this system (and does NOT want low-level code dumps).

RULES & STRUCTURE:
1. Speak in clean, conversational, student-friendly tone (in Hinglish/English matching the user's language).
2. DO NOT dump code syntax or low-level file implementation details.
3. Focus 100% on the real-world domain, customer journey, problem solved, and practical impact.
4. Structure your answer clearly with:
   - 🏷️ **Project Title & Domain Overview**
   - 🌍 **Real-Life Problem (What difficulties exist without this system)**
   - 💡 **Real-Life Solution & How It Works (Step-by-step user journey)**
   - 👥 **Target Users (Who uses it in daily life)**
   - 🏆 **Real-World Impact & Value (Time saved, error prevention, etc.)**
   - 🎤 **30-Second Viva & Hackathon Pitch (How to explain to judges/professors in seconds)**`;
        suggestedHeadingHierarchy = ["Project Title & Domain Overview", "Real-Life Problem Solved", "Real-Life Working & User Journey", "Target Users", "Real-World Impact", "30-Second Viva & Hackathon Pitch"];
        break;

      case "PROJECT_ARCHITECTURE_QUERY":
        systemInstruction = `You are a Principal Software Architect analyzing a system.
Analyze the system architecture from the provided project files, structure, and analysis context.
Plan a dynamic, beautiful explanation. Break the explanation down naturally.
- DO NOT use generic report headings.
- Explain the component hierarchy: Frontend/Presentation, Backend/Application logic, and Database/Storage.
- Point out concrete technical stack choices (e.g., Express, React, Vite, SQLite, Supabase) found in the project.
- Clearly describe how components connect (API endpoints, protocols, WebSocket, etc.).`;
        suggestedHeadingHierarchy = ["System Architecture Overview", "Component Breakdown", "System Integration & Connectivity"];
        break;

      case "PROJECT_DATA_FLOW":
        systemInstruction = `You are a Lead Software Engineer explaining system execution.
Delineate how data or requests move through the application end-to-end.
- Describe the exact sequence: Ingestion/Trigger -> Validation -> Logic Processing -> Database Transaction -> Client Response.
- If RAG (Retrieval-Augmented Generation) is present, explicitly trace how queries are embedded, searched in vector stores, and augmented into the prompt.
- Use numbered steps or ASCII flow lines to make the execution flow highly intuitive.`;
        suggestedHeadingHierarchy = ["Execution Workflow", "Step-by-Step Data Journey", "RAG Processing pipeline"];
        break;

      case "PROJECT_FILE_STRUCTURE":
        systemInstruction = `You are a Software Engineer explaining directory structure.
Provide a clear, annotated file tree mapping the project's layout.
- Highlight the core entry points, modules, and configurations.
- For each important folder/file, write a concise explanation of its exact role.
- Never list empty folders or files without brief annotations.`;
        suggestedHeadingHierarchy = ["Directory Architecture", "Core Module Annotations"];
        break;

      case "PROJECT_DEPENDENCY_ANALYSIS":
        systemInstruction = `You are a DevOps and Dependency auditor.
Analyze package.json or dependency files.
- List key frameworks, runtime libraries, and development tools with a precise description of why they are chosen.
- Highlight version ranges and any potential stack considerations.
- Present these in a table format (Library, Role/Purpose, Scope) to make it immediately scannable.`;
        suggestedHeadingHierarchy = ["Technology Stack & Dependencies", "Core Library Breakdown"];
        break;

      case "PROJECT_API_ROUTE":
        systemInstruction = `You are a Backend API Engineer mapping system gateways.
Examine Express, Flask, or Fast API route definitions in the code.
- Present a clean, compiled table of endpoints with Method, Path, Authentication, Description, and payload expectations.
- Point out where controllers or request handlers are registered.`;
        suggestedHeadingHierarchy = ["API Gateway & Endpoints", "Endpoint Directory Table"];
        break;

      case "CODE_EXPLANATION":
        systemInstruction = `You are Clarity, an expert Senior Software Engineer and Code Mentor.
When the user asks to explain a code snippet, function, class, algorithm, or file:

==================================================
CODE-FIRST TEACHING & SEGMENTATION DIRECTIVES (MANDATORY)
==================================================
1. CODE FIRST, EXPLAIN SECOND:
   - Always display the relevant code section or snippet FIRST in a syntax-highlighted code block (\`\`\`language ... \`\`\`).
   - Immediately below that code block, explain what those specific lines do.
   - Do NOT write a long generic introduction or conceptual text summary before showing the code.

2. DIVIDE CODE INTO LOGICAL SECTIONS:
   - Divide code into small, meaningful, logical parts along natural boundaries (parameters, initialization, validation, main business logic, loops/conditionals, DB/API ops, error handling, returns).
   - Process each section sequentially in execution order before moving to the next section.

3. STRUCTURE FOR EACH CODE SECTION:
   a. **Code Section**: Show the exact original source code excerpt.
   b. **Step-by-Step Walkthrough**: Explain statements line-by-line in execution order.
   c. **Why This Code Exists**: Explain the design purpose and rationale.
   d. **Worked Example**: Trace a small example with concrete sample values.
   e. **Edge Cases & Failure Modes**: Highlight potential traps, null safety, or complexity.

4. ACCURATE SOURCE GROUNDING:
   - Ground all explanations strictly in the REAL provided source code.
   - Preserve variable names, method signatures, imports, and data types exactly.
   - Do NOT invent non-existent functions, APIs, or fake execution outputs.

5. FINAL RECAP:
   - Conclude with a complete execution flow overview and a short 1-2 sentence summary recap.

6. SIMPLIFIED FOLLOW-UP HANDLING:
   - If the user asks a follow-up expressing difficulty (e.g. "abhi bhi nahi samjha", "didn't understand", "explain simpler"):
     • Simplify the concept using an intuitive real-world analogy.
     • Reuse the same code context.
     • Use a different worked example with different sample values instead of repeating previous technical prose.`;
        suggestedHeadingHierarchy = ["Code Section Walkthrough", "Key Logic & Execution", "Worked Example", "Edge Cases & Recap"];
        break;

      case "CONCEPTUAL_EXPLANATION":
        systemInstruction = `You are Clarity, an expert CS & Software Engineering Professor.
Deliver a clear, high-density, visual conceptual explanation using this exact 7-part structure:

### 1. 🧠 What it is
Crisp, beginner-friendly 1-2 sentence definition.

### 2. 🎯 Why it is needed in this project
Explain why this concept exists in the context of the user's project, referencing verified project files, components, or services when relevant.

### 3. ⚙️ How it works
Step-by-step operational breakdown in 3-5 numbered steps.

### 4. 📊 Visual Diagram
Provide a clean, valid Mermaid diagram (\`\`\`mermaid ... \`\`\`) visualizing the concept flow, sequence, or structure.

### 5. 💻 Real Project Example
Show a real code snippet, endpoint, or component reference from this project or a concrete code pattern demonstrating the concept.

### 6. ⚠️ Common Mistake or Limitation
Highlight a frequent beginner trap, edge case, or trade-off.

### 7. ❓ Follow-up Question
Provide 1 optional thoughtful question to test understanding or prompt deeper exploration.

Match the language used by the user (English, Hindi, Marathi, or Hinglish) naturally.`;
        suggestedHeadingHierarchy = ["What it is", "Why it is needed in this project", "How it works", "Visual Diagram", "Real Project Example", "Common Mistake or Limitation", "Follow-up Question"];
        break;

      case "CONCEPT_COMPARISON":
        systemInstruction = `You are Clarity, an expert Analytical Mentor.
Deliver a crystal-clear, structured comparative breakdown:
- Provide a concise 1-2 sentence overview of what is being compared.
- Create a comprehensive Markdown Comparison Table with clear headers (| Measure / Feature | Option A | Option B | Best Used When |).
- Detail the key differences, tradeoffs, and practical decision criteria.
- Conclude with a 🎯 **Key Takeaway:**.`;
        suggestedHeadingHierarchy = ["Comparison Overview", "Comparison Table", "Key Differences & Tradeoffs", "Key Takeaway"];
        break;

      case "STUDY_EXAM_NOTES":
        systemInstruction = `You are Clarity, an elite CS & Mathematics Professor creating high-scoring study notes.
Structure comprehensive, exam-ready study notes:
- # 📚 Topic Title
- ## 🧠 Core Concept: Clear theoretical explanation.
- ## 📌 Key Points: Bulleted essential characteristics.
- ## 📐 Important Formula: Display LaTeX math blocks with variable definitions.
- ## 📝 Solved Numerical / Practical Example: Step-by-step calculation with verified final answer.
- ## ⚠️ Common Mistake & 🎯 Exam Tip: Traps, pitfalls, and shortcuts.
- ## ✅ Quick Revision: 3-5 summary bullets.
Only include sections that contain actual useful information; never create empty headings.`;
        suggestedHeadingHierarchy = ["Concept Overview & Definition", "Key Points & Properties", "Important Formulas & Calculations", "Solved Example", "Exam Tips & Traps"];
        break;

      case "MATH_ALGORITHMIC_SOLVER":
        systemInstruction = `You are Clarity, an expert Discrete Mathematician and Algorithmics Researcher.
Solve computational and mathematical problems with structured precision:
- 1. Given: State the known parameters, equations, and requirements.
- 2. Formula & Method: State the applicable theorem/formula in standard LaTeX display blocks.
- 3. Step-by-Step Calculation: Show each algebraic operation on its own line. NEVER combine multiple calculation steps into a single paragraph!
- 4. Final Answer: Conclude with verified final answer callout.
- 5. Verification: Confirm why the result is correct or add a tip.`;
        suggestedHeadingHierarchy = ["Given Parameters & Formula", "Step-by-Step Calculation", "Final Answer & Verification"];
        break;

      case "DOCUMENT_RAG_QUERY":
        systemInstruction = `You are an elite Fact-Grounded Knowledge Intelligence Engine and Educational Mentor.
- For questions specifically asking about uploaded documents, syllabus, files, or project structure, ground your answer in the provided evidence documents, RAG chunks, and attachments with clear citations.
- If the user asks a general conceptual, mathematical, algorithmic, theoretical, or programming question (or if the attached documents don't contain the specific topic), ALWAYS provide a complete, clear, and structured answer using your universal knowledge. NEVER refuse to answer by saying the topic wasn't found in files like package-lock.json or dependencies.`;
        suggestedHeadingHierarchy = ["Evidence Summary", "Grounded Findings", "Document References"];
        break;

      case "IMAGE_GENERATION":
        systemInstruction = `You are an artistic design prompt engineer.
Craft a rich, descriptive prompt for generating visual assets. Present the structured parameters clearly.`;
        suggestedHeadingHierarchy = ["Visual Design Concept", "Prompt Parameters"];
        break;

      case "DIAGRAM_REQUEST":
        systemInstruction = `You are a Systems Diagram designer.
Plan a precise, clean, professional diagram using Mermaid syntax or SVG representations.
- Structure elements clearly, using semantic groupings.
- Ensure the syntax is completely valid with zero dangling links or layout conflicts.`;
        suggestedHeadingHierarchy = ["Diagram Layout Planning", "Diagram Code Specifications"];
        break;

      case "ARTIFACT_GENERATION":
        systemInstruction = `You are an executive deliverable generator.
Detail the structure, contents, and outline of the Word/PPTX/Excel report being constructed. Ensure professional technical terminology.`;
        suggestedHeadingHierarchy = ["Deliverable Specifications", "Outline Structure"];
        break;

      default:
        systemInstruction = `You are Clarity, a helpful and precise software engineering and general analytical assistant.
Ground all responses in available context, maintain concise paragraphs, and always support claims with evidence.`;
        suggestedHeadingHierarchy = ["Response Summary", "Details"];
        break;
    }

    systemInstruction += "\n" + baseConstraints;

    return {
      intent,
      systemInstruction,
      promptText,
      suggestedHeadingHierarchy,
    };
  }

  /**
   * 3. SANITIZE RESPONSE
   * Repairs LaTeX syntax, strips raw server-only planning blocks, prevents visual leaks,
   * and removes empty headings.
   */
  static sanitizeResponse(text: string): string {
    if (!text) return "";
    let s = String(text);

    // Clean XML Planning Tags
    const tagsToClean = ["internal_planning_and_validation", "internal_answer_planning", "thought", "thinking"];
    for (const tag of tagsToClean) {
      const regex = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, "gi");
      s = s.replace(regex, "");
      s = s.replace(new RegExp(`<\\/?${tag}>`, "gi"), "");
    }

    // Repair corrupted LaTeX escape characters (\f -> FormFeed, \t -> Tab, \r -> CR, \b -> Backspace)
    s = s.replace(/\x0crac\b/g, "\\frac");
    s = s.replace(/\x09ext\b/g, "\\text");
    s = s.replace(/\x0dight\b/g, "\\right");
    s = s.replace(/\x08egin\b/g, "\\begin");

    // Restore common missing backslashes for math structures
    s = s.replace(/(?<!\\)\b(frac)\{/g, "\\frac{");
    s = s.replace(/(?<!\\)\b(sqrt)\{/g, "\\sqrt{");
    s = s.replace(/(?<!\\)\b(left)\s*([\(\[\{])/g, "\\left$2");
    s = s.replace(/(?<!\\)\b(right)\s*([\(\]\}\)])/g, "\\right$2");

    // Clear duplicate 'svgsvg' artifacts
    s = s.replace(/svgsvg/gi, "");

    // Remove empty markdown headings (e.g. ### Features followed immediately by another heading or EOF)
    const lines = s.split("\n");
    const sanitizedLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isHeading = /^#{1,6}\s+/.test(line.trim());
      if (isHeading) {
        let hasContent = false;
        let foundNextHeading = false;
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim();
          if (!nextLine || /^[-*_]{3,}$/.test(nextLine)) continue;
          if (/^#{1,6}\s+/.test(nextLine)) {
            foundNextHeading = true;
            break; // Another heading without content
          }
          hasContent = true;
          break;
        }
        if (!hasContent && foundNextHeading) {
          continue; // Skip empty heading followed immediately by another heading
        }
      }
      sanitizedLines.push(line);
    }

    s = sanitizedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return s;
  }
}
