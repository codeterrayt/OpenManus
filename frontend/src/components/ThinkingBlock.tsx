// src/components/ThinkingBlock.tsx
import React, { useState } from 'react';
import { Brain, ChevronDown, ChevronUp } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';

interface ThinkingBlockProps {
  content: string;
  defaultExpanded?: boolean;
  className?: string;
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ content, defaultExpanded = false, className = '' }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (!content.trim()) return null;

  return (
    <div className="border border-border-dark/60 rounded-xl bg-bg-secondary/40 overflow-hidden transition-all duration-300">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-card/65 text-xs font-semibold text-text-muted hover:text-text-main transition-colors select-none"
      >
        <div className="flex items-center gap-2">
          <Brain className="w-3.5 h-3.5 text-primary animate-pulse" />
          <span className="font-heading tracking-wider uppercase text-[10px] text-text-muted">Reasoning Process</span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {expanded && (
        <div className="p-4 border-t border-border-dark/30 bg-[#0B0F19]/45 text-text-muted leading-relaxed text-xs max-h-60 overflow-y-auto">
          <MarkdownRenderer content={content} className={className} />
        </div>
      )}
    </div>
  );
};

export default ThinkingBlock;
