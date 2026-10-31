/**
 * CLARITY UNIVERSAL VISUAL INTENT ROUTER
 *
 * Classifies user queries into semantic visual intent categories, determining
 * whether the primary expected deliverable is an internal visual asset (rendered directly in chat),
 * raw code/source request, or standard text/explanation.
 */

export type VisualIntentType =
  | "NORMAL_TEXT"
  | "CODE_REQUEST"
  | "IMAGE_REQUEST"
  | "DIAGRAM_REQUEST"
  | "WORKFLOW_REQUEST"
  | "FLOWCHART_REQUEST"
  | "ARCHITECTURE_VISUAL_REQUEST"
  | "MINDMAP_REQUEST"
  | "GRAPH_REQUEST"
  | "CHART_REQUEST"
  | "TABLE_REQUEST"
  | "INFOGRAPHIC_REQUEST"
  | "PPT_GENERATION"
  | "DOCX_GENERATION"
  | "PDF_GENERATION"
  | "XLSX_GENERATION"
  | "DOCUMENT_ARTIFACT_REQUEST"
  | "MIXED_RESPONSE";

export interface VisualIntentClassification {
  intent: VisualIntentType;
  wantsCode: boolean;
  wantsVisual: boolean;
  subject: string;
  parameters?: Record<string, any>;
  confidence: number;
}

export class UniversalVisualIntentRouter {
  /**
   * Classify any natural language query into a VisualIntentClassification
   */
  static classify(query: string, projectId?: string | null): VisualIntentClassification {
    const raw = (query || "").trim();
    const q = raw.toLowerCase();

    if (!q) {
      return {
        intent: "NORMAL_TEXT",
        wantsCode: false,
        wantsVisual: false,
        subject: "",
        confidence: 1.0,
      };
    }

    // 0. Project-specific overriding logic to prevent routing to generic image generation
    if (projectId) {
      const isProjectArchitectureOrDataFlow = (
        /\b(?:architecture|system\s+architecture|data\s+flow|request\s+flow|project\s+structure|file\s+structure|subsystem|backend\s+connect|frontend\s+connect|how\s+frontend\s+connect|rag|database|db|postgres|supabase|vector\s+search)\b/i.test(q)
      );

      if (isProjectArchitectureOrDataFlow) {
        const isExplicitDiagramCreation =
          /\b(?:draw|plot|generate|create|make|render|show|visualize)\b.*\b(?:diagram|flowchart|workflow|mindmap|mind\s*map|chart|graph|tree|map)\b/i.test(q) ||
          /\b(?:diagram|flowchart|workflow|mindmap|mind\s*map|chart|graph|tree|map)\b.*\b(?:draw|plot|generate|create|make|render|show|visualize)\b/i.test(q);

        if (isExplicitDiagramCreation) {
          // Detect specific diagram types
          let intent: VisualIntentType = "DIAGRAM_REQUEST";
          if (/\b(?:flowchart|flow\s*chart)\b/i.test(q)) intent = "FLOWCHART_REQUEST";
          else if (/\b(?:workflow|work\s*flow)\b/i.test(q)) intent = "WORKFLOW_REQUEST";
          else if (/\b(?:architecture)\b/i.test(q)) intent = "ARCHITECTURE_VISUAL_REQUEST";
          else if (/\b(?:mindmap|mind\s*map)\b/i.test(q)) intent = "MINDMAP_REQUEST";

          return {
            intent,
            wantsCode: false,
            wantsVisual: true,
            subject: raw,
            confidence: 0.98,
          };
        } else {
          // For any explanatory or conceptual question in a project context, strictly force NORMAL_TEXT
          return {
            intent: "NORMAL_TEXT",
            wantsCode: false,
            wantsVisual: false,
            subject: raw,
            confidence: 0.99,
          };
        }
      }
    }

    // Check for explicit code request vs mixed visual+code request
    const asksExplicitCode = /\b(?:give\s+me|show|write|provide|generate|send|export)\s+(?:the\s+)?(?:source\s+code|code|script|python\s+code|svg\s+code|html\s+code|mermaid\s+code|latex\s+code|json\s+spec)\b/i.test(q) ||
      /\b(?:code\s+only|only\s+code|in\s+python\s+code|in\s+svg\s+code|raw\s+code)\b/i.test(q);

    // Pure explanatory / conceptual questions MUST remain text-first (NORMAL_TEXT)
    const isExplanatoryQuestion = (
      /^(?:what\s+is|what\s+are|what\s+does|explain|define|describe|why\s+is|how\s+does|meaning\s+of|difference\s+between|tell\s+me\s+about|what\s+mean)\b/i.test(q) ||
      /\b(?:what\s+does\s+(?:this|the)\s+diagram\s+mean|explain\s+(?:this|the)\s+(?:graph|diagram|flowchart|chart))\b/i.test(q)
    );

    const hasExplicitVisualImperative = (
      /\b(?:draw|plot|generate\s+(?:an?\s+)?(?:image|picture|photo|illustration|visual|ppt|presentation|deck|slides?|word|docx?|pdf|spreadsheet|excel|xlsx)|create\s+(?:an?\s+)?(?:diagram|flowchart|workflow|architecture|mindmap|mind\s*map|chart|graph|tree|ppt|presentation|deck|slides?|word|docx?|pdf|spreadsheet|excel|xlsx)|make\s+(?:an?\s+)?(?:diagram|flowchart|workflow|architecture|mindmap|mind\s*map|chart|graph|tree|ppt|presentation|deck|slides?|word|docx?|pdf|spreadsheet|excel|xlsx)|render\s+(?:an?\s+)?(?:diagram|flowchart|chart|graph|visual)|show\s+(?:me\s+)?(?:the\s+)?(?:diagram|workflow|flowchart|architecture|graph|chart|mindmap|tree)|visualize\b)/i.test(q) ||
      /\b(?:with\s+(?:a\s+)?(?:graph|diagram|flowchart|chart)|draw\s+this|plot\s+this|visualize\s+this|show\s+the\s+diagram)\b/i.test(q)
    );

    // If it's an explanation question without explicit visual imperative, it MUST stay NORMAL_TEXT
    if (isExplanatoryQuestion && !hasExplicitVisualImperative) {
      return {
        intent: "NORMAL_TEXT",
        wantsCode: false,
        wantsVisual: false,
        subject: raw,
        confidence: 0.98,
      };
    }

    // 1. MIXED_RESPONSE: User explicitly asks for BOTH visual and source code
    const isBothMixed = (
      /\b(?:and\s+(?:also|show|give|provide)|both|as\s+well\s+as|along\s+with)\b/i.test(q) &&
      hasExplicitVisualImperative && asksExplicitCode
    );

    if (isBothMixed) {
      return {
        intent: "MIXED_RESPONSE",
        wantsCode: true,
        wantsVisual: true,
        subject: raw,
        confidence: 0.95,
      };
    }

    // 2. CODE_REQUEST: User asks for the code/script
    if (asksExplicitCode) {
      return {
        intent: "CODE_REQUEST",
        wantsCode: true,
        wantsVisual: false,
        subject: raw,
        confidence: 0.92,
      };
    }

    // 3. PPT_GENERATION (PowerPoint / Presentation / Slides)
    if (
      /\b(?:create|generate|make|build|export|prepare|banao)\b.*\b(?:ppt|pptx|powerpoint|presentation|slide\s*deck|\bslides?\b|\bdeck\b)\b/i.test(q) ||
      /\b(?:ppt|pptx|powerpoint|presentation|slide\s*deck|\bslides?\b|\bdeck\b)\b.*\b(?:create|generate|make|build|export|banao)\b/i.test(q) ||
      /\b(?:5-slide|10-slide|\d+\s*-?\s*slides?)\s+(?:ppt|presentation|deck|powerpoint)\b/i.test(q) ||
      /^(?:generate|create|make)\s+(?:a\s+)?(?:5-slide\s+)?(?:ppt|presentation|deck|powerpoint)/i.test(q)
    ) {
      return {
        intent: "PPT_GENERATION",
        wantsCode: false,
        wantsVisual: true,
        subject: raw,
        confidence: 0.97,
      };
    }

    // 4. DOCX_GENERATION (Word Document / DOCX File)
    if (
      /\b(?:create|generate|make|build|export|prepare|banao)\b.*\b(?:word\s*document|docx?|word\s*file|doc\s*file)\b/i.test(q) ||
      /\b(?:word\s*document|docx?|word\s*file|doc\s*file)\b.*\b(?:create|generate|make|build|export|banao)\b/i.test(q)
    ) {
      return {
        intent: "DOCX_GENERATION",
        wantsCode: false,
        wantsVisual: true,
        subject: raw,
        confidence: 0.98,
      };
    }

    // 5. PDF_GENERATION (PDF Document / Report)
    if (
      /\b(?:create|generate|make|build|export|prepare|banao)\b.*\b(?:pdf|pdf\s*report|pdf\s*file|printable\s*report)\b/i.test(q) ||
      /\b(?:pdf|pdf\s*report|pdf\s*file)\b.*\b(?:create|generate|make|build|export|banao)\b/i.test(q) ||
      /^(?:generate|create|make)\s+(?:a\s+)?pdf/i.test(q)
    ) {
      return {
        intent: "PDF_GENERATION",
        wantsCode: false,
        wantsVisual: true,
        subject: raw,
        confidence: 0.97,
      };
    }

    // 6. XLSX_GENERATION (Excel / Spreadsheet)
    if (
      /\b(?:create|generate|make|build|export|prepare|banao)\b.*\b(?:excel|xlsx|spreadsheet|workbook|sheet)\b/i.test(q) ||
      /\b(?:excel|xlsx|spreadsheet|workbook|sheet)\b.*\b(?:create|generate|make|build|export|banao)\b/i.test(q) ||
      /^(?:generate|create|make)\s+(?:a\s+)?(?:xlsx|excel|spreadsheet)/i.test(q)
    ) {
      return {
        intent: "XLSX_GENERATION",
        wantsCode: false,
        wantsVisual: true,
        subject: raw,
        confidence: 0.97,
      };
    }

    // 3. GRAPH_REQUEST: Mathematical function plot / cartesian graph / curve
    if (
      /\b(?:plot\b|draw\s+(?:a\s+)?graph|graph\s+of|plot\s+of|curve\s+of|cartesian|coordinate\s+system)\b/i.test(q) ||
      /\bplot\s+[a-z0-9\(\)\s\^\*\+\-\/=\.\,\'\"]+/i.test(q) ||
      (/\b(?:y\s*=|f\(x\)\s*=|sin\(x\)|cos\(x\)|tan\(x\)|x\^2|x²|e\^x|log\(x\)|ln\(x\)|parabola|hyperbola)\b/i.test(q) && /\b(?:plot|graph|draw|curve|visualize)\b/i.test(q)) ||
      (/\b(?:asymptotic\s+notation|growth\s+rate|big\s*o|omega|theta)\b/i.test(q) && /\b(?:with\s+graph|plot|draw\s+graph)\b/i.test(q))
    ) {
      return {
        intent: "GRAPH_REQUEST",
        wantsCode: false,
        wantsVisual: true,
        subject: raw,
        confidence: 0.94,
      };
    }

    // 4. FLOWCHART_REQUEST
    if (/\b(?:make|create|draw|generate|build|show)\s+(?:(?:me\s+)?(?:an?|the)\s+)?(?:flowchart|flow\s*chart|process\s*flow)\b/i.test(q) || /\b(?:flowchart\s+for|flowchart\s+of)\b/i.test(q)) {
      return {
        intent: "FLOWCHART_REQUEST",
        wantsCode: false,
        wantsVisual: true,
        subject: raw,
        confidence: 0.95,
      };
    }

    // 5. ARCHITECTURE_VISUAL_REQUEST
    if (
      /\b(?:make|create|draw|generate|build|show)\s+(?:(?:me\s+)?(?:an?|the)\s+)?(?:architecture\s+diagram|system\s+architecture|cloud\s+architecture|microservices?\s+architecture|system\s+design\s+diagram)\b/i.test(q) ||
      /\b(?:architecture\s+diagram\s+for|architecture\s+of)\b/i.test(q)
    ) {
      return {
        intent: "ARCHITECTURE_VISUAL_REQUEST",
        wantsCode: false,
        wantsVisual: true,
        subject: raw,
        confidence: 0.95,
      };
    }

    // 6. WORKFLOW_REQUEST
    if (/\b(?:make|create|draw|generate|build|show)\s+(?:(?:me\s+)?(?:an?|the)\s+)?(?:workflow|work\s*flow|process\s+diagram|pipeline\s+diagram|ci\/?cd\s+workflow|lifecycle\s+diagram)\b/i.test(q)) {
      return {
        intent: "WORKFLOW_REQUEST",
        wantsCode: false,
        wantsVisual: true,
        subject: raw,
        confidence: 0.93,
      };
    }

    // 7. MINDMAP_REQUEST
    if (/\b(?:make|create|draw|generate|build|show)\s+(?:(?:me\s+)?(?:an?|the)\s+)?(?:mind\s*map|mindmap|concept\s*map|brainstorm\s*map|topic\s*tree)\b/i.test(q)) {
      return {
        intent: "MINDMAP_REQUEST",
        wantsCode: false,
        wantsVisual: true,
        subject: raw,
        confidence: 0.96,
      };
    }

    // 8. CHART_REQUEST (Bar, Pie, Donut, Line, Area, Scatter)
    if (/\b(?:make|create|draw|generate|build|show)\s+(?:(?:me\s+)?(?:an?|the)\s+)?(?:bar\s*chart|pie\s*chart|donut\s*chart|line\s*chart|area\s*chart|scatter\s*plot|histogram|chart)\b/i.test(q)) {
      return {
        intent: "CHART_REQUEST",
        wantsCode: false,
        wantsVisual: true,
        subject: raw,
        confidence: 0.94,
      };
    }

    // 9. INFOGRAPHIC_REQUEST
    if (/\b(?:make|create|draw|generate|build|show)\s+(?:(?:me\s+)?(?:an?|the)\s+)?(?:infographic|info\s*graphic|visual\s*cheat\s*sheet|summary\s*poster)\b/i.test(q)) {
      return {
        intent: "INFOGRAPHIC_REQUEST",
        wantsCode: false,
        wantsVisual: true,
        subject: raw,
        confidence: 0.92,
      };
    }

    // 10. DIAGRAM_REQUEST (Trees, Data structures, UML, ERD, General Diagrams)
    if (
      /\b(?:make|create|draw|generate|build|show|visualize)\s+(?:(?:me\s+)?(?:an?|the)\s+)?(?:diagram|tree\s+diagram|binary\s+search\s+tree|bst|avl\s+tree|red\s*black\s+tree|heap|graph\s+structure|uml|er\s+diagram|entity\s+relationship|class\s+diagram|sequence\s+diagram|state\s+diagram)\b/i.test(q)
    ) {
      return {
        intent: "DIAGRAM_REQUEST",
        wantsCode: false,
        wantsVisual: true,
        subject: raw,
        confidence: 0.91,
      };
    }

    // 11. IMAGE_REQUEST (Photorealistic, Generative AI images, Paintings, Illustrations)
    if (
      /\b(?:generate|create|render|make|draw|bana\s*do|banao)\s+(?:(?:me\s+)?(?:an?|the)\s+)?(?:image|picture|photo|illustration|artwork|visual|graphic)\b/i.test(q) ||
      /\b(?:image\s+of|photo\s+of|illustration\s+of|picture\s+of|artwork\s+of|visual\s+of)\b/i.test(q) ||
      /\b(?:photorealistic|hd\s+photo|realistic\s+image|generated\s+image)\b/i.test(q)
    ) {
      return {
        intent: "IMAGE_REQUEST",
        wantsCode: false,
        wantsVisual: true,
        subject: raw,
        confidence: 0.90,
      };
    }

    // 12. TABLE_REQUEST
    if (/\b(?:make|create|generate|show)\s+(?:(?:me\s+)?(?:an?|the)\s+)?(?:comparison\s+table|table\s+comparing|tabular\s+form)\b/i.test(q) || /\bin\s+a\s+table\b/i.test(q)) {
      return {
        intent: "TABLE_REQUEST",
        wantsCode: false,
        wantsVisual: true,
        subject: raw,
        confidence: 0.88,
      };
    }

    // 13. DOCUMENT_ARTIFACT_REQUEST
    if (/\b(?:presentation|slide\s*deck|pptx|docx|pdf\s+report|spreadsheet|xlsx)\b/i.test(q) && /\b(?:generate|create|build|make|export)\b/i.test(q)) {
      return {
        intent: "DOCUMENT_ARTIFACT_REQUEST",
        wantsCode: false,
        wantsVisual: true,
        subject: raw,
        confidence: 0.89,
      };
    }

    // Default: NORMAL_TEXT
    return {
      intent: "NORMAL_TEXT",
      wantsCode: false,
      wantsVisual: false,
      subject: raw,
      confidence: 0.85,
    };
  }
}
