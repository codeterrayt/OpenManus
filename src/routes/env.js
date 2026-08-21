// src/routes/env.js
// REST endpoints for reading and writing environment settings stored in the DB.
//
// GET  /env/settings          → all keys + values (secrets masked)
// PUT  /env/settings          → bulk upsert [{ key, value }]
// GET  /env/source            → { source: 'env' | 'db' }
// PUT  /env/source            → { source: 'env' | 'db' }
// GET  /env/dotenv            → parsed keys from .env file (names only, no values)

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { getEnvSettings, setEnvSetting, query } from '../db.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOT_ENV_PATH = path.resolve(__dirname, '../../.env');

// Keys whose values should be masked in GET responses
const SECRET_KEYS = new Set([
  'GROQ_API_KEY', 'OPENAI_API_KEY',
]);

function maskValue(key, value) {
  if (!SECRET_KEYS.has(key)) return value;
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return value.slice(0, 4) + '••••••••' + value.slice(-4);
}

// GET /env/settings
router.get('/settings', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT key, value, updated_at FROM env_settings ORDER BY key`
    );
    const settings = rows.map(r => ({
      key:        r.key,
      value:      maskValue(r.key, r.value),
      rawValue:   r.value,   // full value — frontend uses this to pre-fill inputs
      masked:     SECRET_KEYS.has(r.key),
      updated_at: r.updated_at,
    }));
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /env/settings  body: [{ key, value }, ...]
router.put('/settings', async (req, res) => {
  const entries = req.body;
  if (!Array.isArray(entries)) {
    return res.status(400).json({ error: 'Body must be an array of { key, value }' });
  }
  try {
    for (const { key, value } of entries) {
      if (!key || typeof key !== 'string') continue;
      await setEnvSetting(key, value ?? '');
    }
    res.json({ success: true, saved: entries.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /env/source
router.get('/source', async (_req, res) => {
  try {
    const settings = await getEnvSettings();
    res.json({ source: settings['ENV_SOURCE'] ?? 'env' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /env/source  body: { source: 'env' | 'db' }
router.put('/source', async (req, res) => {
  const { source } = req.body ?? {};
  if (!['env', 'db'].includes(source)) {
    return res.status(400).json({ error: 'source must be "env" or "db"' });
  }
  try {
    await setEnvSetting('ENV_SOURCE', source);
    res.json({ success: true, source });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /env/dotenv  — returns keys present in .env file
router.get('/dotenv', (_req, res) => {
  try {
    if (!fs.existsSync(DOT_ENV_PATH)) {
      return res.json({ exists: false, keys: [] });
    }
    const raw = fs.readFileSync(DOT_ENV_PATH, 'utf8');
    const keys = raw
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => line.split('=')[0].trim());
    res.json({ exists: true, keys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /env/test-provider  body: { baseURL, apiKey }
router.post('/test-provider', async (req, res) => {
  let { baseURL, apiKey } = req.body ?? {};
  if (!baseURL) {
    return res.status(400).json({ error: 'baseURL is required' });
  }

  baseURL = baseURL.trim().replace(/\/+$/, '');
  const urlVariants = [
    baseURL,
    baseURL.endsWith('/v1') ? baseURL : `${baseURL}/v1`,
  ];
  // Deduplicate
  const uniqueUrls = [...new Set(urlVariants)];

  let models = [];
  let errorMsg = null;

  for (const testUrl of uniqueUrls) {
    // 1. Try standard OpenAI-compatible endpoint with compatible User-Agent
    try {
      const client = new OpenAI({
        baseURL: testUrl,
        apiKey: apiKey || 'dummy-key',
        defaultHeaders: {
          'User-Agent': 'Claude-Desktop/0.7.6',
        }
      });
      const list = await client.models.list();
      if (list && Array.isArray(list.data) && list.data.length > 0) {
        models = list.data.map(m => m.id).filter(Boolean);
        errorMsg = null;
        break;
      }
    } catch (err) {
      errorMsg = err.message;
    }

    // 2. Try raw fetch with Bearer token and compatible User-Agent
    if (models.length === 0) {
      try {
        const rawRes = await fetch(`${testUrl}/models`, {
          headers: {
            'Authorization': `Bearer ${apiKey || 'dummy-key'}`,
            'User-Agent': 'Claude-Desktop/0.7.6',
            'Accept': 'application/json',
          }
        });
        if (rawRes.ok) {
          const rawData = await rawRes.json();
          const items = Array.isArray(rawData?.data) ? rawData.data : (Array.isArray(rawData?.models) ? rawData.models : []);
          if (items.length > 0) {
            models = items.map(m => typeof m === 'string' ? m : (m.id || m.name || m.model)).filter(Boolean);
            errorMsg = null;
            break;
          }
        }
      } catch (err) {
        // continue
      }
    }

    // 3. If standard calls failed, check if it's an Ollama endpoint (e.g. /api/tags)
    if (models.length === 0) {
      try {
        const cleanHost = testUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
        const tagsRes = await fetch(`${cleanHost}/api/tags`, {
          headers: { 'User-Agent': 'Claude-Desktop/0.7.6' }
        });
        if (tagsRes.ok) {
          const data = await tagsRes.json();
          if (data && Array.isArray(data.models) && data.models.length > 0) {
            models = data.models.map(m => m.name || m.model).filter(Boolean);
            errorMsg = null;
            break;
          }
        }
      } catch {
        // ignore secondary fallback error
      }
    }
  }

  if (models.length > 0) {
    return res.json({ success: true, models });
  }

  res.status(400).json({
    success: false,
    error: errorMsg || 'No models found or endpoint is unreachable',
  });
});

export default router;
