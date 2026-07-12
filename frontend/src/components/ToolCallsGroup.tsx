import React, { useState } from 'react';
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
  Code
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
          className="text-primary hover:underline hover:text-secondary transition-colors"
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
  const { setSelectedFile, setRightPanelTab, setRightPanelCollapsed } = useChatStore();

  if (toolCalls.length === 0) return null;

  const selectedCall = toolCalls.find(tc => tc.id === selectedId);

  const getToolIcon = (name: string) => {
    switch (name) {
      case 'run_code':
        return <Terminal className="w-3.5 h-3.5" />;
      case 'browse_web':
      case 'inspect_page_html':
        return <Globe className="w-3.5 h-3.5" />;
      case 'list_skills':
      case 'get_skill':
      case 'save_skill':
        return <FolderGit2 className="w-3.5 h-3.5" />;
      default:
        return <Settings className="w-3.5 h-3.5" />;
    }
  };

  const getStatusIcon = (status: StandardToolCall['status']) => {
    switch (status) {
      case 'running':
        return <Loader2 className="w-3 h-3 text-primary animate-spin" />;
      case 'success':
        return <CheckCircle2 className="w-3 h-3 text-emerald-400 shadow-neon-cyan" />;
      case 'error':
        return <XCircle className="w-3 h-3 text-rose-400" />;
      default:
        return <Clock className="w-3 h-3 text-text-muted/60" />;
    }
  };

  const getBadgeStyle = (tc: StandardToolCall) => {
    const isSelected = tc.id === selectedId;
    let base = "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono border cursor-pointer select-none transition-all duration-200 active:scale-95 ";
    
    if (isSelected) {
      base += "bg-primary/10 border-primary text-text-main shadow-neon-blue ring-1 ring-primary/30 ";
    } else {
      switch (tc.status) {
        case 'running':
          base += "bg-primary/5 border-primary/20 text-primary hover:bg-primary/10 hover:border-primary/30 ";
          break;
        case 'success':
          base += "bg-emerald-500/5 border-emerald-500/10 text-text-main hover:bg-emerald-500/10 hover:border-emerald-500/30 ";
          break;
        case 'error':
          base += "bg-rose-500/5 border-rose-500/20 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/35 ";
          break;
        default:
          base += "bg-card/45 border-border-dark/60 text-text-muted hover:bg-bg-secondary hover:border-border-dark/90 ";
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

  const hasOutput = (call: StandardToolCall) => {
    return call.status === 'running' || !!call.error || (!!call.result && getOutputPreview(call).trim() !== '');
  };

  return (
    <div className="space-y-3.5">
      {/* Badges Container */}
      <div className="flex flex-wrap gap-2 items-center bg-[#0F1422]/30 p-2.5 rounded-xl border border-border-dark/40">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-text-muted mr-1">Steps:</span>
        {toolCalls.map((tc) => (
          <div
            key={tc.id}
            onClick={() => setSelectedId(selectedId === tc.id ? null : tc.id)}
            className={getBadgeStyle(tc)}
            title={`${tc.name} - ${tc.status}`}
          >
            {getStatusIcon(tc.status)}
            <span className="flex items-center gap-1">
              {getToolIcon(tc.name)}
              <span>{tc.name}</span>
            </span>
            {tc.duration !== undefined && (
              <span className="text-[10px] opacity-70">
                {(tc.duration / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Expanded Shared Console Details */}
      <AnimatePresence>
        {selectedCall && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="border border-border-dark/70 rounded-xl bg-[#090D16] overflow-hidden shadow-2xl">
              {/* Detail Header */}
              <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#0D1220] border-b border-border-dark/60">
                <div className="flex items-center gap-2">
                  <Code className="w-4 h-4 text-secondary" />
                  <span className="text-xs font-semibold text-text-main font-heading">
                    Step Details: <span className="font-mono text-primary">{selectedCall.name}</span>
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${
                    selectedCall.status === 'success' 
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                      : selectedCall.status === 'error'
                      ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      : selectedCall.status === 'running'
                      ? 'bg-primary/10 text-primary border border-primary/20 animate-pulse'
                      : 'bg-card border border-border-dark text-text-muted'
                  }`}>
                    {selectedCall.status}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  {selectedCall.status === 'success' && selectedCall.name === 'write_file' && selectedCall.args?.path && (
                    <button
                      onClick={() => {
                        const relPath = selectedCall.args.path.replace(/^\/?workspace\/?/, '').replace(/^\//, '');
                        setSelectedFile(relPath);
                        setRightPanelTab('files');
                        setRightPanelCollapsed(false);
                      }}
                      className="flex items-center gap-1 text-[10px] font-semibold text-primary bg-primary/15 hover:bg-primary/25 border border-primary/20 hover:border-primary/30 px-2.5 py-1 rounded-lg transition-all active:scale-95 shadow-neon-blue cursor-pointer"
                    >
                      <Eye className="w-3 h-3" />
                      <span>Open File</span>
                    </button>
                  )}
                  <button 
                    onClick={() => setSelectedId(null)}
                    className="text-text-muted hover:text-text-main text-[11px] font-medium transition-all"
                  >
                    Close
                  </button>
                </div>
              </div>

              {/* Detail Content */}
              <div className="p-3.5 space-y-3.5">
                {/* Arguments / Input Details */}
                {selectedCall.name === 'run_code' && selectedCall.args?.code && (
                  <div className="space-y-1.5 text-left">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Source Code ({selectedCall.args.lang})</div>
                    <pre className="p-3 rounded-lg text-xs font-mono overflow-x-auto bg-[#04060A]/70 text-text-main border border-border-dark/45 max-h-40 leading-relaxed select-text">
                      {selectedCall.args.code}
                    </pre>
                  </div>
                )}

                {selectedCall.name === 'browse_web' && selectedCall.args && (
                  <div className="space-y-1.5 text-left bg-card/15 border border-border-dark/40 rounded-lg p-2.5">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Browser Task</div>
                    <div className="text-xs font-semibold text-text-main">
                      URL: <a href={selectedCall.args.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{selectedCall.args.url}</a>
                    </div>
                    {selectedCall.args.instructions && (
                      <div className="text-[11px] text-text-muted mt-1 font-mono">Instructions: {selectedCall.args.instructions}</div>
                    )}
                  </div>
                )}

                {selectedCall.name === 'write_file' && selectedCall.args && (
                  <div className="space-y-1.5 text-left">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">File Path</div>
                    <div className="text-xs font-mono text-text-main bg-[#04060A]/70 border border-border-dark/45 p-2 rounded-lg">{selectedCall.args.path}</div>
                  </div>
                )}

                {/* Outputs / Errors */}
                {hasOutput(selectedCall) && (
                  <div className="space-y-1.5 text-left">
                    <div className="flex items-center gap-1 text-[10px] font-bold text-text-muted uppercase tracking-wider">
                      <Eye className="w-3.5 h-3.5 text-primary" />
                      <span>Console Output</span>
                    </div>
                    <pre className={`p-3 rounded-lg text-xs font-mono overflow-x-auto max-h-52 leading-relaxed border ${
                      selectedCall.error 
                        ? 'bg-rose-950/25 text-rose-300 border-rose-500/20' 
                        : selectedCall.status === 'running'
                        ? 'bg-[#04060A]/70 text-text-muted border-border-dark/35 animate-pulse'
                        : 'bg-[#04060A]/70 text-[#9ECE6A] border-border-dark/40'
                    }`}>
                      {selectedCall.status === 'running' 
                        ? 'Executing task... Waiting for stdout/stderr.' 
                        : linkify(getOutputPreview(selectedCall))
                      }
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
