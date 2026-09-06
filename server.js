/**
 * DARKNESS AI — Backend API Server (v3)
 *
 * Endpoints:
 *   POST /api/chat            — non-streaming chat completion
 *   POST /api/chat/stream     — streaming chat completion (SSE)
 *   POST /api/upload          — file upload (PDF/DOCX/TXT extraction)
 *   POST /api/image           — AI image generation
 *   POST /api/translate       — translation
 *   GET  /api/conversations   — list user conversations (DB)
 *   POST /api/conversations   — create/save a conversation (DB)
 *   DELETE /api/conversations/:id — delete a conversation (DB)
 *   GET  /api/health          — health check
 *
 * Run locally:  node server.js
 * Deploy to:    Render (see render.yaml)
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import Database from 'better-sqlite3';
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));

// File upload config
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ──────────────────────────────────────────────
// Database (SQLite via better-sqlite3)
// ──────────────────────────────────────────────
const dbPath = path.join(__dirname, 'darkness.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    picture TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT DEFAULT 'New Chat',
    messages TEXT DEFAULT '[]',
    created_at INTEGER DEFAULT (strftime('%s','now')),
    updated_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id);
`);

// ──────────────────────────────────────────────
// ZAI SDK
// ──────────────────────────────────────────────
let zaiInstance = null;
async function initZAI() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
    console.log('✓ ZAI SDK initialized');
  }
  return zaiInstance;
}

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
// Helper: get or create user from Google credential
// ──────────────────────────────────────────────
function getOrCreateUser(userPayload) {
  if (!userPayload || !userPayload.email) return null;
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(userPayload.email);
  if (existing) return existing;
  const id = 'user-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  db.prepare('INSERT INTO users (id, email, name, picture) VALUES (?, ?, ?, ?)').run(
    id, userPayload.email, userPayload.name || userPayload.email, userPayload.picture || ''
  );
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// ──────────────────────────────────────────────
// POST /api/chat — non-streaming chat completion
// ──────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const zai = await initZAI();
    const { messages = [], mode = 'auto', systemPrompt } = req.body;
    if (!messages.length) return res.status(400).json({ error: 'messages array is required' });

    const system = getSystemPrompt(mode, systemPrompt);
    const fullMessages = [
      { role: 'assistant', content: system },
      ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
    ];

    const completion = await zai.chat.completions.create({
      messages: fullMessages,
      thinking: { type: mode === 'deep' ? 'enabled' : 'disabled' }
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) throw new Error('Empty response from AI');

    res.json({ success: true, response, mode, usage: completion.usage || null });
  } catch (error) {
    console.error('Chat error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ──────────────────────────────────────────────
// POST /api/chat/stream — streaming chat completion (SSE)
// ──────────────────────────────────────────────
app.post('/api/chat/stream', async (req, res) => {
  try {
    const zai = await initZAI();
    const { messages = [], mode = 'auto', systemPrompt } = req.body;
    if (!messages.length) return res.status(400).json({ error: 'messages array is required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.write('event: start\ndata: {}\n\n');

    const system = getSystemPrompt(mode, systemPrompt);
    const fullMessages = [
      { role: 'assistant', content: system },
      ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
    ];

    const completion = await zai.chat.completions.create({
      messages: fullMessages,
      thinking: { type: mode === 'deep' ? 'enabled' : 'disabled' }
    });
    const fullResponse = completion.choices[0]?.message?.content || '';

    // Deliver in ~15-char chunks for streaming effect
    const chunkSize = 15;
    for (let i = 0; i < fullResponse.length; i += chunkSize) {
      const chunk = fullResponse.slice(i, i + chunkSize);
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      await new Promise(r => setTimeout(r, 25));
    }

    res.write(`event: done\ndata: ${JSON.stringify({ fullResponse })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Stream error:', error.message);
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// ──────────────────────────────────────────────
// POST /api/upload — file upload + text extraction
// ──────────────────────────────────────────────
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { originalname, mimetype, buffer } = req.file;
    const ext = originalname.toLowerCase().split('.').pop();
    let extractedText = '';
    let fileType = 'unknown';

    if (ext === 'pdf' || mimetype === 'application/pdf') {
      fileType = 'pdf';
      const pdfParse = (await import('pdf-parse')).default;
      const data = await pdfParse(buffer);
      extractedText = data.text || '';
    } else if (['txt', 'md', 'csv', 'json', 'js', 'ts', 'py', 'jsx', 'tsx', 'html', 'css', 'xml', 'yml', 'yaml'].includes(ext)) {
      fileType = 'text';
      extractedText = buffer.toString('utf-8');
    } else if (ext === 'docx') {
      fileType = 'docx';
      try {
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(buffer);
        const docXml = await zip.file('word/document.xml').async('string');
        extractedText = docXml.replace(/<w:p[^>]*>/g, '\n').replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
      } catch (e) { extractedText = '[DOCX extraction failed]'; }
    } else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
      fileType = 'image';
      extractedText = `[Image file: ${originalname}]`;
    } else {
      fileType = 'unsupported';
      extractedText = `[Unsupported: .${ext}]`;
    }

    const maxChars = 50000;
    const truncated = extractedText.length > maxChars;
    if (truncated) extractedText = extractedText.slice(0, maxChars) + '\n\n[... truncated ...]';

    res.json({ success: true, filename: originalname, fileType, size: buffer.length, text: extractedText, truncated });
  } catch (error) {
    console.error('Upload error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ──────────────────────────────────────────────
// POST /api/image — AI image generation
// ──────────────────────────────────────────────
app.post('/api/image', async (req, res) => {
  try {
    const zai = await initZAI();
    const { prompt, size = '1024x1024' } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const validSizes = ['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440'];
    if (!validSizes.includes(size)) size = '1024x1024';

    const response = await zai.images.generations.create({ prompt, size });
    const imageBase64 = response.data[0].base64;

    res.json({
      success: true,
      image: 'data:image/png;base64,' + imageBase64,
      prompt,
      size
    });
  } catch (error) {
    console.error('Image error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ──────────────────────────────────────────────
// POST /api/translate — translation
// ──────────────────────────────────────────────
app.post('/api/translate', async (req, res) => {
  try {
    const zai = await initZAI();
    const { text, targetLanguage, sourceLanguage } = req.body;
    if (!text || !targetLanguage) return res.status(400).json({ error: 'text and targetLanguage are required' });

    const systemPrompt = `You are a professional translator. Translate the user's text into ${targetLanguage}.${sourceLanguage ? ` The source language is ${sourceLanguage}.` : ''} Return ONLY the translation, no explanations, no quotes. Preserve formatting, code blocks, and markdown.`;

    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: systemPrompt },
        { role: 'user', content: text }
      ],
      thinking: { type: 'disabled' }
    });

    const translation = completion.choices[0]?.message?.content;
    if (!translation) throw new Error('Translation failed');

    res.json({ success: true, translation, targetLanguage });
  } catch (error) {
    console.error('Translate error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ──────────────────────────────────────────────
// GET /api/conversations — list user's conversations
// POST /api/conversations — create or update a conversation
// DELETE /api/conversations/:id — delete a conversation
// ──────────────────────────────────────────────
app.get('/api/conversations', (req, res) => {
  try {
    const { userEmail, userName, userPicture } = req.query;
    if (!userEmail) return res.json({ success: true, conversations: [] });

    const user = getOrCreateUser({ email: userEmail, name: userName, picture: userPicture });
    const convs = db.prepare('SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC').all(user.id);

    res.json({ success: true, conversations: convs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/conversations', (req, res) => {
  try {
    const { userEmail, userName, userPicture, conversation } = req.body;
    if (!userEmail || !conversation) return res.status(400).json({ error: 'userEmail and conversation are required' });

    const user = getOrCreateUser({ email: userEmail, name: userName, picture: userPicture });
    const { id, title, messages } = conversation;

    db.prepare(`
      INSERT INTO conversations (id, user_id, title, messages, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        messages = excluded.messages,
        updated_at = excluded.updated_at
    `).run(id, user.id, title || 'New Chat', JSON.stringify(messages), Date.now());

    res.json({ success: true, id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/conversations/:id', (req, res) => {
  try {
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, conversation: { ...conv, messages: JSON.parse(conv.messages) } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/conversations/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ──────────────────────────────────────────────
// GET /api/health
// ──────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    sdk: zaiInstance ? 'ready' : 'initializing',
    features: ['chat', 'streaming', 'upload', 'pdf-extraction', 'image-generation', 'translate', 'conversations-db']
  });
});

// Start server
initZAI().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🌑 DARKNESS AI Backend v3 running on http://localhost:${PORT}`);
    console.log(`   Endpoints:`);
    console.log(`   • POST /api/chat            (chat)`);
    console.log(`   • POST /api/chat/stream     (streaming)`);
    console.log(`   • POST /api/upload          (PDF/DOCX/TXT)`);
    console.log(`   • POST /api/image           (AI image gen)`);
    console.log(`   • POST /api/translate       (translation)`);
    console.log(`   • GET  /api/conversations   (multi-user DB)`);
    console.log(`   • GET  /api/health\n`);
  });
});
