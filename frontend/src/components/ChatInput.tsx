import React, { useState, useRef, useEffect } from 'react';
import { 
  Paperclip, 
  Terminal, 
  Globe, 
  Sparkles, 
  ArrowUp,
  Cpu,
  X,
  FileText,
  Workflow,
  Brain,
  Square,
  History
} from 'lucide-react';
import { useChatStore } from '../store/useChatStore';
import { ThinkingSelector } from './ThinkingSelector';

const AGENT_OPTIONS = [
  { id: 'OpenManus', name: 'OpenManus (Full Agent)' },
  { id: 'CoderAgent', name: 'CoderAgent (Coding Sandbox)' },
  { id: 'BrowserAgent', name: 'BrowserAgent (Web Automation)' },
];

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
    maxHistoryTurns,
    setMaxHistoryTurns,
    summaryStrategy,
    autoSummarize,
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
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 220)}px`;
    }
  }, [prompt]);

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
    { cmd: '/web', desc: 'Browse and extract live web pages', icon: <Globe className="w-3.5 h-3.5 text-sky-400" /> },
    { cmd: '/code', desc: 'Execute scripts in isolated Docker sandbox', icon: <Terminal className="w-3.5 h-3.5 text-indigo-400" /> },
    { cmd: '/skill', desc: 'Use and compose autonomous skills', icon: <Workflow className="w-3.5 h-3.5 text-amber-400" /> },
    { cmd: '/clear', desc: 'Start a clean session', icon: <X className="w-3.5 h-3.5 text-rose-400" /> },
  ];

  return (
    <div 
      className="p-4 bg-[#090B10] border-t border-white/[0.06] relative w-full"
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
    >
      {/* Drag overlay glow */}
      {dragActive && (
        <div className="absolute inset-0 bg-indigo-500/10 border-2 border-dashed border-indigo-500/50 flex items-center justify-center backdrop-blur-sm z-30 pointer-events-none rounded-2xl transition-all">
          <p className="text-sm font-semibold text-indigo-300 animate-pulse">
            Drop files to attach to session
          </p>
        </div>
      )}

      <div className="max-w-4xl mx-auto space-y-2.5 relative">
        {/* Slash Command Autocomplete overlay */}
        {showSlashMenu && (
          <div className="absolute bottom-full left-0 mb-2 w-72 glass-floating rounded-xl overflow-hidden shadow-floating z-40">
            <div className="px-3 py-1.5 bg-[#141824] border-b border-white/[0.06] text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Quick Shortcuts
            </div>
            <div className="p-1 space-y-0.5">
              {slashCommands.map(item => (
                <button
                  key={item.cmd}
                  type="button"
                  onClick={() => selectSlashCommand(item.cmd)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-white/[0.06] text-slate-300 hover:text-white transition-all text-xs"
                >
                  <span className="p-1 rounded bg-white/[0.05]">
                    {item.icon}
                  </span>
                  <div className="flex-1">
                    <div className="font-semibold text-white">{item.cmd}</div>
                    <div className="text-[10px] text-slate-400">{item.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Attached Files List */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 bg-[#121622] border border-white/[0.08] p-2 rounded-xl">
            {files.map((file, idx) => (
              <div 
                key={idx} 
                className="flex items-center gap-2 pl-2.5 pr-1.5 py-1 rounded-lg bg-[#181E2E] border border-white/[0.08] text-[11px] text-white"
              >
                <FileText className="w-3.5 h-3.5 text-indigo-400" />
                <span className="max-w-[140px] truncate font-medium">{file.name}</span>
                <span className="text-[10px] text-slate-400 font-mono">({(file.size/1024).toFixed(0)}KB)</span>
                <button 
                  type="button"
                  onClick={() => removeFile(idx)}
                  className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Main Floating Input Capsule */}
        <form 
          onSubmit={handleSubmit}
          className="rounded-2xl border border-white/[0.1] bg-[#111520]/95 backdrop-blur-xl shadow-floating focus-within:border-indigo-500/50 transition-all duration-200 relative"
        >
          <div className="p-3 rounded-t-2xl">
            <textarea
              ref={textareaRef}
              rows={1}
              value={prompt}
              onChange={(e) => handleTextChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message OpenManus... (Type / for actions, Shift+Enter for new line)"
              disabled={isStreaming}
              className="w-full bg-transparent border-0 focus:outline-none focus:ring-0 text-white text-sm placeholder:text-slate-500 resize-none max-h-48 py-1 px-1 leading-relaxed"
            />
          </div>

          {/* Controls Footer Strip */}
          <div className="flex items-center justify-between border-t border-white/[0.06] py-2 px-3 bg-[#0D1019]/60 rounded-b-2xl relative">
            {/* Left Options */}
            <div className="flex items-center gap-2 flex-wrap">
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
                className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-white border border-white/[0.06] transition-colors"
                title="Attach files"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>

              {/* Model Selector */}
              <div className="flex items-center gap-1.5 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.08] px-2.5 py-1 rounded-lg text-xs transition-colors">
                <Cpu className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="bg-transparent text-slate-200 border-none focus:ring-0 cursor-pointer font-medium text-[11px] py-0 outline-none max-w-[180px] truncate"
                >
                  {models.ollama && models.ollama.length > 0 && (
                    <optgroup label="Local Ollama Models" className="bg-[#121622] text-slate-400">
                      {models.ollama.map(opt => (
                        <option key={`ollama::${opt}`} value={`ollama::${opt}`} className="bg-[#121622] text-white">
                          {opt}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {models.openai && models.openai.length > 0 && (
                    <optgroup label="OpenAI Models" className="bg-[#121622] text-slate-400">
                      {models.openai.map(opt => (
                        <option key={`openai::${opt.id}`} value={`openai::${opt.id}`} className="bg-[#121622] text-white">
                          {opt.name} ({opt.pricing})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {models.groq && models.groq.length > 0 && (
                    <optgroup label="Groq Models (Free Tier)" className="bg-[#121622] text-slate-400">
                      {models.groq.map(opt => (
                        <option key={`groq::${opt.id}`} value={`groq::${opt.id}`} className="bg-[#121622] text-white">
                          {opt.name} ({opt.limits || opt.pricing})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {models.custom && models.custom.map(provider => (
                    provider.enabled && provider.models && provider.models.length > 0 ? (
                      <optgroup key={provider.id} label={`${provider.name} (Custom)`} className="bg-[#121622] text-slate-400">
                        {provider.models.map(opt => (
                          <option key={`custom:${provider.id}::${opt}`} value={`custom:${provider.id}::${opt}`} className="bg-[#121622] text-white">
                            {opt}
                          </option>
                        ))}
                      </optgroup>
                    ) : null
                  ))}
                </select>
              </div>

              {/* Dynamic Model Thinking / Reasoning Capability Selector */}
              <ThinkingSelector />

              {/* Agent Selector */}
              <div className="flex items-center gap-1.5 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.08] px-2.5 py-1 rounded-lg text-xs transition-colors">
                <Sparkles className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <select
                  value={selectedAgent}
                  onChange={(e) => setSelectedAgent(e.target.value)}
                  className="bg-transparent text-slate-200 border-none focus:ring-0 cursor-pointer font-medium text-[11px] py-0 outline-none"
                >
                  {AGENT_OPTIONS.map(opt => (
                    <option key={opt.id} value={opt.id} className="bg-[#121622] text-white">{opt.name}</option>
                  ))}
                </select>
              </div>

              {/* Memory Toggle */}
              <button
                type="button"
                onClick={() => setUseMemory(!useMemory)}
                disabled={isStreaming}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                  useMemory 
                    ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300' 
                    : 'bg-white/[0.03] border-white/[0.06] text-slate-400 hover:text-white'
                }`}
                title="Toggle Mem0 long-term & knowledge graph memory"
              >
                <Brain className="w-3.5 h-3.5" />
                <span>{useMemory ? 'Memory' : 'No Memory'}</span>
              </button>

              {/* Context Turn Depth Quick Selector */}
              <div 
                className="flex items-center gap-1.5 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.08] px-2.5 py-1 rounded-lg text-xs transition-colors"
                title={`Context History: ${maxHistoryTurns === 0 ? 'Full History (All Turns)' : `Last ${maxHistoryTurns} Turns`}, Strategy: ${summaryStrategy}, Auto-Summarize: ${autoSummarize ? 'ON' : 'OFF'}`}
              >
                <History className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <select
                  value={maxHistoryTurns}
                  onChange={(e) => setMaxHistoryTurns(Number(e.target.value))}
                  disabled={isStreaming}
                  className="bg-transparent text-slate-200 border-none focus:ring-0 cursor-pointer font-medium text-[11px] py-0 outline-none"
                >
                  <option value={3} className="bg-[#121622] text-white">3 Turns Context</option>
                  <option value={5} className="bg-[#121622] text-white">5 Turns Context</option>
                  <option value={10} className="bg-[#121622] text-white">10 Turns Context</option>
                  <option value={20} className="bg-[#121622] text-white">20 Turns Context</option>
                  <option value={50} className="bg-[#121622] text-white">50 Turns Context</option>
                  <option value={0} className="bg-[#121622] text-white">All Turns (Full)</option>
                </select>
              </div>
            </div>

            {/* Right Action Button */}
            <div className="flex items-center gap-2">
              {isStreaming ? (
                <button
                  type="button"
                  onClick={abortChat}
                  className="p-1.5 rounded-lg flex items-center justify-center bg-rose-500 hover:bg-rose-600 text-white transition-all active:scale-95 shadow-sm"
                  title="Stop Agent execution"
                >
                  <Square className="w-4 h-4 fill-white" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!prompt.trim() && files.length === 0}
                  className={`p-1.5 rounded-lg flex items-center justify-center transition-all active:scale-95 ${
                    prompt.trim() || files.length > 0
                      ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-soft-glow cursor-pointer'
                      : 'bg-white/[0.05] text-slate-600 border border-white/[0.06] cursor-not-allowed'
                  }`}
                  title="Send message (Enter)"
                >
                  <ArrowUp className="w-4 h-4 stroke-[2.5]" />
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
