// src/components/CodeBlock.tsx
import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, language = 'text' }) => {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <div className="my-4 rounded-xl border border-border-dark bg-[#0F1420] overflow-hidden font-mono text-sm shadow-neon-blue transition-all duration-300 hover:shadow-neon-cyan">
      {/* Tab/Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-bg-secondary border-b border-border-dark text-xs text-text-muted">
        <div className="flex items-center gap-2">
          {/* Traffic light dots */}
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[#FF5F56] opacity-90"></span>
            <span className="w-3 h-3 rounded-full bg-[#FFBD2E] opacity-90"></span>
            <span className="w-3 h-3 rounded-full bg-[#27C93F] opacity-90"></span>
          </div>
          <span className="ml-3 font-medium tracking-wider text-text-muted/80 uppercase text-[10px] bg-card px-2 py-0.5 rounded border border-border-dark/50">
            {language}
          </span>
        </div>
        
        <button
          onClick={copyToClipboard}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-card hover:bg-[#1E293B] border border-border-dark/60 text-text-muted hover:text-text-main transition-all active:scale-95 duration-200"
          title="Copy code to clipboard"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-secondary" />
              <span className="text-secondary font-medium">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      
      {/* Code Text Panel */}
      <div className="p-4 overflow-x-auto text-left max-h-[450px] bg-[#0B0F19]/90">
        <pre className="text-sm font-mono leading-relaxed text-[#E2E8F0]">
          <code className="block select-text whitespace-pre">{code}</code>
        </pre>
      </div>
    </div>
  );
};
export default CodeBlock;
