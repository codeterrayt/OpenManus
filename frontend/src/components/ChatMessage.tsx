// src/components/ChatMessage.tsx
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Bot, 
  User, 
  Copy, 
  Check, 
  RefreshCw, 
  Square, 
  Edit3, 
  Cpu,
  Brain
} from 'lucide-react';
import { GenUIRenderer } from './GenUIRenderer';
import type { Message, ToolCall } from '../services/api';
import MarkdownRenderer from './MarkdownRenderer';
import { ToolCallsGroup } from './ToolCallsGroup';
import type { StandardToolCall } from './ToolCallsGroup';
import { useChatStore } from '../store/useChatStore';

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

const parseMessageThoughts = (content: string) => {
  const parseTag = (openTag: string, closeTag: string) => {
    const openIdx = content.indexOf(openTag);
    if (openIdx === -1) return null;
    
    const closeIdx = content.indexOf(closeTag, openIdx + openTag.length);
    if (closeIdx !== -1) {
      const thoughts = content.slice(openIdx + openTag.length, closeIdx).trim();
      const response = (content.slice(0, openIdx) + content.slice(closeIdx + closeTag.length)).trim();
      return { thoughts, response };
    } else {
      // Unclosed tag: assume everything after openTag is thoughts
      const thoughts = content.slice(openIdx + openTag.length).trim();
      const response = content.slice(0, openIdx).trim();
      return { thoughts, response };
    }
  };

  const think = parseTag('<think>', '</think>');
  if (think) return think;

  const thought = parseTag('<thought>', '</thought>');
  if (thought) return thought;

  const thinking = parseTag('<thinking>', '</thinking>');
  if (thinking) return thinking;

  return { thoughts: null, response: content };
};

interface ChatMessageProps {
  message: Message;
  index: number;
  isLast: boolean;
  history: Message[]; // to find tool outputs for tool calls
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  isLast,
  history
}) => {
  const { 
    isStreaming, 
    activeToolCalls, 
    abortChat, 
    startChat
  } = useChatStore();
  
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editVal, setEditVal] = useState(message.content || '');

  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  if (!isUser && !isAssistant) return null; // Hide tool and system messages from direct feed

  const handleCopy = async () => {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  const handleRetry = () => {
    // Find the last user goal
    const lastUserMsg = [...history].reverse().find(m => m.role === 'user');
    if (lastUserMsg?.content) {
      startChat(lastUserMsg.content);
    }
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editVal.trim()) return;
    setIsEditing(false);
    // Restart conversation with edited goal
    startChat(editVal);
  };

  // Find tool result, raw response, error, and compute duration for a tool call ID
  const getToolCallProps = (tc: ToolCall) => {
    // Check if it's currently running in live store
    const liveTool = activeToolCalls[tc.id];
    if (liveTool) {
      return {
        status: liveTool.status,
        result: liveTool.result,
        error: liveTool.error,
        duration: liveTool.duration
      };
    }

    // Otherwise, lookup from history
    const toolMsg = history.find(m => m.role === 'tool' && m.tool_call_id === tc.id);
    if (toolMsg) {
      let parsedResult = toolMsg.content;
      let isError = false;
      try {
        const obj = JSON.parse(toolMsg.content || '{}');
        parsedResult = obj;
        if (obj.error || obj.exitCode > 0 || obj.exitCode === -1 || (obj.stderr && !obj.stdout)) {
          isError = true;
        }
      } catch (_) {}
      
      return {
        status: isError ? ('error' as const) : ('success' as const),
        result: parsedResult,
        error: isError 
          ? (parsedResult && typeof parsedResult === 'object' 
              ? ((parsedResult as any).error || (parsedResult as any).stderr) 
              : String(parsedResult ?? '')) 
          : undefined,
        duration: undefined // static history doesn't store duration in history message
      };
    }

    // Default status
    return {
      status: 'waiting' as const,
      result: undefined,
      error: undefined,
      duration: undefined
    };
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex w-full gap-4 py-6 px-4 md:px-6 rounded-2xl transition-all duration-300 ${
        isUser 
          ? 'justify-end' 
          : 'bg-bg-secondary/40 border border-border-dark/30 hover:border-border-dark/60'
      }`}
    >
      <div className={`flex w-full max-w-4xl gap-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Avatar */}
        <div className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-between justify-center ${
          isUser 
            ? 'bg-gradient-to-tr from-primary to-secondary text-white' 
            : 'bg-card border border-border-dark text-secondary shadow-neon-cyan'
        }`}>
          {isUser ? (
            <User className="w-5 h-5 mx-auto" />
          ) : (
            <Bot className="w-5 h-5 mx-auto animate-pulse" />
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 space-y-4 overflow-hidden">
          {/* User Bubble */}
          {isUser && (
            <div className="text-right">
              {isEditing ? (
                <form onSubmit={handleEditSubmit} className="inline-block w-full max-w-2xl text-left">
                  <textarea
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    className="w-full bg-[#0F1420] text-text-main text-sm font-sans p-3.5 rounded-xl border border-primary/50 focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary/50 font-medium"
                    rows={3}
                  />
                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-text-muted hover:text-text-main hover:bg-card border border-border-dark transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-primary hover:bg-primary/80 transition-all shadow-neon-blue"
                    >
                      Save & Resubmit
                    </button>
                  </div>
                </form>
              ) : (
                <div className="group relative inline-block text-left">
                  <div className="bg-primary/10 border border-primary/25 rounded-2xl px-4 py-3 text-text-main text-sm inline-block leading-relaxed max-w-2xl shadow-neon-blue select-text">
                    <MarkdownRenderer content={message.content || ''} />
                  </div>
                  
                  {/* Edit Message Trigger */}
                  <button
                    onClick={() => setIsEditing(true)}
                    className="absolute -left-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 text-text-muted hover:text-text-main rounded-md hover:bg-card border border-border-dark/40 transition-all duration-200"
                    title="Edit prompt"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Assistant Bubble */}
          {isAssistant && (
            <div className="space-y-4">
              {/* Heading / Agent label */}
              <div className="flex items-center gap-1.5">
                <span className="font-heading font-bold text-xs tracking-wider uppercase text-text-muted">
                  OpenManus Agent
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                <span className="text-[10px] text-text-muted font-mono flex items-center gap-1">
                  <Cpu className="w-3 h-3 text-primary" />
                  Reasoning Core
                </span>
              </div>

              {/* Markdown Content */}
              {message.content && (() => {
                const { thoughts, response } = parseMessageThoughts(message.content);
                return (
                  <div className="space-y-3.5 text-left select-text">
                    {/* Collapsible Thoughts if present */}
                    {thoughts && (
                      <div className="bg-card/25 border border-border-dark/40 rounded-xl p-3.5 space-y-2 relative overflow-hidden select-text text-left mb-3">
                        <details className="group cursor-pointer">
                          <summary className="text-xs font-semibold text-text-muted select-none flex justify-between items-center group-open:mb-2 font-heading tracking-wide uppercase">
                            <span className="flex items-center gap-2">
                              <Brain className="w-4 h-4 text-secondary/70 group-hover:text-secondary transition-colors" />
                              <span>Thinking Process</span>
                            </span>
                            <span className="text-[10px] opacity-60 group-open:rotate-180 transition-transform">▼</span>
                          </summary>
                          <div className="text-text-muted leading-relaxed text-sm pr-2 text-left pt-2 border-t border-border-dark/20 max-h-52 overflow-y-auto">
                            <MarkdownRenderer content={thoughts} />
                          </div>
                        </details>
                      </div>
                    )}
                    {/* Main text response */}
                    {response && (() => {
                      const { payload, cleanContent } = parseC1UiBlock(response);
                      return (
                        <div className="space-y-4">
                          {cleanContent && (
                            <MarkdownRenderer content={cleanContent} />
                          )}
                          {payload && (
                            <GenUIRenderer payload={payload} />
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

              {/* Tool Calls Visualizer */}
              {message.tool_calls && message.tool_calls.length > 0 && (() => {
                const standardToolCalls: StandardToolCall[] = message.tool_calls.map(tc => {
                  const tcProps = getToolCallProps(tc);
                  let args = {};
                  try {
                    args = JSON.parse(tc.function.arguments || '{}');
                  } catch (_) {}
                  return {
                    id: tc.id,
                    name: tc.function.name,
                    args,
                    status: tcProps.status,
                    result: tcProps.result,
                    error: tcProps.error,
                    duration: tcProps.duration
                  };
                });
                return <ToolCallsGroup toolCalls={standardToolCalls} />;
              })()}

              {/* Action Buttons */}
              <div className="flex items-center gap-3 pt-3 text-text-muted border-t border-border-dark/20 mt-4">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-main hover:bg-card border border-border-dark/50 px-2.5 py-1 rounded-md transition-all active:scale-95"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-secondary" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy response</span>
                    </>
                  )}
                </button>

                {isLast && !isStreaming && (
                  <button
                    onClick={handleRetry}
                    className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-main hover:bg-card border border-border-dark/50 px-2.5 py-1 rounded-md transition-all active:scale-95"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry run</span>
                  </button>
                )}

                {isLast && isStreaming && (
                  <button
                    onClick={abortChat}
                    className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/30 px-2.5 py-1 rounded-md transition-all active:scale-95 shadow-neon-blue animate-pulse"
                  >
                    <Square className="w-3.5 h-3.5 fill-rose-400" />
                    <span>Abort execution</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default ChatMessage;
