// src/components/Sidebar.tsx
import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  Plus, 
  Search, 
  Database, 
  Cpu, 
  Loader2,
  Settings,
  Brain,
  Trash2,
  Edit3,
  X,
  PanelLeftClose,
  KeyRound,
  Sliders,
  Sparkles
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

  const filteredSessions = useMemo(() => {
    return sessions.filter(s => 
      s.goal?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [sessions, searchQuery]);

  // Group sessions by date
  const groupedSessions = useMemo(() => {
    const today: typeof sessions = [];
    const yesterday: typeof sessions = [];
    const previous7Days: typeof sessions = [];
    const older: typeof sessions = [];

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;
    const sevenDaysAgo = todayStart - 7 * 86400000;

    filteredSessions.forEach(session => {
      const time = session.created_at ? new Date(session.created_at).getTime() : 0;
      if (time >= todayStart) {
        today.push(session);
      } else if (time >= yesterdayStart) {
        yesterday.push(session);
      } else if (time >= sevenDaysAgo) {
        previous7Days.push(session);
      } else {
        older.push(session);
      }
    });

    return { today, yesterday, previous7Days, older };
  }, [filteredSessions]);

  return (
    <aside className={`flex-shrink-0 bg-[#0A0C13] border-r border-white/[0.08] flex flex-col h-full overflow-hidden select-none transition-all duration-300 ${
      sidebarCollapsed ? 'w-0 border-r-0 opacity-0' : 'w-72'
    }`}>
      {/* Top Brand Bar */}
      <div className="p-3.5 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center shadow-soft-glow">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-heading font-bold text-xs tracking-tight text-white">
              OpenManus
            </h1>
            <p className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">
              Autonomous Core
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleSidebar}
          className="hidden md:flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          title="Collapse Sidebar"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      {/* New Session Button */}
      <div className="p-3">
        <button
          type="button"
          onClick={newChat}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-all font-semibold text-xs shadow-soft-glow active:scale-95 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>New Mission</span>
        </button>
      </div>

      {/* Search Input */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#121622] hover:bg-[#151A29] text-white text-xs pl-8 pr-3 py-1.5 rounded-lg border border-white/[0.06] focus:border-indigo-500/50 focus:outline-none placeholder:text-slate-500 transition-colors"
          />
        </div>
      </div>

      {/* History List */}
      <div className="flex-1 overflow-y-auto px-2 space-y-4 scrollbar-thin py-2">
        {filteredSessions.length === 0 ? (
          <div className="text-center py-12 text-xs text-slate-500">
            {searchQuery ? 'No matching missions' : 'No mission history'}
          </div>
        ) : (
          <>
            {/* Today */}
            {groupedSessions.today.length > 0 && (
              <div className="space-y-1">
                <div className="px-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  Today
                </div>
                {groupedSessions.today.map(session => (
                  <SessionItem 
                    key={session.id} 
                    session={session} 
                    isActive={session.id === activeSessionId} 
                    onSelect={() => session.id && selectSession(session.id)} 
                  />
                ))}
              </div>
            )}

            {/* Yesterday */}
            {groupedSessions.yesterday.length > 0 && (
              <div className="space-y-1">
                <div className="px-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  Yesterday
                </div>
                {groupedSessions.yesterday.map(session => (
                  <SessionItem 
                    key={session.id} 
                    session={session} 
                    isActive={session.id === activeSessionId} 
                    onSelect={() => session.id && selectSession(session.id)} 
                  />
                ))}
              </div>
            )}

            {/* Previous 7 Days */}
            {groupedSessions.previous7Days.length > 0 && (
              <div className="space-y-1">
                <div className="px-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  Previous 7 Days
                </div>
                {groupedSessions.previous7Days.map(session => (
                  <SessionItem 
                    key={session.id} 
                    session={session} 
                    isActive={session.id === activeSessionId} 
                    onSelect={() => session.id && selectSession(session.id)} 
                  />
                ))}
              </div>
            )}

            {/* Older */}
            {groupedSessions.older.length > 0 && (
              <div className="space-y-1">
                <div className="px-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  Older
                </div>
                {groupedSessions.older.map(session => (
                  <SessionItem 
                    key={session.id} 
                    session={session} 
                    isActive={session.id === activeSessionId} 
                    onSelect={() => session.id && selectSession(session.id)} 
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Engine Status Bar */}
      <div className="p-2.5 bg-[#0E121B] border-t border-white/[0.06] space-y-1.5">
        {health ? (
          <div className="space-y-1 text-[10px]">
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1.5">
                <Database className={`w-3 h-3 ${health.db === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`} />
                <span>PostgreSQL DB</span>
              </span>
              <span className={`font-mono font-semibold ${health.db === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>
                {health.db === 'ok' ? 'Ready' : 'Offline'}
              </span>
            </div>
            
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1.5">
                <Cpu className={`w-3 h-3 ${health.status === 'ok' ? 'text-indigo-400' : 'text-amber-400'}`} />
                <span>LLM Engine</span>
              </span>
              <span className="font-mono text-slate-300 truncate max-w-[110px]" title={health.model}>
                {health.model}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[10px] text-slate-500 justify-center py-0.5">
            <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
            <span>Connecting...</span>
          </div>
        )}
      </div>

      {/* Footer Settings Button */}
      <div className="p-2.5 border-t border-white/[0.06] flex items-center justify-between bg-[#0A0C13]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-white/[0.06] flex items-center justify-center text-[10px] font-bold text-slate-300">
            AI
          </div>
          <span className="text-xs font-medium text-slate-300">OpenManus Workstation</span>
        </div>

        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          title="Open Settings & Custom Providers"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      {/* Settings Modal */}
      {showSettings && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
          <div className="w-full max-w-2xl bg-[#0F131E] border border-white/[0.1] rounded-2xl shadow-floating overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between bg-[#131724]">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-indigo-400" />
                <h3 className="font-heading font-bold text-sm text-white">
                  Engine & Workspace Settings
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Nav Tabs */}
            <div className="flex border-b border-white/[0.06] bg-[#0C0F18] px-5 gap-4">
              <button
                type="button"
                onClick={() => setSettingsTab('general')}
                className={`py-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                  settingsTab === 'general'
                    ? 'border-indigo-500 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>General & Context</span>
              </button>
              <button
                type="button"
                onClick={() => setSettingsTab('memory')}
                className={`py-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                  settingsTab === 'memory'
                    ? 'border-indigo-500 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Brain className="w-3.5 h-3.5" />
                <span>Memory Knowledge ({memories.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setSettingsTab('environment')}
                className={`py-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                  settingsTab === 'environment'
                    ? 'border-indigo-500 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>AI Providers & API Keys</span>
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {/* Tab: General */}
              {settingsTab === 'general' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-[#131724] border border-white/[0.06] space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-white">Context Auto-Summarization Threshold</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          Compress message history when steps reach this count to save context window tokens.
                        </div>
                      </div>
                      <span className="text-xs font-mono font-bold text-indigo-400 px-2.5 py-1 rounded bg-indigo-500/10 border border-indigo-500/20">
                        {summaryThreshold} steps
                      </span>
                    </div>
                    <input
                      type="range"
                      min={4}
                      max={40}
                      step={2}
                      value={summaryThreshold}
                      onChange={(e) => setSummaryThreshold(Number(e.target.value))}
                      className="w-full accent-indigo-500 cursor-pointer"
                    />
                  </div>

                  {health && (
                    <div className="p-4 rounded-xl bg-[#131724] border border-white/[0.06] space-y-2">
                      <div className="text-xs font-semibold text-white">Runtime Environment Status</div>
                      <div className="grid grid-cols-2 gap-3 pt-1 text-xs">
                        <div className="p-2.5 rounded-lg bg-[#0C0F18] border border-white/[0.06]">
                          <div className="text-[10px] text-slate-400 uppercase font-mono">Backend API</div>
                          <div className="font-semibold text-emerald-400 mt-0.5">Operational</div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-[#0C0F18] border border-white/[0.06]">
                          <div className="text-[10px] text-slate-400 uppercase font-mono">PostgreSQL Database</div>
                          <div className="font-semibold text-slate-200 mt-0.5">{health.db === 'ok' ? 'Connected' : 'Error'}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tab: Memory */}
              {settingsTab === 'memory' && (
                <div className="space-y-4">
                  {/* Add memory form */}
                  <form onSubmit={handleAddMemory} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Add a new fact or instruction for the agent to remember..."
                      value={newMemoryText}
                      onChange={(e) => setNewMemoryText(e.target.value)}
                      className="flex-1 bg-[#131724] text-white text-xs px-3 py-2 rounded-xl border border-white/[0.08] focus:border-indigo-500 focus:outline-none placeholder:text-slate-500"
                    />
                    <button
                      type="submit"
                      disabled={!newMemoryText.trim()}
                      className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs rounded-xl transition-all active:scale-95 cursor-pointer"
                    >
                      Add Fact
                    </button>
                  </form>

                  {/* Actions Header */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs font-semibold text-slate-300">
                      Stored Memories ({memories.length})
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSummarizeMemories}
                        disabled={isSummarizingMemories || memories.length === 0}
                        className="px-2.5 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-indigo-300 rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
                      >
                        {isSummarizingMemories ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        <span>AI Summarize</span>
                      </button>

                      {memories.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowDeleteAllWarning(true)}
                          className="px-2.5 py-1 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Clear All</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Memories List */}
                  <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                    {memories.length === 0 ? (
                      <div className="text-center py-8 text-xs text-slate-500">
                        No persistent memories stored yet.
                      </div>
                    ) : (
                      memories.map((m) => {
                        const isEditing = editingId === m.id;
                        return (
                          <div
                            key={m.id}
                            className="p-3 rounded-xl bg-[#131724] border border-white/[0.06] flex items-start justify-between gap-3 text-xs"
                          >
                            <div className="flex-1 min-w-0">
                              {isEditing ? (
                                <div className="space-y-2">
                                  <textarea
                                    value={editingText}
                                    onChange={(e) => setEditingText(e.target.value)}
                                    className="w-full bg-[#0C0F18] text-white text-xs p-2 rounded-lg border border-white/[0.1] focus:outline-none"
                                    rows={2}
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleSaveEdit(m.id)}
                                      className="px-2.5 py-1 rounded bg-indigo-600 text-white font-semibold text-[11px]"
                                    >
                                      Save
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingId(null)}
                                      className="px-2.5 py-1 rounded bg-white/[0.05] text-slate-400 text-[11px]"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <p className="text-slate-200 leading-relaxed select-text">{m.content}</p>
                                  <span className="text-[10px] text-slate-500 font-mono mt-1 block">
                                    {new Date(m.created_at).toLocaleDateString()}
                                  </span>
                                </div>
                              )}
                            </div>

                            {!isEditing && (
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleStartEdit(m.id, m.content)}
                                  className="p-1 text-slate-500 hover:text-white rounded hover:bg-white/[0.06]"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteMemory(m.id)}
                                  className="p-1 text-slate-500 hover:text-rose-400 rounded hover:bg-rose-500/10"
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
              )}

              {/* Tab: Environment & Custom Providers */}
              {settingsTab === 'environment' && (
                <div className="space-y-4">
                  <EnvSettings />
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-white/[0.08] flex justify-end bg-[#131724]">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Clear All Confirmation Modal */}
      {showDeleteAllWarning && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm bg-[#121622] border border-rose-500/30 rounded-2xl p-5 shadow-2xl space-y-3">
            <h4 className="font-bold text-sm text-rose-400 flex items-center gap-2">
              <Trash2 className="w-4 h-4" />
              <span>Delete All Memories?</span>
            </h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              This will permanently delete all {memories.length} stored facts. The agent will lose all customized memory.
            </p>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteAllWarning(false)}
                className="px-3 py-1.5 rounded-lg border border-white/[0.08] text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAllMemories}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
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

interface SessionItemProps {
  session: {
    id?: string;
    goal?: string;
    status?: string;
    created_at?: string;
  };
  isActive: boolean;
  onSelect: () => void;
}

const SessionItem: React.FC<SessionItemProps> = ({ session, isActive, onSelect }) => {
  const isDone = session.status === 'done';
  const isFailed = session.status === 'failed';
  const isRunning = session.status === 'running';

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex flex-col text-left p-2.5 rounded-xl border transition-all duration-150 ${
        isActive
          ? 'bg-[#151926] border-indigo-500/50 shadow-soft-glow'
          : 'bg-transparent border-transparent hover:bg-white/[0.03] hover:border-white/[0.06]'
      }`}
    >
      <div className="flex justify-between items-start gap-2 w-full">
        <span className={`text-xs font-medium truncate flex-1 ${isActive ? 'text-white font-semibold' : 'text-slate-400 hover:text-white'}`}>
          {session.goal || 'Untitled Mission'}
        </span>
        
        {/* Status dot */}
        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
          isRunning 
            ? 'bg-indigo-400 animate-ping' 
            : isDone 
            ? 'bg-emerald-400' 
            : isFailed 
            ? 'bg-rose-400' 
            : 'bg-slate-600'
        }`} />
      </div>
      
      <div className="flex items-center justify-between w-full mt-1.5 text-[10px] text-slate-500 font-mono">
        <span>
          {session.created_at ? new Date(session.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
        </span>
        <span className="uppercase text-[9px]">
          {session.status}
        </span>
      </div>
    </button>
  );
};

export default Sidebar;
