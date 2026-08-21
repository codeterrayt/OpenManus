// src/components/ThinkingBlock.tsx
import React, { useState } from 'react';
import { Brain, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';

interface ThinkingBlockProps {
  content: string;
  defaultExpanded?: boolean;
  className?: string;
  isLive?: boolean;
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
  content,
  defaultExpanded = false,
  className = '',
  isLive = false
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded || isLive);

  if (!content?.trim()) return null;

  const wordCount = content.trim().split(/\s+/).length;

  return (
    <div className="border border-white/[0.08] rounded-xl bg-[#0F121C]/60 overflow-hidden transition-all duration-200 shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3.5 py-2 bg-[#141824]/70 hover:bg-[#181D2B] text-xs text-slate-300 transition-colors select-none group"
      >
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            {isLive ? (
              <Brain className="w-3.5 h-3.5 animate-pulse text-indigo-400" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            )}
          </div>
          <span className="font-semibold tracking-tight text-[11px] text-slate-300 group-hover:text-white transition-colors">
            {isLive ? 'Thinking & Planning...' : 'Thought Process'}
          </span>
          <span className="text-[10px] text-slate-500 font-mono">
            {wordCount} words
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-500 group-hover:text-slate-400">
            {expanded ? 'Hide' : 'Show'}
          </span>
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="p-3.5 border-t border-white/[0.06] bg-[#0A0C13]/80 text-slate-300 leading-relaxed text-xs max-h-72 overflow-y-auto font-sans">
          <MarkdownRenderer content={content} className={className} />
        </div>
      )}
    </div>
  );
};

export default ThinkingBlock;
