// src/App.tsx
import { useEffect, useRef, useState } from 'react';
import { 
  Menu, 
  PanelRight, 
  PanelLeft,
  Terminal, 
  Globe, 
  Cpu, 
  Sparkles,
  ArrowRight,
  ArrowDown,
  Coins
} from 'lucide-react';
import { useChatStore } from './store/useChatStore';
import Sidebar from './components/Sidebar';
import ChatInput from './components/ChatInput';
import ConversationTurnItem, { groupHistoryIntoTurns } from './components/ConversationTurnItem';
import StreamingMessage from './components/StreamingMessage';
import RightPanel from './components/RightPanel';
import { calculateCost, formatTokenCount } from './utils/pricing';

function App() {
  const {
    activeSession,
    isStreaming,
    streamingContent,
    streamingThoughts,
    activeToolCalls,
    selectedModel,
    sidebarCollapsed,
    toggleSidebar,
    rightPanelCollapsed,
    toggleRightPanel,
    startChat,
  } = useChatStore();

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  // Detect if user manually scrolled up
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const isScrolledUp = distFromBottom > 80;
      userScrolledUp.current = isScrolledUp;
      setShowScrollBottom(isScrolledUp);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const scrollRaf = useRef<number | null>(null);

  const scrollToBottom = (force = false, behavior: ScrollBehavior = 'smooth') => {
    if (force || !userScrolledUp.current) {
      if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
      scrollRaf.current = requestAnimationFrame(() => {
        const el = scrollContainerRef.current;
        if (el) {
          if (behavior === 'auto') {
            el.scrollTop = el.scrollHeight;
          } else {
            el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
          }
        }
        messagesEndRef.current?.scrollIntoView({ behavior });
        if (force) {
          userScrolledUp.current = false;
          setShowScrollBottom(false);
        }
      });
    }
  };

  // Scroll to bottom when opening/switching session
  useEffect(() => {
    userScrolledUp.current = false;
    scrollToBottom(true, 'smooth');
  }, [activeSession?.id]);

  // Scroll when history array length changes
  useEffect(() => {
    scrollToBottom(false, 'smooth');
  }, [activeSession?.history?.length]);

  // Scroll during live streaming updates
  useEffect(() => {
    if (isStreaming) {
      scrollToBottom(false, 'auto');
    }
  }, [isStreaming, streamingContent, streamingThoughts, Object.keys(activeToolCalls).length]);

  const suggestions = [
    {
      title: "Sandbox Code Execution",
      desc: "Run Python math simulation and export plot",
      prompt: "Write a Python script using matplotlib that plots a mandelbrot fractal, saves it to fractal.png, and run it in the sandbox.",
      icon: <Terminal className="w-4 h-4 text-indigo-400" />
    },
    {
      title: "Live Web Automation",
      desc: "Search and synthesize current trends",
      prompt: "Browse the web to search for current AI agent design trends and architectures. Extract key patterns and summarize as a markdown table.",
      icon: <Globe className="w-4 h-4 text-sky-400" />
    },
    {
      title: "Data Processing",
      desc: "Compute prime numbers and statistics in Node.js",
      prompt: "Write a Node.js script that computes the first 100 prime numbers, calculates their statistical distribution, and run it inside the container.",
      icon: <Cpu className="w-4 h-4 text-emerald-400" />
    }
  ];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-text-main font-sans text-sm select-none antialiased">
      {/* Mobile Top Navigation Header */}
      <header className="flex md:hidden w-full h-13 bg-[#0C0F18] border-b border-white/[0.08] px-4 items-center justify-between z-30 shrink-0">
        <button 
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/[0.06]"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-1.5 font-heading font-bold text-xs tracking-tight text-white">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          <span>OpenManus</span>
        </div>
        <button 
          type="button"
          onClick={toggleRightPanel}
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/[0.06]"
        >
          <PanelRight className="w-5 h-5" />
        </button>
      </header>

      {/* Sidebar: Left Panel */}
      <div className={`
        fixed inset-y-0 left-0 z-40 transform md:relative md:translate-x-0 transition-all duration-300 ease-in-out shrink-0
        ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        ${sidebarCollapsed ? 'md:w-0 overflow-hidden' : 'md:w-72'}
      `}>
        <Sidebar />
      </div>

      {/* Mobile Sidebar Backdrop */}
      {mobileSidebarOpen && (
        <div 
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 bg-black/70 backdrop-blur-xs z-30 md:hidden"
        />
      )}

      {/* Center Layout: Main Chat Viewport */}
      <main className="flex-1 flex flex-col h-full bg-[#090B10] overflow-hidden relative">
        {/* Desktop Header */}
        <header className="hidden md:flex w-full h-14 bg-[#0A0C13] border-b border-white/[0.06] px-6 items-center justify-between z-20 shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {sidebarCollapsed && (
              <button 
                type="button"
                onClick={toggleSidebar}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-[#121622] hover:bg-[#161B2A] text-slate-300 hover:text-white border border-white/[0.08] font-medium transition-colors cursor-pointer shrink-0"
                title="Expand Sidebar"
              >
                <PanelLeft className="w-3.5 h-3.5 text-indigo-400" />
                <span>Show Sidebar</span>
              </button>
            )}
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>
              <span className="font-semibold text-sm text-slate-200 tracking-tight truncate">
                {activeSession?.title || (activeSession?.goal ? activeSession.goal.slice(0, 50) : 'New Chat')}
              </span>
              {selectedModel && (
                <span className="hidden lg:inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono bg-white/[0.04] text-slate-400 border border-white/[0.06] shrink-0">
                  {selectedModel.includes('::') ? selectedModel.split('::')[1] : selectedModel}
                </span>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-3 shrink-0 mr-4">
            {activeSession && (() => {
              const turns = groupHistoryIntoTurns(activeSession.history || [], selectedModel);
              let pTokens = 0;
              let cTokens = 0;
              for (const t of turns) {
                pTokens += t.estimatedPromptTokens;
                cTokens += t.estimatedCompletionTokens;
              }
              const cost = calculateCost(pTokens, cTokens, selectedModel);
              return (
                <div 
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-medium border ${
                    cost.isFree
                      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                      : 'bg-purple-500/10 text-purple-200 border-purple-500/20'
                  }`}
                  title={`Prompt tokens: ~${pTokens}, Completion tokens: ~${cTokens}`}
                >
                  <Coins className="w-3.5 h-3.5 text-purple-400" />
                  <span>{cost.formattedCost}</span>
                  <span className="text-white/[0.2]">•</span>
                  <span className="text-slate-400">{formatTokenCount(pTokens + cTokens)} tok</span>
                </div>
              );
            })()}

            {rightPanelCollapsed && (
              <button 
                type="button"
                onClick={toggleRightPanel}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[#121622] hover:bg-[#161B2A] text-slate-200 hover:text-white border border-white/[0.08] font-medium transition-colors shadow-sm cursor-pointer ml-1"
                title="Open Workspace"
              >
                <PanelRight className="w-3.5 h-3.5 text-indigo-400" />
                <span>Workspace</span>
              </button>
            )}
          </div>
        </header>

        {/* Scrollable messages zone */}
        <div 
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-4 py-6 md:px-8 space-y-6 scrollbar-thin relative"
        >
          {activeSession ? (() => {
            const conversationTurns = groupHistoryIntoTurns(activeSession.history || [], selectedModel);

            return (
              <div className="max-w-3xl mx-auto space-y-6 pb-6">
                {/* Conversational Turns Loop */}
                <div className="space-y-6">
                  {conversationTurns.map((turn, idx) => (
                    <ConversationTurnItem 
                      key={turn.id || idx} 
                      turn={turn} 
                      isLast={idx === conversationTurns.length - 1} 
                    />
                  ))}

                  {/* Live stream message */}
                  {isStreaming && <StreamingMessage />}
                  
                  <div ref={messagesEndRef} />
                </div>
              </div>
            );
          })() : (
            /* Empty state: Executive Hero & Prompt Chips */
            <div className="h-full flex flex-col justify-center items-center max-w-2xl mx-auto text-center px-4 space-y-8 animate-fade-in">
              <div className="space-y-2.5">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-soft-glow mx-auto mb-2">
                  <Sparkles className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-2xl font-bold font-heading tracking-tight text-white">
                  OpenManus Autonomous Engine
                </h2>
                <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                  Reason, execute sandbox code, browse the web, and compose multi-step autonomous tasks. What should we accomplish today?
                </p>
              </div>

              {/* Prompt Suggestions Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full">
                {suggestions.map((sug, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => startChat(sug.prompt)}
                    className="flex flex-col text-left p-3.5 rounded-xl bg-[#111520] border border-white/[0.06] hover:border-indigo-500/40 hover:bg-[#151A28] transition-all group shadow-sm active:scale-98 cursor-pointer"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="p-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08]">
                        {sug.icon}
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all" />
                    </div>
                    <div className="font-semibold text-xs text-white mb-0.5 group-hover:text-indigo-300 transition-colors">
                      {sug.title}
                    </div>
                    <div className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                      {sug.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Floating Scroll to Bottom Button */}
          {showScrollBottom && (
            <button
              type="button"
              onClick={() => scrollToBottom(true, 'smooth')}
              className="fixed bottom-28 right-8 md:right-96 z-30 p-2 rounded-full bg-[#151926] border border-white/[0.1] text-slate-300 hover:text-white shadow-floating transition-all active:scale-95"
              title="Scroll to bottom"
            >
              <ArrowDown className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Input Bar */}
        <ChatInput />
      </main>

      {/* Right Panel Workspace */}
      <RightPanel />
    </div>
  );
}

export default App;
