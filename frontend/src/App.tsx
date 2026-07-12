// src/App.tsx
import { useEffect, useRef, useState } from 'react';
import { 
  Menu, 
  X, 
  PanelRight, 
  PanelLeft,
  Terminal, 
  Globe, 
  Cpu, 
  Sparkles,
  ArrowRight,
  MousePointerClick
} from 'lucide-react';
import { useChatStore } from './store/useChatStore';
import Sidebar from './components/Sidebar';
import ChatInput from './components/ChatInput';
import ChatMessage from './components/ChatMessage';
import StreamingMessage from './components/StreamingMessage';
import RightPanel from './components/RightPanel';
import BrowserPanel from './components/BrowserPanel';

function App() {
  const {
    activeSession,
    isStreaming,
    streamingContent,
    sidebarCollapsed,
    toggleSidebar,
    rightPanelCollapsed,
    toggleRightPanel,
    startChat,
    isBrowserActive,
    isBrowserUnplugged
  } = useChatStore();

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  // Detect if user manually scrolled up
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      // Within 80px of bottom = user wants to follow; else paused
      userScrolledUp.current = distFromBottom > 80;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Auto scroll to bottom only when user hasn't scrolled up
  const scrollToBottom = (force = false, behavior: ScrollBehavior = 'smooth') => {
    if (force || !userScrolledUp.current) {
      messagesEndRef.current?.scrollIntoView({ behavior });
    }
  };

  // Scroll on new messages from history; force on new session start
  useEffect(() => {
    scrollToBottom(false, 'smooth');
  }, [activeSession?.history?.length]);

  // Scroll during live streaming content, but respect user scroll
  useEffect(() => {
    scrollToBottom(false, 'auto');
  }, [streamingContent]);

  // Suggestions for new chat
  const suggestions = [
    {
      title: "Run Python Simulation",
      desc: "Draw a fractal tree graphic in Python and save it",
      prompt: "Write a Python script using turtle/matplotlib that generates a beautiful fractal tree, save it to fractal.png, and run it.",
      icon: <Terminal className="w-4 h-4 text-primary" />
    },
    {
      title: "Browse the Web",
      desc: "Extract developer jobs info from standard listings",
      prompt: "Browse the web to search for current React and AI developer job trends. Extract the key highlights and format as a table.",
      icon: <Globe className="w-4 h-4 text-secondary" />
    },
    {
      title: "Evaluate JS sandbox",
      desc: "Perform advanced data calculations in Node.js",
      prompt: "Write a Node.js script that computes the first 50 prime numbers, calculates their sum and average, and run it inside the sandbox.",
      icon: <Cpu className="w-4 h-4 text-amber-400" />
    }
  ];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-text-main font-sans text-sm select-none antialiased">
      {/* Mobile Menu Headers */}
      <header className="flex md:hidden w-full h-14 bg-bg-secondary border-b border-border-dark px-4 items-center justify-between z-30 shrink-0">
        <button 
          onClick={() => setMobileSidebarOpen(true)}
          className="text-text-muted hover:text-text-main p-1 rounded-md"
        >
          <Menu className="w-6 h-6" />
        </button>
        <span className="font-heading font-bold text-xs tracking-wider text-text-main">
          OPENMANUS ENGINE
        </span>
        <button 
          onClick={toggleRightPanel}
          className="text-text-muted hover:text-text-main p-1 rounded-md"
        >
          <PanelRight className="w-5 h-5" />
        </button>
      </header>

      {/* Sidebar: Left Panel (Desktop standard, Mobile overlay) */}
      <div className={`
        fixed inset-y-0 left-0 z-40 transform md:relative md:translate-x-0 transition-all duration-300 ease-in-out shrink-0
        ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        ${sidebarCollapsed ? 'md:w-0 overflow-hidden' : 'md:w-72'}
      `}>
        <Sidebar />
      </div>

      {/* Mobile Sidebar Backdrop Overlay */}
      {mobileSidebarOpen && (
        <div 
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-30 md:hidden"
        />
      )}

      {/* Center Layout: Main Chat Viewport */}
      <main className="flex-1 flex flex-col h-full bg-[#0E1320]/45 overflow-hidden relative">
        {/* Desktop Header */}
        <header className="hidden md:flex w-full h-14 bg-bg-secondary/40 backdrop-blur-md border-b border-border-dark/60 px-6 items-center justify-between z-20 shrink-0">
          <div className="flex items-center gap-3">
            {sidebarCollapsed && (
              <button 
                onClick={toggleSidebar}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-[#1E293B] hover:bg-[#1E293B]/85 text-text-muted hover:text-text-main border border-border-dark/60 font-medium transition-all duration-200"
                title="Expand Sidebar"
              >
                <PanelLeft className="w-4 h-4 text-primary animate-pulse" />
                <span>Show Sidebar</span>
              </button>
            )}
            <span className="font-heading font-bold text-xs tracking-wider text-text-muted uppercase">
              {activeSession ? 'Session Active' : 'New Session'}
            </span>
          </div>
          
          {rightPanelCollapsed && (
            <button 
              onClick={toggleRightPanel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[#1E293B] hover:bg-[#1E293B]/80 text-text-muted hover:text-text-main border border-border-dark font-medium transition-all duration-200"
              title="Open Workspace"
            >
              <PanelRight className="w-4 h-4 text-primary" />
              <span>Workspace</span>
            </button>
          )}
        </header>

        {/* Mobile Sidebar Close Button inside viewport */}
        {mobileSidebarOpen && (
          <button
            onClick={() => setMobileSidebarOpen(false)}
            className="absolute top-4 left-4 z-50 text-text-muted hover:text-text-main p-2 rounded-xl bg-card border border-border-dark md:hidden"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Scrollable messages zone */}
        <div 
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-4 py-6 md:px-8 space-y-6 scrollbar-thin"
        >
          {activeSession ? (
            <div className="max-w-4xl mx-auto space-y-8 pb-10">
              {/* Header card with active goal summary */}
              <div className="glass-card rounded-2xl p-4 md:p-5 border border-border-dark/60 text-left relative overflow-hidden flex flex-col md:flex-row md:items-center gap-4 justify-between">
                <div className="space-y-1 select-text">
                  <span className="text-[10px] font-bold text-secondary uppercase tracking-widest font-heading">
                    Active Mission Goal
                  </span>
                  <h2 className="text-sm font-semibold text-text-main font-sans leading-relaxed">
                    {activeSession.goal}
                  </h2>
                </div>
                
                {/* Panel toggle when collapsed */}
                {rightPanelCollapsed && (
                  <button
                    onClick={toggleRightPanel}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[#1E293B] hover:bg-[#1E293B]/80 text-text-muted hover:text-text-main border border-border-dark font-medium transition-all duration-200"
                  >
                    <PanelRight className="w-4 h-4 text-primary" />
                    <span>Workspace</span>
                  </button>
                )}
              </div>

              {/* Message loop */}
              <div className="space-y-6">
                {activeSession.history.map((msg, idx) => (
                  <ChatMessage 
                    key={idx} 
                    message={msg} 
                    index={idx}
                    isLast={idx === activeSession.history.length - 1} 
                    history={activeSession.history}
                  />
                ))}

                {/* Live stream message */}
                {isStreaming && <StreamingMessage />}
                
                <div ref={messagesEndRef} />
              </div>
            </div>
          ) : (
            /* Empty state overlay suggestions */
            <div className="h-full flex flex-col justify-center items-center max-w-2xl mx-auto text-center px-4 space-y-10">
              <div className="space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-primary to-secondary flex items-center justify-center shadow-neon-glow mx-auto mb-2 animate-bounce">
                  <Sparkles className="w-9 h-9 text-white" />
                </div>
                <h2 className="text-2xl font-bold font-heading tracking-tight text-text-main">
                  Autonomous AI Action Engine
                </h2>
                <p className="text-xs text-text-muted max-w-md mx-auto leading-relaxed">
                  OpenManus coordinates sandbox executors and web browsers to run code and browse autonomously. What task should I run?
                </p>
              </div>

              {/* Custom Suggestions Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
                {suggestions.map((sug, i) => (
                  <button
                    key={i}
                    onClick={() => startChat(sug.prompt)}
                    className="flex flex-col text-left p-4 rounded-xl bg-card/40 border border-border-dark/65 hover:border-primary/45 hover:bg-card/75 transition-all duration-300 group shadow-sm active:scale-98"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="p-1.5 rounded-lg bg-bg-secondary border border-border-dark">
                        {sug.icon}
                      </div>
                      <MousePointerClick className="w-3.5 h-3.5 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <h3 className="text-xs font-bold text-text-main font-heading mb-1">
                      {sug.title}
                    </h3>
                    <p className="text-[10px] text-text-muted leading-relaxed">
                      {sug.desc}
                    </p>
                    <span className="mt-3 text-[10px] text-primary hover:text-secondary inline-flex items-center gap-1 font-semibold">
                      <span>Launch Task</span>
                      <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        
        {/* Floating Mini Browser (PiP View) when inspector is closed */}
        {isBrowserActive && !isBrowserUnplugged && rightPanelCollapsed && (
          <div className="absolute bottom-[96px] right-6 w-[380px] h-[260px] z-30 bg-[#070A13] border border-border-dark/80 shadow-2xl rounded-2xl overflow-hidden flex flex-col ring-1 ring-primary/20 animate-slide-up transition-all duration-300 transform hover:scale-[1.02]">
            <BrowserPanel isMini={true} />
          </div>
        )}

        {/* Input Zone */}
        <ChatInput />
      </main>

      {/* Right Diagnostics Panel */}
      <RightPanel />
    </div>
  );
}

export default App;
