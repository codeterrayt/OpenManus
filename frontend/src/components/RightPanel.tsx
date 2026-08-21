// src/components/RightPanel.tsx
import React, { useMemo } from 'react';
import { 
  BarChart3, 
  Clock, 
  Workflow, 
  Terminal, 
  FileJson,
  Brain,
  PanelRightClose,
  Globe,
  FolderOpen,
  ChevronLeft,
  FileText,
  Loader2,
  Sparkles
} from 'lucide-react';
import { useChatStore } from '../store/useChatStore';
import ExecutionTimeline from './ExecutionTimeline';
import JsonViewer from './JsonViewer';
import MarkdownRenderer from './MarkdownRenderer';
import BrowserPanel from './BrowserPanel';
import { VSCodeEditor } from './VSCodeEditor';
import { api } from '../services/api';

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
      const host = window.location.hostname || 'localhost';
      href = href.replace(/(localhost|127\.0\.0\.1)/i, host);
      return (
        <a 
          key={i} 
          href={href} 
          target="_self" 
          rel="noopener noreferrer" 
          className="text-indigo-400 hover:underline hover:text-indigo-300 font-semibold transition-colors"
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
    activeStreamingFile,
    activeStreamingCode,
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
      if (newWidth >= 280 && newWidth <= Math.min(850, maxAllowedWidth)) {
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

  const metrics = useMemo(() => {
    if (!activeSession) return { inputTokens: 0, outputTokens: 0, duration: '0s', stepsCount: 0 };

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

  const tabs = [
    { id: 'timeline', label: 'Timeline', icon: <Workflow className="w-3.5 h-3.5" /> },
    { id: 'thoughts', label: 'Thoughts', icon: <Brain className="w-3.5 h-3.5" /> },
    { id: 'logs', label: 'Console', icon: <Terminal className="w-3.5 h-3.5" /> },
    { id: 'json', label: 'JSON', icon: <FileJson className="w-3.5 h-3.5" /> },
    { id: 'browser', label: 'Browser', icon: <Globe className="w-3.5 h-3.5" /> },
    { id: 'files', label: 'Files', icon: <FolderOpen className="w-3.5 h-3.5" /> },
    { id: 'prompt', label: 'Prompt', icon: <FileText className="w-3.5 h-3.5" /> },
  ] as const;

  return (
    <div 
      className={`border-l border-white/[0.08] bg-[#0A0C13] flex flex-col h-full overflow-hidden select-none shrink-0 relative ${
        rightPanelCollapsed ? 'opacity-0 border-l-0 pointer-events-none' : 'opacity-100'
      }`}
      style={{
        width: rightPanelCollapsed ? '0px' : `${rightPanelWidth}px`,
        transition: isDragging ? 'none' : 'width 250ms ease-in-out, opacity 250ms'
      }}
    >
      {/* Resizer Handle */}
      {!rightPanelCollapsed && (
        <div
          onMouseDown={startResizing}
          className={`absolute top-0 left-0 w-1.5 h-full cursor-col-resize hover:bg-indigo-500/40 transition-colors z-50 flex items-center justify-center group ${
            isDragging ? 'bg-indigo-500/50' : ''
          }`}
        >
          <div className={`w-[1px] h-10 bg-white/[0.15] group-hover:bg-indigo-400 transition-colors ${
            isDragging ? 'bg-indigo-400' : ''
          }`} />
        </div>
      )}

      {/* Header Bar */}
      <div className="p-3.5 border-b border-white/[0.06] bg-[#0E121B] flex items-center justify-between pl-3.5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <h2 className="font-heading font-bold text-xs tracking-tight text-white">
            Mission Workspace
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {activeSession && (
            <span className={`text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded-full border ${
              activeSession.status === 'running' 
                ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300 animate-pulse'
                : activeSession.status === 'done'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : activeSession.status === 'failed'
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                : 'bg-white/[0.04] border-white/[0.08] text-slate-400'
            }`}>
              {activeSession.status}
            </span>
          )}

          <button
            type="button"
            onClick={toggleRightPanel}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
            title="Collapse Inspector"
          >
            <PanelRightClose className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!activeSession ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none">
          <Brain className="w-8 h-8 text-slate-600 mb-2" />
          <p className="text-xs text-slate-500">Select or start a session to inspect runtime analytics and browser state.</p>
        </div>
      ) : (
        <>
          {/* Quick Metrics Bar */}
          <div className="p-3 bg-[#0D1017] border-b border-white/[0.06] grid grid-cols-2 gap-2.5 text-left">
            <div className="bg-[#121622] border border-white/[0.06] rounded-xl p-2.5 space-y-1">
              <div className="flex justify-between items-center text-[10px] text-slate-400">
                <span>Tokens Est.</span>
                <BarChart3 className="w-3 h-3 text-indigo-400" />
              </div>
              <div className="text-sm font-bold text-white font-mono">
                {metrics.inputTokens + metrics.outputTokens}
              </div>
              <div className="text-[9px] text-slate-500 flex justify-between font-mono">
                <span>In: {metrics.inputTokens}</span>
                <span>Out: {metrics.outputTokens}</span>
              </div>
            </div>

            <div className="bg-[#121622] border border-white/[0.06] rounded-xl p-2.5 space-y-1">
              <div className="flex justify-between items-center text-[10px] text-slate-400">
                <span>Execution Time</span>
                <Clock className="w-3 h-3 text-sky-400" />
              </div>
              <div className="text-sm font-bold text-white font-mono">
                {isStreaming ? 'Running...' : metrics.duration}
              </div>
              <div className="text-[9px] text-slate-500 flex justify-between font-mono">
                <span>Steps: {metrics.stepsCount}</span>
                <span>Avg: {metrics.stepsCount > 0 && !isStreaming ? `${(parseFloat(metrics.duration)/metrics.stepsCount).toFixed(1)}s` : '0.0s'}</span>
              </div>
            </div>
          </div>

          {/* Tab Selector */}
          <div className="flex border-b border-white/[0.06] bg-[#0A0C13] p-1 gap-0.5 overflow-x-auto scrollbar-none">
            {tabs.map((tab) => (
              <button
                type="button"
                key={tab.id}
                onClick={() => setRightPanelTab(tab.id as any)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
                  rightPanelTab === tab.id
                    ? 'bg-[#151926] text-white border border-white/[0.08] shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                {tab.icon}
                <span className="text-[11px]">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Tab Content Body */}
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
              <div className="space-y-3 text-left">
                {(() => {
                  const thoughts = activeSession.history.filter(
                    m => m.role === 'assistant' && m.content
                  );
                  
                  if (thoughts.length === 0) {
                    return (
                      <div className="text-center py-10 text-xs text-slate-500">
                        No assistant reasoning logged yet.
                      </div>
                    );
                  }
                  
                  return (
                    <div className="space-y-3">
                      {thoughts.map((msg, idx) => (
                        <div key={idx} className="bg-[#121622] border border-white/[0.06] rounded-xl p-3 space-y-2">
                          <div className="text-[10px] font-mono font-bold text-indigo-400">
                            STEP #{idx + 1}
                          </div>
                          <div className="text-xs text-slate-200 leading-relaxed select-text">
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
              <div className="space-y-3 text-left">
                {activeSession.logs.length === 0 && !isStreaming ? (
                  <div className="text-center py-10 text-xs text-slate-500">
                    No actions logged for this session.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {activeSession.logs.map((log, idx) => (
                      <div key={idx} className="bg-[#121622] border border-white/[0.06] rounded-xl p-3 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-mono text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded">
                            STEP {log.step}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono font-bold">
                            {log.tool}
                          </span>
                        </div>

                        <div className="space-y-1">
                          <div className="text-[10px] font-bold text-slate-500 uppercase">Arguments:</div>
                          <pre className="p-2 rounded bg-[#0A0C13] text-[11px] font-mono overflow-x-auto text-slate-300 border border-white/[0.04] max-h-28">
                            {linkify(JSON.stringify(log.args, null, 2))}
                          </pre>
                        </div>

                        <div className="space-y-1">
                          <div className="text-[10px] font-bold text-slate-500 uppercase">Output:</div>
                          <pre className="p-2 rounded bg-[#0A0C13] text-[11px] font-mono overflow-x-auto text-emerald-400/90 border border-white/[0.04] max-h-32">
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
                {selectedFile ? (
                  <div className="flex-1 flex flex-col min-h-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedFile(null)}
                        className="flex items-center gap-1 text-xs text-slate-400 hover:text-white bg-[#151926] border border-white/[0.08] px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        <span>All Files</span>
                      </button>
                      <span className="text-xs font-mono text-slate-300 truncate max-w-[220px]" title={selectedFile}>
                        {selectedFile}
                      </span>
                    </div>

                    {isLoadingContent && !(activeStreamingFile === selectedFile) ? (
                      <div className="flex-1 flex items-center justify-center py-20">
                        <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                      </div>
                    ) : (
                      <div className="flex-1 min-h-0">
                        <VSCodeEditor 
                          filePath={selectedFile}
                          code={activeStreamingFile === selectedFile && activeStreamingCode ? activeStreamingCode : fileContent}
                          isStreaming={activeStreamingFile === selectedFile}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col">
                    {isLoadingFiles && files.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center py-20">
                        <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                      </div>
                    ) : files.length === 0 && !activeStreamingFile ? (
                      <div className="text-center py-10 text-xs text-slate-500">
                        No sandbox files generated yet.
                      </div>
                    ) : (
                      <div className="space-y-1.5 overflow-y-auto">
                        {activeStreamingFile && !files.includes(activeStreamingFile) && (
                          <button
                            type="button"
                            onClick={() => setSelectedFile(activeStreamingFile)}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 text-left transition-colors cursor-pointer animate-pulse"
                          >
                            <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                            <span className="text-xs font-mono text-white truncate flex-1 font-semibold">
                              {activeStreamingFile}
                            </span>
                            <span className="text-[10px] font-mono text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded">
                              Writing...
                            </span>
                          </button>
                        )}
                        {files.map((file) => (
                          <button
                            type="button"
                            key={file}
                            onClick={() => setSelectedFile(file)}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors cursor-pointer text-left ${
                              activeStreamingFile === file 
                                ? 'border-indigo-500/40 bg-indigo-500/10 text-white'
                                : 'border-white/[0.06] hover:border-indigo-500/40 bg-[#121622] hover:bg-[#161B2A] text-slate-200'
                            }`}
                          >
                            <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                            <span className="text-xs font-mono truncate flex-1">
                              {file}
                            </span>
                            {activeStreamingFile === file && (
                              <span className="text-[10px] font-mono text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded animate-pulse">
                                Live
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {rightPanelTab === 'prompt' && (
              <div className="space-y-3 text-left">
                {activeSession.system_prompt && (
                  <div className="bg-[#121622] border border-white/[0.06] rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between border-b border-white/[0.06] pb-1.5">
                      <span className="text-[10px] font-mono text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded">
                        SYSTEM INSTRUCTIONS
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        ~{Math.ceil(activeSession.system_prompt.length / 4.2)} tokens
                      </span>
                    </div>
                    <details className="group cursor-pointer">
                      <summary className="text-xs font-semibold text-slate-400 select-none flex justify-between items-center group-open:mb-2">
                        <span>View System Prompt</span>
                        <span className="text-[10px] text-slate-500 group-open:rotate-180 transition-transform">▼</span>
                      </summary>
                      <pre className="p-2.5 rounded bg-[#0A0C13] text-[11px] font-mono overflow-x-auto text-slate-300 border border-white/[0.04] max-h-60 select-text whitespace-pre-wrap leading-relaxed">
                        {activeSession.system_prompt}
                      </pre>
                    </details>
                  </div>
                )}

                <div className="space-y-2 font-sans">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1">
                    Conversation History ({activeSession.history ? activeSession.history.length : 0})
                  </div>
                  
                  {(!activeSession.history || activeSession.history.length === 0) ? (
                    <div className="text-center py-6 text-xs text-slate-500">
                      No message history.
                    </div>
                  ) : (
                    activeSession.history.map((msg, idx) => (
                      <div key={idx} className="bg-[#121622] border border-white/[0.06] rounded-xl p-3 space-y-1.5">
                        <div className="flex items-center justify-between border-b border-white/[0.06] pb-1">
                          <span className="text-[10px] font-mono font-bold uppercase text-slate-300">
                            {msg.role}
                          </span>
                          <span className="text-[9px] text-slate-500 font-mono">
                            ~{Math.ceil((msg.content?.length || 0) / 4.2)} tokens
                          </span>
                        </div>
                        <details className="group cursor-pointer">
                          <summary className="text-xs text-slate-400 select-none flex justify-between items-center group-open:mb-1.5">
                            <span className="truncate max-w-[200px]">{msg.content?.slice(0, 40) || 'Tool payload'}</span>
                            <span className="text-[10px] text-slate-500 group-open:rotate-180 transition-transform">▼</span>
                          </summary>
                          <pre className="p-2 rounded bg-[#0A0C13] text-[11px] font-mono overflow-x-auto text-slate-200 border border-white/[0.04] max-h-40 select-text whitespace-pre-wrap leading-relaxed">
                            {msg.content || '[Tool Call JSON Content]'}
                          </pre>
                        </details>
                      </div>
                    ))
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
