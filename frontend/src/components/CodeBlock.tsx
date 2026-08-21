// src/components/CodeBlock.tsx
import React, { useState } from 'react';
import { Check, Copy, FileCode2 } from 'lucide-react';

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

  const lineCount = code.split('\n').length;

  return (
    <div className="my-3.5 rounded-xl border border-white/[0.08] bg-[#0A0C13] overflow-hidden font-mono text-xs shadow-card-subtle">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-[#121622] border-b border-white/[0.06] text-slate-400">
        <div className="flex items-center gap-2">
          <FileCode2 className="w-3.5 h-3.5 text-indigo-400" />
          <span className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">
            {language}
          </span>
          <span className="text-[10px] text-slate-500 font-mono">
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </span>
        </div>
        
        <button
          type="button"
          onClick={copyToClipboard}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-slate-300 hover:text-white transition-all active:scale-95 text-[11px] font-sans"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400 font-medium">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      
      {/* Code Area */}
      <div className="p-3.5 overflow-x-auto text-left max-h-[480px] bg-[#08090E]">
        <pre className="font-mono text-xs leading-relaxed text-slate-200">
          <code className="block select-text whitespace-pre">{code}</code>
        </pre>
      </div>
    </div>
  );
};

export default CodeBlock;
