# 🤖 OpenManus — Local-First Autonomous AI Action Engine

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2020.0.0-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-%E2%89%A5%2014-blue.svg)](https://www.postgresql.org/)
[![Neo4j](https://img.shields.io/badge/Neo4j-Graph%20Database-008cc1.svg)](https://neo4j.com/)
[![Docker](https://img.shields.io/badge/Docker-Enabled-blue.svg)](https://www.docker.com/)
[![React](https://img.shields.io/badge/React-19-cyan.svg)](https://react.dev/)
[![Monaco Editor](https://img.shields.io/badge/Monaco_Editor-VS_Code_Web-007acc.svg)](https://microsoft.github.io/monaco-editor/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.0-blueviolet.svg)](https://tailwindcss.com/)

OpenManus is an open-source, local-first autonomous AI action engine designed to orchestrate complex reasoning, live coding, memory distillation, and web-browsing workflows. Inspired by next-generation agentic systems, OpenManus empowers developers and power users to deploy multi-role agent loops directly on their local machines. 

The platform pairs long-running autonomous execution in an isolated Docker sandbox with real-time interactive browser streaming, an integrated VS Code Web (Monaco Editor) live code stream, a Mem0 multi-tier Knowledge Graph engine (backed by Neo4j and PostgreSQL), dynamic reasoning controls, and an executive dark obsidian UI.

---

## 📽️ Demo & Screenshots

*(Insert GIF demonstrating live browser control, Monaco code streaming, Knowledge Graph visualization, and settings toggling here)*

<!-- GIF PLACEHOLDER -->
```
[DEMO GIF PLACEHOLDER]
```

---

## 🌟 Capabilities & Features

Select any section below to learn how each subsystem operates:

<details>
<summary><b>🧠 Mem0 Multi-Tier Memory & Knowledge Graph</b></summary>

OpenManus integrates an enterprise-grade memory engine combining relational storage and graph structures:
- **4-Tier Architecture:** Stores **Factual** (user preferences, system configurations, facts), **Episodic** (past execution steps, tool results), **Context** (summaries), and **Knowledge Graph** relations.
- **Dual Graph Backend:** Native **Neo4j 5** integration (via Bolt protocol and APOC plugins) with an automatic PostgreSQL fallback if Neo4j is offline.
- **Interactive Knowledge Graph Canvas:** Visual graph explorer directly in Settings with physics-based layout, draggable nodes, relationship labels, and one-click node deletion.
- **Canonical Hub Clustering:** Eliminates 2-node clutter by anchoring personal attributes to a canonical `User` hub and clustering topics around shared category nodes.
- **Tokenized Memory Search & Global Prompt Injection:** Automatically extracts relevant memories using tokenized similarity search and injects them into the agent's prompt across sessions.
</details>

<details>
<summary><b>💻 VS Code Web (Monaco Editor) & Live Code Streaming</b></summary>

Observe the agent's code creation in real time without refreshing or leaving the chat:
- **Claude-Style Live Streaming:** Watches file creation and edits as they happen, streaming syntax-highlighted code character-by-character into an embedded Monaco editor.
- **Automatic Panel Expansion:** Automatically opens and expands the editor workspace whenever the agent invokes file write or modify tools.
- **Multi-Language Support:** Rich syntax highlighting and formatting for TypeScript, JavaScript, Python, HTML/CSS, JSON, Markdown, Shell scripts, and SQL.
- **Interactive Tools:** Includes minimap toggle, word wrap, copy-to-clipboard, full-screen expansion, file downloads, and clickable chat file chips that navigate directly to the file.
</details>

<details>
<summary><b>⚡ Dynamic Thinking & Reasoning Controls</b></summary>

Take full control over reasoning models:
- **Dual Parameter Support:** Configure **Anthropic Claude Thinking Budgets** (1K, 2K, 4K, 8K, 16K, 32K, 64K, or custom) and **OpenAI Reasoning Effort** (`low`, `medium`, `high`).
- **Capability Auto-Detection:** Dynamically senses whether the active model supports token-budgeted or effort-based reasoning.
- **Auto-Recovery:** Automatically recovers and strips unsupported reasoning arguments when routing to models or providers that reject them.
</details>

<details>
<summary><b>🌐 Custom AI Providers & Universal OpenAI-Compatible Routing</b></summary>

Connect any LLM provider effortlessly:
- **Custom Provider Manager:** Add, edit, test, and toggle third-party providers in the Settings modal (vLLM, LM Studio, OpenRouter, Together AI, Groq, Ollama, OpenAI).
- **Dynamic Model Discovery:** Automatically queries `/v1/models` endpoints to discover available models in real time.
- **Hybrid Storage:** Store credentials locally in `.env` or persistently in the database (`env_settings`) with masked secret protection.
- **Claude-Desktop Compatible Headers:** Normalizes base URLs and injects compatible User-Agent headers to ensure seamless connection to proprietary endpoints.
</details>

<details>
<summary><b>🔄 Context History Strategies & Compacting Controls</b></summary>

Prevent context-window overflow and maintain pinpoint agent accuracy:
- **3 Context Strategies:** Select between **Rolling Summary**, **Sliding Window**, or **Full History**.
- **Turn Depth Control:** Define the exact number of recent conversation turns (`keepRecentTurns`) to preserve verbatim.
- **Token Compression Threshold:** Configure token volume limits (10k–120k tokens) to automatically trigger background compaction.
- **On-Demand Compaction:** Manually compress active session history at any time with a single click.
</details>

<details>
<summary><b>🎨 Executive Dark Obsidian Interface (Taste Skill Anti-Slop Design)</b></summary>

A distraction-free interface engineered for deep work:
- **Monochromatic Obsidian Palette:** Replaces generic rainbow gradients with purposeful dark obsidian surfaces (`#0E121B`, `#0A0C13`).
- **Master-Detail Settings Modal:** Categorized settings with reactive controls across General, Models, Memory & Graph, and Environment.
- **Per-Response Analytics:** Live tracking of input/output token volume, execution duration, step counts, and cost estimates.
- **Dynamic Tool Indicators:** Visual feedback for active agent actions (Reading, Writing, Sandbox Execution, Web Browsing).
- **Execution Watchdog & Instant Stop:** Real-time watchdog monitoring agent runs with an instant-abort Stop button.
- **Session Persistence & SSE Reconnect:** Reconnecting EventSource client ensures zero dropped sessions across page reloads.
</details>

<details>
<summary><b>🔒 Persistent Docker Sandbox & Docker-in-Docker</b></summary>

All code execution (Python, Node.js, Shell scripts) runs inside a persistent, secure Docker sandbox container:
- **In-Memory Tar Streams:** Pushes scripts and assets into the sandbox via tar stream archives to bypass host filesystem volume limitations.
- **Persistent Runtimes:** The container remains running throughout the session to retain installed dependencies (`pip install`, `npm install`).
- **Docker-in-Docker:** Mounts the host's `/var/run/docker.sock` to enable multi-container builds and nested service orchestration.
- **Resource Constraints:** Enforces a 512MB RAM cap, 80% CPU throttle, and a PID limit of 128 to block runaway processes.
</details>

<details>
<summary><b>🎭 3 Specialized Agent Roles</b></summary>

Optimize execution efficiency by picking specialized agent personas:
- **`OpenManus` (Autonomous Orchestrator):** The default general-purpose planner handling standard tasks, multi-step orchestration, and tool selection.
- **`CoderAgent` (Software Developer):** Focused on code synthesis, script execution, dependency resolution, and data analysis in the Docker sandbox.
- **`BrowserAgent` (Web Researcher):** Specialized in web search, DOM extraction, browser navigation, and scraping.
</details>

<details>
<summary><b>🛠️ Workflows & Skills Store</b></summary>

Save and reuse complex workflows through the database-backed Skills Store:
- **Workflow Distillation:** Distill multi-step execution traces into parameterized, reusable skills.
- **Interactive Execution:** Trigger registered skills directly within chat sessions.
</details>

<details>
<summary><b>📊 Diagnostics & Inspector Workspace</b></summary>

The collapsible inspector panel on the right offers total visibility into the agent's internal state:
- **Timeline:** Interactive step-by-step execution timeline with expandable action cards.
- **Thoughts:** Raw chain-of-thought parsed from `<thinking>` tags.
- **Console:** Real-time terminal streaming of stdout/stderr outputs.
- **JSON:** Complete live session state inspector.
- **Browser:** Interactive Chrome DevTools Protocol (CDP) live canvas stream.
- **Files:** Real-time workspace file tree with instant code preview.
- **Prompt:** Live inspection of dynamic system prompt templates and memory injections.
</details>

---

## 🛠️ Prerequisites

Ensure the following tools are installed:
- **Node.js** (`>= 20.0.0`)
- **pnpm** package manager
- **Docker Desktop** (with "Expose daemon on tcp://localhost:2375" enabled on Windows)
- **PostgreSQL & Neo4j** (Automated via Docker Compose)
- **Ollama (Optional):** For local models (`qwen2.5:7b`, `gemma2`). OpenManus also natively supports Groq, OpenAI, and custom OpenAI-compatible cloud endpoints.

---

## 🚀 Quick Start & Installation

### 1. Database & Graph Services Setup (Docker Compose)
Start the pre-configured PostgreSQL, Neo4j, and pgAdmin containers:
```bash
# Starts PostgreSQL (5432), Neo4j (7474/7687), and pgAdmin (5050)
pnpm run docker:up
```
*Note: The database schema is automatically applied and seeded with core tables and skills on first boot.*

### 2. Environment Configuration
Copy the template and configure your local or cloud endpoints:
```bash
cp .env.example .env
```
Inside your `.env`, review or customize your connection strings:
```env
# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=openmanus
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

# Neo4j (Mem0 Knowledge Graph)
NEO4J_ENABLED=true
NEO4J_URL=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=openmanus_password

# Cloud LLMs (Optional)
OPENAI_API_KEY=
GROQ_API_KEY=
```

### 3. Install Dependencies
OpenManus is structured as a pnpm monorepo workspace. Running install at the root installs all backend and frontend dependencies:
```bash
pnpm install
```

### 4. Install Browser Binary
Download and configure the headless Chrome binary needed for web navigation:
```bash
pnpm run browser:install
```

### 5. Launch the Platform
Start the Express backend and Vite frontend concurrently:
```bash
pnpm run dev:all
```

- **Frontend Client:** [http://localhost:5173](http://localhost:5173)
- **Backend API:** [http://localhost:3000](http://localhost:3000)
- **Neo4j Graph Browser:** [http://localhost:7474](http://localhost:7474) *(User: `neo4j` / Password: `openmanus_password`)*
- **pgAdmin 4 Web UI:** [http://localhost:5050](http://localhost:5050) *(Email: `admin@openmanus.local` / Password: `admin`)*

---

## 🔒 Security & Secrets Hygiene

OpenManus follows strict security and credential-handling protocols:
- **Repository Isolation:** `.gitignore` is configured with strict patterns (`.env`, `.env.*`, `*.env`, `*.pem`, `*.key`, `*.cert`) to prevent any local environment configurations or private keys from being staged or committed. Only `.env.example` is tracked as a template.
- **Masked Database Storage:** When using dynamic DB-backed settings (`ENV_SOURCE=db`), secrets like `OPENAI_API_KEY`, `GROQ_API_KEY`, `NEO4J_PASSWORD`, and `POSTGRES_PASSWORD` are masked before returning via the API.
- **Container Sandboxing:** All arbitrary code generated by the agent is executed within the sandboxed Docker container with strict CPU, RAM, and PID limitations.

---

## 📄 License
This project is open-source software licensed under the [MIT License](./LICENSE).
