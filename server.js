/**
 * DARKNESS AI — Backend API Server
 *
 * Proxies chat requests from the static frontend to the z-ai-web-dev-sdk.
 * The SDK must run server-side (never in the browser).
 *
 * Endpoints:
 *   POST /api/chat          — non-streaming chat completion
 *   POST /api/chat/stream   — streaming chat completion (SSE)
 *   POST /api/upload        — file upload (PDF/DOCX/TXT extraction)
 *   GET  /api/health        — health check
 *
 * Run locally:  node server.js
 * Deploy to:    Render (see render.yaml), Railway, or any Node host
 *
 * Then in DARKNESS Settings → General → API URL, enter:
 *   http://localhost:3000  (local)
 *   https://your-app.onrender.com  (production)
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import ZAI from 'z-ai-web-dev-sdk';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: true })); // Allow GitHub Pages origin
app.use(express.json({ limit: '10mb' }));

// File upload config (in-memory, 10MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

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
// Mode-aware system prompts
// ──────────────────────────────────────────────
function getSystemPrompt(mode, customSystem) {
  if (customSystem) return customSystem;
  const defaultSystem = 'You are DARKNESS, a premium AI assistant that helps users build projects, write code, research topics, and create presentations. Respond in clear, well-structured Markdown. Use code blocks with language labels for code. Be concise but thorough.';
  const modePrompts = {
    fast: 'Respond quickly and concisely. Direct answers, minimal preamble.',
    think: 'Think through the problem step by step. Analyze, plan, then answer with code examples where helpful.',
    deep: 'Use deep reasoning: understand the problem, decompose it, plan a solution, consider alternatives, verify your conclusions, then give a comprehensive answer. Show your high-level reasoning steps.',
    coding: 'You are an expert software engineer. Generate clean, production-ready code with proper error handling. Explain key decisions briefly.',
    ppt: 'You are a presentation designer. Create concise slide content with short bullet points, key statements, and clear structure.',
    auto: defaultSystem,
  };
  return modePrompts[mode] || defaultSystem;
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

    const system = getSystemPrompt(mode, systemPrompt);
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
    if (!response) throw new Error('Empty response from AI');

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
// POST /api/chat/stream — streaming chat completion (Server-Sent Events)
// ──────────────────────────────────────────────
app.post('/api/chat/stream', async (req, res) => {
  try {
    const zai = await initZAI();
    const { messages = [], mode = 'auto', systemPrompt } = req.body;

    if (!messages.length) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Send initial event
    res.write('event: start\ndata: {}\n\n');

    const system = getSystemPrompt(mode, systemPrompt);
    const fullMessages = [
      { role: 'assistant', content: system },
      ...messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }))
    ];

    // SDK doesn't support true streaming — use non-streaming call
    // and deliver in chunks to simulate streaming
    const completion = await zai.chat.completions.create({
      messages: fullMessages,
      thinking: { type: mode === 'deep' ? 'enabled' : 'disabled' }
    });
    const fullResponse = completion.choices[0]?.message?.content || '';

    // Deliver in ~15-char chunks with small delays for streaming effect
    const chunkSize = 15;
    for (let i = 0; i < fullResponse.length; i += chunkSize) {
      const chunk = fullResponse.slice(i, i + chunkSize);
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      await new Promise(r => setTimeout(r, 25));
    }

    // Send completion event
    res.write(`event: done\ndata: ${JSON.stringify({ fullResponse })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Stream error:', error.message);
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// ──────────────────────────────────────────────
// POST /api/upload — file upload + text extraction (PDF, DOCX, TXT, etc.)
// ──────────────────────────────────────────────
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { originalname, mimetype, buffer } = req.file;
    const ext = originalname.toLowerCase().split('.').pop();
    let extractedText = '';
    let fileType = 'unknown';

    // PDF extraction
    if (ext === 'pdf' || mimetype === 'application/pdf') {
      fileType = 'pdf';
      const pdfParse = (await import('pdf-parse')).default;
      const data = await pdfParse(buffer);
      extractedText = data.text || '';
    }
    else if (['txt', 'md', 'csv', 'json', 'js', 'ts', 'py', 'jsx', 'tsx', 'html', 'css', 'xml', 'yml', 'yaml'].includes(ext)) {
      fileType = 'text';
      extractedText = buffer.toString('utf-8');
    }
    // DOCX (basic — extract from XML if available, otherwise note unsupported)
    else if (ext === 'docx') {
      fileType = 'docx';
      // Simple DOCX text extraction: unzip and read word/document.xml
      try {
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(buffer);
        const docXml = await zip.file('word/document.xml').async('string');
        // Strip XML tags, keep text
        extractedText = docXml
          .replace(/<w:p[^>]*>/g, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .trim();
      } catch (e) {
        extractedText = '[DOCX extraction requires jszip — install with: npm install jszip]';
      }
    }
    // Image files — note that vision analysis requires a multimodal model
    else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
      fileType = 'image';
      extractedText = `[Image file: ${originalname}. Vision analysis requires a multimodal model.]`;
    }
    else {
      fileType = 'unsupported';
      extractedText = `[Unsupported file type: .${ext}]`;
    }

    // Truncate very long documents (to fit in context window)
    const maxChars = 50000; // ~12K tokens
    const truncated = extractedText.length > maxChars;
    if (truncated) {
      extractedText = extractedText.slice(0, maxChars) + '\n\n[... document truncated ...]';
    }

    res.json({
      success: true,
      filename: originalname,
      fileType,
      size: buffer.length,
      text: extractedText,
      truncated,
      preview: extractedText.slice(0, 500) + (extractedText.length > 500 ? '...' : '')
    });
  } catch (error) {
    console.error('Upload error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'File processing failed'
    });
  }
});

// ──────────────────────────────────────────────
// GET /api/health — health check
// ──────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    sdk: zaiInstance ? 'ready' : 'initializing',
    features: ['chat', 'streaming', 'upload', 'pdf-extraction']
  });
});

// Start server
initZAI().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🌑 DARKNESS AI Backend running on http://localhost:${PORT}`);
    console.log(`   Endpoints:`);
    console.log(`   • POST /api/chat          (non-streaming)`);
    console.log(`   • POST /api/chat/stream   (SSE streaming)`);
    console.log(`   • POST /api/upload        (PDF/DOCX/TXT extraction)`);
    console.log(`   • GET  /api/health`);
    console.log(`\n   To connect the frontend:`);
    console.log(`   Settings → General → API URL → http://localhost:${PORT}\n`);
  });
});
