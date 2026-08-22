// src/memory/mem0.js
// Mem0 Multi-Tier Memory Engine for OpenManus
// Supports Factual, Episodic, Context, Long-term, and Knowledge Graph (Neo4j + PostgreSQL Fallback)

import neo4j from 'neo4j-driver';
import { query, getEnvSettings } from '../db.js';

let _neo4jDriver = null;
let _neo4jAvailable = false;
let _lastNeo4jCheck = 0;

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

  const now = Date.now();
  if (!_neo4jAvailable && (now - _lastNeo4jCheck > 5000)) {
    _lastNeo4jCheck = now;
    try {
      await _neo4jDriver.verifyConnectivity();
      _neo4jAvailable = true;
      console.log('[Mem0] Connected to Neo4j Graph Database at', url);
    } catch (connErr) {
      _neo4jAvailable = false;
      // Periodic retry every 5s
    }
  }

  return _neo4jAvailable ? _neo4jDriver : null;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates and normalizes session UUID. Returns null if invalid or not a UUID.
 */
function sanitizeSessionId(id) {
  if (!id || typeof id !== 'string') return null;
  const clean = id.trim();
  return UUID_REGEX.test(clean) ? clean : null;
}

/**
 * Normalizes entity name to safe ID
 */
function sanitizeId(str) {
  return String(str || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 80);
}

const INVALID_ENTITY_NAMES = new Set([
  'it', 'this', 'that', 'something', 'anything', 'code', 'file', 'files', 'error',
  'thing', 'things', 'line', 'lines', 'test', 'item', 'value', 'the', 'an', 'a',
  'to', 'for', 'of', 'in', 'on', 'at', 'with', 'from', 'me', 'we', 'they',
  'option', 'options', 'setting', 'settings', 'null', 'undefined', 'true', 'false',
  'information', 'details', 'check', 'answer', 'store', 'saved', 'sure'
]);

function isValidEntityName(name) {
  if (!name || typeof name !== 'string') return false;
  const clean = name.trim().toLowerCase();
  if (clean.length < 2 || clean.length > 40) return false;
  if (INVALID_ENTITY_NAMES.has(clean)) return false;
  if (/^\d+$/.test(clean)) return false;
  if (clean.includes('\n') || clean.includes('  ')) return false;
  return true;
}

/**
 * Domain & Topic Taxonomy — maps entities to their canonical category hub nodes
 * so related entities automatically connect to the same topic hub in the knowledge graph.
 */
export const ENTITY_CATEGORIES = {
  // Databases
  postgresql: { name: 'Database', label: 'Domain' },
  postgres: { name: 'Database', label: 'Domain' },
  neo4j: { name: 'Database', label: 'Domain' },
  redis: { name: 'Database', label: 'Domain' },
  mongodb: { name: 'Database', label: 'Domain' },
  mysql: { name: 'Database', label: 'Domain' },
  sqlite: { name: 'Database', label: 'Domain' },

  // Frontend
  react: { name: 'Frontend', label: 'Domain' },
  vue: { name: 'Frontend', label: 'Domain' },
  tailwind: { name: 'Frontend', label: 'Domain' },
  tailwindcss: { name: 'Frontend', label: 'Domain' },
  vite: { name: 'Frontend', label: 'Domain' },
  html: { name: 'Frontend', label: 'Domain' },
  css: { name: 'Frontend', label: 'Domain' },

  // Backend
  nodejs: { name: 'Backend', label: 'Domain' },
  node: { name: 'Backend', label: 'Domain' },
  express: { name: 'Backend', label: 'Domain' },
  fastapi: { name: 'Backend', label: 'Domain' },
  django: { name: 'Backend', label: 'Domain' },

  // Languages
  typescript: { name: 'ProgrammingLanguage', label: 'Domain' },
  javascript: { name: 'ProgrammingLanguage', label: 'Domain' },
  python: { name: 'ProgrammingLanguage', label: 'Domain' },
  rust: { name: 'ProgrammingLanguage', label: 'Domain' },
  golang: { name: 'ProgrammingLanguage', label: 'Domain' },

  // Security
  ethicalhacking: { name: 'Security', label: 'Domain' },
  ethical_hacking: { name: 'Security', label: 'Domain' },
  cybersecurity: { name: 'Security', label: 'Domain' },
  infosec: { name: 'Security', label: 'Domain' },
  pentesting: { name: 'Security', label: 'Domain' },

  // DevOps & Cloud
  docker: { name: 'DevOps', label: 'Domain' },
  kubernetes: { name: 'DevOps', label: 'Domain' },
  aws: { name: 'Cloud', label: 'Domain' },

  // Locations
  taiwan: { name: 'Location', label: 'Location' },
  japan: { name: 'Location', label: 'Location' },
  tokyo: { name: 'Location', label: 'Location' },
  usa: { name: 'Location', label: 'Location' },
  india: { name: 'Location', label: 'Location' },
  germany: { name: 'Location', label: 'Location' }
};

/**
 * Extracts high-signal semantic entity-relation triples linked to canonical hubs (User, Project, Topics).
 */
export function extractTriples(text) {
  if (!text || typeof text !== 'string') return [];
  const triples = [];
  const lines = text.split(/\n|\./);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 3) continue;

    // 1. User Name / Identity: "User's preferred name is X", "My name is X", "1. Alexandar"
    let m = trimmed.match(/(?:user(?:'s)?\s+(?:preferred\s+name|name)|user\s+is\s+(?:named|called)|my\s+name\s+is|call\s+me)\s+(?:is\s+)?([a-zA-Z0-9_.-]+)/i);
    if (m && isValidEntityName(m[1])) {
      triples.push({
        source: { name: 'User', label: 'User' },
        relation: 'NAMED',
        target: { name: m[1].trim(), label: 'Identity' }
      });
    }

    // 2. User Location: "User is in Taiwan", "based in Tokyo", "lives in Taiwan", "Location: Taiwan", "2. Taiwan"
    m = trimmed.match(/(?:user\s+(?:lives\s+in|based\s+in|located\s+in|from)|location\s*[:=]|lives\s+in|from)\s+([a-zA-Z0-9_.-]+)/i);
    if (!m && /\b(taiwan|japan|tokyo|usa|india|germany|uk|canada)\b/i.test(trimmed)) {
      const locMatch = trimmed.match(/\b(taiwan|japan|tokyo|usa|india|germany|uk|canada)\b/i);
      if (locMatch) {
        triples.push({
          source: { name: 'User', label: 'User' },
          relation: 'LOCATED_IN',
          target: { name: locMatch[1].charAt(0).toUpperCase() + locMatch[1].slice(1).toLowerCase(), label: 'Location' }
        });
      }
    } else if (m && isValidEntityName(m[1])) {
      triples.push({
        source: { name: 'User', label: 'User' },
        relation: 'LOCATED_IN',
        target: { name: m[1].trim(), label: 'Location' }
      });
    }

    // 3. User Interests & Skills: "interested in Ethical Hacking", "skilled in Python", "field is Security", "3. Ethical Hacking"
    m = trimmed.match(/(?:user\s+(?:interested\s+in|studies|works\s+on|skilled\s+in)|interest\s*[:=]|field\s*[:=]|hobby\s*[:=])\s+([a-zA-Z0-9_.-]+(?:\s+[a-zA-Z0-9_.-]+)?)/i);
    if (!m && /\b(ethical\s+hacking|cybersecurity|machine\s+learning|web\s+development|data\s+science)\b/i.test(trimmed)) {
      const skillMatch = trimmed.match(/\b(ethical\s+hacking|cybersecurity|machine\s+learning|web\s+development|data\s+science)\b/i);
      if (skillMatch) {
        const cleanSkill = skillMatch[1].split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
        triples.push({
          source: { name: 'User', label: 'User' },
          relation: 'INTERESTED_IN',
          target: { name: cleanSkill, label: 'Interest' }
        });
      }
    } else if (m && isValidEntityName(m[1])) {
      const cleanSkill = m[1].trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
      triples.push({
        source: { name: 'User', label: 'User' },
        relation: 'INTERESTED_IN',
        target: { name: cleanSkill, label: 'Interest' }
      });
    }

    // 4. User Preferences: "User prefers DarkMode", "likes TypeScript"
    m = trimmed.match(/(?:user|developer)\s+(?:prefers?|preferred|likes?|uses?|wants?|loves?)\s+([a-zA-Z0-9_.-]+)/i);
    if (m && isValidEntityName(m[1])) {
      triples.push({
        source: { name: 'User', label: 'User' },
        relation: 'PREFERS',
        target: { name: m[1].trim(), label: 'Preference' }
      });
    }

    // 5. Project Technology & Architecture: "Project uses PostgreSQL and Neo4j"
    m = trimmed.match(/(?:project|system|app|service|backend|frontend)\s+(?:uses?|requires?|built with|runs on)\s+([a-zA-Z0-9_.-]+)/i);
    if (m && isValidEntityName(m[1])) {
      triples.push({
        source: { name: 'Project', label: 'Project' },
        relation: 'USES',
        target: { name: m[1].trim(), label: 'Technology' }
      });
    }

    // Direct multi-tech matches (e.g. "PostgreSQL and Neo4j")
    const techMatches = trimmed.match(/\b(postgresql|postgres|neo4j|redis|docker|react|tailwindcss|express|nodejs|fastapi|typescript|python)\b/gi);
    if (techMatches && techMatches.length > 0) {
      for (const tech of techMatches) {
        const canonical = tech.charAt(0).toUpperCase() + tech.slice(1).toLowerCase();
        triples.push({
          source: { name: 'Project', label: 'Project' },
          relation: 'USES',
          target: { name: canonical, label: 'Technology' }
        });
      }
    }
  }

  // Deduplicate triples
  const seen = new Set();
  const uniqueTriples = [];
  for (const t of triples) {
    const key = `${sanitizeId(t.source.name)}_${t.relation}_${sanitizeId(t.target.name)}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueTriples.push(t);
    }
  }

  return uniqueTriples;
}

/**
 * Upserts graph triples into Neo4j (if active) and PostgreSQL Graph fallback.
 * Automatically adds category topic hub edges so related entities cluster around shared concepts.
 */
export async function saveTriples(triples) {
  if (!Array.isArray(triples) || triples.length === 0) return;

  const validTriples = triples.filter(t => 
    t.source && isValidEntityName(t.source.name) && 
    t.target && isValidEntityName(t.target.name)
  );
  if (validTriples.length === 0) return;

  // Add automatic taxonomy category links
  const allTriples = [...validTriples];
  for (const t of validTriples) {
    const targetKey = sanitizeId(t.target.name);
    if (ENTITY_CATEGORIES[targetKey]) {
      const cat = ENTITY_CATEGORIES[targetKey];
      allTriples.push({
        source: { name: t.target.name, label: t.target.label || 'Entity' },
        relation: 'CATEGORY',
        target: { name: cat.name, label: cat.label }
      });
    }
  }

  const neo4jDriver = await getNeo4jDriver().catch(() => null);

  for (const t of allTriples) {
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
 * Purges raw task sentences and noise nodes from PostgreSQL and Neo4j.
 */
export async function cleanupNoiseGraphNodes() {
  try {
    // 1. Clean PostgreSQL
    await query(`DELETE FROM memory_edges WHERE relation_type = 'RESOLVED_WITH' OR source_id LIKE '% %' OR target_id LIKE '% %' OR length(source_id) > 35 OR length(target_id) > 35`);
    await query(`DELETE FROM memory_nodes WHERE label IN ('Task', 'Lesson') OR id LIKE '% %' OR id LIKE '%\\n%' OR length(id) > 35`);
    
    // Remove isolated nodes without edges except core hubs
    await query(`
      DELETE FROM memory_nodes 
      WHERE id NOT IN ('user', 'project')
      AND id NOT IN (SELECT source_id FROM memory_edges UNION SELECT target_id FROM memory_edges)
    `);

    // 2. Clean Neo4j
    const neo4jDriver = await getNeo4jDriver().catch(() => null);
    if (neo4jDriver) {
      const session = neo4jDriver.session();
      try {
        await session.run(`MATCH ()-[r:RESOLVED_WITH]->() DELETE r`);
        await session.run(`MATCH (n:Entity) WHERE n.label IN ['Task', 'Lesson'] OR size(n.id) > 35 OR n.id CONTAINS ' ' OR n.id CONTAINS '\n' DETACH DELETE n`);
        await session.run(`MATCH (n:Entity) WHERE NOT (n)--() AND NOT n.id IN ['user', 'project'] DETACH DELETE n`);
      } catch (nErr) {
        console.warn('[Mem0] Neo4j cleanup error:', nErr.message);
      } finally {
        await session.close().catch(() => {});
      }
    }
    console.log('[Mem0] Cleaned up noise graph nodes and isolated 2-node task islands.');
  } catch (err) {
    console.warn('[Mem0] Graph cleanup error:', err.message);
  }
}

/**
 * Deletes a node and its attached relationships from Knowledge Graph (PostgreSQL & Neo4j).
 */
export async function deleteGraphNode(nodeId) {
  if (!nodeId) return { success: false, error: 'Node ID required' };
  const cleanId = sanitizeId(nodeId);

  // 1. Delete from PostgreSQL
  try {
    await query(`DELETE FROM memory_edges WHERE source_id = $1 OR target_id = $1`, [cleanId]);
    await query(`DELETE FROM memory_nodes WHERE id = $1`, [cleanId]);
  } catch (err) {
    console.warn('[Mem0] Failed to delete node from PG Graph:', err.message);
  }

  // 2. Delete from Neo4j
  const neo4jDriver = await getNeo4jDriver().catch(() => null);
  if (neo4jDriver) {
    const session = neo4jDriver.session();
    try {
      await session.run(
        `MATCH (n:Entity {id: $id}) DETACH DELETE n`,
        { id: cleanId }
      );
    } catch (err) {
      console.warn('[Mem0] Failed to delete node from Neo4j:', err.message);
    } finally {
      await session.close().catch(() => {});
    }
  }

  return { success: true, id: cleanId };
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

      return {
        provider: 'neo4j',
        nodes: Array.from(nodeMap.values()),
        edges: edgeList
      };
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

const STOP_WORDS = new Set([
  'what', 'is', 'the', 'my', 'your', 'and', 'or', 'for', 'about', 'tell', 'check',
  'show', 'find', 'get', 'any', 'me', 'who', 'how', 'when', 'where', 'why', 'can',
  'you', 'please', 'do', 'does', 'did', 'i', 'a', 'an', 'in', 'on', 'at', 'to', 'of',
  'memory', 'memories', 'remember', 'recall', 'stored', 'saved', 'database', 'know'
]);

/**
 * Adds a memory (factual, episodic, context, long_term) with deduplication.
 */
export async function addMemory(content, type = 'factual', metadata = {}, sessionId = null, agentId = null) {
  if (!content || !content.trim()) return null;
  const cleanContent = content.trim();
  const triples = extractTriples(cleanContent);
  const entities = Array.from(new Set(triples.flatMap(t => [t.source.name, t.target.name])));

  // Deduplicate identical content for factual/preferences
  const existing = await query(
    `SELECT id FROM memories WHERE type = $1 AND LOWER(TRIM(content)) = LOWER(TRIM($2)) LIMIT 1`,
    [type, cleanContent]
  ).catch(() => []);

  if (existing.length > 0) {
    const updated = await query(
      `UPDATE memories SET entities = $1::jsonb, metadata = $2::jsonb, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [JSON.stringify(entities), JSON.stringify(metadata), existing[0].id]
    );
    if (triples.length > 0) {
      await saveTriples(triples).catch(e => console.warn('[Mem0] Triple save error:', e.message));
    }
    return updated[0];
  }

  const cleanSessionId = sanitizeSessionId(sessionId);

  const rows = await query(
    `INSERT INTO memories (content, type, entities, metadata, session_id, agent_id, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, NOW())
     RETURNING *`,
    [cleanContent, type, JSON.stringify(entities), JSON.stringify(metadata), cleanSessionId, agentId]
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
 * Note: Does NOT pollute the Knowledge Graph with raw conversational task sentences.
 */
export async function addEpisodicMemory(goal, outcome, keyActions = [], lessonsLearned = '', sessionId = null, metadata = {}) {
  const cleanGoal = (goal || '').trim();
  const cleanSessionId = sanitizeSessionId(sessionId);
  const content = `Task Episode: "${cleanGoal}" | Outcome: ${outcome.toUpperCase()}\nActions: ${Array.isArray(keyActions) ? keyActions.join(', ') : keyActions}\nLessons Learned: ${lessonsLearned}`;

  // Only extract high-signal domain entity triples (if any exist in goal/lesson)
  const triples = extractTriples(content);
  const entities = Array.from(new Set(triples.flatMap(t => [t.source.name, t.target.name])));

  const epRows = await query(
    `INSERT INTO memory_episodes (session_id, goal, outcome, key_actions, lessons_learned, metadata)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb)
     RETURNING *`,
    [cleanSessionId, cleanGoal, outcome, JSON.stringify(keyActions), lessonsLearned, JSON.stringify(metadata)]
  );

  const memRows = await query(
    `INSERT INTO memories (content, type, entities, metadata, session_id, updated_at)
     VALUES ($1, 'episodic', $2::jsonb, $3::jsonb, $4, NOW())
     RETURNING *`,
    [content, JSON.stringify(entities), JSON.stringify({ ...metadata, episode_id: epRows[0]?.id }), cleanSessionId]
  );

  if (triples.length > 0) {
    await saveTriples(triples).catch(e => console.warn('[Mem0] Episode triple save error:', e.message));
  }

  return memRows[0];
}

/**
 * Searches across multi-tier memories with tokenized matching and global factual access.
 */
export async function searchMemories({ type = 'all', sessionId = null, queryText = '', limit = 50 } = {}) {
  const conditions = [];
  const params = [];

  if (type && type !== 'all') {
    params.push(type);
    conditions.push(`type = $${params.length}`);
  }

  // Factual and episodic memories are global; only context memories are session-scoped
  if (sessionId && type === 'context') {
    params.push(sessionId);
    conditions.push(`session_id = $${params.length}`);
  }

  if (queryText && typeof queryText === 'string') {
    const rawTokens = queryText
      .toLowerCase()
      .replace(/[^a-z0-9_\s-]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2);

    const meaningfulTokens = rawTokens.filter(t => !STOP_WORDS.has(t));
    const searchTokens = meaningfulTokens.length > 0 ? meaningfulTokens : (rawTokens.length > 0 ? rawTokens : []);

    if (searchTokens.length > 0) {
      const tokenConditions = [];
      for (const token of searchTokens.slice(0, 6)) {
        params.push('%' + token + '%');
        const pIdx = params.length;
        tokenConditions.push(`(LOWER(content) LIKE $${pIdx} OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(entities) e WHERE LOWER(e) LIKE $${pIdx}))`);
      }
      conditions.push(`(${tokenConditions.join(' OR ')})`);
    }
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(Math.max(1, Math.min(100, limit)));
  const limitClause = `LIMIT $${params.length}`;

  let rows = await query(
    `SELECT * FROM memories ${whereClause} ORDER BY updated_at DESC ${limitClause}`,
    params
  );

  // If specific search had 0 results, return top global factual memories as helpful fallback
  if (rows.length === 0 && (type === 'all' || type === 'factual')) {
    rows = await query(
      `SELECT * FROM memories WHERE type = 'factual' ORDER BY updated_at DESC LIMIT 10`
    );
  }

  return rows;
}

/**
 * Retrieves multi-tier context formatted for the Agent prompt.
 */
export async function retrieveAgentContext(goal, sessionId = null) {
  try {
    // 1. Fetch factual memories (Global enduring knowledge across all sessions)
    const factuals = await query(
      `SELECT content FROM memories WHERE type = 'factual' ORDER BY updated_at DESC LIMIT 20`
    );

    // 2. Fetch past relevant episodes
    const episodes = await query(
      `SELECT goal, outcome, lessons_learned FROM memory_episodes ORDER BY created_at DESC LIMIT 5`
    );

    // 3. Extract keywords from goal and query graph relations
    const rawTokens = (goal || '').toLowerCase().replace(/[^a-z0-9_\s-]/g, ' ').split(/\s+/);
    const keywords = rawTokens.filter(w => w.length > 2 && !STOP_WORDS.has(w)).slice(0, 8);
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
    console.warn('[Mem0] Failed to retrieve multi-tier context:', err.message);
    return '';
  }
}

const TRIVIAL_CHAT_PATTERNS = [
  /^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening)|yo|sup)[\s!.?]*$/i,
  /^(thanks|thank\s+you|thx|cheers|ok|okay|k|cool|great|awesome|got\s+it|nice|perfect|done)[\s!.?]*$/i,
  /^(yes|no|yep|nope|sure|agree|disagree|right|correct)[\s!.?]*$/i,
  /^(what\s+time|who\s+are\s+you|how\s+are\s+you|help|clear|cls|reset)[\s!.?]*$/i,
  /^(show\s+me|list\s+files|dir|ls|pwd|cd|cat|echo)[\s!.?]*$/i
];

/**
 * Evaluates whether a piece of information has meaningful, lasting value
 * before polluting the factual, episodic, or knowledge graph stores.
 */
export function isMeaningfulMemory(content) {
  if (!content || typeof content !== 'string') return false;
  const trimmed = content.trim();
  if (trimmed.length < 10) return false;

  for (const pattern of TRIVIAL_CHAT_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  // Meaningful signals (user profile/identity, preferences, system configs, technical decisions, milestone lessons)
  const MEANINGFUL_SIGNALS = [
    // User profile, identity, names, role, preferences
    /\b(name|named|alex|call\s+me|identity|user's?|my\s+name|prefers?|preferred|preferences?|likes?|wants?|always|never|requires?|uses?|using|built\s+with|configured|standard|convention|timezone|location|role|developer|engineer|author|profile)\b/i,
    // Architectural, stack, infrastructure, database, libraries
    /\b(architecture|pattern|framework|database|stack|api|key|token|endpoint|schema|model|docker|node|react|postgres|neo4j|redis|tailwind|css|html|python|javascript|typescript)\b/i,
    // Solutions, milestone lessons, workarounds
    /\b(fixed|solved|resolved|milestone|implemented|created|deployed|bug|workaround|lesson|episode|solution|instructions?)\b/i
  ];

  return MEANINGFUL_SIGNALS.some(regex => regex.test(trimmed));
}

/**
 * Automatically crystallizes completed session into an episodic memory and updates graph
 * ONLY if the session represents meaningful work, lessons, or completed goals.
 */
export async function crystallizeSessionEpisode(sessionId, goal, history = [], result = null, status = 'done') {
  if (!goal || typeof goal !== 'string') return null;
  const cleanGoal = goal.trim();

  // Reject trivial single-word/filler tasks
  if (cleanGoal.length < 8) return null;
  for (const pattern of TRIVIAL_CHAT_PATTERNS) {
    if (pattern.test(cleanGoal)) {
      console.log(`[Mem0] Skipped crystallization for trivial chat goal: "${cleanGoal}"`);
      return null;
    }
  }

  const SUBSTANTIVE_TOOLS = new Set([
    'bash', 'python_interpreter', 'write_to_file', 'replace_file_content',
    'file_creator', 'file_editor', 'execute_code', 'create_file', 'edit_file',
    'save_skill', 'browse_web'
  ]);

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

    // Only crystallize if substantive engineering actions were executed
    const hasSubstantiveAction = keyActions.some(a => SUBSTANTIVE_TOOLS.has(a));
    if (!hasSubstantiveAction) {
      console.log(`[Mem0] Skipped crystallization for conversational/read-only session: "${cleanGoal}"`);
      return null;
    }

    let lesson = result ? String(result).slice(0, 200).replace(/\n+/g, ' ') : `Completed ${keyActions.length} actions.`;
    if (outcome === 'failure') {
      lesson = `Task encountered issue: ${lesson}`;
    }

    const episode = await addEpisodicMemory(cleanGoal, outcome, keyActions, lesson, sessionId);
    console.log(`[Mem0] Crystallized session episode for session ${sessionId} (outcome: ${outcome})`);
    return episode;
  } catch (err) {
    console.warn('[Mem0] Episode crystallization failed:', err.message);
    return null;
  }
}
