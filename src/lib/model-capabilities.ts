/**
 * Model Capability Matrix
 *
 * Defines capability scores for each model across different skill dimensions.
 * This enables intelligent model selection based on what the user has enabled
 * rather than static presets.
 *
 * Scores: 0-100 where 100 = best in class
 * Cost: $/1M tokens (input + output average)
 *
 * Last updated: 2026-01-29
 * Sources:
 * - SWE-bench Verified leaderboard (vals.ai)
 * - LiveCodeBench v6
 * - LMSYS Chatbot Arena
 * - Artificial Analysis
 * - Official provider pricing pages
 */

import { Effect } from 'effect';
import { ModelId } from './settings.js';
import type { SubscriptionPlan } from './subscription-types.js';

/**
 * Model ID deprecation mapping
 *
 * Maps deprecated model IDs to their current replacements.
 * When a model ID changes (e.g., claude-opus-4-5 → claude-opus-4-6),
 * add the mapping here to enable automatic migration.
 *
 * Strategy: Single-hop only. Only add models here when the provider has
 * actually retired them — not just because a newer version exists.
 */
export const MODEL_DEPRECATIONS: Record<string, ModelId> = {
  'claude-opus-4-5': 'claude-opus-4-7',
  'claude-sonnet-4-5': 'claude-sonnet-4-6',
  // OpenAI retired/superseded models
  'gpt-5.2-codex': 'gpt-5.3-codex', // superseded by gpt-5.3-codex (April 2026)
  'gpt-5.5-mini': 'gpt-5.4-mini',   // hallucinated tier — never shipped
  'gpt-5.5-nano': 'gpt-5.4-mini',   // hallucinated tier — never shipped
  'gpt-5.4-nano': 'gpt-5.4-mini',   // hallucinated tier — never shipped
  'o3-deep-research': 'o3',
  // NOTE: gpt-5.4 family is Panopticon's abstraction over real OpenAI models.
  // Do NOT treat gpt-4o/gpt-4o-mini as deprecated — they are the actual API names.
  // Google deprecated models
  'gemini-3-pro-preview': 'gemini-3.1-pro-preview',
  'gemini-3-flash': 'gemini-3-flash-preview',
  'gemini-2.5-pro': 'gemini-3.1-pro-preview',
  'gemini-2.5-flash': 'gemini-3-flash-preview',
  // Kimi deprecated
  'kimi-k2': 'kimi-k2.5',
  // Z.AI deprecated
  'glm-4.7': 'glm-5.1',
  'glm-4.7-flash': 'glm-5.1',
};

/**
 * Resolve a model ID to its current version
 *
 * If the model ID is deprecated, returns the replacement.
 * Otherwise, returns the model ID unchanged.
 *
 * @param modelId - Model ID to resolve (may be deprecated)
 * @returns Current model ID
 */
export function resolveModelId(modelId: string): ModelId {
  return (MODEL_DEPRECATIONS[modelId] as ModelId) || (modelId as ModelId);
}

/**
 * Skill dimensions that models are evaluated on
 */
export type SkillDimension =
  | 'code-generation' // Writing new code
  | 'code-review' // Finding issues in code
  | 'debugging' // Root cause analysis
  | 'planning' // Architecture and strategy
  | 'documentation' // Writing docs, PRDs
  | 'testing' // Test generation and analysis
  | 'security' // Security analysis
  | 'performance' // Performance optimization
  | 'synthesis' // Combining information
  | 'speed' // Response latency
  | 'context-length'; // Max context window

/**
 * Capability profile for a single model
 */
type CapabilityModelId = ModelId;

export interface ModelCapability {
  /** Model identifier */
  model: ModelId;
  /** Provider for this model */
  provider: 'anthropic' | 'openai' | 'google' | 'kimi' | 'minimax' | 'openrouter' | 'zai' | 'mimo' | 'nous' | 'dashscope';
  /** Display name */
  displayName: string;
  /** Cost per 1M tokens (average of input/output) in USD */
  costPer1MTokens: number;
  /** Capability scores (0-100) for each skill dimension */
  skills: Record<SkillDimension, number>;
  /** Context window size in tokens */
  contextWindow: number;
  /** Minimum subscription plan required to access this model via OAuth (undefined = API key only or no tier restriction) */
  minTier?: SubscriptionPlan;
  /** Additional notes about this model's strengths */
  notes?: string;
}

/**
 * Master capability database
 *
 * Scores are based on:
 * - Public benchmarks (HumanEval, SWE-bench, MBPP)
 * - Community consensus
 * - Practical experience
 *
 * These are baseline scores - run Kimi 2.5 research to refine.
 */
export const MODEL_CAPABILITIES: Record<CapabilityModelId, ModelCapability> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // ANTHROPIC MODELS
  // ═══════════════════════════════════════════════════════════════════════════

  'claude-opus-4-7': {
    model: 'claude-opus-4-7',
    provider: 'anthropic',
    displayName: 'Claude Opus 4.7',
    costPer1MTokens: 45.0, // Same pricing tier as Opus 4.6 — verify at launch
    contextWindow: 200000,
    skills: {
      'code-generation': 98,
      'code-review': 99,
      debugging: 98,
      planning: 99,
      documentation: 96,
      testing: 94,
      security: 99,
      performance: 92,
      synthesis: 99,
      speed: 38,
      'context-length': 95,
    },
    notes: 'Successor to Opus 4.6. Supports xhigh and max effort levels for extended thinking. Best for deepest reasoning and long-horizon coding tasks.',
  },

  'claude-opus-4-6': {
    model: 'claude-opus-4-6',
    provider: 'anthropic',
    displayName: 'Claude Opus 4.6',
    costPer1MTokens: 45.0, // $5 in / $25 out → same pricing as 4.5
    contextWindow: 200000, // 1M available via opt-in beta, but we use 200K
    skills: {
      'code-generation': 96, // 80.9% SWE-bench (first >80%), 89.4% Aider Polyglot
      'code-review': 98,
      debugging: 97,
      planning: 99, // User confirms: "Opus 4.6 planning for sure"
      documentation: 95,
      testing: 92,
      security: 98, // Best for security review
      performance: 90,
      synthesis: 98, // Best for combining info across domains
      speed: 40, // Slower but 76% more token efficient
      'context-length': 95,
    },
    notes: 'Successor to Opus 4.5. Same pricing, 1M context available (opt-in beta). Best for planning, security, complex reasoning.',
  },

  'claude-sonnet-4-6': {
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.6',
    costPer1MTokens: 9.0, // $3 in / $15 out → avg ~$9
    contextWindow: 200000,
    skills: {
      'code-generation': 94,
      'code-review': 94,
      debugging: 92,
      planning: 90,
      documentation: 92,
      testing: 92,
      security: 88,
      performance: 88,
      synthesis: 90,
      speed: 70,
      'context-length': 95,
    },
    notes: 'Successor to Sonnet 4.5. Same pricing tier. Improved coding and reasoning.',
  },

  'claude-sonnet-4-5': {
    model: 'claude-sonnet-4-5',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.5',
    costPer1MTokens: 9.0, // $3 in / $15 out → avg ~$9
    contextWindow: 200000,
    skills: {
      'code-generation': 92, // 77.2% SWE-bench (82% parallel), beats GPT-5 Codex (74.5%)
      'code-review': 92,
      debugging: 90,
      planning: 88,
      documentation: 90, // 100% AIME with Python
      testing: 90, // 50% Terminal-Bench, 61.4% OSWorld
      security: 85,
      performance: 85,
      synthesis: 88,
      speed: 70,
      'context-length': 95,
    },
    notes: 'Best value: 77.2% SWE-bench at 1/5th Opus cost. Beats GPT-5 Codex.',
  },

  'claude-haiku-4-5': {
    model: 'claude-haiku-4-5',
    provider: 'anthropic',
    displayName: 'Claude Haiku 4.5',
    costPer1MTokens: 4.0, // $0.80 in / $4 out → avg ~$2.4
    contextWindow: 200000,
    skills: {
      'code-generation': 75,
      'code-review': 72,
      debugging: 70,
      planning: 65,
      documentation: 75,
      testing: 70,
      security: 60,
      performance: 65,
      synthesis: 68,
      speed: 95, // Fastest Anthropic
      'context-length': 95,
    },
    notes: 'Fast and cheap, good for simple tasks and exploration',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // OPENAI MODELS
  // ═══════════════════════════════════════════════════════════════════════════

  'gpt-5.4': {
    model: 'gpt-5.4',
    provider: 'openai',
    displayName: 'GPT-5.4',
    costPer1MTokens: 8.75, // $2.50 in / $15 out
    contextWindow: 1050000, // 1.05M context
    minTier: 'plus', // ChatGPT Plus/Pro only
    skills: {
      'code-generation': 96,
      'code-review': 92,
      debugging: 94,
      planning: 92,
      documentation: 90,
      testing: 92,
      security: 88,
      performance: 90,
      synthesis: 92,
      speed: 60,
      'context-length': 100, // 1.05M context
    },
    notes: 'OpenAI flagship (March 2026). 1.05M context, 128K max output. Strong coding and reasoning.',
  },

  'gpt-5.4-mini': {
    model: 'gpt-5.4-mini',
    provider: 'openai',
    displayName: 'GPT-5.4 Mini',
    costPer1MTokens: 1.0, // ~$0.40 in / $1.60 out
    contextWindow: 400000,
    minTier: 'free', // Available in ChatGPT Free tier
    skills: {
      'code-generation': 82,
      'code-review': 78,
      debugging: 76,
      planning: 72,
      documentation: 80,
      testing: 76,
      security: 68,
      performance: 72,
      synthesis: 75,
      speed: 90, // 2x faster than predecessor
      'context-length': 90, // 400K context
    },
    notes: 'Fast and efficient. 400K context. Available in ChatGPT Free/Plus tiers.',
  },

  'o3': {
    model: 'o3',
    provider: 'openai',
    displayName: 'O3',
    costPer1MTokens: 5.0, // $2 in / $8 out
    contextWindow: 200000,
    minTier: 'plus', // ChatGPT Plus/Pro only
    skills: {
      'code-generation': 90,
      'code-review': 95,
      debugging: 98, // Best for debugging
      planning: 95,
      documentation: 88,
      testing: 88,
      security: 92,
      performance: 92,
      synthesis: 95,
      speed: 25, // Slow (reasoning chains)
      'context-length': 95,
    },
    notes: 'Deep reasoning model. Excels at complex debugging, math, scientific reasoning.',
  },

  'o4-mini': {
    model: 'o4-mini',
    provider: 'openai',
    displayName: 'O4 Mini',
    costPer1MTokens: 2.75, // $1.10 in / $4.40 out
    contextWindow: 200000,
    minTier: 'plus', // ChatGPT Plus/Pro only
    skills: {
      'code-generation': 85,
      'code-review': 90,
      debugging: 94,
      planning: 88,
      documentation: 84,
      testing: 85,
      security: 86,
      performance: 88,
      synthesis: 88,
      speed: 70, // Fast for a reasoning model
      'context-length': 90,
    },
    notes: 'Compact reasoning model (April 2025). Fast, cost-efficient, tool-use capable.',
  },

  'gpt-5.4-pro': {
    model: 'gpt-5.4-pro',
    provider: 'openai',
    displayName: 'GPT-5.4 Pro',
    costPer1MTokens: 105.0, // $15 in / $195 out
    contextWindow: 1050000,
    minTier: 'pro', // ChatGPT Pro only
    skills: {
      'code-generation': 98,
      'code-review': 98,
      debugging: 98,
      planning: 99,
      documentation: 96,
      testing: 96,
      security: 96,
      performance: 95,
      synthesis: 99,
      speed: 45,
      'context-length': 100,
    },
    notes: 'Most advanced OpenAI model. Enhanced reasoning and agentic capabilities over GPT-5.4. Pro subscribers only.',
  },

  'gpt-5.5': {
    model: 'gpt-5.5',
    provider: 'openai',
    displayName: 'GPT-5.5',
    costPer1MTokens: 10.5, // $3.00 in / $18.00 out
    contextWindow: 1050000, // 1.05M context
    minTier: 'plus', // ChatGPT Plus/Pro only
    skills: {
      'code-generation': 97,
      'code-review': 94,
      debugging: 96,
      planning: 95,
      documentation: 92,
      testing: 94,
      security: 91,
      performance: 92,
      synthesis: 94,
      speed: 65,
      'context-length': 100, // 1.05M context
    },
    notes: 'OpenAI flagship (April 2026). Successor to GPT-5.4 with improved reasoning and coding. 1.05M context, 128K max output.',
  },

  'gpt-5.5-pro': {
    model: 'gpt-5.5-pro',
    provider: 'openai',
    displayName: 'GPT-5.5 Pro',
    costPer1MTokens: 119.0, // $18 in / $220 out
    contextWindow: 1050000,
    minTier: 'pro', // ChatGPT Pro only
    skills: {
      'code-generation': 99,
      'code-review': 99,
      debugging: 99,
      planning: 99,
      documentation: 97,
      testing: 97,
      security: 97,
      performance: 96,
      synthesis: 99,
      speed: 50,
      'context-length': 100,
    },
    notes: 'Most advanced OpenAI model. Enhanced reasoning and agentic capabilities over GPT-5.5. Pro subscribers only.',
  },

  'gpt-5.3-codex': {
    model: 'gpt-5.3-codex',
    provider: 'openai',
    displayName: 'GPT-5.3 Codex',
    costPer1MTokens: 7.875, // $1.75 in / $14.00 out
    contextWindow: 400000,
    skills: {
      'code-generation': 96,
      'code-review': 95,
      debugging: 94,
      planning: 90,
      documentation: 88,
      testing: 90,
      security: 86,
      performance: 88,
      synthesis: 92,
      speed: 75,
      'context-length': 90,
    },
    notes: 'Industry-leading agentic coding model (2026). Available via Codex CLI/IDE/cloud and the Responses API.',
  },

  'gpt-5.2': {
    model: 'gpt-5.2',
    provider: 'openai',
    displayName: 'GPT-5.2',
    costPer1MTokens: 5.625, // $1.25 in / $10 out (estimate)
    contextWindow: 200000,
    skills: {
      'code-generation': 88,
      'code-review': 86,
      debugging: 84,
      planning: 82,
      documentation: 84,
      testing: 82,
      security: 78,
      performance: 80,
      synthesis: 84,
      speed: 70,
      'context-length': 85,
    },
    notes: 'Previous-generation general-purpose model (Oct 2025). Superseded by GPT-5.4.',
  },

  // Retired OpenAI model IDs — kept for backward compat
  'o3-deep-research': { model: 'o3-deep-research', provider: 'openai', displayName: 'O3 Deep Research (deprecated)', costPer1MTokens: 5.0, contextWindow: 200000, skills: { 'code-generation': 88, 'code-review': 95, debugging: 98, planning: 95, documentation: 88, testing: 88, security: 92, performance: 92, synthesis: 95, speed: 25, 'context-length': 95 } },
  // Active OpenAI API names — NOT deprecated. Kept in MODEL_CAPABILITIES for backward compat
  // with saved configs. These are real OpenAI model IDs that still work via the OpenAI API.
  'gpt-4o': { model: 'gpt-4o', provider: 'openai', displayName: 'GPT-4o', costPer1MTokens: 7.5, contextWindow: 128000, skills: { 'code-generation': 82, 'code-review': 80, debugging: 78, planning: 76, documentation: 80, testing: 76, security: 74, performance: 74, synthesis: 80, speed: 75, 'context-length': 75 } },
  'gpt-4o-mini': { model: 'gpt-4o-mini', provider: 'openai', displayName: 'GPT-4o Mini', costPer1MTokens: 0.6, contextWindow: 128000, skills: { 'code-generation': 68, 'code-review': 64, debugging: 60, planning: 56, documentation: 66, testing: 60, security: 52, performance: 56, synthesis: 62, speed: 92, 'context-length': 75 } },

  // ═══════════════════════════════════════════════════════════════════════════
  // GOOGLE MODELS
  // ═══════════════════════════════════════════════════════════════════════════

  'gemini-3.1-pro-preview': {
    model: 'gemini-3.1-pro-preview',
    provider: 'google',
    displayName: 'Gemini 3.1 Pro',
    costPer1MTokens: 7.0, // $2 in / $12 out (≤200K), $4/$18 above
    contextWindow: 1000000,
    skills: {
      'code-generation': 93,
      'code-review': 90,
      debugging: 88,
      planning: 88,
      documentation: 90,
      testing: 88,
      security: 82,
      performance: 88,
      synthesis: 92,
      speed: 75,
      'context-length': 100, // 1M context
    },
    notes: 'Google flagship (March 2026). Replaces Gemini 3 Pro (shut down). Strong agentic and coding capabilities.',
  },

  'gemini-3-flash-preview': {
    model: 'gemini-3-flash-preview',
    provider: 'google',
    displayName: 'Gemini 3 Flash Preview',
    costPer1MTokens: 0.4, // ~$0.15 in / $0.60 out
    contextWindow: 1000000,
    skills: {
      'code-generation': 80,
      'code-review': 75,
      debugging: 72,
      planning: 68,
      documentation: 76,
      testing: 72,
      security: 60,
      performance: 70,
      synthesis: 75,
      speed: 96, // Very fast
      'context-length': 100,
    },
    notes: 'Fast and cheap with 1M context. Strong reasoning and agentic capabilities.',
  },

  'gemini-3.1-flash-lite-preview': {
    model: 'gemini-3.1-flash-lite-preview',
    provider: 'google',
    displayName: 'Gemini 3.1 Flash Lite',
    costPer1MTokens: 0.9, // $0.25 in / $1.50 out
    contextWindow: 1000000,
    skills: {
      'code-generation': 72,
      'code-review': 68,
      debugging: 65,
      planning: 60,
      documentation: 70,
      testing: 65,
      security: 52,
      performance: 62,
      synthesis: 68,
      speed: 98, // Most cost-efficient
      'context-length': 100,
    },
    notes: 'Most cost-efficient Google model. Great for high-volume, latency-sensitive workloads.',
  },

  // Legacy Google IDs — deprecated aliases kept for backward compat with saved configs
  'gemini-3-pro-preview': { model: 'gemini-3-pro-preview', provider: 'google', displayName: 'Gemini 3 Pro (deprecated)', costPer1MTokens: 7.0, contextWindow: 1000000, skills: { 'code-generation': 93, 'code-review': 90, debugging: 88, planning: 88, documentation: 90, testing: 88, security: 82, performance: 88, synthesis: 92, speed: 75, 'context-length': 100 } },
  'gemini-2.5-pro': { model: 'gemini-2.5-pro', provider: 'google', displayName: 'Gemini 2.5 Pro (deprecated)', costPer1MTokens: 7.0, contextWindow: 1000000, skills: { 'code-generation': 90, 'code-review': 88, debugging: 86, planning: 86, documentation: 88, testing: 86, security: 80, performance: 86, synthesis: 90, speed: 70, 'context-length': 100 } },
  'gemini-2.5-flash': { model: 'gemini-2.5-flash', provider: 'google', displayName: 'Gemini 2.5 Flash (deprecated)', costPer1MTokens: 0.4, contextWindow: 1000000, skills: { 'code-generation': 78, 'code-review': 74, debugging: 70, planning: 66, documentation: 74, testing: 70, security: 58, performance: 68, synthesis: 74, speed: 94, 'context-length': 100 } },

  // ═══════════════════════════════════════════════════════════════════════════
  // KIMI MODELS
  // ═══════════════════════════════════════════════════════════════════════════

  'kimi-k2.6': {
    model: 'kimi-k2.6',
    provider: 'kimi',
    displayName: 'Kimi K2.6',
    costPer1MTokens: 1.6, // $0.60 in / $2.50 out
    contextWindow: 256000,
    skills: {
      'code-generation': 94, // Improved over K2.5
      'code-review': 92,
      debugging: 92,
      planning: 90,
      documentation: 90,
      testing: 90,
      security: 85,
      performance: 88,
      synthesis: 94, // Native multimodal, stronger agentic capabilities
      speed: 75, // MoE architecture
      'context-length': 98, // 256K context
    },
    notes: 'Kimi\'s smartest model (April 2026). Native multimodal, superior agentic coding, and autonomous agent execution. Replaces K2.6-code-preview.',
  },

  'kimi-k2.5': {
    model: 'kimi-k2.5',
    provider: 'kimi',
    displayName: 'Kimi K2.5',
    costPer1MTokens: 1.6, // $0.60 in / $2.50 out
    contextWindow: 256000,
    skills: {
      'code-generation': 92, // 76.8% SWE-bench, 85 LiveCodeBench v6
      'code-review': 90,
      debugging: 90, // Strong analytical capabilities
      planning: 88, // User confirms "highly capable"
      documentation: 88,
      testing: 88, // 92% coding accuracy
      security: 82,
      performance: 85,
      synthesis: 92, // Can coordinate 100 sub-agents, 1500 tool calls
      speed: 75, // MoE: 1T total params, 32B active
      'context-length': 98, // 256K context
    },
    notes: 'Best open-source coding model. 5x cheaper than GPT-5.2. Excellent for frontend dev and multi-agent orchestration.',
  },

  'K2.6-code-preview': {
    model: 'K2.6-code-preview',
    provider: 'kimi',
    displayName: 'K2.6-code-preview',
    costPer1MTokens: 1.6,
    contextWindow: 256000,
    skills: {
      'code-generation': 92,
      'code-review': 90,
      debugging: 90,
      planning: 88,
      documentation: 88,
      testing: 88,
      security: 82,
      performance: 85,
      synthesis: 92,
      speed: 75,
      'context-length': 98,
    },
    notes: 'Kimi coding preview model.',
  },

  // Legacy Kimi ID — kimi-k2 deprecated in favor of kimi-k2.5
  'kimi-k2': { model: 'kimi-k2', provider: 'kimi', displayName: 'Kimi K2 (deprecated)', costPer1MTokens: 1.6, contextWindow: 128000, skills: { 'code-generation': 88, 'code-review': 86, debugging: 86, planning: 84, documentation: 84, testing: 84, security: 78, performance: 80, synthesis: 88, speed: 72, 'context-length': 80 }, notes: '65.8% SWE-bench. Superseded by Kimi K2.5.' },

  // ═══════════════════════════════════════════════════════════════════════════
  // MINIMAX MODELS
  // ═══════════════════════════════════════════════════════════════════════════

  'minimax-m2.7': {
    model: 'minimax-m2.7',
    provider: 'minimax',
    displayName: 'MiniMax M2.7',
    costPer1MTokens: 1.5, // $0.30/M in + $1.20/M out, blended ~$0.06/M with auto-cache
    contextWindow: 204800,
    skills: {
      'code-generation': 90, // 56.22% SWE-Pro (Opus ~57-58%), 55.6% VIBE-Pro
      'code-review': 88,
      debugging: 88, // 57.0% Terminal Bench 2
      planning: 85,
      documentation: 85,
      testing: 86,
      security: 80,
      performance: 82,
      synthesis: 90, // Self-evolving agent, 97% skill adherence on complex tasks
      speed: 80, // 10B active params (MoE)
      'context-length': 92, // 204K context
    },
    notes: '10B active params, 56.22% SWE-Pro, 1495 ELO GDPval-AA. $0.06/M blended with auto-cache.',
  },

  'minimax-m2.7-highspeed': {
    model: 'minimax-m2.7-highspeed',
    provider: 'minimax',
    displayName: 'MiniMax M2.7 Highspeed',
    costPer1MTokens: 1.5, // Same pricing as M2.7
    contextWindow: 204800,
    skills: {
      'code-generation': 90,
      'code-review': 88,
      debugging: 88,
      planning: 85,
      documentation: 85,
      testing: 86,
      security: 80,
      performance: 82,
      synthesis: 90,
      speed: 92, // 100 tps, 3x faster than Opus
      'context-length': 92,
    },
    notes: 'Identical quality to M2.7, 100 tps (3x Opus speed). Best for high-throughput agent work.',
  },

  // Z.AI models
  'glm-5.1': {
    model: 'glm-5.1',
    provider: 'zai',
    displayName: 'GLM-5.1',
    costPer1MTokens: 2.0,
    contextWindow: 128000,
    skills: {
      'code-generation': 82,
      'code-review': 80,
      debugging: 80,
      planning: 78,
      documentation: 78,
      testing: 78,
      security: 75,
      performance: 75,
      synthesis: 80,
      speed: 85,
      'context-length': 75,
    },
    notes: 'Z.AI GLM-5.1 model via Anthropic-compatible API.',
  },

  'glm-4.7': {
    model: 'glm-4.7',
    provider: 'zai',
    displayName: 'GLM-4.7 (deprecated)',
    costPer1MTokens: 1.5,
    contextWindow: 200000,
    skills: {
      'code-generation': 88,
      'code-review': 85,
      debugging: 84,
      planning: 82,
      documentation: 80,
      testing: 82,
      security: 78,
      performance: 80,
      synthesis: 84,
      speed: 80,
      'context-length': 92,
    },
    notes: 'Top open-source model for agentic coding. 73.8% SWE-bench, 200K context.',
  },

  'glm-4.7-flash': {
    model: 'glm-4.7-flash',
    provider: 'zai',
    displayName: 'GLM-4.7 Flash (deprecated)',
    costPer1MTokens: 0.3,
    contextWindow: 200000,
    skills: {
      'code-generation': 78,
      'code-review': 74,
      debugging: 72,
      planning: 70,
      documentation: 72,
      testing: 72,
      security: 68,
      performance: 70,
      synthesis: 74,
      speed: 95,
      'context-length': 92,
    },
    notes: 'Fast and affordable GLM model for quick iterations. 200K context.',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // XIAOMI MIMO MODELS
  // ═══════════════════════════════════════════════════════════════════════════

  'mimo-v2.5-pro': {
    model: 'mimo-v2.5-pro',
    provider: 'mimo',
    displayName: 'MiMo V2.5 Pro',
    costPer1MTokens: 2.0,
    contextWindow: 1048576,
    skills: {
      'code-generation': 88,
      'code-review': 86,
      debugging: 86,
      planning: 84,
      documentation: 84,
      testing: 84,
      security: 80,
      performance: 82,
      synthesis: 88,
      speed: 78,
      'context-length': 100,
    },
    notes: 'Xiaomi MiMo flagship reasoning model. Enhanced agent efficiency, 1M context window.',
  },

  'mimo-v2.5': {
    model: 'mimo-v2.5',
    provider: 'mimo',
    displayName: 'MiMo V2.5',
    costPer1MTokens: 1.0,
    contextWindow: 262144,
    skills: {
      'code-generation': 82,
      'code-review': 80,
      debugging: 80,
      planning: 78,
      documentation: 78,
      testing: 78,
      security: 74,
      performance: 76,
      synthesis: 82,
      speed: 85,
      'context-length': 96,
    },
    notes: 'Xiaomi MiMo multimodal model. 262K context, strong agentic and coding capabilities.',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // NOUS PORTAL MODELS
  // ═══════════════════════════════════════════════════════════════════════════

  'qwen/qwen3.6-plus': {
    model: 'qwen/qwen3.6-plus',
    provider: 'nous',
    displayName: 'Qwen 3.6 Plus (Nous Portal)',
    costPer1MTokens: 0,
    contextWindow: 1048576,
    skills: {
      'code-generation': 94,
      'code-review': 92,
      debugging: 92,
      planning: 92,
      documentation: 90,
      testing: 90,
      security: 88,
      performance: 88,
      synthesis: 92,
      speed: 74,
      'context-length': 100,
    },
    notes: 'Qwen 3.6 Plus via Nous Portal. Free for a limited time; 1M-token context according to public launch material.',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHSCOPE (ALIBABA) MODELS
  // ═══════════════════════════════════════════════════════════════════════════

  'qwen3-max': {
    model: 'qwen3-max',
    provider: 'dashscope',
    displayName: 'Qwen3 Max (DashScope)',
    costPer1MTokens: 0,
    contextWindow: 262144,
    skills: {
      'code-generation': 95,
      'code-review': 93,
      debugging: 93,
      planning: 94,
      documentation: 91,
      testing: 91,
      security: 89,
      performance: 89,
      synthesis: 94,
      speed: 72,
      'context-length': 98,
    },
    notes: 'Routed direct to Alibaba DashScope (Singapore intl / ap-southeast-1) via DASHSCOPE_API_KEY. Pricing placeholder pending Alibaba intl endpoint pricing.',
  },

  'qwen3-coder-plus': {
    model: 'qwen3-coder-plus',
    provider: 'dashscope',
    displayName: 'Qwen3 Coder Plus (DashScope)',
    costPer1MTokens: 0,
    contextWindow: 262144,
    skills: {
      'code-generation': 96,
      'code-review': 94,
      debugging: 94,
      planning: 91,
      documentation: 90,
      testing: 92,
      security: 89,
      performance: 90,
      synthesis: 92,
      speed: 74,
      'context-length': 98,
    },
    notes: 'Routed direct to Alibaba DashScope (Singapore intl / ap-southeast-1) via DASHSCOPE_API_KEY. Pricing placeholder pending Alibaba intl endpoint pricing.',
  },

  'qwen3-plus': {
    model: 'qwen3-plus',
    provider: 'dashscope',
    displayName: 'Qwen3 Plus (DashScope)',
    costPer1MTokens: 0,
    contextWindow: 131072,
    skills: {
      'code-generation': 88,
      'code-review': 86,
      debugging: 86,
      planning: 84,
      documentation: 84,
      testing: 84,
      security: 80,
      performance: 82,
      synthesis: 88,
      speed: 82,
      'context-length': 96,
    },
    notes: 'Routed direct to Alibaba DashScope (Singapore intl / ap-southeast-1) via DASHSCOPE_API_KEY. Pricing placeholder pending Alibaba intl endpoint pricing.',
  },

  'qwen3.7-max': {
    model: 'qwen3.7-max',
    provider: 'dashscope',
    displayName: 'Qwen3.7 Max (DashScope)',
    costPer1MTokens: 0,
    contextWindow: 262144,
    skills: {
      'code-generation': 96,
      'code-review': 94,
      debugging: 94,
      planning: 95,
      documentation: 92,
      testing: 92,
      security: 90,
      performance: 90,
      synthesis: 95,
      speed: 70,
      'context-length': 98,
    },
    notes: 'Canonical DashScope ID verified from Qwen Cloud docs on 2026-05-22. Routed direct to Alibaba DashScope (Singapore intl / ap-southeast-1) via DASHSCOPE_API_KEY. Pricing placeholder pending Alibaba intl endpoint pricing.',
  },
};

/**
 * Get capability profile for a model
 */
export function getModelCapability(model: ModelId): ModelCapability {
  const capability = MODEL_CAPABILITIES[model as CapabilityModelId];
  if (!capability) {
    throw new Error(`No capability profile registered for model: ${model}`);
  }
  return capability;
}

export function hasModelCapability(model: ModelId): boolean {
  return model in MODEL_CAPABILITIES;
}

/**
 * Get all models sorted by a specific skill (descending)
 */
export function getModelsBySkill(skill: SkillDimension): ModelId[] {
  return (Object.keys(MODEL_CAPABILITIES) as CapabilityModelId[]).sort(
    (a, b) => MODEL_CAPABILITIES[b].skills[skill] - MODEL_CAPABILITIES[a].skills[skill]
  );
}

/**
 * Get all models for a provider
 */
export function getModelsForProvider(
  provider: ModelCapability['provider']
): ModelId[] {
  return (Object.keys(MODEL_CAPABILITIES) as CapabilityModelId[]).filter(
    (model) => MODEL_CAPABILITIES[model].provider === provider
  );
}

/**
 * Get cheapest models (sorted by cost ascending)
 */
export function getCheapestModels(): ModelId[] {
  return (Object.keys(MODEL_CAPABILITIES) as CapabilityModelId[]).sort(
    (a, b) => MODEL_CAPABILITIES[a].costPer1MTokens - MODEL_CAPABILITIES[b].costPer1MTokens
  );
}

/**
 * Calculate cost efficiency score for a skill
 * Higher = better value (skill score / cost)
 */
export function getValueScore(model: ModelId, skill: SkillDimension): number {
  const cap = getModelCapability(model);
  return cap.skills[skill] / Math.log10(cap.costPer1MTokens + 1);
}

/**
 * Get all skill dimensions
 */
export function getAllSkillDimensions(): SkillDimension[] {
  return [
    'code-generation',
    'code-review',
    'debugging',
    'planning',
    'documentation',
    'testing',
    'security',
    'performance',
    'synthesis',
    'speed',
    'context-length',
  ];
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// All capability queries are pure lookups — additive Effect.sync wrappers.

/** Resolve a (possibly-deprecated) model id to its canonical id. Pure. */
export const resolveModelIdEffect = (modelId: string): Effect.Effect<ModelId> =>
  Effect.sync(() => resolveModelId(modelId));

/** Look up a model's capability matrix. Pure. */
export const getModelCapabilityEffect = (
  model: ModelId,
): Effect.Effect<ModelCapability> => Effect.sync(() => getModelCapability(model));

/** List models ranked best-first for a given skill. Pure. */
export const getModelsBySkillEffect = (
  skill: SkillDimension,
): Effect.Effect<ModelId[]> => Effect.sync(() => getModelsBySkill(skill));

/** List models for a specific provider. Pure. */
export const getModelsForProviderEffect = (
  provider: ModelCapability['provider'],
): Effect.Effect<ModelId[]> => Effect.sync(() => getModelsForProvider(provider));

/** List the cheapest models ranked best-first. Pure. */
export const getCheapestModelsEffect = (): Effect.Effect<ModelId[]> =>
  Effect.sync(() => getCheapestModels());

/** Compute the cost-adjusted value score for a model + skill. Pure. */
export const getValueScoreEffect = (
  model: ModelId,
  skill: SkillDimension,
): Effect.Effect<number> => Effect.sync(() => getValueScore(model, skill));

/** Enumerate all known skill dimensions. Pure. */
export const getAllSkillDimensionsEffect = (): Effect.Effect<SkillDimension[]> =>
  Effect.sync(() => getAllSkillDimensions());
