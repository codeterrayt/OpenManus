// src/components/RightPanel.tsx
import React, { useMemo } from 'react';
import { 
  BarChart3, 
  Clock, 
  Workflow, 
  Terminal, 
  Code2, 
  FileJson,
  Brain,
  PanelRightClose,
  Globe,
  FolderOpen,
  ChevronLeft,
  FileText,
  Loader2
} from 'lucide-react';
import { useChatStore } from '../store/useChatStore';
import ExecutionTimeline from './ExecutionTimeline';
import JsonViewer from './JsonViewer';
import MarkdownRenderer from './MarkdownRenderer';
import BrowserPanel from './BrowserPanel';
import CodeBlock from './CodeBlock';
import { api } from '../services/api';

// Helper to find raw URLs/localhosts in plain text logs and render clickable anchors
const linkify = (text: string) => {
  if (!text) return text;
  const urlRegex = /(https?:\/\/(?:localhost|127\.0\.0\.1|[a-zA-Z0-9.-]+)(?::\d+)?(?:[^\s\)]*)|localhost:\d+|127\.0\.0\.1:\d+)/gi;
  const parts = text.split(urlRegex);
  return parts.map((part, i) => {
    if (urlRegex.test(part)) {
      let href = part;
      if (!/^https?:\/\//i.test(part)) {
        href = 'http://' + part;
      }
      // Map localhost/127.0.0.1 to window.location.hostname to support remote VM/server setups
      const host = window.location.hostname || 'localhost';
      href = href.replace(/(localhost|127\.0\.0\.1)/i, host);
      return (
        <a 
          key={i} 
          href={href} 
          target="_self" 
          rel="noopener noreferrer" 
          className="text-primary hover:underline hover:text-secondary transition-colors"
        >
          {part}
        </a>
      );
    }
    return part;
  });
};

export const RightPanel: React.FC = () => {
  const {
    activeSession,
    rightPanelCollapsed,
    toggleRightPanel,
    rightPanelTab,
    setRightPanelTab,
    isStreaming,
    selectedFile,
    setSelectedFile,
    rightPanelWidth,
    setRightPanelWidth
  } = useChatStore();

  const [files, setFiles] = React.useState<string[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = React.useState(false);
  const [fileContent, setFileContent] = React.useState<string>('');
  const [isLoadingContent, setIsLoadingContent] = React.useState(false);

  const [isDragging, setIsDragging] = React.useState(false);
  
  const startResizing = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const newWidth = window.innerWidth - e.clientX;
      const maxAllowedWidth = Math.floor(window.innerWidth * 0.8);
      if (newWidth >= 280 && newWidth <= Math.min(800, maxAllowedWidth)) {
        setRightPanelWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, setRightPanelWidth]);

  React.useEffect(() => {
    if (rightPanelTab === 'files' && activeSession?.id) {
      setIsLoadingFiles(true);
      api.getSessionFiles(activeSession.id)
        .then((data) => {
          setFiles(data);
          setIsLoadingFiles(false);
        })
        .catch((err) => {
          console.error('[RightPanel] Failed to fetch session files:', err);
          setIsLoadingFiles(false);
        });
    }
  }, [rightPanelTab, activeSession?.id, isStreaming]);

  React.useEffect(() => {
    if (selectedFile && activeSession?.id) {
      setIsLoadingContent(true);
      api.getFileContent(activeSession.id, selectedFile)
        .then((data) => {
          setFileContent(data.content);
          setIsLoadingContent(false);
        })
        .catch((err) => {
          console.error('[RightPanel] Failed to fetch file content:', err);
          setFileContent(`Error loading file: ${err.message}`);
          setIsLoadingContent(false);
        });
    } else {
      setFileContent('');
    }
  }, [selectedFile, activeSession?.id]);

  const getLanguageFromExtension = (path: string | null) => {
    if (!path) return 'text';
    const ext = path.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js':
      case 'jsx':
        return 'javascript';
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'py':
        return 'python';
      case 'html':
        return 'html';
      case 'css':
        return 'css';
      case 'json':
        return 'json';
      case 'sh':
      case 'bash':
        return 'bash';
      case 'md':
        return 'markdown';
      case 'sql':
        return 'sql';
      case 'yml':
      case 'yaml':
        return 'yaml';
      case 'dockerfile':
        return 'dockerfile';
      default:
        return 'text';
    }
  };

  // Metrics calculators
  const metrics = useMemo(() => {
    if (!activeSession) return { inputTokens: 0, outputTokens: 0, duration: '0s', stepsCount: 0 };

    // Calculate prompt length and message lengths to estimate tokens
    let totalPromptChars = activeSession.goal.length;
    let totalOutputChars = 0;

    activeSession.history.forEach(m => {
      if (m.role === 'user') {
        totalPromptChars += m.content?.length || 0;
      } else if (m.role === 'assistant') {
        totalOutputChars += m.content?.length || 0;
      } else if (m.role === 'tool') {
        totalPromptChars += m.content?.length || 0;
      }
    });

    const inputTokens = Math.ceil(totalPromptChars / 4.2);
    const outputTokens = Math.ceil(totalOutputChars / 4.2);
    const stepsCount = activeSession.logs.length;

    // Calculate elapsed duration
    const start = new Date(activeSession.created_at).getTime();
    const end = new Date(activeSession.updated_at).getTime();
    const durationMs = end - start;
    let duration = `${(durationMs / 1000).toFixed(1)}s`;
    if (durationMs <= 0) duration = 'Running...';

    return {
      inputTokens,
      outputTokens,
      duration,
      stepsCount
    };
  }, [activeSession]);

  return (
    <div 
      className={`border-l border-border-dark bg-bg-secondary flex flex-col h-full overflow-hidden select-none shrink-0 relative ${
        rightPanelCollapsed ? 'opacity-0 border-l-0' : 'opacity-100'
      }`}
      style={{
        width: rightPanelCollapsed ? '0px' : `${rightPanelWidth}px`,
        transition: isDragging ? 'none' : 'width 300ms cubic-bezier(0.4, 0, 0.2, 1), opacity 300ms'
      }}
    >
      {/* Resize Handle */}
      {!rightPanelCollapsed && (
        <div
          onMouseDown={startResizing}
          className={`absolute top-0 left-0 w-1.5 h-full cursor-col-resize hover:bg-primary/40 transition-colors duration-150 z-50 flex items-center justify-center group ${
            isDragging ? 'bg-primary/30' : ''
          }`}
        >
          <div className={`w-[1px] h-8 bg-border-dark/60 group-hover:bg-primary transition-colors ${
            isDragging ? 'bg-primary' : ''
          }`} />
        </div>
      )}

      {/* Panel Toggle Button when expanded */}
      <button
        onClick={toggleRightPanel}
        className="absolute left-2.5 top-3.5 z-40 text-text-muted hover:text-text-main p-1.5 rounded-lg bg-card hover:bg-[#1E293B] border border-border-dark/60 active:scale-95 transition-all"
        title="Hide Inspector"
      >
        <PanelRightClose className="w-4 h-4" />
      </button>

      {/* Title Header */}
      <div className="p-4 border-b border-border-dark bg-bg-secondary flex items-center justify-between pl-14">
        <h2 className="font-heading font-bold text-xs tracking-wider uppercase text-text-main flex items-center gap-1.5">
          <Brain className="w-4.5 h-4.5 text-secondary animate-pulse" />
          <span>Agent Workspace</span>
        </h2>
        {activeSession && (
          <span className={`text-[9px] font-mono font-bold uppercase px-2 py-0.5 rounded border ${
            activeSession.status === 'running' 
              ? 'bg-primary/10 border-primary/20 text-primary animate-pulse'
              : activeSession.status === 'done'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : activeSession.status === 'failed'
              ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
              : 'bg-card border-border-dark text-text-muted'
          }`}>
            {activeSession.status}
          </span>
        )}
      </div>

      {!activeSession ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none">
          <Brain className="w-8 h-8 text-text-muted/40 animate-pulse mb-3" />
          <p className="text-xs text-text-muted">Select or start a session to display agent logs and diagnostics.</p>
        </div>
      ) : (
        <>

      {/* Diagnostics panel */}
      <div className="p-4 bg-card/40 border-b border-border-dark/65 grid grid-cols-2 gap-3.5 text-left">
        <div className="bg-[#0F1420] border border-border-dark/65 rounded-xl p-2.5 space-y-1 relative overflow-hidden">
          <div className="flex justify-between items-center text-[10px] text-text-muted font-medium">
            <span>Tokens consumed</span>
            <BarChart3 className="w-3.5 h-3.5 text-primary" />
          </div>
          <p className="text-sm font-bold text-text-main font-heading">
            {metrics.inputTokens + metrics.outputTokens}
          </p>
          <div className="text-[9px] text-text-muted flex justify-between pt-0.5 font-mono">
            <span>In: {metrics.inputTokens}</span>
            <span>Out: {metrics.outputTokens}</span>
          </div>
        </div>

        <div className="bg-[#0F1420] border border-border-dark/65 rounded-xl p-2.5 space-y-1 relative overflow-hidden">
          <div className="flex justify-between items-center text-[10px] text-text-muted font-medium">
            <span>Runtime Latency</span>
            <Clock className="w-3.5 h-3.5 text-secondary" />
          </div>
          <p className="text-sm font-bold text-text-main font-heading">
            {isStreaming ? 'Streaming...' : metrics.duration}
          </p>
          <div className="text-[9px] text-text-muted flex justify-between pt-0.5 font-mono">
            <span>Steps: {metrics.stepsCount}</span>
            <span>Avg: {metrics.stepsCount > 0 && !isStreaming ? `${(parseFloat(metrics.duration)/metrics.stepsCount).toFixed(1)}s` : '0.0s'}</span>
          </div>
        </div>
      </div>

      {/* Tabs Selector Bar */}
      <div className="flex border-b border-border-dark/75 bg-bg-secondary select-none p-1.5 gap-1">
        <button
          onClick={() => setRightPanelTab('timeline')}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] md:text-xs font-heading font-semibold transition-all duration-200 ${
            rightPanelTab === 'timeline'
              ? 'bg-[#1E293B] text-text-main border border-border-dark/80 shadow-inner'
              : 'text-text-muted hover:text-text-main hover:bg-card/45'
          }`}
        >
          <Workflow className="w-3.5 h-3.5 text-primary shrink-0" />
          <span>Timeline</span>
        </button>

        <button
          onClick={() => setRightPanelTab('thoughts')}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] md:text-xs font-heading font-semibold transition-all duration-200 ${
            rightPanelTab === 'thoughts'
              ? 'bg-[#1E293B] text-text-main border border-border-dark/80 shadow-inner'
              : 'text-text-muted hover:text-text-main hover:bg-card/45'
          }`}
        >
          <Brain className="w-3.5 h-3.5 text-secondary shrink-0" />
          <span>Thoughts</span>
        </button>

        <button
          onClick={() => setRightPanelTab('logs')}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] md:text-xs font-heading font-semibold transition-all duration-200 ${
            rightPanelTab === 'logs'
              ? 'bg-[#1E293B] text-text-main border border-border-dark/80 shadow-inner'
              : 'text-text-muted hover:text-text-main hover:bg-card/45'
          }`}
        >
          <Terminal className="w-3.5 h-3.5 text-secondary shrink-0" />
          <span>Logs</span>
        </button>

        <button
          onClick={() => setRightPanelTab('json')}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] md:text-xs font-heading font-semibold transition-all duration-200 ${
            rightPanelTab === 'json'
              ? 'bg-[#1E293B] text-text-main border border-border-dark/80 shadow-inner'
              : 'text-text-muted hover:text-text-main hover:bg-card/45'
          }`}
        >
          <FileJson className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>JSON</span>
        </button>

        <button
          onClick={() => setRightPanelTab('browser')}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] md:text-xs font-heading font-semibold transition-all duration-200 ${
            rightPanelTab === 'browser'
              ? 'bg-[#1E293B] text-text-main border border-border-dark/80 shadow-inner'
              : 'text-text-muted hover:text-text-main hover:bg-card/45'
          }`}
        >
          <Globe className="w-3.5 h-3.5 text-primary shrink-0" />
          <span>Browser</span>
        </button>

        <button
          onClick={() => setRightPanelTab('files')}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] md:text-xs font-heading font-semibold transition-all duration-200 ${
            rightPanelTab === 'files'
              ? 'bg-[#1E293B] text-text-main border border-border-dark/80 shadow-inner'
              : 'text-text-muted hover:text-text-main hover:bg-card/45'
          }`}
        >
          <FolderOpen className="w-3.5 h-3.5 text-secondary shrink-0" />
          <span>Files</span>
        </button>

        <button
          onClick={() => setRightPanelTab('prompt')}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] md:text-xs font-heading font-semibold transition-all duration-200 ${
            rightPanelTab === 'prompt'
              ? 'bg-[#1E293B] text-text-main border border-border-dark/80 shadow-inner'
              : 'text-text-muted hover:text-text-main hover:bg-card/45'
          }`}
          title="Inspect System Prompt & Messages History"
        >
          <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
          <span>Prompt</span>
        </button>
      </div>

      {/* Tab Panels Contents */}
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
        {rightPanelTab === 'browser' && (
          <div className="h-full flex flex-col">
            <BrowserPanel />
          </div>
        )}

        {rightPanelTab === 'timeline' && (
          <div className="space-y-4">
            <ExecutionTimeline logs={activeSession.logs || []} />
          </div>
        )}

        {rightPanelTab === 'thoughts' && (
          <div className="space-y-3.5 text-left">
            <div className="flex items-center gap-2 border-b border-border-dark pb-2 mb-3">
              <Brain className="w-4.5 h-4.5 text-secondary animate-pulse" />
              <span className="text-xs font-bold text-text-muted uppercase tracking-wider font-heading">
                Agent Reasoning Logs
              </span>
            </div>
            
            {(() => {
              const thoughts = activeSession.history.filter(
                m => m.role === 'assistant' && m.content
              );
              
              if (thoughts.length === 0) {
                return (
                  <div className="text-center py-10 text-xs text-text-muted select-none">
                    No reasoning or planning logged yet.
                  </div>
                );
              }
              
              return (
                <div className="space-y-3 font-sans">
                  {thoughts.map((msg, idx) => (
                    <div key={idx} className="bg-card border border-border-dark rounded-xl p-3.5 space-y-2 relative overflow-hidden">
                      <div className="flex items-center justify-between border-b border-border-dark/30 pb-1.5 mb-1.5">
                        <span className="text-[10px] font-mono text-secondary font-bold bg-secondary/5 px-2 py-0.5 border border-secondary/10 rounded">
                          THOUGHT #{idx + 1}
                        </span>
                      </div>
                      <div className="text-xs text-text-main leading-relaxed select-text font-normal">
                        <MarkdownRenderer content={msg.content || ''} />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {rightPanelTab === 'logs' && (
          <div className="space-y-3.5 text-left">
            <div className="flex items-center gap-2 border-b border-border-dark pb-2 mb-3">
              <Code2 className="w-4.5 h-4.5 text-secondary" />
              <span className="text-xs font-bold text-text-muted uppercase tracking-wider font-heading">
                Step-by-step Execution Console
              </span>
            </div>
            
            {activeSession.logs.length === 0 && !isStreaming ? (
              <div className="text-center py-10 text-xs text-text-muted select-none">
                No tool executions logged for this session.
              </div>
            ) : (
              <div className="space-y-3">
                {activeSession.logs.map((log, idx) => (
                  <div key={idx} className="bg-card border border-border-dark rounded-xl p-3.5 space-y-2 relative overflow-hidden">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-mono text-primary font-bold bg-primary/5 px-2 py-0.5 border border-primary/10 rounded">
                        STEP {log.step}
                      </span>
                      <span className="text-[10px] text-text-muted uppercase font-mono tracking-wider font-bold">
                        {log.tool}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="text-[10px] font-semibold text-text-muted">Arguments:</div>
                      <pre className="p-2 rounded bg-bg-secondary text-[11px] font-mono overflow-x-auto text-[#9ECE6A] border border-border-dark/40 max-h-32">
                        {linkify(JSON.stringify(log.args, null, 2))}
                      </pre>
                    </div>

                    <div className="space-y-1">
                      <div className="text-[10px] font-semibold text-text-muted">Response:</div>
                      <pre className="p-2 rounded bg-bg-secondary text-[11px] font-mono overflow-x-auto text-text-main border border-border-dark/40 max-h-32">
                        {linkify(log.result)}
                      </pre>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {rightPanelTab === 'json' && (
          <div className="h-full flex flex-col">
            <JsonViewer data={activeSession} />
          </div>
        )}

        {rightPanelTab === 'files' && (
          <div className="h-full flex flex-col text-left">
            <div className="flex items-center gap-2 border-b border-border-dark pb-2 mb-3">
              <FolderOpen className="w-4.5 h-4.5 text-secondary animate-pulse" />
              <span className="text-xs font-bold text-text-muted uppercase tracking-wider font-heading">
                Workspace File Manager
              </span>
            </div>

            {selectedFile ? (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center gap-2 mb-3">
                  <button
                    onClick={() => setSelectedFile(null)}
                    className="flex items-center gap-1 text-xs text-text-muted hover:text-text-main bg-[#1E293B] hover:bg-card border border-border-dark px-2.5 py-1 rounded-lg transition-all cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Back</span>
                  </button>
                  <span className="text-xs font-mono text-text-muted truncate max-w-[200px]" title={selectedFile}>
                    {selectedFile}
                  </span>
                </div>
                {isLoadingContent ? (
                  <div className="flex-1 flex items-center justify-center py-20">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto">
                    <CodeBlock code={fileContent} language={getLanguageFromExtension(selectedFile)} />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col">
                {isLoadingFiles ? (
                  <div className="flex-1 flex items-center justify-center py-20">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : files.length === 0 ? (
                  <div className="text-center py-10 text-xs text-text-muted select-none">
                    No files found in workspace container.
                  </div>
                ) : (
                  <div className="space-y-1 overflow-y-auto pr-1">
                    {files.map((file) => (
                      <button
                        key={file}
                        onClick={() => setSelectedFile(file)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-border-dark/40 hover:border-primary/30 bg-[#0F1420]/40 hover:bg-primary/[0.02] text-left transition-all active:scale-[0.99] group cursor-pointer"
                      >
                        <FileText className="w-4 h-4 text-secondary group-hover:text-primary transition-colors shrink-0" />
                        <span className="text-xs font-mono text-text-main truncate group-hover:text-primary transition-colors flex-1">
                          {file}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {rightPanelTab === 'prompt' && (
          <div className="space-y-4 text-left">
            <div className="flex items-center gap-2 border-b border-border-dark pb-2 mb-3">
              <FileText className="w-4.5 h-4.5 text-primary" />
              <span className="text-xs font-bold text-text-muted uppercase tracking-wider font-heading">
                Raw LLM Context Window
              </span>
            </div>
            
            {activeSession.system_prompt && (
              <div className="bg-card border border-border-dark rounded-xl p-3.5 space-y-2 relative overflow-hidden">
                <div className="flex items-center justify-between border-b border-border-dark/30 pb-1.5 mb-1.5 animate-fade-in">
                  <span className="text-[10px] font-mono text-primary font-bold bg-primary/5 px-2 py-0.5 border border-primary/10 rounded">
                    SYSTEM PROMPT
                  </span>
                  <span className="text-[9px] text-text-muted font-mono">
                    ~{Math.ceil(activeSession.system_prompt.length / 4.2)} tokens
                  </span>
                </div>
                <details className="group cursor-pointer">
                  <summary className="text-xs font-semibold text-text-muted select-none flex justify-between items-center group-open:mb-2">
                    <span>View System Instructions</span>
                    <span className="text-[10px] opacity-60 group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <pre className="p-3 rounded bg-bg-secondary text-[11px] font-mono overflow-x-auto text-text-muted border border-border-dark/40 max-h-60 select-text whitespace-pre-wrap leading-relaxed cursor-text">
                    {activeSession.system_prompt}
                  </pre>
                </details>
              </div>
            )}

            <div className="space-y-3 font-sans">
              <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider pl-1">
                Message History ({activeSession.history ? activeSession.history.length : 0})
              </div>
              
              {(!activeSession.history || activeSession.history.length === 0) ? (
                <div className="text-center py-6 text-xs text-text-muted select-none">
                  No conversation history.
                </div>
              ) : (
                activeSession.history.map((msg, idx) => {
                  const roleColors: Record<string, string> = {
                    system: 'text-amber-400 bg-amber-500/5 border-amber-500/15',
                    user: 'text-sky-400 bg-sky-500/5 border-sky-500/15',
                    assistant: 'text-emerald-400 bg-emerald-500/5 border-emerald-500/15',
                    tool: 'text-purple-400 bg-purple-500/5 border-purple-500/15'
                  };
                  const roleName = msg.role.toUpperCase();
                  const tokenCount = Math.ceil((msg.content?.length || 0) / 4.2);
                  
                  return (
                    <div key={idx} className="bg-card border border-border-dark rounded-xl p-3.5 space-y-2 relative overflow-hidden animate-fade-in">
                      <div className="flex items-center justify-between border-b border-border-dark/30 pb-1.5 mb-1.5 select-none">
                        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 border rounded ${roleColors[msg.role] || 'text-text-muted border-border-dark'}`}>
                          {roleName}
                        </span>
                        <span className="text-[9px] text-text-muted font-mono">
                          ~{tokenCount} tokens
                        </span>
                      </div>
                      
                      <details className="group cursor-pointer">
                        <summary className="text-xs font-semibold text-text-muted select-none flex justify-between items-center group-open:mb-2">
                          <span>View Message Content</span>
                          <span className="text-[10px] opacity-60 group-open:rotate-180 transition-transform">▼</span>
                        </summary>
                        <pre className="p-3 rounded bg-bg-secondary text-[11px] font-mono overflow-x-auto text-text-main border border-border-dark/40 max-h-48 select-text whitespace-pre-wrap leading-relaxed cursor-text">
                          {msg.content || '[Tool call definition - details in JSON tab]'}
                        </pre>
                      </details>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
};

export default RightPanel;
