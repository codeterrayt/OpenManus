// src/components/ChatMessage.tsx
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  User, 
  Copy, 
  Check, 
  RefreshCw, 
  Square, 
  Edit3, 
  Sparkles
} from 'lucide-react';
import { GenUIRenderer } from './GenUIRenderer';
import type { Message, ToolCall } from '../services/api';
import MarkdownRenderer from './MarkdownRenderer';
import { ToolCallsGroup } from './ToolCallsGroup';
import type { StandardToolCall } from './ToolCallsGroup';
import { ThinkingBlock } from './ThinkingBlock';
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
  history: Message[];
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

  if (!isUser && !isAssistant) return null;

  const handleCopy = async () => {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  const handleRetry = () => {
    const lastUserMsg = [...history].reverse().find(m => m.role === 'user');
    if (lastUserMsg?.content) {
      startChat(lastUserMsg.content);
    }
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editVal.trim()) return;
    setIsEditing(false);
    startChat(editVal);
  };

  const getToolCallProps = (tc: ToolCall) => {
    const liveTool = activeToolCalls[tc.id];
    if (liveTool) {
      return {
        status: liveTool.status,
        result: liveTool.result,
        error: liveTool.error,
        duration: liveTool.duration
      };
    }

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
        duration: undefined
      };
    }

    return {
      status: 'waiting' as const,
      result: undefined,
      error: undefined,
      duration: undefined
    };
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} group/msg`}
    >
      <div className={`flex w-full max-w-3xl gap-3.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Avatar */}
        <div className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center mt-0.5 ${
          isUser 
            ? 'bg-indigo-600 text-white shadow-sm' 
            : 'bg-[#151926] border border-white/[0.08] text-indigo-400 shadow-sm'
        }`}>
          {isUser ? (
            <User className="w-4 h-4" />
          ) : (
            <Sparkles className="w-4 h-4 text-indigo-400" />
          )}
        </div>

        {/* Content Area */}
        <div className={`flex-1 space-y-3 min-w-0 ${isUser ? 'text-right' : 'text-left'}`}>
          {/* User Message Bubble */}
          {isUser && (
            <div className="inline-block text-left max-w-2xl">
              {isEditing ? (
                <form onSubmit={handleEditSubmit} className="w-full space-y-2">
                  <textarea
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    className="w-full bg-[#121624] text-white text-sm p-3 rounded-xl border border-indigo-500/50 focus:outline-none focus:ring-1 focus:ring-indigo-500 leading-relaxed font-sans"
                    rows={3}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="px-3 py-1 rounded-lg text-xs font-semibold text-slate-400 hover:text-white bg-white/[0.05] border border-white/[0.08] transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-all shadow-sm"
                    >
                      Resubmit
                    </button>
                  </div>
                </form>
              ) : (
                <div className="relative group inline-block">
                  <div className="bg-[#171C2B] border border-white/[0.08] rounded-2xl px-4 py-3 text-slate-100 text-sm leading-relaxed shadow-sm select-text">
                    <MarkdownRenderer content={message.content || ''} />
                  </div>
                  
                  {/* Edit prompt shortcut */}
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="absolute -left-7 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-white rounded-md hover:bg-white/[0.08] transition-all"
                    title="Edit prompt"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Assistant Message Bubble */}
          {isAssistant && (
            <div className="space-y-3 text-left">
              {/* Header Label */}
              <div className="flex items-center gap-2">
                <span className="font-semibold text-xs text-slate-200 tracking-tight">
                  OpenManus
                </span>
                <span className="w-1 h-1 rounded-full bg-slate-600"></span>
                <span className="text-[11px] text-slate-500 font-mono">
                  Autonomous Agent
                </span>
              </div>

              {/* Main Content */}
              {message.content && (() => {
                const { thoughts, response } = parseMessageThoughts(message.content);
                return (
                  <div className="space-y-3 select-text">
                    {/* Collapsible Thoughts */}
                    {thoughts && (
                      <ThinkingBlock content={thoughts} />
                    )}

                    {/* Response body */}
                    {response && (() => {
                      const { payload, cleanContent } = parseC1UiBlock(response);
                      return (
                        <div className="space-y-3">
                          {cleanContent && (
                            <div className="text-sm leading-relaxed text-slate-200">
                              <MarkdownRenderer content={cleanContent} />
                            </div>
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

              {/* Tool Calls Stepper */}
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

              {/* Quick Actions Footer */}
              <div className="flex items-center gap-2 pt-1 opacity-80 hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white px-2 py-1 rounded-md hover:bg-white/[0.06] transition-colors"
                  title="Copy message"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>

                {isLast && !isStreaming && (
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white px-2 py-1 rounded-md hover:bg-white/[0.06] transition-colors"
                    title="Retry run"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Retry</span>
                  </button>
                )}

                {isLast && isStreaming && (
                  <button
                    type="button"
                    onClick={abortChat}
                    className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 px-2 py-1 rounded-md bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-colors"
                  >
                    <Square className="w-3 h-3 fill-rose-400" />
                    <span>Stop</span>
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
