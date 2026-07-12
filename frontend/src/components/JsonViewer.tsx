// src/components/JsonViewer.tsx
import React, { useState } from 'react';
import { Copy, Check, FileJson } from 'lucide-react';

interface JsonViewerProps {
  data: any;
}

export const JsonViewer: React.FC<JsonViewerProps> = ({ data }) => {
  const [copied, setCopied] = useState(false);

  const formattedJson = JSON.stringify(data, null, 2);

  // Regex-based syntax highlighter for JSON
  const getHighlightedHtml = (jsonStr: string) => {
    // Escape HTML tags first to avoid injection
    const escaped = jsonStr
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return escaped.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = 'text-amber-400'; // numbers
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'text-primary font-semibold'; // keys
          } else {
            cls = 'text-[#9ECE6A]'; // strings
          }
        } else if (/true|false/.test(match)) {
          cls = 'text-secondary font-medium'; // booleans
        } else if (/null/.test(match)) {
          cls = 'text-rose-400 font-medium'; // nulls
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  return (
    <div className="relative rounded-xl border border-border-dark bg-[#0B0F19]/90 overflow-hidden font-mono text-xs flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-bg-secondary border-b border-border-dark select-none shrink-0">
        <div className="flex items-center gap-1.5 text-text-muted">
          <FileJson className="w-3.5 h-3.5 text-primary" />
          <span className="font-semibold text-[10px] uppercase tracking-wider">Raw Session Record</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2.5 py-1 rounded bg-card border border-border-dark/80 hover:bg-[#1E293B] text-[10px] text-text-muted hover:text-text-main transition-all duration-200 active:scale-95"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-secondary" />
              <span className="text-secondary font-medium">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* JSON Content */}
      <div className="p-4 overflow-auto flex-1 text-left bg-black/25">
        <pre className="leading-relaxed whitespace-pre font-mono">
          <code 
            dangerouslySetInnerHTML={{ __html: getHighlightedHtml(formattedJson) }}
            className="block select-text"
          />
        </pre>
      </div>
    </div>
  );
};

export default JsonViewer;
