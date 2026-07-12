// src/components/StreamingMessage.tsx
import React, { useState, useEffect } from 'react';
import { BookText, Bot, Cpu, Square, Loader2, Brain } from 'lucide-react';
import { GenUIRenderer } from './GenUIRenderer';
import { useChatStore } from '../store/useChatStore';
import { ToolCallsGroup } from './ToolCallsGroup';
import MarkdownRenderer from './MarkdownRenderer';

const parseC1UiBlock = (content: string) => {
  const openTags = ['<c1_ui>', '<c1-component>', '<thesys>'];
  const closeTags = ['</c1_ui>', '</c1-component>', '</thesys>'];

  for (let i = 0; i < openTags.length; i++) {
    const openTag = openTags[i];
    const closeTag = closeTags[i];
    const openIdx = content.indexOf(openTag);
    if (openIdx !== -1) {
      const closeIdx = content.indexOf(closeTag, openIdx + openTag.length);
      if (closeIdx !== -1) {
        const payload = content.slice(openIdx + openTag.length, closeIdx).trim();
        const cleanContent = (content.slice(0, openIdx) + content.slice(closeIdx + closeTag.length)).trim();
        return { payload, cleanContent };
      } else {
        // Unclosed tag
        const payload = content.slice(openIdx + openTag.length).trim();
        const cleanContent = content.slice(0, openIdx).trim();
        return { payload, cleanContent };
      }
    }
  }

  return { payload: null, cleanContent: content };
};

export const StreamingMessage: React.FC = () => {
  const { 
    isStreaming, 
    streamingContent, 
    streamingThoughts, 
    activeToolCalls, 
    abortChat,
    streamingSteps,
    isSummarizing,
    lastSummary,
    selectedModel,
    lastThoughts,
    streamingReasoning,
  } = useChatStore();

  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const toolCallsArray = Object.values(activeToolCalls);
  const hasToolCalls = toolCallsArray.length > 0;

  useEffect(() => {
    let interval: any = null;
    if (isStreaming && !streamingContent && !hasToolCalls) {
      setElapsedSeconds(0);
      interval = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isStreaming, !streamingContent, hasToolCalls]);

  const getLlmStatusText = () => {
    const isGroq = selectedModel && (
      selectedModel.startsWith('llama-') ||
      selectedModel.startsWith('llama3-') ||
      selectedModel.startsWith('deepseek-') ||
      selectedModel.startsWith('gemma2-') ||
      selectedModel.includes('/') ||
      selectedModel.startsWith('allam-')
    );
    const isOpenAI = selectedModel && (
      selectedModel.startsWith('gpt-') ||
      selectedModel.startsWith('o1') ||
      selectedModel.startsWith('o3') ||
      selectedModel.startsWith('o4')
    );

    const providerName = isGroq ? 'Groq' : isOpenAI ? 'OpenAI' : 'Ollama';

    if (elapsedSeconds < 5) {
      return streamingThoughts || `Formulating plan... (connecting to ${providerName})`;
    }
    if (isGroq) {
      return `Groq Rate Limit: TPM/RPM threshold hit. Backing off and retrying in background... (${elapsedSeconds}s elapsed)`;
    }
    if (isOpenAI) {
      return `OpenAI is responding slowly... (${elapsedSeconds}s elapsed)`;
    }
    if (elapsedSeconds < 15) {
      return `Ollama cold start: loading model weights into RAM... (${elapsedSeconds}s elapsed)`;
    }
    return `Ollama is responding slowly. Still loading model... (${elapsedSeconds}s elapsed)`;
  };

  return (
    <div className="flex w-full gap-4 py-6 px-4 md:px-6 rounded-2xl bg-bg-secondary/40 border border-border-dark/30">
      <div className="flex w-full max-w-4xl gap-4 flex-row">
        {/* Avatar */}
        <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-card border border-border-dark text-secondary flex items-center justify-center shadow-neon-cyan animate-pulse">
          <Bot className="w-5 h-5" />
        </div>

        {/* Content Area */}
        <div className="flex-1 space-y-4 overflow-hidden text-left">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="font-heading font-bold text-xs tracking-wider uppercase text-text-muted">
                OpenManus Agent
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping"></span>
              <span className="text-[10px] text-text-muted font-mono flex items-center gap-1 bg-card px-2 py-0.5 rounded border border-border-dark/40">
                <Cpu className="w-3 h-3 text-primary" />
                Step {streamingSteps?.current || 1}/{streamingSteps?.total || 20}
              </span>
            </div>
            
            {/* Thinking indicator */}
            {streamingThoughts && (
              <span className="text-[10px] text-secondary flex items-center gap-1 bg-secondary/5 px-2 py-0.5 border border-secondary/15 rounded-full">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                <span className="font-medium font-heading">{streamingThoughts}</span>
              </span>
            )}
          </div>

          {/* Collapsible Thinking dropdown */}
          {(streamingReasoning || lastThoughts) && (
            <div className="bg-card/30 border border-border-dark/40 rounded-xl p-3.5 space-y-2 relative overflow-hidden select-text text-left mb-4">
              <details className="group cursor-pointer" open={!lastThoughts}>
                <summary className="text-xs font-semibold text-text-muted select-none flex justify-between items-center group-open:mb-2 font-heading tracking-wide uppercase">
                  <span className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-secondary animate-pulse" />
                    <span>Thinking Process</span>
                  </span>
                  <span className="text-[10px] opacity-60 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="text-text-muted leading-relaxed text-sm pr-2 text-left pt-2 border-t border-border-dark/20 max-h-52 overflow-y-auto">
                  {streamingReasoning ? (
                    <MarkdownRenderer content={streamingReasoning.replace(/<\/?(thinking|thought|think)>/gi, '').trim() + ' \u200B'} className="streaming-cursor" />
                  ) : (
                    <MarkdownRenderer content={lastThoughts.replace(/<\/?(thinking|thought|think)>/gi, '').trim()} />
                  )}
                </div>
              </details>
            </div>
          )}

          {/* Live standard response content */}
          {streamingContent && (() => {
            const { payload, cleanContent } = parseC1UiBlock(streamingContent);
            const cleanText = cleanContent.replace(/<\/?(thinking|thought|think)>/gi, '').trim();
            return (
              <div className="space-y-4 mb-4 select-text">
                {cleanText && (
                  <div className="text-text-main leading-relaxed text-sm pr-2 text-left">
                    <MarkdownRenderer content={cleanText + ' \u200B'} className="streaming-cursor" />
                  </div>
                )}
                {payload && (
                  <GenUIRenderer payload={payload} />
                )}
              </div>
            );
          })()}

          {/* Skeleton loader if nothing has started streaming yet */}
          {!streamingReasoning && !lastThoughts && !streamingContent && !hasToolCalls && (
            <div className="space-y-4 py-3 text-left">
              {/* Futuristic skeleton loader */}
              <div className="flex items-center gap-3 text-text-muted animate-pulse">
                <Brain className="w-5 h-5 text-secondary animate-pulse" />
                <div className="text-xs font-semibold font-heading tracking-wide uppercase">
                  Formulating Execution Plan...
                </div>
              </div>
              <div className="space-y-2 max-w-xl animate-pulse">
                <div className="h-2.5 bg-card border border-border-dark/45 rounded-full w-full"></div>
                <div className="h-2.5 bg-card border border-border-dark/45 rounded-full w-5/6"></div>
                <div className="h-2.5 bg-card border border-border-dark/45 rounded-full w-2/3"></div>
              </div>
              <div className={`text-[11px] font-mono px-3 py-1.5 rounded-lg inline-block border ${
                elapsedSeconds >= 15
                  ? 'text-rose-400 bg-rose-500/5 border-rose-500/15 animate-pulse'
                  : elapsedSeconds >= 5
                  ? 'text-amber-400 bg-amber-500/5 border-amber-500/15 animate-pulse'
                  : 'text-secondary bg-secondary/5 border-secondary/15'
              }`}>
                {getLlmStatusText()}
              </div>
            </div>
          )}



          {/* Summary banner — shown while summarizing */}
          {isSummarizing && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-400 text-xs font-medium animate-pulse">
              <BookText className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Compressing conversation history to save context window...</span>
              <Loader2 className="w-3 h-3 animate-spin ml-auto" />
            </div>
          )}

          {/* Summary card — shown after summary created */}
          {lastSummary && !isSummarizing && (
            <details className="rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden group">
              <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer list-none text-amber-400 text-[11px] font-semibold uppercase tracking-wider hover:bg-amber-500/10 transition-colors">
                <BookText className="w-3.5 h-3.5" />
                <span>Conversation Summary (context compressed)</span>
                <span className="ml-auto text-text-muted text-[10px] font-normal group-open:hidden">▼ expand</span>
                <span className="ml-auto text-text-muted text-[10px] font-normal hidden group-open:block">▲ collapse</span>
              </summary>
              <div className="px-3 pb-3 pt-2 border-t border-amber-500/15 text-text-main text-[12px] leading-relaxed max-h-52 overflow-y-auto select-text">
                <MarkdownRenderer content={lastSummary} />
              </div>
            </details>
          )}

          {/* Running Tool Cards */}
          {hasToolCalls && (
            <ToolCallsGroup toolCalls={toolCallsArray} />
          )}

          {/* Stop / Abort button */}
          <div className="flex items-center gap-3 pt-3 border-t border-border-dark/20 mt-4">
            <button
              onClick={abortChat}
              className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/30 px-2.5 py-1.5 rounded-md transition-all active:scale-95 shadow-neon-blue font-semibold"
            >
              <Square className="w-3.5 h-3.5 fill-rose-400" />
              <span>Stop Agent</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StreamingMessage;
