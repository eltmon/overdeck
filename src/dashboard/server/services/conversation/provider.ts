import { type AIProvider } from '../../../../lib/cost.js';

/** Detect AI provider from model name */
export function providerFromModel(model: string): AIProvider {
  if (model.includes('gpt')) return 'openai';
  if (model.includes('gemini')) return 'google';
  if (model.includes('kimi') || model.toLowerCase().startsWith('minimax')) return 'custom';
  return 'anthropic';
}
