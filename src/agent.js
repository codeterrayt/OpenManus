// src/agent.js
// Phase 1 — Orchestrator & LLM Routing
//
// Wires together:
//   • OpenAI SDK  (pointed at local Ollama)
//   • Tool registry     (docker, browser, skills)
//   • PostgreSQL session persistence
//
// onEvent protocol — every state change is emitted so the UI can render live:
//   session_created  { sessionId }
//   step             { step, total }
//   llm_thinking     {}
//   tool_start       { id, tool, args }
//   tool_result      { id, tool, result, exitCode?, error? }
//   answer           { text }
//   done             { sessionId, result }

import OpenAI                             from 'openai';
import { config }                         from './config.js';
import { query, getPool }                   from './db.js';
import { runInSandbox, cleanupSandbox, pullImage, SANDBOX_CONTAINER_NAME } from './tools/docker.js';
import { runDockerCli }                            from './tools/docker_cli.js';
import { readFile, writeFile, appendFile, listDir, deleteFile, makeDir, moveFile, copyFile, statFile } from './tools/docker_fs.js';
import { browseWeb, getActiveBrowserState, inspectPageHtml } from './tools/browser.js';
import { listSkills, getSkill, saveSkill } from './tools/skills.js';

// ─── LLM Client (Ollama via OpenAI-compatible API) ───────────────────────────

const llm = new OpenAI({
  baseURL: config.ollama.baseURL,
  apiKey:  config.ollama.apiKey,
});

// OpenAI Futuristic/Available model mappings to real API endpoints
const OPENAI_MODEL_MAPPING = {
  'gpt-5.5-pro': 'o1',
  'gpt-5.5-flagship': 'gpt-4o',
  'gpt-5.4-standard': 'gpt-4o',
  'gpt-5.4-mini': 'gpt-4o-mini',
  'gpt-5.4-nano': 'gpt-4o-mini',
  'o4-mini': 'o3-mini',
  'o3-mini': 'o3-mini',
  'o1': 'o1',
  'o1-mini': 'o1-mini',
  'gpt-4o': 'gpt-4o',
  'gpt-4o-mini': 'gpt-4o-mini',
};

function getGroqTpmLimit(modelId) {
  if (process.env.GROQ_TPM_LIMIT) {
    return Number(process.env.GROQ_TPM_LIMIT);
  }
  if (!modelId) return 6000;
  const lower = modelId.toLowerCase();
  if (lower.includes('8b-instant')) return 30000;
  if (lower.includes('gemma2-9b') || lower.includes('gemma-2-9b')) return 15000;
  if (lower.includes('70b') || lower.includes('versatile') || lower.includes('distill-llama-70b')) return 6000;
  if (lower.includes('qwen3.6-27b') || lower.includes('qwen-3.6-27b')) return 8000;
  return 6000; // default safe fallback for unknown models on free tier
}

function supportsNativeToolsOnGroq(modelId) {
  if (!modelId) return true;
  const lower = modelId.toLowerCase();
  return lower.includes('llama');
}

function getToolDefinitions(isGroqModel) {
  if (!isGroqModel) return TOOL_DEFINITIONS;
  return TOOL_DEFINITIONS.map(t => {
    const compact = {
      type: t.type,
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters
      }
    };
    const shortDescriptions = {
      run_code: 'Execute Python, Node.js, or Bash code in the sandbox container. Returns stdout/stderr.',
      browse_web: 'Navigate to a URL and click, type, screenshot, evaluate, or solve challenge. Always inspect first.',
      inspect_page_html: 'Search current page DOM for query string. Returns selectors. Call before browse_web click/type.',
      docker: 'Run docker subcommands on the host (e.g. ps, stop, logs, compose up -d). Do not run build.',
      read_file: 'Read file contents from a container (e.g. /workspace/app.py).',
      write_file: 'Write file content into a container.',
      append_file: 'Append text content to a file in a container.',
      list_dir: 'List contents of a directory in a container.',
      delete_path: 'Delete a file or directory in a container.',
      make_dir: 'Create a directory in a container.',
      move_file: 'Move or rename a file in a container.',
      copy_file: 'Copy a file in a container.',
      pull_docker_image: 'Pull a Docker image from a registry.',
      list_skills: 'List all saved skills available in the database.',
      get_skill: 'Fetch full payload of a saved skill by name.',
      save_skill: 'Save a new reusable workflow/skill to the database.',
      remember_info: 'Store a fact in long-term memory.',
      consolidate_memories: 'Consolidate and summarize memories to save tokens.'
    };
    if (shortDescriptions[t.function.name]) {
      compact.function.description = shortDescriptions[t.function.name];
    }
    return compact;
  });
}

// ─── Tool Definitions ────────────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'run_code',
      description:
        'Execute Python, Node.js, or Bash/Shell code in a stateful, persistent Docker container with full root access. ' +
        'Returns stdout and stderr. Use this to perform any shell command execution, background server launching, compilation, file/folder creation and manipulation, or script running. ' +
        'You have full root access to the entire container environment. Do NOT refuse to create files, directories, or start server/background processes. ' +
        'If your code starts a web server or service, specify the port(s) in the "ports" array so the user can access it at http://localhost:<port>.',
      parameters: {
        type: 'object',
        required: ['code', 'lang'],
        properties: {
          code:  { type: 'string', description: 'The complete source code or bash script to execute.' },
          lang:  { type: 'string', enum: ['python', 'javascript', 'bash'], description: 'The runtime language or interpreter (python, javascript, or bash).' },
          ports: { type: 'array', items: { type: 'integer' }, description: 'List of TCP port numbers your code listens on (e.g. [3000, 8080]). These will be exposed and bound to the same port on the host so you can access them at http://localhost:<port>.' },
          background: { type: 'boolean', description: 'If true, runs this code in the background (e.g. starting a web server/service). The runner will wait for 1.5 seconds to ensure the process does not exit immediately, and then return a success status, leaving the process running in the background. Default is false.' },
          image: { type: 'string', description: 'Override the default Docker image base for the runtime environment (e.g. "python:3.12-slim", "node:22-slim", "postgres:16", "ubuntu:24.04"). Defaults to the standard image for the specified language if omitted.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browse_web',
      description:
        'Navigate to a URL using a real browser and interact with it. ' +
        'MANDATORY: Before calling click or type, you MUST call inspect_page_html first to get the element cssSelector or xpath. Never guess selectors.\n\n' +
        'ACTIONS:\n' +
        '  extract_text  — Read all visible text on the current page. Use to understand page state after navigation or after an action.\n' +
        '  click         — Click an element. Provide "selector" from inspect_page_html result (cssSelector preferred, then xpath). Both CSS and XPath supported.\n' +
        '  type          — Focus an input and type a value. Provide "selector" and "value". Clears the field first.\n' +
        '  evaluate      — Execute arbitrary JavaScript in the page. "instructions" is the JS function body. Use for: dropdowns (select.value + dispatchEvent), checkboxes, reading state, or anything click/type cannot do.\n' +
        '  screenshot    — Capture a PNG screenshot. Use to verify visual state.\n' +
        '  solve_challenge — Bypass Cloudflare/bot detection challenge pages.\n\n' +
        'SELECTOR RULES (in priority order):\n' +
        '  1. Use cssSelector from inspect_page_html (e.g. "#submit-btn", "input[name=email]")\n' +
        '  2. Use xpath from inspect_page_html if cssSelector is not unique (XPath starts with / or //)\n' +
        '  3. Use instructions text-match as LAST RESORT only — it is the least reliable\n' +
        '  4. For <select> dropdowns: use evaluate NOT click. Pattern: var s=document.querySelector("sel"); s.value="val"; s.dispatchEvent(new Event("change",{bubbles:true}))\n' +
        '  5. For checkboxes/radios: use evaluate. Pattern: document.querySelector("sel").click()\n' +
        'Omit "url" to act on the current page.',
      parameters: {
        type: 'object',
        properties: {
          url:          { type: 'string', description: 'URL to navigate to. Omit to act on the current page without navigating.' },
          action:       { type: 'string', enum: ['extract_text', 'click', 'type', 'evaluate', 'screenshot', 'solve_challenge'], default: 'extract_text', description: 'Action to perform.' },
          selector:     { type: 'string', description: 'CSS selector or XPath from inspect_page_html result. Examples: "#login-btn", "button.primary", "//button[@type=\'submit\']". Required for click and type.' },
          instructions: { type: 'string', description: 'For evaluate: the JavaScript code to run (function body). For click fallback: text to fuzzy-match (e.g. "Submit").' },
          value:        { type: 'string', description: 'For type action: text to type into the focused element.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_page_html',
      description:
        'Search the current page DOM for elements matching a query string (text content or attributes). ' +
        'Returns for each match: tagName, id, classes, name, type, placeholder, ariaLabel, xpath, cssSelector, isVisible, isEnabled, inputValue, and outerHTML snippet. ' +
        'ALWAYS call this before browse_web click/type. Use the cssSelector or xpath from the result as the selector in browse_web.\n\n' +
        'QUERY EXAMPLES:\n' +
        '  "Submit" — find a Submit button\n' +
        '  "email" — find an email input\n' +
        '  "model" — find a model selector/dropdown\n' +
        '  "Login" — find a Login link or button\n' +
        'Omit query to get full page HTML (expensive — avoid unless necessary).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text content or attribute value to search for. Finds buttons, inputs, links, labels, dropdowns by their visible text or attributes.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_skills',
      description: 'List all saved skills (reusable workflows) available in the database.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_skill',
      description: 'Fetch the full payload of a saved skill by its exact name.',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_skill',
      description: 'Save a new reusable workflow to the skill store.',
      parameters: {
        type: 'object',
        required: ['name', 'description', 'payload'],
        properties: {
          name:        { type: 'string' },
          description: { type: 'string' },
          payload:     { type: 'object' },
          tags:        { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pull_docker_image',
      description:
        'Pull a Docker image from Docker Hub or any registry. ' +
        'Use this before run_code when you need a specific image that may not be cached locally ' +
        '(e.g. postgres:16, redis:7, nginx:latest, python:3.12-slim, node:22-alpine). ' +
        'Returns immediately if the image is already present locally.',
      parameters: {
        type: 'object',
        required: ['image'],
        properties: {
          image: { type: 'string', description: 'Full image name with optional tag, e.g. "node:22-slim", "postgres:16", "ubuntu:24.04". Defaults to latest if no tag given.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'docker',
      description:
        'Run ANY Docker CLI command directly on the host with full Docker access. ' +
        'This is the most powerful Docker tool — use it for everything Docker-related (excluding docker build):\n' +
        '  • Run containers:       "run -d -p 8080:80 --name mysite nginx:latest"\n' +
        '  • List containers:      "ps -a"\n' +
        '  • List images:          "images"\n' +
        '  • Stop/remove:          "stop mysite" or "rm -f mysite"\n' +
        '  • Docker Compose:       "compose up -d" or "compose -f /path/docker-compose.yml up"\n' +
        '  • Exec into container:  "exec -it mysite sh"\n' +
        '  • View logs:            "logs --tail=100 mysite"\n' +
        '  • Inspect resource:     "inspect mysite"\n' +
        '  • Networks:             "network create mynet" or "network ls"\n' +
        '  • Volumes:              "volume create myvol" or "volume ls"\n' +
        '  • Pull image:           "pull postgres:16"\n' +
        '  • Push image:           "push myrepo/myapp:latest"\n' +
        '  • System info:          "system df" or "info"\n' +
        'Pass everything AFTER the "docker" keyword (except "build"). Full stdout and stderr returned.',
      parameters: {
        type: 'object',
        required: ['command'],
        properties: {
          command:    { type: 'string',  description: 'The docker subcommand and all its arguments, exactly as you would type after "docker" (excluding "build"). E.g.: "run -d -p 3000:3000 --name api node:22-slim node server.js"' },
          timeoutSec: { type: 'integer', description: 'Optional timeout in seconds (default 120). Use a higher value for large pulls.' },
        },
      },
    },
  },
  // ─── File Management (sandbox container) ──────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from inside a Docker container. Returns file contents. Use to verify a file was created correctly, inspect logs, check configs.',
      parameters: {
        type: 'object', required: ['path'],
        properties: {
          path:      { type: 'string', description: 'Absolute path inside the container, e.g. /workspace/app.py' },
          container: { type: 'string', description: `Container name. Defaults to the persistent sandbox container (${SANDBOX_CONTAINER_NAME}). If you created a custom container (e.g. via 'docker run --name my-app'), you MUST specify its custom name here.` },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file inside a Docker container. Use this to write source code, configs, Dockerfiles, scripts. Content is written exactly as provided. Parent directories are created automatically.',
      parameters: {
        type: 'object', required: ['path', 'content'],
        properties: {
          path:      { type: 'string', description: 'Absolute path inside the container, e.g. /workspace/server.js' },
          content:   { type: 'string', description: 'Full file content to write' },
          container: { type: 'string', description: `Container name. Defaults to the persistent sandbox container (${SANDBOX_CONTAINER_NAME}). If you created a custom container (e.g. via 'docker run --name my-app'), you MUST specify its custom name here.` },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'append_file',
      description: 'Append content to the end of a file inside a Docker container.',
      parameters: {
        type: 'object', required: ['path', 'content'],
        properties: {
          path:      { type: 'string', description: 'Absolute path inside the container' },
          content:   { type: 'string', description: 'Text to append' },
          container: { type: 'string', description: `Container name. Defaults to the persistent sandbox container (${SANDBOX_CONTAINER_NAME}). If you created a custom container (e.g. via 'docker run --name my-app'), you MUST specify its custom name here.` },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and directories inside a Docker container. Shows names, sizes, permissions. Use to verify files were created and explore structure.',
      parameters: {
        type: 'object',
        properties: {
          path:      { type: 'string', description: 'Directory path to list. Default: /workspace' },
          container: { type: 'string', description: `Container name. Defaults to the persistent sandbox container (${SANDBOX_CONTAINER_NAME}). If you created a custom container (e.g. via 'docker run --name my-app'), you MUST specify its custom name here.` },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_path',
      description: 'Delete a file or directory (recursively) from inside a Docker container.',
      parameters: {
        type: 'object', required: ['path'],
        properties: {
          path:      { type: 'string', description: 'Absolute path to delete' },
          container: { type: 'string', description: `Container name. Defaults to the persistent sandbox container (${SANDBOX_CONTAINER_NAME}). If you created a custom container (e.g. via 'docker run --name my-app'), you MUST specify its custom name here.` },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'make_dir',
      description: 'Create a directory (and all parent directories) inside a Docker container.',
      parameters: {
        type: 'object', required: ['path'],
        properties: {
          path:      { type: 'string', description: 'Directory path to create' },
          container: { type: 'string', description: `Container name. Defaults to the persistent sandbox container (${SANDBOX_CONTAINER_NAME}). If you created a custom container (e.g. via 'docker run --name my-app'), you MUST specify its custom name here.` },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_file',
      description: 'Move or rename a file or directory inside a Docker container.',
      parameters: {
        type: 'object', required: ['src', 'dest'],
        properties: {
          src:       { type: 'string', description: 'Source path' },
          dest:      { type: 'string', description: 'Destination path' },
          container: { type: 'string', description: `Container name. Defaults to the persistent sandbox container (${SANDBOX_CONTAINER_NAME}). If you created a custom container (e.g. via 'docker run --name my-app'), you MUST specify its custom name here.` },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'copy_file',
      description: 'Copy a file or directory inside a Docker container.',
      parameters: {
        type: 'object', required: ['src', 'dest'],
        properties: {
          src:       { type: 'string', description: 'Source path' },
          dest:      { type: 'string', description: 'Destination path' },
          container: { type: 'string', description: `Container name. Defaults to the persistent sandbox container (${SANDBOX_CONTAINER_NAME}). If you created a custom container (e.g. via 'docker run --name my-app'), you MUST specify its custom name here.` },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember_info',
      description: 'Store a useful piece of information or fact in long-term memory so that it is available globally across all chats. Use this when the user explicitly asks you to remember something, or when you discover important facts/configurations/keys/user-preferences that will be useful in future sessions.',
      parameters: {
        type: 'object',
        required: ['info'],
        properties: {
          info: { type: 'string', description: 'The text content to remember/store.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'consolidate_memories',
      description: 'Consolidate, deduplicate, and summarize all current memories stored in long-term memory into a clean list of key facts, deleting the old redundant entries to save tokens.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  }
];

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

async function dispatchTool(toolName, args, llmClient, targetModelName, sessionId = null) {
  switch (toolName) {
    case 'read_file':    return JSON.stringify(await readFile(args));
    case 'write_file':   return JSON.stringify(await writeFile(args));
    case 'append_file':  return JSON.stringify(await appendFile(args));
    case 'list_dir':     return JSON.stringify(await listDir(args));
    case 'delete_path':  return JSON.stringify(await deleteFile(args));
    case 'make_dir':     return JSON.stringify(await makeDir(args));
    case 'move_file':    return JSON.stringify(await moveFile(args));
    case 'copy_file':    return JSON.stringify(await copyFile(args));
    case 'stat_file':    return JSON.stringify(await statFile(args));
    case 'docker': {
      const { command, timeoutSec } = args;
      const result = await runDockerCli(command, timeoutSec ? timeoutSec * 1000 : undefined);
      return JSON.stringify(result);
    }
    case 'pull_docker_image': {
      const result = await pullImage(args.image);
      return JSON.stringify(result);
    }
    case 'run_code': {
      const { stdout, stderr, exitCode, accessUrls } = await runInSandbox(args);
      return JSON.stringify({ exitCode, stdout, stderr, ...(accessUrls?.length ? { accessUrls, note: `Server accessible at: ${accessUrls.join(', ')}` } : {}) });
    }
    case 'browse_web': {
      const result = await browseWeb(args);
      return JSON.stringify(result);
    }
    case 'inspect_page_html': {
      const result = await inspectPageHtml(args);
      return JSON.stringify(result);
    }
    case 'list_skills': {
      const skills = await listSkills();
      return JSON.stringify(skills);
    }
    case 'get_skill': {
      const skill = await getSkill(args.name);
      return skill ? JSON.stringify(skill) : `Skill "${args.name}" not found.`;
    }
    case 'save_skill': {
      await saveSkill(args);
      return `Skill "${args.name}" saved successfully.`;
    }
    case 'remember_info': {
      if (sessionId) {
        await query(`INSERT INTO memories (content, session_id) VALUES ($1, $2)`, [args.info, sessionId]);
      } else {
        await query(`INSERT INTO memories (content) VALUES ($1)`, [args.info]);
      }
      return JSON.stringify({ success: true, message: `Successfully remembered: "${args.info}"` });
    }
    case 'consolidate_memories': {
      if (!llmClient) {
        return JSON.stringify({ error: 'LLM Client not available for consolidation.' });
      }
      try {
        const result = await consolidateMemoriesLLM(llmClient, targetModelName, sessionId);
        return JSON.stringify(result);
      } catch (err) {
        return JSON.stringify({ error: err.message });
      }
    }
    default:
      throw new Error(`Unknown tool: "${toolName}"`);
  }
}

async function consolidateMemoriesLLM(llmClient, model, sessionId = null) {
  const memories = sessionId
    ? await query('SELECT * FROM memories WHERE session_id = $1 ORDER BY created_at DESC', [sessionId])
    : await query('SELECT * FROM memories WHERE session_id IS NULL ORDER BY created_at DESC');
  if (memories.length === 0) {
    return { success: true, message: 'No memories to summarize.' };
  }

  const memoriesText = memories.map(m => `- ${m.content}`).join('\n');

  const response = await llmClient.chat.completions.create({
    model: model ?? config.ollama.model,
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
  console.log('[Memory Summary Tool] LLM response:', reply);

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
    console.warn('[Memory Summary Tool] Failed to parse LLM response as JSON array. Falling back to line splitting:', reply);
    newMemories = cleanReply
      .split('\n')
      .map(line => line.replace(/^[-*•\d.\s]+/, '').trim())
      .filter(line => line.length > 5);
  }

  if (newMemories.length > 0) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      if (sessionId) {
        await client.query('DELETE FROM memories WHERE session_id = $1', [sessionId]);
        for (const content of newMemories) {
          await client.query('INSERT INTO memories (content, session_id) VALUES ($1, $2)', [content, sessionId]);
        }
      } else {
        await client.query('DELETE FROM memories WHERE session_id IS NULL');
        for (const content of newMemories) {
          await client.query('INSERT INTO memories (content) VALUES ($1)', [content]);
        }
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  }

  return { success: true, message: `Successfully consolidated memories into ${newMemories.length} item(s).` };
}

// ─── Session helpers ──────────────────────────────────────────────────────────

async function createSession(goal) {
  const rows = await query(
    `INSERT INTO sessions (goal, status, history)
     VALUES ($1, 'running', '[]'::jsonb)
     RETURNING id`,
    [goal]
  );
  return rows[0].id;
}

async function appendHistory(sessionId, messages) {
  await query(
    `UPDATE sessions
     SET    history    = history || $1::jsonb,
            updated_at = NOW()
     WHERE  id = $2`,
    [JSON.stringify(messages), sessionId]
  );
}

async function appendLog(sessionId, entry) {
  await query(
    `UPDATE sessions
     SET    logs       = logs || $1::jsonb,
            updated_at = NOW()
     WHERE  id = $2`,
    [JSON.stringify([entry]), sessionId]
  );
}

async function finaliseSession(sessionId, status, result) {
  await query(
    `UPDATE sessions
     SET    status = $1, result = $2, updated_at = NOW()
     WHERE  id = $3`,
    [status, result, sessionId]
  );
}

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are OpenManus, an autonomous AI agent that executes tasks using tools.

## YOUR TOOLS
- run_code      : Run Python/JavaScript/Bash in a persistent Docker sandbox (container: openmanus-sandbox)
- docker        : Run docker commands on the HOST machine (docker run/ps/logs/stop/rm/compose/exec/network/volume - except build)
- write_file    : Write a file directly into a container (faster than echo in run_code)
- read_file     : Read a file from a container to verify its contents
- append_file   : Append text to a file in a container
- list_dir      : List files in a container directory (use to verify files exist)
- delete_path   : Delete file or directory from a container
- make_dir      : Create directory in a container
- move_file     : Move/rename a file in a container
- copy_file     : Copy a file in a container
- pull_docker_image : Pull an image from Docker Hub
- browse_web    : Browse the web with a real browser
- list_skills   : List all saved skills (reusable workflows)
- get_skill     : Retrieve full payload of a saved skill by name
- save_skill    : Save a new reusable workflow to the skill store

## SANDBOX ENVIRONMENT
- Container name: openmanus-sandbox (Persistent environment, automatically switches base image based on runtime language - e.g. python:3.12-slim or node:22-slim)
- Working dir: /workspace
- Internet access: YES. Full root access: YES.
- Host network mode: YES (all container ports bind to host localhost on Windows automatically).
- Libraries NOT pre-installed — install with pip/npm/apt before use.

## ROBUST EXECUTION FRAMEWORK (Plan-Execute-Verify-Proceed)
To ensure 100% accuracy on all tasks (especially on smaller/weaker models), you MUST strictly follow this loop:
1. **Plan**: On your first turn, write out a numbered checklist of steps to accomplish the goal.
2. **Execute**: Select and call the appropriate tool for the current step.
3. **Verify (CRITICAL)**: After EVERY execution, verify the result. 
   - If you wrote/modified a file → call \`read_file\` or \`list_dir\` to check it.
   - If you ran code → inspect the \`exitCode\` (must be 0).
   - If you started a server/service → check container status (\`docker ps -a\`), view logs (\`docker logs\`), or test access (\`browse_web\` or curl).
   - **NEVER** assume a step succeeded without verifying it.
4. **Proceed or Correct**:
   - If verification succeeds → mark the step as done and proceed to the next checklist item.
   - If verification fails → explain the error, write a correction plan, fix the root cause, and retry.

## REUSABLE WORKFLOWS (SKILLS)
- At the start of a task, check \`list_skills\` to see if there is an existing workflow or recipe that solves this problem. Use \`get_skill\` to retrieve it.
- When you complete a complex, multi-step task (like building a specific kind of web app or setting up a database pipeline), call \`save_skill\` to persist your successful recipe so you can reuse it later.

## CRITICAL RULES — FOLLOW EVERY RULE EVERY TIME

### RULE 1 — ALWAYS CHECK TOOL RESULTS — NEVER ASSUME SUCCESS
After EVERY tool call, the system automatically injects the result into your context.
- If the result starts with **[TOOL ERROR]** or you see a **[TOOL FAILURE NOTICE]** system message → the tool FAILED. You MUST stop, read the full error, diagnose the root cause, and fix it before proceeding.
- exitCode = 0 → SUCCESS. Continue.
- exitCode != 0 → FAILURE. Read stderr. Fix. Retry. Do NOT move to the next step.
- result.error present → FAILURE. Do NOT ignore it.
- **NEVER say "task complete", "done", or "successfully" while a [TOOL ERROR] or [TOOL FAILURE NOTICE] is present in your context. That is a lie.**
- NEVER assume a step succeeded without seeing a clean, error-free result.

### RULE 2 — ALWAYS VERIFY CONTAINERS ARE RUNNING
After running \`docker run ...\` or starting a service:
1. Run \`docker ps -a --filter name=<name>\` to see the container status.
2. If status shows "Exited" → the container CRASHED. Run \`docker logs <name>\` to read the error. Fix it.
3. NEVER assume a container is running without checking \`docker ps\`.

### RULE 3 — CHECK IF CONTAINER ALREADY EXISTS & REMEMBER CONTAINER NAME
Before running \`docker run --name X ...\`:
1. Check \`docker ps -a --filter name=X\` first.
2. If it already exists, use \`docker start X\` instead of \`docker run\`.
3. If it exists but crashed, run \`docker rm X\` first, then \`docker run\`.
4. REMEMBER CUSTOM CONTAINER NAME: If you create or run a container with a custom name (e.g. \`my-web-app\`), you MUST use that exact name (e.g. \`my-web-app\`) as the \`container\` argument in all subsequent file management tool calls (like \`write_file\`, \`read_file\`, \`list_dir\`). Do NOT use the default \`openmanus-sandbox\` container unless you specifically intend to operate inside the default sandbox. If a container is not found, list running containers via \`docker ps\` or check the tool response to find the correct name.

### RULE 4 — CHOOSE AND PLAN THE RIGHT DOCKER IMAGE
Use the correct base image for the task:
- General Python work → python:3.12-slim (already pulled)
- Node.js web app → node:22-slim
- Database → postgres:16, mysql:8, redis:7
- Web server → nginx:alpine
- Ubuntu shell → ubuntu:24.04
- Custom app → Use existing pre-built official images (e.g. node:22-slim, python:3.12-slim, nginx:alpine) and run/configure them directly. NEVER write Dockerfiles or use \`docker build\`.
- Do NOT use python:3.12-slim to run a Node.js app. Do NOT use node:22-slim to run Python.
- NO MANUAL RUNTIME INSTALLATION: Do NOT install major runtimes (like Node.js, Python, Java) or databases (like PostgreSQL, MySQL) manually using package managers (apt, apt-get, pip, npm, etc.) inside the container. Instead, always choose and boot/run in the best pre-built official Docker image for that language/environment.
- IMAGE PRE-CHECK: Whenever you need to choose or run any Docker image, you MUST first run 'docker images' to check what images are already available locally on the system, and choose the most suitable official image for the environment.
- CHECK LOCAL IMAGES: Intelligently determine which image you require for the task. You can call the \`docker\` tool with the command \`images\` (i.e. \`docker images\`) to check which images you currently have locally.
- PLANNING & PULLING: If the required image is not already present locally, you MUST call the \`pull_docker_image\` tool to pull it first before launching the sandbox container or executing scripts in it.
- USER APPROVAL: Before booting the container or running code in it, present your environment plan to the user. Explain which Docker image you chose and why, and if it is cached locally or needs to be pulled, and ask the user if they have any changes or if they approve. Offer options if multiple setups are possible. Do not execute code in the container until the user approves or says "do it" or "approve".

### RULE 5 — VERIFY FILES EXIST AFTER WRITING
After writing a file with write_file or run_code:
- Use read_file or list_dir to confirm the file exists and content is correct.
- Do NOT proceed to the next step assuming a file was written if you haven't verified it.

### RULE 6 — USE PORTS AND BACKGROUND RUN WHEN STARTING SERVERS
When run_code starts a web server, API, or any background process on port X:
- Include \`"ports": [X]\` and \`"background": true\` in the run_code call. This prevents the execution from blocking the session and timing out.
- OR use \`docker run -d -p X:X ...\` with the docker tool.
- CRITICAL: You MUST configure the web server, app, or database to listen on interface "0.0.0.0" inside the container (e.g. \`app.run(host='0.0.0.0')\` or binding to \`0.0.0.0\`), NOT "127.0.0.1" or "localhost". If it binds to loopback (127.0.0.1), the port forwarding cannot route traffic to it and the user will get a connection refused error.
- REUSE PORTS: If a port is already in use by a previous process you started, do not try to boot a new container or get stuck; instead, kill the process on that port first (e.g. run \`fuser -k X/tcp\` or \`kill $(lsof -t -i:X) 2>/dev/null || true\` in bash via \`run_code\`) and then restart your server code.
- After starting, verify that the server is active (e.g. by checking logs or curl/browse_web), then provide the URL to the user (use localhost in the URL, e.g. http://localhost:X - the system will automatically map it to the correct hostname for the user).

### RULE 7 — READ ERRORS FULLY
When a tool returns stderr or an error:
- Read the ENTIRE error message before deciding what to do.
- Do not repeat the same failing command. Fix the root cause.

### RULE 8 — FINISH WITH PLAIN TEXT
When the task is complete, respond with a plain text answer. Do NOT call a tool in your final step.
Include: what was done, any URLs/ports the user needs, and file locations.

### RULE 9 — TOOL CALLING FORMAT FOR SMALL MODELS
If your environment does not support direct tool calling, or if you want to call a tool, you MUST output a single JSON block inside markdown backticks in the exact format shown below:
\`\`\`json
{
  "name": "tool_name",
  "arguments": {
    "arg_name": "arg_value"
  }
}
\`\`\`
Do NOT add any conversational text before or after the JSON block when calling a tool. Call ONLY one tool at a time.

### RULE 10 — ALWAYS USE DOCKER SANDBOX FOR CODE AND FILES
Whenever you are asked to write code, run scripts, execute commands, or create/modify files/directories, you MUST do so inside the Docker sandbox container (\`openmanus-sandbox\`) using \`run_code\`, \`write_file\`, or other container-aware tools. If you need a specific environment (like Node.js, databases, etc.), ensure the container is running first. Never write code files or run commands on the host directly under any circumstances.

### RULE 11 — ALWAYS BROWSE AND USE PROVIDED URLS
If the user provides a URL in their prompt (e.g., starting with http:// or https://, or referring to a website), you MUST always use the \`browse_web\` tool to open the link, read through its contents, and use that information. Do not try to answer or perform tasks referencing the URL without visiting it first.

### RULE 12 — SMART BROWSER INTERACTIONS: MANDATORY FIND-BEFORE-ACT PROTOCOL

This rule governs ALL browser click, type, and form interactions. Follow it every time without exception.

#### PHASE 1 — ALWAYS FIND THE ELEMENT FIRST
Before ANY click, type, or form action, call \`inspect_page_html\` with a query:
- Button "Submit" → \`inspect_page_html query="Submit"\`
- Email input → \`inspect_page_html query="email"\`
- Password input → \`inspect_page_html query="password"\`
- Dropdown/select → \`inspect_page_html query="select"\` or query the label text
- Link → \`inspect_page_html query="<link text>"\`
- Search box → \`inspect_page_html query="search"\`

The result gives you: \`cssSelector\`, \`xpath\`, \`tagName\`, \`type\`, \`isVisible\`, \`isEnabled\`, \`inputValue\`.

#### PHASE 2 — CHOOSE THE RIGHT ACTION BASED ON ELEMENT TYPE

| tagName / type from result | Correct action |
|---|---|
| button, a, [role=button], input[type=submit] | browse_web action="click" selector=cssSelector |
| input[type=text/email/password/search/number/url] | browse_web action="type" selector=cssSelector value="..." |
| textarea | browse_web action="type" selector=cssSelector value="..." |
| select (dropdown) | browse_web action="evaluate" instructions="var s=document.querySelector('CSSSELECTOR'); s.value='OPTION_VALUE'; s.dispatchEvent(new Event('change',{bubbles:true}))" |
| input[type=checkbox] | browse_web action="evaluate" instructions="document.querySelector('CSSSELECTOR').click()" |
| input[type=radio] | browse_web action="evaluate" instructions="document.querySelector('CSSSELECTOR').click()" |
| div, span, li with click handlers | browse_web action="evaluate" instructions="document.querySelector('CSSSELECTOR').click()" |

#### PHASE 3 — VERIFY THE ACTION WORKED
After every action, verify:
- Call \`browse_web action="extract_text"\` to read current page state
- Or call \`inspect_page_html query="<expected result text>"\` to confirm state changed
- If a URL changed after click → confirm you are on the correct page
- If nothing changed → the selector was wrong; call inspect_page_html again with a different query

#### SELECTOR PRIORITY RULES
1. **cssSelector** from inspect_page_html — use first (e.g. \`#login-btn\`, \`input[name="email"]\`)
2. **xpath** from inspect_page_html — use if cssSelector is not unique or too long
3. **instructions text-match** — LAST RESORT ONLY, use only when inspect_page_html returned nothing

#### HARD PROHIBITIONS — NEVER DO THESE:
- NEVER attempt to build Docker images or execute \`docker build\` commands. Custom image building is strictly disabled; use pre-built official images instead.
- NEVER call browse_web click/type without first calling inspect_page_html
- NEVER guess a selector (e.g. \`button.submit\`, \`#login\`) without confirming it exists via inspect_page_html
- NEVER use browse_web action="click" on a \`<select>\` dropdown — use evaluate with .value + dispatchEvent
- NEVER assume a click/type worked without verifying via extract_text or inspect_page_html
- NEVER call inspect_page_html without a query — this dumps the whole HTML and wastes context
- NOTE: The \`browse_web\` tool will return an explicit error object \`{"error": "..."}\` if the element cannot be found or the action fails. Use this error feedback to re-inspect and choose a different selector or action.

#### EXAMPLE A — Click a login button:
\`\`\`
// 1. Find it
inspect_page_html query="Login"
// Result: { cssSelector: "button#login-btn", isVisible: true, isEnabled: true, tagName: "button" }

// 2. Click using exact selector
browse_web action="click" selector="button#login-btn"

// 3. Verify
browse_web action="extract_text"
\`\`\`

#### EXAMPLE B — Select a dropdown option:
\`\`\`
// 1. Find the select element
inspect_page_html query="model"
// Result: { cssSelector: "select#model-select", tagName: "select", isVisible: true }

// 2. Set value via JavaScript — NOT click
browse_web action="evaluate" instructions="var s=document.querySelector('select#model-select'); s.value='gpt-4o-mini'; s.dispatchEvent(new Event('change',{bubbles:true}))"

// 3. Verify
inspect_page_html query="gpt-4o-mini"
\`\`\`

#### EXAMPLE C — Type into a search box:
\`\`\`
// 1. Find the input
inspect_page_html query="Search"
// Result: { cssSelector: "input[placeholder='Search...']", tagName: "input", type: "search" }

// 2. Type into it
browse_web action="type" selector="input[placeholder='Search...']" value="OpenAI"

// 3. Press Enter
browse_web action="evaluate" instructions="document.querySelector('input[placeholder=\\'Search...\\']').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))"
\`\`\`

### RULE 13 — PROACTIVE LONG-TERM MEMORY (PERSONALIZATION)
You are equipped with a long-term memory tool \`remember_info\`. You must be proactive and smart about storing useful details to make the user experience highly personalized:
- Whenever the user shares personal preferences (e.g. favorite languages, target platforms, project folder structures, specific keys/credentials, styling preferences), call \`remember_info\` to save it.
- Whenever you discover critical configurations or credentials that succeed (e.g. database ports, system paths, server endpoints), call \`remember_info\` to persist them.
- Do not wait for the user to explicitly say "remember this" — if you discover something that would be useful in future chats/sessions, call \`remember_info\` to save it immediately.

### RULE 14 — WORKSPACE FILE INDEXING & SEARCHING (INTELLIGENT EDITING)
To build software efficiently without wasting token context or re-reading files repeatedly:
- Maintain a running file index/summary of the workspace files you create or edit in memory using \`remember_info\`. For each file, list its filename, purpose, key components, and ports. Update this index when you create/modify files.
- To search and edit files intelligently, write bash commands or Python scripts inside the sandbox container (e.g., using \`grep\`, \`find\`, or regex patterns) to find specific lines, code structures, or functions across multiple files, and then edit them directly. Do not waste time manually inspecting every file.

### RULE 15 — LINUX/UNIX COMPATIBILITY & LINE ENDINGS (CRLF VS LF)
The Docker sandbox (\`openmanus-sandbox\`) runs on a Linux environment, which expects Unix-style line endings (\`\n\` or \`LF\`), NOT Windows-style line endings (\`\r\n\` or \`CRLF\`).
- Windows-style \`\r\n\` line endings inside bash scripts or files executed in the sandbox will cause syntax errors (e.g. \`unexpected end of file\` or \`\\r: command not found\`).
- The file system tools and execution sandbox automatically normalize line endings to Unix \`\n\` format before writing or executing. However, when writing code, configuration files, or scripts, always format them to be fully Linux-compatible.

### RULE 16 — EXECUTE ONE TOOL CALL AT A TIME (PRECISION CONTROL)
- You MUST only call a single tool per turn. Never call multiple tools in parallel or request multiple tool executions in a single assistant message.
- For example, if you need to create a directory and then write a file, call \`make_dir\` first, wait for the tool result, verify it, and then call \`write_file\` on the next turn.
- This prevents compounding errors and ensures you are fully aware of the outcome of the previous step before proceeding.

### RULE 17 — LOOP & REPEATED FAILURE DETECTION (ASK FOR CLARITY)
- If you notice that you are repeating the same tool call with the same parameters more than 3 times, or if a tool is failing repeatedly (e.g. exitCode != 0 or browser element not found) and your correction attempts are not working, STOP executing tools.
- Do NOT continue loop execution blindly. Instead, explain the issue clearly to the user, describe what you tried and why it failed, and ask the user for clarification, feedback, or manual intervention.

### RULE 18 — SEPARATING REASONING AND DIRECT TEXT (THINKING TAGS)
- You MUST wrap your internal thought process, reasoning steps, code planning, and analysis in <thinking>...</thinking> tags at the beginning of your response.
- Any text outside the <thinking>...</thinking> tags must be direct communication to the user (e.g. plans, questions, status reports, approval requests).
- NEVER mix internal thought reasoning with direct user messages outside the <thinking> tags.
- Even when you are calling a tool, you should still put your thoughts in <thinking>...</thinking> tags, and put your direct status message or plan outside the tags before the tool call.

### RULE 19 — PROVIDE THE REASON FOR EACH TOOL CALL
- Whenever you call a tool, you MUST write a short, clear status message outside the <thinking>...</thinking> tags explaining what tool you are invoking, the reason for calling it, and what it is doing (e.g. 'I am going to check if the node image is available locally...', or 'I will execute the script in the Node.js sandbox to start the server...').
- This ensures the user is kept fully informed of each tool invocation in the chat feed, explaining the purpose of every execution step in a proper conversational flow.

### RULE 20 — INTERACTIVE GENERATIVE UI (GENUI) RENDERING
- You have a Generative UI engine in the frontend. When the user wants an interactive widget, form, calculator, card, table, list, stats, or progress bar in the chat, wrap a JSON schema inside '<c1_ui>' tags.
- Do NOT use 'run_code' or 'write_file' for this. Output the block in your text response.
- CRITICAL: JSON only. NEVER include JavaScript functions, code, or callbacks (onSubmit, onClick, etc.). The renderer handles all interactivity automatically.
- Supported types:
  1. **form** — Fields: text, number, email, date, time, select, textarea, checkbox, range.
     <c1_ui>{ "type": "form", "title": "Booking", "fields": [
       { "name": "city", "type": "text", "label": "City", "required": true },
       { "name": "date", "type": "date", "label": "Date" },
       { "name": "guests", "type": "select", "label": "Guests", "options": ["1","2","3+"] }
     ], "submitLabel": "Book Now" }</c1_ui>
  2. **form+compute** — Calculator/converter. Use number fields + select with math operations. Auto-detected:
     <c1_ui>{ "type": "form", "title": "Calculator", "fields": [
       { "name": "a", "type": "number", "label": "Number 1", "required": true },
       { "name": "b", "type": "number", "label": "Number 2", "required": true },
       { "name": "op", "type": "select", "label": "Operation", "options": ["Add","Subtract","Multiply","Divide"], "required": true }
     ], "submitLabel": "Calculate" }</c1_ui>
  3. **table** — Sortable data table:
     <c1_ui>{ "type": "table", "title": "Scores", "columns": [
       { "key": "name", "label": "Name" },{ "key": "score", "label": "Score" }
     ], "rows": [{ "name": "Alice", "score": 95 },{ "name": "Bob", "score": 87 }] }</c1_ui>
  4. **card** — Key-value info card:
     <c1_ui>{ "type": "card", "title": "Status", "items": [{ "label": "CPU", "value": "45%" },{ "label": "RAM", "value": "2.1GB" }] }</c1_ui>
  5. **stats** — Stats dashboard with trend indicators:
     <c1_ui>{ "type": "stats", "title": "Metrics", "items": [
       { "label": "Users", "value": 1250, "change": "+12%" },
       { "label": "Revenue", "value": "$8.4k", "change": "+5%" }
     ] }</c1_ui>
  6. **progress** — Progress bars (value 0-100):
     <c1_ui>{ "type": "progress", "title": "Tasks", "items": [
       { "label": "Frontend", "value": 85 },{ "label": "Backend", "value": 60 }
     ] }</c1_ui>
  7. **list** — Ordered/unordered list:
     <c1_ui>{ "type": "list", "title": "Steps", "ordered": true, "items": ["Install","Configure","Deploy"] }</c1_ui>`;

// ─── Summarization ────────────────────────────────────────────────────────────

/** Rough token estimate: 1 token ≈ 4 chars */
function estimateTokens(messages) {
  return messages.reduce((sum, m) => {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
    return sum + Math.ceil(text.length / 4);
  }, 0);
}

/**
 * Summarizes old messages into a single compressed context message.
 * Keeps the last KEEP_RECENT messages untouched for continuity.
 * Returns { summarized: Message[], summary: string }
 */
async function summarizeHistory(llmClient, model, messages, onEvent, isGroq = false) {
  const KEEP_RECENT = isGroq ? 2 : 6;
  if (messages.length <= KEEP_RECENT + 2) return null; // nothing to summarize

  let toSummarize = messages.slice(0, messages.length - KEEP_RECENT);
  const recent      = messages.slice(messages.length - KEEP_RECENT);

  // If on Groq with low TPM, ensure the history to summarize doesn't exceed the TPM limit itself
  if (isGroq) {
    const tpmLimit = getGroqTpmLimit(model);
    const safeLimit = Math.floor(tpmLimit * 0.6); // leave 40% buffer for system prompt + response
    while (toSummarize.length > 2 && estimateTokens(toSummarize) > safeLimit) {
      toSummarize.shift(); // drop oldest messages to avoid 413 during summarization
    }
  }

  onEvent('summarizing', { message: 'Conversation is getting long — creating summary to save context...' });

  const summaryPrompt = [
    {
      role: 'system',
      content: 'You are a concise summarizer. Summarize the following agent conversation into 150–250 words. Capture: the goal, every tool called and its outcome, any files created, any servers started and their ports, errors encountered and how they were resolved, and current state. Be precise and factual.',
    },
    {
      role: 'user',
      content: toSummarize.map(m => {
        const role = m.role.toUpperCase();
        const body = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        const tools = m.tool_calls ? ` [called: ${m.tool_calls.map(t => t.function.name).join(', ')}]` : '';
        return `${role}${tools}: ${body}`;
      }).join('\n\n'),
    },
  ];

  let summary = '';
  try {
    const resp = await llmClient.chat.completions.create({
      model,
      messages: summaryPrompt,
      stream: false,
      ...({ options: { num_ctx: 4096 } }),
    });
    summary = resp.choices[0]?.message?.content?.trim() ?? '';
  } catch (e) {
    console.warn('[Agent] Summarization failed:', e.message);
    return null;
  }

  onEvent('summary_created', { summary });
  console.log(`[Agent] Summarized ${toSummarize.length} messages into ${summary.length} chars.`);

  const summaryMsg = {
    role: 'system',
    content: `[CONVERSATION SUMMARY — ${toSummarize.length} earlier messages compressed]\n${summary}`,
  };

  return { summarized: [summaryMsg, ...recent], summary };
}


function sanitizeHistory(history) {
  const sanitized = [];
  let pendingToolCallIds = new Set();

  for (const msg of history) {
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      if (pendingToolCallIds.size > 0) {
        for (const id of pendingToolCallIds) {
          sanitized.push({
            role: 'tool',
            tool_call_id: id,
            content: 'Error: Session interrupted before tool response could be recorded.'
          });
        }
        pendingToolCallIds.clear();
      }
      for (const tc of msg.tool_calls) {
        if (tc.id) pendingToolCallIds.add(tc.id);
      }
      sanitized.push(msg);
    } else if (msg.role === 'tool') {
      if (msg.tool_call_id) {
        pendingToolCallIds.delete(msg.tool_call_id);
      }
      sanitized.push(msg);
    } else {
      if (pendingToolCallIds.size > 0) {
        for (const id of pendingToolCallIds) {
          sanitized.push({
            role: 'tool',
            tool_call_id: id,
            content: 'Error: Session interrupted before tool response could be recorded.'
          });
        }
        pendingToolCallIds.clear();
      }
      sanitized.push(msg);
    }
  }

  if (pendingToolCallIds.size > 0) {
    for (const id of pendingToolCallIds) {
      sanitized.push({
        role: 'tool',
        tool_call_id: id,
        content: 'Error: Session interrupted before tool response could be recorded.'
      });
    }
  }

  return sanitized;
}

function extractJsonObjects(text) {
  const results = [];
  let braceCount = 0;
  let startIndex = -1;
  let inDoubleQuote = false;
  let inSingleQuote = false;
  let inBacktick = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    // Check for triple backticks to avoid toggling inBacktick
    if (text[i] === '`' && text[i+1] === '`' && text[i+2] === '`') {
      i += 2; // skip the next two backticks
      continue;
    }

    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    // Only track string boundaries if we are inside a JSON object
    if (braceCount > 0) {
      if (char === '"' && !inSingleQuote && !inBacktick) {
        inDoubleQuote = !inDoubleQuote;
      } else if (char === "'" && !inDoubleQuote && !inBacktick) {
        inSingleQuote = !inSingleQuote;
      } else if (char === '`' && !inDoubleQuote && !inSingleQuote) {
        inBacktick = !inBacktick;
      }
    }

    if (!inDoubleQuote && !inSingleQuote && !inBacktick) {
      if (char === '{') {
        if (braceCount === 0) {
          startIndex = i;
        }
        braceCount++;
      } else if (char === '}') {
        if (braceCount > 0) {
          braceCount--;
          if (braceCount === 0 && startIndex !== -1) {
            results.push(text.slice(startIndex, i + 1));
            startIndex = -1;
            // Reset quote states on completion
            inDoubleQuote = false;
            inSingleQuote = false;
            inBacktick = false;
            escaped = false;
          }
        }
      }
    }
  }
  return results;
}

function parseTextToolCalls(text) {
  if (!text) return [];

  const foundCalls = [];

  const addCall = (obj) => {
    if (obj && obj.name && obj.arguments) {
      const isDup = foundCalls.some(c => c.name === obj.name && c.arguments === obj.arguments);
      if (!isDup) {
        foundCalls.push(obj);
      }
    }
  };

  // 1. Extract content from markdown JSON code blocks (e.g. ```json ... ```)
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  let cbMatch;
  while ((cbMatch = codeBlockRegex.exec(text)) !== null) {
    const inner = cbMatch[1].trim();
    // Try parsing the entire inner code block text (could be a single JSON object)
    const parsedWhole = tryParseJsonObjects(inner);
    parsedWhole.forEach(addCall);

    // If that fails or if there are multiple JSON objects inside the block, extract balanced JSON objects
    const objects = extractJsonObjects(inner);
    for (const obj of objects) {
      const parsed = tryParseJsonObjects(obj);
      parsed.forEach(addCall);
    }
  }

  // 2. Check for XML-like tags <tool_call>...</tool_call> (global match)
  const xmlRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let xmlMatch;
  while ((xmlMatch = xmlRegex.exec(text)) !== null) {
    const inner = xmlMatch[1].trim();
    const parsedWhole = tryParseJsonObjects(inner);
    parsedWhole.forEach(addCall);

    const objects = extractJsonObjects(inner);
    for (const obj of objects) {
      const parsed = tryParseJsonObjects(obj);
      parsed.forEach(addCall);
    }
  }

  // 3. Try parsing the whole text
  const parsedWhole = tryParseJsonObjects(text.trim());
  parsedWhole.forEach(addCall);

  // 4. Try extracting balanced JSON objects from the raw text
  const potentialJsons = extractJsonObjects(text);
  for (const pj of potentialJsons) {
    const parsed = tryParseJsonObjects(pj);
    parsed.forEach(addCall);
  }

  return foundCalls;
}

function cleanBackticksInJson(str) {
  const backtickRegex = /`([\s\S]*?)`/g;
  return str.replace(backtickRegex, (match, p1) => {
    const escaped = p1
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
    return `"${escaped}"`;
  });
}

function tryParseJsonObjects(str) {
  const results = [];
  const cleanStr = cleanBackticksInJson(str).trim();
  if (!cleanStr) return results;

  try {
    const parsed = JSON.parse(cleanStr);
    if (Array.isArray(parsed)) {
      parsed.forEach(item => {
        const extracted = extractToolCallFromObj(item);
        if (extracted) results.push(extracted);
      });
    } else {
      const extracted = extractToolCallFromObj(parsed);
      if (extracted) results.push(extracted);
    }
    return results;
  } catch (e) {}

  const lines = cleanStr.split('\n');
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    try {
      const parsed = JSON.parse(trimmedLine);
      const extracted = extractToolCallFromObj(parsed);
      if (extracted) results.push(extracted);
    } catch (e) {}
  }

  return results;
}

function extractToolCallFromObj(data) {
  if (data && typeof data === 'object') {
    if (data.name && (data.arguments || data.parameters || data.params)) {
      let args = data.arguments || data.parameters || data.params;
      if (typeof args !== 'string') {
        args = JSON.stringify(args);
      }
      return { name: data.name, arguments: args };
    }
    if (data.function && data.function.name) {
      let args = data.function.arguments || {};
      if (typeof args !== 'string') {
        args = JSON.stringify(args);
      }
      return { name: data.function.name, arguments: args };
    }
  }
  return null;
}

// ─── Core Execution Loop ──────────────────────────────────────────────────────

/**
 * Runs the agent on a user goal. Persists everything to PostgreSQL.
 *
 * @param {string}   goal      - The user's high-level goal
 * @param {Function} onEvent   - Called as onEvent(type: string, data: object) on every state change
 * @returns {Promise<{ sessionId: string, result: string }>}
 */
export async function runAgent(goal, onEvent = () => {}, sessionId = null, agent = 'OpenManus', model = null, summaryThreshold = null, useMemory = false, liveConfig = null) {
  let existingHistory = [];

  if (sessionId) {
    const rows = await query(`SELECT history FROM sessions WHERE id = $1`, [sessionId]);
    if (rows.length > 0) {
      const dbHistory = rows[0].history || [];
      existingHistory = sanitizeHistory(dbHistory);
      if (JSON.stringify(existingHistory) !== JSON.stringify(dbHistory)) {
        await query(`UPDATE sessions SET history = $1::jsonb WHERE id = $2`, [JSON.stringify(existingHistory), sessionId]);
        console.log(`[Agent] Sanitized history for resumed session ${sessionId} to resolve un-responded tool calls`);
      }
      await query(`UPDATE sessions SET status = 'running', updated_at = NOW() WHERE id = $1`, [sessionId]);
      console.log(`\n[Agent] Session ${sessionId} resumed`);
    } else {
      sessionId = await createSession(goal);
    }
  } else {
    sessionId = await createSession(goal);
  }

  onEvent('session_created', { sessionId });

  // Use liveConfig (DB-sourced) if provided, else fall back to static config
  const activeConfig = liveConfig ?? config;

  // Determine LLM endpoint routing
  const resolvedModel = model ?? activeConfig.ollama.model;
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
  const targetModelName = isOpenAI ? (OPENAI_MODEL_MAPPING[resolvedModel] ?? resolvedModel) : resolvedModel;

  const groqApiKey = activeConfig.groq?.apiKey || process.env.GROQ_API_KEY || '';
  if (isGroq && !groqApiKey) {
    const errMsg = 'GROQ_API_KEY is not configured. Please add it in Settings → Environments or in your .env file.';
    console.error(`[Agent] ${errMsg}`);
    await finaliseSession(sessionId, 'failed', errMsg).catch(() => {});
    onEvent('error', { message: errMsg });
    return { sessionId, result: errMsg };
  }

  console.log(`\n[Agent] Session ${sessionId} started/resumed (${agent} mode)`);
  console.log(`[Agent] Goal: ${goal}\n`);
 
  // Customize system prompt based on selected agent role
  let systemPrompt = SYSTEM_PROMPT;
  if (isGroq && getGroqTpmLimit(resolvedModel) <= 15000) {
    systemPrompt = `You are OpenManus, an autonomous AI agent executing tasks via tools.
Working dir: /workspace. Container: openmanus-sandbox. Root & Internet access enabled.
All exposed ports map to http://localhost:<port>.

CONVERSATIONAL QUERIES:
- If the request is purely conversational (e.g. writing a story/poem, general questions, greetings), do NOT call any tools. Respond directly in plain text.

WORKFLOW:
1. Checklist: Plan steps on your first turn.
2. Execute: Run tools step-by-step.
3. Verify: Check exitCodes, read files after writing, or query server status.

CRITICAL RULES:
- Before calling browse_web (except extract_text/screenshot), you MUST call inspect_page_html first to get the selector. Never guess selectors.
- Keep thoughts extremely brief (1-2 sentences) to fit context token limits.
- GENERATIVE UI: To render interactive forms/widgets in chat, output: \`<c1_ui><content>{ "type": "form", "fields": [...] }</content></c1_ui>\`. Do not write this to files or call tools for it.`;
  } else if (agent === 'CoderAgent') {
    systemPrompt += `\n\nAgent Profile: You are running in CoderAgent mode. Focus entirely on writing code, debugging, executing scripts in Node/Python/Bash, resolving environment packages, and performing math/data computations inside the Docker sandbox. Minimize web browsing unless specifically required to search for libraries.`;
  } else {
    // Both OpenManus and BrowserAgent utilize browser tools
    systemPrompt += `\n\n### CRITICAL PROTOCOL — MANDATORY FIND-BEFORE-ACT BROWSER PROTOCOL
Before you call any browse_web action (except 'extract_text' or 'screenshot'), you MUST adhere to the following workflow:
1. You MUST first call inspect_page_html with a query to find the element.
2. Under no circumstances should you ever call browse_web with a guessed selector. Guessing selectors will return an error and fail your run.
3. In your thought process immediately preceding the browse_web action call, you MUST explicitly state:
   - "I have inspected the page for element matching '<query>'."
   - "The cssSelector from the inspect result is '<cssSelector>' (or xpath is '<xpath>')."
4. If browse_web returns an error (e.g. element not found or not clickable), DO NOT repeat the same call. You must run inspect_page_html again with a different query to find the correct element or use evaluate to click it via JS.`;
  }

  // Inject long-term memories if enabled
  if (useMemory) {
    try {
      const memories = sessionId
        ? await query(`SELECT content FROM memories WHERE session_id IS NULL OR session_id = $1 ORDER BY created_at ASC`, [sessionId])
        : await query(`SELECT content FROM memories WHERE session_id IS NULL ORDER BY created_at ASC`);
      if (memories.length > 0) {
        const memoryText = memories.map((m, index) => {
          const content = m.content.length > 400 ? m.content.slice(0, 400) + '...' : m.content;
          return `${index + 1}. ${content}`;
        }).join('\n');
        systemPrompt += `\n\n### GLOBAL REMEMBERED FACTS (LONG-TERM MEMORY)\n` +
          `The following useful facts/details have been remembered from past conversations. Use them to guide your decisions, configurations, or responses:\n` +
          `${memoryText}`;
        console.log(`[Agent] Injected ${memories.length} global memories into system prompt.`);
      } else {
        console.log(`[Agent] Memory enabled, but no global memories found in database.`);
      }
    } catch (memErr) {
      console.warn(`[Agent] Failed to retrieve global memories:`, memErr.message);
    }
  }



  let llmClient;
  if (isOpenAI) {
    const openaiKey = activeConfig.openai?.apiKey || process.env.OPENAI_API_KEY || '';
    const openaiURL = activeConfig.openai?.baseURL;
    llmClient = new OpenAI({
      apiKey:  openaiKey,
      ...(openaiURL && openaiURL !== 'https://api.openai.com/v1' ? { baseURL: openaiURL } : {}),
    });
  } else if (isGroq) {
    llmClient = new OpenAI({
      baseURL: activeConfig.groq?.baseURL || 'https://api.groq.com/openai/v1',
      apiKey:  groqApiKey,
    });
  } else {
    llmClient = new OpenAI({
      baseURL: activeConfig.ollama.baseURL,
      apiKey:  activeConfig.ollama.apiKey,
    });
  }

  console.log(`[Agent] Route LLM | model=${resolvedModel} (mapped to ${targetModelName}) provider=${isOpenAI ? 'OpenAI' : isGroq ? 'Groq' : 'Ollama'}`);

  try {
    const activeBrowser = await getActiveBrowserState().catch(() => null);
    let userContent = goal;
    if (activeBrowser) {
      userContent = `[LIVE BROWSER CONTEXT]\n` +
                    `URL: ${activeBrowser.url}\n` +
                    `Title: ${activeBrowser.title}\n` +
                    `Current Page Text Content:\n${activeBrowser.text}\n\n` +
                    `User request:\n${goal}`;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...existingHistory,
      { role: 'user',   content: userContent },
    ];

    await query(`UPDATE sessions SET system_prompt = $1 WHERE id = $2`, [systemPrompt, sessionId]).catch(() => {});
    await appendHistory(sessionId, [{ role: 'user', content: userContent }]);

  let finalAnswer = '';
  const MAX_STEPS = activeConfig.agent?.maxSteps ?? 100;
  let consecutiveFailures = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    console.log(`[Agent] Step ${step + 1}/${MAX_STEPS}`);
    onEvent('step', { step: step + 1, total: MAX_STEPS });

    // ── Auto-summarize if context is getting large ────────────────────────────
    let threshold = summaryThreshold ? Number(summaryThreshold) : null;
    if (!threshold) {
      if (isGroq) {
        const groqTpmLimit = getGroqTpmLimit(resolvedModel);
        threshold = Math.floor(groqTpmLimit * 0.70); // 70% of TPM limit (in tokens)
      } else {
        const isLargeContextModel = isOpenAI || (resolvedModel && (
          resolvedModel.includes('13b') || 
          resolvedModel.includes('14b') || 
          resolvedModel.includes('32b') || 
          resolvedModel.includes('70b') || 
          resolvedModel.includes('e4b')
        ));
        threshold = isLargeContextModel ? 80000 : 40000;
      }
    }
    const SUMMARIZE_TOKEN_THRESHOLD = Number(process.env.SUMMARIZE_THRESHOLD ?? threshold);
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');
    if (estimateTokens(nonSystemMsgs) > SUMMARIZE_TOKEN_THRESHOLD) {
       const sumResult = await summarizeHistory(llmClient, targetModelName, nonSystemMsgs, onEvent, isGroq);
      if (sumResult) {
        // Replace messages: keep system prompt + summarized history
        messages.splice(1, messages.length - 1, ...sumResult.summarized);
        console.log(`[Agent] Context compressed. New message count: ${messages.length}`);
        
        // Write the summarized history back to the database so that subsequent resumes/turns start from this baseline
        await query(`UPDATE sessions SET history = $1::jsonb WHERE id = $2`, [JSON.stringify(sumResult.summarized), sessionId]).catch((dbErr) => {
          console.warn('[Agent] Failed to persist summarized history to database:', dbErr.message);
        });
      }
    }

    // ── Call the LLM (streaming) ──────────────────────────────────────────────
    onEvent('llm_thinking', { step: step + 1 });

    let stream;
    try {
      stream = await llmClient.chat.completions.create({
        model:       targetModelName,
        messages,
        tools:       getToolDefinitions(isGroq),
        tool_choice: 'auto',
        stream:      true,   // ← live token streaming
        // Ollama-specific options — ignored by OpenAI (extra_body is forwarded as-is)
        ...(!isOpenAI && !isGroq ? {
          options: {
            // Dynamically scale context limit based on threshold so Ollama doesn't silently truncate messages
            num_ctx:  Number(process.env.OLLAMA_NUM_CTX  ?? (Math.ceil(threshold / 4) + 8192)),
            num_gpu:  Number(process.env.OLLAMA_NUM_GPU  ?? -1),    // -1 = offload all layers to GPU
            num_thread: Number(process.env.OLLAMA_NUM_THREAD ?? 8), // CPU thread cap for hybrid mode
          },
        } : {}),
      });
    } catch (err) {
      let msg = err.message ?? String(err);
      if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
        msg = `Cannot connect to Ollama at ${config.ollama.baseURL}.\nMake sure Ollama is running:  ollama serve`;
      } else if (msg.includes('model') && (msg.includes('not found') || msg.includes('pull'))) {
        msg = `Model "${config.ollama.model}" not found in Ollama.\nPull it first:  ollama pull ${config.ollama.model}\nAvailable:  ollama ls`;
      } else if (msg.includes('404')) {
        msg = `Ollama returned 404 — model "${config.ollama.model}" is not loaded.\nTry:  ollama run ${config.ollama.model}`;
      }
      console.error('[Agent] LLM call failed:', msg);
      await finaliseSession(sessionId, 'failed', msg).catch(() => {});
      onEvent('error', { message: msg });
      return { sessionId, result: msg };
    }

    // ── Consume the stream ────────────────────────────────────────────────────
    let fullContent  = '';
    let finishReason = null;
    const tcAccum    = {};  // index → accumulated tool-call object
    let inThinkingMode = false;

    try {
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;

        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta ?? {};

        // ── Reasoning / Thinking token ─────────────────────────────────────────
        const reasoning = delta.reasoning_content || delta.reasoning;
        if (reasoning) {
          fullContent += reasoning;
          onEvent('text_delta', { text: reasoning, isReasoning: true });
          continue;
        }

        // ── Text token ─────────────────────────────────────────────────────────
        let text = delta.content || '';
        if (text) {
          fullContent += text;
          
          const window = fullContent.slice(-15);
          if (window.includes('<think>') && !inThinkingMode) {
            inThinkingMode = true;
          }
          
          onEvent('text_delta', { text: text, isReasoning: inThinkingMode });

          if (window.includes('</think>') && inThinkingMode) {
            inThinkingMode = false;
          }
        }

        // ── Tool-call fragment ─────────────────────────────────────────────────
        if (delta.tool_calls?.length) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!tcAccum[idx]) {
              tcAccum[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
            }
            const a = tcAccum[idx];
            if (tc.id)                  a.id                  = tc.id;
            if (tc.function?.name)      a.function.name      += tc.function.name;
            if (tc.function?.arguments) a.function.arguments += tc.function.arguments;
          }
        }
      }
    } catch (streamErr) {
      console.error('[Agent] Stream read error:', streamErr.message);
    }

    let toolCalls    = Object.values(tcAccum);
    let hasToolCalls = toolCalls.length > 0;

    // Fallback: if no native tool calls were returned, check if the model output a tool call in the text
    if (!hasToolCalls) {
      const parsedCalls = parseTextToolCalls(fullContent);
      if (parsedCalls.length > 0) {
        console.log(`[Agent] Fallback: parsed ${parsedCalls.length} tool call(s) from text content.`);
        toolCalls = parsedCalls.map((call, index) => {
          const fallbackCallId = `call_fb_${Math.random().toString(36).substring(2, 10)}_${index}`;
          return {
            id: fallbackCallId,
            type: 'function',
            function: {
              name: call.name,
              arguments: call.arguments
            }
          };
        });
        hasToolCalls = true;
      }
    }

    // If the model output some text AND then chose a tool, clear the streamed
    // text from the UI — it was internal reasoning, not the final answer.
    if (hasToolCalls && fullContent) {
      onEvent('clear_stream', {});
    }

    // Reconstruct the message object for history
    const message = {
      role:    'assistant',
      content: fullContent || null,
      ...(hasToolCalls ? { tool_calls: toolCalls } : {}),
    };

    messages.push(message);
    await appendHistory(sessionId, [message]).catch(() => {});

    // ── Final answer (no tool calls) ──────────────────────────────────────────
    if (!hasToolCalls) {
      finalAnswer = fullContent;
      // text_delta events already sent each token; send answer to finalise UI
      onEvent('answer', { text: finalAnswer });
      console.log(`\n[Agent] Final answer (${finalAnswer.length} chars)`);
      break;
    }

    // ── Dispatch tool calls ───────────────────────────────────────────────────
    for (const tc of message.tool_calls) {
      const toolName = tc.function.name;
      let args;
      try {
        args = JSON.parse(tc.function.arguments ?? '{}');
      } catch {
        args = {};
      }

      console.log(`[Agent] → Tool: ${toolName}`);
      onEvent('tool_start', { id: tc.id, tool: toolName, args });

      let toolResult;
      let toolError = null;
      try {
        toolResult = await dispatchTool(toolName, args, llmClient, targetModelName, sessionId);
      } catch (err) {
        toolError  = err.message;
        toolResult = JSON.stringify({ error: err.message });
        console.error(`[Agent] Tool "${toolName}" threw:`, err.message);
      }

      // Emit result with structured data for the UI
      let parsedResult = toolResult;
      try { parsedResult = JSON.parse(toolResult); } catch { /* keep raw */ }

      onEvent('tool_result', {
        id:     tc.id,
        tool:   toolName,
        result: parsedResult,
        raw:    toolResult,
        error:  toolError,
      });

      await appendLog(sessionId, {
        step, tool: toolName, args, result: toolResult, ts: new Date().toISOString(),
      });

      let maxToolChars = Number(process.env.MAX_TOOL_RESULT_CHARS ?? 3000);
      if (isGroq && getGroqTpmLimit(resolvedModel) <= 15000) {
        maxToolChars = 1200; // tighten limit for models with low TPM to avoid 413s
      }
      const truncatedResult = toolResult.length > maxToolChars
        ? toolResult.slice(0, maxToolChars) + `\n...[truncated, ${toolResult.length - maxToolChars} more chars]`
        : toolResult;

      // ── Determine failure & prefix result for LLM visibility ──────────────
      let isFailure = false;
      let failureReason = '';

      if (toolError) {
        isFailure = true;
        failureReason = `Tool threw an exception: ${toolError}`;
      } else if (parsedResult && typeof parsedResult === 'object') {
        if (parsedResult.exitCode !== undefined && parsedResult.exitCode !== 0) {
          isFailure = true;
          failureReason = `exitCode=${parsedResult.exitCode}. stderr: ${parsedResult.stderr || '(none)'}`.slice(0, 400);
        } else if (parsedResult.error !== undefined) {
          isFailure = true;
          failureReason = String(parsedResult.error).slice(0, 400);
        }
      }

      // Prefix tool result content with ERROR banner so LLM cannot miss it
      const resultContent = isFailure
        ? `[TOOL ERROR] ${toolName} FAILED.\nReason: ${failureReason}\n\nFull result:\n${truncatedResult}`
        : truncatedResult;

      const toolMessage = {
        role:         'tool',
        tool_call_id: tc.id,
        content:      resultContent,
      };
      messages.push(toolMessage);
      await appendHistory(sessionId, [toolMessage]);

      console.log(`[Agent] ← ${toolName} result (${toolResult.length} chars)${isFailure ? ' [FAILURE]' : ''}`);

      // Inject an immediate system-level failure notice so the LLM cannot skip past it
      if (isFailure) {
        const failureNotice = {
          role: 'system',
          content: `[TOOL FAILURE NOTICE] The tool "${toolName}" just FAILED.\nReason: ${failureReason}\n\nYou MUST:\n1. Acknowledge this failure explicitly.
2. Read the full error above carefully.
3. Diagnose the root cause.
4. Fix it and retry — do NOT call a different tool or move on.
5. NEVER say the task is complete or successful while this error exists.
Do NOT proceed past this step until "${toolName}" succeeds.`,
        };
        messages.push(failureNotice);
        await appendHistory(sessionId, [failureNotice]).catch(() => {});
        console.log(`[Agent] ↯ Injected failure notice for "${toolName}"`);
      }

      if (isFailure) {
        consecutiveFailures++;
      } else {
        consecutiveFailures = 0;
      }

      if (consecutiveFailures === 3) {
        const warningMsg = {
          role: 'system',
          content: `[SYSTEM WARNING] You have encountered ${consecutiveFailures} consecutive tool failures. You are stuck. STOP calling tools. Tell the user what went wrong and ask for help.`
        };
        messages.push(warningMsg);
        await appendHistory(sessionId, [warningMsg]).catch(() => {});
        console.log(`[Agent] ${consecutiveFailures} consecutive failures. Injected escalation warning.`);
      }
    }
  }

  if (!finalAnswer) {
    finalAnswer = '[Agent reached step limit without a final answer]';
    onEvent('answer', { text: finalAnswer });
  }

  await finaliseSession(sessionId, 'done', finalAnswer);
  onEvent('done', { sessionId, result: finalAnswer });
  console.log(`[Agent] Session ${sessionId} complete`);

  return { sessionId, result: finalAnswer };
  } finally {
    // Commented out to ensure user access persistence for background servers and assets.
    // The container will stay alive so that the user can access web servers or files created inside it.
    // await cleanupSandbox().catch(err => console.error('[Agent] Sandbox cleanup failed:', err.message));
    console.log('[Agent] Persistent container left running for user access');
  }
}
// End of agent orchestrator script.

