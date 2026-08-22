// src/components/ThinkingSelector.tsx
import React, { useState, useRef, useEffect } from 'react';
import { Brain, ChevronDown, Check, Sliders, Info } from 'lucide-react';
import { useChatStore } from '../store/useChatStore';
import { detectModelCapabilities, type ModelThinkingCapability, type ThinkingPreset } from '../utils/modelCapabilities';

interface ThinkingSelectorProps {
  className?: string;
}

export const ThinkingSelector: React.FC<ThinkingSelectorProps> = ({ className = '' }) => {
  const { 
    selectedModel, 
    thinkingBudget, 
    setThinkingBudget, 
    reasoningEffort, 
    setReasoningEffort,
    isStreaming 
  } = useChatStore();

  const [isOpen, setIsOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const capabilities: ModelThinkingCapability = detectModelCapabilities(selectedModel);

  // Close popover on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  if (!capabilities.supportsThinking) {
    return null;
  }

  // Determine current active label
  let activeLabel = 'Thinking';
  if (capabilities.type === 'claude_budget' || capabilities.type === 'budget_tokens') {
    const currentBudget = thinkingBudget ?? capabilities.defaultBudget ?? 4096;
    if (currentBudget === 0) {
      activeLabel = 'Thinking: Off';
    } else {
      const match = capabilities.presets.find(p => p.value === currentBudget);
      activeLabel = match ? `Thinking: ${match.shortLabel}` : `Thinking: ${Math.round(currentBudget / 1024)}k`;
    }
  } else if (capabilities.type === 'openai_effort') {
    const currentEffort = reasoningEffort || 'medium';
    activeLabel = `Effort: ${currentEffort.charAt(0).toUpperCase() + currentEffort.slice(1)}`;
  }

  const handleSelectPreset = (preset: ThinkingPreset) => {
    if (capabilities.type === 'claude_budget' || capabilities.type === 'budget_tokens') {
      setThinkingBudget(Number(preset.value));
    } else if (capabilities.type === 'openai_effort') {
      setReasoningEffort(String(preset.value) as 'low' | 'medium' | 'high');
    }
    setCustomMode(false);
    setIsOpen(false);
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setThinkingBudget(val);
  };

  const currentBudgetValue = thinkingBudget ?? capabilities.defaultBudget ?? 4096;
  const currentEffortValue = reasoningEffort || 'medium';

  return (
    <div className={`relative inline-block text-left ${className}`} ref={popoverRef}>
      {/* Trigger Button Pill */}
      <button
        type="button"
        disabled={isStreaming}
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-all duration-150 border cursor-pointer select-none ${
          isOpen
            ? 'bg-purple-500/20 border-purple-500/50 text-purple-200 ring-1 ring-purple-500/30'
            : currentBudgetValue === 0
            ? 'bg-white/[0.04] hover:bg-white/[0.07] border-white/[0.08] text-slate-400 hover:text-slate-300'
            : 'bg-gradient-to-r from-purple-500/10 to-indigo-500/10 hover:from-purple-500/20 hover:to-indigo-500/20 border-purple-500/30 text-purple-300 shadow-sm'
        }`}
        title="Configure model thinking and reasoning limits"
      >
        <Brain className={`w-3.5 h-3.5 ${currentBudgetValue > 0 || capabilities.type === 'openai_effort' ? 'text-purple-400 animate-pulse' : 'text-slate-500'}`} />
        <span className="truncate">{activeLabel}</span>
        <ChevronDown className={`w-3 h-3 transition-transform duration-200 text-slate-400 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Popover Menu Modal */}
      {isOpen && (
        <div className="absolute bottom-full mb-2 left-0 w-80 md:w-96 rounded-2xl bg-[#0D101A] border border-white/[0.12] shadow-2xl z-50 p-3.5 space-y-3 animate-fade-in backdrop-blur-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-purple-500/15 border border-purple-500/25 text-purple-400">
                <Brain className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white font-heading tracking-tight flex items-center gap-1.5">
                  {capabilities.title}
                  <span className="text-[10px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    {capabilities.providerType}
                  </span>
                </h4>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                  {capabilities.description}
                </p>
              </div>
            </div>
          </div>

          {/* Claude / DeepSeek Budget Presets */}
          {(capabilities.type === 'claude_budget' || capabilities.type === 'budget_tokens') && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-300">
                  Thinking Budget Limit
                </span>
                <span className="text-[11px] font-mono text-purple-300 bg-purple-500/15 px-2 py-0.5 rounded border border-purple-500/25">
                  {currentBudgetValue === 0 ? 'Disabled (0 tokens)' : `${currentBudgetValue.toLocaleString()} tokens (~${Math.round(currentBudgetValue / 1024)}k)`}
                </span>
              </div>

              {/* Grid of Presets */}
              <div className="grid grid-cols-4 gap-1.5">
                {capabilities.presets.map((preset) => {
                  const isSelected = currentBudgetValue === preset.value && !customMode;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectPreset(preset)}
                      className={`flex flex-col items-center justify-center p-2 rounded-xl border text-center transition-all cursor-pointer select-none ${
                        isSelected
                          ? 'bg-purple-500/20 border-purple-500/60 text-white shadow-sm ring-1 ring-purple-500/40'
                          : 'bg-[#141824]/80 hover:bg-[#1A2030] border-white/[0.06] text-slate-300 hover:text-white'
                      }`}
                    >
                      <span className="text-xs font-bold font-mono">{preset.shortLabel}</span>
                      <span className="text-[9px] text-slate-400 mt-0.5 leading-tight">{preset.id === 'off' ? 'Direct' : `${Number(preset.value) / 1024}k`}</span>
                    </button>
                  );
                })}
              </div>

              {/* Custom Token Budget Slider */}
              <div className="pt-2 border-t border-white/[0.06] space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400 flex items-center gap-1 font-sans">
                    <Sliders className="w-3 h-3 text-slate-400" />
                    Custom Budget:
                  </span>
                  <span className="font-mono text-purple-300 font-semibold">
                    {currentBudgetValue.toLocaleString()} tokens
                  </span>
                </div>
                <input
                  type="range"
                  min={capabilities.minBudget || 1024}
                  max={capabilities.maxBudget || 64000}
                  step={capabilities.stepBudget || 1024}
                  value={currentBudgetValue}
                  onChange={handleSliderChange}
                  className="w-full accent-purple-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                />
                <div className="flex justify-between text-[9px] font-mono text-slate-500">
                  <span>{((capabilities.minBudget || 1024) / 1024)}k</span>
                  <span>16k</span>
                  <span>32k</span>
                  <span>{((capabilities.maxBudget || 64000) / 1024)}k</span>
                </div>
              </div>
            </div>
          )}

          {/* OpenAI Reasoning Effort Selector */}
          {capabilities.type === 'openai_effort' && (
            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-slate-300">
                Reasoning Compute Level
              </span>
              <div className="grid grid-cols-3 gap-2">
                {capabilities.presets.map((preset) => {
                  const isSelected = currentEffortValue === preset.value;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectPreset(preset)}
                      className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition-all cursor-pointer select-none ${
                        isSelected
                          ? 'bg-purple-500/20 border-purple-500/60 text-white shadow-sm ring-1 ring-purple-500/40'
                          : 'bg-[#141824]/80 hover:bg-[#1A2030] border-white/[0.06] text-slate-300 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="text-xs font-bold font-heading capitalize">{preset.label}</span>
                        {isSelected && <Check className="w-3 h-3 text-purple-400" />}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1 leading-tight">
                        {preset.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer Note */}
          <div className="pt-2 border-t border-white/[0.06] flex items-center gap-1.5 text-[10px] text-slate-500">
            <Info className="w-3 h-3 text-purple-400 shrink-0" />
            <span>Higher limits provide deeper multi-step reasoning for difficult coding and design tasks.</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ThinkingSelector;
