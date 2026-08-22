// src/components/ToolCallsGroup.tsx
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Terminal, 
  Globe, 
  FolderGit2, 
  Settings, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Eye, 
  FileCode,
  Layers,
  Copy,
  Check,
  ChevronUp
} from 'lucide-react';
import { useChatStore } from '../store/useChatStore';

// Helper to make local links clickable and handle VM port forwarding
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

export interface StandardToolCall {
  id: string;
  name: string;
  args: any;
  status: 'running' | 'success' | 'error' | 'waiting';
  result?: any;
  error?: string;
  duration?: number;
}

interface ToolCallsGroupProps {
  toolCalls: StandardToolCall[];
}

export const ToolCallsGroup: React.FC<ToolCallsGroupProps> = ({ toolCalls }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copiedOutput, setCopiedOutput] = useState(false);
  const [, setTick] = useState(0);
  const { setSelectedFile, setRightPanelTab, setRightPanelCollapsed } = useChatStore();

  const hasRunning = toolCalls.some(tc => tc.status === 'running');

  // Re-render every 200ms while any tool is running to update elapsed duration in real time
  useEffect(() => {
    let interval: any = null;
    if (hasRunning) {
      interval = setInterval(() => {
        setTick(t => t + 1);
      }, 200);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [hasRunning]);

  if (toolCalls.length === 0) return null;

  const selectedCall = toolCalls.find(tc => tc.id === selectedId);

  const getToolIcon = (name: string) => {
    switch (name) {
      case 'readFile':
      case 'read_file':
      case 'writeFile':
      case 'write_file':
      case 'appendFile':
      case 'append_file':
      case 'deleteFile':
      case 'delete_file':
        return <FileCode className="w-3.5 h-3.5 text-emerald-400" />;
      case 'run_code':
        return <Terminal className="w-3.5 h-3.5 text-indigo-400" />;
      case 'browse_web':
      case 'inspect_page_html':
        return <Globe className="w-3.5 h-3.5 text-sky-400" />;
      case 'pull_docker_image':
      case 'docker':
      case 'docker_build':
      case 'docker_compose':
        return <Layers className="w-3.5 h-3.5 text-slate-400" />;
      case 'list_skills':
      case 'get_skill':
      case 'save_skill':
        return <FolderGit2 className="w-3.5 h-3.5 text-amber-400" />;
      default:
        return <Settings className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  const getActionLabel = (tc: StandardToolCall) => {
    if (tc.name === 'readFile' || tc.name === 'read_file') {
      return `read:${tc.args?.path || 'file'}`;
    }
    if (tc.name === 'writeFile' || tc.name === 'write_file') {
      return `write:${tc.args?.path || 'file'}`;
    }
    if (tc.name === 'run_code') {
      return `exec:${tc.args?.lang || 'code'}`;
    }
    if (tc.name === 'browse_web') {
      return `browse:${tc.args?.action || 'web'}`;
    }
    if (tc.name === 'pull_docker_image') {
      return `pull:${tc.args?.image || 'image'}`;
    }
    return tc.name;
  };

  const getStatusIcon = (status: StandardToolCall['status']) => {
    switch (status) {
      case 'running':
        return <Loader2 className="w-3 h-3 text-indigo-400 animate-spin" />;
      case 'success':
        return <CheckCircle2 className="w-3 h-3 text-emerald-400" />;
      case 'error':
        return <XCircle className="w-3 h-3 text-rose-400" />;
      default:
        return <Clock className="w-3 h-3 text-slate-500" />;
    }
  };

  const getBadgeStyle = (tc: StandardToolCall) => {
    const isSelected = tc.id === selectedId;
    let base = "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono border cursor-pointer select-none transition-all duration-150 active:scale-95 ";
    
    if (isSelected) {
      base += "bg-indigo-500/15 border-indigo-500/50 text-white shadow-sm ring-1 ring-indigo-500/30 ";
    } else {
      switch (tc.status) {
        case 'running':
          base += "bg-indigo-500/10 border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/20 animate-pulse ";
          break;
        case 'success':
          base += "bg-white/[0.03] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] hover:border-white/[0.15] ";
          break;
        case 'error':
          base += "bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20 ";
          break;
        default:
          base += "bg-[#131722]/60 border-white/[0.06] text-slate-400 hover:bg-[#181D2B] ";
          break;
      }
    }
    return base;
  };

  const getOutputPreview = (call: StandardToolCall) => {
    if (call.error) return call.error;
    if (!call.result) return '';
    
    let rawText = '';
    if (typeof call.result === 'string') {
      rawText = call.result;
    } else if (call.result.stdout !== undefined || call.result.stderr !== undefined) {
      rawText = `${call.result.stdout || ''}${call.result.stderr ? '\n[Error]: ' + call.result.stderr : ''}`;
    } else {
      rawText = JSON.stringify(call.result, null, 2);
    }
    return rawText;
  };

  const handleCopyOutput = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedOutput(true);
    setTimeout(() => setCopiedOutput(false), 2000);
  };

  return (
    <div className="space-y-2.5 my-2">
      {/* Steps Pill Strip */}
      <div className="flex flex-wrap gap-1.5 items-center bg-[#0D1017]/80 p-2 rounded-xl border border-white/[0.06]">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 px-1">
          Actions ({toolCalls.length}):
        </span>
        {toolCalls.map((tc) => (
          <button
            type="button"
            key={tc.id}
            onClick={() => {
              const isFileOp = tc.name === 'write_file' || tc.name === 'writeFile' || tc.name === 'read_file' || tc.name === 'readFile';
              if (isFileOp && tc.args?.path) {
                const relPath = tc.args.path.replace(/^\/?workspace\/?/, '').replace(/^\//, '');
                setSelectedFile(relPath);
                setRightPanelTab('files');
                setRightPanelCollapsed(false);
              }
              setSelectedId(selectedId === tc.id ? null : tc.id);
            }}
            className={getBadgeStyle(tc)}
          >
            {getToolIcon(tc.name)}
            <span className="font-semibold">{getActionLabel(tc)}</span>
            {getStatusIcon(tc.status)}
            {tc.duration !== undefined && (
              <span className="text-[10px] text-slate-500">{(tc.duration / 1000).toFixed(1)}s</span>
            )}
          </button>
        ))}
      </div>

      {/* Selected Action Expanded Console View */}
      <AnimatePresence>
        {selectedCall && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="border border-white/[0.08] rounded-xl bg-[#0A0C13] overflow-hidden shadow-card-subtle">
              {/* Card Header */}
              <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#121622] border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded-md bg-white/[0.05] border border-white/[0.08]">
                    {getToolIcon(selectedCall.name)}
                  </div>
                  <div>
                    <span className="text-xs font-bold text-white font-mono">{selectedCall.name}</span>
                    {selectedCall.args?.path && (
                      <span className="text-[11px] text-slate-400 font-mono ml-2">
                        {selectedCall.args.path}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {(selectedCall.name === 'write_file' || selectedCall.name === 'writeFile') && selectedCall.args?.path && (
                    <button
                      type="button"
                      onClick={() => {
                        const relPath = selectedCall.args.path.replace(/^\/?workspace\/?/, '').replace(/^\//, '');
                        setSelectedFile(relPath);
                        setRightPanelTab('files');
                        setRightPanelCollapsed(false);
                      }}
                      className="flex items-center gap-1 text-[11px] font-semibold text-indigo-400 hover:text-white bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 px-2.5 py-1 rounded-lg transition-all cursor-pointer"
                    >
                      <Eye className="w-3 h-3" />
                      <span>Inspect File</span>
                    </button>
                  )}

                  {getOutputPreview(selectedCall) && (
                    <button
                      type="button"
                      onClick={() => handleCopyOutput(getOutputPreview(selectedCall))}
                      className="p-1 rounded-lg hover:bg-white/[0.08] text-slate-400 hover:text-white transition-colors"
                      title="Copy output"
                    >
                      {copiedOutput ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="p-1 rounded-lg hover:bg-white/[0.08] text-slate-400 hover:text-white transition-colors"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Arguments Block */}
              {selectedCall.args && (
                <div className="p-3 border-b border-white/[0.05] bg-[#0E121B]/50">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Input Parameters
                  </div>
                  <pre className="text-xs font-mono text-slate-300 overflow-x-auto max-h-36 select-text whitespace-pre-wrap">
                    {typeof selectedCall.args === 'object' ? JSON.stringify(selectedCall.args, null, 2) : selectedCall.args}
                  </pre>
                </div>
              )}

              {/* Output / Console Block */}
              <div className="p-3 bg-[#08090E]">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                  <span>Terminal / Execution Result</span>
                  {selectedCall.status === 'running' && (
                    <span className="text-indigo-400 animate-pulse">Running in sandbox container...</span>
                  )}
                </div>
                <pre className={`p-3 rounded-lg text-xs font-mono overflow-x-auto max-h-56 leading-relaxed border ${
                  selectedCall.error
                    ? 'bg-rose-950/20 text-rose-300 border-rose-500/20'
                    : selectedCall.status === 'running'
                    ? 'bg-indigo-950/10 text-slate-400 border-indigo-500/20 animate-pulse'
                    : 'bg-[#0B0D14] text-emerald-300/90 border-white/[0.06]'
                }`}>
                  {selectedCall.status === 'running'
                    ? 'Executing action in container... Waiting for output.'
                    : (linkify(getOutputPreview(selectedCall)) || 'Completed with no stdout return.')
                  }
                </pre>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ToolCallsGroup;
