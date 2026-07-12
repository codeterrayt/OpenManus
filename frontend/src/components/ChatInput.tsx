// src/components/ChatInput.tsx
import React, { useState, useRef, useEffect } from 'react';
import { 
  Paperclip, 
  Terminal, 
  Globe, 
  Sparkles, 
  ArrowUp,
  Cpu,
  CornerDownLeft,
  X,
  FileText,
  Workflow,
  Brain,
  Square
} from 'lucide-react';
import { useChatStore } from '../store/useChatStore';

const AGENT_OPTIONS = ['OpenManus', 'CoderAgent', 'BrowserAgent'];

interface AttachedFile {
  name: string;
  size: number;
  type: string;
  raw: File;
}

export const ChatInput: React.FC = () => {
  const { 
    startChat, 
    isStreaming, 
    selectedModel, 
    setSelectedModel,
    selectedAgent,
    setSelectedAgent,
    models,
    fetchModels,
    useMemory,
    setUseMemory,
    abortChat
  } = useChatStore();

  useEffect(() => {
    fetchModels();
  }, []);

  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [prompt]);

  // Catch slash commands
  const handleTextChange = (val: string) => {
    setPrompt(val);
    if (val.startsWith('/')) {
      setShowSlashMenu(true);
    } else {
      setShowSlashMenu(false);
    }
  };

  const selectSlashCommand = (cmd: string) => {
    setPrompt(cmd + ' ');
    setShowSlashMenu(false);
    textareaRef.current?.focus();
  };

  // Drag and drop event handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      addFiles(Array.from(e.target.files));
    }
  };

  const addFiles = (fileList: File[]) => {
    const formatted: AttachedFile[] = fileList.map(f => ({
      name: f.name,
      size: f.size,
      type: f.type,
      raw: f
    }));
    setFiles(prev => [...prev, ...formatted]);
  };

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  // Submit prompt
  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isStreaming || (!prompt.trim() && files.length === 0)) return;

    let finalPrompt = prompt.trim();
    if (files.length > 0) {
      const fileNames = files.map(f => `[File Attachment: ${f.name} (${(f.size/1024).toFixed(1)} KB)]`).join('\n');
      finalPrompt = `${fileNames}\n\n${finalPrompt}`;
    }

    startChat(finalPrompt);
    setPrompt('');
    setFiles([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const slashCommands = [
    { cmd: '/web', desc: 'Execute web search/scraping tasks', icon: <Globe className="w-3.5 h-3.5" /> },
    { cmd: '/code', desc: 'Write & execute sandbox code scripts', icon: <Terminal className="w-3.5 h-3.5" /> },
    { cmd: '/skill', desc: 'Save or fetch custom workflows', icon: <Workflow className="w-3.5 h-3.5" /> },
    { cmd: '/clear', desc: 'Reset conversation state', icon: <X className="w-3.5 h-3.5" /> },
  ];

  return (
    <div 
      className="p-4 bg-bg-secondary border-t border-border-dark relative w-full"
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
    >
      {/* Drag overlay glow */}
      {dragActive && (
        <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary/50 flex items-center justify-center backdrop-blur-sm z-30 pointer-events-none rounded-t-xl transition-all duration-300">
          <p className="text-sm font-heading font-semibold text-primary animate-pulse">
            Drop files here to attach
          </p>
        </div>
      )}

      <div className="max-w-4xl mx-auto space-y-3 relative">
        {/* Slash Command Autocomplete overlay */}
        {showSlashMenu && (
          <div className="absolute bottom-full left-0 mb-2 w-72 glass-panel border border-border-dark rounded-xl overflow-hidden shadow-2xl z-40">
            <div className="px-3.5 py-1.5 bg-bg-secondary border-b border-border-dark text-[10px] font-bold text-text-muted uppercase tracking-wider">
              Slash Commands
            </div>
            <div className="p-1 space-y-0.5">
              {slashCommands.map(item => (
                <button
                  key={item.cmd}
                  onClick={() => selectSlashCommand(item.cmd)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-card border border-transparent hover:border-border-dark/40 text-text-muted hover:text-text-main transition-all text-xs"
                >
                  <span className="p-1 rounded bg-bg-secondary border border-border-dark/40 text-primary">
                    {item.icon}
                  </span>
                  <div className="flex-1">
                    <div className="font-semibold text-text-main">{item.cmd}</div>
                    <div className="text-[10px] text-text-muted/80">{item.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Attached Files List */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2.5 bg-card/40 border border-border-dark p-2 rounded-xl">
            {files.map((file, idx) => (
              <div 
                key={idx} 
                className="flex items-center gap-2 pl-2.5 pr-1.5 py-1 rounded-lg bg-[#0F1420] border border-border-dark/60 text-[11px] text-text-main"
              >
                <FileText className="w-3.5 h-3.5 text-primary" />
                <span className="max-w-[120px] truncate font-medium">{file.name}</span>
                <span className="text-[9px] text-text-muted font-mono">({(file.size/1024).toFixed(0)}kb)</span>
                <button 
                  onClick={() => removeFile(idx)}
                  className="p-1 rounded-md text-text-muted hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Core Input card */}
        <form 
          onSubmit={handleSubmit}
          className="glass-panel border border-border-dark rounded-2xl p-2.5 shadow-neon-blue focus-within:border-primary/50 focus-within:shadow-neon-cyan transition-all duration-300"
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={prompt}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask OpenManus to run tasks (e.g. /code execute Fibonacci script or type / to see commands)..."
            disabled={isStreaming}
            className="w-full bg-transparent border-0 focus:outline-none focus:ring-0 text-text-main text-sm font-sans placeholder-text-muted resize-none max-h-48 py-2 px-3 leading-relaxed"
          />

          <div className="flex items-center justify-between border-t border-border-dark/50 pt-2.5 mt-1 px-1.5">
            {/* Left Controls: Upload & Selectors */}
            <div className="flex items-center gap-2.5 flex-wrap">
              {/* File Attachment button */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                multiple
              />
              <button
                type="button"
                onClick={triggerFileSelect}
                disabled={isStreaming}
                className="p-2 rounded-xl bg-card hover:bg-[#1E293B] border border-border-dark/60 text-text-muted hover:text-text-main transition-all active:scale-95 duration-200"
                title="Attach local files (Drag & Drop)"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              {/* Model Selector */}
              <div className="flex items-center gap-1.5 bg-card border border-border-dark/60 px-2.5 py-1 rounded-xl text-[11px] text-text-muted">
                <Cpu className="w-3.5 h-3.5 text-primary" />
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="bg-transparent text-text-main border-none focus:ring-0 cursor-pointer font-semibold py-0.5 outline-none max-w-[200px] truncate"
                >
                  {models.ollama && models.ollama.length > 0 && (
                    <optgroup label="Local Ollama Models" className="bg-bg-secondary text-text-muted font-normal">
                      {models.ollama.map(opt => (
                        <option key={opt} value={opt} className="bg-bg-secondary text-text-main">
                          {opt}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {models.openai && models.openai.length > 0 && (
                    <optgroup label="OpenAI Models" className="bg-bg-secondary text-text-muted font-normal">
                      {models.openai.map(opt => (
                        <option key={opt.id} value={opt.id} className="bg-bg-secondary text-text-main">
                          {opt.name} ({opt.pricing})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {models.groq && models.groq.length > 0 && (
                    <optgroup label="Groq Models (Free Tier)" className="bg-bg-secondary text-text-muted font-normal">
                      {models.groq.map(opt => (
                        <option key={opt.id} value={opt.id} className="bg-bg-secondary text-text-main">
                          {opt.name} ({opt.limits || opt.pricing})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {/* Agent Selector */}
              <div className="flex items-center gap-1.5 bg-card border border-border-dark/60 px-2.5 py-1 rounded-xl text-[11px] text-text-muted">
                <Sparkles className="w-3.5 h-3.5 text-secondary" />
                <select
                  value={selectedAgent}
                  onChange={(e) => setSelectedAgent(e.target.value)}
                  className="bg-transparent text-text-main border-none focus:ring-0 cursor-pointer font-semibold py-0.5 outline-none"
                >
                  {AGENT_OPTIONS.map(opt => (
                    <option key={opt} value={opt} className="bg-bg-secondary text-text-main">{opt}</option>
                  ))}
                </select>
              </div>

              {/* Memory Toggle */}
              <button
                type="button"
                onClick={() => setUseMemory(!useMemory)}
                disabled={isStreaming}
                className={`flex items-center gap-1.5 border px-2.5 py-1 rounded-xl text-[11px] font-semibold transition-all duration-200 active:scale-95 ${
                  useMemory 
                    ? 'bg-primary/20 border-primary/45 text-primary hover:bg-primary/30' 
                    : 'bg-card border-border-dark/60 text-text-muted hover:text-text-main hover:bg-[#1E293B] disabled:opacity-50'
                }`}
                title="Toggle long-term global memory context usage"
              >
                <Brain className="w-3.5 h-3.5 shrink-0" />
                <span>{useMemory ? 'Memory Active' : 'Memory Disabled'}</span>
              </button>
            </div>

            {/* Right Control: Send or Stop button */}
            <div className="flex items-center gap-2">
              {!isStreaming && (
                <span className="hidden sm:flex items-center gap-1 text-[10px] text-text-muted font-mono mr-1.5 bg-card border border-border-dark/40 px-2 py-0.5 rounded">
                  <span>Enter</span>
                  <CornerDownLeft className="w-2.5 h-2.5 opacity-60" />
                </span>
              )}
              
              {isStreaming ? (
                <button
                  type="button"
                  onClick={abortChat}
                  className="p-2 rounded-xl flex items-center justify-center bg-rose-500 hover:bg-rose-600 text-white shadow-neon-blue transition-all active:scale-95 duration-200 animate-pulse"
                  title="Stop Agent execution"
                >
                  <Square className="w-4 h-4 fill-white stroke-[2.5]" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!prompt.trim() && files.length === 0}
                  className={`p-2 rounded-xl flex items-center justify-center transition-all active:scale-95 duration-200 ${
                    prompt.trim() || files.length > 0
                      ? 'bg-gradient-to-tr from-primary to-secondary text-white shadow-neon-cyan'
                      : 'bg-card text-text-muted border border-border-dark/50 cursor-not-allowed'
                  }`}
                >
                  <ArrowUp className="w-4.5 h-4.5 stroke-[2.5]" />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChatInput;
