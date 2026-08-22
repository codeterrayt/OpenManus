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
import { detectModelCapabilities } from './utils/modelCapabilities.js';
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
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', pricing: '$3.00/$15.00 per 1M', inputPrice: '$3.00', outputPrice: '$15.00' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', pricing: '$2.50/$12.00 per 1M', inputPrice: '$2.50', outputPrice: '$12.00' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', pricing: '$1.50/$6.00 per 1M', inputPrice: '$1.50', outputPrice: '$6.00' },
  { id: 'gpt-5.5-pro', name: 'GPT-5.5 Pro', pricing: '$30.00/$180.00 per 1M', inputPrice: '$30.00', outputPrice: '$180.00' },
  { id: 'gpt-5.5-flagship', name: 'GPT-5.5 Flagship', pricing: '$5.00/$30.00 per 1M', inputPrice: '$5.00', outputPrice: '$30.00' },
  { id: 'gpt-5.4-standard', name: 'GPT-5.4 Standard', pricing: '$2.50/$15.00 per 1M', inputPrice: '$2.50', outputPrice: '$15.00' },
  { id: 'gpt-5.4-terra', name: 'GPT-5.4 Terra', pricing: '$2.50/$15.00 per 1M', inputPrice: '$2.50', outputPrice: '$15.00' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', pricing: '$0.75/$4.50 per 1M', inputPrice: '$0.75', outputPrice: '$4.50' },
  { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano', pricing: '$0.20/$1.25 per 1M', inputPrice: '$0.20', outputPrice: '$1.25' },
  { id: 'gpt-5.2-luna', name: 'GPT-5.2 Luna', pricing: '$0.50/$2.00 per 1M', inputPrice: '$0.50', outputPrice: '$2.00' },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', pricing: '$15.00/$75.00 per 1M', inputPrice: '$15.00', outputPrice: '$75.00' },
  { id: 'claude-opus-5', name: 'Claude Opus 5', pricing: '$15.00/$75.00 per 1M', inputPrice: '$15.00', outputPrice: '$75.00' },
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
      if (modelsList && Array.isArray(modelsList.data) && modelsList.data.length > 0) {
        ollamaModels = modelsList.data.map(m => m.id);
      }
    } catch (err) {
      console.warn('[API] OpenAI SDK list models failed for Ollama, trying /api/tags fallback:', err.message);
    }

    if (ollamaModels.length === 0) {
      try {
        const cleanHost = ollamaBaseURL.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
        const tagsRes = await fetch(`${cleanHost}/api/tags`);
        if (tagsRes.ok) {
          const data = await tagsRes.json();
          if (data && Array.isArray(data.models)) {
            ollamaModels = data.models.map(m => m.name || m.model).filter(Boolean);
          }
        }
      } catch (err) {
        console.warn('[API] Ollama /api/tags fallback failed:', err.message);
      }
    }

    if (ollamaModels.length === 0) {
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
  let openaiModels = [];
  if (openaiEnabled) {
    openaiModels = [...OPENAI_MODELS];
    const openaiApiKey  = useDbSource ? (settings['OPENAI_API_KEY']  || config.openai.apiKey)  : config.openai.apiKey;
    const openaiBaseURL = useDbSource ? (settings['OPENAI_BASE_URL'] || config.openai.baseURL) : config.openai.baseURL;

    if (openaiApiKey) {
      try {
        const openaiClient = new OpenAI({
          baseURL: openaiBaseURL || 'https://api.openai.com/v1',
          apiKey: openaiApiKey,
          defaultHeaders: {
            'User-Agent': 'Claude-Desktop/0.7.6',
          }
        });
        const liveList = await openaiClient.models.list();
        if (liveList && Array.isArray(liveList.data) && liveList.data.length > 0) {
          const apiModelIds = liveList.data.map(m => m.id).filter(Boolean);
          const merged = [];
          for (const modelId of apiModelIds) {
            if (modelId.includes('whisper') || modelId.includes('tts') || modelId.includes('embedding') || modelId.includes('dall-e') || modelId.includes('babbage') || modelId.includes('davinci')) continue;
            const staticModel = OPENAI_MODELS.find(m => m.id === modelId);
            merged.push(staticModel ?? {
              id: modelId,
              name: modelId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
              pricing: '$2.50/$10.00 per 1M',
              inputPrice: '$2.50',
              outputPrice: '$10.00'
            });
          }
          // Also append static models so none are lost
          for (const sm of OPENAI_MODELS) {
            if (!merged.some(m => m.id === sm.id)) {
              merged.push(sm);
            }
          }
          if (merged.length > 0) openaiModels = merged;
        }
      } catch (err) {
        console.warn('[API] Failed to fetch live OpenAI/Router models, using default list:', err.message);
      }
    }
  }

  // ── Custom Providers models ───────────────────────────────────────────────
  let customProviders = [];
  try {
    if (settings['CUSTOM_PROVIDERS']) {
      const parsed = typeof settings['CUSTOM_PROVIDERS'] === 'string'
        ? JSON.parse(settings['CUSTOM_PROVIDERS'])
        : settings['CUSTOM_PROVIDERS'];
      if (Array.isArray(parsed)) {
        customProviders = parsed;
      }
    }
  } catch (err) {
    console.warn('[API] Failed to parse custom providers for /models:', err.message);
  }

  const customProvidersResult = [];
  for (const provider of customProviders) {
    if (provider.enabled === false) continue;
    let providerModels = Array.isArray(provider.models) ? [...provider.models] : [];

    // Always attempt live model discovery if baseURL is provided
    if (provider.baseURL) {
      try {
        const client = new OpenAI({
          baseURL: provider.baseURL,
          apiKey: provider.apiKey || 'dummy-key',
          defaultHeaders: {
            'User-Agent': 'Claude-Desktop/0.7.6',
          }
        });
        const list = await client.models.list();
        if (list && Array.isArray(list.data) && list.data.length > 0) {
          const liveIds = list.data.map(m => m.id).filter(Boolean);
          // Merge discovered models with any statically configured models
          const combined = Array.from(new Set([...providerModels, ...liveIds]));
          if (combined.length > 0) providerModels = combined;
        }
      } catch {
        // try ollama /api/tags fallback
        try {
          const cleanHost = provider.baseURL.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
          const tagsRes = await fetch(`${cleanHost}/api/tags`, {
            headers: { 'User-Agent': 'Claude-Desktop/0.7.6' }
          });
          if (tagsRes.ok) {
            const data = await tagsRes.json();
            if (data && Array.isArray(data.models)) {
              const liveIds = data.models.map(m => m.name || m.model).filter(Boolean);
              const combined = Array.from(new Set([...providerModels, ...liveIds]));
              if (combined.length > 0) providerModels = combined;
            }
          }
        } catch {
          // ignore
        }
      }
    }

    customProvidersResult.push({
      id: provider.id || `custom_${Date.now()}`,
      name: provider.name || 'Custom Provider',
      baseURL: provider.baseURL,
      models: providerModels,
      enabled: provider.enabled !== false,
    });
  }

  // Live dynamic detection of thinking & reasoning capabilities for all discovered models
  const allModelIds = [
    ...ollamaModels,
    ...openaiModels.map(m => m.id),
    ...groqModels.map(m => m.id),
    ...customProvidersResult.flatMap(p => p.models || [])
  ];
  const capabilities = {};
  for (const modelId of allModelIds) {
    if (modelId) capabilities[modelId] = detectModelCapabilities(modelId);
  }

  res.json({
    ollama:  ollamaModels,
    openai:  openaiModels,
    groq:    groqModels,
    custom:  customProvidersResult,
    capabilities,
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

// ─── Live Session Event Hub ──────────────────────────────────────────────────
const activeSessionListeners = new Map(); // sessionId -> Set<(event: string, data: any) => void>

function subscribeToSession(sessionId, listener) {
  if (!sessionId) return () => {};
  if (!activeSessionListeners.has(sessionId)) {
    activeSessionListeners.set(sessionId, new Set());
  }
  activeSessionListeners.get(sessionId).add(listener);
  return () => {
    const set = activeSessionListeners.get(sessionId);
    if (set) {
      set.delete(listener);
      if (set.size === 0) activeSessionListeners.delete(sessionId);
    }
  };
}

function broadcastSessionEvent(sessionId, event, data) {
  if (!sessionId) return;
  const set = activeSessionListeners.get(sessionId);
  if (set) {
    for (const listener of set) {
      try { listener(event, data); } catch (_) {}
    }
  }
}

// Active run registry for instant cancellation
const activeRuns = new Map();

async function generateSensibleTitle(goal, liveConfig, model) {
  try {
    const prompt = `Generate a concise, sensible 3-6 word title for this user request. Output ONLY the title text, nothing else. No quotes, no markdown, no punctuation at end. Examples: "Streamlit Needle 2 App", "Python Fractal Visualizer", "Landing Page Component", "PostgreSQL Docker Setup".\n\nUser request: ${goal.slice(0, 250)}`;
    
    const client = new OpenAI({
      baseURL: liveConfig.openai.apiKey ? liveConfig.openai.baseURL : (liveConfig.ollama.baseURL || 'http://localhost:11434/v1'),
      apiKey: liveConfig.openai.apiKey || 'ollama'
    });

    const targetModel = liveConfig.openai.apiKey 
      ? (liveConfig.openai.model || 'gpt-4o-mini') 
      : (liveConfig.ollama.model || 'gemma4:e4b');

    const completion = await client.chat.completions.create({
      model: targetModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 20,
      temperature: 0.3
    });

    const title = completion.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, '').replace(/[.]+$/, '');
    if (title && title.length >= 3 && title.length <= 60 && !title.toLowerCase().includes('error')) {
      return title;
    }
  } catch (err) {
    console.warn('[API] AI Title generation fallback:', err.message);
  }

  const words = goal.trim().split(/\s+/).slice(0, 5).join(' ');
  return words.length > 35 ? `${words.slice(0, 32)}...` : words;
}

// ─── Run agent (SSE) ─────────────────────────────────────────────────────────
//
// Every agent lifecycle event is forwarded as a named SSE event so the UI can
// render tool calls, thinking state, and the final answer in real time.
//
// Event catalogue:
//   session_created  { sessionId }
//   session_title_updated { sessionId, title }
//   step             { step, total }
//   llm_thinking     { step }
//   tool_draft       { id, tool, argumentsDelta, rawArguments }
//   tool_start       { id, tool, args }
//   tool_stream_output { id, tool, chunk, stream, liveStdout, liveStderr }
//   tool_result      { id, tool, result, raw, error }
//   answer           { text }
//   done             { sessionId, result }
//   error            { message }
app.post('/run', async (req, res) => {
  const { goal, sessionId, agent, model, summaryThreshold, useMemory, thinkingBudget, reasoningEffort } = req.body ?? {};
  if (!goal || typeof goal !== 'string') {
    return res.status(400).json({ error: 'Body must contain a "goal" string.' });
  }

  // ── Provider enabled pre-flight check ────────────────────────────────────────
  // Reject before opening SSE if the requested model belongs to a disabled provider.
  try {
    const settings = await getEnvSettings();
    if (model) {
      const isGroqModel   = model.startsWith('llama-') || model.startsWith('llama3-') || model.startsWith('deepseek-') || model.startsWith('gemma2-') || model.includes('groq/') || model.startsWith('allam-');
      const isOpenAIModel = model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4');

      let customProviders = [];
      try {
        if (settings['CUSTOM_PROVIDERS']) {
          const parsed = typeof settings['CUSTOM_PROVIDERS'] === 'string' ? JSON.parse(settings['CUSTOM_PROVIDERS']) : settings['CUSTOM_PROVIDERS'];
          if (Array.isArray(parsed)) customProviders = parsed;
        }
      } catch {}

      const matchingCustom = customProviders.find(p => Array.isArray(p.models) && p.models.includes(model));
      const isCustomModel = !!matchingCustom;
      const isOllamaModel = !isGroqModel && !isOpenAIModel && !isCustomModel;

      const ollamaEnabled = settings['OLLAMA_ENABLED'] !== 'false';
      const groqEnabled   = settings['GROQ_ENABLED']   === 'true';
      const openaiEnabled = settings['OPENAI_ENABLED'] === 'true';

      if (isCustomModel && matchingCustom.enabled === false) return res.status(403).json({ error: `Provider "${matchingCustom.name}" is disabled in Environment Settings. Enable it to use this model.` });
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

  const abortController = new AbortController();
  let activeSessionKey = sessionId || null;
  if (activeSessionKey) {
    activeRuns.set(activeSessionKey, abortController);
  }

  const send = (event, data) => {
    if (event === 'session_created' && data?.sessionId) {
      activeSessionKey = data.sessionId;
      activeRuns.set(activeSessionKey, abortController);

      // Trigger parallel AI title generation
      generateSensibleTitle(goal, liveConfigRef || config, model).then(async (cleanTitle) => {
        try {
          await getPool().query('UPDATE sessions SET title = $1 WHERE id = $2', [cleanTitle, activeSessionKey]);
          send('session_title_updated', { sessionId: activeSessionKey, title: cleanTitle });
        } catch (_) {}
      });
    }
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (activeSessionKey) {
      broadcastSessionEvent(activeSessionKey, event, data);
    }
  };

  // Keep-alive ping so the connection stays open during long tool runs
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (_) {}
  }, 15_000);

  let liveConfigRef = null;

  try {
    send('start', { goal });

    // Resolve config from DB if ENV_SOURCE=db, otherwise use .env
    const liveConfig = await resolveConfig(getEnvSettings);
    liveConfigRef = liveConfig;

    await runAgent(
      goal, 
      (type, data) => send(type, data), 
      sessionId, 
      agent, 
      model, 
      summaryThreshold, 
      useMemory, 
      liveConfig,
      { thinkingBudget, reasoningEffort },
      { signal: abortController.signal }
    );
  } catch (err) {
    console.error('[API] /run error:', err);
    send('error', { message: err.message });
  } finally {
    if (activeSessionKey) {
      activeRuns.delete(activeSessionKey);
    }
    clearInterval(ping);
    res.end();
  }
});

// ─── Stop / Cancel Session Endpoint ──────────────────────────────────────────
app.post(['/sessions/:id/stop', '/sessions/:id/abort', '/stop'], async (req, res) => {
  const sessionId = req.params.id || req.body?.sessionId;
  console.log(`[API] Stop requested for session: ${sessionId}`);

  if (sessionId && activeRuns.has(sessionId)) {
    const controller = activeRuns.get(sessionId);
    controller.abort();
    activeRuns.delete(sessionId);
  }

  if (sessionId) {
    try {
      await getPool().query(
        `UPDATE sessions SET status = 'failed', result = 'Agent stopped by user.', updated_at = NOW() WHERE id = $1`,
        [sessionId]
      );
      broadcastSessionEvent(sessionId, 'error', { message: 'Agent stopped by user.' });
    } catch (err) {
      console.warn('[API] Failed to update stopped session in DB:', err.message);
    }
  }

  res.json({ success: true, message: 'Session execution stopped.' });
});

// ─── Live Session Reconnect SSE Endpoint ──────────────────────────────────────
app.get('/sessions/:id/events', (req, res) => {
  const { id } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (_) {}
  };

  send('ping', { ts: Date.now() });
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (_) {}
  }, 15_000);

  const unsubscribe = subscribeToSession(id, (event, data) => {
    send(event, data);
  });

  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
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
    const liveConfig = await resolveConfig(getEnvSettings);
    const resolvedModel = model ?? liveConfig.ollama.model;

    const isOpenAI = resolvedModel && (
      resolvedModel.startsWith('gpt-') ||
      resolvedModel.startsWith('o1') ||
      resolvedModel.startsWith('o3') ||
      resolvedModel.startsWith('o4')
    );
    const isGroq = resolvedModel && (
      resolvedModel.startsWith('llama-') ||
      resolvedModel.startsWith('llama3-') ||
      resolvedModel.startsWith('deepseek-') ||
      resolvedModel.startsWith('gemma2-') ||
      resolvedModel.startsWith('groq/') ||
      resolvedModel.includes('/') ||
      resolvedModel.startsWith('allam-')
    );

    const matchingCustom = (liveConfig.customProviders || []).find(p => Array.isArray(p.models) && p.models.includes(resolvedModel));

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

    let llmClient;
    if (matchingCustom) {
      llmClient = new OpenAI({
        baseURL: matchingCustom.baseURL,
        apiKey: matchingCustom.apiKey || 'custom',
        defaultHeaders: {
          'User-Agent': 'Claude-Desktop/0.7.6',
        }
      });
    } else if (isOpenAI) {
      llmClient = new OpenAI({
        apiKey: liveConfig.openai?.apiKey || process.env.OPENAI_API_KEY || '',
        baseURL: liveConfig.openai?.baseURL || 'https://api.openai.com/v1',
      });
    } else if (isGroq) {
      llmClient = new OpenAI({
        baseURL: liveConfig.groq?.baseURL || 'https://api.groq.com/openai/v1',
        apiKey: liveConfig.groq?.apiKey || process.env.GROQ_API_KEY || '',
      });
    } else {
      llmClient = new OpenAI({
        baseURL: liveConfig.ollama.baseURL,
        apiKey: liveConfig.ollama.apiKey,
      });
    }

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
    let { path } = req.query;
    if (!path) return res.status(400).json({ error: 'Path parameter is required' });

    const { rows } = await getPool().query('SELECT 1 FROM sessions WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });

    if (typeof path !== 'string' || path.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const cleanPath = path.replace(/^\/?workspace\/?/, '').replace(/^\//, '');
    const absPath = `/workspace/${cleanPath}`;
    const result = await readFile({ path: absPath });
    if (result.exitCode !== 0) {
      return res.status(404).json({ error: result.stderr || 'File not found or failed to read' });
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


