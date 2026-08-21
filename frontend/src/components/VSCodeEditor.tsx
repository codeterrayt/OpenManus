// src/components/VSCodeEditor.tsx
import React, { useState, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { 
  Copy, 
  Check, 
  Download, 
  Maximize2, 
  Minimize2, 
  FileCode, 
  Sparkles, 
  Cpu, 
  Layers, 
  WrapText
} from 'lucide-react';

interface VSCodeEditorProps {
  filePath: string;
  code: string;
  isStreaming?: boolean;
  language?: string;
  onClose?: () => void;
}

export const VSCodeEditor: React.FC<VSCodeEditorProps> = ({
  filePath,
  code,
  isStreaming = false,
  language,
}) => {
  const [copied, setCopied] = useState(false);
  const [minimap, setMinimap] = useState(true);
  const [wordWrap, setWordWrap] = useState<'on' | 'off'>('on');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const editorRef = useRef<any>(null);

  const getLanguage = () => {
    if (language) return language;
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'js':
      case 'jsx':
        return 'javascript';
      case 'py':
        return 'python';
      case 'html':
        return 'html';
      case 'css':
        return 'css';
      case 'json':
        return 'json';
      case 'md':
        return 'markdown';
      case 'sh':
      case 'bash':
        return 'shell';
      case 'sql':
        return 'sql';
      case 'yml':
      case 'yaml':
        return 'yaml';
      case 'dockerfile':
        return 'dockerfile';
      default:
        return 'text';
    }
  };

  const monacoLanguage = getLanguage();
  const fileName = filePath.split('/').pop() || filePath;
  const pathParts = filePath.split('/').filter(Boolean);
  const lineCount = (code || '').split('\n').length;

  // Auto-scroll to bottom while live streaming code
  useEffect(() => {
    if (isStreaming && editorRef.current) {
      try {
        const lineCount = editorRef.current.getModel()?.getLineCount() || 1;
        editorRef.current.revealLine(lineCount);
      } catch (_) {}
    }
  }, [code, isStreaming]);

  const handleCopy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  const handleDownload = () => {
    if (!code) return;
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
  };

  return (
    <div className={`flex flex-col h-full bg-[#1E1E1E] text-[#D4D4D4] rounded-xl border border-white/[0.08] overflow-hidden select-none font-sans shadow-card-subtle ${
      isFullscreen ? 'fixed inset-4 z-50 rounded-2xl shadow-floating' : ''
    }`}>
      {/* VS Code Tab Bar & Actions */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#252526] border-b border-[#333333] shrink-0 text-xs">
        {/* Active Tab */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-[#1E1E1E] border-t-2 border-indigo-500 text-slate-200 rounded-t font-mono text-xs shadow-sm">
            <FileCode className="w-3.5 h-3.5 text-indigo-400" />
            <span className="font-medium text-white">{fileName}</span>
            {isStreaming && (
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping ml-1" title="Live Coding..." />
            )}
          </div>

          {/* Breadcrumb trail */}
          <div className="hidden sm:flex items-center gap-1 text-[11px] text-slate-400 font-mono pl-2">
            <span>workspace</span>
            {pathParts.map((part, idx) => (
              <React.Fragment key={idx}>
                <span className="text-slate-600">/</span>
                <span className={idx === pathParts.length - 1 ? 'text-slate-300 font-semibold' : ''}>{part}</span>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1">
          {isStreaming && (
            <span className="flex items-center gap-1.5 text-[10px] font-mono text-indigo-300 bg-indigo-500/15 border border-indigo-500/30 px-2 py-0.5 rounded mr-1 animate-pulse">
              <Sparkles className="w-3 h-3 text-indigo-400 animate-spin" />
              <span>Live Coding ({lineCount} lines)</span>
            </span>
          )}

          <button
            type="button"
            onClick={() => setWordWrap(w => w === 'on' ? 'off' : 'on')}
            className={`p-1.5 rounded hover:bg-white/[0.08] transition-colors ${wordWrap === 'on' ? 'text-indigo-400' : 'text-slate-400 hover:text-white'}`}
            title="Toggle Word Wrap"
          >
            <WrapText className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setMinimap(m => !m)}
            className={`p-1.5 rounded hover:bg-white/[0.08] transition-colors ${minimap ? 'text-indigo-400' : 'text-slate-400 hover:text-white'}`}
            title="Toggle Minimap"
          >
            <Layers className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-white/[0.08] text-slate-400 hover:text-white transition-colors"
            title="Copy Code"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="p-1.5 rounded hover:bg-white/[0.08] text-slate-400 hover:text-white transition-colors"
            title="Download File"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setIsFullscreen(f => !f)}
            className="p-1.5 rounded hover:bg-white/[0.08] text-slate-400 hover:text-white transition-colors"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Editor'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Monaco Code Editor */}
      <div className="flex-1 min-h-0 relative">
        <Editor
          height="100%"
          language={monacoLanguage}
          value={code || (isStreaming ? '// Writing file in sandbox container...' : '')}
          theme="vs-dark"
          onMount={handleEditorDidMount}
          options={{
            readOnly: true,
            domReadOnly: true,
            minimap: { enabled: minimap, scale: 1 },
            fontSize: 12.5,
            fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
            lineNumbers: 'on',
            lineNumbersMinChars: 3,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            wordWrap: wordWrap,
            padding: { top: 10, bottom: 10 },
            renderLineHighlight: 'all',
            scrollbar: {
              vertical: 'visible',
              horizontal: 'visible',
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
          }}
        />
      </div>

      {/* VS Code Bottom Status Bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-[#007ACC] text-white font-mono text-[10px] shrink-0 font-medium">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Cpu className="w-3 h-3" />
            <span>openmanus-sandbox</span>
          </span>
          <span>{lineCount} lines</span>
        </div>

        <div className="flex items-center gap-3">
          <span>UTF-8</span>
          <span>Spaces: 2</span>
          <span className="uppercase font-semibold">{monacoLanguage}</span>
        </div>
      </div>
    </div>
  );
};

export default VSCodeEditor;
