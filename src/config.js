// src/config.js
// Central configuration — reads .env and exports typed constants.
// resolveConfig() additionally supports reading from the DB env_settings table.

import 'dotenv/config';

export const config = {
  ollama: {
    baseURL: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
    model:   process.env.OLLAMA_MODEL   ?? 'qwen2.5:7b',
    apiKey:  'ollama',
  },

  postgres: {
    host:     process.env.POSTGRES_HOST     ?? 'localhost',
    port:     Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB       ?? 'openmanus',
    user:     process.env.POSTGRES_USER     ?? 'postgres',
    password: process.env.POSTGRES_PASSWORD ?? '',
  },

  docker: {
    host:      process.env.DOCKER_HOST || undefined,
    images: {
      python: 'python:3.12-slim',
      node:   'node:22-slim',
    },
    timeoutMs: 30_000,
  },

  browser: {
    apiUrl:   process.env.CLOAKBROWSER_API_URL ?? 'http://localhost:9000',
    headless: false,
  },

  api: {
    port: Number(process.env.PORT ?? 3000),
  },

  agent: {
    maxSteps: Number(process.env.MAX_STEPS ?? 100),
  },

  groq: {
    apiKey:  process.env.GROQ_API_KEY  ?? '',
    baseURL: process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
  },

  openai: {
    apiKey:  process.env.OPENAI_API_KEY  ?? '',
    baseURL: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  },
};

/**
 * Async config resolver — reads from the DB when ENV_SOURCE=db,
 * otherwise returns the static .env-based config above.
 * Call this at the start of each agent run to get live settings.
 *
 * @param {Function} getEnvSettingsFn  injected to avoid circular import
 * @returns {Promise<typeof config>}
 */
export async function resolveConfig(getEnvSettingsFn) {
  try {
    const settings = await getEnvSettingsFn();
    const source   = settings['ENV_SOURCE'] ?? 'env';

    const ollamaEnabled = settings['OLLAMA_ENABLED'] !== 'false';
    const groqEnabled   = settings['GROQ_ENABLED']   === 'true';
    const openaiEnabled = settings['OPENAI_ENABLED'] === 'true';

    if (source !== 'db') {
      // .env mode — use static config but overlay the database enabled flags
      return {
        ...config,
        ollama: { ...config.ollama, enabled: ollamaEnabled },
        groq:   { ...config.groq,   enabled: groqEnabled },
        openai: { ...config.openai, enabled: openaiEnabled },
      };
    }

    // DB mode — build a fresh config from stored values
    const g = (key, fallback = '') => settings[key] ?? fallback;

    return {
      ollama: {
        baseURL: g('OLLAMA_BASE_URL', config.ollama.baseURL),
        model:   g('OLLAMA_MODEL',    config.ollama.model),
        apiKey:  'ollama',
        enabled: ollamaEnabled,
      },
      postgres: config.postgres,  // postgres always comes from .env (bootstrap)
      docker:   config.docker,
      browser: {
        apiUrl:   g('CLOAKBROWSER_API_URL', config.browser.apiUrl),
        headless: config.browser.headless,
      },
      api:   config.api,
      agent: { maxSteps: Number(g('MAX_STEPS', '100')) },
      groq: {
        apiKey:  g('GROQ_API_KEY',  config.groq.apiKey),
        baseURL: g('GROQ_BASE_URL', config.groq.baseURL),
        enabled: groqEnabled,
      },
      openai: {
        apiKey:  g('OPENAI_API_KEY',  config.openai.apiKey),
        baseURL: g('OPENAI_BASE_URL', config.openai.baseURL),
        enabled: openaiEnabled,
      },
    };
  } catch (err) {
    console.warn('[Config] resolveConfig failed, falling back to .env:', err.message);
    return config;
  }
}


