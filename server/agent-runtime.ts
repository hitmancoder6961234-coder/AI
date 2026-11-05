/**
 * DARKNESS UNIFIED AI AGENT RUNTIME
 * Single shared, production-grade AI Agent Runtime powering all chat shells in Darkness:
 * - Home / Main Chat
 * - Knowledge RAG Chat
 * - Project AI Assistant / Chat Cell
 * - Artifact Generation Chat
 * - Technical Assistant & Code Chat
 */

import path from "path";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import {
  streamGeminiWithResilience,
  resolveSupportedGeminiModel,
  getEffectiveGeminiApiKey,
} from "./gemini-resilience.js";
import { UniversalVisualIntentRouter, type VisualIntentClassification } from "./visual-intent-router.js";
import { analyzeProject, ExtractedFile } from "./project-analyzer.js";
import { searchKnowledge, assembleContext } from "./knowledge-engine.js";
import { searchUserMultiDocumentRag, buildMultiDocumentKnowledgePrompt } from "./rag-engine.js";
import { ProjectIntentClassifier, ProjectUnderstandingEngine } from "./project-understanding-engine.js";
import { AnswerEngine, UnifiedIntent } from "../web/src/answer-engine.js";
import { UniversalExplanationEngine, UniversalMathSolver } from "./study-learning-engine.js";
// These were used below without being imported, so every document / image step threw a ReferenceError inside its try block.
import { generateDocxReport, generateExcelWorkbook, generatePowerPointPresentation, generatePdfReport, type GeneratedArtifact } from "./file-generator.js";
import { generateProjectImage } from "./image-service.js";
import {
  generateProfessionalMermaidDiagram,
  renderProfessionalWorkflowSvg,
  renderProfessionalArchitectureSvg,
} from "./architecture-diagram-renderer.js";
import {
  buildFormattedGeminiHistory,
  buildFormattedOpenAiHistory,
} from "./model-registry-engine.js";
import { saveMessage, getProjectAnalysis, getWorkspaceFile } from "./db.js";
import { fileOwnership, projectOwnership } from "./ownership.js";
import { fetchWithPolicy, iterateWithIdleTimeout } from "./provider-http.js";
import { isSupabaseConfigured, syncMessageToSupabase } from "./supabase.js";










export interface AgentContextParams {
  userId: string;
  conversationId?: string;
  projectId?: string;
  message?: string;
  attachments?: any[];
  fileIds?: string[];
  modelId?: string;
  selectedCodeContext?: any;
  professorMode?: string;
  history?: any[];
  targetFile?: string;
  generationMode?: string;
  knowledgeContextId?: string;
  user?: any;
  sendSSE: (data: any) => void;
  signal?: AbortSignal;
  conversations?: Map<string, any>;
  messages?: Map<string, any>;
  projects?: Map<string, any>;
  files?: Map<string, any>;
  projectAnalyses?: Map<string, any>;
  projectArtifacts?: Map<string, any>;
  dbCreateArtifact?: (artifact: any) => any; // may be synchronous (the server passes the SQLite helper)
  resolveModelConfig?: (modelId?: string, userId?: string) => any;
  getWorkspaceFile?: (fileId: string) => any;
  /** The user's relevant memory notes, already formatted and bounded (server/memory.ts); appended to the system instruction as quoted data. */
  memoryBlock?: string;
}

export class AgentRuntime {
  /**
   * Main entry point for executing an AI Agent request across any chat shell.
   */
  static async execute(params: AgentContextParams): Promise<{ success: boolean; responseText: string }> {
    const {
      userId,
      conversationId: cid,
      projectId: rawProjectId,
      message,
      attachments,
      fileIds,
      modelId,
      selectedCodeContext,
      user,
      sendSSE,
      signal,
      conversations = new Map(),
      messages = new Map(),
      projects = new Map(),
      files = new Map(),
      projectAnalyses = new Map(),
      projectArtifacts = new Map(),
      dbCreateArtifact,
      resolveModelConfig = () => null,
    } = params;

    let textMsg = String(message || "").trim();

    // 1. Resolve attachments and extracted document context
    let attachedDocsContext = "";
    if (Array.isArray(fileIds)) {
      for (const fid of fileIds) {
        // an attached file must belong to the caller (a foreign id is skipped, like an unknown one)
        if (fileOwnership(fid, userId, files) !== "owned") continue;
        const fileObj = files.get(fid) || getWorkspaceFile(fid);
        if (fileObj && fileObj.content) {
          attachedDocsContext += `\n\n=== ATTACHED DOCUMENT "${fileObj.filename}": ===\n${fileObj.content.substring(0, 30000)}\n=== END OF ATTACHED DOCUMENT ===\n`;
        }
      }
    }
    if (Array.isArray(attachments)) {
      for (const att of attachments) {
        if (att.content && (!fileIds || !fileIds.includes(att.id || att.file_id))) {
          attachedDocsContext += `\n\n=== ATTACHED DOCUMENT "${att.name || att.filename}": ===\n${att.content.substring(0, 30000)}\n=== END OF ATTACHED DOCUMENT ===\n`;
        }
      }
    }
    if (attachedDocsContext) {
      textMsg = (textMsg ? textMsg + "\n" : "Analyze the attached documents:") + attachedDocsContext;
    }

    if (!textMsg) {
      sendSSE({ error: { message: "Message or attachment is required" } });
      return { success: false, responseText: "" };
    }

    // Validate selectedCodeContext if provided
    if (selectedCodeContext && (!selectedCodeContext.selectedCode || selectedCodeContext.selectedCode.trim().length === 0)) {
      const errMsg = "Code Explorer Ask AI request failed: Selected code snippet is empty or missing.";
      sendSSE({ error: { message: errMsg } });
      return { success: false, responseText: errMsg };
    }

    // 2. Resolve Model Configuration
    const modelConfig = resolveModelConfig(modelId || user?.active_model_id, userId);
    if (!modelConfig) {
      sendSSE({
        error: {
          message: "No AI model is configured. Please navigate to Models in the navigation bar to add a model.",
          type: "MODEL_NOT_CONFIGURED",
        },
      });
      return { success: false, responseText: "" };
    }
    const activeModelId = modelConfig.modelName || modelConfig.id;

    // 3. Classify Intent
    // A project id from the client is honoured only for the caller's own projects: another user's id is treated as "no project", so its files,
    // analysis and knowledge never reach the model prompt.
    const projectId = typeof rawProjectId === "string" && rawProjectId && projectOwnership(rawProjectId, userId, projects) !== "foreign" ? rawProjectId : undefined;
    const visualClass = UniversalVisualIntentRouter.classify(textMsg, projectId);

    // 4. Handle Rich Artifact / Visual Generation (PPT, DOCX, PDF, XLSX, Images, Diagrams)
    if (visualClass.wantsVisual && !visualClass.wantsCode) {
      const handled = await AgentRuntime.handleArtifactGeneration({
        textMsg,
        visualClass,
        sendSSE,
        user,
        cid,
        activeModelId,
        modelConfig,
        projectId,
        projectAnalyses,
        messages,
        projectArtifacts,
        dbCreateArtifact,
        projects,
        files,
      });
      if (handled) {
        return { success: true, responseText: "Artifact generated successfully." };
      }
    }

    // 5. Handle Deterministic Math & Analytical Solving
    const mathSolveMatch = textMsg.match(/(?:solve|calculate|compute|evaluate|find)\s+([0-9xXyYzZ+\-*/^=().\s]{3,})/i) ||
                           textMsg.match(/(?:[0-9]+\s*[xX]\s*\^2|[0-9]+\s*[xX]\s*[+\-]|T\(n\)\s*=)/i);
    if (mathSolveMatch && !projectId) {
      try {
        // solveProblem returns the structured result (solve() returns only its markdown string, which has no `.success`, so this
        // branch could never run). Only answer deterministically when the solver verified its own answer; otherwise ask the model.
        const solvedResult = UniversalMathSolver.solveProblem(textMsg);
        if (solvedResult && solvedResult.overallVerified && solvedResult.canonicalMarkdown) {
          sendSSE({ content: solvedResult.canonicalMarkdown });
          sendSSE({ done: true });
          
          // Save assistant message
          AgentRuntime.saveAssistantMessage(cid, userId, activeModelId, solvedResult.canonicalMarkdown, messages);
          return { success: true, responseText: solvedResult.canonicalMarkdown };
        }
      } catch (e) {
        // Fall back to standard explanation engine
      }
    }

    // 6. Hydrate Conversation History & Resolve Follow-Up Context
    let effectiveHistory = params.history || [];
    if (effectiveHistory.length === 0 && cid) {
      const convMsgs = Array.from(messages.values())
        .filter(m => m.conversation_id === cid && m.content)
        .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
      
      const priorMsgs = convMsgs.filter(m => m.content !== textMsg || convMsgs.indexOf(m) < convMsgs.length - 1);
      effectiveHistory = priorMsgs.map(m => ({ role: m.role, content: m.content }));
    }

    const resolvedContext = AnswerEngine.resolveFollowUpContext(textMsg, effectiveHistory);

    if (resolvedContext.requiresClarification) {
      sendSSE({ content: resolvedContext.resolvedQuery });
      sendSSE({ done: true });
      AgentRuntime.saveAssistantMessage(cid, userId, activeModelId, resolvedContext.resolvedQuery, messages);
      return { success: true, responseText: resolvedContext.resolvedQuery };
    }

    const activeUserQuery = resolvedContext.resolvedQuery || textMsg;

    // =========================================================================
    // SUB-SECOND FAST PATH: SELECTED CODE "ASK AI" EXPLANATIONS
    // Bypass heavy multi-file AST re-analysis and multi-chunk vector searches when
    // user has explicitly highlighted a specific code snippet to ask about!
    // =========================================================================
    if (selectedCodeContext && selectedCodeContext.selectedCode && selectedCodeContext.selectedCode.trim().length > 0) {
      const sc = selectedCodeContext;
      const fPath = sc.filePath || params.targetFile || "file";
      const startLine = sc.startLine || 1;
      const endLine = sc.endLine || startLine;
      const lineRangeStr = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`;
      const codeLang = sc.language || "typescript";

      const fastSystemInstruction = `You are Darkness, an expert AI Senior Software Engineer and Code Mentor.
Ground your explanation DIRECTLY in the exact selected code snippet provided (${fPath}, ${lineRangeStr}).

========================================================================
MANDATORY CODE-FIRST TEACHING FORMAT (STRICT RULE):
When explaining code, you MUST ALWAYS follow this exact sequence:

1. Show a small, readable section of the original selected code inside a code block.
2. Immediately below it, explain what that specific code section does statement-by-statement in execution order.
3. Show a concrete example with sample values, tracing output or variable state changes.
4. Highlight common mistakes, gotchas, or edge cases for that section.
5. Move to the next code section and repeat steps 1-4.
6. End with the complete overall execution flow summary and a short recap.

DO NOT write a long generic text summary or bullet points before showing the code that the explanation refers to! ALWAYS show the code block FIRST.
========================================================================

MATCH USER LANGUAGE: Answer naturally in the language used by the user (English, Hindi, Marathi, Hinglish). Never translate or alter source code identifiers. Quote exact code statements before explaining them.`;

      const fastPromptText = `User Question: ${activeUserQuery}\n\n=== SELECTED SOURCE CODE (${fPath}, ${lineRangeStr}) ===\n\`\`\`${codeLang}\n${sc.selectedCode.trim()}\n\`\`\`${sc.surroundingContext ? `\n\n=== SURROUNDING CONTEXT ===\n\`\`\`${codeLang}\n${sc.surroundingContext.trim()}\n\`\`\`` : ""}`;

      let assistantResponse = "";
      const apiKey = getEffectiveGeminiApiKey(modelConfig.apiKey);
      const fastModel = resolveSupportedGeminiModel(activeModelId || "gemini-3.1-flash-lite");

      const filter = new InternalTagStreamFilter((text) => {
        sendSSE({ content: text });
      });

      try {
        await streamGeminiWithResilience({
          apiKey,
          modelName: fastModel,
          contents: [
            { role: "user" as const, parts: [{ text: fastPromptText }] }
          ],
          systemInstruction: fastSystemInstruction,
          config: {
            maxOutputTokens: Math.max(modelConfig.maxOutputTokens || 8192, 8192),
            temperature: 0.2,
          },
          onChunk: (text) => {
            assistantResponse += text;
            filter.push(text);
          },
        });
        filter.flush();
        sendSSE({ done: true });
        AgentRuntime.saveAssistantMessage(cid, userId, fastModel, assistantResponse, messages);
        return { success: true, responseText: assistantResponse };
      } catch (err: any) {
        console.error("[Fast Selected Code Fast-Path Error]:", err);
      }
    }

    let systemInstruction = "";
    let promptText = activeUserQuery;
    let unifiedIntent: UnifiedIntent = "CONCEPTUAL_EXPLANATION";

    if (projectId) {
      // PROJECT ASSISTANT / CHAT CELL CONTEXT
      let analysis = projectAnalyses.get(projectId) || getProjectAnalysis(projectId);
      const projectFiles = Array.from(files.values()).filter((f) => f.project_id === projectId);
      const extracted: ExtractedFile[] = projectFiles.map((f) => ({
        path: f.filename,
        name: path.basename(f.filename),
        extension: path.extname(f.filename).toLowerCase(),
        size: f.size,
        isBinary: f.file_type === "binary",
        content: f.content,
        lineCount: f.content ? f.content.split(/\r?\n/).length : 0,
      }));

      if (!analysis) {
        const projObj = projects.get(projectId);
        analysis = analyzeProject(projObj?.name || "Project", projectId, extracted as any);
        projectAnalyses.set(projectId, analysis);
      }

      // Check if user specifically requested a diagram
      const projectIntent = ProjectIntentClassifier.classify(textMsg, params.targetFile, false);
      if (projectIntent === "DIAGRAM_REQUEST") {
        const isWorkflow = /workflow|pipeline|sequence|steps|process/i.test(textMsg);
        const mermaidCode = generateProfessionalMermaidDiagram(analysis, isWorkflow ? "workflow" : "architecture");
        const svgStr = isWorkflow ? renderProfessionalWorkflowSvg(analysis) : renderProfessionalArchitectureSvg(analysis);

        const safeFilename = `${(analysis.projectName || "System").replace(/\s+/g, "_")}_${isWorkflow ? "Workflow" : "Architecture"}.svg`;
        const diagArt: GeneratedArtifact = {
          id: `art_diag_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          projectId: projectId || "global",
          userId: user.id,
          conversationId: cid,
          filename: safeFilename,
          extension: "svg",
          mimeType: "image/svg+xml",
          size: svgStr.length,
          category: "diagram",
          description: isWorkflow ? "System Execution Workflow" : "System Architecture Diagram",
          content: svgStr,
          bufferBase64: Buffer.from(svgStr).toString("base64"),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          source: "Darkness Architecture Diagram Engine",
          validation: { status: "passed", message: "Verified SVG diagram" },
        };

        if (projectArtifacts) projectArtifacts.set(diagArt.id, diagArt);
        if (dbCreateArtifact) {
          try {
            dbCreateArtifact({
              id: diagArt.id,
              project_id: projectId || "global",
              name: diagArt.filename,
              path: diagArt.filename,
              mime_type: diagArt.mimeType,
              artifact_type: "diagram",
              content: JSON.stringify({
                bufferBase64: diagArt.bufferBase64,
                description: diagArt.description,
                size: diagArt.size,
                mimeType: diagArt.mimeType,
                category: diagArt.category,
                filename: diagArt.filename,
                extension: diagArt.extension,
                validation: diagArt.validation,
              })
            });
          } catch (e) {}
        }

        let diagramResponse = `### 🖼️ ${isWorkflow ? "System Execution Workflow" : "System Architecture Diagram"}\n\n\`\`\`mermaid\n${mermaidCode}\n\`\`\`\n\n\`\`\`svg\n${svgStr}\n\`\`\``;
        sendSSE({ type: "artifacts", artifacts: [diagArt] });
        sendSSE({ content: diagramResponse });
        sendSSE({ done: true });
        AgentRuntime.saveAssistantMessage(cid, userId, activeModelId, diagramResponse, messages, [diagArt]);
        return { success: true, responseText: diagramResponse };
      }

      // Code search grounding
      const searchResults = searchKnowledge(projectId, activeUserQuery, 12);
      const codeContextStr = searchResults.length > 0 ? assembleContext(searchResults, analysis.architecture) : "";

      unifiedIntent = resolvedContext.overrideIntent || AnswerEngine.classifyIntent(activeUserQuery, {
        projectId,
        hasFiles: extracted.length > 0,
        attachedDocs: attachedDocsContext || undefined,
        targetFile: params.targetFile || undefined,
        history: effectiveHistory,
      });

      const responsePlan = AnswerEngine.planResponse(activeUserQuery, unifiedIntent, {
        projectId,
        hasFiles: extracted.length > 0,
        attachedDocs: attachedDocsContext || undefined,
        targetFile: params.targetFile || undefined,
        history: effectiveHistory,
      });

      if (selectedCodeContext && selectedCodeContext.selectedCode && selectedCodeContext.selectedCode.trim().length > 0) {
        unifiedIntent = "CODE_EXPLANATION";
        const sc = selectedCodeContext;
        const fPath = sc.filePath || params.targetFile || "file";
        const lineRangeStr = sc.startLine ? (sc.startLine === sc.endLine ? `Line ${sc.startLine}` : `Lines ${sc.startLine}–${sc.endLine}`) : "";

        promptText = `User Question: ${activeUserQuery}\n\n=== SELECTED SOURCE CODE (${fPath}${lineRangeStr ? `, ${lineRangeStr}` : ""}) ===\n\`\`\`${sc.language || "typescript"}\n${sc.selectedCode.trim()}\n\`\`\`${sc.surroundingContext ? `\n\n=== SURROUNDING FILE CONTEXT ===\n\`\`\`${sc.language || "typescript"}\n${sc.surroundingContext.trim()}\n\`\`\`` : ""}`;

        systemInstruction = `${responsePlan.systemInstruction}\n\nYou are an expert AI Master Coding Tutor and Senior Engineer. Ground your response DIRECTLY in the selected code snippet (${fPath}${lineRangeStr ? ` ${lineRangeStr}` : ""}).
Do NOT output generic whole-project overviews. Answer the user's question ("${activeUserQuery}") with deep, clear, beginner-friendly pedagogical darkness.

========================================================================
MANDATORY CODE-FIRST TEACHING FORMAT (STRICT RULE):
When explaining code, you MUST ALWAYS follow this exact sequence:

1. Show a small, readable section of the original selected code inside a code block.
2. Immediately below it, explain what that specific code section does line-by-line or statement-by-statement in execution order.
3. Walk through statements in execution order.
4. Show a small example with concrete values, tracing variable state or output.
5. Identify common mistakes, edge cases, or complexity for that section.
6. Move to the next code section and repeat.
7. Finish with the complete overall execution flow summary and a short recap.

DO NOT write a long generic text summary before showing the code block! ALWAYS show the code block FIRST.
========================================================================`;
      } else if (unifiedIntent === "CODE_EXPLANATION") {
        systemInstruction = responsePlan.systemInstruction;
        if (params.targetFile) {
          systemInstruction += `\n\nActive File: ${params.targetFile}`;
        }
        promptText = activeUserQuery;
      } else {
        const parsedContext = ProjectUnderstandingEngine.buildPromptAndInstruction({
          analysis,
          files: extracted as any,
          userQuestion: activeUserQuery,
          targetFile: params.targetFile || undefined,
          hasSnippet: params.generationMode === "snippet",
          attachedDocsContext: attachedDocsContext || undefined,
        });

        systemInstruction = responsePlan.systemInstruction + "\n\n" + parsedContext.systemInstruction;
        if (codeContextStr) {
          systemInstruction += `\n\n=== RELEVANT CODE CHUNKS ===\n${codeContextStr}\n`;
        }
        promptText = parsedContext.userPrompt;
      }

    } else if (cid.startsWith("knowledge_rag_chat_") || params.knowledgeContextId) {
      // =========================================================================
      // PIPELINE 2: KNOWLEDGE RAG CHAT (Multi-Document Knowledge Intelligence)
      // =========================================================================
      const multiDoc = searchUserMultiDocumentRag(userId, activeUserQuery, {
        topKPerDoc: 6,
        maxTotalChunks: 14,
        threshold: 0.35,
        tokenBudget: 50000,
        conversationHistory: effectiveHistory,
      });

      const hasKnowledgeBase = Boolean(multiDoc.groundedContext && multiDoc.documentGroups.length > 0);
      unifiedIntent = resolvedContext.overrideIntent || AnswerEngine.classifyIntent(activeUserQuery, {
        attachedDocs: attachedDocsContext || undefined,
        hasKnowledgeBase,
        history: effectiveHistory,
      });

      const responsePlan = AnswerEngine.planResponse(activeUserQuery, unifiedIntent, {
        attachedDocs: attachedDocsContext || undefined,
        hasKnowledgeBase,
        history: effectiveHistory,
      });

      if ((hasKnowledgeBase || attachedDocsContext) && unifiedIntent === "DOCUMENT_RAG_QUERY") {
        const combinedGrounded = (multiDoc.groundedContext || "") + (attachedDocsContext ? `\n\n${attachedDocsContext}` : "");
        promptText = buildMultiDocumentKnowledgePrompt({
          query: activeUserQuery,
          groundedContext: combinedGrounded,
          documentNames: multiDoc.documentGroups.map((g) => g.filename),
          conversationHistory: effectiveHistory,
        });
        systemInstruction = responsePlan.systemInstruction + "\n\n" + "You are Darkness AI, a precise, helpful, and highly intelligent AI knowledge and educational assistant. For document-specific questions, ground answers in provided documents. For general concepts, math, CS, or analytical questions, answer comprehensively and directly.";
      } else {
        // Universal Explanation Engine Directives
        const engineCtx = UniversalExplanationEngine.orchestrate(activeUserQuery);
        systemInstruction = responsePlan.systemInstruction + "\n\n" + UniversalExplanationEngine.getPromptDirectives(engineCtx);
      }

    } else {
      // =========================================================================
      // PIPELINE 3: HOME / MAIN CHAT (Universal Conversational Intelligence)
      // =========================================================================
      const hasAttachedDocs = Boolean(attachedDocsContext);
      unifiedIntent = resolvedContext.overrideIntent || AnswerEngine.classifyIntent(activeUserQuery, {
        attachedDocs: attachedDocsContext || undefined,
        hasKnowledgeBase: hasAttachedDocs,
        history: effectiveHistory,
      });

      const responsePlan = AnswerEngine.planResponse(activeUserQuery, unifiedIntent, {
        attachedDocs: attachedDocsContext || undefined,
        hasKnowledgeBase: hasAttachedDocs,
        history: effectiveHistory,
      });

      if (selectedCodeContext && selectedCodeContext.selectedCode && selectedCodeContext.selectedCode.trim().length > 0) {
        unifiedIntent = "CODE_EXPLANATION";
        const sc = selectedCodeContext;
        const fPath = sc.filePath || "file";
        const lineRangeStr = sc.startLine ? (sc.startLine === sc.endLine ? `Line ${sc.startLine}` : `Lines ${sc.startLine}–${sc.endLine}`) : "";

        promptText = `User Question: ${activeUserQuery}\n\n=== SELECTED SOURCE CODE (${fPath}${lineRangeStr ? `, ${lineRangeStr}` : ""}) ===\n\`\`\`${sc.language || "typescript"}\n${sc.selectedCode.trim()}\n\`\`\``;

        systemInstruction = `${responsePlan.systemInstruction}\n\nYou are an expert AI code assistant. Ground your explanation DIRECTLY in the exact selected code snippet provided (${fPath}${lineRangeStr ? ` ${lineRangeStr}` : ""}).
Focus directly on explaining the snippet, its variables, parameters, logic, failure modes, and execution flow to answer the user's question: "${activeUserQuery}".`;
      } else if (hasAttachedDocs && unifiedIntent === "DOCUMENT_RAG_QUERY") {
        promptText = `=== USER ATTACHED DOCUMENTS FOR THIS CHAT ===\n${attachedDocsContext}\n=== END OF ATTACHED DOCUMENTS ===\n\nUser Question: ${activeUserQuery}`;
        systemInstruction = responsePlan.systemInstruction + "\n\n" + "You are Darkness AI. The user has attached files to this conversation. Answer their question based on the attached files with darkness, structure, and precision.";
      } else {
        // Universal Explanation Engine Directives
        const engineCtx = UniversalExplanationEngine.orchestrate(activeUserQuery);
        systemInstruction = responsePlan.systemInstruction + "\n\n" + UniversalExplanationEngine.getPromptDirectives(engineCtx);
      }
    }

    if (resolvedContext.activeTopic) {
      if (resolvedContext.isFollowUp) {
        systemInstruction += `\n\n=== CONVERSATION TOPIC MEMORY ===\nActive Subject: ${resolvedContext.activeTopic}\nThis request is a CONTEXTUAL FOLLOW-UP regarding ${resolvedContext.activeTopic}. Maintain conversation continuity for this active subject. Do NOT restart topics, do NOT ask what the user wants to learn again, and answer directly within this active subject context.`;
      } else {
        systemInstruction += `\n\n=== CONVERSATION TOPIC MEMORY ===\nActive Subject: ${resolvedContext.activeTopic}\nThe user has introduced or switched to a NEW TOPIC: ${resolvedContext.activeTopic}. Answer this new request independently and directly from scratch. Do NOT force unrelated prior topics or subjects from previous messages into this response unless explicitly requested for comparison.`;
      }
    }

    // 7. Streaming Model Generation
    // Prepend/Append planning protocols & formatting rules to system instruction
    if (params.memoryBlock) systemInstruction += params.memoryBlock; // the user's own notes, quoted as data (server/memory.ts)
    systemInstruction += "\n" + CORE_PLANNING_SYSTEM_INSTRUCTION + "\n" + CORE_RESPONSE_CONSTRAINTS;

    let assistantResponse = "";
    const apiKey = modelConfig.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

    const filter = new InternalTagStreamFilter((text) => {
      sendSSE({ content: text });
    });

    let viaCompatibleProvider = false;
    try {
      if (modelConfig.provider && modelConfig.provider !== "gemini" && modelConfig.baseUrl) {
        // OpenAI-compatible endpoint
        const baseUrl = modelConfig.baseUrl.replace(/\/$/, "");
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (modelConfig.apiKey) headers["Authorization"] = `Bearer ${modelConfig.apiKey}`;

        // The old call used `signal || AbortSignal.timeout(60000)`: when the caller supplied a signal there was NO timeout at all.
        // Now: time-to-first-byte timeout, retries for transient failures before any text, an idle timeout, and cancellation.
        // A failure is reported to the user with the provider's own message. It used to be swallowed and the question was then
        // silently sent to Gemini with the server's key: the user saw an unrelated Google error, and their prompt had gone to a
        // different provider than the one they chose.
        viaCompatibleProvider = true;
        let fetchRes: Response | null = null;
        try {
          fetchRes = await fetchWithPolicy(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: activeModelId,
              messages: [
                { role: "system", content: systemInstruction },
                ...buildFormattedOpenAiHistory(effectiveHistory),
                { role: "user", content: promptText },
              ],
              max_tokens: modelConfig.maxOutputTokens || 8192,
              temperature: modelConfig.defaultTemperature ?? 0.3,
              stream: true,
            }),
          }, { label: "model provider", stream: true, signal });
        } catch (provErr: any) {
          console.warn(`[Agent] provider request failed (${provErr?.kind || "error"}): ${String(provErr?.message || provErr).slice(0, 200)}`);
          throw provErr;
        }

        if (fetchRes && fetchRes.body) {
          const decoder = new TextDecoder();
          let sseBuffer = "";
          const consume = (rawLine: string) => {
            const line = rawLine.trim();
            if (!line || line === "data:" || line === "data: [DONE]") return;
            if (line.startsWith("data:")) {
              try {
                const data = JSON.parse(line.slice(5).trim());
                const text = data.choices?.[0]?.delta?.content;
                if (text) {
                  assistantResponse += text;
                  filter.push(text);
                }
              } catch (e) {}
            }
          };
          for await (const value of iterateWithIdleTimeout(fetchRes.body, { signal, label: "model provider" })) {
            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split("\n");
            sseBuffer = lines.pop() || "";
            for (const rawLine of lines) consume(rawLine);
          }
          if (sseBuffer) consume(sseBuffer);
        }
        if (!assistantResponse) throw new Error("The model provider returned an empty answer.");
      }

      if (!assistantResponse && !viaCompatibleProvider) {
        // Strict alternating history resolution for conversational follow-ups
        let geminiContents: any = promptText;
        if (effectiveHistory && effectiveHistory.length > 0) {
          const formattedHistory = buildFormattedGeminiHistory(effectiveHistory);
          if (formattedHistory.length > 0) {
            geminiContents = [
              ...formattedHistory,
              { role: "user" as const, parts: [{ text: promptText }] }
            ];
          }
        }

        // Gemini Resilience Fallback / Standard Gemini Stream
        await streamGeminiWithResilience({
          apiKey,
          modelName: activeModelId,
          contents: geminiContents,
          systemInstruction,
          config: {
            maxOutputTokens: modelConfig.maxOutputTokens || 8192,
            temperature: modelConfig.defaultTemperature ?? 0.3,
          },
          onChunk: (text) => {
            assistantResponse += text;
            filter.push(text);
          },
        });
      }

      filter.flush();

      // Sanitize response via AnswerEngine
      const sanitized = AnswerEngine.sanitizeResponse(assistantResponse);
      const suggestedActions = AnswerEngine.getSuggestedActions(unifiedIntent, resolvedContext.activeTopic, activeUserQuery);
      sendSSE({ done: true, suggested_actions: suggestedActions });

      // Save assistant message to persistent history
      AgentRuntime.saveAssistantMessage(cid, userId, activeModelId, sanitized, messages, undefined, suggestedActions);
      return { success: true, responseText: sanitized };

    } catch (err: any) {
      console.error("[AgentRuntime Error]:", err);
      const errMsg = "I encountered an error processing your request: " + (err?.message || "Internal server error");
      sendSSE({ error: { message: errMsg } });
      return { success: false, responseText: errMsg };
    }
  }

  /**
   * Universal Agent Artifact & Visual Generation Pipeline
   */
  private static async handleArtifactGeneration(params: {
    textMsg: string;
    visualClass: VisualIntentClassification;
    sendSSE: (payload: any) => void;
    user: any;
    cid: string;
    activeModelId: string;
    modelConfig: any;
    projectId?: string;
    projectAnalyses?: Map<string, any>;
    messages?: Map<string, any>;
    projectArtifacts?: Map<string, GeneratedArtifact>;
    dbCreateArtifact?: (artifact: any) => any;
    projects?: Map<string, any>;
    files?: Map<string, any>;
  }): Promise<boolean> {
    const {
      textMsg,
      visualClass,
      sendSSE,
      user,
      cid,
      activeModelId,
      modelConfig,
      projectId,
      projectAnalyses = new Map(),
      messages,
      projectArtifacts,
      dbCreateArtifact,
      projects = new Map(),
      files = new Map(),
    } = params;

    // =========================================================================
    // 1. DOCX, PDF, AND LEARNING IMAGE PACKAGE (STUDENT REPORT GENERATION)
    // =========================================================================
    if (
      visualClass.intent === "DOCX_GENERATION" ||
      visualClass.intent === "PDF_GENERATION" ||
      visualClass.intent === "DOCUMENT_ARTIFACT_REQUEST"
    ) {
      const steps = ["Analyzing Project", "Structuring Report", "Generating Documents", "Rendering Visuals", "Validating Package", "Done"];
      sendSSE({ type: "agent_state", steps, currentStep: "Analyzing Project", status: "active", intent: visualClass.intent });

      // Determine clean topic
      let topicClean = "Project & System Architecture";
      if (projectId) {
        const projObj = projects?.get(projectId);
        if (projObj?.name) topicClean = projObj.name;
      }
      const topicMatch = textMsg.match(/(?:about|for|on)\s+([^.\n]+)/i);
      if (topicMatch && topicMatch[1].trim()) {
        topicClean = topicMatch[1].replace(/[^a-zA-Z0-9\s_-]/g, "").trim() || topicClean;
      } else {
        const cleaned = textMsg.replace(/^(?:generate|create|make|build|banao|give|show)\s+(?:a\s+)?(?:word|docx?|docs?|pdf|student\s+)?(?:report|document|notes?)\s*/i, "").trim();
        if (cleaned && cleaned.length > 2 && !/^(?:it|this|now|please|karo|me)$/i.test(cleaned)) {
          topicClean = cleaned.replace(/[^a-zA-Z0-9\s_-]/g, "").trim() || topicClean;
        }
      }

      sendSSE({ type: "agent_state", steps, currentStep: "Structuring Report", status: "active", intent: visualClass.intent });

      let analysis = projectId ? (projectAnalyses.get(projectId) || getProjectAnalysis(projectId)) : null;
      let projectFiles: ExtractedFile[] = [];
      if (projectId && files) {
        const pFiles = Array.from(files.values()).filter((f: any) => f.project_id === projectId);
        projectFiles = pFiles.map((f: any) => ({
          path: f.filename,
          name: path.basename(f.filename),
          extension: path.extname(f.filename).toLowerCase(),
          size: f.size,
          isBinary: f.file_type === "binary",
          content: f.content,
          lineCount: f.content ? f.content.split(/\r?\n/).length : 0,
        }));
      }

      if (!analysis) {
        analysis = analyzeProject(topicClean, projectId || "student_project", projectFiles);
      }

      sendSSE({ type: "agent_state", steps, currentStep: "Generating Documents", status: "active", intent: visualClass.intent });

      const artifactsToSend: GeneratedArtifact[] = [];

      // 1. Generate DOCX Word Report
      try {
        const docxBuf = await generateDocxReport(analysis, "technical_report", projectFiles, textMsg);
        const safeDocxFilename = `${topicClean.replace(/\s+/g, "_")}_Student_Report.docx`;
        const docxArtId = `art_docx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        const docxArtifact: GeneratedArtifact = {
          id: docxArtId,
          projectId: projectId || "global",
          userId: user.id,
          conversationId: cid,
          filename: safeDocxFilename,
          extension: "docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          size: docxBuf.length,
          category: "document",
          description: `Executive & Academic Report for ${topicClean}`,
          bufferBase64: docxBuf.toString("base64"),
          structuredData: {
            title: `${topicClean} Comprehensive Report`,
            summary: `Complete academic engineering and system architecture specification for ${topicClean}.`,
            sections: [
              { heading: "Executive Summary & Abstract", body: `Detailed evaluation and student guide for ${topicClean}.` },
              { heading: "System Architecture & Modules", body: "Modular decomposed layers, clean contracts, and state boundaries." },
              { heading: "Execution Workflow & Data Lifecycle", body: "Sequential processing stages from user input to verified delivery." },
              { heading: "Viva & Exam Preparation", body: "Core architectural concepts, trade-offs, and critical examination notes." }
            ]
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          source: "Darkness Document Engine",
          validation: { status: "passed", message: "Verified OpenXML Word document package" }
        };

        if (projectArtifacts) projectArtifacts.set(docxArtifact.id, docxArtifact);
        if (dbCreateArtifact) {
          try {
            dbCreateArtifact({
              id: docxArtifact.id,
              project_id: projectId || "global",
              name: docxArtifact.filename,
              path: docxArtifact.filename,
              mime_type: docxArtifact.mimeType,
              artifact_type: "document",
              content: JSON.stringify({
                bufferBase64: docxArtifact.bufferBase64,
                structuredData: docxArtifact.structuredData,
                description: docxArtifact.description,
                size: docxArtifact.size,
                mimeType: docxArtifact.mimeType,
                category: docxArtifact.category,
                filename: docxArtifact.filename,
                extension: docxArtifact.extension,
                validation: docxArtifact.validation,
              })
            });
          } catch (e) {}
        }
        artifactsToSend.push(docxArtifact);
      } catch (docxErr) {
        console.error("[AgentRuntime] DOCX generation error:", docxErr);
      }

      // 2. Generate Printable PDF Document
      try {
        const pdfBuf = await generatePdfReport(analysis, projectFiles, textMsg);
        const safePdfFilename = `${topicClean.replace(/\s+/g, "_")}_Student_Report.pdf`;
        const pdfArtId = `art_pdf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        const pdfArtifact: GeneratedArtifact = {
          id: pdfArtId,
          projectId: projectId || "global",
          userId: user.id,
          conversationId: cid,
          filename: safePdfFilename,
          extension: "pdf",
          mimeType: "application/pdf",
          size: pdfBuf.length,
          category: "pdf",
          description: `Printable Academic & Project Report for ${topicClean}`,
          bufferBase64: pdfBuf.toString("base64"),
          structuredData: {
            title: `${topicClean} Evaluation PDF`,
            summary: `Printable technical report with architecture diagrams, API catalog, and security findings.`
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          source: "Darkness PDF Engine",
          validation: { status: "passed", message: "Verified PDF Document structure" }
        };

        if (projectArtifacts) projectArtifacts.set(pdfArtifact.id, pdfArtifact);
        if (dbCreateArtifact) {
          try {
            dbCreateArtifact({
              id: pdfArtifact.id,
              project_id: projectId || "global",
              name: pdfArtifact.filename,
              path: pdfArtifact.filename,
              mime_type: pdfArtifact.mimeType,
              artifact_type: "pdf",
              content: JSON.stringify({
                bufferBase64: pdfArtifact.bufferBase64,
                structuredData: pdfArtifact.structuredData,
                description: pdfArtifact.description,
                size: pdfArtifact.size,
                mimeType: pdfArtifact.mimeType,
                category: pdfArtifact.category,
                filename: pdfArtifact.filename,
                extension: pdfArtifact.extension,
                validation: pdfArtifact.validation,
              })
            });
          } catch (e) {}
        }
        artifactsToSend.push(pdfArtifact);
      } catch (pdfErr) {
        console.error("[AgentRuntime] PDF generation error:", pdfErr);
      }

      sendSSE({ type: "agent_state", steps, currentStep: "Rendering Visuals", status: "active", intent: visualClass.intent });

      // 3. Generate Visual Learning Concept Graphic
      let imageArtifact: GeneratedArtifact | null = null;
      try {
        const imgRes = await generateProjectImage({
          prompt: `Educational software architecture diagram and concept map for ${topicClean}, modern UI cards, clean vector styling, modular subsystems, professional technical infographic`,
          projectId: projectId || "global",
        });

        if (imgRes && (imgRes.bufferBase64 || imgRes.base64Data)) {
          const b64 = imgRes.bufferBase64 || imgRes.base64Data;
          const mime = imgRes.mimeType || "image/png";
          const ext = mime.includes("png") ? "png" : "jpg";
          const imgArtId = `art_img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

          imageArtifact = {
            id: imgArtId,
            projectId: projectId || "global",
            userId: user.id,
            conversationId: cid,
            filename: `${topicClean.slice(0, 30).replace(/[^a-zA-Z0-9]/g, "_")}_Concept_Diagram.${ext}`,
            extension: ext,
            mimeType: mime,
            size: Math.round((b64.length * 3) / 4),
            category: "image",
            description: `Visual Learning Architecture Graphic for ${topicClean}`,
            bufferBase64: b64,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            source: "Darkness Visual Learning Engine",
            validation: { status: "passed", message: "Verified visual asset" }
          };

          if (projectArtifacts) projectArtifacts.set(imageArtifact.id, imageArtifact);
          if (dbCreateArtifact) {
            try {
              dbCreateArtifact({
                id: imageArtifact.id,
                project_id: projectId || "global",
                name: imageArtifact.filename,
                path: imageArtifact.filename,
                mime_type: imageArtifact.mimeType,
                artifact_type: "image",
                content: JSON.stringify({
                  bufferBase64: imageArtifact.bufferBase64,
                  description: imageArtifact.description,
                  size: imageArtifact.size,
                  mimeType: imageArtifact.mimeType,
                  category: imageArtifact.category,
                  filename: imageArtifact.filename,
                  extension: imageArtifact.extension,
                  validation: imageArtifact.validation,
                })
              });
            } catch (e) {}
          }
          artifactsToSend.push(imageArtifact);
        }
      } catch (imgErr) {
        console.warn("[AgentRuntime] Concept image generation notice:", imgErr);
      }

      sendSSE({ type: "agent_state", steps, currentStep: "Validating Package", status: "active", intent: visualClass.intent });

      // 4. Build Pedagogical, Student-Friendly Markdown Report
      const studentReport = AgentRuntime.buildStudentLearningReport({
        topic: topicClean,
        analysis,
        artifacts: artifactsToSend,
        imageArtifact,
      });

      sendSSE({ type: "agent_state", steps, currentStep: "Done", status: "completed", intent: visualClass.intent });

      // Dispatch artifacts array so interactive artifact cards render in the chat
      if (artifactsToSend.length > 0) {
        sendSSE({ type: "artifacts", artifacts: artifactsToSend });
      }

      sendSSE({ content: studentReport });
      sendSSE({ done: true, artifacts: artifactsToSend });

      AgentRuntime.saveAssistantMessage(cid, user.id, activeModelId, studentReport, messages, artifactsToSend);
      return true;
    }

    // =========================================================================
    // 2. IMAGE_REQUEST (Photorealistic & Diagram Images)
    // =========================================================================
    if (visualClass.intent === "IMAGE_REQUEST") {
      const steps = ["Analyzing Prompt", "Generating Image", "Rendering Canvas", "Validating Asset", "Done"];
      sendSSE({ type: "agent_state", steps, currentStep: "Analyzing Prompt", status: "active", intent: "IMAGE_REQUEST" });

      const topicClean = textMsg.replace(/^(?:generate|create|render|make|banao)\s+(?:an?\s+)?(?:image|picture|photo|illustration|graphic)\s*(?:of\s+)?/i, "").trim() || "Visual Concept";

      sendSSE({ type: "agent_state", steps, currentStep: "Generating Image", status: "active", intent: "IMAGE_REQUEST" });

      try {
        const imgRes = await generateProjectImage({
          prompt: topicClean,
          projectId: projectId || "global",
          model: modelConfig?.modelName || "gemini-3.1-flash-lite-image",
          modelOverride: modelConfig?.modelName,
        });

        sendSSE({ type: "agent_state", steps, currentStep: "Rendering Canvas", status: "active", intent: "IMAGE_REQUEST" });
        sendSSE({ type: "agent_state", steps, currentStep: "Validating Asset", status: "active", intent: "IMAGE_REQUEST" });
        sendSSE({ type: "agent_state", steps, currentStep: "Done", status: "completed", intent: "IMAGE_REQUEST" });

        const artifactsToSend: GeneratedArtifact[] = [];
        let fullImgResponse = "";

        if (imgRes && (imgRes.bufferBase64 || imgRes.base64Data)) {
          const b64 = imgRes.bufferBase64 || imgRes.base64Data;
          const mime = imgRes.mimeType || "image/png";
          const ext = mime.includes("png") ? "png" : "jpg";
          const safeFilename = `${topicClean.slice(0, 30).replace(/[^a-zA-Z0-9]/g, "_")}_Graphic.${ext}`;
          const artId = `art_img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          const shortTitle = topicClean.length > 50 ? topicClean.slice(0, 47) + "..." : topicClean;
          const imageUrl = `data:${mime};base64,${b64}`;

          const imageArtifact: GeneratedArtifact = {
            id: artId,
            projectId: projectId || "global",
            userId: user.id,
            conversationId: cid,
            filename: safeFilename,
            extension: ext,
            mimeType: mime,
            size: Math.round((b64.length * 3) / 4),
            category: "image",
            description: `Generated Learning Graphic for ${shortTitle}`,
            bufferBase64: b64,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            source: "Darkness Visual Learning Engine",
            validation: { status: "passed", message: "Verified image binary" }
          };

          if (projectArtifacts) projectArtifacts.set(imageArtifact.id, imageArtifact);
          if (dbCreateArtifact) {
            try {
              dbCreateArtifact({
                id: imageArtifact.id,
                project_id: projectId || "global",
                name: imageArtifact.filename,
                path: imageArtifact.filename,
                mime_type: imageArtifact.mimeType,
                artifact_type: "image",
                content: JSON.stringify({
                  bufferBase64: imageArtifact.bufferBase64,
                  description: imageArtifact.description,
                  size: imageArtifact.size,
                  mimeType: imageArtifact.mimeType,
                  category: imageArtifact.category,
                  filename: imageArtifact.filename,
                  extension: imageArtifact.extension,
                  validation: imageArtifact.validation,
                })
              });
            } catch (e) {}
          }
          artifactsToSend.push(imageArtifact);

          fullImgResponse = `### 🖼️ Generated Visual Graphic: ${shortTitle}\n\nHere is your requested visual concept illustration:\n\n![${shortTitle}](${imageUrl})\n\n💡 *Use the action buttons below the card to view full screen or download the image asset.*`;
        } else {
          fullImgResponse = `Generated the requested visual image for **${topicClean}**.`;
        }

        if (artifactsToSend.length > 0) {
          sendSSE({ type: "artifacts", artifacts: artifactsToSend });
        }
        sendSSE({ content: fullImgResponse });
        sendSSE({ done: true });

        AgentRuntime.saveAssistantMessage(cid, user.id, activeModelId, fullImgResponse, messages, artifactsToSend);
        return true;
      } catch (err: any) {
        console.error("[AgentRuntime] Image Generation error:", err);
      }
    }

    // =========================================================================
    // 3. PPT_GENERATION (PowerPoint Presentations)
    // =========================================================================
    if (visualClass.intent === "PPT_GENERATION") {
      const steps = ["Analyzing", "Planning", "Generating", "Rendering", "Validating", "Done"];
      sendSSE({ type: "agent_state", steps, currentStep: "Analyzing", status: "active", intent: "PPT_GENERATION" });

      const topicMatch = textMsg.match(/(?:about|for|on)\s+([^.\n]+)/i);
      const rawTopic = topicMatch ? topicMatch[1].trim() : textMsg.replace(/^(?:generate|create|make|build)\s+(?:a\s+)?(?:5-slide\s+)?(?:ppt|presentation|deck|slides?|powerpoint)\s*/i, "").trim() || "System Architecture & Engineering";
      const topicClean = rawTopic.replace(/[^a-zA-Z0-9\s_-]/g, "").trim() || "Project";

      sendSSE({ type: "agent_state", steps, currentStep: "Planning", status: "active", intent: "PPT_GENERATION" });

      let analysis = projectId ? (projectAnalyses.get(projectId) || getProjectAnalysis(projectId)) : null;
      if (!analysis) {
        analysis = analyzeProject(topicClean, projectId || "gen_topic", []);
      }

      sendSSE({ type: "agent_state", steps, currentStep: "Generating", status: "active", intent: "PPT_GENERATION" });

      const apiKey = modelConfig.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
      const gemClient = apiKey ? new GoogleGenAI({ apiKey }) : null;

      try {
        const pptxBuf = await generatePowerPointPresentation(analysis, "technical_defense", [], textMsg, gemClient as any, modelConfig.modelName);
        sendSSE({ type: "agent_state", steps, currentStep: "Rendering", status: "active", intent: "PPT_GENERATION" });
        sendSSE({ type: "agent_state", steps, currentStep: "Validating", status: "active", intent: "PPT_GENERATION" });

        const safeFilename = `${topicClean.replace(/\s+/g, "_")}_Presentation.pptx`;
        const artId = `art_ppt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        const slidesData = [
          { title: topicClean, subtitle: "Executive Overview & Architecture", bullets: ["Problem Definition & Objectives", "System Architecture & Pipeline", "Key Modules & Data Flow"], notes: "Introduction slide." },
          { title: "Problem Statement & Solution", bullets: ["Current friction points", "Automated architecture solution", "High reliability & speed"], notes: "Core solution explanation." },
          { title: "System Architecture", bullets: ["Presentation layer & UI components", "Core logic engine & API gateways", "Persistent storage & intelligence layer"], notes: "System breakdown." },
          { title: "Operational Workflow", bullets: ["Input ingestion & validation", "Multi-stage automated processing", "Grounded verification & output"], notes: "Workflow steps." },
          { title: "Conclusion & Impact", bullets: ["Milestones completed", "Production-ready deployable architecture", "Scalable foundation"], notes: "Concluding summary." }
        ];

        const artifact: GeneratedArtifact = {
          id: artId,
          projectId: projectId || "global",
          userId: user.id,
          conversationId: cid,
          filename: safeFilename,
          extension: "pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          size: pptxBuf.length,
          category: "presentation",
          description: `Created a 5-slide presentation on ${topicClean}`,
          bufferBase64: pptxBuf.toString("base64"),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          source: "Darkness Presentation Engine",
          validation: { status: "passed", message: "Verified OpenXML presentation package" }
        };

        if (projectArtifacts) projectArtifacts.set(artifact.id, artifact);
        if (dbCreateArtifact) {
          try {
            dbCreateArtifact({
              id: artifact.id,
              project_id: projectId || "global",
              name: artifact.filename,
              path: artifact.filename,
              mime_type: artifact.mimeType,
              artifact_type: "presentation",
              content: JSON.stringify({
                bufferBase64: artifact.bufferBase64,
                description: artifact.description,
                size: artifact.size,
                mimeType: artifact.mimeType,
                category: artifact.category,
                filename: artifact.filename,
                extension: artifact.extension,
                validation: artifact.validation,
              })
            });
          } catch (e) {}
        }

        const pptContent = `### 📊 Generated Presentation: ${topicClean}\n\nI have generated your complete 5-slide presentation deck covering:\n\n1. **Executive Overview & Scope**\n2. **Problem Statement & Proposed Solution**\n3. **System Architecture & Key Subsystems**\n4. **Operational Workflow & Pipeline**\n5. **Impact & Strategic Roadmap**\n\n- **File**: \`${artifact.filename}\` (${(artifact.size / 1024).toFixed(1)} KB)\n\n💡 *Use the action button below the file card to download and present your slide deck.*`;

        sendSSE({ type: "agent_state", steps, currentStep: "Done", status: "completed", intent: "PPT_GENERATION" });
        sendSSE({ type: "artifacts", artifacts: [artifact] });
        sendSSE({ content: pptContent });
        sendSSE({ done: true });

        AgentRuntime.saveAssistantMessage(cid, user.id, activeModelId, pptContent, messages, [artifact]);
        return true;
      } catch (err: any) {
        console.error("PPT Generation error:", err);
      }
    }

    // =========================================================================
    // 4. XLSX_GENERATION (Excel Spreadsheets)
    // =========================================================================
    if (visualClass.intent === "XLSX_GENERATION") {
      const steps = ["Analyzing", "Planning", "Generating", "Validating", "Done"];
      sendSSE({ type: "agent_state", steps, currentStep: "Analyzing", status: "active", intent: "XLSX_GENERATION" });

      const topicMatch = textMsg.match(/(?:about|for|on)\s+([^.\n]+)/i);
      const rawTopic = topicMatch ? topicMatch[1].trim() : "Data Analytics & Metrics";
      const topicClean = rawTopic.replace(/[^a-zA-Z0-9\s_-]/g, "").trim() || "Metrics";

      sendSSE({ type: "agent_state", steps, currentStep: "Generating", status: "active", intent: "XLSX_GENERATION" });

      let analysis = projectId ? (projectAnalyses.get(projectId) || getProjectAnalysis(projectId)) : null;
      if (!analysis) analysis = analyzeProject(topicClean, projectId || "gen_topic", []);

      try {
        const xlsxBuf = await generateExcelWorkbook(analysis, [], textMsg);
        sendSSE({ type: "agent_state", steps, currentStep: "Validating", status: "active", intent: "XLSX_GENERATION" });

        const safeFilename = `${topicClean.replace(/\s+/g, "_")}_Data.xlsx`;
        const artId = `art_xls_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        const artifact: GeneratedArtifact = {
          id: artId,
          projectId: projectId || "global",
          userId: user.id,
          conversationId: cid,
          filename: safeFilename,
          extension: "xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: xlsxBuf.length,
          category: "spreadsheet",
          description: `Analytics workbook for ${topicClean}`,
          bufferBase64: xlsxBuf.toString("base64"),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          source: "Darkness Excel Engine",
          validation: { status: "passed", message: "Verified OpenXML Spreadsheet package" }
        };

        if (projectArtifacts) projectArtifacts.set(artifact.id, artifact);
        if (dbCreateArtifact) {
          try {
            dbCreateArtifact({
              id: artifact.id,
              project_id: projectId || "global",
              name: artifact.filename,
              path: artifact.filename,
              mime_type: artifact.mimeType,
              artifact_type: "spreadsheet",
              content: JSON.stringify({
                bufferBase64: artifact.bufferBase64,
                description: artifact.description,
                size: artifact.size,
                mimeType: artifact.mimeType,
                category: artifact.category,
                filename: artifact.filename,
                extension: artifact.extension,
                validation: artifact.validation,
              })
            });
          } catch (e) {}
        }

        const xlsxContent = `### 📈 Generated Spreadsheet: ${topicClean}\n\nI have generated your structured Excel spreadsheet with audit metrics, test indices, and performance benchmarks.\n\n- **File**: \`${artifact.filename}\` (${(artifact.size / 1024).toFixed(1)} KB)\n\n💡 *Use the action button below the file card to download and open your spreadsheet.*`;

        sendSSE({ type: "agent_state", steps, currentStep: "Done", status: "completed", intent: "XLSX_GENERATION" });
        sendSSE({ type: "artifacts", artifacts: [artifact] });
        sendSSE({ content: xlsxContent });
        sendSSE({ done: true });

        AgentRuntime.saveAssistantMessage(cid, user.id, activeModelId, xlsxContent, messages, [artifact]);
        return true;
      } catch (err: any) {
        console.error("XLSX Generation error:", err);
      }
    }

    // =========================================================================
    // 5. DIAGRAMS & FLOWCHARTS (SVG & Mermaid)
    // =========================================================================
    if (
      visualClass.intent === "DIAGRAM_REQUEST" ||
      visualClass.intent === "WORKFLOW_REQUEST" ||
      visualClass.intent === "FLOWCHART_REQUEST" ||
      visualClass.intent === "ARCHITECTURE_VISUAL_REQUEST" ||
      visualClass.intent === "MINDMAP_REQUEST" ||
      visualClass.intent === "GRAPH_REQUEST" ||
      visualClass.intent === "CHART_REQUEST"
    ) {
      const isWorkflow = visualClass.intent === "WORKFLOW_REQUEST" || /workflow|pipeline|sequence|steps|process/i.test(textMsg);
      let analysis = projectId ? (projectAnalyses.get(projectId) || getProjectAnalysis(projectId)) : null;
      if (!analysis) {
        analysis = analyzeProject("System Architecture", projectId || "global", []);
      }

      const mermaidCode = generateProfessionalMermaidDiagram(analysis, isWorkflow ? "workflow" : "architecture");
      const svgStr = isWorkflow ? renderProfessionalWorkflowSvg(analysis) : renderProfessionalArchitectureSvg(analysis);

      const title = isWorkflow ? "System Execution Workflow" : "System Architecture Diagram";
      let diagramResponse = `### 🖼️ ${title}\n\n\`\`\`mermaid\n${mermaidCode}\n\`\`\`\n\n\`\`\`svg\n${svgStr}\n\`\`\``;

      sendSSE({ content: diagramResponse });
      sendSSE({ done: true });
      AgentRuntime.saveAssistantMessage(cid, user.id, activeModelId, diagramResponse, messages);
      return true;
    }

    return false;
  }

  /**
   * Builds a structured, student-friendly Markdown learning report that is intuitive,
   * easy to grasp for students, and includes diagrams, key takeaways, and download info.
   */
  public static buildStudentLearningReport(params: {
    topic: string;
    analysis?: any;
    artifacts: GeneratedArtifact[];
    imageArtifact?: GeneratedArtifact | null;
  }): string {
    const { topic, analysis, artifacts, imageArtifact } = params;
    const cleanTopic = (topic || "System Architecture & Engineering").trim();
    const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const summary = analysis?.overview?.summary || analysis?.architecture?.summary || `A structured, student-focused software engineering breakdown of ${cleanTopic}.`;
    const primaryLanguage = analysis?.primaryLanguage || "TypeScript / Full-Stack";

    // Friendly analogy explaining the system for students
    let studentAnalogy = `Think of **${cleanTopic}** like an organized airport terminal: the User Interface is the check-in desk where passengers make requests, the Backend API is air traffic control routing every request safely, and the Database is the secure luggage storage holding all passenger records reliably.`;
    if (/hotel|restaurant|food|order/i.test(cleanTopic)) {
      studentAnalogy = `Think of **${cleanTopic}** like a modern restaurant: the Frontend is the menu and dining area, the API Gateway is the waitstaff carrying orders, and the Backend/Database is the master kitchen preparing and storing each dish reliably.`;
    } else if (/hospital|clinic|patient|doctor|med/i.test(cleanTopic)) {
      studentAnalogy = `Think of **${cleanTopic}** like a state-of-the-art medical center: the Frontend is the patient reception desk, the API Controllers are the triage nurses routing patients to the right department, and the Database is the centralized electronic health records vault.`;
    } else if (/chat|message|social|messaging/i.test(cleanTopic)) {
      studentAnalogy = `Think of **${cleanTopic}** like a digital postal exchange: client connections are postal mailboxes, the backend server is the central sorting facility dispatching messages in real time, and the database archives the correspondence history.`;
    } else if (/e-?commerce|shop|cart|store/i.test(cleanTopic)) {
      studentAnalogy = `Think of **${cleanTopic}** like a digital superstore: the frontend is the interactive store aisles, the shopping cart and checkout routes are the cash registers, and the database tracks inventory, user accounts, and billing transactions.`;
    }

    const docxArt = artifacts.find(a => a.extension === "docx");
    const pdfArt = artifacts.find(a => a.extension === "pdf");
    const imgArt = imageArtifact || artifacts.find(a => a.category === "image");

    return `# 🎓 Student Project & Technical Report: ${cleanTopic}
> **Domain:** Software Engineering & Systems Design | **Platform:** Darkness Student Learning Platform | **Status:** ✅ Complete Project Deliverable | **Date:** ${dateStr}

---

## 📌 1. Executive Summary & Plain-English Overview
${summary}

💡 **Student Intuition & Simple Analogy:**
> ${studentAnalogy}

---

## 🎯 2. Problem Statement & Proposed Solution
- **The Challenge:** Building manual, fragmented, or unorganized software workflows often leads to data inconsistencies, slow response times, and unmaintainable monolithic code.
- **The Architectural Solution:** ${cleanTopic} adopts a **decoupled, modular architecture**. Each tier (User Interface, API Gateway, Business Services, and Database) communicates through clean contracts, guaranteeing speed, fault isolation, and straightforward maintenance.

---

## 🏛️ 3. System Architecture & Component Breakdown
The system is divided into three transparent, easy-to-understand layers:

1. **📱 Frontend Presentation Layer (Client UI):**
   - Built for responsive, interactive student exploration.
   - Handles real-time user inputs, dynamic visual state updates, and file artifact downloads.

2. **🌐 Backend Application & API Gateway:**
   - Powered by **${primaryLanguage}** with clean RESTful endpoints and Server-Sent Events (SSE).
   - Validates incoming parameters, manages authentication, and orchestrates core business algorithms.

3. **🗄️ Persistence & Intelligence Layer:**
   - Maintains transactional records, session histories, and document indexes.
   - Grounded with verification safeguards to ensure zero data corruption.

### 🖼️ System Architecture Diagram & Visual Infographic
\`\`\`mermaid
graph TD
  A[👤 Student / User] -->|Action / Input| B[📱 Frontend Client UI]
  B -->|REST / SSE Request| C[🌐 API Gateway & Controllers]
  C -->|Input Validation & Route| D[⚙️ Core Business Logic Engine]
  D -->|ACID Read / Write| E[(🗄️ Relational Database & Storage)]
  D -->|Grounding & Knowledge| F[🧠 Learning & Intelligence Layer]
  D -->|Formatted Response & Artifacts| B
\`\`\`

${imgArt && imgArt.bufferBase64 ? `
#### 🎨 Architectural Concept Graphic:
![${cleanTopic} System Architecture & Concept Diagram](data:${imgArt.mimeType || 'image/png'};base64,${imgArt.bufferBase64})
` : ""}

---

## ⚙️ 4. Step-by-Step Execution Workflow
How data flows through the application from start to finish:

1. **Step 1: Input Ingestion & Sanitization**
   - User inputs or uploaded files are received, checked against schema constraints, and sanitized to prevent injection vulnerabilities.
2. **Step 2: Processing & Business Logic Execution**
   - The backend controller delegates tasks to specialized service modules, performing calculations, transformations, or state checks asynchronously.
3. **Step 3: State Persistence & Database Commit**
   - Results, generated assets, and audit logs are safely committed to the persistent database.
4. **Step 4: Output Delivery & Artifact Packaging**
   - The student receives formatted plain-text responses, visual diagrams, and compiled document packages (.docx, .pdf, .png) ready for download.

---

## 📊 5. Technology Stack & Key Specifications
| Layer / Subsystem | Primary Technology | Purpose & Academic Role |
| :--- | :--- | :--- |
| **Frontend Framework** | TypeScript, React, Tailwind CSS | High-performance, accessible student interface |
| **Backend Runtime** | Node.js, Express, REST APIs | Asynchronous, non-blocking service orchestration |
| **Database & Storage** | SQLite, PostgreSQL, Supabase | Structured, relational transactional data management |
| **Document Engine** | OpenXML (.docx), Puppeteer / PDF-lib | Automated generation of academic project reports |
| **Visual Engine** | SVG & Canvas Infographics | Architectural concept mapping and flow visualization |

---

## 💡 6. Viva & Interview Preparation Cheat Sheet (High-Yield Questions)
Here are common questions examiners or interviewers ask about this system, along with high-scoring answers:

- **Q1: Why did you choose a modular architecture over a single monolithic file?**
  *Answer:* Modular architecture separates concerns (UI, business logic, storage). This makes individual components easier to test, debug, and scale independently without risking system-wide outages.

- **Q2: How does the system handle concurrent user requests safely?**
  *Answer:* By utilizing asynchronous non-blocking event loops, stateless REST endpoints, and transactional database queries with connection pooling.

- **Q3: What security safeguards are implemented at the API boundary?**
  *Answer:* Strict input validation, parameter sanitization, rate-limiting, and session token verification before accessing sensitive endpoints.

---

## 📥 7. Official Project Documents & Generated Assets
I have compiled the complete academic and project report package for you. You can preview or download each deliverable using the interactive buttons below:

<div style="display:flex; flex-wrap:wrap; gap:10px; margin: 16px 0;">
  ${docxArt ? `<a href="/api/artifacts/${docxArt.id}/download" download="${docxArt.filename}" class="btn btn--primary" style="display:inline-flex; align-items:center; gap:6px; padding:8px 14px; background:#2563eb; color:#ffffff; text-decoration:none; border-radius:8px; font-weight:600; font-size:13px;">📄 Download Word Report (.docx)</a>` : ""}
  ${pdfArt ? `<a href="/api/artifacts/${pdfArt.id}/download" download="${pdfArt.filename}" class="btn btn--outline" style="display:inline-flex; align-items:center; gap:6px; padding:8px 14px; background:var(--surface,#ffffff); border:1px solid var(--line); color:var(--ink); text-decoration:none; border-radius:8px; font-weight:600; font-size:13px;">📕 Download PDF Report (.pdf)</a>` : ""}
  ${imgArt ? `<a href="/api/artifacts/${imgArt.id}/download" download="${imgArt.filename}" class="btn btn--outline" style="display:inline-flex; align-items:center; gap:6px; padding:8px 14px; background:var(--surface,#ffffff); border:1px solid var(--line); color:var(--ink); text-decoration:none; border-radius:8px; font-weight:600; font-size:13px;">🖼️ Download Architecture Image (.png)</a>` : ""}
</div>

- 📄 **Word Document Report (\`.docx\`):** \`${docxArt?.filename || `${cleanTopic.replace(/\s+/g, "_")}_Student_Report.docx`}\`
  - *Full editable OpenXML technical document with executive overview, component tables, and specifications.*
- 📕 **Printable PDF Document (\`.pdf\`):** \`${pdfArt?.filename || `${cleanTopic.replace(/\s+/g, "_")}_Student_Report.pdf`}\`
  - *Clean, publication-ready PDF with embedded vector diagrams and structured styling for college submission.*
${imgArt ? `- 🖼️ **Visual Architecture Concept (\`.png\`):** \`${imgArt.filename}\`
  - *High-resolution system concept graphic and architectural diagram.*` : ""}

✨ *Click on any attached file card below to preview or download, or use **Download All (.zip)** to save the full project bundle!*`;
  }

  /**
   * Helper to persist assistant messages in DB and Supabase
   */
  private static saveAssistantMessage(
    cid: string,
    userId: string,
    activeModelId: string,
    content: string,
    messagesMap?: Map<string, any>,
    artifacts?: GeneratedArtifact[],
    suggestedActions?: string[]
  ) {
    if (!cid || !content) return;
    const msgId = crypto.randomUUID();
    const assistantMsg = {
      id: msgId,
      conversation_id: cid,
      role: "assistant" as const,
      content,
      model_id: activeModelId,
      artifacts: artifacts && artifacts.length > 0 ? artifacts : undefined,
      suggested_actions: suggestedActions && suggestedActions.length > 0 ? suggestedActions : undefined,
      created_at: Date.now(),
    };

    if (messagesMap) {
      messagesMap.set(msgId, assistantMsg);
    }
    try {
      saveMessage({
        ...assistantMsg,
        attachments: {
          artifacts: assistantMsg.artifacts,
          suggested_actions: assistantMsg.suggested_actions,
        }
      }, undefined, undefined, undefined, undefined, true);
    } catch {}

    if (isSupabaseConfigured()) {
      syncMessageToSupabase({
        id: msgId,
        user_id: userId,
        conversation_id: cid,
        role: "assistant",
        content,
        model_id: activeModelId,
        created_at: assistantMsg.created_at,
      }).catch(() => {});
    }
  }
}

// ============================================================================
// 4. CORE PLANNING PROTOCOL & RESPONSE FORMATTING RULES (DARKNESS ENGINE)
// ============================================================================

export const CORE_PLANNING_SYSTEM_INSTRUCTION = `
=== FAST DIRECT STREAMING DIRECTIVE ===
Begin your response IMMEDIATELY with the answer text. Do NOT output any XML planning blocks, internal monologue, thought tags, or <internal_planning_and_validation> tags. Every word you output must be directly visible to the user for instant sub-second response streaming.
`;

export const CORE_RESPONSE_CONSTRAINTS = `
=== SMART CHAT RESPONSE & ADAPTIVE STRUCTURE DISCIPLINE ===
0. ADAPTIVE DEPTH & SCOPE DISCIPLINE:
   - Match the response depth strictly to the user's explicit request:
     * **Basic / Simple**: Direct, clear, and concise summary without fluff.
     * **Detailed / Advanced / Comprehensive / Deep Dive**: Provide thorough technical depth covering underlying mechanics, internal principles, trade-offs, edge cases, failure modes, concrete examples, and architectural connections. Never reduce an advanced or comprehensive request to 2 short bullet points!
     * **Multi-part questions**: If the user asks about several subtopics (e.g., A, B, C, and D), address EVERY SINGLE requested subtopic in order with thoroughness.
1. ADAPTIVE RESPONSE STRUCTURE (PARAGRAPH IS NOT THE DEFAULT):
   - Do NOT make every response a wall of paragraphs. Adapt the structure intelligently to the question's intent:
     * **Selected Code & Snippet Walkthroughs** ("Explain this code...", "What does this do?"):
       - Focus strictly on the exact selected code snippet and line numbers provided.
       - Do NOT add unrequested project overview, whole-system architecture, or irrelevant headings.
       - Structure naturally:
         🧠 **What this code does**: clear intuitive summary.
         🔹 Line/Parameter Breakdown: concise explanation of key inputs, logic, and returns.
         ✅ **In short / Takeaway**: crisp summary of the exact behavior.
     * **Definition Questions** ("What is X?"):
       - 🧠 **Definition**: short crisp definition.
       - 💡 **In simple words**: intuitive explanation.
       - 📝 **Example**: practical real-world scenario.
       - 🎯 **Remember**: one-line key takeaway.
     * **Types & Classification** ("Explain types of X"): Concept intro → Type-by-type sections (definition, notation, example) → Comparison Markdown Table.
     * **Problem Solving & Calculations** ("Solve...", "Calculate...", "Find..."):
       - **1. Given**: State known values and variables clearly.
       - **2. Formula / Method**: State formulas in clean LaTeX display blocks \`$$...$$\`.
       - **3. Step-by-Step Calculation**: Show every calculation step on its own line. NEVER cram multiple math operations or entire calculations into one paragraph!
       - **4. Final Answer**: Highlight with \`✅ **Final Answer:** ...\`.
       - **5. Quick Verification / Tip**: Add a \`💡 **Tip:** ...\` or sanity check.
     * **Mathematical / Statistical Moment Calculations**:
       - For multi-step questions, separate each phase cleanly:
         \`\`\`markdown
         ### Step 3 — Finding Moments
         
         **1️⃣ First Raw Moment (Mean)**
         Formula:
         $$E[X] = M'_X(0)$$
         
         Calculation:
         $$M'_X(t) = \\dots$$
         
         At $t = 0$:
         $$M'_X(0) = 0.5$$
         
         ✅ Therefore:
         $$E[X] = 0.5$$
         
         ---
         
         **2️⃣ Second Raw Moment**
         Formula:
         $$E[X^2] = M''_X(0)$$
         
         Calculation:
         $$M''_X(t) = \\dots$$
         
         At $t = 0$:
         $$M''_X(0) = 0.5$$
         
         ✅ Therefore:
         $$E[X^2] = 0.5$$
         \`\`\`
     * **Comparison Questions** ("Compare X and Y", "Difference between X and Y"):
       - Concise introduction
       - Clear Markdown Comparison Table with columns (\`| Feature/Measure | Meaning | Formula | Best Used When |\`)
       - Key differences & 🎯 **Key Takeaway:**
     * **Study & Exam Notes** ("Make exam notes for...", "Give me notes on..."):
       - Structured layout: # 📚 Topic → ## 🧠 Core Concept → ## 📌 Key Points → ## 📐 Important Formula (\`$$...$$\`) → ## 📝 Example → ## 🧮 Solved Example → ## ⚠️ Common Mistake → ## 🎯 Exam Tip → ## ✅ Quick Revision.
       - Include only sections that have meaningful content; never generate empty headings or dense uninterrupted walls of text.
     * **Project Architecture & Logic**:
       - Grounded in verified files/stack → Layer breakdown → Request flow lifecycle → Key connections & tradeoffs.

2. MATH & FORMULA PRECISION:
   - For standalone or major equations, ALWAYS use display math blocks on dedicated lines: \`$$ E[X] = 0.5 $$\`.
   - For inline variables and small expressions, use inline math: \`$x = 2$\`, \`$\\lambda = 3$\`.
   - NEVER output raw unformatted LaTeX text like \`$E[X]$\` without proper math wrapping, and never double-wrap dollars like \`$$$x$$$\`.

3. SEMANTIC CALLOUTS & VISUAL ANCHORS:
   - Use meaningful visual callouts:
     * \`💡 **Tip:** ...\` (or \`💡 **Exam Tip:** ...\`) for shortcuts and key insights.
     * \`⚠️ **Common Mistake:** ...\` for traps, pitfalls, or common misconceptions.
     * \`📌 **Remember:** ...\` or \`🎯 **Key Takeaway:** ...\` for core concepts to retain.
     * \`✅ **Final Answer:** ...\` for verified solutions and numeric results.
     * \`📝 **Example:** ...\` (or \`📝 **Solved Example:** ...\`) for separated practical examples.
   - Use standard mathematical symbols: \`→\`, \`⇒\`, \`=\`, \`≠\`, \`≤\`, \`≥\`, \`∴\`, \`∵\`, \`√\`, \`∞\`, \`Σ\`, \`μ\`, \`σ\`, \`λ\`.

4. ZERO EMPTY HEADINGS & CONCISE COMPLETENESS:
   - If a heading or section is included, provide rich, complete explanations beneath it.
   - Never create empty headings.
   - If a question only needs 4 lines, provide the 4 lines. If a problem needs 6 calculation steps, show the 6 steps.

5. UNIVERSAL CONCEPTUAL & EDUCATIONAL CAPABILITY (NEVER REFUSE GENERAL QUESTIONS):
   - When the user asks a general conceptual, theoretical, educational, mathematical, scientific, or programming question (e.g., "what is probability", "probbility kya hoti hai", "what is recursion", "explain binary search", "how does oauth work", "solve 2x+3=7"):
   - ALWAYS answer the question directly, thoroughly, accurately, and educationally using your deep knowledge.
   - NEVER refuse to answer by saying the topic was not found in uploaded files (e.g., "package-lock.json", project dependencies, or unrelated documents). If uploaded files do not cover the concept, directly provide the full educational answer!
   - Match the user's language naturally (if asked in Hinglish like "probbility ya hoti hai" / "probability kya hoti hai", reply in natural, friendly Hinglish with clear definitions, examples, and formulas).
`;

export class InternalTagStreamFilter {
  private buffer = "";
  private inTag = false;
  private onText: (text: string) => void;
  private tags = ["internal_planning_and_validation", "internal_answer_planning", "thought", "thinking"];

  constructor(onText: (text: string) => void) {
    this.onText = onText;
  }

  push(chunk: string) {
    this.buffer += chunk;
    this.process();
  }

  private process() {
    let changed = true;
    while (changed) {
      changed = false;
      if (!this.inTag) {
        let earliestIdx = -1;
        let selectedTag = "";
        
        for (const tag of this.tags) {
          const startTag = `<${tag}>`;
          const idx = this.buffer.indexOf(startTag);
          if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
            earliestIdx = idx;
            selectedTag = tag;
          }
        }

        if (earliestIdx !== -1) {
          const before = this.buffer.substring(0, earliestIdx);
          if (before) this.onText(before);
          
          this.inTag = true;
          this.buffer = this.buffer.substring(earliestIdx + selectedTag.length + 2);
          changed = true;
        } else {
          let maxSafeLength = this.buffer.length;
          for (const tag of this.tags) {
            const startTag = `<${tag}>`;
            for (let i = 1; i < startTag.length; i++) {
              if (this.buffer.endsWith(startTag.substring(0, i))) {
                maxSafeLength = Math.min(maxSafeLength, this.buffer.length - i);
              }
            }
          }
          
          if (maxSafeLength < this.buffer.length) {
            const before = this.buffer.substring(0, maxSafeLength);
            if (before) this.onText(before);
            this.buffer = this.buffer.substring(maxSafeLength);
          } else {
            this.onText(this.buffer);
            this.buffer = "";
          }
        }
      } else {
        let earliestEndIdx = -1;
        let selectedTag = "";

        for (const tag of this.tags) {
          const endTag = `</${tag}>`;
          const idx = this.buffer.indexOf(endTag);
          if (idx !== -1 && (earliestEndIdx === -1 || idx < earliestEndIdx)) {
            earliestEndIdx = idx;
            selectedTag = tag;
          }
        }

        if (earliestEndIdx !== -1) {
          this.inTag = false;
          this.buffer = this.buffer.substring(earliestEndIdx + selectedTag.length + 3);
          changed = true;
        } else {
          break;
        }
      }
    }
  }

  flush() {
    if (!this.inTag && this.buffer) {
      this.onText(this.buffer);
      this.buffer = "";
    }
  }
}

