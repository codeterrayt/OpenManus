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
  Eye,
  FileCode,
  Copy,
  Check
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
  const [copied, setCopied] = useState(false);
  const { setSelectedFile, setRightPanelTab, setRightPanelCollapsed } = useChatStore();

  const getToolIcon = () => {
    switch (name) {
      case 'run_code':
        return <Terminal className="w-4 h-4 text-indigo-400" />;
      case 'browse_web':
      case 'inspect_page_html':
        return <Globe className="w-4 h-4 text-sky-400" />;
      case 'list_skills':
      case 'get_skill':
      case 'save_skill':
        return <FolderGit2 className="w-4 h-4 text-amber-400" />;
      case 'write_file':
      case 'read_file':
        return <FileCode className="w-4 h-4 text-emerald-400" />;
      default:
        return <Settings className="w-4 h-4 text-slate-400" />;
    }
  };

  const getFriendlyName = () => {
    switch (name) {
      case 'run_code':
        return 'Sandbox Code Execution';
      case 'browse_web':
        return 'Web Automation Browser';
      case 'inspect_page_html':
        return 'Inspect DOM Tree';
      case 'list_skills':
        return 'Query Skills Directory';
      case 'get_skill':
        return `Skill: ${args?.name || ''}`;
      case 'save_skill':
        return `Save Skill: ${args?.name || ''}`;
      case 'write_file':
        return `Create File: ${args?.path || ''}`;
      default:
        return name;
    }
  };

  const renderStatus = () => {
    switch (status) {
      case 'running':
        return (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Running</span>
          </span>
        );
      case 'success':
        return (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
            <CheckCircle2 className="w-3 h-3" />
            <span>Success</span>
          </span>
        );
      case 'error':
        return (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-full">
            <XCircle className="w-3 h-3" />
            <span>Failed</span>
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 bg-white/[0.05] border border-white/[0.08] px-2 py-0.5 rounded-full">
            <Clock className="w-3 h-3" />
            <span>Waiting</span>
          </span>
        );
    }
  };

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

    return rawText;
  };

  const getParamsSummary = () => {
    if (!args) return '';
    if (name === 'run_code') {
      return `${args.lang} (${args.code?.split('\n').length || 0} lines)`;
    }
    if (name === 'browse_web') {
      return `${args.action || 'extract_text'} → ${args.url || ''}`;
    }
    if (name === 'write_file') {
      return `${args.path || ''}`;
    }
    return JSON.stringify(args);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasOutput = status === 'running' || !!error || (!!result && getOutputPreview().trim() !== '');

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={`rounded-xl border transition-all duration-200 overflow-hidden shadow-card-subtle ${
        status === 'running' 
          ? 'border-indigo-500/40 bg-[#0F1322]' 
          : status === 'error'
          ? 'border-rose-500/30 bg-[#140D12]'
          : 'border-white/[0.08] bg-[#0E121B]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-[#131724]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08] shrink-0">
            {getToolIcon()}
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-white tracking-tight truncate font-mono">
              {getFriendlyName()}
            </h4>
            <p className="text-[11px] text-slate-400 truncate font-mono mt-0.5">
              {getParamsSummary()}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 shrink-0">
          {duration !== undefined && (
            <span className="text-[11px] text-slate-500 font-mono flex items-center gap-1">
              {(duration / 1000).toFixed(2)}s
            </span>
          )}
          {renderStatus()}
          
          {status === 'success' && name === 'write_file' && args?.path && (
            <button
              onClick={() => {
                const relPath = args.path.replace(/^\/?workspace\/?/, '').replace(/^\//, '');
                setSelectedFile(relPath);
                setRightPanelTab('files');
                setRightPanelCollapsed(false);
              }}
              className="flex items-center gap-1 text-[11px] font-semibold text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 px-2.5 py-0.5 rounded-lg transition-all"
            >
              <Eye className="w-3 h-3" />
              <span>Inspect</span>
            </button>
          )}
          
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/[0.08] transition-colors"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Expandable Details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3 border-t border-white/[0.06] space-y-3 bg-[#090B10]">
              {name === 'run_code' && args?.code && (
                <div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Executed Code ({args.lang})
                  </div>
                  <pre className="p-2.5 rounded-lg text-xs font-mono overflow-x-auto bg-[#0F1320] text-slate-200 border border-white/[0.06] max-h-40 select-text">
                    {args.code}
                  </pre>
                </div>
              )}

              {hasOutput && (
                <div>
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    <span>Output Log</span>
                    <button
                      onClick={() => handleCopy(getOutputPreview())}
                      className="flex items-center gap-1 text-slate-400 hover:text-white text-[10px] font-normal"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <pre className={`p-2.5 rounded-lg text-xs font-mono overflow-x-auto max-h-48 leading-relaxed border ${
                    error 
                      ? 'bg-rose-950/20 text-rose-300 border-rose-500/20' 
                      : status === 'running'
                      ? 'bg-indigo-950/10 text-slate-400 border-indigo-500/20 animate-pulse'
                      : 'bg-[#0E121B] text-emerald-300/90 border-white/[0.06]'
                  }`}>
                    {status === 'running' 
                      ? 'Running script in sandbox...' 
                      : linkify(getOutputPreview()) || 'Done.'}
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
