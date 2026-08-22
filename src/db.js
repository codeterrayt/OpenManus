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
        updated_at  TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
        content     TEXT        NOT NULL,
        type        TEXT        NOT NULL    DEFAULT 'factual',
        entities    JSONB       NOT NULL    DEFAULT '[]'::jsonb,
        metadata    JSONB       NOT NULL    DEFAULT '{}'::jsonb,
        session_id  UUID        REFERENCES sessions(id) ON DELETE CASCADE,
        agent_id    TEXT
      );
    `);
    await query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'factual';`).catch(() => {});
    await query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS entities JSONB NOT NULL DEFAULT '[]'::jsonb;`).catch(() => {});
    await query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;`).catch(() => {});
    await query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS agent_id TEXT;`).catch(() => {});
    await query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`).catch(() => {});
    await query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES sessions(id) ON DELETE CASCADE;`).catch(() => {});
    await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS system_prompt TEXT;`).catch(() => {});
    await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS title TEXT;`).catch(() => {});

    // ── Knowledge Graph Fallback Tables (Entity-Relation Property Graph) ──────
    await query(`
      CREATE TABLE IF NOT EXISTS memory_nodes (
        id          TEXT        PRIMARY KEY,
        name        TEXT        NOT NULL,
        label       TEXT        NOT NULL DEFAULT 'Entity',
        properties  JSONB       NOT NULL DEFAULT '{}'::jsonb,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS memory_edges (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        source_id     TEXT        NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
        target_id     TEXT        NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
        relation_type TEXT        NOT NULL,
        properties    JSONB       NOT NULL DEFAULT '{}'::jsonb,
        weight        REAL        NOT NULL DEFAULT 1.0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS memory_edges_source_idx ON memory_edges(source_id);`).catch(() => {});
    await query(`CREATE INDEX IF NOT EXISTS memory_edges_target_idx ON memory_edges(target_id);`).catch(() => {});
    await query(`CREATE INDEX IF NOT EXISTS memory_edges_relation_idx ON memory_edges(relation_type);`).catch(() => {});

    // ── Episodic Memory Table ────────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS memory_episodes (
        id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id      UUID        REFERENCES sessions(id) ON DELETE SET NULL,
        goal            TEXT        NOT NULL,
        outcome         TEXT        NOT NULL DEFAULT 'success',
        key_actions     JSONB       NOT NULL DEFAULT '[]'::jsonb,
        lessons_learned TEXT,
        metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS memory_episodes_session_idx ON memory_episodes(session_id);`).catch(() => {});

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
      ['NEO4J_ENABLED',           'true'],
      ['NEO4J_URL',               'bolt://localhost:7687'],
      ['NEO4J_USER',              'neo4j'],
      ['NEO4J_PASSWORD',          'openmanus_password'],
      ['AUTO_SUMMARIZE',          'true'],
      ['MAX_HISTORY_TURNS',       '10'],
      ['SUMMARY_STRATEGY',        'rolling_summary'],
      ['KEEP_RECENT_TURNS',       '6'],
      ['SUMMARY_THRESHOLD',       '40000'],
      ['MAX_STEPS',               '100'],
      ['MAX_TOOL_RESULT_CHARS',   '3000'],
      ['CLOAKBROWSER_API_URL',    'http://localhost:9000'],
      ['CUSTOM_PROVIDERS',        '[]'],
    ];

    for (const [key, value] of defaults) {
      await query(
        `INSERT INTO env_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [key, value]
      );
    }

    console.log('[DB] Mem0 Multi-Tier Memory tables & Knowledge Graph schema initialized.');
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

