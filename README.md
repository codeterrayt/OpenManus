# 🤖 OpenManus — Local-First Autonomous AI Action Engine

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2020.0.0-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-%E2%89%A5%2014-blue.svg)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Enabled-blue.svg)](https://www.docker.com/)
[![React](https://img.shields.io/badge/React-18%2F19-cyan.svg)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.0-blueviolet.svg)](https://tailwindcss.com/)

OpenManus is an open-source, local-first autonomous AI action engine designed to orchestrate complex reasoning, coding, and web-browsing workflows. Inspired by the capabilities of next-generation AI assistants like Manus, OpenManus allows developers and power users to deploy agentic loops directly on their machines. The engine handles long-running goals by writing code, executing scripts in an isolated sandbox, and navigating the web, while presenting a real-time interactive remote browser screen. This stream enables users to observe the agent's progress and actively guide the session by interacting with the browser interface in real time.

---

## 📽️ Demo & Screenshots

*(Insert GIF demonstrating live browser control, terminal execution, and settings toggling here)*

<!-- GIF PLACEHOLDER -->
```
[DEMO GIF PLACEHOLDER]
```

---

## 🌟 Capabilities & Features

Select any section below to learn how it works under the hood:

<details>
<summary><b>🎭 3 Specialized Agent Roles</b></summary>

OpenManus optimizes performance by offering three specialized agent personas that can be selected directly in the chat panel depending on the task:
- **`OpenManus` (Autonomous Orchestrator):** The default general-purpose planner that handles standard tasks, tool selection, and reasoning.
- **`CoderAgent` (Software Developer):** Focuses on code generation, script execution, environment resolution, and math/data tasks inside the Docker sandbox.
- **`BrowserAgent` (Web Researcher):** Optimizes search, web browsing, scraping, and remote interaction.
</details>

<details>
<summary><b>🔒 Safe Isolated Docker Sandbox</b></summary>

All code execution (Python, Node.js, Shell scripts) happens inside isolated Docker containers:
- **Tar Injections:** Avoids volume mounts, pushing scripts into containers via tar streams.
- **Safety Caps:** Restricts resources to a 256MB memory quota, 50% CPU single-core limit, PID quota of 64, and a 30s hardware timeout constraint.
- **Auto-Cleanup:** Automatically force-removes the container after every execution step.
</details>

<details>
<summary><b>💻 Coding, File Creation & Live Hosted URLs</b></summary>

The agent has full read/write access to the workspace directory to build complete projects:
- **Workspace File Management:** Reads, writes, modifies, and deletes files directly within the local workspace.
- **Live Local Servers:** The agent can spin up development servers (like React Vite, Express, or Python Flask) inside the environment.
- **Link Recognition:** If a local server is started, it is automatically exposed on `localhost` and rendered as a live, clickable host URL in the chat and execution panel.
</details>

<details>
<summary><b>🛠️ Workflows & Skills Store</b></summary>

OpenManus features a database-backed **Skills Store** that allows the agent to save and reuse complex workflows:
- **Workflow Distillation:** The agent can bundle a multi-step workflow (such as scraping a site, extracting data, and formatting a report) into a reusable skill.
- **Interactive Execution:** Call upon saved skills inside chat sessions to perform automated routines.
</details>

<details>
<summary><b>🧠 Long-Term Postgres Memory</b></summary>

- **Persistent Facts:** Remembers folders, habits, preferences, or credentials across separate chat sessions.
- **LLM Consolidation:** Periodically merges duplicate memories into a compact list using LLM consolidation to minimize context-window footprint.
</details>

<details>
<summary><b>⚡ Context Compacting & AI Summary</b></summary>

- Configurable **Summarization Threshold** (in characters).
- Automatically compacts old messages and logs when chat size exceeds the limit, maintaining the agent's core context window.
</details>

<details>
<summary><b>📊 Agent Workspace & Session Diagnostics</b></summary>

The Diagnostics & Inspector panel on the right side of the interface provides deep visibility into the agent's active session:
- **Timeline:** Visualization of task steps and agent execution timeline.
- **Thoughts:** The agent's raw chain-of-thought (thinking blocks) parsed from `<thinking>` tags.
- **Logs:** Raw logs showing command outputs and terminal execution history.
- **JSON:** Full session JSON state inspector.
- **Browser:** Live interactive browser player (CDP stream canvas player).
- **Files:** Workspace file explorer allowing you to read/inspect files created by the agent in real time.
- **Prompt:** Inspection of the dynamic System Prompt and injected messages history.
</details>

---

## 🛠️ Prerequisites

Make sure you have these installed:
- **Node.js** (version `20.x` or higher)
- **pnpm** package manager
- **PostgreSQL** running locally (or via Docker Compose)
- **Docker Desktop** (with "Expose daemon on tcp://localhost:2375" checked in settings on Windows)
- **Ollama (Optional):** If you want to use local models (like `qwen2.5:7b` or `gemma2`). OpenManus also natively supports Groq and OpenAI cloud providers out-of-the-box.

---

## 🚀 Quick Start & Installation

### 1. Database Setup (Docker Compose)
Run the pre-configured Postgres database container:
```bash
# Starts PostgreSQL (exposed on port 5432) and pgAdmin (on port 5050)
pnpm run docker:up
```
*Note: The schema is automatically applied and seeded with initial skills on first boot.*

### 2. Environment Variables
Copy the template and adjust values:
```bash
cp .env.example .env
```
Inside your `.env`, specify your database credentials:
```env
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=openmanus
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
```

### 3. Install Dependencies
OpenManus is structured as a pnpm monorepo workspace. Run the install command at the root to set up dependencies for both the backend and frontend:
```bash
# Installs both backend & frontend package dependencies
pnpm install
```

### 4. Install Browser Binary
Installs the headless Chrome binary needed for web browsing:
```bash
pnpm run browser:install
```

### 5. Launch the Platform
Start both the Express backend and Vite frontend concurrently:
```bash
pnpm run dev:all
```

- **Frontend Client:** Visit [http://localhost:5173](http://localhost:5173).
- **Backend API:** Running at [http://localhost:3000](http://localhost:3000).

---

## 📄 License
This project is open-source software licensed under the [MIT License](./LICENSE).
