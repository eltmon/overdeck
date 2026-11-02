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
   * Set only for audited models (e.g. glm-5.3); full audit in PAN-1685.
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
  meta: {
    name: 'Meta (Muse)',
    models: [
      { id: 'muse-wonder-1.0', name: 'Muse Wonder 1.0', icon: Sparkles, costPer1MTokens: 12, capabilities: ['code', 'reasoning', 'large-context'], description: 'Frontier model: $4.00 input / $0.20 cached input / $20.00 output per million tokens.' },
      { id: 'muse-spark-1.3', name: 'Muse Spark 1.3 Standard', icon: Sparkles, costPer1MTokens: 2.75, capabilities: ['code', 'reasoning', 'large-context'], description: 'Standard: $1.25 input / $0.15 cached input / $4.25 output per million tokens.' },
      { id: 'muse-spark-1.3-contributor', name: 'Muse Spark 1.3 Contributor (training data)', icon: Sparkles, costPer1MTokens: 0.15, capabilities: ['code', 'reasoning', 'large-context', 'cost-efficient'], description: 'Contributor: $0.10 input / $0.002 cached input / $0.20 output per million tokens. Prompts and replies may train Meta models.' },
    ],
  },
  anthropic: {
    name: 'Anthropic',
    models: [
      { id: 'claude-fable-5-1' as ModelId, name: 'Claude Fable 5.1 (1M context)', icon: Gem, tier: 'premium', costPer1MTokens: 30, capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Current model; see provider documentation for availability and pricing.' },
      { id: 'claude-fable-5' as ModelId, name: 'Claude Fable 5 (1M context)', icon: Gem, tier: 'premium', costPer1MTokens: 30, capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Mythos-class flagship — long-horizon autonomous work, low→max effort. ~2× Opus pricing ($10 in / $50 out).' },
      { id: 'claude-opus-5-5' as ModelId, name: 'Claude Opus 5.5 (1M context)', icon: Gem, tier: 'premium', costPer1MTokens: 12, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'Current Opus (September 2026) — long-running agentic coding, 128K output, always-on thinking, low→max effort' },
      { id: 'claude-opus-5' as ModelId, name: 'Claude Opus 5 (1M context)', icon: Gem, tier: 'premium', costPer1MTokens: 15, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'Previous Opus (July 2026) — near-Fable-5 capability at half the cost, 1M context, low→max effort' },
      { id: 'claude-opus-4-8' as ModelId, name: 'Claude Opus 4.8 (1M context)', icon: Gem, tier: 'premium', costPer1MTokens: 15, capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Previous flagship — xhigh/max effort, deepest reasoning' },
      { id: 'claude-opus-4-7' as ModelId, name: 'Claude Opus 4.7 (1M context)', icon: Gem, tier: 'premium', costPer1MTokens: 15, capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Previous flagship — xhigh/max effort, deepest reasoning' },
      { id: 'claude-opus-4-6' as ModelId, name: 'Claude Opus 4.6 (200K context)', icon: Gem, tier: 'premium', costPer1MTokens: 15, capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Previous Opus, strong reasoning and planning' },
      { id: 'claude-sonnet-5-5' as ModelId, name: 'Claude Sonnet 5.5 (1M context)', icon: Sparkles, tier: 'balanced', costPer1MTokens: 6, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'Current Sonnet (September 2026) — 1M context, 128K output, low→max effort; needs Claude Code 2.1.284+' },
      { id: 'claude-sonnet-5' as ModelId, name: 'Claude Sonnet 5 (1M context)', icon: Sparkles, tier: 'balanced', costPer1MTokens: 6, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'Previous Sonnet — 1M context, standard pricing' },
      { id: 'claude-sonnet-4-6' as ModelId, name: 'Claude Sonnet 4.6 (200K context)', icon: Sparkles, tier: 'balanced', costPer1MTokens: 9, capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Previous Sonnet — fast, capable, great for implementation' },
      { id: 'claude-haiku-5-5' as ModelId, name: 'Claude Haiku 5.5 (1M context)', icon: Zap, tier: 'fast', costPer1MTokens: 0.3, capabilities: ['fast', 'cost-efficient', 'code', 'large-context'], description: 'Current Haiku (October 2026) — 1M context, 128K output, low→max effort; prompts over 100K tokens cost 5×; needs Claude Code 2.1.293+' },
      { id: 'claude-haiku-4-5' as ModelId, name: 'Claude Haiku 4.5 (200K context)', icon: Zap, tier: 'fast', costPer1MTokens: 3, capabilities: ['fast', 'cost-efficient', 'code'], description: 'Fastest, ideal for simple tasks' },
    ],
  },
  openai: {
    name: 'OpenAI',
    // September 2026 catalog: GPT 5.2–5.5 selections migrate through MODEL_DEPRECATIONS.
    models: [
      // PAN-3388: bare gpt-5.6 ids pin the session window to the 272K billing
      // tier (>272K input bills 2x in / 1.5x out for the full request); the
      // [372k] variants opt into the long window at that surcharge.
      { id: 'gpt-6-astra' as ModelId, name: 'GPT-6 Astra (272K context)', icon: Gem, tier: 'premium', costPer1MTokens: 30, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'OpenAI flagship (September 2026), first GPT-6 generation. 272K session window (billing-tier safe), $10 in / $50 out per 1M.' },
      { id: 'gpt-6.1-sol' as ModelId, name: 'GPT-6.1 Sol (272K context)', icon: Gem, tier: 'premium', costPer1MTokens: 6, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'OpenAI GPT-6.1 mid tier (September 29, 2026), successor to GPT-6 Sol. 272K session window (billing-tier safe, same cap Overdeck applies to GPT-6 Sol), $2 in / $0.10 cached / $10 out per 1M. Codex under ChatGPT sign-in needs CLI 0.159.0+.' },
      { id: 'gpt-6.1-terra' as ModelId, name: 'GPT-6.1 Terra (272K context)', icon: Sparkles, tier: 'balanced', costPer1MTokens: 3, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'OpenAI GPT-6.1 workhorse tier (October 26, 2026), below GPT-6.1 Sol. 272K session window (billing-tier safe), $1 in / $0.05 cached / $5 out per 1M. Codex under ChatGPT sign-in needs CLI 0.159.0+.' },
      { id: 'gpt-6-sol' as ModelId, name: 'GPT-6 Sol (272K context)', icon: Gem, tier: 'premium', costPer1MTokens: 6, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'OpenAI GPT-6 mid tier (September 2026), successor to GPT-5.6 Sol. 272K session window (billing-tier safe), $2 in / $10 out per 1M.' },
      { id: 'gpt-6-luna' as ModelId, name: 'GPT-6 Luna (272K context)', icon: Zap, tier: 'fast', costPer1MTokens: 0.3, capabilities: ['fast', 'cost-efficient', 'code'], description: 'OpenAI GPT-6 fast/cheap tier (September 2026), successor to GPT-5.6 Luna. 272K session window (billing-tier safe), $0.10 in / $0.50 out per 1M.' },
      { id: 'gpt-6-astra-law' as ModelId, name: 'GPT-6 Astra for Law (272K context)', icon: Gem, tier: 'premium', costPer1MTokens: 30, capabilities: ['reasoning', 'large-context'], description: 'OpenAI GPT-6 Astra legal configuration. 272K session window, $10 in / $1 cached / $50 out per 1M (promotional through at least December 31, 2026). Codex harness only.' },
      { id: 'gpt-6-rosalind' as ModelId, name: 'GPT-6 Rosalind (272K context)', icon: Gem, tier: 'premium', costPer1MTokens: 45, capabilities: ['reasoning', 'large-context'], description: 'OpenAI life-sciences model (October 30, 2026). API access requires OpenAI\'s trusted-access program. 272K session window, $15 in / $1.50 cached / $75 out per 1M. Codex harness only.' },
      { id: 'gpt-5.6-sol' as ModelId, name: 'GPT-5.6 Sol (272K context)', icon: Gem, tier: 'premium', costPer1MTokens: 12, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'OpenAI flagship (July 2026), new default. 272K session window (billing-tier safe), $4 in / $20 out per 1M (promotional through at least November 21, 2026).' },
      { id: 'gpt-5.6-sol[372k]' as ModelId, name: 'GPT-5.6 Sol (372K context)', icon: Gem, tier: 'premium', costPer1MTokens: 12, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'Sol with the 372K long-context window. API input past 272K bills at 2x in / 1.5x out for the whole request — for long-research sessions that accept the surcharge.' },
      { id: 'gpt-5.6-terra' as ModelId, name: 'GPT-5.6 Terra (272K context)', icon: Sparkles, tier: 'balanced', costPer1MTokens: 7, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'OpenAI balanced tier (July 2026). GPT-5.5-competitive at lower cost. 272K session window (billing-tier safe), $2 in / $12 out per 1M.' },
      { id: 'gpt-5.6-terra[372k]' as ModelId, name: 'GPT-5.6 Terra (372K context)', icon: Sparkles, tier: 'balanced', costPer1MTokens: 7, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'Terra with the 372K long-context window. API input past 272K bills at 2x in / 1.5x out for the whole request.' },
      { id: 'gpt-5.6-luna' as ModelId, name: 'GPT-5.6 Luna (272K context)', icon: Zap, tier: 'fast', costPer1MTokens: 0.7, capabilities: ['fast', 'cost-efficient', 'code'], description: 'OpenAI fastest/cheapest tier (July 2026). 272K session window (billing-tier safe), $0.20 in / $1.20 out per 1M.' },
      { id: 'gpt-5.6-luna[372k]' as ModelId, name: 'GPT-5.6 Luna (372K context)', icon: Zap, tier: 'fast', costPer1MTokens: 0.7, capabilities: ['fast', 'cost-efficient', 'code'], description: 'Luna with the 372K long-context window. API input past 272K bills at 2x in / 1.5x out for the whole request.' },
    ],
  },
  google: {
    name: 'Google',
    models: [
      { id: 'gemini-4-argon' as ModelId, name: 'Gemini 4 Argon (1M context)', icon: Layers, tier: 'premium', costPer1MTokens: 6, capabilities: ['reasoning', 'large-context', 'code'], description: 'Google flagship for complex coding and agentic work. Introductory pricing through 2026-11-30, then $4/$20 per MTok.' },
      { id: 'gemini-3.8-flash' as ModelId, name: 'Gemini 3.8 Flash (1M context)', icon: Layers, tier: 'premium', costPer1MTokens: 2.25, capabilities: ['reasoning', 'large-context', 'code'], description: 'Stable Gemini Flash. $0.75/$3.75 per MTok through 2026-12-31, then $1.50/$7.50.' },
      { id: 'gemini-3.6-flash' as ModelId, name: 'Gemini 3.6 Flash (1M context)', icon: Layers, tier: 'balanced', costPer1MTokens: 2.25, capabilities: ['reasoning', 'large-context', 'code'], description: 'Stable Gemini Flash (July 2026). $0.75/$3.75 per MTok through 2026-12-31, then $1.50/$7.50.' },
      { id: 'gemini-3.1-pro-preview' as ModelId, name: 'Gemini 3.1 Pro (1M context)', icon: Layers, tier: 'premium', costPer1MTokens: 7, capabilities: ['reasoning', 'large-context', 'code'], description: 'Google flagship, 1M context, strong agentic coding' },
      { id: 'gemini-3.5-flash-lite' as ModelId, name: 'Gemini 3.5 Flash Lite (1M context)', icon: Zap, tier: 'fast', costPer1MTokens: 1.4, capabilities: ['fast', 'cost-efficient', 'large-context'], description: 'Current model; see provider documentation for availability and pricing.' },
      { id: 'gemini-3.1-flash-lite' as ModelId, name: 'Gemini 3.1 Flash Lite (1M context)', icon: Zap, tier: 'fast', costPer1MTokens: 0.875, capabilities: ['fast', 'cost-efficient', 'large-context'], description: 'GA successor of the 3.1 Flash Lite preview. $0.25/$1.50 per MTok. Google shuts it down 2027-05-07 (replacement: 3.5 Flash Lite).' },
    ],
  },
  kimi: {
    name: 'Kimi (Moonshot)',
    models: [
      { id: 'k3.1-pro' as ModelId, name: 'Kimi K3.1 Pro (1M context)', icon: Gem, tier: 'premium', costPer1MTokens: 6, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Kimi flagship coding model (Oct 2026). Post-trained K3, always-thinking, 1,048,576-token context.' },
      { id: 'k3.1-pro-highspeed' as ModelId, name: 'Kimi K3.1 Pro Highspeed (1M context)', icon: Gem, tier: 'premium', costPer1MTokens: 12, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'K3.1 Pro at 2-3x inference speed and 2x price. Needs a Kimi Code Allegretto (Pro) plan or higher.' },
      { id: 'k3' as ModelId, name: 'Kimi K3 (256K context)', icon: Gem, tier: 'premium', costPer1MTokens: 9, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Kimi flagship coding model (July 2026). Always-thinking 2.8T MoE, 256K context.' },
      { id: 'k3[1m]' as ModelId, name: 'Kimi K3 (1M context)', icon: Gem, tier: 'premium', costPer1MTokens: 9, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Kimi K3 coding endpoint with the full 1,048,576-token context window.' },
      { id: 'kimi-k2.7-code' as ModelId, name: 'Kimi K2.7 Code (256K context)', icon: Layers, tier: 'premium', costPer1MTokens: 2.5, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Kimi coding-first flagship (June 2026). 1T MoE, multimodal, 262K context. On a coding-subscription key the wire id kimi-for-coding now serves K2.8 Preview.' },
      { id: 'kimi-k2.6' as ModelId, name: 'Kimi K2.6 (256K context)', icon: Layers, tier: 'premium', costPer1MTokens: 1.6, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Kimi smartest model (April 2026). Native multimodal, superior agentic coding.' },
      { id: 'kimi-k2.5' as ModelId, name: 'Kimi K2.5 (256K context)', icon: Layers, tier: 'premium', costPer1MTokens: 1.6, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Best open-source coding, 256K context, 76.8% SWE-bench' },
      { id: 'K2.6-code-preview' as ModelId, name: 'K2.6-code-preview (256K context)', icon: FlaskConical, tier: 'premium', costPer1MTokens: 1.6, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Kimi coding preview model.' },
    ],
  },
  zai: {
    name: 'Zhipu (GLM)',
    models: [
      { id: 'glm-5.3' as ModelId, name: 'GLM-5.3 (1M context)', icon: Network, tier: 'premium', costPer1MTokens: 2.9, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Current model; see provider documentation for availability and pricing.' },
      { id: 'glm-5.3-flash' as ModelId, name: 'GLM-5.3 Flash (1M context)', icon: Zap, tier: 'fast', costPer1MTokens: 0.325, capabilities: ['fast', 'cost-efficient', 'code', 'vision', 'large-context'], description: 'Z.AI fast tier. $0.15/$0.50 per MTok, 1M context, image and video input.' },
      { id: 'glm-5.3-flashx' as ModelId, name: 'GLM-5.3 FlashX (1M context)', icon: Zap, tier: 'fast', costPer1MTokens: 0.81, capabilities: ['fast', 'cost-efficient', 'code', 'vision', 'large-context'], description: 'Z.AI faster paid Flash tier. $0.37/$1.25 per MTok, 1M context, image and video input.' },
      { id: 'glm-5.2' as ModelId, name: 'GLM-5.2 (1M context)', icon: Network, tier: 'premium', costPer1MTokens: 2.9, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Z.AI flagship, 1M context, high/max effort, strong agentic coding. Text-only (vision is a separate model line).' },
      { id: 'glm-5.1' as ModelId, name: 'GLM-5.1 (200K context)', icon: Network, tier: 'premium', costPer1MTokens: 2.9, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Previous Z.AI flagship, 200K context, strong agentic coding. Text-only (vision is a separate model line).' },
    ],
  },
  minimax: {
    name: 'MiniMax',
    models: [
      { id: 'MiniMax-M3' as ModelId, name: 'M3 (1M context)', icon: Gem, tier: 'premium', costPer1MTokens: 1.5, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'MSA architecture, 1M context, top-tier coding, native multimodal' },
      { id: 'MiniMax-M3.1-Flash' as ModelId, name: 'M3.1 Flash (1M context)', icon: Zap, tier: 'fast', costPer1MTokens: 0.375, capabilities: ['code', 'agentic', 'fast', 'large-context'], description: 'Multimodal coding model with tunable thinking depth. 1M context, $0.15/M in, $0.60/M out.' },
      { id: 'minimax-m2.7-highspeed' as ModelId, name: 'M2.7 Highspeed (204.8K context)', icon: Zap, tier: 'premium', costPer1MTokens: 1.5, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: '56.22% SWE-Pro, 100 tps, 204K context, $0.06/M blended' },
      { id: 'minimax-m2.7' as ModelId, name: 'M2.7 (204.8K context)', icon: Layers, tier: 'balanced', costPer1MTokens: 1.5, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: '56.22% SWE-Pro, 10B active params, 204K context' },
    ],
  },
  mimo: {
    name: 'Xiaomi MiMo',
    models: [
      { id: 'mimo-v2.6-pro' as ModelId, name: 'MiMo V2.6 Pro (1M context)', icon: Layers, tier: 'premium', costPer1MTokens: 0.6525, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Flagship reasoning model, 1M context, 128K output. $0.435/M in, $0.87/M out.' },
      { id: 'mimo-v2.6-flash' as ModelId, name: 'MiMo V2.6 Flash (1M context)', icon: Zap, tier: 'balanced', costPer1MTokens: 0.21, capabilities: ['code', 'agentic', 'fast', 'large-context'], description: 'Fast multimodal model, 1M context, 128K output. $0.14/M in, $0.28/M out.' },
      { id: 'mimo-v2.6-pro-ultraspeed' as ModelId, name: 'MiMo V2.6 Pro UltraSpeed (1M context)', icon: Layers, tier: 'premium', costPer1MTokens: 6.525, capabilities: ['reasoning', 'code', 'agentic', 'fast', 'large-context'], description: 'High-speed V2.6 Pro serving, 1M context. $4.35/M in, $8.70/M out.' },
    ],
  },
  nous: {
    name: 'Nous Portal',
    models: [
      { id: 'qwen/qwen3.6-plus' as ModelId, name: 'Qwen 3.6 Plus (1M context)', icon: Network, tier: 'premium', costPer1MTokens: 0, capabilities: ['reasoning', 'code', 'agentic', 'large-context', 'cost-efficient'], description: 'Qwen 3.6 Plus via Nous Portal, currently free with 1M context.' },
    ],
  },
  dashscope: {
    name: 'Alibaba DashScope',
    models: [
      { id: 'qwen3.7-max' as ModelId, name: 'Qwen3.7 Max (256K context)', icon: Gem, tier: 'premium', costPer1MTokens: 5, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'DashScope Qwen3.7 Max. $2.50/$7.50 per MTok.' },
      { id: 'qwen3.7-plus' as ModelId, name: 'Qwen3.7 Plus (1M context)', icon: Gem, tier: 'premium', costPer1MTokens: 1, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'DashScope balanced tier. $0.40/$1.60 per MTok up to 256K input (limited-time discount).' },
      { id: 'qwen3.8-flash' as ModelId, name: 'Qwen3.8 Flash (1M context)', icon: Gem, tier: 'premium', costPer1MTokens: 0.31, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'DashScope fast tier. $0.15/$0.47 per MTok, 1M context.' },
      { id: 'qwen3.8-max' as ModelId, name: 'Qwen3.8 Max (1M context)', icon: Gem, tier: 'premium', costPer1MTokens: 4, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'DashScope flagship Qwen3.8 Max. $2/$6 per MTok, 1,000,000-token context.' },
    ],
  },
  xai: {
    name: 'xAI (Grok)',
    models: [
      { id: 'grok-build-0.1' as ModelId, name: 'Grok Build 0.1 (256K context)', icon: Zap, tier: 'premium', costPer1MTokens: 1.5, capabilities: ['reasoning', 'code', 'agentic', 'large-context', 'vision'], description: 'xAI\'s agentic coding model (May 2026). 256K context, reasoning always active.' },
      { id: 'grok-4.7' as ModelId, name: 'Grok 4.7 (500K context)', icon: Layers, tier: 'premium', costPer1MTokens: 4, capabilities: ['reasoning', 'code', 'large-context'], description: 'xAI flagship. 500K context, $2/M in, $6/M out; a prompt of 200K+ tokens bills the whole request at double.' },
      { id: 'grok-4.3' as ModelId, name: 'Grok 4.3 (1M context)', icon: Zap, tier: 'balanced', costPer1MTokens: 1.875, capabilities: ['reasoning', 'code', 'large-context'], description: '1M context, $1.25/M in, $2.50/M out; a prompt of 200K+ tokens bills the whole request at double.' },
    ],
  },
  groq: {
    name: 'Groq',
    models: [
      { id: 'openai/gpt-oss-120b' as ModelId, name: 'GPT OSS 120B (131K context)', icon: Zap, tier: 'balanced', costPer1MTokens: 0.375, capabilities: ['reasoning', 'code', 'fast'], description: 'OpenAI open-weight model on Groq. 131K context, $0.15/M in, $0.60/M out.' },
      { id: 'openai/gpt-oss-20b' as ModelId, name: 'GPT OSS 20B (131K context)', icon: Zap, tier: 'fast', costPer1MTokens: 0.1875, capabilities: ['code', 'fast', 'cost-efficient'], description: 'Small OpenAI open-weight model on Groq. 131K context, $0.075/M in, $0.30/M out.' },
    ],
  },
  cerebras: {
    name: 'Cerebras',
    models: [
      { id: 'gpt-oss-120b' as ModelId, name: 'GPT OSS 120B (131K context)', icon: Zap, tier: 'balanced', costPer1MTokens: 0.55, capabilities: ['reasoning', 'code', 'fast'], description: 'OpenAI open-weight model on Cerebras. 131K context and 40K output on the paid tier, $0.35/M in, $0.75/M out.' },
    ],
  },
  mistral: {
    name: 'Mistral AI',
    models: [
      { id: 'mistral-large-4-0' as ModelId, name: 'Mistral Large 4 (1M context)', icon: Layers, tier: 'premium', costPer1MTokens: 1.4, capabilities: ['reasoning', 'code', 'large-context'], description: 'Public Preview (2026-10-06). 1M context, $0.70/M in, $0.07/M cached, $2.10/M out.' },
    ],
  },
  quantumllama: {
    name: 'QuantumLlama',
    models: [
      { id: 'ql-reason-70b' as ModelId, name: 'QL Reason 70B (200K context)', icon: FlaskConical, tier: 'premium', costPer1MTokens: 16, capabilities: ['reasoning', 'code', 'large-context'], description: 'Fictional benchmark provider (PAN-3252) — no live endpoint. 200K context, $8 in / $24 out per 1M.' },
      { id: 'ql-swift-8b' as ModelId, name: 'QL Swift 8B (128K context)', icon: FlaskConical, tier: 'balanced', costPer1MTokens: 4, capabilities: ['code', 'fast'], description: 'Fictional benchmark provider (PAN-3252) — no live endpoint. 128K context, $2 in / $6 out per 1M.' },
      { id: 'ql-nano-1b' as ModelId, name: 'QL Nano 1B (32K context)', icon: FlaskConical, tier: 'fast', costPer1MTokens: 0.8, capabilities: ['fast', 'cost-efficient'], description: 'Fictional benchmark provider (PAN-3252) — no live endpoint. 32K context, $0.40 in / $1.20 out per 1M.' },
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
 * glm-5.3); every other model — including unflagged ones — is allowed, so
 * the provider stays the final authority. Mirrors `modelSupportsImages` in
 * src/lib/model-capabilities.ts. PAN-1685.
 */
export function modelSupportsImages(modelId: string): boolean {
  return findModelDef(modelId)?.supportsImages !== false;
}

export type OpenRouterFavoriteModel = {
  id: string;
  name: string;
  promptCostPer1M: number | null;
  completionCostPer1M: number | null;
  contextLength: number | null;
  supportsThinking: boolean;
  category: string;
};
