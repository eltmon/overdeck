import { type LucideIcon, Gem, Sparkles, Zap, FlaskConical, Layers, Network } from 'lucide-react';
import type { ModelId } from './types';

export type Capability = 'reasoning' | 'code' | 'vision' | 'fast' | 'cost-efficient' | 'large-context' | 'complex-math' | 'efficiency' | 'agentic';

export interface ModelDef {
  id: ModelId;
  name: string;
  icon: LucideIcon;
  tier?: 'premium' | 'balanced' | 'fast';
  capabilities: Capability[];
  description?: string;
  /** Blended $/1M tokens for cost-awareness badges/tooltips. */
  costPer1MTokens?: number;
}

interface ProviderDef {
  name: string;
  models: ModelDef[];
}

/**
 * Models grouped by provider.
 *
 * TODO: Consolidate to a single source of truth by fetching from
 * /api/settings/available-models and deriving tier/capabilities from backend
 * skill scores. This local catalog currently powers conversation/provider model
 * selects after the legacy AgentCards UI removal.
 */
export const MODELS_BY_PROVIDER: Record<string, ProviderDef> = {
  anthropic: {
    name: 'Anthropic',
    models: [
      { id: 'claude-opus-4-7' as ModelId, name: 'Claude Opus 4.7', icon: Gem, tier: 'premium', costPer1MTokens: 45, capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Most capable — xhigh/max effort, deepest reasoning' },
      { id: 'claude-opus-4-6' as ModelId, name: 'Claude Opus 4.6', icon: Gem, tier: 'premium', costPer1MTokens: 45, capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Previous Opus, strong reasoning and planning' },
      { id: 'claude-sonnet-4-6' as ModelId, name: 'Claude Sonnet 4.6', icon: Sparkles, tier: 'balanced', costPer1MTokens: 9, capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Latest Sonnet — fast, capable, great for implementation' },
      { id: 'claude-haiku-4-5' as ModelId, name: 'Claude Haiku 4.5', icon: Zap, tier: 'fast', costPer1MTokens: 1, capabilities: ['fast', 'cost-efficient', 'code'], description: 'Fastest, ideal for simple tasks' },
    ],
  },
  openai: {
    name: 'OpenAI',
    models: [
      { id: 'gpt-5.5-pro' as ModelId, name: 'GPT-5.5 Pro', icon: Gem, tier: 'premium', costPer1MTokens: 119, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'Most advanced GPT-5.5 model. EXTREMELY expensive — only for hardest problems.' },
      { id: 'gpt-5.5' as ModelId, name: 'GPT-5.5', icon: Gem, tier: 'premium', costPer1MTokens: 10.5, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'Latest OpenAI flagship. Enhanced reasoning and coding.' },
      { id: 'gpt-5.5-mini' as ModelId, name: 'GPT-5.5 Mini', icon: FlaskConical, tier: 'fast', costPer1MTokens: 1.25, capabilities: ['fast', 'cost-efficient', 'code'], description: 'Fast GPT-5.5 variant.' },
      { id: 'gpt-5.5-nano' as ModelId, name: 'GPT-5.5 Nano', icon: Zap, tier: 'fast', costPer1MTokens: 0.875, capabilities: ['fast', 'cost-efficient'], description: 'Most efficient GPT-5.5 variant.' },
      { id: 'gpt-5.4-pro' as ModelId, name: 'GPT-5.4 Pro', icon: Gem, tier: 'premium', costPer1MTokens: 105, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'Most advanced GPT-5.4 model. Pro subscribers only.' },
      { id: 'gpt-5.4' as ModelId, name: 'GPT-5.4', icon: Sparkles, tier: 'balanced', costPer1MTokens: 8.75, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'OpenAI flagship. 1.05M context, strong coding.' },
      { id: 'gpt-5.4-mini' as ModelId, name: 'GPT-5.4 Mini', icon: FlaskConical, tier: 'fast', costPer1MTokens: 1, capabilities: ['fast', 'cost-efficient', 'code'], description: 'Fast and efficient. 400K context.' },
      { id: 'gpt-5.4-nano' as ModelId, name: 'GPT-5.4 Nano', icon: Zap, tier: 'fast', costPer1MTokens: 0.7, capabilities: ['fast', 'cost-efficient'], description: 'Fastest GPT-5.4 model. API-only.' },
      { id: 'o3' as ModelId, name: 'O3', icon: Gem, tier: 'premium', costPer1MTokens: 5, capabilities: ['reasoning', 'code', 'agentic'], description: 'Deep reasoning. Best for debugging and complex analysis.' },
      { id: 'o4-mini' as ModelId, name: 'O4 Mini', icon: Sparkles, tier: 'balanced', costPer1MTokens: 2.75, capabilities: ['reasoning', 'code', 'fast'], description: 'Compact reasoning model. Fast, cost-efficient.' },
      { id: 'gpt-4o' as ModelId, name: 'GPT-4o', icon: FlaskConical, tier: 'balanced', costPer1MTokens: 7.5, capabilities: ['reasoning', 'code', 'vision'], description: 'Versatile multimodal model' },
      { id: 'gpt-4o-mini' as ModelId, name: 'GPT-4o Mini', icon: Zap, tier: 'fast', costPer1MTokens: 0.6, capabilities: ['fast', 'cost-efficient'], description: 'Budget option for simple tasks' },
    ],
  },
  google: {
    name: 'Google',
    models: [
      { id: 'gemini-3.1-pro-preview' as ModelId, name: 'Gemini 3.1 Pro', icon: Layers, tier: 'premium', costPer1MTokens: 7, capabilities: ['reasoning', 'large-context', 'code'], description: 'Google flagship, 1M context, strong agentic coding' },
      { id: 'gemini-3.1-flash-lite-preview' as ModelId, name: 'Gemini 3.1 Flash Lite', icon: Zap, tier: 'fast', costPer1MTokens: 0.9, capabilities: ['fast', 'cost-efficient', 'large-context'], description: 'Most cost-efficient Google model' },
    ],
  },
  kimi: {
    name: 'Kimi (Moonshot)',
    models: [
      { id: 'kimi-k2.6' as ModelId, name: 'Kimi K2.6', icon: Layers, tier: 'premium', costPer1MTokens: 1.6, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Kimi smartest model (April 2026). Native multimodal, superior agentic coding.' },
      { id: 'kimi-k2.5' as ModelId, name: 'Kimi K2.5', icon: Layers, tier: 'premium', costPer1MTokens: 1.6, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Best open-source coding, 256K context, 76.8% SWE-bench' },
      { id: 'K2.6-code-preview' as ModelId, name: 'K2.6-code-preview', icon: FlaskConical, tier: 'premium', costPer1MTokens: 1.6, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Kimi coding preview model.' },
    ],
  },
  zai: {
    name: 'Zhipu (GLM)',
    models: [
      { id: 'glm-5.1' as ModelId, name: 'GLM-5.1', icon: Network, tier: 'premium', costPer1MTokens: 2, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Z.AI flagship, 128K context, strong agentic coding' },
    ],
  },
  minimax: {
    name: 'MiniMax',
    models: [
      { id: 'minimax-m2.7-highspeed' as ModelId, name: 'M2.7 Highspeed', icon: Zap, tier: 'premium', costPer1MTokens: 1.5, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: '56.22% SWE-Pro, 100 tps, 204K context, $0.06/M blended' },
      { id: 'minimax-m2.7' as ModelId, name: 'M2.7', icon: Layers, tier: 'balanced', costPer1MTokens: 1.5, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: '56.22% SWE-Pro, 10B active params, 204K context' },
    ],
  },
  mimo: {
    name: 'Xiaomi MiMo',
    models: [
      { id: 'mimo-v2.5-pro' as ModelId, name: 'MiMo V2.5 Pro', icon: Layers, tier: 'premium', costPer1MTokens: 2, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Flagship reasoning model, 1M context, enhanced agent efficiency' },
      { id: 'mimo-v2.5' as ModelId, name: 'MiMo V2.5', icon: Zap, tier: 'balanced', costPer1MTokens: 1, capabilities: ['code', 'agentic', 'fast'], description: 'Multimodal model, 262K context, strong agentic coding' },
    ],
  },
};

export type OpenRouterFavoriteModel = {
  id: string;
  name: string;
  promptCostPer1M: number;
  completionCostPer1M: number;
  contextLength: number;
  supportsThinking: boolean;
  category: string;
};
