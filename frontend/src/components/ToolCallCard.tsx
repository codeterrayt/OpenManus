// src/components/ToolCallCard.tsx
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
  ChevronDown, 
  ChevronUp, 
  Eye 
} from 'lucide-react';
import { useChatStore } from '../store/useChatStore';

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

interface ToolCallCardProps {
  id: string;
  name: string;
  args: any;
  status: 'running' | 'success' | 'error' | 'waiting';
  result?: any;
  error?: string;
  duration?: number;
}

export const ToolCallCard: React.FC<ToolCallCardProps> = ({
  name,
  args,
  status,
  result,
  error,
  duration
}) => {
  const [expanded, setExpanded] = useState(true);
  const { setSelectedFile, setRightPanelTab, setRightPanelCollapsed } = useChatStore();

  // Match tool to icon
  const getToolIcon = () => {
    switch (name) {
      case 'run_code':
        return <Terminal className="w-4 h-4 text-primary" />;
      case 'browse_web':
        return <Globe className="w-4 h-4 text-secondary" />;
      case 'list_skills':
      case 'get_skill':
      case 'save_skill':
        return <FolderGit2 className="w-4 h-4 text-amber-400" />;
      default:
        return <Settings className="w-4 h-4 text-text-muted" />;
    }
  };

  // Match tool to friendly name
  const getFriendlyName = () => {
    switch (name) {
      case 'run_code':
        return 'Sandbox Code Execution';
      case 'browse_web':
        return 'Web Automation Browser';
      case 'list_skills':
        return 'Fetch Saved Skills';
      case 'get_skill':
        return `Load Skill: ${args?.name || ''}`;
      case 'save_skill':
        return `Save Skill: ${args?.name || ''}`;
      default:
        return name;
    }
  };

  // Render status badge
  const renderStatus = () => {
    switch (status) {
      case 'running':
        return (
          <span className="flex items-center gap-1 text-[11px] font-medium text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Running</span>
          </span>
        );
      case 'success':
        return (
          <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-400/10 border border-emerald-500/20 px-2 py-0.5 rounded-full shadow-neon-cyan">
            <CheckCircle2 className="w-3 h-3" />
            <span>Success</span>
          </span>
        );
      case 'error':
        return (
          <span className="flex items-center gap-1 text-[11px] font-medium text-rose-400 bg-rose-400/10 border border-rose-500/20 px-2 py-0.5 rounded-full">
            <XCircle className="w-3 h-3" />
            <span>Failed</span>
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[11px] font-medium text-text-muted bg-bg-secondary border border-border-dark px-2 py-0.5 rounded-full">
            <Clock className="w-3 h-3" />
            <span>Waiting</span>
          </span>
        );
    }
  };

  // Parse stdout or output result
  const getOutputPreview = () => {
    if (error) return error;
    if (!result) return '';
    
    let rawText = '';
    if (typeof result === 'string') {
      rawText = result;
    } else if (result.stdout !== undefined || result.stderr !== undefined) {
      rawText = `${result.stdout || ''}${result.stderr ? '\n[Error]: ' + result.stderr : ''}`;
    } else {
      rawText = JSON.stringify(result, null, 2);
    }

    if (rawText.length > 250) {
      return rawText.slice(0, 250) + '...';
    }
    return rawText;
  };

  // Format arguments into parameters summary
  const getParamsSummary = () => {
    if (!args) return '';
    if (name === 'run_code') {
      return `${args.lang} sandbox code (${args.code?.split('\n').length || 0} lines)`;
    }
    if (name === 'browse_web') {
      return `navigate: ${args.url} (action: ${args.action || 'extract_text'})`;
    }
    return JSON.stringify(args);
  };

  const hasOutput = status === 'running' || !!error || (!!result && getOutputPreview().trim() !== '');

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={`glass-card rounded-xl p-3.5 border transition-all duration-300 ${
        status === 'running' 
          ? 'border-primary/40 bg-primary/[0.02] shadow-neon-blue' 
          : status === 'error'
          ? 'border-rose-500/30'
          : 'border-border-dark hover:border-border-dark/80'
      }`}
    >
      {/* Header Grid */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded-lg ${
            status === 'running' ? 'bg-primary/10' : 'bg-bg-secondary border border-border-dark'
          }`}>
            {getToolIcon()}
          </div>
          <div>
            <h4 className="text-xs font-semibold text-text-main tracking-tight font-heading">
              {getFriendlyName()}
            </h4>
            <p className="text-[10px] text-text-muted mt-0.5 max-w-[280px] md:max-w-md truncate font-mono">
              {getParamsSummary()}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {duration !== undefined && (
            <span className="text-[10px] text-text-muted flex items-center gap-1 font-mono">
              <Clock className="w-3 h-3 text-text-muted/60" />
              {(duration / 1000).toFixed(2)}s
            </span>
          )}
          {renderStatus()}
          
          {status === 'success' && name === 'write_file' && args?.path && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const relPath = args.path.replace(/^\/?workspace\/?/, '').replace(/^\//, '');
                setSelectedFile(relPath);
                setRightPanelTab('files');
                setRightPanelCollapsed(false);
              }}
              className="flex items-center gap-1 text-[11px] font-medium text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 hover:border-primary/30 px-2.5 py-0.5 rounded-full transition-all active:scale-95 cursor-pointer shadow-neon-blue"
            >
              <Eye className="w-3 h-3" />
              <span>Open File</span>
            </button>
          )}
          
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-text-muted hover:text-text-main p-1 rounded-md hover:bg-bg-secondary transition-all"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expandable output details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3.5 pt-3 border-t border-border-dark/60 space-y-3">
              {/* Show arguments/code if running or completed */}
              {name === 'run_code' && args?.code && (
                <div className="space-y-1.5 text-left">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-text-muted tracking-wider uppercase">
                    <span>Source Code ({args.lang})</span>
                  </div>
                  <pre className="p-3 rounded-lg text-xs font-mono overflow-x-auto bg-[#0B0F19]/45 text-text-main border border-border-dark/50 max-h-48 leading-relaxed select-text">
                    {args.code}
                  </pre>
                </div>
              )}

              {/* Show browser instructions if running or completed */}
              {name === 'browse_web' && args && (
                <div className="space-y-1.5 text-left bg-card/25 border border-border-dark/40 rounded-lg p-2.5">
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Browser Task</div>
                  <div className="text-xs font-medium text-text-main">URL: <a href={args.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{args.url}</a></div>
                  {args.instructions && <div className="text-[11px] text-text-muted mt-1">Instructions: {args.instructions}</div>}
                </div>
              )}

              {/* Show execution output / error */}
              {hasOutput && (
                <div className="space-y-1.5 text-left">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-text-muted tracking-wider uppercase">
                    <Eye className="w-3 h-3 text-primary animate-pulse" />
                    <span>Console Output</span>
                  </div>
                  <pre className={`p-3 rounded-lg text-xs font-mono overflow-x-auto text-left max-h-60 leading-relaxed border ${
                    error 
                      ? 'bg-rose-950/20 text-rose-300 border-rose-500/20' 
                      : status === 'running'
                      ? 'bg-bg-secondary/40 text-text-muted border-border-dark/40 animate-pulse'
                      : 'bg-bg-secondary text-[#9ECE6A] border-border-dark'
                  }`}>
                    {status === 'running' 
                      ? 'Executing script inside sandbox... Waiting for stdout/stderr.' 
                      : (typeof result === 'object' && result.stdout === undefined 
                          ? linkify(JSON.stringify(result, null, 2)) 
                          : linkify(getOutputPreview())
                        )
                    }
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default ToolCallCard;
