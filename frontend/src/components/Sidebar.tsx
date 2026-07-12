// src/components/Sidebar.tsx
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { 
  Plus, 
  Search, 
  Database, 
  Cpu, 
  History, 
  Loader2,
  Settings,
  Brain,
  Trash2,
  Edit3,
  Check,
  X,
  PanelLeftClose,
  KeyRound,
} from 'lucide-react';
import { useChatStore } from '../store/useChatStore';
import { api } from '../services/api';
import type { HealthResponse } from '../services/api';
import { EnvSettings } from './EnvSettings';

export const Sidebar: React.FC = () => {
  const {
    sessions,
    activeSessionId,
    fetchSessions,
    selectSession,
    newChat,
    searchQuery,
    setSearchQuery,
    summaryThreshold,
    setSummaryThreshold,
    selectedModel,
    sidebarCollapsed,
    toggleSidebar
  } = useChatStore();

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'memory' | 'environment'>('general');
  const [memories, setMemories] = useState<Array<{ id: string; created_at: string; content: string }>>([]);
  const [newMemoryText, setNewMemoryText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [isSummarizingMemories, setIsSummarizingMemories] = useState(false);
  const [showDeleteAllWarning, setShowDeleteAllWarning] = useState(false);

  useEffect(() => {
    if (showSettings) {
      api.getMemories().then(setMemories).catch(err => console.error('[Sidebar] Error loading memories:', err));
    }
  }, [showSettings]);

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemoryText.trim()) return;
    try {
      const added = await api.addMemory(newMemoryText.trim());
      setMemories(prev => [added, ...prev]);
      setNewMemoryText('');
    } catch (err) {
      console.error('[Sidebar] Failed to add memory:', err);
    }
  };

  const handleStartEdit = (id: string, text: string) => {
    setEditingId(id);
    setEditingText(text);
  };

  const handleSaveEdit = async (id: string) => {
    if (!editingText.trim()) return;
    try {
      const updated = await api.updateMemory(id, editingText.trim());
      setMemories(prev => prev.map(m => m.id === id ? updated : m));
      setEditingId(null);
    } catch (err) {
      console.error('[Sidebar] Failed to update memory:', err);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    try {
      await api.deleteMemory(id);
      setMemories(prev => prev.filter(m => m.id !== id));
    } catch (err) {
      console.error('[Sidebar] Failed to delete memory:', err);
    }
  };

  const handleSummarizeMemories = async () => {
    setIsSummarizingMemories(true);
    try {
      const res = await api.summarizeMemories(selectedModel);
      setMemories(res.memories);
    } catch (err) {
      console.error('[Sidebar] Failed to summarize memories:', err);
    } finally {
      setIsSummarizingMemories(false);
    }
  };

  const handleDeleteAllMemories = async () => {
    try {
      await api.deleteAllMemories();
      setMemories([]);
      setShowDeleteAllWarning(false);
    } catch (err) {
      console.error('[Sidebar] Failed to delete all memories:', err);
    }
  };

  // Load sessions and check health periodically
  useEffect(() => {
    fetchSessions();
    
    const checkHealth = async () => {
      try {
        const h = await api.checkHealth();
        setHealth(h);
      } catch (_) {
        setHealth({
          status: 'degraded',
          model: 'Unknown',
          ollamaUrl: 'Disconnected',
          db: 'error',
          dbError: 'API Server Unreachable'
        });
      }
    };
    
    checkHealth();
    const interval = setInterval(checkHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  const filteredSessions = sessions.filter(s => 
    s.goal?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <aside className={`flex-shrink-0 bg-bg-secondary border-r border-border-dark flex flex-col h-full overflow-hidden select-none transition-all duration-300 ${
      sidebarCollapsed ? 'w-0 border-r-0 opacity-0' : 'w-72'
    }`}>
      {/* Header / Logo */}
      <div className="p-4 border-b border-border-dark flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-primary to-secondary flex items-center justify-center shadow-neon-cyan">
            <Cpu className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-heading font-bold text-sm tracking-wide text-text-main">
              OPENMANUS
            </h1>
            <p className="text-[10px] font-semibold text-secondary tracking-widest uppercase">
              Action Engine
            </p>
          </div>
        </div>
        <button
          onClick={toggleSidebar}
          className="hidden md:flex p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-[#1E293B] border border-border-dark/65 active:scale-95 transition-all"
          title="Collapse Sidebar"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      {/* Action: New Chat */}
      <div className="p-4">
        <button
          onClick={newChat}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-primary/10 hover:bg-primary/20 border border-primary/30 hover:border-primary/50 text-primary hover:text-white transition-all font-semibold font-heading text-sm shadow-neon-blue active:scale-95 duration-200"
        >
          <Plus className="w-4 h-4" />
          <span>New Session</span>
        </button>
      </div>

      {/* Search */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-card hover:bg-card/85 text-text-main text-xs pl-10 pr-4 py-2.5 rounded-xl border border-border-dark/65 focus:border-primary/80 focus:outline-none transition-all"
          />
        </div>
      </div>

      {/* History Section */}
      <div className="flex-1 overflow-y-auto px-2 space-y-1.5 scrollbar-thin">
        <div className="flex items-center gap-1.5 px-3 mb-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
          <History className="w-3.5 h-3.5" />
          <span>Execution History</span>
        </div>

        {filteredSessions.length === 0 ? (
          <div className="text-center py-8 text-xs text-text-muted">
            {searchQuery ? 'No matching sessions' : 'No sessions recorded'}
          </div>
        ) : (
          filteredSessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const isDone = session.status === 'done';
            const isFailed = session.status === 'failed';
            const isRunning = session.status === 'running';

            return (
              <button
                key={session.id}
                onClick={() => session.id && selectSession(session.id)}
                className={`w-full flex flex-col text-left p-3 rounded-xl border transition-all duration-200 ${
                  isActive
                    ? 'bg-[#1E293B]/70 border-primary/50 shadow-neon-blue'
                    : 'bg-transparent border-transparent hover:bg-card/60 hover:border-border-dark/40'
                }`}
              >
                <div className="flex justify-between items-start gap-2 w-full">
                  <span className={`text-xs font-medium truncate flex-1 ${isActive ? 'text-text-main' : 'text-text-muted hover:text-text-main'}`}>
                    {session.goal}
                  </span>
                  
                  {/* Status Bullet */}
                  <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                    isRunning 
                      ? 'bg-primary animate-pulse' 
                      : isDone 
                      ? 'bg-emerald-400' 
                      : isFailed 
                      ? 'bg-rose-500' 
                      : 'bg-text-muted/40'
                  }`} />
                </div>
                
                <div className="flex items-center justify-between w-full mt-2 text-[10px] text-text-muted/70">
                  <span>
                    {session.created_at ? new Date(session.created_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    }) : ''}
                  </span>
                  <span className="uppercase text-[9px] font-mono tracking-wider">
                    {session.status}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Health & Engine status indicators */}
      <div className="p-3 bg-card border-t border-border-dark/65 space-y-2">
        {health ? (
          <div className="space-y-1.5 text-[10px]">
            <div className="flex items-center justify-between text-text-muted">
              <span className="flex items-center gap-1.5">
                <Database className={`w-3.5 h-3.5 ${health.db === 'ok' ? 'text-emerald-400' : 'text-rose-500'}`} />
                <span>DB Engine</span>
              </span>
              <span className={`font-semibold font-mono uppercase ${health.db === 'ok' ? 'text-emerald-400' : 'text-rose-500'}`}>
                {health.db === 'ok' ? 'Online' : 'Failed'}
              </span>
            </div>
            
            <div className="flex items-center justify-between text-text-muted">
              <span className="flex items-center gap-1.5">
                <Cpu className={`w-3.5 h-3.5 ${health.status === 'ok' ? 'text-secondary' : 'text-amber-500'}`} />
                <span>Ollama Model</span>
              </span>
              <span className="font-semibold font-mono truncate max-w-[120px]" title={health.model}>
                {health.model}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[10px] text-text-muted justify-center py-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
            <span>Connecting backend...</span>
          </div>
        )}
      </div>

      {/* Footer Profile & Settings */}
      <div className="p-4 border-t border-border-dark flex items-center justify-between gap-3 bg-bg-secondary">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-border-dark flex items-center justify-center font-heading text-xs font-bold text-text-muted border border-border-dark/80">
            US
          </div>
          <div>
            <p className="text-xs font-semibold text-text-main">Developer Mode</p>
            <p className="text-[10px] text-text-muted">local-host@openmanus</p>
          </div>
        </div>
        
        <button 
          onClick={() => setShowSettings(!showSettings)}
          className="text-text-muted hover:text-text-main p-1.5 rounded-lg hover:bg-card border border-transparent hover:border-border-dark/50 transition-all active:scale-95"
          title="Open Settings"
        >
          <Settings className="w-4.5 h-4.5" />
        </button>
      </div>

      {/* Settings Modal (Overlay) */}
      {showSettings && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 md:p-8 animate-fade-in">
          <div className="w-full max-w-4xl h-[80vh] min-h-[500px] max-h-[750px] bg-bg-secondary border border-border-dark rounded-2xl overflow-hidden shadow-2xl flex flex-col relative">
            
            {/* Modal Header */}
            <div className="flex justify-between items-center px-6 py-4 border-b border-border-dark bg-[#141A29] shrink-0">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-primary" />
                <h3 className="font-heading font-bold text-base text-text-main">
                  System Control Settings
                </h3>
              </div>
              <button 
                onClick={() => setShowSettings(false)}
                className="text-text-muted hover:text-text-main p-1 hover:bg-[#1E293B] rounded-lg transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Split Panel Layout */}
            <div className="flex flex-1 overflow-hidden">
              
              {/* Left Column: Side-Tabs */}
              <div className="w-60 bg-[#0F1420] border-r border-border-dark p-4 flex flex-col justify-between shrink-0 select-none">
                <div className="space-y-1.5">
                  <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider px-3 mb-2">
                    Configurations
                  </div>
                  
                  <button
                    onClick={() => setSettingsTab('general')}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold font-heading uppercase tracking-wide text-left transition-all ${
                      settingsTab === 'general'
                        ? 'bg-primary/10 text-primary border border-primary/20 shadow-neon-blue'
                        : 'text-text-muted hover:text-text-main hover:bg-card/40 border border-transparent'
                    }`}
                  >
                    <Cpu className="w-4 h-4" />
                    <span>General Settings</span>
                  </button>

                  <button
                    onClick={() => setSettingsTab('memory')}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold font-heading uppercase tracking-wide text-left transition-all ${
                      settingsTab === 'memory'
                        ? 'bg-primary/10 text-primary border border-primary/20 shadow-neon-blue'
                        : 'text-text-muted hover:text-text-main hover:bg-card/40 border border-transparent'
                    }`}
                  >
                    <Database className="w-4 h-4" />
                    <span>Memory Manager</span>
                  </button>

                  <button
                    onClick={() => setSettingsTab('environment')}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold font-heading uppercase tracking-wide text-left transition-all ${
                      settingsTab === 'environment'
                        ? 'bg-primary/10 text-primary border border-primary/20 shadow-neon-blue'
                        : 'text-text-muted hover:text-text-main hover:bg-card/40 border border-transparent'
                    }`}
                  >
                    <KeyRound className="w-4 h-4" />
                    <span>Environments</span>
                  </button>
                </div>

                {/* DB / Ollama status badges */}
                <div className="space-y-2 bg-card/40 border border-border-dark/60 rounded-xl p-3 text-[10px]">
                  <div className="flex items-center justify-between text-text-muted">
                    <span>DB Engine</span>
                    <span className={`font-semibold font-mono uppercase ${health?.db === 'ok' ? 'text-emerald-400' : 'text-rose-500'}`}>
                      {health?.db === 'ok' ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-text-muted">
                    <span>Ollama</span>
                    <span className="font-semibold font-mono truncate max-w-[90px]" title={health?.model}>
                      {health?.model || 'Unknown'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Column: Scrollable Active Pane */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin text-left">
                {settingsTab === 'general' ? (
                  <div className="space-y-5">
                    <div>
                      <h4 className="text-sm font-bold text-text-main font-heading mb-1">
                        System Configuration
                      </h4>
                      <p className="text-xs text-text-muted leading-relaxed">
                        Underlying system parameters and default connection settings for the active OpenManus engine.
                      </p>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-text-muted font-bold uppercase tracking-wide">Engine Config</label>
                      <div className="bg-card p-4 rounded-xl border border-border-dark text-xs font-mono text-text-muted space-y-1.5 select-text">
                        <div>API Address: <span className="text-text-main">http://localhost:3000</span></div>
                        <div>Sandbox runtime: <span className="text-text-main">Docker daemon (Network: host)</span></div>
                        <div>Browser instance: <span className="text-text-main">Headful/Headless Chromium</span></div>
                        <div>System DB status: <span className="text-text-main">{health?.dbError ? `Error: ${health.dbError}` : 'PostgreSQL Bootstrapped'}</span></div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-text-muted font-bold uppercase tracking-wide">Platform Version</label>
                      <div className="text-xs text-text-muted bg-card p-4 rounded-xl border border-border-dark">
                        OpenManus Web Dashboard <span className="text-primary font-bold">v0.1.0 (Beta)</span> — Running on Node.js
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs text-text-muted font-bold uppercase tracking-wide">Summarization Threshold (Characters/Tokens)</label>
                      <input 
                        type="number"
                        value={summaryThreshold}
                        onChange={(e) => setSummaryThreshold(Number(e.target.value))}
                        className="w-full bg-card text-text-main text-xs px-3.5 py-2.5 rounded-xl border border-border-dark/65 focus:border-primary/80 focus:outline-none transition-all font-mono"
                        placeholder="e.g. 40000"
                      />
                      <p className="text-[10px] text-text-muted leading-relaxed">
                        Compresses chat history when total size exceeds this character limit. Higher values retain more context detail but consume more model context window.
                      </p>
                    </div>
                  </div>
                ) : settingsTab === 'environment' ? (
                  <EnvSettings />
                ) : (
                  <div className="space-y-5">
                    <div>
                      <h4 className="text-sm font-bold text-text-main font-heading mb-1">
                        Agent Long-Term Memory (PostgreSQL)
                      </h4>
                      <p className="text-xs text-text-muted leading-relaxed">
                        Manually insert preferences or allow the agent to proactively record directories, configurations, credentials, and credentials. These are globally loaded into all conversations.
                      </p>
                    </div>

                    {/* Add memory form with TEXTAREA */}
                    <form onSubmit={handleAddMemory} className="space-y-3 bg-[#0F1420]/50 p-4 rounded-xl border border-border-dark/60">
                      <div className="text-xs text-text-muted font-bold uppercase tracking-wide">
                        Remember New Fact or Preference
                      </div>
                      <textarea
                        placeholder="Type custom facts (e.g. 'Project workspace is located at D:/Projects/App', 'Ollama host IP is 192.168.1.50', 'Prefer TailwindCSS for styling')..."
                        value={newMemoryText}
                        onChange={(e) => setNewMemoryText(e.target.value)}
                        className="w-full bg-card text-text-main text-xs px-3.5 py-2.5 rounded-xl border border-border-dark/65 focus:border-primary/80 focus:outline-none transition-all font-sans min-h-[80px] resize-y"
                      />
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={!newMemoryText.trim()}
                          className="px-4 py-2 bg-primary hover:bg-primary/95 disabled:opacity-50 disabled:cursor-not-allowed text-white font-heading font-semibold text-xs rounded-xl transition-all active:scale-95 flex items-center gap-1.5 shrink-0"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add to Memory</span>
                        </button>
                      </div>
                    </form>

                    {/* Memories list */}
                    <div className="border border-border-dark bg-card/45 rounded-xl overflow-hidden flex flex-col">
                      <div className="px-4 py-2.5 bg-[#141A29] border-b border-border-dark text-[10px] font-bold text-text-muted uppercase tracking-wider flex justify-between items-center gap-2">
                        <span className="shrink-0">Stored Memories ({memories.length})</span>
                        
                        <div className="flex gap-2 shrink-0">
                          {memories.length > 1 && (
                            <button
                              type="button"
                              onClick={handleSummarizeMemories}
                              disabled={isSummarizingMemories}
                              className="px-2.5 py-1 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 hover:text-white rounded-lg text-[9px] font-bold transition-all flex items-center gap-1"
                              title="Summarize and consolidate memories to save tokens"
                            >
                              {isSummarizingMemories ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Brain className="w-3 h-3" />
                              )}
                              <span>{isSummarizingMemories ? 'Summarizing...' : 'Summarize Memory'}</span>
                            </button>
                          )}

                          {memories.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setShowDeleteAllWarning(true)}
                              className="px-2.5 py-1 bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 rounded-lg text-[9px] font-bold transition-all flex items-center gap-1"
                              title="Clear all stored memory facts"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Delete All</span>
                            </button>
                          )}
                        </div>
                      </div>
                      
                      <div className="max-h-72 overflow-y-auto p-3 space-y-2.5 scrollbar-thin">
                        {memories.length === 0 ? (
                          <div className="text-center py-10 text-xs text-text-muted flex flex-col items-center justify-center gap-2">
                            <Brain className="w-8 h-8 text-text-muted/30 animate-pulse" />
                            <span>No global facts remembered yet.</span>
                          </div>
                        ) : (
                          memories.map((m) => {
                            const isEditing = editingId === m.id;
                            return (
                              <div
                                key={m.id}
                                className="flex items-start justify-between gap-3 p-3.5 rounded-lg bg-[#0F1420] border border-border-dark/40 hover:border-border-dark transition-all text-xs"
                              >
                                <div className="flex-1 min-w-0">
                                  {isEditing ? (
                                    <div className="space-y-2 w-full">
                                      <textarea
                                        value={editingText}
                                        onChange={(e) => setEditingText(e.target.value)}
                                        className="w-full bg-card text-text-main text-xs px-2.5 py-1.5 rounded-lg border border-border-dark focus:border-primary/80 focus:outline-none transition-all font-sans min-h-[70px] resize-y"
                                        autoFocus
                                      />
                                      <div className="flex justify-end gap-1.5">
                                        <button
                                          onClick={() => handleSaveEdit(m.id)}
                                          className="px-2.5 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-all flex items-center gap-1 text-[10px] font-bold"
                                          title="Save change"
                                        >
                                          <Check className="w-3 h-3" />
                                          <span>Save</span>
                                        </button>
                                        <button
                                          onClick={() => setEditingId(null)}
                                          className="px-2.5 py-1 rounded bg-card border border-border-dark/60 text-text-muted hover:text-text-main transition-all flex items-center gap-1 text-[10px] font-bold"
                                          title="Cancel"
                                        >
                                          <X className="w-3 h-3" />
                                          <span>Cancel</span>
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="space-y-1">
                                      <p className="text-text-main leading-relaxed select-text font-medium break-words">
                                        {m.content}
                                      </p>
                                      <span className="text-[9px] text-text-muted/60 font-mono block">
                                        Remembered on {new Date(m.created_at).toLocaleDateString()}
                                      </span>
                                    </div>
                                  )}
                                </div>

                                {!isEditing && (
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      onClick={() => handleStartEdit(m.id, m.content)}
                                      className="p-1 rounded text-text-muted hover:text-primary hover:bg-[#1E293B] transition-all"
                                      title="Edit fact"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteMemory(m.id)}
                                      className="p-1 rounded text-text-muted hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                                      title="Delete fact"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-border-dark flex justify-end bg-[#141A29] shrink-0">
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 bg-primary hover:bg-primary/95 text-white font-heading font-semibold text-xs rounded-xl shadow-neon-blue active:scale-95 transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delete All Confirmation Warning Popup */}
      {showDeleteAllWarning && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm bg-bg-secondary border border-rose-500/30 rounded-2xl p-5 shadow-2xl space-y-4">
            <h4 className="font-heading font-bold text-sm text-rose-400 flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-rose-400" />
              <span>Confirm Mass Deletion</span>
            </h4>
            <p className="text-xs text-text-muted leading-relaxed">
              Are you sure you want to permanently delete all {memories.length} stored memories? This action cannot be undone, and the agent will lose all personalized instructions, credentials, and facts.
            </p>
            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => setShowDeleteAllWarning(false)}
                className="px-3.5 py-1.5 rounded-lg border border-border-dark text-xs text-text-muted hover:text-text-main hover:bg-card transition-all font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAllMemories}
                className="px-3.5 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-xs transition-all font-semibold shadow-md active:scale-95"
              >
                Yes, Delete All
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </aside>
  );
};

export default Sidebar;
