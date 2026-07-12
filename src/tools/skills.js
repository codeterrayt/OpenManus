// src/tools/skills.js
// Skill-store interface — lets the agent look up saved workflows at runtime.

import { query } from '../db.js';

/**
 * Returns a terse list of all available skills (name + description + tags).
 * This is injected into the system prompt so the LLM can pick the right skill.
 * @returns {Promise<Array<{name:string, description:string, tags:string[]}>>}
 */
export async function listSkills() {
  return query(
    `SELECT name, description, tags
     FROM   skills
     ORDER  BY usage_count DESC, name`
  );
}

/**
 * Fetches the full payload for a named skill and bumps its usage counter.
 * @param {string} name
 * @returns {Promise<{name:string, description:string, payload:object} | null>}
 */
export async function getSkill(name) {
  const rows = await query(
    `UPDATE skills
     SET    usage_count = usage_count + 1, updated_at = NOW()
     WHERE  name = $1
     RETURNING name, description, payload`,
    [name]
  );
  return rows[0] ?? null;
}

/**
 * Persists a new skill (or replaces it if the name already exists).
 * @param {object} skill
 * @param {string} skill.name
 * @param {string} skill.description
 * @param {object} skill.payload
 * @param {string[]} [skill.tags]
 */
export async function saveSkill({ name, description, payload, tags = [] }) {
  await query(
    `INSERT INTO skills (name, description, payload, tags)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO UPDATE
       SET description = EXCLUDED.description,
           payload     = EXCLUDED.payload,
           tags        = EXCLUDED.tags,
           updated_at  = NOW()`,
    [name, description, JSON.stringify(payload), tags]
  );
}
