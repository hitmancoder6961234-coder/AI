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
  CREATE TABLE IF NOT EXISTS shared_chats (
    share_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    title TEXT,
    messages TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    views INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    event TEXT NOT NULL,
    data TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_analytics_user ON analytics(user_id);
  CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics(event);
  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    url TEXT NOT NULL,
    events TEXT NOT NULL,
    secret TEXT,
    active INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
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
// POST /api/code — execute code in a sandbox (JavaScript only, safe)
// ──────────────────────────────────────────────
app.post('/api/code', async (req, res) => {
  try {
    const { language, code, stdin } = req.body;
    if (!code) return res.status(400).json({ error: 'code is required' });
    if (language !== 'javascript' && language !== 'js') {
      return res.status(400).json({ error: 'Only JavaScript execution is supported in the sandbox' });
    }

    // Execute in a sandboxed VM with a timeout
    const vm = await import('node:vm');
    const logs = [];
    const errors = [];
    const sandbox = {
      console: {
        log: (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')),
        error: (...args) => errors.push(args.map(a => String(a)).join(' ')),
        warn: (...args) => logs.push('⚠ ' + args.map(a => String(a)).join(' ')),
        info: (...args) => logs.push(args.map(a => String(a)).join(' ')),
      },
      Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set, Promise,
      parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
      setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 2000)),
      __result: undefined,
    };

    const wrappedCode = `
      (function() {
        let __return;
        try {
          __return = eval(${JSON.stringify(code)});
        } catch(e) {
          __return = undefined;
          throw e;
        }
        return __return;
      })()
    `;

    const context = vm.createContext(sandbox);
    let result;
    try {
      result = vm.runInContext(wrappedCode, context, { timeout: 5000, filename: 'sandbox.js' });
    } catch(e) {
      return res.json({
        success: true,
        language: 'javascript',
        stdout: logs.join('\n'),
        stderr: e.message,
        result: null,
        error: e.message
      });
    }

    let resultStr;
    try {
      resultStr = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
    } catch(e) {
      resultStr = String(result);
    }

    res.json({
      success: true,
      language: 'javascript',
      stdout: logs.join('\n') + (errors.length ? '\n' + errors.join('\n') : ''),
      stderr: errors.join('\n'),
      result: resultStr
    });
  } catch (error) {
    console.error('Code execution error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ──────────────────────────────────────────────
// POST /api/share — create a shareable link for a conversation
// GET  /api/share/:id — get a shared conversation
// ──────────────────────────────────────────────
app.post('/api/share', (req, res) => {
  try {
    const { conversation } = req.body;
    if (!conversation || !conversation.messages) return res.status(400).json({ error: 'conversation is required' });

    const shareId = 'share-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    db.prepare('INSERT INTO shared_chats (share_id, conversation_id, title, messages) VALUES (?, ?, ?, ?)').run(
      shareId, conversation.id, conversation.title || 'Shared Chat', JSON.stringify(conversation.messages)
    );

    res.json({
      success: true,
      shareId,
      shareUrl: `/share/${shareId}`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/share/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM shared_chats WHERE share_id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Shared chat not found' });

    // Increment views
    db.prepare('UPDATE shared_chats SET views = views + 1 WHERE share_id = ?').run(req.params.id);

    res.json({
      success: true,
      conversation: {
        title: row.title,
        messages: JSON.parse(row.messages),
        views: row.views + 1,
        createdAt: row.created_at
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ──────────────────────────────────────────────
// Analytics: track events + retrieve stats
// ──────────────────────────────────────────────
app.post('/api/analytics', (req, res) => {
  try {
    const { userEmail, userName, userPicture, event, data } = req.body;
    if (!event) return res.status(400).json({ error: 'event is required' });
    let userId = null;
    if (userEmail) {
      const user = getOrCreateUser({ email: userEmail, name: userName, picture: userPicture });
      userId = user?.id;
    }
    db.prepare('INSERT INTO analytics (user_id, event, data) VALUES (?, ?, ?)').run(
      userId, event, JSON.stringify(data || {})
    );
    // Fire webhooks for this event
    fireWebhooks(userId, event, data || {}).catch(() => {});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/analytics', (req, res) => {
  try {
    const { userEmail } = req.query;
    let userId = null;
    if (userEmail) {
      const user = getOrCreateUser({ email: userEmail });
      userId = user?.id;
    }

    const totalEvents = db.prepare('SELECT COUNT(*) as count FROM analytics').get().count;
    const userEvents = userId ? db.prepare('SELECT COUNT(*) as count FROM analytics WHERE user_id = ?').get(userId).count : 0;
    const eventsByType = userId
      ? db.prepare('SELECT event, COUNT(*) as count FROM analytics WHERE user_id = ? GROUP BY event ORDER BY count DESC').all(userId)
      : db.prepare('SELECT event, COUNT(*) as count FROM analytics GROUP BY event ORDER BY count DESC').all();

    const recentEvents = userId
      ? db.prepare('SELECT event, data, created_at FROM analytics WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(userId)
      : db.prepare('SELECT event, data, created_at FROM analytics ORDER BY created_at DESC LIMIT 20').all();

    res.json({
      success: true,
      stats: {
        totalEvents,
        userEvents,
        eventsByType,
        recentEvents: recentEvents.map(e => ({ ...e, data: JSON.parse(e.data) }))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ──────────────────────────────────────────────
// Webhooks: CRUD + firing
// ──────────────────────────────────────────────
app.post('/api/webhooks', (req, res) => {
  try {
    const { userEmail, userName, userPicture, url, events, secret } = req.body;
    if (!userEmail || !url) return res.status(400).json({ error: 'userEmail and url are required' });
    const user = getOrCreateUser({ email: userEmail, name: userName, picture: userPicture });
    const id = 'wh-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    db.prepare('INSERT INTO webhooks (id, user_id, url, events, secret) VALUES (?, ?, ?, ?, ?)').run(
      id, user.id, url, JSON.stringify(events || []), secret || ''
    );
    res.json({ success: true, id, url, events });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/webhooks', (req, res) => {
  try {
    const { userEmail } = req.query;
    if (!userEmail) return res.json({ success: true, webhooks: [] });
    const user = getOrCreateUser({ email: userEmail });
    const webhooks = db.prepare('SELECT id, url, events, active, created_at FROM webhooks WHERE user_id = ?').all(user.id);
    res.json({ success: true, webhooks: webhooks.map(w => ({ ...w, events: JSON.parse(w.events) })) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/webhooks/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM webhooks WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fire webhooks for an event
async function fireWebhooks(userId, event, data) {
  const webhooks = db.prepare('SELECT * FROM webhooks WHERE active = 1').all();
  for (const wh of webhooks) {
    const events = JSON.parse(wh.events);
    if (events.includes(event) || events.includes('*')) {
      try {
        await fetch(wh.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(wh.secret ? { 'X-Webhook-Secret': wh.secret } : {})
          },
          body: JSON.stringify({ event, data, userId, timestamp: Date.now() })
        });
      } catch(e) {
        console.warn(`Webhook failed for ${wh.url}:`, e.message);
      }
    }
  }
}

// ──────────────────────────────────────────────
// POST /api/search — web search proxy
// ──────────────────────────────────────────────
app.post('/api/search', async (req, res) => {
  try {
    const { query, num = 5 } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });

    // Try to use the ZAI SDK's web search capability if available
    // Otherwise fall back to a DuckDuckGo HTML scrape (no API key needed)
    const zai = await initZAI();

    // Method 1: Try ZAI SDK web search (if the SDK supports it)
    if (zai.web_search) {
      try {
        const results = await zai.web_search.search({ query, num });
        if (results && results.length > 0) {
          return res.json({ success: true, results, source: 'zai-sdk' });
        }
      } catch(e) {
        console.log('ZAI web search not available, falling back to DuckDuckGo');
      }
    }

    // Method 2: DuckDuckGo Instant Answer API (no key needed)
    try {
      const ddgRes = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
      const ddgData = await ddgRes.json();
      const results = [];
      if (ddgData.AbstractText) {
        results.push({
          title: ddgData.Heading || query,
          snippet: ddgData.AbstractText,
          url: ddgData.AbstractURL || '',
          source: 'DuckDuckGo'
        });
      }
      if (ddgData.RelatedTopics) {
        for (const t of ddgData.RelatedTopics.slice(0, num - results.length)) {
          if (t.Text && t.FirstURL) {
            results.push({
              title: t.Text.split(' - ')[0] || t.Text.slice(0, 80),
              snippet: t.Text,
              url: t.FirstURL,
              source: 'DuckDuckGo'
            });
          }
        }
      }
      if (results.length > 0) {
        return res.json({ success: true, results, source: 'duckduckgo' });
      }
    } catch(e) {
      console.log('DuckDuckGo search failed:', e.message);
    }

    // Method 3: Use ZAI chat to generate a search-like summary
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: 'You are a web search assistant. The user wants to search the web. Provide the most relevant, factual information you have. If you are unsure, say so. Format as a list of key findings with sources if you know them.' },
        { role: 'user', content: `Search query: ${query}\n\nProvide the top ${num} relevant results or key facts.` }
      ],
      thinking: { type: 'disabled' }
    });
    const summary = completion.choices[0]?.message?.content || 'No results found.';
    return res.json({
      success: true,
      results: [{ title: query, snippet: summary, url: '', source: 'AI knowledge' }],
      source: 'ai-knowledge'
    });
  } catch (error) {
    console.error('Search error:', error.message);
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
    features: ['chat', 'streaming', 'upload', 'pdf-extraction', 'image-generation', 'translate', 'conversations-db', 'code-sandbox', 'sharing', 'analytics', 'webhooks', 'web-search']
  });
});

// Start server
initZAI().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🌑 DARKNESS AI Backend v4 running on http://localhost:${PORT}`);
    console.log(`   Endpoints:`);
    console.log(`   • POST /api/chat            (chat)`);
    console.log(`   • POST /api/chat/stream     (streaming)`);
    console.log(`   • POST /api/upload          (PDF/DOCX/TXT)`);
    console.log(`   • POST /api/image           (AI image gen)`);
    console.log(`   • POST /api/translate       (translation)`);
    console.log(`   • GET  /api/conversations   (multi-user DB)`);
    console.log(`   • POST /api/code            (code sandbox)`);
    console.log(`   • POST /api/share           (share a chat)`);
    console.log(`   • POST /api/analytics       (track + stats)`);
    console.log(`   • POST /api/webhooks        (webhooks CRUD)`);
    console.log(`   • GET  /api/health\n`);
  });
});
