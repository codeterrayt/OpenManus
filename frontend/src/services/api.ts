// src/services/api.ts

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolLog {
  step: number;
  tool: string;
  args: any;
  result: string;
  ts: string;
}

export interface Session {
  id: string;
  created_at: string;
  updated_at: string;
  goal: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  history: Message[];
  logs: ToolLog[];
  result: string | null;
  system_prompt?: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  model: string;
  ollamaUrl: string;
  db: 'ok' | 'error';
  dbError: string | null;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const api = {
  /**
   * Check system health (server + db)
   */
  async checkHealth(): Promise<HealthResponse> {
    const res = await fetch(`${API_BASE_URL}/health`);
    if (!res.ok) throw new Error('API server unreachable');
    return res.json();
  },

  /**
   * Retrieve the last 50 session items (metadata only)
   */
  async getSessions(): Promise<Partial<Session>[]> {
    const res = await fetch(`${API_BASE_URL}/sessions`);
    if (!res.ok) throw new Error('Failed to fetch sessions');
    return res.json();
  },

  /**
   * Retrieve list of available models (Ollama + OpenAI with pricing)
   */
  async getModels(): Promise<{
    ollama: string[];
    openai: Array<{ id: string; name: string; pricing: string; inputPrice: string; outputPrice: string }>;
    groq: Array<{ id: string; name: string; pricing: string; limits?: string; inputPrice?: string; outputPrice?: string }>;
  }> {
    const res = await fetch(`${API_BASE_URL}/models`);
    if (!res.ok) throw new Error('Failed to fetch models');
    return res.json();
  },

  /**
   * Retrieve a single session by ID (includes history and logs)
   */
  async getSession(id: string): Promise<Session> {
    const res = await fetch(`${API_BASE_URL}/sessions/${id}`);
    if (!res.ok) throw new Error('Failed to fetch session detail');
    return res.json();
  },

  /**
   * SSE Stream Parser for running the agent
   */
  async streamAgent(
    goal: string,
    onEvent: (event: string, data: any) => void,
    signal?: AbortSignal,
    sessionId?: string | null,
    agent?: string,
    model?: string,
    summaryThreshold?: number,
    useMemory?: boolean
  ): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ goal, sessionId, agent, model, summaryThreshold, useMemory }),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown error');
      throw new Error(`Failed to start agent: ${errText || res.statusText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('SSE stream is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (signal?.aborted) {
          await reader.cancel();
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // Save the last incomplete chunk to buffer
        buffer = lines.pop() || '';

        let currentEvent = '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Parse event: line
          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.substring(6).trim();
          } 
          // Parse data: line
          else if (trimmed.startsWith('data:')) {
            const rawData = trimmed.substring(5).trim();
            let parsedData = rawData;
            try {
              parsedData = JSON.parse(rawData);
            } catch (_) {
              // Leave as string if not JSON
            }
            onEvent(currentEvent || 'message', parsedData);
            currentEvent = ''; // reset after data consumption
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('[API] Stream request aborted.');
      } else {
        throw err;
      }
    } finally {
      reader.releaseLock();
    }
  },

  /**
   * Reset the persistent browser and Docker sandbox session
   */
  async resetSession(): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/reset`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to reset backend session');
  },

  /**
   * Fetch all global memory items
   */
  async getMemories(): Promise<Array<{ id: string; created_at: string; content: string }>> {
    const res = await fetch(`${API_BASE_URL}/memories`);
    if (!res.ok) throw new Error('Failed to fetch memories');
    return res.json();
  },

  /**
   * Add a new memory item manually
   */
  async addMemory(content: string): Promise<{ id: string; created_at: string; content: string }> {
    const res = await fetch(`${API_BASE_URL}/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (!res.ok) throw new Error('Failed to add memory');
    return res.json();
  },

  /**
   * Edit/update an existing memory item
   */
  async updateMemory(id: string, content: string): Promise<{ id: string; created_at: string; content: string }> {
    const res = await fetch(`${API_BASE_URL}/memories/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (!res.ok) throw new Error('Failed to update memory');
    return res.json();
  },

  /**
   * Delete a memory item
   */
  async deleteMemory(id: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/memories/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete memory');
  },

  /**
   * Delete all memory items
   */
  async deleteAllMemories(): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/memories`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete all memories');
  },

  async summarizeMemories(model?: string): Promise<{ success: boolean; memories: Array<{ id: string; created_at: string; content: string }> }> {
    const res = await fetch(`${API_BASE_URL}/memories/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model })
    });
    if (!res.ok) throw new Error('Failed to summarize memories');
    return res.json();
  },

  /**
   * Retrieve list of files inside the container workspace
   */
  async getSessionFiles(id: string): Promise<string[]> {
    const res = await fetch(`${API_BASE_URL}/sessions/${id}/files`);
    if (!res.ok) throw new Error('Failed to fetch session files');
    return res.json();
  },

  /**
   * Fetch file content from the container workspace
   */
  async getFileContent(id: string, path: string): Promise<{ content: string }> {
    const res = await fetch(`${API_BASE_URL}/sessions/${id}/files/content?path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error('Failed to fetch file content');
    return res.json();
  }
};
