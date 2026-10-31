// model-registry-engine.ts
// Dynamic Provider Context Window, Model Registry Spec Catalog, and Token Budget Engine for Darkness AI

export interface ModelSpecs {
  contextWindow: number;
  maxOutputTokens: number;
  defaultTemperature: number;
  defaultTopP: number;
  capabilities: {
    text: boolean;
    vision: boolean;
    codeGeneration: boolean;
    imageGeneration: boolean;
    fileAnalysis: boolean;
    streaming: boolean;
  };
  isDetected: boolean;
  notes?: string;
}

/**
 * Curated, provider-verified context window and spec catalog.
 * Covers Gemini, OpenAI, Anthropic, OpenRouter, Groq, Mistral, Together, DeepSeek, Qwen, Z.ai/GLM, etc.
 */
const KNOWN_MODEL_SPECS: Array<{
  pattern: RegExp;
  providerMatch?: string;
  specs: Partial<ModelSpecs>;
}> = [
  // 1. Google Gemini Models
  {
    pattern: /gemini-2\.5-pro/i,
    providerMatch: "gemini",
    specs: {
      contextWindow: 2097152, // 2M tokens
      maxOutputTokens: 8192,
      capabilities: { text: true, vision: true, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },
  {
    pattern: /gemini-1\.5-pro/i,
    providerMatch: "gemini",
    specs: {
      contextWindow: 2097152, // 2M tokens
      maxOutputTokens: 8192,
      capabilities: { text: true, vision: true, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },
  {
    pattern: /gemini-2\.[05]-flash/i,
    providerMatch: "gemini",
    specs: {
      contextWindow: 1048576, // 1M tokens
      maxOutputTokens: 8192,
      capabilities: { text: true, vision: true, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },
  {
    pattern: /gemini-1\.5-flash/i,
    providerMatch: "gemini",
    specs: {
      contextWindow: 1048576, // 1M tokens
      maxOutputTokens: 8192,
      capabilities: { text: true, vision: true, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },
  {
    pattern: /gemini/i,
    providerMatch: "gemini",
    specs: {
      contextWindow: 1048576, // 1M tokens default for modern Gemini models
      maxOutputTokens: 8192,
      capabilities: { text: true, vision: true, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },

  // 2. OpenAI Models
  {
    pattern: /o1|o3-mini|o3/i,
    specs: {
      contextWindow: 200000,
      maxOutputTokens: 100000,
      capabilities: { text: true, vision: true, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },
  {
    pattern: /gpt-4o-mini/i,
    specs: {
      contextWindow: 128000,
      maxOutputTokens: 16384,
      capabilities: { text: true, vision: true, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },
  {
    pattern: /gpt-4o|chatgpt-4o-latest/i,
    specs: {
      contextWindow: 128000,
      maxOutputTokens: 16384,
      capabilities: { text: true, vision: true, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },
  {
    pattern: /gpt-4-turbo|gpt-4-0125|gpt-4-1106/i,
    specs: {
      contextWindow: 128000,
      maxOutputTokens: 4096,
      capabilities: { text: true, vision: true, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },
  {
    pattern: /gpt-4-32k/i,
    specs: {
      contextWindow: 32768,
      maxOutputTokens: 4096,
      capabilities: { text: true, vision: false, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },
  {
    pattern: /gpt-4/i,
    specs: {
      contextWindow: 8192,
      maxOutputTokens: 4096,
      capabilities: { text: true, vision: false, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },
  {
    pattern: /gpt-3\.5-turbo-16k/i,
    specs: {
      contextWindow: 16385,
      maxOutputTokens: 4096,
      capabilities: { text: true, vision: false, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },
  {
    pattern: /gpt-3\.5-turbo/i,
    specs: {
      contextWindow: 16385,
      maxOutputTokens: 4096,
      capabilities: { text: true, vision: false, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },

  // 3. Anthropic Claude Models
  {
    pattern: /claude-3-7-sonnet|claude-3-5-sonnet/i,
    specs: {
      contextWindow: 200000,
      maxOutputTokens: 8192,
      capabilities: { text: true, vision: true, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },
  {
    pattern: /claude-3-5-haiku/i,
    specs: {
      contextWindow: 200000,
      maxOutputTokens: 8192,
      capabilities: { text: true, vision: true, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },
  {
    pattern: /claude-3-opus|claude-3-sonnet|claude-3-haiku/i,
    specs: {
      contextWindow: 200000,
      maxOutputTokens: 4096,
      capabilities: { text: true, vision: true, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },

  // 4. DeepSeek Models
  {
    pattern: /deepseek-(?:chat|reasoner|v3|r1)/i,
    specs: {
      contextWindow: 64000,
      maxOutputTokens: 8192,
      capabilities: { text: true, vision: false, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },

  // 5. Qwen Models
  {
    pattern: /qwen-2\.5-coder|qwen-2\.5|qwen2\.5/i,
    specs: {
      contextWindow: 131072,
      maxOutputTokens: 8192,
      capabilities: { text: true, vision: false, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },
  {
    pattern: /qwq-32b/i,
    specs: {
      contextWindow: 32768,
      maxOutputTokens: 8192,
      capabilities: { text: true, vision: false, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },

  // 6. Meta Llama 3.3 / 3.2 / 3.1
  {
    pattern: /llama-3\.3|llama-3\.2|llama-3\.1|llama3\.3|llama3\.2|llama3\.1/i,
    specs: {
      contextWindow: 128000,
      maxOutputTokens: 8192,
      capabilities: { text: true, vision: false, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },
  {
    pattern: /llama-3-70b|llama-3-8b|llama3-70b|llama3-8b/i,
    specs: {
      contextWindow: 8192,
      maxOutputTokens: 8192,
      capabilities: { text: true, vision: false, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },

  // 7. Mistral & Mixtral
  {
    pattern: /codestral/i,
    specs: {
      contextWindow: 256000,
      maxOutputTokens: 8192,
      capabilities: { text: true, vision: false, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },
  {
    pattern: /mistral-large|mistral-small|mistral-nemo/i,
    specs: {
      contextWindow: 128000,
      maxOutputTokens: 8192,
      capabilities: { text: true, vision: false, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },
  {
    pattern: /mixtral-8x22b/i,
    specs: {
      contextWindow: 65536,
      maxOutputTokens: 4096,
      capabilities: { text: true, vision: false, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },
  {
    pattern: /mixtral-8x7b/i,
    specs: {
      contextWindow: 32768,
      maxOutputTokens: 4096,
      capabilities: { text: true, vision: false, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },

  // 8. Z.ai GLM Models
  {
    pattern: /glm-4|glm-5/i,
    specs: {
      contextWindow: 128000,
      maxOutputTokens: 4096,
      capabilities: { text: true, vision: true, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },

  // 9. Groq Hosted Models
  {
    pattern: /gemma-2-27b|gemma-2-9b/i,
    specs: {
      contextWindow: 8192,
      maxOutputTokens: 8192,
      capabilities: { text: true, vision: false, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    },
  },
];

/**
 * Detects specifications for a given provider and model name.
 */
export function detectModelSpecs(provider?: string, modelName?: string): ModelSpecs {
  const prov = String(provider || "").toLowerCase().trim();
  const name = String(modelName || "").toLowerCase().trim();

  // Find matching entry in catalog
  for (const entry of KNOWN_MODEL_SPECS) {
    if (entry.providerMatch && entry.providerMatch !== prov) {
      continue;
    }
    if (entry.pattern.test(name)) {
      return {
        contextWindow: entry.specs.contextWindow || 32768,
        maxOutputTokens: entry.specs.maxOutputTokens || 4096,
        defaultTemperature: entry.specs.defaultTemperature ?? 0.7,
        defaultTopP: entry.specs.defaultTopP ?? 1.0,
        capabilities: {
          text: true,
          vision: false,
          codeGeneration: true,
          imageGeneration: false,
          fileAnalysis: true,
          streaming: true,
          ...(entry.specs.capabilities || {}),
        },
        isDetected: true,
      };
    }
  }

  // Provider-level defaults when model is unknown
  if (prov === "gemini") {
    return {
      contextWindow: 1048576,
      maxOutputTokens: 8192,
      defaultTemperature: 0.7,
      defaultTopP: 1.0,
      capabilities: { text: true, vision: true, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
      isDetected: true,
    };
  }
  if (prov === "anthropic") {
    return {
      contextWindow: 200000,
      maxOutputTokens: 4096,
      defaultTemperature: 0.7,
      defaultTopP: 1.0,
      capabilities: { text: true, vision: true, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
      isDetected: true,
    };
  }
  if (prov === "openai") {
    return {
      contextWindow: 128000,
      maxOutputTokens: 4096,
      defaultTemperature: 0.7,
      defaultTopP: 1.0,
      capabilities: { text: true, vision: true, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
      isDetected: true,
    };
  }
  if (prov === "groq" || prov === "mistral" || prov === "together" || prov === "openrouter") {
    return {
      contextWindow: 128000,
      maxOutputTokens: 4096,
      defaultTemperature: 0.7,
      defaultTopP: 1.0,
      capabilities: { text: true, vision: false, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
      isDetected: false,
      notes: "Default 128k context assumed for modern hosted provider endpoint.",
    };
  }

  // Conservative safe fallback for unverified custom endpoints
  return {
    contextWindow: 32768,
    maxOutputTokens: 4096,
    defaultTemperature: 0.7,
    defaultTopP: 1.0,
    capabilities: { text: true, vision: false, codeGeneration: true, imageGeneration: false, fileAnalysis: true, streaming: true },
    isDetected: false,
    notes: "Default 32k context for custom OpenAI-compatible endpoint.",
  };
}

/**
 * Robust token estimation method.
 * Handles English, code, punctuation, and multilingual / Indic (Devanagari/Hinglish) characters.
 */
export function estimateTokens(input: any): number {
  if (input === null || input === undefined) return 0;

  if (typeof input === "string") {
    if (input.length === 0) return 0;
    // Count non-ASCII characters (multilingual / Indic / emoji take ~2-3x more tokens)
    let nonAsciiCount = 0;
    for (let i = 0; i < input.length; i++) {
      if (input.charCodeAt(i) > 127) nonAsciiCount++;
    }
    const asciiCount = input.length - nonAsciiCount;
    // Standard estimation: ~3.8 chars per token for ASCII, ~1.6 chars per token for non-ASCII
    const asciiTokens = Math.ceil(asciiCount / 3.8);
    const nonAsciiTokens = Math.ceil(nonAsciiCount / 1.6);
    return Math.max(1, asciiTokens + nonAsciiTokens);
  }

  if (Array.isArray(input)) {
    let total = 0;
    for (const item of input) {
      total += estimateTokens(item) + 4; // Envelope overhead per message/array item
    }
    return total;
  }

  if (typeof input === "object") {
    let total = 2; // Object envelope
    if (input.text) total += estimateTokens(input.text);
    if (input.content) total += estimateTokens(input.content);
    if (input.role) total += estimateTokens(input.role) + 1;
    if (input.parts && Array.isArray(input.parts)) {
      total += estimateTokens(input.parts);
    }
    if (total <= 2) {
      try {
        total = estimateTokens(JSON.stringify(input));
      } catch {
        total = 10;
      }
    }
    return total;
  }

  return estimateTokens(String(input));
}

export interface DynamicContextBudget {
  totalContextLimit: number;
  reservedOutputTokens: number;
  systemTokens: number;
  safetyMarginTokens: number;
  availableInputTokens: number;
  ragBudgetTokens: number;
  historyBudgetTokens: number;
  userPromptTokens: number;
}

/**
 * Calculates a strict dynamic token budget for a request.
 * Formula:
 * availableInput = modelContextLimit - reservedOutput - systemInstructionTokens - safetyMargin - userPromptTokens
 */
export function calculateDynamicContextBudget(params: {
  modelContextLimit: number;
  configuredMaxOutput?: number;
  systemInstruction: string;
  userPrompt: string;
}): DynamicContextBudget {
  const totalContextLimit = Math.max(4096, params.modelContextLimit || 32768);
  const sysTokens = estimateTokens(params.systemInstruction);
  const userPromptTokens = estimateTokens(params.userPrompt);

  // Dynamic output reservation:
  // Must ensure input_tokens + max_output_tokens <= modelContextLimit
  const configuredMax = Math.max(512, params.configuredMaxOutput || 4096);
  // Reserve at most 25% of the context window or configuredMax, but at least 512 tokens
  const maxSafeOutput = Math.min(configuredMax, Math.max(512, Math.floor(totalContextLimit * 0.25)));

  // 5% safety margin or 512 tokens for envelope/tokenizer variance
  const safetyMarginTokens = Math.max(512, Math.floor(totalContextLimit * 0.05));

  // Available space for RAG + attached documents + conversation history
  const overhead = sysTokens + userPromptTokens + maxSafeOutput + safetyMarginTokens;
  const availableInputTokens = Math.max(0, totalContextLimit - overhead);

  // Allocate 60% of available budget to RAG/knowledge evidence, 40% to chat history
  const ragBudgetTokens = Math.floor(availableInputTokens * 0.60);
  const historyBudgetTokens = Math.floor(availableInputTokens * 0.40);

  return {
    totalContextLimit,
    reservedOutputTokens: maxSafeOutput,
    systemTokens: sysTokens,
    safetyMarginTokens,
    availableInputTokens,
    ragBudgetTokens,
    historyBudgetTokens,
    userPromptTokens,
  };
}

/**
 * Prioritizes and packs RAG chunks within the token budget.
 * - Sorts by score (descending)
 * - Ensures source diversity
 * - Halts before exceeding token budget
 */
export function packRagChunksIntoBudget<T extends { content: string; score?: number; file?: string; filename?: string }>(
  candidateChunks: T[],
  maxTokens: number
): {
  packedChunks: T[];
  packedText: string;
  tokensUsed: number;
  totalCandidates: number;
  includedCount: number;
} {
  if (!candidateChunks || candidateChunks.length === 0 || maxTokens <= 0) {
    return { packedChunks: [], packedText: "", tokensUsed: 0, totalCandidates: 0, includedCount: 0 };
  }

  // Sort descending by score
  const sorted = [...candidateChunks].sort((a, b) => (b.score || 0) - (a.score || 0));

  const packedChunks: T[] = [];
  let currentTokens = 0;
  const seenFiles = new Map<string, number>();

  for (const chunk of sorted) {
    const filePath = chunk.file || chunk.filename || "unknown";
    const countFromFile = seenFiles.get(filePath) || 0;

    // Favor diversity: cap maximum 4 chunks from the exact same file unless budget allows
    if (countFromFile >= 4 && sorted.length > 6) {
      continue;
    }

    const chunkTokens = estimateTokens(chunk.content) + 15; // chunk header metadata tokens
    if (currentTokens + chunkTokens > maxTokens) {
      // If we haven't included any chunks yet, include at least a truncated portion
      if (packedChunks.length === 0 && maxTokens > 100) {
        const allowedChars = Math.floor(maxTokens * 3.5);
        const truncatedContent = chunk.content.substring(0, allowedChars);
        const truncatedChunk = { ...chunk, content: truncatedContent + "\n... [truncated to fit context window]" };
        packedChunks.push(truncatedChunk);
        currentTokens += estimateTokens(truncatedChunk.content);
      }
      break;
    }

    packedChunks.push(chunk);
    currentTokens += chunkTokens;
    seenFiles.set(filePath, countFromFile + 1);
  }

  // Format packed text
  const packedText = packedChunks
    .map(
      (c) =>
        `[Source: ${c.filename || c.file || "Document"} | Score: ${((c.score || 0.8) * 100).toFixed(0)}%]\n${c.content}`
    )
    .join("\n\n---\n\n");

  return {
    packedChunks,
    packedText,
    tokensUsed: currentTokens,
    totalCandidates: candidateChunks.length,
    includedCount: packedChunks.length,
  };
}

/**
 * Truncates and packs chat history into available token budget.
 * - Preserves the most recent messages
 * - Discards or summarizes older messages when conversation approaches context limit
 */
export function packChatHistoryIntoBudget<T extends { role: string; content?: string; text?: string; parts?: any[] }>(
  messages: T[],
  maxTokens: number
): {
  packedHistory: T[];
  tokensUsed: number;
  droppedCount: number;
} {
  if (!messages || messages.length === 0 || maxTokens <= 0) {
    return { packedHistory: [], tokensUsed: 0, droppedCount: messages.length };
  }

  const packed: T[] = [];
  let currentTokens = 0;
  let droppedCount = 0;

  // Iterate backwards from the newest message to the oldest
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgContent = msg.content || msg.text || (msg.parts && msg.parts[0]?.text) || "";
    const msgTokens = estimateTokens(msgContent) + 6; // message envelope

    if (currentTokens + msgTokens > maxTokens) {
      droppedCount = i + 1;
      break;
    }

    packed.unshift(msg);
    currentTokens += msgTokens;
  }

  return {
    packedHistory: packed,
    tokensUsed: currentTokens,
    droppedCount,
  };
}

/**
 * Detects if an error from a provider indicates that the context length / token limit was exceeded.
 */
export function isContextLimitExceededError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || (typeof err === "string" ? err : JSON.stringify(err))).toLowerCase();
  const code = String(err.code || err.status || "").toLowerCase();

  return (
    msg.includes("context_length_exceeded") ||
    msg.includes("maximum context length") ||
    msg.includes("max_tokens_exceeded") ||
    msg.includes("token limit exceeded") ||
    msg.includes("too many tokens") ||
    msg.includes("exceeds the context window") ||
    msg.includes("input is too long") ||
    msg.includes("request is too large") ||
    msg.includes("prompt is too long") ||
    code === "context_length_exceeded" ||
    code === "string_too_long"
  );
}

/**
 * Formats conversation messages into a strict alternating Gemini history protocol (user -> model -> user -> model).
 * Automatically merges consecutive messages of the same role and filters out empty items without losing context.
 */
export function buildFormattedGeminiHistory<T extends { role: string; content?: string; text?: string; parts?: any[] }>(
  messages: T[]
): Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> {
  if (!messages || !Array.isArray(messages)) return [];

  const result: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

  for (const m of messages) {
    const rawRole = (m.role || "").toLowerCase();
    const role: "user" | "model" = (rawRole === "assistant" || rawRole === "model") ? "model" : "user";

    let text = "";
    if (typeof m.content === "string") {
      text = m.content;
    } else if (typeof m.text === "string") {
      text = m.text;
    } else if (Array.isArray(m.parts) && m.parts[0]?.text) {
      text = m.parts[0].text;
    }

    const cleanText = (text || "").trim();
    if (!cleanText) continue;

    if (result.length > 0 && result[result.length - 1].role === role) {
      result[result.length - 1].parts[0].text += "\n\n" + cleanText;
    } else {
      result.push({ role, parts: [{ text: cleanText }] });
    }
  }

  // Gemini protocol: history before new turn MUST start with 'user'
  while (result.length > 0 && result[0].role !== "user") {
    result.shift();
  }
  // Gemini history before new turn MUST end with 'model'
  while (result.length > 0 && result[result.length - 1].role !== "model") {
    result.pop();
  }

  return result;
}

/**
 * Formats conversation messages into OpenAI-compatible history array.
 * Merges consecutive messages of the same role and removes empty entries.
 */
export function buildFormattedOpenAiHistory<T extends { role: string; content?: string; text?: string }>(
  messages: T[]
): Array<{ role: "user" | "assistant"; content: string }> {
  if (!messages || !Array.isArray(messages)) return [];

  const result: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const m of messages) {
    const rawRole = (m.role || "").toLowerCase();
    const role: "user" | "assistant" = (rawRole === "assistant" || rawRole === "model") ? "assistant" : "user";
    const cleanText = (m.content || m.text || "").trim();

    if (!cleanText) continue;

    if (result.length > 0 && result[result.length - 1].role === role) {
      result[result.length - 1].content += "\n\n" + cleanText;
    } else {
      result.push({ role, content: cleanText });
    }
  }

  return result;
}

/**
 * Formats diagnostic context metrics for safe internal observability.
 * NEVER logs secrets, keys, or passwords.
 */
export function formatSafeDiagnostics(params: {
  model: { id: string; provider: string; modelName?: string; contextWindow?: number };
  budget: DynamicContextBudget;
  ragTokensUsed: number;
  historyTokensUsed: number;
  actualPromptTokens: number;
}): Record<string, any> {
  const totalInputTokens =
    params.budget.systemTokens +
    params.actualPromptTokens +
    params.ragTokensUsed +
    params.historyTokensUsed;

  const remainingTokens = Math.max(0, params.budget.totalContextLimit - totalInputTokens - params.budget.reservedOutputTokens);

  return {
    model: `${params.model.provider}:${params.model.modelName || params.model.id}`,
    contextLimit: params.budget.totalContextLimit,
    inputTokens: totalInputTokens,
    reservedOutputTokens: params.budget.reservedOutputTokens,
    ragTokens: params.ragTokensUsed,
    historyTokens: params.historyTokensUsed,
    availableTokens: remainingTokens,
  };
}
