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
  /**
   * Whether this model accepts image input. `false` = proven text-only (block
   * attachments); `true`/`undefined` = allow. Distinct from the `'vision'`
   * capability tag above, which is incomplete/unreliable today (e.g. multimodal
   * models missing the tag) — only `supportsImages` gates the attach guard.
   * Scoped to the two MiMo models for now; full audit in PAN-1685.
   */
  supportsImages?: boolean;
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
      { id: 'claude-fable-5' as ModelId, name: 'Claude Fable 5', icon: Gem, tier: 'premium', costPer1MTokens: 90, capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Mythos-class flagship — long-horizon autonomous work, low→max effort. ~2× Opus pricing ($10 in / $50 out).' },
      { id: 'claude-opus-4-8' as ModelId, name: 'Claude Opus 4.8', icon: Gem, tier: 'premium', costPer1MTokens: 45, capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Most capable — current flagship, xhigh/max effort, deepest reasoning' },
      { id: 'claude-opus-4-7' as ModelId, name: 'Claude Opus 4.7', icon: Gem, tier: 'premium', costPer1MTokens: 45, capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Previous flagship — xhigh/max effort, deepest reasoning' },
      { id: 'claude-opus-4-6' as ModelId, name: 'Claude Opus 4.6', icon: Gem, tier: 'premium', costPer1MTokens: 45, capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Previous Opus, strong reasoning and planning' },
      { id: 'claude-sonnet-5' as ModelId, name: 'Claude Sonnet 5', icon: Sparkles, tier: 'balanced', costPer1MTokens: 6, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'Current Sonnet — 1M context, intro pricing through Aug 31, 2026' },
      { id: 'claude-sonnet-4-6' as ModelId, name: 'Claude Sonnet 4.6', icon: Sparkles, tier: 'balanced', costPer1MTokens: 9, capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Previous Sonnet — fast, capable, great for implementation' },
      { id: 'claude-haiku-4-5' as ModelId, name: 'Claude Haiku 4.5', icon: Zap, tier: 'fast', costPer1MTokens: 1, capabilities: ['fast', 'cost-efficient', 'code'], description: 'Fastest, ideal for simple tasks' },
    ],
  },
  openai: {
    name: 'OpenAI',
    // Trimmed 2026-05-23 to match OpenAI's Codex CLI published list.
    // Dropped: gpt-5.5-pro, gpt-5.4-pro, gpt-5.5-mini, gpt-5.5-nano,
    // gpt-5.4-nano, o3, o4-mini, gpt-4o, gpt-4o-mini.
    // Saved configs referencing dropped IDs are migrated by MODEL_DEPRECATIONS
    // in src/lib/model-capabilities.ts and warned-on by settings-api.ts.
    models: [
      { id: 'gpt-5.5' as ModelId, name: 'GPT-5.5', icon: Gem, tier: 'premium', costPer1MTokens: 17.5, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'OpenAI flagship (April 2026). 1.05M context, $5 in / $30 out per 1M.' },
      { id: 'gpt-5.4' as ModelId, name: 'GPT-5.4', icon: Sparkles, tier: 'balanced', costPer1MTokens: 8.75, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'Balanced GPT-5.4. 1.05M context, strong coding.' },
      { id: 'gpt-5.4-mini' as ModelId, name: 'GPT-5.4 Mini', icon: FlaskConical, tier: 'fast', costPer1MTokens: 2.625, capabilities: ['fast', 'cost-efficient', 'code'], description: 'Fast and efficient. 400K context. $0.75 in / $4.50 out.' },
      { id: 'gpt-5.3-codex' as ModelId, name: 'GPT-5.3 Codex', icon: Gem, tier: 'premium', costPer1MTokens: 7.875, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Coding-optimized (Feb 2026). 400K context, 85% SWE-Bench Verified. $1.75 in / $14 out.' },
      { id: 'gpt-5.3-codex-spark' as ModelId, name: 'GPT-5.3 Codex Spark', icon: Zap, tier: 'fast', costPer1MTokens: 7.875, capabilities: ['fast', 'code', 'cost-efficient'], description: 'Ultra-fast coder (1000+ tok/s). ChatGPT-Pro-only research preview; routes via Codex CLI subscription auth — not generally available via raw API.' },
      { id: 'gpt-5.2' as ModelId, name: 'GPT-5.2', icon: Sparkles, tier: 'balanced', costPer1MTokens: 7.875, capabilities: ['reasoning', 'code', 'agentic'], description: 'Long-running agents (Dec 2025). 80% SWE-Bench, 92.4% GPQA-Diamond. Reserve for deep deliberation, not high-frequency polling.' },
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
      { id: 'kimi-k2.7-code' as ModelId, name: 'Kimi K2.7 Code', icon: Layers, tier: 'premium', costPer1MTokens: 2.5, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Kimi coding-first flagship (June 2026). 1T MoE, multimodal, 262K context.' },
      { id: 'kimi-k2.6' as ModelId, name: 'Kimi K2.6', icon: Layers, tier: 'premium', costPer1MTokens: 1.6, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Kimi smartest model (April 2026). Native multimodal, superior agentic coding.' },
      { id: 'kimi-k2.5' as ModelId, name: 'Kimi K2.5', icon: Layers, tier: 'premium', costPer1MTokens: 1.6, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Best open-source coding, 256K context, 76.8% SWE-bench' },
      { id: 'K2.6-code-preview' as ModelId, name: 'K2.6-code-preview', icon: FlaskConical, tier: 'premium', costPer1MTokens: 1.6, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Kimi coding preview model.' },
    ],
  },
  zai: {
    name: 'Zhipu (GLM)',
    models: [
      { id: 'glm-5.2' as ModelId, name: 'GLM-5.2', icon: Network, tier: 'premium', costPer1MTokens: 2.9, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Z.AI flagship, 1M context, high/max effort, strong agentic coding. Text-only (vision is a separate model line).' },
      { id: 'glm-5.1' as ModelId, name: 'GLM-5.1', icon: Network, tier: 'premium', costPer1MTokens: 2.9, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Previous Z.AI flagship, 200K context, strong agentic coding. Text-only (vision is a separate model line).' },
    ],
  },
  minimax: {
    name: 'MiniMax',
    models: [
      { id: 'MiniMax-M3' as ModelId, name: 'M3', icon: Gem, tier: 'premium', costPer1MTokens: 1.5, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'MSA architecture, 1M context, top-tier coding, native multimodal' },
      { id: 'minimax-m2.7-highspeed' as ModelId, name: 'M2.7 Highspeed', icon: Zap, tier: 'premium', costPer1MTokens: 1.5, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: '56.22% SWE-Pro, 100 tps, 204K context, $0.06/M blended' },
      { id: 'minimax-m2.7' as ModelId, name: 'M2.7', icon: Layers, tier: 'balanced', costPer1MTokens: 1.5, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: '56.22% SWE-Pro, 10B active params, 204K context' },
    ],
  },
  mimo: {
    name: 'Xiaomi MiMo',
    models: [
      { id: 'mimo-v2.5-pro' as ModelId, name: 'MiMo V2.5 Pro', icon: Layers, tier: 'premium', costPer1MTokens: 2, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], supportsImages: false, description: 'Flagship reasoning model, 1M context, enhanced agent efficiency. Text-only on Token-Plan endpoints.' },
      { id: 'mimo-v2.5' as ModelId, name: 'MiMo V2.5', icon: Zap, tier: 'balanced', costPer1MTokens: 1, capabilities: ['code', 'agentic', 'fast', 'vision'], supportsImages: true, description: 'Multimodal model, 262K context, strong agentic coding' },
    ],
  },
  nous: {
    name: 'Nous Portal',
    models: [
      { id: 'qwen/qwen3.6-plus' as ModelId, name: 'Qwen 3.6 Plus', icon: Network, tier: 'premium', costPer1MTokens: 0, capabilities: ['reasoning', 'code', 'agentic', 'large-context', 'cost-efficient'], description: 'Qwen 3.6 Plus via Nous Portal, currently free with 1M context.' },
    ],
  },
  dashscope: {
    name: 'Alibaba DashScope',
    models: [
      { id: 'qwen3-max' as ModelId, name: 'Qwen3 Max', icon: Gem, tier: 'premium', costPer1MTokens: 0, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'DashScope flagship reasoning model.' },
      { id: 'qwen3-coder-plus' as ModelId, name: 'Qwen3 Coder Plus', icon: FlaskConical, tier: 'premium', costPer1MTokens: 0, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'DashScope coding-specialist model.' },
      { id: 'qwen3-plus' as ModelId, name: 'Qwen3 Plus', icon: Sparkles, tier: 'balanced', costPer1MTokens: 0, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'DashScope balanced Qwen3 model.' },
      { id: 'qwen3.7-max' as ModelId, name: 'Qwen3.7 Max', icon: Gem, tier: 'premium', costPer1MTokens: 0, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'DashScope flagship Qwen3.7 Max model.' },
    ],
  },
  xai: {
    name: 'xAI (Grok)',
    models: [
      { id: 'grok-build-0.1' as ModelId, name: 'Grok Build 0.1', icon: Zap, tier: 'premium', costPer1MTokens: 1.5, capabilities: ['reasoning', 'code', 'agentic', 'large-context', 'vision'], description: 'xAI\'s agentic coding model (May 2026). 256K context, reasoning always active.' },
    ],
  },
};

/** Look up a model definition by id across all providers. */
export function findModelDef(modelId: string): ModelDef | undefined {
  for (const provider of Object.values(MODELS_BY_PROVIDER)) {
    const def = provider.models.find((m) => m.id === modelId);
    if (def) return def;
  }
  return undefined;
}

/**
 * Whether image attachments may be sent to a model. Permissive: returns `false`
 * ONLY for models flagged `supportsImages: false` (proven text-only, e.g.
 * mimo-v2.5-pro); every other model — including unflagged ones — is allowed, so
 * the provider stays the final authority. Mirrors `modelSupportsImagesSync` in
 * src/lib/model-capabilities.ts. PAN-1685.
 */
export function modelSupportsImages(modelId: string): boolean {
  return findModelDef(modelId)?.supportsImages !== false;
}

export type OpenRouterFavoriteModel = {
  id: string;
  name: string;
  promptCostPer1M: number;
  completionCostPer1M: number;
  contextLength: number;
  supportsThinking: boolean;
  category: string;
};
