// src/components/ExecutionTimeline.tsx
import React from 'react';
import { 
  Play, 
  Terminal, 
  Globe, 
  FolderGit2, 
  BrainCircuit, 
  CheckCircle,
  HelpCircle,
  Loader2
} from 'lucide-react';
import type { ToolLog } from '../services/api';
import { useChatStore } from '../store/useChatStore';

interface ExecutionTimelineProps {
  logs: ToolLog[];
}

export const ExecutionTimeline: React.FC<ExecutionTimelineProps> = ({ logs }) => {
  const { isStreaming, streamingSteps, streamingThoughts } = useChatStore();

  const getToolIcon = (toolName: string) => {
    switch (toolName) {
      case 'run_code':
        return <Terminal className="w-3.5 h-3.5" />;
      case 'browse_web':
        return <Globe className="w-3.5 h-3.5" />;
      case 'list_skills':
      case 'get_skill':
      case 'save_skill':
        return <FolderGit2 className="w-3.5 h-3.5" />;
      default:
        return <HelpCircle className="w-3.5 h-3.5" />;
    }
  };

  const getToolColor = (toolName: string) => {
    switch (toolName) {
      case 'run_code':
        return 'text-primary bg-primary/10 border-primary/20';
      case 'browse_web':
        return 'text-secondary bg-secondary/10 border-secondary/20';
      case 'list_skills':
      case 'get_skill':
      case 'save_skill':
        return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
      default:
        return 'text-text-muted bg-card border-border-dark';
    }
  };

  return (
    <div className="relative pl-4 border-l border-border-dark/80 ml-3 py-2 space-y-6 text-left select-none">
      {/* Starting point */}
      <div className="relative">
        <span className="absolute -left-[25px] top-0 w-4.5 h-4.5 rounded-full bg-gradient-to-tr from-primary to-secondary flex items-center justify-center text-white ring-4 ring-background">
          <Play className="w-2.5 h-2.5 translate-x-[0.5px]" />
        </span>
        <div className="pl-2">
          <span className="text-[10px] text-text-muted font-semibold uppercase tracking-wider">Goal Initiated</span>
          <p className="text-[11px] text-text-main font-medium mt-0.5">Orchestrator launched session thread</p>
        </div>
      </div>

      {/* Historical execution steps */}
      {logs.map((log, idx) => (
        <div key={idx} className="relative group">
          {/* Node marker */}
          <span className={`absolute -left-[25px] top-0.5 w-4 h-4 rounded-full border flex items-center justify-center ring-4 ring-background ${getToolColor(log.tool)}`}>
            {getToolIcon(log.tool)}
          </span>
          
          <div className="pl-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Step {log.step}
              </span>
              <span className="w-1 h-1 rounded-full bg-border-dark" />
              <span className="text-[11px] font-bold text-text-main font-heading capitalize">
                {log.tool.replace('_', ' ')}
              </span>
              {log.ts && (
                <>
                  <span className="w-1 h-1 rounded-full bg-border-dark" />
                  <span className="text-[9px] text-text-muted/60 font-mono">
                    {new Date(log.ts).toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    })}
                  </span>
                </>
              )}
            </div>

            {/* Parameter summary */}
            <div className="mt-1 bg-card/30 hover:bg-card/50 border border-border-dark/40 rounded-lg p-2 transition-all duration-200">
              <p className="text-[10px] text-text-muted font-mono break-all leading-normal">
                {log.tool === 'run_code' && log.args?.code
                  ? `code: ${log.args.code.split('\n')[0]}...`
                  : log.tool === 'browse_web' && log.args?.url
                  ? `navigate: ${log.args.url}`
                  : JSON.stringify(log.args)}
              </p>
              
              {/* Tool Execution completion status */}
              <div className="flex items-center gap-1.5 mt-1.5 text-[9px] text-emerald-400 font-semibold uppercase font-mono">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                <span>Node resolved successfully</span>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Live running step if streaming */}
      {isStreaming && (
        <div className="relative animate-pulse">
          {/* Node marker pulsing */}
          <span className="absolute -left-[26px] top-0.5 w-4.5 h-4.5 rounded-full border border-primary/40 bg-primary/10 flex items-center justify-center ring-4 ring-background text-primary shadow-neon-blue">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
          </span>
          
          <div className="pl-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-primary uppercase tracking-wider font-heading">
                Step {streamingSteps?.current || 1}
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              <span className="text-[11px] font-bold text-text-main font-heading animate-pulse">
                LLM Thinking Loop
              </span>
            </div>
            
            <div className="mt-1.5 bg-primary/[0.02] border border-primary/25 rounded-lg p-2.5">
              <p className="text-[10px] text-text-muted leading-relaxed">
                {streamingThoughts || 'Analyzing feedback and planning agent actions...'}
              </p>
              <div className="flex items-center gap-1.5 mt-2 text-[9px] text-primary font-bold tracking-wide uppercase font-mono">
                <BrainCircuit className="w-3.5 h-3.5 text-primary" />
                <span>Generating workflow step...</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExecutionTimeline;
