-- =============================================================================
--  OpenManus PostgreSQL Schema
--  Run:  psql -U postgres -d openmanus -f schema.sql
-- =============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
--  SESSIONS
--  Stores one row per user task / conversation.
--  The `history` column is a JSONB array of {role, content} message objects —
--  the full context window that is fed back to the LLM on every turn.
--  The `logs` column accumulates tool-call results (stdout, errors, etc.).
-- =============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at    TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL    DEFAULT NOW(),

    -- High-level goal the user submitted for this session
    goal          TEXT        NOT NULL,

    -- "pending" | "running" | "done" | "failed"
    status        TEXT        NOT NULL    DEFAULT 'pending',

    -- Full message history: [{role:"user"|"assistant"|"tool", content:"..."}]
    history       JSONB       NOT NULL    DEFAULT '[]'::jsonb,

    -- Append-only log of every tool invocation and its result
    logs          JSONB       NOT NULL    DEFAULT '[]'::jsonb,

    -- Final answer produced by the agent when status = "done"
    result        TEXT
);

-- Keep updated_at in sync automatically
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX IF NOT EXISTS sessions_status_idx ON sessions (status);
CREATE INDEX IF NOT EXISTS sessions_created_at_idx ON sessions (created_at DESC);

-- =============================================================================
--  SKILLS
--  Reusable, named workflows the agent can fetch and execute dynamically.
--  `payload` is a JSONB object containing:
--    {
--      description: string,          // what the skill does
--      steps: [                       // ordered list of tool invocations
--        { tool: "docker" | "browser" | "llm", params: { ... } }
--      ],
--      example_input:  string,        // optional
--      example_output: string         // optional
--    }
-- =============================================================================
CREATE TABLE IF NOT EXISTS skills (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at    TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL    DEFAULT NOW(),

    -- Human-readable identifier the LLM uses to look up a skill
    name          TEXT        NOT NULL UNIQUE,

    -- Short one-liner shown to the LLM during tool selection
    description   TEXT        NOT NULL,

    -- Full structured workflow definition
    payload       JSONB       NOT NULL,

    -- How many times this skill has been successfully invoked
    usage_count   INTEGER     NOT NULL    DEFAULT 0,

    -- Tags for fuzzy search (e.g. ["web", "scraping", "python"])
    tags          TEXT[]      NOT NULL    DEFAULT '{}'
);

CREATE OR REPLACE TRIGGER skills_updated_at
    BEFORE UPDATE ON skills
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX IF NOT EXISTS skills_name_idx  ON skills (name);
CREATE INDEX IF NOT EXISTS skills_tags_idx  ON skills USING GIN (tags);
CREATE INDEX IF NOT EXISTS skills_usage_idx ON skills (usage_count DESC);

-- =============================================================================
--  Seed: built-in skills the agent ships with
-- =============================================================================
-- =============================================================================
--  MEM0 MULTI-TIER MEMORIES & KNOWLEDGE GRAPH
-- =============================================================================
CREATE TABLE IF NOT EXISTS memories (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at    TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
    content       TEXT        NOT NULL,
    type          TEXT        NOT NULL    DEFAULT 'factual', -- 'factual' | 'episodic' | 'context' | 'long_term' | 'graph'
    entities      JSONB       NOT NULL    DEFAULT '[]'::jsonb,
    metadata      JSONB       NOT NULL    DEFAULT '{}'::jsonb,
    session_id    UUID        REFERENCES sessions(id) ON DELETE CASCADE,
    agent_id      TEXT
);

CREATE INDEX IF NOT EXISTS memories_type_idx ON memories (type);
CREATE INDEX IF NOT EXISTS memories_session_idx ON memories (session_id);

CREATE TABLE IF NOT EXISTS memory_nodes (
    id          TEXT        PRIMARY KEY,
    name        TEXT        NOT NULL,
    label       TEXT        NOT NULL DEFAULT 'Entity',
    properties  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memory_edges (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id     TEXT        NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
    target_id     TEXT        NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
    relation_type TEXT        NOT NULL,
    properties    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    weight        REAL        NOT NULL DEFAULT 1.0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS memory_edges_source_idx ON memory_edges(source_id);
CREATE INDEX IF NOT EXISTS memory_edges_target_idx ON memory_edges(target_id);
CREATE INDEX IF NOT EXISTS memory_edges_relation_idx ON memory_edges(relation_type);

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

CREATE INDEX IF NOT EXISTS memory_episodes_session_idx ON memory_episodes(session_id);

INSERT INTO skills (name, description, payload, tags) VALUES
(
    'run_python',
    'Execute an arbitrary Python 3 script inside a Docker sandbox and return stdout/stderr.',
    '{
        "description": "Spin up an ephemeral Python 3 Docker container, run the supplied script, capture output, and destroy the container.",
        "steps": [
            { "tool": "docker", "params": { "image": "python:3.12-slim", "lang": "python" } }
        ]
    }'::jsonb,
    ARRAY['python', 'sandbox', 'execution']
),
(
    'run_node',
    'Execute an arbitrary Node.js script inside a Docker sandbox and return stdout/stderr.',
    '{
        "description": "Spin up an ephemeral Node 22 Docker container, run the supplied script, capture output, and destroy the container.",
        "steps": [
            { "tool": "docker", "params": { "image": "node:22-slim", "lang": "javascript" } }
        ]
    }'::jsonb,
    ARRAY['node', 'javascript', 'sandbox', 'execution']
),
(
    'browse_and_extract',
    'Navigate to a URL with CloakBrowser and extract the visible page text.',
    '{
        "description": "Open a URL in a headless browser session, wait for the page to load, and return the full DOM text content.",
        "steps": [
            { "tool": "browser", "params": { "action": "navigate_and_extract" } }
        ]
    }'::jsonb,
    ARRAY['browser', 'web', 'scraping', 'extraction']
)
ON CONFLICT (name) DO NOTHING;
