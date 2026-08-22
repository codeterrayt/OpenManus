// src/memory/mem0.js
// Mem0 Multi-Tier Memory Engine for OpenManus
// Supports Factual, Episodic, Context, Long-term, and Knowledge Graph (Neo4j + PostgreSQL Fallback)

import neo4j from 'neo4j-driver';
import { query, getEnvSettings } from '../db.js';

let _neo4jDriver = null;
let _neo4jTested = false;
let _neo4jAvailable = false;

/**
 * Returns active Neo4j driver or null if unavailable.
 */
async function getNeo4jDriver() {
  const settings = await getEnvSettings().catch(() => ({}));
  const enabled = (settings['NEO4J_ENABLED'] ?? process.env.NEO4J_ENABLED) !== 'false';
  if (!enabled) return null;

  const url      = settings['NEO4J_URL']      || process.env.NEO4J_URL      || 'bolt://localhost:7687';
  const user     = settings['NEO4J_USER']     || process.env.NEO4J_USER     || 'neo4j';
  const password = settings['NEO4J_PASSWORD'] || process.env.NEO4J_PASSWORD || 'openmanus_password';

  if (!_neo4jDriver) {
    try {
      _neo4jDriver = neo4j.driver(url, neo4j.auth.basic(user, password), {
        maxConnectionLifetime: 3 * 60 * 60 * 1000,
        maxConnectionPoolSize: 50,
        connectionAcquisitionTimeout: 2000,
      });
    } catch (err) {
      console.warn('[Mem0] Failed to instantiate Neo4j driver:', err.message);
      return null;
    }
  }

  if (!_neo4jTested) {
    try {
      await _neo4jDriver.verifyConnectivity();
      _neo4jAvailable = true;
      _neo4jTested = true;
      console.log('[Mem0] Connected to Neo4j Graph Database at', url);
    } catch (connErr) {
      _neo4jAvailable = false;
      _neo4jTested = true;
      console.log(`[Mem0] Neo4j offline (${connErr.message}), using PostgreSQL Knowledge Graph fallback.`);
    }
  }

  return _neo4jAvailable ? _neo4jDriver : null;
}

/**
 * Normalizes entity name to safe ID
 */
function sanitizeId(str) {
  return String(str || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 80);
}

/**
 * Extracts entity-relation-entity triples from text using semantic patterns
 */
export function extractTriples(text) {
  if (!text || typeof text !== 'string') return [];
  const triples = [];
  const lines = text.split(/\n|\./);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 5) continue;

    // Pattern: User prefers / likes / wants X
    let m = trimmed.match(/(?:user|i)\s+(?:prefers?|likes?|uses?|wants?|loves?)\s+([a-zA-Z0-9_.-]+)/i);
    if (m && m[1]) {
      triples.push({
        source: { name: 'User', label: 'User' },
        relation: 'PREFERS',
        target: { name: m[1].trim(), label: 'Preference' }
      });
    }

    // Pattern: Project / System uses / requires / built with X
    m = trimmed.match(/(?:project|system|app|service|tool|agent)\s+(?:uses?|requires?|built with|runs on)\s+([a-zA-Z0-9_.-]+)/i);
    if (m && m[1]) {
      triples.push({
        source: { name: 'Project', label: 'Project' },
        relation: 'USES',
        target: { name: m[1].trim(), label: 'Technology' }
      });
    }

    // Pattern: Key / Token / Secret for X is Y
    m = trimmed.match(/(?:api key|token|url|endpoint|port|password)\s+(?:for|of)\s+([a-zA-Z0-9_.-]+)/i);
    if (m && m[1]) {
      triples.push({
        source: { name: m[1].trim(), label: 'Service' },
        relation: 'HAS_CONFIG',
        target: { name: 'Config', label: 'Configuration' }
      });
    }

    // Pattern: X depends on Y
    m = trimmed.match(/([a-zA-Z0-9_.-]+)\s+(?:depends on|relies on)\s+([a-zA-Z0-9_.-]+)/i);
    if (m && m[1] && m[2]) {
      triples.push({
        source: { name: m[1].trim(), label: 'Component' },
        relation: 'DEPENDS_ON',
        target: { name: m[2].trim(), label: 'Dependency' }
      });
    }
  }

  return triples;
}

/**
 * Upserts graph triples into Neo4j (if active) and PostgreSQL Graph fallback.
 */
export async function saveTriples(triples) {
  if (!Array.isArray(triples) || triples.length === 0) return;

  const neo4jDriver = await getNeo4jDriver().catch(() => null);

  for (const t of triples) {
    const sName = String(t.source.name || 'Entity').trim();
    const sLabel = String(t.source.label || 'Entity').trim();
    const sId = sanitizeId(sName);

    const tName = String(t.target.name || 'Entity').trim();
    const tLabel = String(t.target.label || 'Entity').trim();
    const tId = sanitizeId(tName);

    const rel = String(t.relation || 'RELATES_TO').toUpperCase().replace(/[^A-Z0-9_]/g, '_');

    // 1. Save to PostgreSQL fallback
    try {
      await query(
        `INSERT INTO memory_nodes (id, name, label, updated_at) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (id) DO UPDATE SET name = $2, label = $3, updated_at = NOW()`,
        [sId, sName, sLabel]
      );
      await query(
        `INSERT INTO memory_nodes (id, name, label, updated_at) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (id) DO UPDATE SET name = $2, label = $3, updated_at = NOW()`,
        [tId, tName, tLabel]
      );
      await query(
        `INSERT INTO memory_edges (source_id, target_id, relation_type)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [sId, tId, rel]
      );
    } catch (pgErr) {
      console.warn('[Mem0] PG Graph upsert error:', pgErr.message);
    }

    // 2. Save to Neo4j if available
    if (neo4jDriver) {
      const session = neo4jDriver.session();
      try {
        await session.run(
          `MERGE (s:Entity {id: $sId})
           ON CREATE SET s.name = $sName, s.label = $sLabel, s.createdAt = datetime()
           ON MATCH SET s.name = $sName, s.label = $sLabel, s.updatedAt = datetime()
           MERGE (t:Entity {id: $tId})
           ON CREATE SET t.name = $tName, t.label = $tLabel, t.createdAt = datetime()
           ON MATCH SET t.name = $tName, t.label = $tLabel, t.updatedAt = datetime()
           MERGE (s)-[r:` + rel + `]->(t)
           ON CREATE SET r.createdAt = datetime(), r.weight = 1.0`,
          { sId, sName, sLabel, tId, tName, tLabel }
        );
      } catch (nErr) {
        console.warn('[Mem0] Neo4j Cypher write error:', nErr.message);
      } finally {
        await session.close().catch(() => {});
      }
    }
  }
}

/**
 * Returns full graph structure { nodes: [...], edges: [...] } for UI visualization.
 */
export async function getGraphData() {
  const neo4jDriver = await getNeo4jDriver().catch(() => null);

  if (neo4jDriver) {
    const session = neo4jDriver.session();
    try {
      const result = await session.run(
        `MATCH (n:Entity)
         OPTIONAL MATCH (n)-[r]->(m:Entity)
         RETURN n, r, m LIMIT 200`
      );
      const nodeMap = new Map();
      const edgeList = [];

      for (const record of result.records) {
        const n = record.get('n');
        if (n && n.properties?.id && !nodeMap.has(n.properties.id)) {
          nodeMap.set(n.properties.id, {
            id: n.properties.id,
            name: n.properties.name || n.properties.id,
            label: n.properties.label || 'Entity'
          });
        }
        const m = record.get('m');
        if (m && m.properties?.id && !nodeMap.has(m.properties.id)) {
          nodeMap.set(m.properties.id, {
            id: m.properties.id,
            name: m.properties.name || m.properties.id,
            label: m.properties.label || 'Entity'
          });
        }
        const r = record.get('r');
        if (r && n && m && n.properties?.id && m.properties?.id) {
          edgeList.push({
            id: r.identity?.toString() || `${n.properties.id}_${r.type}_${m.properties.id}`,
            source: n.properties.id,
            target: m.properties.id,
            relation: r.type,
            weight: r.properties?.weight || 1.0
          });
        }
      }

      if (nodeMap.size > 0) {
        return {
          provider: 'neo4j',
          nodes: Array.from(nodeMap.values()),
          edges: edgeList
        };
      }
    } catch (nErr) {
      console.warn('[Mem0] Neo4j query error, falling back to PG Graph:', nErr.message);
    } finally {
      await session.close().catch(() => {});
    }
  }

  // PostgreSQL fallback
  const nodes = await query(`SELECT id, name, label, properties FROM memory_nodes ORDER BY updated_at DESC LIMIT 200`);
  const edges = await query(`SELECT id, source_id AS source, target_id AS target, relation_type AS relation, weight FROM memory_edges LIMIT 300`);

  return {
    provider: 'postgresql',
    nodes: nodes.map(n => ({ id: n.id, name: n.name, label: n.label })),
    edges: edges.map(e => ({ id: String(e.id), source: e.source, target: e.target, relation: e.relation, weight: e.weight }))
  };
}

/**
 * Queries connected graph relationships for given keywords.
 */
export async function queryGraphRelations(keywords) {
  if (!keywords || keywords.length === 0) return [];
  const neo4jDriver = await getNeo4jDriver().catch(() => null);

  const cleanKeywords = (Array.isArray(keywords) ? keywords : [keywords])
    .map(k => String(k).trim().toLowerCase())
    .filter(k => k.length >= 2);

  if (cleanKeywords.length === 0) return [];

  if (neo4jDriver) {
    const session = neo4jDriver.session();
    try {
      const result = await session.run(
        `MATCH (s:Entity)-[r]->(t:Entity)
         WHERE any(k IN $keywords WHERE toLower(s.name) CONTAINS k OR toLower(t.name) CONTAINS k OR toLower(type(r)) CONTAINS k)
         RETURN s.name AS source, type(r) AS relation, t.name AS target
         LIMIT 25`,
        { keywords: cleanKeywords }
      );
      return result.records.map(rec => ({
        source: rec.get('source'),
        relation: rec.get('relation'),
        target: rec.get('target')
      }));
    } catch (nErr) {
      console.warn('[Mem0] Neo4j relation query error:', nErr.message);
    } finally {
      await session.close().catch(() => {});
    }
  }

  // PG Fallback
  const conditions = cleanKeywords.map((_, i) => `(LOWER(sn.name) LIKE $${i + 1} OR LOWER(tn.name) LIKE $${i + 1} OR LOWER(e.relation_type) LIKE $${i + 1})`).join(' OR ');
  const params = cleanKeywords.map(k => '%' + k + '%');

  const rows = await query(
    `SELECT sn.name AS source, e.relation_type AS relation, tn.name AS target
     FROM memory_edges e
     JOIN memory_nodes sn ON e.source_id = sn.id
     JOIN memory_nodes tn ON e.target_id = tn.id
     WHERE ${conditions}
     LIMIT 25`,
    params
  ).catch(() => []);

  return rows;
}

/**
 * ─── Multi-Tier Memory API ───────────────────────────────────────────────────
 */

/**
 * Adds a memory (factual, episodic, context, long_term).
 */
export async function addMemory(content, type = 'factual', metadata = {}, sessionId = null, agentId = null) {
  if (!content || !content.trim()) return null;
  const cleanContent = content.trim();
  const triples = extractTriples(cleanContent);
  const entities = Array.from(new Set(triples.flatMap(t => [t.source.name, t.target.name])));

  const rows = await query(
    `INSERT INTO memories (content, type, entities, metadata, session_id, agent_id, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, NOW())
     RETURNING *`,
    [cleanContent, type, JSON.stringify(entities), JSON.stringify(metadata), sessionId, agentId]
  );

  if (triples.length > 0) {
    await saveTriples(triples).catch(e => console.warn('[Mem0] Triple save error:', e.message));
  }

  return rows[0];
}

/**
 * Adds a factual memory (user preferences, configurations, domain facts).
 */
export async function addFactualMemory(content, metadata = {}, sessionId = null, agentId = null) {
  return addMemory(content, 'factual', metadata, sessionId, agentId);
}

/**
 * Adds an episodic memory (past task outcomes, solutions, key lessons).
 */
export async function addEpisodicMemory(goal, outcome, keyActions = [], lessonsLearned = '', sessionId = null, metadata = {}) {
  const cleanGoal = (goal || '').trim();
  const content = `Task Episode: "${cleanGoal}" | Outcome: ${outcome.toUpperCase()}\nActions: ${Array.isArray(keyActions) ? keyActions.join(', ') : keyActions}\nLessons Learned: ${lessonsLearned}`;

  const triples = extractTriples(content);
  triples.push({
    source: { name: cleanGoal.slice(0, 40), label: 'Task' },
    relation: outcome === 'success' ? 'RESOLVED_WITH' : 'FAILED_AT',
    target: { name: (lessonsLearned || 'Execution').slice(0, 40), label: 'Lesson' }
  });

  const entities = Array.from(new Set(triples.flatMap(t => [t.source.name, t.target.name])));

  const epRows = await query(
    `INSERT INTO memory_episodes (session_id, goal, outcome, key_actions, lessons_learned, metadata)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb)
     RETURNING *`,
    [sessionId, cleanGoal, outcome, JSON.stringify(keyActions), lessonsLearned, JSON.stringify(metadata)]
  );

  const memRows = await query(
    `INSERT INTO memories (content, type, entities, metadata, session_id, updated_at)
     VALUES ($1, 'episodic', $2::jsonb, $3::jsonb, $4, NOW())
     RETURNING *`,
    [content, JSON.stringify(entities), JSON.stringify({ ...metadata, episode_id: epRows[0]?.id }), sessionId]
  );

  await saveTriples(triples).catch(e => console.warn('[Mem0] Episode triple save error:', e.message));

  return memRows[0];
}

/**
 * Searches across multi-tier memories with type filtering and search query.
 */
export async function searchMemories({ type = 'all', sessionId = null, queryText = '', limit = 50 } = {}) {
  const conditions = [];
  const params = [];

  if (type && type !== 'all') {
    params.push(type);
    conditions.push(`type = $${params.length}`);
  }

  if (sessionId) {
    params.push(sessionId);
    conditions.push(`(session_id IS NULL OR session_id = $${params.length})`);
  }

  if (queryText && queryText.trim()) {
    params.push('%' + queryText.trim().toLowerCase() + '%');
    conditions.push(`(LOWER(content) LIKE $${params.length} OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(entities) e WHERE LOWER(e) LIKE $${params.length}))`);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(Math.max(1, Math.min(100, limit)));
  const limitClause = `LIMIT $${params.length}`;

  const rows = await query(
    `SELECT * FROM memories ${whereClause} ORDER BY created_at DESC ${limitClause}`,
    params
  );
  return rows;
}

/**
 * Retrieves multi-tier context formatted for the Agent prompt.
 */
export async function retrieveAgentContext(goal, sessionId = null) {
  try {
    // 1. Fetch factual memories
    const factuals = await query(
      `SELECT content FROM memories WHERE type = 'factual' AND (session_id IS NULL OR session_id = $1) ORDER BY created_at ASC LIMIT 15`,
      [sessionId]
    );

    // 2. Fetch past relevant episodes
    const episodes = await query(
      `SELECT goal, outcome, lessons_learned FROM memory_episodes ORDER BY created_at DESC LIMIT 5`
    );

    // 3. Extract keywords from goal and query graph relations
    const keywords = (goal || '').split(/\s+/).filter(w => w.length > 3).slice(0, 6);
    const relations = await queryGraphRelations(keywords);

    let context = '';

    if (factuals.length > 0) {
      context += `\n\n### MEM0 FACTUAL KNOWLEDGE (GLOBAL PREFERENCES & FACTS)\n`;
      context += factuals.map((f, i) => `${i + 1}. ${f.content}`).join('\n');
    }

    if (episodes.length > 0) {
      context += `\n\n### MEM0 EPISODIC EXPERIENCES & PAST LESSONS\n`;
      context += episodes.map(e => `- Task: "${e.goal}" -> Outcome: ${e.outcome.toUpperCase()}\n  Lesson: ${e.lessons_learned || 'Completed successfully.'}`).join('\n');
    }

    if (relations.length > 0) {
      context += `\n\n### MEM0 KNOWLEDGE GRAPH RELATIONS\n`;
      context += relations.map(r => `- (${r.source})-[ ${r.relation} ]->(${r.target})`).join('\n');
    }

    return context;
  } catch (err) {
    console.warn('[Mem0] Failed to retrieve agent context:', err.message);
    return '';
  }
}

/**
 * Automatically crystallizes completed session into an episodic memory and updates graph.
 */
export async function crystallizeSessionEpisode(sessionId, goal, history = [], result = null, status = 'done') {
  if (!goal) return null;
  try {
    const outcome = status === 'done' ? 'success' : 'failure';
    const keyActions = [];

    for (const msg of history) {
      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          const fn = tc.function?.name;
          if (fn && !keyActions.includes(fn)) {
            keyActions.push(fn);
          }
        }
      }
    }

    let lesson = result ? String(result).slice(0, 200).replace(/\n+/g, ' ') : `Completed ${keyActions.length} actions.`;
    if (outcome === 'failure') {
      lesson = `Task encountered issue: ${lesson}`;
    }

    const episode = await addEpisodicMemory(goal, outcome, keyActions, lesson, sessionId);
    console.log(`[Mem0] Crystallized session episode for session ${sessionId} (outcome: ${outcome})`);
    return episode;
  } catch (err) {
    console.warn('[Mem0] Episode crystallization failed:', err.message);
    return null;
  }
}
