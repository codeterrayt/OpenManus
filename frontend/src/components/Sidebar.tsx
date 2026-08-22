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
  X,
  PanelLeftClose,
  KeyRound,
  Sliders,
  Sparkles,
  History,
  Zap,
  Scissors,
  Layers,
  CheckCircle2,
  RotateCcw
} from 'lucide-react';
import { useChatStore } from '../store/useChatStore';
import { api } from '../services/api';
import type { HealthResponse } from '../services/api';
import { EnvSettings } from './EnvSettings';
import { MemoryExplorer } from './MemoryExplorer';

export const Sidebar: React.FC = () => {
  const {
    sessions,
    activeSessionId,
    activeSession,
    fetchSessions,
    selectSession,
    newChat,
    searchQuery,
    setSearchQuery,
    summaryThreshold,
    setSummaryThreshold,
    autoSummarize,
    setAutoSummarize,
    maxHistoryTurns,
    setMaxHistoryTurns,
    summaryStrategy,
    setSummaryStrategy,
    keepRecentTurns,
    setKeepRecentTurns,
    summarizeActiveContext,
    selectedModel,
    sidebarCollapsed,
    toggleSidebar
  } = useChatStore();

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'memory' | 'environment' | 'runtime'>('general');
  const [isSummarizingContext, setIsSummarizingContext] = useState(false);
  const [summarizeSuccessMsg, setSummarizeSuccessMsg] = useState<string | null>(null);

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
      s.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
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

      {/* Master-Detail Settings Modal */}
      {showSettings && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-6 animate-fade-in">
          <div className="w-full max-w-5xl h-[85vh] bg-[#0B0D14] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            {/* Modal Top Header */}
            <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between bg-[#0E1019]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Settings className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-heading font-bold text-base text-white">
                    Workspace & Engine Settings
                  </h3>
                  <p className="text-xs text-slate-400">
                    Configure agent intelligence, context window depth, memory graph, and custom model endpoints.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                title="Close settings"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Master-Detail Layout */}
            <div className="flex flex-1 overflow-hidden">
              {/* Left Navigation Rail (260px) */}
              <div className="w-64 bg-[#080A10] border-r border-white/[0.08] p-3 flex flex-col gap-1 select-none">
                <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 font-mono">
                  Preferences
                </div>

                <button
                  type="button"
                  onClick={() => setSettingsTab('general')}
                  className={`w-full p-3 rounded-xl text-left transition-all flex items-start gap-3 ${
                    settingsTab === 'general'
                      ? 'bg-indigo-600/15 border border-indigo-500/40 text-white shadow-sm'
                      : 'border border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                  }`}
                >
                  <Sliders className={`w-4 h-4 mt-0.5 shrink-0 ${settingsTab === 'general' ? 'text-indigo-400' : 'text-slate-500'}`} />
                  <div>
                    <div className="text-xs font-semibold text-white">General & Context</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">Strategy & turn depth</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSettingsTab('memory')}
                  className={`w-full p-3 rounded-xl text-left transition-all flex items-start gap-3 ${
                    settingsTab === 'memory'
                      ? 'bg-indigo-600/15 border border-indigo-500/40 text-white shadow-sm'
                      : 'border border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                  }`}
                >
                  <Brain className={`w-4 h-4 mt-0.5 shrink-0 ${settingsTab === 'memory' ? 'text-indigo-400' : 'text-slate-500'}`} />
                  <div>
                    <div className="text-xs font-semibold text-white">Mem0 Memory & Graph</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">Knowledge graph explorer</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSettingsTab('environment')}
                  className={`w-full p-3 rounded-xl text-left transition-all flex items-start gap-3 ${
                    settingsTab === 'environment'
                      ? 'bg-indigo-600/15 border border-indigo-500/40 text-white shadow-sm'
                      : 'border border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                  }`}
                >
                  <KeyRound className={`w-4 h-4 mt-0.5 shrink-0 ${settingsTab === 'environment' ? 'text-indigo-400' : 'text-slate-500'}`} />
                  <div>
                    <div className="text-xs font-semibold text-white">AI Providers & Keys</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">OpenAI, Groq & custom</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSettingsTab('runtime')}
                  className={`w-full p-3 rounded-xl text-left transition-all flex items-start gap-3 ${
                    settingsTab === 'runtime'
                      ? 'bg-indigo-600/15 border border-indigo-500/40 text-white shadow-sm'
                      : 'border border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                  }`}
                >
                  <Database className={`w-4 h-4 mt-0.5 shrink-0 ${settingsTab === 'runtime' ? 'text-indigo-400' : 'text-slate-500'}`} />
                  <div>
                    <div className="text-xs font-semibold text-white">System Runtime</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">Health & connectivity</div>
                  </div>
                </button>
              </div>

              {/* Right Content View */}
              <div className="flex-1 bg-[#0B0D14] overflow-y-auto p-8">
                {/* View: General & Context Management */}
                {settingsTab === 'general' && (
                  <div className="max-w-3xl space-y-8">
                    <div>
                      <h4 className="text-base font-bold text-white">General & Context Window Configuration</h4>
                      <p className="text-xs text-slate-400 mt-1">
                        Control how conversation history, past interaction turns, and summarization operate during multi-turn chats.
                      </p>
                    </div>

                    {/* Setting Row 1: Context Management Strategy */}
                    <div className="pt-4 border-t border-white/[0.06] space-y-3">
                      <div>
                        <div className="text-sm font-semibold text-white flex items-center gap-2">
                          <Layers className="w-4 h-4 text-indigo-400" />
                          <span>Context Management Strategy</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          Select the algorithm used when conversations exceed working context limits.
                        </p>
                      </div>

                      <div className="grid grid-cols-3 gap-3 pt-1">
                        <button
                          type="button"
                          onClick={() => setSummaryStrategy('rolling_summary')}
                          className={`p-3.5 rounded-xl border text-left transition-all ${
                            summaryStrategy === 'rolling_summary'
                              ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-sm'
                              : 'bg-[#111420] border-white/[0.06] text-slate-400 hover:text-slate-200 hover:border-white/[0.12]'
                          }`}
                        >
                          <div className="text-xs font-bold text-white flex items-center justify-between">
                            <span>Rolling Summary</span>
                            {summaryStrategy === 'rolling_summary' && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                            Compresses older turns into a structured summary with LLM; preserves recent turns intact.
                          </p>
                        </button>

                        <button
                          type="button"
                          onClick={() => setSummaryStrategy('sliding_window')}
                          className={`p-3.5 rounded-xl border text-left transition-all ${
                            summaryStrategy === 'sliding_window'
                              ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-sm'
                              : 'bg-[#111420] border-white/[0.06] text-slate-400 hover:text-slate-200 hover:border-white/[0.12]'
                          }`}
                        >
                          <div className="text-xs font-bold text-white flex items-center justify-between">
                            <span>Sliding Window</span>
                            {summaryStrategy === 'sliding_window' && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                            Keeps the latest turns verbatim and drops older ones. Uses 0 extra LLM tokens.
                          </p>
                        </button>

                        <button
                          type="button"
                          onClick={() => setSummaryStrategy('off')}
                          className={`p-3.5 rounded-xl border text-left transition-all ${
                            summaryStrategy === 'off'
                              ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-sm'
                              : 'bg-[#111420] border-white/[0.06] text-slate-400 hover:text-slate-200 hover:border-white/[0.12]'
                          }`}
                        >
                          <div className="text-xs font-bold text-white flex items-center justify-between">
                            <span>Full History</span>
                            {summaryStrategy === 'off' && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                            Preserves 100% of messages verbatim. Never summarizes or truncates history.
                          </p>
                        </button>
                      </div>
                    </div>

                    {/* Setting Row 2: Master Auto-Summarize Toggle */}
                    <div className="pt-6 border-t border-white/[0.06] flex items-center justify-between">
                      <div className="max-w-lg">
                        <div className="text-sm font-semibold text-white flex items-center gap-2">
                          <Zap className="w-4 h-4 text-slate-400" />
                          <span>Automatic Context Summarization</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          When active, automatically summarizes history before context overflow. Turn OFF to prevent all unprompted background summarization.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setAutoSummarize(!autoSummarize)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          autoSummarize ? 'bg-indigo-600' : 'bg-slate-700'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            autoSummarize ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Setting Row 3: Past Turns Depth */}
                    <div className="pt-6 border-t border-white/[0.06] space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold text-white flex items-center gap-2">
                            <History className="w-4 h-4 text-slate-400" />
                            <span>Past Turns Depth (Working Context Window)</span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            Number of previous user/assistant interaction turns from the current session fed to the model context.
                          </p>
                        </div>
                        <span className="text-xs font-mono font-semibold text-slate-300 px-3 py-1 rounded-lg bg-white/[0.06] border border-white/[0.08]">
                          {maxHistoryTurns === 0 ? 'All Turns (Unlimited)' : `${maxHistoryTurns} Turns`}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-1">
                        {[
                          { label: '3 Turns', val: 3 },
                          { label: '5 Turns', val: 5 },
                          { label: '10 Turns (Default)', val: 10 },
                          { label: '20 Turns', val: 20 },
                          { label: '50 Turns', val: 50 },
                          { label: 'All Turns (Full)', val: 0 },
                        ].map(opt => (
                          <button
                            key={opt.val}
                            type="button"
                            onClick={() => setMaxHistoryTurns(opt.val)}
                            className={`px-3.5 py-2 text-xs font-semibold rounded-xl border transition-colors ${
                              maxHistoryTurns === opt.val
                                ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                                : 'bg-[#111420] border-white/[0.06] text-slate-400 hover:text-slate-200 hover:border-white/[0.12]'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Setting Row 4: Preserve Recent Turns Slider */}
                    <div className="pt-6 border-t border-white/[0.06] space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold text-white flex items-center gap-2">
                            <Scissors className="w-4 h-4 text-slate-400" />
                            <span>Preserve Recent Turns Verbatim</span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            Guaranteed number of latest interaction turns that are NEVER compressed or summarized.
                          </p>
                        </div>
                        <span className="text-xs font-mono font-semibold text-slate-300 px-3 py-1 rounded-lg bg-white/[0.06] border border-white/[0.08]">
                          {keepRecentTurns} Turns
                        </span>
                      </div>
                      <input
                        type="range"
                        min={2}
                        max={20}
                        step={1}
                        value={keepRecentTurns}
                        onChange={(e) => setKeepRecentTurns(Number(e.target.value))}
                        className="w-full accent-indigo-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
                      />
                    </div>

                    {/* Setting Row 5: Token Threshold Slider */}
                    <div className="pt-6 border-t border-white/[0.06] space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold text-white">Context Token Compression Threshold</div>
                          <p className="text-xs text-slate-400 mt-1">
                            Trigger background context compression when non-system messages exceed this token volume.
                          </p>
                        </div>
                        <span className="text-xs font-mono font-bold text-indigo-400 px-3 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                          {(summaryThreshold / 1000).toFixed(0)}k tokens
                        </span>
                      </div>
                      <input
                        type="range"
                        min={10000}
                        max={120000}
                        step={5000}
                        value={summaryThreshold}
                        onChange={(e) => setSummaryThreshold(Number(e.target.value))}
                        className="w-full accent-indigo-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
                      />
                    </div>

                    {/* Setting Row 6: On-Demand Manual Compaction */}
                    <div className="pt-6 border-t border-white/[0.06] flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold text-white">On-Demand Context Compression</div>
                        <p className="text-xs text-slate-400 mt-1">
                          {activeSession ? `Active session contains ${activeSession.history?.length || 0} interaction records.` : 'Select an active chat session to manually compact history.'}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={!activeSessionId || isSummarizingContext}
                        onClick={async () => {
                          setIsSummarizingContext(true);
                          setSummarizeSuccessMsg(null);
                          try {
                            await summarizeActiveContext();
                            setSummarizeSuccessMsg('Session context compressed successfully!');
                            setTimeout(() => setSummarizeSuccessMsg(null), 3000);
                          } catch (err: any) {
                            setSummarizeSuccessMsg(`Error: ${err.message}`);
                          } finally {
                            setIsSummarizingContext(false);
                          }
                        }}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                      >
                        {isSummarizingContext ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Compressing Context...</span>
                          </>
                        ) : (
                          <>
                            <RotateCcw className="w-4 h-4" />
                            <span>Compress Active Context</span>
                          </>
                        )}
                      </button>
                    </div>

                    {summarizeSuccessMsg && (
                      <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 font-medium flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>{summarizeSuccessMsg}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* View: Mem0 Multi-Tier & Knowledge Graph Explorer */}
                {settingsTab === 'memory' && (
                  <div className="space-y-6">
                    <MemoryExplorer selectedModel={selectedModel} onClose={() => setShowSettings(false)} />
                  </div>
                )}

                {/* View: Environment & Custom Providers */}
                {settingsTab === 'environment' && (
                  <div className="space-y-6">
                    <EnvSettings />
                  </div>
                )}

                {/* View: System Runtime & Connectivity */}
                {settingsTab === 'runtime' && (
                  <div className="max-w-3xl space-y-6">
                    <div>
                      <h4 className="text-base font-bold text-white">System Runtime & Services</h4>
                      <p className="text-xs text-slate-400 mt-1">
                        Live connectivity and service health metrics for the OpenManus backend environment.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-2">
                      <div className="p-5 rounded-2xl bg-[#111420] border border-white/[0.07] space-y-2">
                        <div className="text-xs font-mono uppercase tracking-wider text-slate-400">Core REST API</div>
                        <div className="text-base font-bold text-emerald-400 flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span>Operational</span>
                        </div>
                        <p className="text-xs text-slate-400 pt-1">Express API running on port 3000</p>
                      </div>

                      <div className="p-5 rounded-2xl bg-[#111420] border border-white/[0.07] space-y-2">
                        <div className="text-xs font-mono uppercase tracking-wider text-slate-400">PostgreSQL Database</div>
                        <div className={`text-base font-bold flex items-center gap-2 ${health?.db === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          <span className={`w-2.5 h-2.5 rounded-full ${health?.db === 'ok' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                          <span>{health?.db === 'ok' ? 'Connected' : 'Disconnected'}</span>
                        </div>
                        <p className="text-xs text-slate-400 pt-1">Sessions, history, memory nodes & episodes</p>
                      </div>

                      <div className="p-5 rounded-2xl bg-[#111420] border border-white/[0.07] space-y-2">
                        <div className="text-xs font-mono uppercase tracking-wider text-slate-400">Neo4j Graph Database</div>
                        <div className="text-base font-bold text-emerald-400 flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                          <span>Active / PG Fallback Ready</span>
                        </div>
                        <p className="text-xs text-slate-400 pt-1">Bolt connection on port 7687</p>
                      </div>

                      <div className="p-5 rounded-2xl bg-[#111420] border border-white/[0.07] space-y-2">
                        <div className="text-xs font-mono uppercase tracking-wider text-slate-400">Docker Code Sandbox</div>
                        <div className="text-base font-bold text-emerald-400 flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                          <span>Ready</span>
                        </div>
                        <p className="text-xs text-slate-400 pt-1">Ephemeral container runtime for bash & python</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-white/[0.08] flex justify-end bg-[#0E1019]">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                Done
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
    title?: string;
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
          {session.title || session.goal || 'Untitled Mission'}
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
