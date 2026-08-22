// src/store/useChatStore.ts
import { create } from 'zustand';
import { api } from '../services/api';
import type { Session, ToolLog } from '../services/api';

export interface LiveToolCall {
  id: string;
  name: string;
  args: any;
  status: 'running' | 'success' | 'error';
  result?: any;
  error?: string;
  startTime: number;
  duration?: number;
}

export const formatToolActivity = (tool: string, args: any): string => {
  if (!args) return `Executing ${tool}...`;
  switch (tool) {
    case 'readFile':
    case 'read_file':
      return `Reading file: ${args.path || 'file'}`;
    case 'writeFile':
    case 'write_file': {
      const lines = args.content ? args.content.split('\n').length : 0;
      return `Writing file: ${args.path || 'file'}${lines > 0 ? ` (${lines} lines)` : ''}`;
    }
    case 'appendFile':
    case 'append_file':
      return `Appending to file: ${args.path || 'file'}`;
    case 'deleteFile':
    case 'delete_file':
      return `Deleting file: ${args.path || 'file'}`;
    case 'listDir':
    case 'list_dir':
      return `Listing directory: ${args.path || '/'}`;
    case 'makeDir':
    case 'make_dir':
      return `Creating directory: ${args.path || ''}`;
    case 'moveFile':
    case 'move_file':
      return `Moving file: ${args.src || ''} → ${args.dest || ''}`;
    case 'copyFile':
    case 'copy_file':
      return `Copying file: ${args.src || ''} → ${args.dest || ''}`;
    case 'run_code': {
      const lines = args.code ? args.code.split('\n').length : 0;
      return `Running ${args.lang || 'code'} in sandbox${lines > 0 ? ` (${lines} lines)` : ''}`;
    }
    case 'browse_web':
      return `Browsing web: ${args.action || 'loading'} ${args.url || ''}`;
    case 'inspect_page_html':
      return `Inspecting page DOM for "${args.query || 'elements'}"`;
    case 'pull_docker_image':
      return `Pulling Docker image: ${args.image || ''}`;
    case 'docker':
      return `Executing Docker command: docker ${args.command || ''}`;
    case 'docker_build':
      return `Building Docker image: ${args.tag || ''}`;
    case 'docker_compose':
      return `Running docker-compose: ${args.command || 'up'}`;
    case 'save_skill':
      return `Saving workflow skill: ${args.name || ''}`;
    case 'get_skill':
      return `Loading workflow skill: ${args.name || ''}`;
    case 'list_skills':
      return `Fetching saved skills list`;
    default:
      return `Running tool "${tool}"...`;
  }
};

export interface StreamingFileDetails {
  path: string;
  content: string;
  isWritingFile: boolean;
}

export const extractStreamingFileDetails = (raw: string, toolName: string): StreamingFileDetails => {
  if (!raw) return { path: '', content: '', isWritingFile: false };

  const isFileTool = 
    toolName === 'write_file' || 
    toolName === 'writeFile' || 
    toolName.includes('write') || 
    toolName === 'create_file' || 
    toolName === 'append_file';

  // 1. Try to extract path from known keys: path, file, filename, file_path, target
  let path = '';
  const pathKeys = ['path', 'file', 'filename', 'file_path', 'filepath', 'target'];
  for (const key of pathKeys) {
    const pRegex = new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"?`, 'i');
    const pMatch = raw.match(pRegex);
    if (pMatch && pMatch[1]) {
      try {
        path = JSON.parse(`"${pMatch[1]}"`);
      } catch {
        path = pMatch[1];
      }
      break;
    }
  }

  // 2. Try to extract content from known keys: content, code, text, body
  let content = '';
  const contentKeys = ['content', 'code', 'text', 'body'];
  for (const key of contentKeys) {
    const searchStr = `"${key}"`;
    const keyIdx = raw.indexOf(searchStr);
    if (keyIdx !== -1) {
      const colonIdx = raw.indexOf(':', keyIdx + searchStr.length);
      if (colonIdx !== -1) {
        let valStart = raw.indexOf('"', colonIdx);
        if (valStart !== -1) {
          valStart += 1; // skip opening quote
          const rawChunk = raw.slice(valStart);
          
          let clean = '';
          let escaped = false;
          for (let i = 0; i < rawChunk.length; i++) {
            const ch = rawChunk[i];
            if (escaped) {
              if (ch === 'n') clean += '\n';
              else if (ch === 'r') clean += '\r';
              else if (ch === 't') clean += '\t';
              else if (ch === '"') clean += '"';
              else if (ch === '\\') clean += '\\';
              else if (ch === '/') clean += '/';
              else clean += ch;
              escaped = false;
            } else if (ch === '\\') {
              escaped = true;
            } else if (ch === '"') {
              // Found unescaped quote - check if it's the end of the JSON string
              const rest = rawChunk.slice(i + 1).trim();
              if (rest.startsWith(',') || rest.startsWith('}') || rest === '') {
                break;
              } else {
                clean += ch;
              }
            } else {
              clean += ch;
            }
          }
          content = clean;
          break;
        }
      }
    }
  }

  // 3. Fallback: If it's a bash command writing a file, e.g. cat << 'EOF' > file.ext
  if (!isFileTool && (toolName === 'exec_bash' || toolName === 'bash' || toolName === 'run_script')) {
    const catMatch = raw.match(/cat\s*<<\s*['"]?EOF['"]?\s*>\s*([^\s\n\r]+)\n([\s\S]*?)(?:EOF|$)/i);
    if (catMatch) {
      path = catMatch[1].replace(/["']/g, '');
      content = catMatch[2] || '';
      return { path: path.replace(/^\/?workspace\/?/, '').replace(/^\//, ''), content, isWritingFile: true };
    }
  }

  const cleanPath = path ? path.replace(/^\/?workspace\/?/, '').replace(/^\//, '') : '';
  return {
    path: cleanPath,
    content,
    isWritingFile: isFileTool || !!cleanPath
  };
};

export const extractPartialJsonField = (raw: string, field: string): string => {
  if (!raw) return '';
  const regex = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`, 's');
  const match = raw.match(regex);
  if (match && match[1]) {
    try {
      return JSON.parse(`"${match[1]}"`);
    } catch {
      return match[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }
  return '';
};

interface ChatState {
  sessions: Partial<Session>[];
  activeSessionId: string | null;
  activeSession: Session | null;
  isLoadingSessions: boolean;
  isLoadingActiveSession: boolean;
  isStreaming: boolean;
  
  // Streaming elements
  streamingContent: string;
  streamingThoughts: string;
  streamingSteps: { current: number; total: number } | null;
  activeToolCalls: Record<string, LiveToolCall>;
  lastThoughts: string;
  streamingReasoning: string;
  isSummarizing: boolean;
  lastSummary: string | null;
  activeStreamingFile: string | null;
  activeStreamingCode: string;
  fileContent: string;
  
  // Settings & Navigation
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  rightPanelWidth: number;
  rightPanelTab: 'timeline' | 'thoughts' | 'logs' | 'json' | 'browser' | 'files' | 'prompt';
  selectedFile: string | null;
  selectedModel: string;
  selectedAgent: string;
  searchQuery: string;
  summaryThreshold: number;
  thinkingBudget: number | null;
  reasoningEffort: 'low' | 'medium' | 'high';
  models: {
    ollama: string[];
    openai: Array<{ id: string; name: string; pricing: string; inputPrice: string; outputPrice: string }>;
    groq: Array<{ id: string; name: string; pricing: string; limits?: string; inputPrice?: string; outputPrice?: string }>;
    custom?: Array<{ id: string; name: string; baseURL?: string; models: string[]; enabled: boolean }>;
    enabled?: { ollama: boolean; groq: boolean; openai: boolean };
  };

  // Browser streaming & remote control state
  // NOTE: raw JPEG bytes are NOT stored in Zustand — they go straight to the
  // OffscreenCanvas worker to avoid triggering React re-renders on every frame.
  browserUrl: string | null;
  isBrowserActive: boolean;
  browserWs: WebSocket | null;
  isBrowserUnplugged: boolean;
  browserWindowRect: { x: number; y: number; width: number; height: number };
  browserWidth: number;
  browserHeight: number;
  isBrowserLoading: boolean;
  frameLatency: number;   // ms between frame capture and reception
  
  useMemory: boolean;

  // Actions
  fetchSessions: () => Promise<void>;
  fetchModels: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  newChat: () => Promise<void>;
  startChat: (goal: string) => Promise<void>;
  abortChat: () => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleRightPanel: () => void;
  setRightPanelTab: (tab: 'timeline' | 'thoughts' | 'logs' | 'json' | 'browser' | 'files' | 'prompt') => void;
  setSelectedFile: (file: string | null) => void;
  setFileContent: (content: string) => void;
  setActiveStreamingFile: (file: string | null, code?: string) => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;
  setRightPanelWidth: (width: number) => void;
  setSelectedModel: (model: string) => void;
  setSelectedAgent: (agent: string) => void;
  setSearchQuery: (query: string) => void;
  setSummaryThreshold: (threshold: number) => void;
  setThinkingBudget: (budget: number | null) => void;
  setReasoningEffort: (effort: 'low' | 'medium' | 'high') => void;
  setUseMemory: (use: boolean) => void;
  connectBrowserWS: () => void;
  disconnectBrowserWS: () => void;
  sendBrowserAction: (action: any) => void;
  toggleBrowserUnplugged: () => void;
  setBrowserWindowRect: (rect: { x: number; y: number; width: number; height: number }) => void;
  setBrowserResolution: (width: number, height: number) => void;
  registerFrameCanvas: (canvas: HTMLCanvasElement, action: 'register' | 'unregister') => void;
}

let activeAbortController: AbortController | null = null;

// ─── rAF-based canvas renderer (replaces OffscreenCanvas worker) ───────────
// Industry-standard approach used by WebRTC receivers and video players:
//   1. Each WS binary frame is decoded to an ImageBitmap (async, GPU-accelerated)
//   2. The decoded bitmap is stored in a "pending" slot (newest always wins)
//   3. A requestAnimationFrame loop reads the pending bitmap once per display
//      refresh (typically 16ms / 60fps) and draws it — coalescing all frames
//      that arrived between two display refreshes into a single paint call.
//   4. _lastBitmap retains the last *painted* frame so that when the canvas is
//      recreated (popout ↔ dock transition), it can be instantly redrawn with
//      no black-screen flash.

let _pendingBitmap: ImageBitmap | null = null;     // latest decoded frame, not yet painted
let _lastBitmap: ImageBitmap | null = null;        // last successfully painted frame (kept alive for canvas recreation)
let _rafHandle: number | null = null;              // handle to cancel the rAF loop
const _rafCanvases = new Set<HTMLCanvasElement>(); // active canvases to paint into
let _latencyUpdateTimer: number | null = null;     // debounce latency badge updates

function paintBitmapToCanvas(canvas: HTMLCanvasElement, bmp: ImageBitmap) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // Resize canvas only when source dimensions change (avoids clearing on every frame)
  if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
    canvas.width  = bmp.width;
    canvas.height = bmp.height;
  }
  ctx.drawImage(bmp, 0, 0);
}

function startRafLoop() {
  if (_rafHandle !== null) return; // already running

  function rafLoop() {
    if (_pendingBitmap && _rafCanvases.size > 0) {
      const bmp = _pendingBitmap;
      _pendingBitmap = null;

      for (const canvas of _rafCanvases) {
        paintBitmapToCanvas(canvas, bmp);
      }

      // Release the previous last-frame and promote this one
      if (_lastBitmap) _lastBitmap.close();
      _lastBitmap = bmp; // keep alive — do NOT call bmp.close() here
    }
    _rafHandle = requestAnimationFrame(rafLoop);
  }

  _rafHandle = requestAnimationFrame(rafLoop);
}

function stopRafLoop() {
  if (_rafHandle !== null) {
    cancelAnimationFrame(_rafHandle);
    _rafHandle = null;
  }
}

// Called by BrowserPanel on mount/unmount.
// Tracks multiple active canvases to prevent black-screen flash and unmount race conditions during transitions.
function registerFrameCanvasImpl(canvas: HTMLCanvasElement, action: 'register' | 'unregister') {
  if (action === 'register') {
    _rafCanvases.add(canvas);
    // Immediately paint the last known frame so the new canvas isn't blank
    if (_lastBitmap) {
      paintBitmapToCanvas(canvas, _lastBitmap);
    }
    startRafLoop();
  } else {
    _rafCanvases.delete(canvas);
    if (_rafCanvases.size === 0) {
      stopRafLoop();
      // Drop pending but keep _lastBitmap for the next canvas mount
      if (_pendingBitmap) { _pendingBitmap.close(); _pendingBitmap = null; }
    }
  }
}

// Called by the WS onmessage handler — decodes JPEG to ImageBitmap then slots it in
function pushFrameToWorker(jpegBuffer: ArrayBuffer, timestamp: number) {
  // createImageBitmap is GPU-accelerated and runs off the JS main thread internally.
  // It returns a promise; when it resolves we swap the pending buffer.
  createImageBitmap(new Blob([jpegBuffer], { type: 'image/jpeg' })).then((bitmap) => {
    // If a previous pending bitmap was never consumed (we're producing faster than
    // the display refresh), close it to free GPU memory before overwriting.
    if (_pendingBitmap) _pendingBitmap.close();
    _pendingBitmap = bitmap;

    // Debounce the latency badge update to at most once per 200ms
    const latency = Math.max(0, Date.now() - timestamp);
    if (!_latencyUpdateTimer) {
      _latencyUpdateTimer = window.setTimeout(() => {
        _latencyUpdateTimer = null;
        useChatStore.setState({ frameLatency: latency });
      }, 200);
    }
  }).catch(() => { /* corrupt frame — ignore */ });
}

const handleStreamEvent = (
  event: string, 
  data: any, 
  get: () => ChatState, 
  set: (fn: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void
) => {
  const currentSession = get().activeSession;
  const safeData = (data && typeof data === 'object') ? data : (typeof data === 'string' ? { message: data } : {});
  
  switch (event) {
    case 'session_created': {
      const sessionId = safeData.sessionId;
      if (!sessionId) break;
      localStorage.setItem('openmanus_active_session_id', sessionId);
      set({ activeSessionId: sessionId });
      if (currentSession) {
        set({ 
          activeSession: { ...currentSession, id: sessionId } 
        });
      }
      break;
    }
    case 'session_title_updated': {
      const { sessionId, title } = safeData;
      if (!title) break;
      set(state => {
        const updatedSessions = state.sessions.map(s => s.id === sessionId ? { ...s, title } : s);
        const updatedActive = state.activeSession && state.activeSession.id === sessionId 
          ? { ...state.activeSession, title } 
          : state.activeSession;
        return {
          sessions: updatedSessions,
          activeSession: updatedActive
        };
      });
      break;
    }
    case 'summarizing': {
      set({ isSummarizing: true, streamingThoughts: '📝 Summarizing conversation to save context...' });
      break;
    }
    case 'summary_created': {
      set({ isSummarizing: false, lastSummary: safeData.summary || '' });
      break;
    }
    case 'step': {
      const { step, total } = safeData;
      set({ streamingSteps: { current: step || 1, total: total || 100 } });
      break;
    }
    case 'llm_thinking': {
      const step = safeData.step || 1;
      set({ 
        streamingThoughts: `Executing step ${step}... Agent is planning next action.`,
        activeToolCalls: {},
        lastThoughts: '',
        streamingReasoning: ''
      });
      break;
    }
    case 'text_delta': {
      const { text, isReasoning } = data;
      if (isReasoning) {
        set(state => ({
          streamingReasoning: state.streamingReasoning + text
        }));
      } else {
        set(state => ({
          streamingContent: state.streamingContent + text
        }));
      }
      break;
    }
    case 'clear_stream': {
      const { preamble } = data;
      set(state => ({ 
        lastThoughts: preamble || state.streamingReasoning || state.streamingContent || state.lastThoughts,
        streamingReasoning: '',
        streamingContent: '' 
      }));
      break;
    }
    case 'tool_draft': {
      const { id, tool, rawArguments } = data;
      const toolName = tool || get().activeToolCalls[id]?.name || '';
      const fileDetails = extractStreamingFileDetails(rawArguments, toolName);

      const liveArgs: any = {};
      if (fileDetails.path) liveArgs.path = fileDetails.path;
      if (fileDetails.content) liveArgs.content = fileDetails.content;

      set(state => {
        const updatedTools = {
          ...state.activeToolCalls,
          [id]: {
            id,
            name: toolName || 'tool',
            args: liveArgs,
            status: 'running' as const,
            startTime: state.activeToolCalls[id]?.startTime || Date.now()
          }
        };

        const activityDesc = formatToolActivity(toolName, liveArgs);

        if (fileDetails.isWritingFile) {
          const targetFile = fileDetails.path || state.activeStreamingFile || state.selectedFile || 'Untitled';
          localStorage.setItem('openmanus_right_panel_collapsed', 'false');
          const targetWidth = Math.max(state.rightPanelWidth, 520);
          localStorage.setItem('openmanus_right_panel_width', String(targetWidth));

          return {
            activeToolCalls: updatedTools,
            streamingThoughts: activityDesc,
            rightPanelTab: 'files' as const,
            rightPanelCollapsed: false,
            rightPanelWidth: targetWidth,
            selectedFile: targetFile,
            activeStreamingFile: targetFile,
            activeStreamingCode: fileDetails.content,
            fileContent: fileDetails.content
          };
        }

        return {
          activeToolCalls: updatedTools,
          streamingThoughts: activityDesc
        };
      });
      break;
    }
    case 'tool_start': {
      const { id, tool, args } = data;
      const activityDesc = formatToolActivity(tool, args);
      const isFileWrite = tool === 'write_file' || tool === 'writeFile' || tool.includes('write') || !!args?.path;

      set(state => {
        const updatedTools = {
          ...state.activeToolCalls,
          [id]: {
            id,
            name: tool,
            args,
            status: 'running' as const,
            startTime: state.activeToolCalls[id]?.startTime || Date.now()
          }
        };

        let extraState: any = {};
        if (isFileWrite) {
          const relPath = args?.path ? args.path.replace(/^\/?workspace\/?/, '').replace(/^\//, '') : (state.selectedFile || 'Untitled');
          const codeContent = args?.content || state.activeStreamingCode || '';
          localStorage.setItem('openmanus_right_panel_collapsed', 'false');
          const targetWidth = Math.max(state.rightPanelWidth, 520);
          localStorage.setItem('openmanus_right_panel_width', String(targetWidth));

          extraState = {
            rightPanelTab: 'files' as const,
            rightPanelCollapsed: false,
            rightPanelWidth: targetWidth,
            selectedFile: relPath,
            activeStreamingFile: relPath,
            activeStreamingCode: codeContent,
            fileContent: codeContent
          };
        } else if (tool === 'browse_web') {
          extraState = {
            rightPanelTab: 'browser' as const,
            rightPanelCollapsed: false
          };
        }

        if (currentSession) {
          const updatedHistory = [...currentSession.history];
          const lastMsg = updatedHistory[updatedHistory.length - 1];

          if (lastMsg && lastMsg.role === 'assistant') {
            const toolCalls = lastMsg.tool_calls || [];
            const exists = toolCalls.some(tc => tc.id === id);
            if (!exists) {
              lastMsg.tool_calls = [...toolCalls, {
                id,
                type: 'function' as const,
                function: { name: tool, arguments: JSON.stringify(args) }
              }];
            }
          } else {
            updatedHistory.push({
              role: 'assistant' as const,
              content: state.lastThoughts || null,
              tool_calls: [{
                id,
                type: 'function' as const,
                function: { name: tool, arguments: JSON.stringify(args) }
              }]
            });
          }

          return {
            activeToolCalls: updatedTools,
            streamingThoughts: activityDesc,
            activeSession: {
              ...currentSession,
              history: updatedHistory
            },
            ...extraState
          };
        }

        return {
          activeToolCalls: updatedTools,
          streamingThoughts: activityDesc,
          ...extraState
        };
      });
      break;
    }
    case 'tool_stream_output': {
      const { id, tool, liveStdout, liveStderr } = safeData;
      const combinedOutput = (liveStdout || '') + (liveStderr ? `\n[stderr]\n${liveStderr}` : '');
      set(state => {
        const updatedTools = { ...state.activeToolCalls };
        if (updatedTools[id]) {
          updatedTools[id] = {
            ...updatedTools[id],
            result: combinedOutput,
            status: 'running' as const
          };
        }
        return {
          activeToolCalls: updatedTools,
          rightPanelTab: (tool === 'docker' || tool === 'run_code') ? 'logs' as const : state.rightPanelTab,
          rightPanelCollapsed: false
        };
      });
      break;
    }
    case 'tool_result': {
      const { id, tool, result, raw, error } = safeData;
      const toolCall = get().activeToolCalls[id];
      const duration = toolCall ? Date.now() - toolCall.startTime : 0;
      const durationSec = (duration / 1000).toFixed(1);
      
      set(state => {
        // Update live tool call representation
        const updatedTools = { ...state.activeToolCalls };
        const isError = !!error || 
          (result && typeof result === 'object' && (
            result.exitCode > 0 || 
            result.exitCode === -1 || 
            !!result.error ||
            (result.stderr && !result.stdout)
          ));

        if (updatedTools[id]) {
          updatedTools[id] = {
            ...updatedTools[id],
            status: isError ? 'error' : 'success',
            result,
            error: error || (result && typeof result === 'object' ? (result.error || result.stderr) : undefined),
            duration
          };
        }

        const stillRunning = Object.values(updatedTools).filter(t => t.status === 'running');
        const nextThoughts = stillRunning.length > 0 
          ? formatToolActivity(stillRunning[0].name, stillRunning[0].args)
          : `Completed ${tool} (${durationSec}s)`;

        // If this was a writeFile operation, keep the written code in fileContent
        let writtenFileState: any = {};
        if ((tool === 'writeFile' || tool === 'write_file') && toolCall?.args?.path) {
          const writtenFile = toolCall.args.path.replace(/^\/?workspace\/?/, '').replace(/^\//, '');
          writtenFileState = {
            selectedFile: writtenFile,
            fileContent: toolCall.args.content || '',
            activeStreamingFile: null,
            activeStreamingCode: ''
          };
        } else {
          writtenFileState = {
            activeStreamingFile: null,
            activeStreamingCode: ''
          };
        }

        // Inject tool call result into the active session history & logs
        if (currentSession) {
          const updatedHistory = [...currentSession.history];
          
          // Check if this tool role message is already added
          const alreadyAdded = updatedHistory.some(
            m => m.role === 'tool' && m.tool_call_id === id
          );

          if (!alreadyAdded) {
            updatedHistory.push({
              role: 'tool',
              tool_call_id: id,
              content: raw
            });
          }

          // Create new tool log item
          const logItem: ToolLog = {
            step: state.streamingSteps?.current || 0,
            tool,
            args: toolCall?.args || {},
            result: raw,
            ts: new Date().toISOString()
          };
          
          const updatedLogs = [...currentSession.logs, logItem];

          return {
            activeToolCalls: updatedTools,
            streamingThoughts: nextThoughts,
            activeSession: {
              ...currentSession,
              history: updatedHistory,
              logs: updatedLogs
            },
            ...writtenFileState
          };
        }

        return { 
          activeToolCalls: updatedTools,
          streamingThoughts: nextThoughts,
          ...writtenFileState
        };
      });
      break;
    }
    case 'answer': {
      const text = safeData.text || '';
      set({ streamingContent: text });
      break;
    }
    case 'done': {
      const result = safeData.result || '';
      set(() => {
        if (currentSession) {
          const updatedHistory = [...currentSession.history];
          const hasAssistantAnswer = updatedHistory.some(
            m => m.role === 'assistant' && m.content === result
          );

          if (!hasAssistantAnswer && result) {
            updatedHistory.push({
              role: 'assistant',
              content: result
            });
          }

          return {
            isStreaming: false,
            streamingContent: '',
            streamingThoughts: '',
            streamingReasoning: '',
            lastThoughts: '',
            activeSession: {
              ...currentSession,
              status: 'done',
              result,
              history: updatedHistory,
              updated_at: new Date().toISOString()
            }
          };
        }
        return { isStreaming: false, streamingContent: '', streamingThoughts: '', streamingReasoning: '', lastThoughts: '' };
      });
      // Reload sessions to refresh the sidebar
      get().fetchSessions();
      break;
    }
    case 'error': {
      const errMsg = data?.message || (typeof data === 'string' ? data : 'An error occurred during agent execution.');
      set(() => {
        if (currentSession) {
          const updatedHistory = [...currentSession.history, {
            role: 'assistant' as const,
            content: `Error: ${errMsg}`
          }];
          return {
            isStreaming: false,
            streamingContent: '',
            streamingThoughts: '',
            streamingReasoning: '',
            lastThoughts: '',
            activeSession: {
              ...currentSession,
              status: 'failed',
              result: errMsg,
              history: updatedHistory,
              updated_at: new Date().toISOString()
            }
          };
        }
        return { isStreaming: false, streamingContent: '', streamingThoughts: '', streamingReasoning: '', lastThoughts: '' };
      });
      get().fetchSessions();
      break;
    }
  }
};

export const useChatStore = create<ChatState>((set, get) => ({

  sessions: [],
  activeSessionId: localStorage.getItem('openmanus_active_session_id') || null,
  activeSession: null,
  isLoadingSessions: false,
  isLoadingActiveSession: false,
  isStreaming: false,
  
  streamingContent: '',
  streamingThoughts: '',
  streamingSteps: null,
  activeToolCalls: {},
  lastThoughts: '',
  streamingReasoning: '',
  isSummarizing: false,
  lastSummary: null,
  activeStreamingFile: null,
  activeStreamingCode: '',
  fileContent: '',
  
  sidebarCollapsed: localStorage.getItem('openmanus_sidebar_collapsed') === 'true',
  rightPanelCollapsed: localStorage.getItem('openmanus_right_panel_collapsed') === 'true',
  rightPanelWidth: Number(localStorage.getItem('openmanus_right_panel_width')) || 400,
  rightPanelTab: 'timeline',
  selectedFile: null,
  selectedModel: localStorage.getItem('openmanus_selected_model') || 'gemma4:12b',
  selectedAgent: 'OpenManus',
  searchQuery: '',
  summaryThreshold: Number(localStorage.getItem('openmanus_summary_threshold')) || 40000,
  thinkingBudget: Number(localStorage.getItem('openmanus_thinking_budget')) || 4096,
  reasoningEffort: (localStorage.getItem('openmanus_reasoning_effort') as 'low' | 'medium' | 'high') || 'medium',
  models: { ollama: [], openai: [], groq: [], custom: [] },
  useMemory: localStorage.getItem('openmanus_use_memory') !== 'false',

  browserUrl: null,
  isBrowserActive: false,
  browserWs: null,
  isBrowserUnplugged: false,
  browserWindowRect: { x: 100, y: 100, width: 800, height: 550 },
  browserWidth: 1280,
  browserHeight: 800,
  isBrowserLoading: false,
  frameLatency: 0,

  fetchSessions: async () => {
    set({ isLoadingSessions: true });
    try {
      const data = await api.getSessions();
      set({ sessions: data, isLoadingSessions: false });

      // If no active session is loaded, restore the last active session from localStorage
      const savedId = localStorage.getItem('openmanus_active_session_id');
      if (savedId && !get().activeSession) {
        const found = data.some(s => s.id === savedId);
        if (found) {
          get().selectSession(savedId);
        }
      }
    } catch (err) {
      console.error('[Store] Error loading sessions:', err);
      set({ isLoadingSessions: false });
    }
  },

  fetchModels: async () => {
    try {
      const data = await api.getModels();
      set({ models: data });

      const allModelIds = [
        ...(data.ollama || []),
        ...(data.openai || []).map((m: {id: string}) => m.id),
        ...(data.groq   || []).map((m: {id: string}) => m.id),
        ...(data.custom || []).flatMap((c: {models: string[]}) => c.models || []),
      ];

      // Get default model from backend config via health check
      let backendDefaultModel = '';
      try {
        const health = await api.checkHealth();
        backendDefaultModel = health.model;
      } catch (healthErr) {
        console.warn('[Store] Health check failed during model load:', healthErr);
      }

      const currentModel = get().selectedModel;

      // If the currently selected model is no longer in the available list
      // (e.g. provider was disabled), auto-switch to the first available model.
      const modelNotAvailable = allModelIds.length > 0 && !allModelIds.includes(currentModel);
      const switchToDefault   =
        currentModel === 'qwen2.5:7b' &&
        backendDefaultModel &&
        allModelIds.includes(backendDefaultModel);

      if (modelNotAvailable || switchToDefault) {
        const preferred = backendDefaultModel && allModelIds.includes(backendDefaultModel)
          ? backendDefaultModel
          : allModelIds[0];
        set({ selectedModel: preferred });
        console.log(`[Store] Auto-switched model to "${preferred}" (previous was unavailable/disabled).`);
      }
    } catch (err) {
      console.error('[Store] Error loading models:', err);
    }
  },

  selectSession: async (id: string) => {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }

    localStorage.setItem('openmanus_active_session_id', id);
    set({ isLoadingActiveSession: true, activeSessionId: id });

    try {
      const data = await api.getSession(id);
      set({ 
        activeSession: data, 
        isLoadingActiveSession: false,
        streamingSteps: null,
        streamingThoughts: '',
        activeToolCalls: {}
      });
      get().connectBrowserWS();

      // If the session is currently running in the background, reconnect to its live SSE event stream!
      if (data && data.status === 'running') {
        activeAbortController = new AbortController();
        set({ isStreaming: true, streamingThoughts: 'Reconnected to running agent...' });
        api.listenSessionEvents(
          id,
          (event, eventData) => handleStreamEvent(event, eventData, get, set),
          activeAbortController.signal
        );
      }
    } catch (err) {
      console.error('[Store] Error loading session detail:', err);
      set({ isLoadingActiveSession: false });
    }
  },

  newChat: async () => {
    if (get().isStreaming) {
      get().abortChat();
    }
    localStorage.removeItem('openmanus_active_session_id');
    get().disconnectBrowserWS();
    set({
      activeSessionId: null,
      activeSession: null,
      streamingContent: '',
      streamingThoughts: '',
      lastThoughts: '',
      streamingReasoning: '',
      streamingSteps: null,
      activeToolCalls: {},
      browserUrl: null,
      isBrowserActive: false
    });
    await api.resetSession().catch((err) => {
      console.warn('[Store] Failed to reset backend session context:', err);
    });
  },

  startChat: async (goal: string) => {
    if (get().isStreaming) return;

    // Set up AbortController
    activeAbortController = new AbortController();
    
    const existingSession = get().activeSession;
    const isContinuation = existingSession && existingSession.id !== 'temp-session';
    const sessionId = isContinuation ? existingSession.id : null;

    if (isContinuation) {
      const updatedHistory = [...existingSession.history, { role: 'user' as const, content: goal }];
      set({
        isStreaming: true,
        streamingContent: '',
        streamingThoughts: 'Resuming agent session...',
        lastThoughts: '',
        streamingReasoning: '',
        streamingSteps: null,
        activeToolCalls: {},
        activeSession: {
          ...existingSession,
          status: 'running',
          history: updatedHistory,
          updated_at: new Date().toISOString()
        }
      });
    } else {
      set({
        isStreaming: true,
        streamingContent: '',
        streamingThoughts: 'Initializing agent session...',
        lastThoughts: '',
        streamingReasoning: '',
        streamingSteps: null,
        activeToolCalls: {},
        activeSession: {
          id: 'temp-session',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          goal,
          status: 'running',
          history: [{ role: 'user', content: goal }],
          logs: [],
          result: null
        }
      });
    }

    try {
      get().connectBrowserWS();
      await api.streamAgent(
        goal,
        (event, data) => handleStreamEvent(event, data, get, set),
        activeAbortController.signal,
        sessionId,
        get().selectedAgent,
        get().selectedModel,
        get().summaryThreshold,
        get().useMemory,
        get().thinkingBudget,
        get().reasoningEffort
      );
    } catch (err: any) {
      console.error('[Store] Stream process error:', err);
      set({ 
        isStreaming: false,
        streamingThoughts: `Execution failed: ${err.message}`
      });
      if (get().activeSession) {
        set(state => ({
          activeSession: state.activeSession ? {
            ...state.activeSession,
            status: 'failed',
            result: err.message
          } : null
        }));
      }
      get().fetchSessions();
    }
  },

  abortChat: () => {
    const activeId = get().activeSessionId || get().activeSession?.id;
    if (activeId) {
      api.stopSession(activeId).catch(() => {});
    } else {
      api.stopSession().catch(() => {});
    }

    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    set(state => {
      if (state.activeSession) {
        return {
          isStreaming: false,
          streamingContent: '',
          streamingThoughts: 'Agent stopped by user.',
          activeSession: {
            ...state.activeSession,
            status: 'failed',
            result: 'Agent stopped by user.'
          }
        };
      }
      return { isStreaming: false, streamingContent: '', streamingThoughts: '' };
    });
    get().fetchSessions();
  },

  toggleSidebar: () => {
    const collapsed = !get().sidebarCollapsed;
    localStorage.setItem('openmanus_sidebar_collapsed', String(collapsed));
    set({ sidebarCollapsed: collapsed });
  },

  setSidebarCollapsed: (collapsed) => {
    localStorage.setItem('openmanus_sidebar_collapsed', String(collapsed));
    set({ sidebarCollapsed: collapsed });
  },

  toggleRightPanel: () => {
    const collapsed = !get().rightPanelCollapsed;
    localStorage.setItem('openmanus_right_panel_collapsed', String(collapsed));
    set({ rightPanelCollapsed: collapsed });
  },

  setRightPanelTab: (tab) => {
    set({ rightPanelTab: tab });
  },

  setSelectedFile: (file) => {
    set({ selectedFile: file });
  },

  setFileContent: (content: string) => {
    set({ fileContent: content });
  },

  setActiveStreamingFile: (file: string | null, code: string = '') => {
    set({ activeStreamingFile: file, activeStreamingCode: code });
  },

  setRightPanelCollapsed: (collapsed) => {
    localStorage.setItem('openmanus_right_panel_collapsed', String(collapsed));
    set({ rightPanelCollapsed: collapsed });
  },

  setRightPanelWidth: (width) => {
    localStorage.setItem('openmanus_right_panel_width', String(width));
    set({ rightPanelWidth: width });
  },

  setSelectedModel: (model) => {
    localStorage.setItem('openmanus_selected_model', model);
    set({ selectedModel: model });
  },

  setSelectedAgent: (agent) => {
    set({ selectedAgent: agent });
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query });
  },

  setSummaryThreshold: (threshold: number) => {
    localStorage.setItem('openmanus_summary_threshold', String(threshold));
    set({ summaryThreshold: threshold });
  },

  setThinkingBudget: (budget: number | null) => {
    if (budget !== null) {
      localStorage.setItem('openmanus_thinking_budget', String(budget));
    } else {
      localStorage.removeItem('openmanus_thinking_budget');
    }
    set({ thinkingBudget: budget });
  },

  setReasoningEffort: (effort: 'low' | 'medium' | 'high') => {
    localStorage.setItem('openmanus_reasoning_effort', effort);
    set({ reasoningEffort: effort });
  },

  setUseMemory: (use: boolean) => {
    localStorage.setItem('openmanus_use_memory', String(use));
    set({ useMemory: use });
  },

  connectBrowserWS: () => {
    if (get().browserWs) return;

    // Connect to WebSocket sharing port 3000
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.hostname === 'localhost' ? 'localhost:3000' : `${window.location.hostname}:3000`;
    const wsUrl = `${wsProto}//${wsHost}`;
    console.log('[Store] Connecting to browser stream WebSocket:', wsUrl);

    try {
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer'; // receive binary frames as ArrayBuffer

      // Adaptive quality: send quality preference to server based on measured latency
      let _qualityTimer: ReturnType<typeof setInterval> | null = null;
      let _lastSentQuality = 35;
      let _lastSentFps = 20;

      const sendQualityFeedback = () => {
        const latency = get().frameLatency;
        let quality = 35;
        let fps = 20;
        if (latency > 400) { quality = 20; fps = 10; }       // very slow
        else if (latency > 200) { quality = 28; fps = 15; }  // slow
        else if (latency > 100) { quality = 35; fps = 18; }  // ok
        else { quality = 42; fps = 20; }                      // fast — upgrade

        if (quality !== _lastSentQuality || fps !== _lastSentFps) {
          _lastSentQuality = quality;
          _lastSentFps = fps;
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'setQuality', quality, fps }));
          }
        }
      };

      ws.onmessage = (event) => {
        try {
          if (typeof event.data === 'string') {
            // Text frame — control message (loading, loaded, close)
            const message = JSON.parse(event.data);
            if (message.type === 'loading') {
              set({ isBrowserLoading: true });
            } else if (message.type === 'loaded') {
              set({ isBrowserLoading: false });
            } else if (message.type === 'close') {
              set({ browserUrl: null, isBrowserActive: false, isBrowserLoading: false });
            }
          } else {
            // Binary frame — [Float64BE capturedAt][Uint32BE urlLen][url][jpeg]
            const buffer = event.data as ArrayBuffer;
            if (buffer.byteLength < 12) return;
            const view = new DataView(buffer);
            const capturedAt = view.getFloat64(0, false); // big-endian
            const urlLen = view.getUint32(8, false);
            if (buffer.byteLength < 12 + urlLen) return;

            // Decode URL string (tiny, cheap)
            const url = new TextDecoder().decode(new Uint8Array(buffer, 12, urlLen));

            // Slice JPEG region — note: we cannot transfer the whole buffer because
            // DataView still references it; slice() copies only the JPEG portion.
            const jpegBuffer = buffer.slice(12 + urlLen);

            // Push frame off-thread — zero-copy transfer, no React re-render
            pushFrameToWorker(jpegBuffer, capturedAt);

            // Update URL + active flag in Zustand (cheap string compare, rare change)
            const state = useChatStore.getState();
            if (state.browserUrl !== url || !state.isBrowserActive) {
              set({ browserUrl: url, isBrowserActive: true, isBrowserLoading: false });
            }
          }
        } catch (e) {
          console.error('[Store] Error parsing WebSocket frame:', e);
        }
      };

      ws.onopen = () => {
        console.log('[Store] Browser stream WebSocket connected');
        _qualityTimer = setInterval(sendQualityFeedback, 3000);
      };

      ws.onerror = (err) => {
        console.error('[Store] Browser stream WebSocket error:', err);
      };

      ws.onclose = () => {
        console.log('[Store] Browser stream WebSocket disconnected');
        if (_qualityTimer) { clearInterval(_qualityTimer); _qualityTimer = null; }
        set({ browserWs: null, isBrowserActive: false, browserUrl: null });
      };

      set({ browserWs: ws });
    } catch (err) {
      console.error('[Store] Failed to connect WebSocket:', err);
    }
  },

  disconnectBrowserWS: () => {
    const ws = get().browserWs;
    if (ws) {
      ws.close();
      set({ browserWs: null, isBrowserActive: false, browserUrl: null });
    }
  },

  registerFrameCanvas: (canvas: HTMLCanvasElement, action: 'register' | 'unregister') => {
    registerFrameCanvasImpl(canvas, action);
  },

  sendBrowserAction: (action) => {
    const ws = get().browserWs;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'action', action }));
    } else {
      console.warn('[Store] Cannot send action, WebSocket not open');
    }
  },

  toggleBrowserUnplugged: () => {
    set(state => ({ isBrowserUnplugged: !state.isBrowserUnplugged }));
  },

  setBrowserWindowRect: (rect) => {
    set({ browserWindowRect: rect });
  },

  setBrowserResolution: (width, height) => {
    set({ browserWidth: width, browserHeight: height });
    get().sendBrowserAction({ type: 'viewport', width, height });
  }
}));
