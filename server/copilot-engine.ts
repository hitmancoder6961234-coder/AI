
import { GoogleGenAI } from "@google/genai";
import { ExtractedFile, ProjectAnalysis } from "./project-analyzer.js";
import { getRunStatus } from "./run-engine.js";
import { searchKnowledge, assembleContext, getProjectKnowledge } from "./knowledge-engine.js";
import { formatApiError, streamGeminiWithResilience } from "./gemini-resilience.js";

export interface CopilotRequest {
  prompt: string;
  projectId: string;
  userId: string;
  conversationId?: string;
  analysis: ProjectAnalysis;
  files: ExtractedFile[];
  geminiClient: GoogleGenAI | null;
  modelName?: string;
  onStreamContent?: (content: string) => void;
  onStreamEvent?: (event: any) => void;
}

export function retrieveRelevantFiles(prompt: string, files: ExtractedFile[], limit = 5): ExtractedFile[] {
  const q = prompt.toLowerCase();
  
  const scored = files.map(f => {
    let score = 0;
    const nameLower = f.name.toLowerCase();
    const pathLower = f.path.toLowerCase();
    const isBinary = f.isBinary;
    if (isBinary) return { file: f, score: -1 };

    if (nameLower.includes(q)) score += 100;
    if (pathLower.includes(q)) score += 50;
    
    const keywords = q.split(/[\s,.-_?]+/);
    for (const kw of keywords) {
      if (kw.length < 3) continue;
      if (nameLower.includes(kw)) score += 20;
      if (pathLower.includes(kw)) score += 10;
      if (f.content && f.content.toLowerCase().includes(kw)) score += 1;
    }
    
    return { file: f, score };
  });
  
  scored.sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score > 0).slice(0, limit).map(s => s.file);
}

export async function executeCopilotTurn(req: CopilotRequest): Promise<{ success: boolean; message?: string }> {
  const { prompt, analysis, files, geminiClient, onStreamContent, onStreamEvent } = req;
  
  if (!geminiClient) {
    if (onStreamContent) onStreamContent("AI provider is not configured. Please configure your API key.");
    return { success: false, message: "No AI provider" };
  }

  const qLower = prompt.toLowerCase();
  const relevantFiles = retrieveRelevantFiles(prompt, req.files, 5);
  
  // 1. Intelligent Retrieval

  const pk = getProjectKnowledge(req.projectId);
  const searchResults = searchKnowledge(req.projectId, prompt, 15);
  const searchContextStr = searchResults.length > 0 ? assembleContext(searchResults, analysis.architecture) : "No relevant code chunks found.";


  // Build context
  let projectGrounding = `=== PROJECT CONTEXT ===
Project Name: ${analysis?.projectName || "Project"}
Type: ${analysis?.projectType || "Software Application"}
Primary Language: ${analysis?.primaryLanguage || "TypeScript"}
Languages: ${(analysis?.languages || []).map(l => `${l.name} (${l.percentage}%)`).join(", ")}
Frameworks: ${(analysis?.frameworks || []).join(", ")}
Architecture: ${analysis?.architecture?.summary || "System architecture"}
API Endpoints: ${analysis?.apiIntelligence?.endpoints?.length || 0} endpoints detected.
Database: ${analysis?.databaseIntelligence?.description || "Database information"}
Security Findings: ${analysis?.securityAnalysis?.findings?.length || 0} findings.
`;

  if (analysis.projectIntelligence) {
    const pi = analysis.projectIntelligence;
    projectGrounding += `=== CANONICAL PROJECT INTELLIGENCE FACTS ===
Title: ${pi.projectIdentity.title}
Tagline: ${pi.projectIdentity.tagline}
Purpose: ${pi.purpose}
Problem Statement: ${pi.problemStatement}
Proposed Solution: ${pi.proposedSolution}
Target Users: ${pi.targetUsers.join(", ")}
Key Features: ${pi.keyFeatures.join("; ")}
Technology Stack: ${pi.technologyStack.primaryLanguage} (${pi.technologyStack.frameworks.join(", ")})
Innovation / USP: ${pi.innovation}
AI Integration: ${pi.aiComponents.present ? pi.aiComponents.description : "Not identified in the uploaded project."}
RAG Implementation: ${pi.ragComponents.present ? pi.ragComponents.description : "Not identified in the uploaded project."}
Real-World Use Cases: ${pi.useCases.join("; ")}
Impact: ${pi.impact}
Advantages: ${pi.advantages.join("; ")}
Limitations: ${pi.limitations.join("; ")}
Future Scope: ${pi.futureScope.join("; ")}
30-60s Hackathon Pitch: ${pi.hackathonPitch.duration30to60s}
Evidence Sources: ${pi.evidenceSources.join(", ")}

`;
  }

  const issuesList = analysis.architecture.advisor?.issues || [];
  if (issuesList.length > 0) {
    projectGrounding += `
Architecture Issues:
`;
    for (const issue of issuesList) {
       projectGrounding += `- [${(issue.severity || 'unknown').toUpperCase()}] ${issue.title} (Location: ${issue.sourceFile || issue.targetFile || 'Unknown'})
  Summary: ${issue.summary}
`;
    }
  }
  const brokenList = analysis.architecture.brokenReferences || [];
  if (brokenList.length > 0) {
    projectGrounding += `
Broken Import References:
`;
    for (const broken of brokenList) {
       projectGrounding += `- ${broken.fromFile}:${broken.line} tries to import '${broken.target}' which does not exist.
`;
    }
  }


  const runStatus = getRunStatus(req.projectId);
  if (runStatus && runStatus.status !== "idle") {
    projectGrounding += `
=== RECENT RUNTIME STATUS ===
State: ${runStatus.status}
Command: ${runStatus.command || "N/A"}
Runtime: ${runStatus.runtime || "N/A"}
Exit Code: ${runStatus.exitCode !== undefined ? runStatus.exitCode : "N/A"}
Error: ${runStatus.error || "None"}
Last 50 Log Lines:
${(runStatus.logs || []).slice(-50).join("")}
`;
  }

  if (relevantFiles.length > 0) {

    projectGrounding += `=== RELEVANT FILES RETRIEVED ===\n`;
    for (const rf of relevantFiles) {
      projectGrounding += `\n[File: ${rf.path}]\n\`\`\`${rf.extension}\n${rf.content?.substring(0, 5000) || ""}\n\`\`\`\n`;
    }
  }

  const systemInstruction = `You are Darkness AI Project Copilot, part of Darkness AI.

CANONICAL IDENTITY & ORIGIN:
- You are **Darkness**, an AI assistant designed to make students' projects easier to understand, explore, explain, and present.
- Created by **Kalam**, a **Computer Science / CS student**, as a student-focused AI project.
- Purpose: Help students understand codebases, architectures, files, workflows, and project knowledge using AI and RAG.
- STRICT CREATOR RULE:
  • Mention **Kalam** as your creator ONLY when the user explicitly asks about who created/made you (e.g. "Who made you?", "Who created you?", "Introduce yourself", "Who are you?").
  • For normal greetings (e.g., "hi", "hello", "hey", "kaise ho"), code questions, or general project conversations, DO NOT mention Kalam.
  • Never claim creation by OpenAI, Google, Anthropic, or any company.

STRICT BEHAVIOR RULES:
1. DEFAULT TO PROJECT-LEVEL UNDERSTANDING:
   - When a user asks general questions ("What is this project?", "What problem does it solve?", "Why was it built?", "How does it work?", "What are its main features?", "Give me a pitch"):
     ALWAYS answer with a high-level system overview using the CANONICAL PROJECT INTELLIGENCE facts.
   - Do NOT automatically switch project-level questions into individual file-by-file code explanations.
   - ONLY provide code-level line explanations when the user explicitly names a file or function (e.g. "Explain server.ts" or "Explain this Python function").

2. MULTI-LANGUAGE RESPONSE MATCHING (CRITICAL):
   - DETECT THE LANGUAGE OF THE USER'S PROMPT (English, Hindi, Hinglish, Marathi, Tamil, Telugu, Bengali, Spanish, French, German, etc.).
   - YOU MUST RESPOND IN THAT EXACT SAME LANGUAGE.
   - Preserve all grounded project facts accurately while expressing them naturally in the user's requested language.
   - Example: If the user asks in Hindi/Hinglish ("Ye project kis liye banaya gaya hai?"), answer in Hindi/Hinglish with the exact project facts!

3. NATURAL CHAT CONVERSATION:
   - Respond directly in clean conversational Markdown text.
   - Do NOT automatically generate downloadable artifacts, diagrams, reports, PPT decks, or code files UNLESS the user explicitly asks for them (e.g. "make a PPT", "create a report", "draw a flowchart").

4. GROUNDING & NO FABRICATION:
   - Base all answers on actual project evidence.
   - If something cannot be verified from the project context, explicitly state: "Not identified in the uploaded project."
   - Never invent fake features, technologies, AI capabilities, performance numbers, or claims.

5. CODE CITATION & MODIFICATION FORMAT:
   - If citing a file, use the format 📄 path/to/file.ext or 📄 path/to/file.ext:line_number.
   - If the user explicitly requests code modifications, produce a plan and output the proposed changes using this exact JSON format at the very end:
\`\`\`json
{
  "type": "code_change",
  "files": [
    { "path": "path/to/file.ext", "content": "NEW_FULL_CONTENT_HERE" }
  ]
}
\`\`\`
`;

  try {
    const targetModel = req.modelName || process.env.DEFAULT_GEMINI_MODEL || "gemini-3.1-flash-lite";
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    if (!apiKey) {
      throw new Error("Gemini API key is required for AI Copilot.");
    }

    await streamGeminiWithResilience({
      apiKey,
      modelName: targetModel,
      contents: [
        {
          role: "user",
          parts: [{ text: `${projectGrounding}\n\nUser Question: ${prompt}` }],
        },
      ],
      systemInstruction,
      onChunk: (chunkText) => {
        if (chunkText && onStreamContent) {
          onStreamContent(chunkText);
        }
      },
    });

    return { success: true };
  } catch (err: any) {
    console.error("Copilot AI error:", err);
    if (onStreamContent) onStreamContent(`\n\n[Copilot Error: ${formatApiError(err)}]`);
    return { success: false, message: formatApiError(err) };
  }
}
