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
import { getEnvSettings, setEnvSetting, query } from '../db.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOT_ENV_PATH = path.resolve(__dirname, '../../.env');

// Keys whose values should be masked in GET responses
const SECRET_KEYS = new Set([
  'GROQ_API_KEY', 'OPENAI_API_KEY', 'CLOAKBROWSER_API_KEY',
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

export default router;
