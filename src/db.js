// src/db.js
// PostgreSQL connection pool — shared across the entire process.

import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

let _pool = null;

/**
 * Returns the singleton connection pool.
 * Creates it on first call.
 * @returns {pg.Pool}
 */
export function getPool() {
  if (!_pool) {
    _pool = new Pool({
      host:     config.postgres.host,
      port:     config.postgres.port,
      database: config.postgres.database,
      user:     config.postgres.user,
      password: config.postgres.password,
    });

    _pool.on('error', (err) => {
      console.error('[DB] Unexpected pool error:', err.message);
    });
  }
  return _pool;
}

/**
 * Convenience wrapper — runs a single query and returns rows.
 * @param {string} sql
 * @param {any[]}  params
 * @returns {Promise<any[]>}
 */
export async function query(sql, params = []) {
  const pool = getPool();
  const result = await pool.query(sql, params);
  return result.rows;
}

/**
 * Gracefully closes the pool.
 */
export async function closePool() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/**
 * Ensures required database tables exist.
 */
export async function initDb() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        goal        TEXT        NOT NULL,
        status      TEXT        NOT NULL DEFAULT 'running',
        history     JSONB       NOT NULL DEFAULT '[]',
        logs        JSONB       NOT NULL DEFAULT '[]',
        result      TEXT,
        system_prompt TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `).catch(() => {}); // ignore if already exists

    await query(`
      CREATE TABLE IF NOT EXISTS memories (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at  TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
        content     TEXT        NOT NULL,
        session_id  UUID        REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);
    await query(`
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES sessions(id) ON DELETE CASCADE;
    `).catch(() => {});
    await query(`
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS system_prompt TEXT;
    `).catch(() => {});

    // ── env_settings table ────────────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS env_settings (
        key        TEXT        PRIMARY KEY,
        value      TEXT        NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Insert defaults (only if the key doesn't already exist)
    const defaults = [
      ['ENV_SOURCE',              'env'],
      ['OLLAMA_ENABLED',          'true'],
      ['OLLAMA_BASE_URL',         'http://localhost:11434/v1'],
      ['OLLAMA_MODEL',            'qwen2.5:7b'],
      ['GROQ_ENABLED',            'false'],
      ['GROQ_API_KEY',            ''],
      ['GROQ_BASE_URL',           'https://api.groq.com/openai/v1'],
      ['OPENAI_ENABLED',          'false'],
      ['OPENAI_API_KEY',          ''],
      ['OPENAI_BASE_URL',         'https://api.openai.com/v1'],
      ['MAX_STEPS',               '100'],
      ['MAX_TOOL_RESULT_CHARS',   '3000'],
      ['CLOAKBROWSER_API_URL',    'http://localhost:9000'],
    ];

    for (const [key, value] of defaults) {
      await query(
        `INSERT INTO env_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [key, value]
      );
    }

    console.log('[DB] Memories table checked/created.');
    console.log('[DB] env_settings table checked/created.');
  } catch (err) {
    console.error('[DB] Failed to initialize database tables:', err.message);
  }
}

/**
 * Returns all env_settings rows as a plain { key: value } map.
 * @returns {Promise<Record<string, string>>}
 */
export async function getEnvSettings() {
  const rows = await query(`SELECT key, value FROM env_settings`);
  const map = {};
  for (const row of rows) map[row.key] = row.value;
  return map;
}

/**
 * Upserts a single key in env_settings.
 * @param {string} key
 * @param {string} value
 */
export async function setEnvSetting(key, value) {
  await query(
    `INSERT INTO env_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, String(value ?? '')]
  );
}

