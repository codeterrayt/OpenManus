// src/components/StreamingMessage.tsx
import React, { useState, useEffect } from 'react';
import { 
  BookText, 
  Sparkles, 
  Square, 
  Loader2, 
  Brain, 
  Terminal, 
  Globe, 
  FileCode2, 
  FolderGit2, 
  Settings, 
  Layers,
  Clock
} from 'lucide-react';
import { GenUIRenderer } from './GenUIRenderer';
import { useChatStore, formatToolActivity } from '../store/useChatStore';
import { ToolCallsGroup } from './ToolCallsGroup';
import { ThinkingBlock } from './ThinkingBlock';
import MarkdownRenderer from './MarkdownRenderer';

const parseC1UiBlock = (content: string) => {
  const openTags = ['<c1_ui>', '<c1-component>', '<thesys>'];
  const closeTags = ['</c1_ui>', '</c1-component>', '</thesys>'];

  for (let i = 0; i < openTags.length; i++) {
    const openTag = openTags[i];
    const closeTag = closeTags[i];
    const openIdx = content.indexOf(openTag);
    if (openIdx !== -1) {
      const closeIdx = content.indexOf(closeTag, openIdx + openTag.length);
      if (closeIdx !== -1) {
        const payload = content.slice(openIdx + openTag.length, closeIdx).trim();
        const cleanContent = (content.slice(0, openIdx) + content.slice(closeIdx + closeTag.length)).trim();
        return { payload, cleanContent };
      } else {
        const payload = content.slice(openIdx + openTag.length).trim();
        const cleanContent = content.slice(0, openIdx).trim();
        return { payload, cleanContent };
      }
    }
  }

  return { payload: null, cleanContent: content };
};

export const StreamingMessage: React.FC = () => {
  const { 
    isStreaming, 
    streamingContent, 
    streamingThoughts, 
    activeToolCalls, 
    abortChat,
    streamingSteps,
    isSummarizing,
    lastSummary,
    selectedModel,
    lastThoughts,
    streamingReasoning,
    setSelectedFile,
    setRightPanelTab,
    setRightPanelCollapsed
  } = useChatStore();

  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const toolCallsArray = Object.values(activeToolCalls);
  const runningToolCalls = toolCallsArray.filter(t => t.status === 'running');
  const hasRunningTools = runningToolCalls.length > 0;
  const activeRunningTool = runningToolCalls[0];

  // Timer for LLM thinking & tool execution
  useEffect(() => {
    let interval: any = null;
    if (isStreaming) {
      setElapsedSeconds(0);
      interval = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isStreaming]);

  // Clean, honest status when waiting for LLM tokens
  const getLlmStatusText = () => {
    const modelLabel = selectedModel ? `[${selectedModel}]` : '';
    if (elapsedSeconds < 4) {
      return `Analyzing mission request and formulating plan ${modelLabel}... (${elapsedSeconds}s)`;
    }
    if (elapsedSeconds < 12) {
      return `Reasoning and generating tokens ${modelLabel}... (${elapsedSeconds}s)`;
    }
    if (elapsedSeconds < 25) {
      return `Deep reasoning in progress ${modelLabel}... (${elapsedSeconds}s)`;
    }
    return `Synthesizing comprehensive response ${modelLabel}... (${elapsedSeconds}s)`;
  };

  const getToolIcon = (toolName: string) => {
    switch (toolName) {
      case 'readFile':
      case 'read_file':
      case 'writeFile':
      case 'write_file':
      case 'appendFile':
      case 'append_file':
      case 'deleteFile':
      case 'delete_file':
        return <FileCode2 className="w-4 h-4 text-emerald-400" />;
      case 'run_code':
        return <Terminal className="w-4 h-4 text-indigo-400" />;
      case 'browse_web':
      case 'inspect_page_html':
        return <Globe className="w-4 h-4 text-sky-400" />;
      case 'pull_docker_image':
      case 'docker':
      case 'docker_build':
      case 'docker_compose':
        return <Layers className="w-4 h-4 text-cyan-400" />;
      case 'save_skill':
      case 'get_skill':
      case 'list_skills':
        return <FolderGit2 className="w-4 h-4 text-amber-400" />;
      default:
        return <Settings className="w-4 h-4 text-slate-400" />;
    }
  };

  const thoughtsToDisplay = streamingReasoning 
    ? streamingReasoning.replace(/<\/?(thinking|thought|think)>/gi, '').trim() 
    : lastThoughts ? lastThoughts.replace(/<\/?(thinking|thought|think)>/gi, '').trim() : '';

  return (
    <div className="flex w-full justify-start animate-fade-in">
      <div className="flex w-full max-w-3xl gap-3.5 flex-row">
        {/* Avatar */}
        <div className="shrink-0 w-8 h-8 rounded-xl bg-[#151926] border border-white/[0.08] text-indigo-400 flex items-center justify-center shadow-sm">
          <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
        </div>

        {/* Content Area */}
        <div className="flex-1 space-y-3 min-w-0 text-left">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs text-slate-200 tracking-tight">
                OpenManus
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping"></span>
              <span className="text-[10px] text-slate-400 font-mono px-2 py-0.5 rounded bg-white/[0.05] border border-white/[0.08]">
                Step {streamingSteps?.current || 1}/{streamingSteps?.total || 20}
              </span>
            </div>
            
            {streamingThoughts && (
              <span className="text-[10px] text-indigo-300 flex items-center gap-1.5 bg-indigo-500/10 px-2.5 py-0.5 border border-indigo-500/20 rounded-full font-mono max-w-[320px] truncate">
                <Loader2 className="w-2.5 h-2.5 animate-spin text-indigo-400 shrink-0" />
                <span className="truncate">{streamingThoughts}</span>
              </span>
            )}
          </div>

          {/* Live Action Execution Card (when tools like read/write/run/browse are running) */}
          {hasRunningTools && activeRunningTool && (
            <div 
              onClick={() => {
                if (activeRunningTool.args?.path) {
                  const relPath = activeRunningTool.args.path.replace(/^\/?workspace\/?/, '').replace(/^\//, '');
                  setSelectedFile(relPath);
                  setRightPanelTab('files');
                  setRightPanelCollapsed(false);
                }
              }}
              className={`p-3 rounded-xl border border-indigo-500/30 bg-indigo-500/[0.06] shadow-sm space-y-2 ${
                activeRunningTool.args?.path ? 'cursor-pointer hover:bg-indigo-500/[0.1] transition-colors' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/30">
                    {getToolIcon(activeRunningTool.name)}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white font-mono">
                      {formatToolActivity(activeRunningTool.name, activeRunningTool.args)}
                    </div>
                    <div className="text-[10px] text-indigo-300/80 font-mono mt-0.5 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-indigo-400" />
                      <span>In progress • {((Date.now() - activeRunningTool.startTime) / 1000).toFixed(1)}s elapsed</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {(activeRunningTool.name === 'write_file' || activeRunningTool.name === 'writeFile') && activeRunningTool.args?.path && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const relPath = activeRunningTool.args.path.replace(/^\/?workspace\/?/, '').replace(/^\//, '');
                        setSelectedFile(relPath);
                        setRightPanelTab('files');
                        setRightPanelCollapsed(false);
                      }}
                      className="text-[11px] font-medium text-indigo-300 hover:text-white bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer font-sans"
                    >
                      <Loader2 className="w-3 h-3 animate-spin text-indigo-400 shrink-0" />
                      <span>View</span>
                    </button>
                  )}

                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-400 bg-indigo-500/20 border border-indigo-500/40 px-2.5 py-0.5 rounded-full font-mono">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Executing</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Thinking Block */}
          {thoughtsToDisplay && (
            <ThinkingBlock content={thoughtsToDisplay} isLive={true} defaultExpanded={true} />
          )}

          {/* Waiting for first response tokens (when no tools and no content yet) */}
          {!thoughtsToDisplay && !streamingContent && !hasRunningTools && (
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-slate-400">
                <Brain className="w-4 h-4 text-indigo-400 animate-pulse" />
                <span className="text-xs font-semibold">Formulating execution plan...</span>
              </div>
              <div className="space-y-1.5 max-w-md">
                <div className="h-2 bg-white/[0.05] rounded-full w-full animate-pulse"></div>
                <div className="h-2 bg-white/[0.05] rounded-full w-4/5 animate-pulse"></div>
              </div>
              <div className="text-[11px] font-mono text-slate-400 bg-white/[0.04] border border-white/[0.06] px-3 py-1.5 rounded-lg inline-block">
                {getLlmStatusText()}
              </div>
            </div>
          )}

          {/* Live standard response content */}
          {streamingContent && (() => {
            const { payload, cleanContent } = parseC1UiBlock(streamingContent);
            const cleanText = cleanContent.replace(/<\/?(thinking|thought|think)>/gi, '').trim();
            return (
              <div className="space-y-3 select-text">
                {cleanText && (
                  <div className="text-slate-200 leading-relaxed text-sm">
                    <MarkdownRenderer content={cleanText} className="streaming-cursor" />
                  </div>
                )}
                {payload && (
                  <GenUIRenderer payload={payload} />
                )}
              </div>
            );
          })()}

          {/* Summary status banners */}
          {isSummarizing && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs font-medium animate-pulse">
              <BookText className="w-3.5 h-3.5 shrink-0" />
              <span>Compressing conversation history to optimize context...</span>
              <Loader2 className="w-3 h-3 animate-spin ml-auto" />
            </div>
          )}

          {lastSummary && !isSummarizing && (
            <details className="rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden group">
              <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer list-none text-amber-300 text-[11px] font-semibold uppercase tracking-wider hover:bg-amber-500/10 transition-colors">
                <BookText className="w-3.5 h-3.5" />
                <span>Context Compressed</span>
                <span className="ml-auto text-slate-400 text-[10px] group-open:hidden">▼ expand</span>
                <span className="ml-auto text-slate-400 text-[10px] hidden group-open:block">▲ collapse</span>
              </summary>
              <div className="px-3 pb-3 pt-2 border-t border-amber-500/15 text-slate-200 text-xs leading-relaxed max-h-48 overflow-y-auto select-text">
                <MarkdownRenderer content={lastSummary} />
              </div>
            </details>
          )}

          {/* Live Tool Calls */}
          {toolCallsArray.length > 0 && (
            <ToolCallsGroup toolCalls={toolCallsArray} />
          )}

          {/* Abort Button */}
          <div className="pt-2">
            <button
              type="button"
              onClick={abortChat}
              className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 px-3 py-1.5 rounded-lg transition-colors font-semibold active:scale-95 cursor-pointer"
            >
              <Square className="w-3 h-3 fill-rose-400" />
              <span>Stop Agent</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StreamingMessage;
