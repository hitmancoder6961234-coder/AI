/**
 * DARKNESS AI — Backend API Server
 *
 * Proxies chat requests from the static frontend to the z-ai-web-dev-sdk.
 * The SDK must run server-side (never in the browser).
 *
 * Run locally:  node server.js
 * Deploy to:    Render, Railway, Vercel (serverless), or any Node host
 *
 * Then in DARKNESS Settings → General → API URL, enter:
 *   http://localhost:3000  (local)
 *   https://your-deployed-backend.com  (production)
 */

import express from 'express';
import cors from 'cors';
import ZAI from 'z-ai-web-dev-sdk';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: true })); // Allow GitHub Pages origin
app.use(express.json({ limit: '10mb' }));

// Initialize ZAI SDK once
let zaiInstance = null;
async function initZAI() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
    console.log('✓ ZAI SDK initialized');
  }
  return zaiInstance;
}

// ──────────────────────────────────────────────
// POST /api/chat — non-streaming chat completion
// ──────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const zai = await initZAI();

    const { messages = [], mode = 'auto', systemPrompt } = req.body;

    if (!messages.length) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Build system prompt based on mode
    const defaultSystem = 'You are DARKNESS, a premium AI assistant that helps users build projects, write code, research topics, and create presentations. Respond in clear, well-structured Markdown. Use code blocks with language labels for code. Be concise but thorough.';

    const modePrompts = {
      fast: 'Respond quickly and concisely. Direct answers, minimal preamble.',
      think: 'Think through the problem step by step. Analyze, plan, then answer with code examples where helpful.',
      deep: 'Use deep reasoning: understand the problem, decompose it, plan a solution, consider alternatives, verify your conclusions, then give a comprehensive answer. Show your high-level reasoning steps.',
      coding: 'You are an expert software engineer. Generate clean, production-ready code with proper error handling. Explain key decisions briefly.',
      ppt: 'You are a presentation designer. Create concise slide content with short bullet points, key statements, and clear structure.',
      auto: defaultSystem,
    };

    const system = systemPrompt || modePrompts[mode] || defaultSystem;

    // Build messages array (SDK uses 'assistant' role for system prompt)
    const fullMessages = [
      { role: 'assistant', content: system },
      ...messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }))
    ];

    const completion = await zai.chat.completions.create({
      messages: fullMessages,
      thinking: { type: mode === 'deep' ? 'enabled' : 'disabled' }
    });

    const response = completion.choices[0]?.message?.content;

    if (!response) {
      throw new Error('Empty response from AI');
    }

    res.json({
      success: true,
      response,
      mode,
      usage: completion.usage || null
    });
  } catch (error) {
    console.error('Chat error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'AI request failed'
    });
  }
});

// ──────────────────────────────────────────────
// GET /api/health — health check
// ──────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', sdk: zaiInstance ? 'ready' : 'initializing' });
});

// Start server
initZAI().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🌑 DARKNESS AI Backend running on http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health`);
    console.log(`   Chat endpoint: POST http://localhost:${PORT}/api/chat\n`);
    console.log(`   To connect the frontend:`);
    console.log(`   Settings → General → API URL → http://localhost:${PORT}\n`);
  });
});
