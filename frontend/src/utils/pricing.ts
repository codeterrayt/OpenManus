// frontend/src/utils/pricing.ts

export interface ModelPricing {
  inputPerMillion: number;  // $ per 1,000,000 prompt tokens
  outputPerMillion: number; // $ per 1,000,000 completion tokens
  isFree?: boolean;
}

export const MODEL_PRICING_TABLE: Record<string, ModelPricing> = {
  // Claude / Anthropic
  'claude-3-7-sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-3-7-sonnet-latest': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-3-5-sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-3-5-sonnet-latest': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-3-5-haiku': { inputPerMillion: 0.8, outputPerMillion: 4.0 },
  'claude-3-opus': { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  'claude-opus-4-8': { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  'claude-opus-5': { inputPerMillion: 15.0, outputPerMillion: 75.0 },

  // OpenAI & Router Models (Sol, Terra, Luna)
  'gpt-5.6-sol': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'gpt-5.6-terra': { inputPerMillion: 2.5, outputPerMillion: 12.0 },
  'gpt-5.6-luna': { inputPerMillion: 1.5, outputPerMillion: 6.0 },
  'gpt-5.5-pro': { inputPerMillion: 30.0, outputPerMillion: 180.0 },
  'gpt-5.5-flagship': { inputPerMillion: 5.0, outputPerMillion: 30.0 },
  'gpt-5.4-standard': { inputPerMillion: 2.5, outputPerMillion: 15.0 },
  'gpt-5.4-terra': { inputPerMillion: 2.5, outputPerMillion: 15.0 },
  'gpt-5.4-mini': { inputPerMillion: 0.75, outputPerMillion: 4.5 },
  'gpt-5.4-nano': { inputPerMillion: 0.20, outputPerMillion: 1.25 },
  'gpt-5.2-luna': { inputPerMillion: 0.50, outputPerMillion: 2.0 },
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'o1': { inputPerMillion: 15.0, outputPerMillion: 60.0 },
  'o1-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  'o3-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  'o4-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },

  // DeepSeek
  'deepseek-chat': { inputPerMillion: 0.14, outputPerMillion: 0.28 },
  'deepseek-reasoner': { inputPerMillion: 0.55, outputPerMillion: 2.19 },
  'deepseek-r1': { inputPerMillion: 0.55, outputPerMillion: 2.19 },

  // Groq Free Tier
  'llama-3.3-70b-versatile': { inputPerMillion: 0, outputPerMillion: 0, isFree: true },
  'llama-3.1-8b-instant': { inputPerMillion: 0, outputPerMillion: 0, isFree: true },
  'gemma2-9b-it': { inputPerMillion: 0, outputPerMillion: 0, isFree: true },
};

export function getModelPricing(modelName: string): ModelPricing {
  if (!modelName) return { inputPerMillion: 0, outputPerMillion: 0, isFree: true };
  const lower = modelName.toLowerCase();
  
  for (const [key, pricing] of Object.entries(MODEL_PRICING_TABLE)) {
    if (lower.includes(key)) return pricing;
  }

  if (lower.startsWith('gpt-4')) return { inputPerMillion: 2.5, outputPerMillion: 10.0 };
  if (lower.startsWith('o1') || lower.startsWith('o3')) return { inputPerMillion: 1.1, outputPerMillion: 4.4 };
  if (lower.includes('claude')) return { inputPerMillion: 3.0, outputPerMillion: 15.0 };
  if (lower.includes('deepseek')) return { inputPerMillion: 0.55, outputPerMillion: 2.19 };
  if (lower.includes(':') || (!lower.includes('/') && !lower.startsWith('gpt') && !lower.startsWith('claude') && !lower.startsWith('o1') && !lower.startsWith('o3'))) {
    return { inputPerMillion: 0, outputPerMillion: 0, isFree: true }; // local ollama
  }

  return { inputPerMillion: 1.0, outputPerMillion: 3.0 }; // generic fallback
}

export function calculateCost(promptTokens: number, completionTokens: number, modelName: string): { cost: number; formattedCost: string; isFree: boolean } {
  const pricing = getModelPricing(modelName);
  if (pricing.isFree || (pricing.inputPerMillion === 0 && pricing.outputPerMillion === 0)) {
    return { cost: 0, formattedCost: 'Free (Local)', isFree: true };
  }

  const inputCost = (promptTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (completionTokens / 1_000_000) * pricing.outputPerMillion;
  const totalCost = inputCost + outputCost;

  let formattedCost = `$${totalCost.toFixed(4)}`;
  if (totalCost < 0.0001 && totalCost > 0) {
    formattedCost = `$${totalCost.toFixed(5)}`;
  }

  return { cost: totalCost, formattedCost, isFree: false };
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return String(tokens);
}
