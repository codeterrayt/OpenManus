// src/index.js
// Entry point — boots the Express API server and exposes the agent over HTTP.
//
// POST /run   { goal: string }  → SSE stream of all agent events
// GET  /health                  → 200 if server + DB are alive
// GET  /sessions                → last 50 sessions (metadata)
// GET  /sessions/:id            → full session record

import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import { runAgent } from './agent.js';
import { getPool, initDb, getEnvSettings } from './db.js';
import { config, resolveConfig } from './config.js';
import { browserEvents, handleUserAction, setScreencastQuality, closeBrowser } from './tools/browser.js';
import { cleanupSandbox } from './tools/docker.js';
import { findWorkspaceFiles, readFile } from './tools/docker_fs.js';
import envRouter from './routes/env.js';

const app = express();
app.use(express.json());

const llm = new OpenAI({
  baseURL: config.ollama.baseURL,
  apiKey: config.ollama.apiKey,
});

// Allow the Vite dev server (port 5173) to call this API during development
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
// Express 5 requires explicit wildcard syntax
app.options('/{*any}', (_req, res) => res.sendStatus(204));

// ─── Environment Settings Routes ──────────────────────────────────────────────
app.use('/env', envRouter);


// ─── Get Models List (Ollama + OpenAI + Groq) ────────────────────────────────
const OPENAI_MODELS = [
  { id: 'gpt-5.5-pro', name: 'GPT-5.5 Pro', pricing: '$30.00/$180.00 per 1M', inputPrice: '$30.00', outputPrice: '$180.00' },
  { id: 'gpt-5.5-flagship', name: 'GPT-5.5 Flagship', pricing: '$5.00/$30.00 per 1M', inputPrice: '$5.00', outputPrice: '$30.00' },
  { id: 'gpt-5.4-standard', name: 'GPT-5.4 Standard', pricing: '$2.50/$15.00 per 1M', inputPrice: '$2.50', outputPrice: '$15.00' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', pricing: '$0.75/$4.50 per 1M', inputPrice: '$0.75', outputPrice: '$4.50' },
  { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano', pricing: '$0.20/$1.25 per 1M', inputPrice: '$0.20', outputPrice: '$1.25' },
  { id: 'o4-mini', name: 'o4-mini', pricing: '$0.55/$2.20 per 1M', inputPrice: '$0.55', outputPrice: '$2.20' },
  { id: 'o3-mini', name: 'o3-mini', pricing: '$1.10/$4.40 per 1M', inputPrice: '$1.10', outputPrice: '$4.40' },
  { id: 'o1', name: 'o1', pricing: '$15.00/$60.00 per 1M', inputPrice: '$15.00', outputPrice: '$60.00' },
  { id: 'o1-mini', name: 'o1-mini', pricing: '$3.00/$12.00 per 1M', inputPrice: '$3.00', outputPrice: '$12.00' },
  { id: 'gpt-4o', name: 'GPT-4o', pricing: '$5.00/$15.00 per 1M', inputPrice: '$5.00', outputPrice: '$15.00' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', pricing: '$0.15/$0.60 per 1M', inputPrice: '$0.15', outputPrice: '$0.60' }
];

const STATIC_GROQ_MODELS = [
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Versatile)', pricing: 'Free Tier', limits: '30 RPM | 6,000 TPM | 1,000 RPD' },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B (Instant)', pricing: 'Free Tier', limits: '30 RPM | 30,000 TPM | 14,400 RPD' },
  { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 Distill Llama 70B', pricing: 'Free Tier', limits: '30 RPM | 6,000 TPM | 1,000 RPD' },
  { id: 'gemma2-9b-it', name: 'Gemma 2 9B IT', pricing: 'Free Tier', limits: '30 RPM | 15,000 TPM | 1,440 RPD' }
];

app.get('/models', async (_req, res) => {
  // Load live settings so enabled/disabled toggles are respected immediately
  let settings = {};
  try { settings = await getEnvSettings(); } catch { /* fallback to .env */ }

  const source      = settings['ENV_SOURCE'] ?? 'env';
  const useDbSource = source === 'db';

  const ollamaEnabled = settings['OLLAMA_ENABLED'] !== 'false';
  const groqEnabled   = settings['GROQ_ENABLED']   === 'true';
  const openaiEnabled = settings['OPENAI_ENABLED'] === 'true';

  // ── Ollama models ──────────────────────────────────────────────────────────
  let ollamaModels = [];
  if (ollamaEnabled) {
    const ollamaBaseURL = useDbSource
      ? (settings['OLLAMA_BASE_URL'] || config.ollama.baseURL)
      : config.ollama.baseURL;
    try {
      const ollamaClient = new OpenAI({ baseURL: ollamaBaseURL, apiKey: 'ollama' });
      const modelsList   = await ollamaClient.models.list();
      ollamaModels = modelsList.data.map(m => m.id);
    } catch (err) {
      console.error('[API] Failed to fetch models from Ollama:', err.message);
      const fallbackModel = useDbSource ? (settings['OLLAMA_MODEL'] || config.ollama.model) : config.ollama.model;
      ollamaModels = [fallbackModel];
    }
  }

  // ── Groq models ────────────────────────────────────────────────────────────
  let groqModels = [];
  if (groqEnabled) {
    const groqApiKey  = useDbSource ? (settings['GROQ_API_KEY']  || config.groq.apiKey)  : config.groq.apiKey;
    const groqBaseURL = useDbSource ? (settings['GROQ_BASE_URL'] || config.groq.baseURL) : config.groq.baseURL;

    groqModels = [...STATIC_GROQ_MODELS]; // default static list

    if (groqApiKey) {
      try {
        const groqClient  = new OpenAI({ baseURL: groqBaseURL, apiKey: groqApiKey });
        const groqList    = await groqClient.models.list();
        const apiModelIds = groqList.data.map(m => m.id);

        const merged = [];
        for (const modelId of apiModelIds) {
          if (modelId.includes('whisper') || modelId.includes('audio')) continue;
          const staticModel = STATIC_GROQ_MODELS.find(m => m.id === modelId);
          merged.push(staticModel ?? {
            id: modelId,
            name: modelId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
            pricing: 'Free Tier',
            limits: '30 RPM | 6,000 TPM | 1,000 RPD',
          });
        }
        if (merged.length > 0) groqModels = merged;
      } catch (err) {
        console.warn('[API] Failed to fetch live Groq models, using static list:', err.message);
      }
    }
  }

  // ── OpenAI models ──────────────────────────────────────────────────────────
  const openaiModels = openaiEnabled ? OPENAI_MODELS : [];

  res.json({
    ollama:  ollamaModels,
    openai:  openaiModels,
    groq:    groqModels,
    // Tell the frontend which providers are enabled so it can show/hide sections
    enabled: { ollama: ollamaEnabled, groq: groqEnabled, openai: openaiEnabled },
  });
});


// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  let dbStatus = 'ok'
  let dbError = null
  try {
    await getPool().query('SELECT 1')
  } catch (err) {
    dbStatus = 'error'
    dbError = err.message
  }
  // Always return 200 — the frontend checks this to confirm the server is up.
  // DB errors are reported inside the payload so the UI can show a warning.
  res.json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    model: config.ollama.model,
    ollamaUrl: config.ollama.baseURL,
    db: dbStatus,
    dbError,
  })
});

// ─── Run agent (SSE) ─────────────────────────────────────────────────────────
//
// Every agent lifecycle event is forwarded as a named SSE event so the UI can
// render tool calls, thinking state, and the final answer in real time.
//
// Event catalogue:
//   session_created  { sessionId }
//   step             { step, total }
//   llm_thinking     { step }
//   tool_start       { id, tool, args }
//   tool_result      { id, tool, result, raw, error }
//   answer           { text }
//   done             { sessionId, result }
//   error            { message }
app.post('/run', async (req, res) => {
  const { goal, sessionId, agent, model, summaryThreshold, useMemory } = req.body ?? {};
  if (!goal || typeof goal !== 'string') {
    return res.status(400).json({ error: 'Body must contain a "goal" string.' });
  }

  // ── Provider enabled pre-flight check ────────────────────────────────────────
  // Reject before opening SSE if the requested model belongs to a disabled provider.
  try {
    const settings = await getEnvSettings();
    if (model) {
      const isGroqModel   = model.startsWith('llama-') || model.startsWith('deepseek-') || model.startsWith('gemma2-') || model.includes('groq/');
      const isOpenAIModel = model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4');
      const isOllamaModel = !isGroqModel && !isOpenAIModel;

      const ollamaEnabled = settings['OLLAMA_ENABLED'] !== 'false';
      const groqEnabled   = settings['GROQ_ENABLED']   === 'true';
      const openaiEnabled = settings['OPENAI_ENABLED'] === 'true';

      if (isGroqModel   && !groqEnabled)   return res.status(403).json({ error: 'Groq is disabled in Environment Settings. Enable it to use Groq models.' });
      if (isOpenAIModel && !openaiEnabled) return res.status(403).json({ error: 'OpenAI is disabled in Environment Settings. Enable it to use OpenAI models.' });
      if (isOllamaModel && !ollamaEnabled) return res.status(403).json({ error: 'Ollama is disabled in Environment Settings. Enable it to use local models.' });
    }
  } catch { /* DB unavailable — let the run proceed and let agent handle it */ }

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if proxied
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Keep-alive ping so the connection stays open during long tool runs
  const ping = setInterval(() => res.write(': ping\n\n'), 15_000);

  try {
    send('start', { goal });

    // Resolve config from DB if ENV_SOURCE=db, otherwise use .env
    const liveConfig = await resolveConfig(getEnvSettings);

    await runAgent(goal, (type, data) => send(type, data), sessionId, agent, model, summaryThreshold, useMemory, liveConfig);
  } catch (err) {
    console.error('[API] /run error:', err);
    send('error', { message: err.message });
  } finally {
    clearInterval(ping);
    res.end();
  }
});

app.post('/reset', async (req, res) => {
  console.log('[API] Resetting browser and sandbox session...');
  try {
    await closeBrowser().catch(() => {});
    await cleanupSandbox().catch(() => {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Memory Management APIs ──────────────────────────────────────────────────
app.get('/memories', async (_req, res) => {
  try {
    const { rows } = await getPool().query('SELECT * FROM memories ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/memories/summarize', async (req, res) => {
  const { model } = req.body ?? {};
  try {
    const isOpenAI = model && (
      model.startsWith('gpt-') ||
      model.startsWith('o1') ||
      model.startsWith('o3') ||
      model.startsWith('o4')
    );
    const resolvedModel = model ?? config.ollama.model;
    
    const OPENAI_MODEL_MAPPING = {
      'gpt-5.5-pro': 'gpt-4o',
      'gpt-5.5-flagship': 'gpt-4o',
      'gpt-5.4-standard': 'gpt-4o',
      'gpt-5.4-mini': 'gpt-4o-mini',
      'gpt-5.4-nano': 'gpt-4o-mini',
      'o4-mini': 'o1-mini',
      'o3-mini': 'o3-mini',
      'o1': 'o1',
      'o1-mini': 'o1-mini',
      'gpt-4o': 'gpt-4o',
      'gpt-4o-mini': 'gpt-4o-mini'
    };
    
    const targetModelName = isOpenAI ? (OPENAI_MODEL_MAPPING[resolvedModel] ?? resolvedModel) : resolvedModel;

    const llmClient = isOpenAI
      ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      : new OpenAI({ baseURL: config.ollama.baseURL, apiKey: config.ollama.apiKey });

    const { rows: memories } = await getPool().query('SELECT * FROM memories ORDER BY created_at DESC');
    if (memories.length === 0) {
      return res.json({ success: true, memories: [] });
    }

    const memoriesText = memories.map(m => `- ${m.content}`).join('\n');

    const response = await llmClient.chat.completions.create({
      model: targetModelName,
      messages: [
        {
          role: 'system',
          content: `You are a memory consolidation engine. Your task is to review a list of user preferences, system configurations, and learned facts (memories) and merge them into a highly compact, dense list of key facts.
Combine duplicate, overlapping, or related points. Merge profile details, user names, and coding preferences into unified, consolidated entries (e.g. 'User Profile: Rohan | Prefers: TailwindCSS' instead of separate entries) to minimize token footprint.
Return the consolidated facts as a raw JSON array of strings, like this:
["Fact 1", "Fact 2"]
Do NOT return any other text, markdown formatting (no backticks), or introduction. Output ONLY the JSON array.`
        },
        {
          role: 'user',
          content: `Here are the current memories:\n${memoriesText}`
        }
      ],
      temperature: 0.1
    });

    const reply = response.choices[0]?.message?.content?.trim();
    console.log('[Memory Summary] LLM response:', reply);

    let cleanReply = reply;
    if (cleanReply.startsWith('```json')) {
      cleanReply = cleanReply.substring(7);
    }
    if (cleanReply.startsWith('```')) {
      cleanReply = cleanReply.substring(3);
    }
    if (cleanReply.endsWith('```')) {
      cleanReply = cleanReply.substring(0, cleanReply.length - 3);
    }
    cleanReply = cleanReply.trim();

    let newMemories = [];
    try {
      newMemories = JSON.parse(cleanReply);
      if (!Array.isArray(newMemories)) {
        throw new Error('LLM did not return an array');
      }
    } catch (parseErr) {
      console.warn('[Memory Summary] Failed to parse LLM response as JSON array. Falling back to line splitting. Raw reply:', reply);
      newMemories = cleanReply
        .split('\n')
        .map(line => line.replace(/^[-*•\d.\s]+/, '').trim())
        .filter(line => line.length > 5);
    }

    if (newMemories.length > 0) {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM memories');
        for (const content of newMemories) {
          await client.query('INSERT INTO memories (content) VALUES ($1)', [content]);
        }
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    }

    const { rows } = await getPool().query('SELECT * FROM memories ORDER BY created_at DESC');
    res.json({ success: true, memories: rows });
  } catch (err) {
    console.error('[Memory Summary] Error summarizing memories:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/memories', async (_req, res) => {
  try {
    await getPool().query('DELETE FROM memories');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/memories', async (req, res) => {
  const { content } = req.body ?? {};
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Body must contain a "content" string.' });
  }
  try {
    const { rows } = await getPool().query(
      'INSERT INTO memories (content) VALUES ($1) RETURNING *',
      [content]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/memories/:id', async (req, res) => {
  const { content } = req.body ?? {};
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Body must contain a "content" string.' });
  }
  try {
    const { rows } = await getPool().query(
      'UPDATE memories SET content = $1 WHERE id = $2 RETURNING *',
      [content, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Memory not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/memories/:id', async (req, res) => {
  try {
    const result = await getPool().query('DELETE FROM memories WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Memory not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── List sessions ────────────────────────────────────────────────────────────
app.get('/sessions', async (_req, res) => {
  try {
    const { rows } = await getPool().query(
      `SELECT id, goal, status, created_at, updated_at, result
       FROM   sessions
       ORDER  BY created_at DESC
       LIMIT  50`
    );
    res.json(rows);
  } catch (_err) {
    // Postgres not ready yet — return empty list instead of 500
    res.json([]);
  }
});

// ─── Get single session ───────────────────────────────────────────────────────
app.get('/sessions/:id', async (req, res) => {
  try {
    const { rows } = await getPool().query(
      `SELECT * FROM sessions WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Session Files Explorer APIs ──────────────────────────────────────────────
app.get('/sessions/:id/files', async (req, res) => {
  try {
    const { rows } = await getPool().query('SELECT 1 FROM sessions WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });

    const files = await findWorkspaceFiles();
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/sessions/:id/files/content', async (req, res) => {
  try {
    const { id } = req.params;
    const { path } = req.query;
    if (!path) return res.status(400).json({ error: 'Path parameter is required' });

    const { rows } = await getPool().query('SELECT 1 FROM sessions WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });

    if (path.includes('..') || path.startsWith('/') || path.startsWith('\\')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const absPath = `/workspace/${path}`;
    const result = await readFile({ path: absPath });
    if (result.exitCode !== 0) {
      return res.status(500).json({ error: result.stderr || 'Failed to read file' });
    }

    res.json({ content: result.stdout });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let _lastFrame = null;       // last binary frame for reconnects
let _latestFrame = null;     // newest frame (overwrites stale ones)
let _drainScheduled = false; // prevent multiple drain callbacks

/**
 * Frame drainer — called synchronously on each frame arrival.
 * Only the single most-recent frame is ever sent; frames that arrive while a
 * drain is in-flight are overwritten and silently dropped.
 * This prevents the "latency snowball" where queued frames play back seconds
 * after they were captured.
 */
function drainFrame() {
  _drainScheduled = false;
  if (!_latestFrame) return;

  const binaryFrame = _latestFrame;
  _latestFrame = null;

  // Staleness guard: raised to 500ms because Chrome software renderer
  // (SwiftShader / --disable-gpu) takes 80–200ms to encode each JPEG.
  // Frames older than 500ms are truly stale — discard so we don't build lag.
  const view = new DataView(binaryFrame.buffer, binaryFrame.byteOffset, 8);
  const capturedAt = view.getFloat64(0, false);
  if (Date.now() - capturedAt > 500) return; // drop stale frame

  _lastFrame = binaryFrame; // persist for reconnects

  for (const client of wss.clients) {
    if (client.readyState !== 1 /* OPEN */) continue;
    // Backpressure: if the client’s TCP write buffer already has data queued,
    // skip this frame for that client. The NEXT frame will arrive soon and
    // will be sent when the buffer clears. This is the key to zero latency.
    if (client.bufferedAmount > 0) continue;
    client.send(binaryFrame);
  }
}

wss.on('connection', (ws) => {
  console.log('[WS] Client connected to browser stream');

  // Immediately send the last known frame if active so the reconnected client sees it instantly
  if (_lastFrame) {
    ws.send(_lastFrame);
  }

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'action') {
        await handleUserAction(data.action);
      } else if (data.type === 'setQuality') {
        // Client requests quality change based on measured latency
        await setScreencastQuality(data.quality, data.fps).catch(() => {});
      }
    } catch (err) {
      console.warn('[WS] Error handling browser control action:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected from browser stream');
  });
});

browserEvents.on('frame', (frameData) => {
  // Decode base64 → raw JPEG bytes (eliminates 33% base64 WS overhead)
  const jpegBuffer = Buffer.from(frameData.data, 'base64');

  // Binary frame protocol:
  //   [0..7]  Float64BE  capturedAt (ms timestamp for latency measurement)
  //   [8..11] Uint32BE   URL byte length
  //   [12..N] UTF-8      current page URL
  //   [N+1..] bytes      raw JPEG data
  const urlBytes = Buffer.from(frameData.url || '', 'utf8');
  const header = Buffer.alloc(12);
  header.writeDoubleBE(Date.now(), 0);       // 8-byte timestamp
  header.writeUInt32BE(urlBytes.length, 8);  // 4-byte URL length

  const binaryFrame = Buffer.concat([header, urlBytes, jpegBuffer]);

  // Always overwrite with the newest frame
  _latestFrame = binaryFrame;

  // Schedule drain synchronously — no setImmediate tick delay.
  // drainFrame() will only send if no data is already buffered (backpressure).
  if (!_drainScheduled) {
    _drainScheduled = true;
    // process.nextTick is faster than setImmediate (runs before I/O callbacks)
    // but still yields so multiple CDP frames that arrived in the same tick
    // are coalesced into one send.
    process.nextTick(drainFrame);
  }
});

browserEvents.on('close', () => {
  _lastFrame = null;
  // Tell clients the stream is offline
  const offlinePayload = JSON.stringify({ type: 'close' });
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(offlinePayload).catch(() => {});
    }
  }
});

browserEvents.on('loading', () => {
  const payload = JSON.stringify({ type: 'loading' });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
});

browserEvents.on('loaded', () => {
  const payload = JSON.stringify({ type: 'loaded' });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
});

server.listen(config.api.port, async () => {
  await initDb().catch((err) => {
    console.error('[DB] initDb failed on startup:', err.message);
  });
  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║           OpenManus — Local AI Engine            ║
  ╠══════════════════════════════════════════════════╣
  ║  API   → http://localhost:${config.api.port}                  ║
  ║  LLM   → ${config.ollama.baseURL.padEnd(38)}║
  ║  Model → ${config.ollama.model.padEnd(38)}║
  ╚══════════════════════════════════════════════════╝
  `);
});


