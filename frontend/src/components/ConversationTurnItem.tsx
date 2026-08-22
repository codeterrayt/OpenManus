// src/components/ConversationTurnItem.tsx
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  User, 
  Copy, 
  Check, 
  RefreshCw, 
  Edit3, 
  Sparkles,
  Coins,
  Cpu,
  Layers
} from 'lucide-react';
import { GenUIRenderer } from './GenUIRenderer';
import MarkdownRenderer from './MarkdownRenderer';
import { ToolCallsGroup, type StandardToolCall } from './ToolCallsGroup';
import { ThinkingBlock } from './ThinkingBlock';
import { useChatStore } from '../store/useChatStore';
import { calculateCost, formatTokenCount } from '../utils/pricing';

export interface TurnToolCall extends StandardToolCall {}

export interface ConversationTurn {
  id: string;
  userMessage?: { content: string | null };
  toolCalls: TurnToolCall[];
  allThoughts: string[];
  finalAnswer: string;
  genUIPayload?: string | null;
  estimatedPromptTokens: number;
  estimatedCompletionTokens: number;
  totalTokens: number;
  cost: number;
  formattedCost: string;
  isFree: boolean;
}

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

export function groupHistoryIntoTurns(history: any[], activeModel: string): ConversationTurn[] {
  if (!Array.isArray(history) || history.length === 0) return [];

  const turns: ConversationTurn[] = [];
  let currentTurn: ConversationTurn | null = null;
  let turnIdx = 0;

  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    if (!msg) continue;

    if (msg.role === 'user') {
      if (currentTurn) {
        finalizeTurn(currentTurn, activeModel);
        turns.push(currentTurn);
      }
      turnIdx++;
      currentTurn = {
        id: `turn_${turnIdx}`,
        userMessage: msg,
        toolCalls: [],
        allThoughts: [],
        finalAnswer: '',
        genUIPayload: null,
        estimatedPromptTokens: Math.max(80, Math.ceil((msg.content?.length || 0) / 4) + 120),
        estimatedCompletionTokens: 0,
        totalTokens: 0,
        cost: 0,
        formattedCost: '$0.00',
        isFree: true
      };
    } else if (msg.role === 'assistant') {
      if (!currentTurn) {
        turnIdx++;
        currentTurn = {
          id: `turn_${turnIdx}`,
          toolCalls: [],
          allThoughts: [],
          finalAnswer: '',
          genUIPayload: null,
          estimatedPromptTokens: 150,
          estimatedCompletionTokens: 0,
          totalTokens: 0,
          cost: 0,
          formattedCost: '$0.00',
          isFree: true
        };
      }

      // Collect tool calls
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          let args = {};
          try {
            args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments;
          } catch {
            args = {};
          }
          currentTurn.toolCalls.push({
            id: tc.id,
            name: tc.function.name,
            args,
            status: 'waiting',
          });
        }
      }

      // Collect thoughts / content
      if (msg.content) {
        const { thoughts, response } = parseMessageThoughts(msg.content);
        if (thoughts && !currentTurn.allThoughts.includes(thoughts)) {
          currentTurn.allThoughts.push(thoughts);
        }
        if (response) {
          currentTurn.finalAnswer = response;
        }
        currentTurn.estimatedCompletionTokens += Math.ceil(msg.content.length / 4);
      }

      // If official usage was saved from the provider API, use it directly
      if (msg.usage) {
        currentTurn.estimatedPromptTokens = msg.usage.prompt_tokens || currentTurn.estimatedPromptTokens;
        currentTurn.estimatedCompletionTokens = msg.usage.completion_tokens || currentTurn.estimatedCompletionTokens;
        if (msg.usage.cost !== undefined && msg.usage.cost !== null) {
          currentTurn.cost = msg.usage.cost;
        }
        if (msg.usage.formatted_cost) {
          currentTurn.formattedCost = msg.usage.formatted_cost;
        }
        if (msg.usage.is_free !== undefined) {
          currentTurn.isFree = msg.usage.is_free;
        }
      }
    } else if (msg.role === 'tool') {
      if (currentTurn && msg.tool_call_id) {
        const targetTc = currentTurn.toolCalls.find(t => t.id === msg.tool_call_id);
        if (targetTc) {
          let parsedResult = msg.content;
          let isError = false;
          try {
            const obj = JSON.parse(msg.content || '{}');
            parsedResult = obj;
            if (obj.error || obj.exitCode > 0 || obj.exitCode === -1 || (obj.stderr && !obj.stdout)) {
              isError = true;
            }
          } catch {}

          targetTc.status = isError ? 'error' : 'success';
          targetTc.result = parsedResult;
          if (isError) {
            targetTc.error = parsedResult && typeof parsedResult === 'object' 
              ? ((parsedResult as any).error || (parsedResult as any).stderr) 
              : String(parsedResult);
          }
        }
        currentTurn.estimatedPromptTokens += Math.ceil((msg.content?.length || 0) / 4);
      }
    }
  }

  if (currentTurn) {
    finalizeTurn(currentTurn, activeModel);
    turns.push(currentTurn);
  }

  return turns;
}

function finalizeTurn(turn: ConversationTurn, activeModel: string) {
  if (turn.finalAnswer) {
    const { payload, cleanContent } = parseC1UiBlock(turn.finalAnswer);
    turn.genUIPayload = payload;
    turn.finalAnswer = cleanContent;
  }
  turn.totalTokens = turn.estimatedPromptTokens + turn.estimatedCompletionTokens;
  if (!turn.cost && (turn.estimatedPromptTokens > 0 || turn.estimatedCompletionTokens > 0)) {
    const costInfo = calculateCost(turn.estimatedPromptTokens, turn.estimatedCompletionTokens, activeModel);
    turn.cost = costInfo.cost;
    turn.formattedCost = costInfo.formattedCost;
    turn.isFree = costInfo.isFree;
  } else if (!turn.formattedCost || turn.formattedCost === '$0.00') {
    const costInfo = calculateCost(turn.estimatedPromptTokens, turn.estimatedCompletionTokens, activeModel);
    turn.formattedCost = costInfo.formattedCost;
    turn.isFree = costInfo.isFree;
  }
}

interface ConversationTurnItemProps {
  turn: ConversationTurn;
  isLast: boolean;
}

export const ConversationTurnItem: React.FC<ConversationTurnItemProps> = ({
  turn,
  isLast
}) => {
  const { isStreaming, startChat } = useChatStore();
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editVal, setEditVal] = useState(turn.userMessage?.content || '');

  const handleCopy = async () => {
    const textToCopy = turn.finalAnswer || turn.allThoughts.join('\n\n') || '';
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  const handleRetry = () => {
    if (turn.userMessage?.content) {
      startChat(turn.userMessage.content);
    }
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editVal.trim()) return;
    setIsEditing(false);
    startChat(editVal);
  };

  const thoughtsCombined = turn.allThoughts.filter(Boolean).join('\n\n---\n\n');
  const hasAssistantContent = Boolean(turn.finalAnswer || turn.toolCalls.length > 0 || thoughtsCombined);

  return (
    <div className="space-y-6">
      {/* ── User Message Bubble ───────────────────────── */}
      {turn.userMessage && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex justify-end group/usermsg"
        >
          <div className="flex max-w-2xl gap-3 flex-row-reverse text-right">
            <div className="shrink-0 w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm mt-0.5">
              <User className="w-4 h-4" />
            </div>

            <div className="space-y-1 min-w-0 text-left">
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
                      className="px-3 py-1 rounded-lg text-xs font-semibold text-slate-400 hover:text-white bg-white/[0.05] border border-white/[0.08] transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-all shadow-sm cursor-pointer"
                    >
                      Resubmit
                    </button>
                  </div>
                </form>
              ) : (
                <div className="relative group inline-block">
                  <div className="bg-[#171C2B] border border-white/[0.08] rounded-2xl px-4 py-3 text-slate-100 text-sm leading-relaxed shadow-sm select-text">
                    <MarkdownRenderer content={turn.userMessage.content || ''} />
                  </div>
                  
                  {/* Edit prompt button */}
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="absolute -left-7 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-white rounded-md hover:bg-white/[0.08] transition-all cursor-pointer"
                    title="Edit prompt"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Unified Single Assistant Message Bubble ───────────────────────── */}
      {hasAssistantContent && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex justify-start w-full"
        >
          <div className="flex w-full max-w-3xl gap-3.5 flex-row">
            {/* Avatar */}
            <div className="shrink-0 w-8 h-8 rounded-xl bg-[#151926] border border-white/[0.08] text-indigo-400 flex items-center justify-center mt-0.5 shadow-sm">
              <Sparkles className="w-4 h-4 text-indigo-400" />
            </div>

            {/* Content Area (Everything unified in ONE single bubble) */}
            <div className="flex-1 space-y-3.5 min-w-0 text-left">
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

              {/* 1. Thoughts Block (Collapsible) */}
              {thoughtsCombined && (
                <ThinkingBlock content={thoughtsCombined} />
              )}

              {/* 2. Tool Calls Stepper (Unified Group) */}
              {turn.toolCalls.length > 0 && (
                <ToolCallsGroup toolCalls={turn.toolCalls} />
              )}

              {/* 3. Final Response Markdown */}
              {turn.finalAnswer && (
                <div className="text-sm leading-relaxed text-slate-200 select-text">
                  <MarkdownRenderer content={turn.finalAnswer} />
                </div>
              )}

              {/* 4. Generative UI component (if present) */}
              {turn.genUIPayload && (
                <GenUIRenderer payload={turn.genUIPayload} />
              )}

              {/* 5. Metrics & Actions Footer */}
              <div className="flex items-center justify-between border-t border-white/[0.06] pt-2.5 mt-2 select-none text-[11px]">
                {/* Cost & Tokens Badge */}
                <div className="flex items-center gap-2 text-slate-400 font-mono">
                  <span className={`flex items-center gap-1 px-2 py-0.5 rounded-md border ${
                    turn.isFree 
                      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' 
                      : 'bg-white/[0.05] text-slate-300 border-white/[0.08]'
                  }`}>
                    <Coins className="w-3 h-3 text-slate-400" />
                    <span>{turn.formattedCost}</span>
                  </span>

                  <span className="text-slate-500 flex items-center gap-1">
                    <Cpu className="w-3 h-3 text-slate-500" />
                    {formatTokenCount(turn.totalTokens)} tokens
                  </span>

                  {turn.toolCalls.length > 0 && (
                    <span className="text-slate-500 flex items-center gap-1">
                      <Layers className="w-3 h-3 text-slate-500" />
                      {turn.toolCalls.length} {turn.toolCalls.length === 1 ? 'action' : 'actions'}
                    </span>
                  )}
                </div>

                {/* Actions (Copy / Retry) */}
                <div className="flex items-center gap-1.5 opacity-80 hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white px-2 py-1 rounded-md hover:bg-white/[0.06] transition-colors cursor-pointer"
                    title="Copy response"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>

                  {isLast && !isStreaming && (
                    <button
                      type="button"
                      onClick={handleRetry}
                      className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white px-2 py-1 rounded-md hover:bg-white/[0.06] transition-colors cursor-pointer"
                      title="Retry turn"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Retry</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default ConversationTurnItem;
