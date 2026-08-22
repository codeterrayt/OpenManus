// frontend/src/utils/modelCapabilities.ts

export type ThinkingType = 'claude_budget' | 'openai_effort' | 'budget_tokens' | 'general_budget';

export interface ThinkingPreset {
  id: string;
  label: string;
  shortLabel: string;
  value: number | string; // budget tokens (number) or effort level (string)
  description: string;
}

export interface ModelThinkingCapability {
  supportsThinking: boolean;
  type: ThinkingType;
  providerType: 'claude' | 'openai' | 'deepseek' | 'local' | 'general';
  title: string;
  description: string;
  defaultPresetId: string;
  defaultBudget?: number;
  defaultEffort?: string;
  presets: ThinkingPreset[];
  minBudget?: number;
  maxBudget?: number;
  stepBudget?: number;
}

/**
 * Detects the thinking/reasoning capabilities and limits of any model ID.
 * Returns appropriate thinking controls for Claude (1k-64k), OpenAI (low/med/high),
 * DeepSeek-R1 (1k-32k), and General/Ollama models (1k-64k).
 */
export function detectModelCapabilities(modelId: string): ModelThinkingCapability {
  const id = (modelId || '').toLowerCase();

  // 1. Claude / Anthropic Thinking Models (7-level limits + custom budget up to 64K)
  if (id.includes('claude') || id.includes('anthropic')) {
    return {
      supportsThinking: true,
      type: 'claude_budget',
      providerType: 'claude',
      title: 'Claude Extended Thinking',
      description: 'Allocate reasoning token budget for Claude to explore multiple hypotheses, verify logic, and self-correct.',
      defaultPresetId: '4k',
      defaultBudget: 4096,
      minBudget: 1024,
      maxBudget: 64000,
      stepBudget: 1024,
      presets: [
        { id: 'off', label: 'Off', shortLabel: 'Off', value: 0, description: 'Direct response without extended thinking' },
        { id: '1k', label: '1K (Quick)', shortLabel: '1K', value: 1024, description: 'Light thinking for straightforward queries' },
        { id: '2k', label: '2K (Low)', shortLabel: '2K', value: 2048, description: 'Basic chain-of-thought verification' },
        { id: '4k', label: '4K (Balanced)', shortLabel: '4K', value: 4096, description: 'Standard balance of depth and speed (Recommended)' },
        { id: '8k', label: '8K (High)', shortLabel: '8K', value: 8192, description: 'Deep reasoning for complex code & architecture' },
        { id: '16k', label: '16K (Deep)', shortLabel: '16K', value: 16384, description: 'Extensive multi-layered analysis' },
        { id: '32k', label: '32K (Maximum)', shortLabel: '32K', value: 32768, description: 'Thorough system-level architecture planning' },
        { id: '64k', label: '64K (Exhaustive)', shortLabel: '64K', value: 64000, description: 'Maximum thinking token capacity' }
      ]
    };
  }

  // 2. OpenAI Reasoning Models (o1, o3, o3-mini, o4, etc.)
  if (
    id.startsWith('o1') || 
    id.startsWith('o3') || 
    id.startsWith('o4') || 
    id.includes('/o1') || 
    id.includes('/o3') || 
    id.includes('/o4') || 
    id.includes('openai/o') ||
    id.includes('gpt-5')
  ) {
    return {
      supportsThinking: true,
      type: 'openai_effort',
      providerType: 'openai',
      title: 'OpenAI Reasoning Effort',
      description: 'Controls the compute effort allocated to internal reasoning tokens before generating an answer.',
      defaultPresetId: 'medium',
      defaultEffort: 'medium',
      presets: [
        { id: 'low', label: 'Low Effort', shortLabel: 'Low', value: 'low', description: 'Fast reasoning with minimal token overhead' },
        { id: 'medium', label: 'Medium Effort', shortLabel: 'Medium', value: 'medium', description: 'Balanced reasoning for most problem-solving' },
        { id: 'high', label: 'High Effort', shortLabel: 'High', value: 'high', description: 'Maximum compute for complex coding & math' }
      ]
    };
  }

  // 3. DeepSeek R1 / QwQ / Open-Source Reasoning Models
  if (
    id.includes('r1') || 
    id.includes('deepseek-reasoner') || 
    id.includes('qwq') || 
    id.includes('reasoning') || 
    id.includes('think')
  ) {
    return {
      supportsThinking: true,
      type: 'budget_tokens',
      providerType: 'deepseek',
      title: 'DeepSeek / Open Reasoning Budget',
      description: 'Controls internal chain-of-thought depth and token budget for open-source reasoning models.',
      defaultPresetId: '4k',
      defaultBudget: 4096,
      minBudget: 1024,
      maxBudget: 32768,
      stepBudget: 1024,
      presets: [
        { id: 'off', label: 'Off', shortLabel: 'Off', value: 0, description: 'Standard output without extra thinking budget' },
        { id: '1k', label: '1K (Quick)', shortLabel: '1K', value: 1024, description: 'Quick step-by-step reasoning' },
        { id: '4k', label: '4K (Standard)', shortLabel: '4K', value: 4096, description: 'Balanced reasoning capacity' },
        { id: '8k', label: '8K (High)', shortLabel: '8K', value: 8192, description: 'Deep exploration for difficult tasks' },
        { id: '16k', label: '16K (Deep)', shortLabel: '16K', value: 16384, description: 'Maximum reasoning depth' }
      ]
    };
  }

  // 4. General / Ollama / Other Models (Gemma, Llama, Qwen, Mistral, etc.)
  const isLocal = id.includes(':') || !id.includes('/');
  return {
    supportsThinking: true,
    type: 'general_budget',
    providerType: isLocal ? 'local' : 'general',
    title: 'Model Thinking & Planning Depth',
    description: 'Configures chain-of-thought depth and reasoning tokens allocated for problem-solving.',
    defaultPresetId: '4k',
    defaultBudget: 4096,
    minBudget: 1024,
    maxBudget: 64000,
    stepBudget: 1024,
    presets: [
      { id: 'off', label: 'Off', shortLabel: 'Off', value: 0, description: 'Direct response without extensive reasoning' },
      { id: '1k', label: '1K (Quick)', shortLabel: '1K', value: 1024, description: 'Light planning before taking actions' },
      { id: '2k', label: '2K (Low)', shortLabel: '2K', value: 2048, description: 'Step-by-step reasoning' },
      { id: '4k', label: '4K (Balanced)', shortLabel: '4K', value: 4096, description: 'Balanced reasoning & self-correction (Recommended)' },
      { id: '8k', label: '8K (High)', shortLabel: '8K', value: 8192, description: 'Thorough planning for complex coding tasks' },
      { id: '16k', label: '16K (Deep)', shortLabel: '16K', value: 16384, description: 'Deep architectural & math analysis' },
      { id: '32k', label: '32K (Maximum)', shortLabel: '32K', value: 32768, description: 'Maximum reasoning depth' },
      { id: '64k', label: '64K (Exhaustive)', shortLabel: '64K', value: 64000, description: 'Exhaustive exploration & validation' }
    ]
  };
}
