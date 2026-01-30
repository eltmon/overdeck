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

import { ModelId } from './settings.js';

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
export interface ModelCapability {
  /** Model identifier */
  model: ModelId;
  /** Provider for this model */
  provider: 'anthropic' | 'openai' | 'google' | 'zai' | 'kimi';
  /** Display name */
  displayName: string;
  /** Cost per 1M tokens (average of input/output) in USD */
  costPer1MTokens: number;
  /** Capability scores (0-100) for each skill dimension */
  skills: Record<SkillDimension, number>;
  /** Context window size in tokens */
  contextWindow: number;
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
export const MODEL_CAPABILITIES: Record<ModelId, ModelCapability> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // ANTHROPIC MODELS
  // ═══════════════════════════════════════════════════════════════════════════

  'claude-opus-4-5': {
    model: 'claude-opus-4-5',
    provider: 'anthropic',
    displayName: 'Claude Opus 4.5',
    costPer1MTokens: 45.0, // $15 in / $75 out → avg ~$45
    contextWindow: 200000,
    skills: {
      'code-generation': 96, // 80.9% SWE-bench (first >80%), 89.4% Aider Polyglot
      'code-review': 98,
      debugging: 97,
      planning: 99, // User confirms: "Opus 4.5 planning for sure"
      documentation: 95,
      testing: 92,
      security: 98, // Best for security review
      performance: 90,
      synthesis: 98, // Best for combining info across domains
      speed: 40, // Slower but 76% more token efficient
      'context-length': 95,
    },
    notes: 'First to exceed 80% SWE-bench. Best for planning, security, complex reasoning. Leads 7/8 languages.',
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

  'gpt-5.2-codex': {
    model: 'gpt-5.2-codex',
    provider: 'openai',
    displayName: 'GPT-5.2 Codex',
    costPer1MTokens: 75.0, // Premium tier ~$75/M
    contextWindow: 128000,
    skills: {
      'code-generation': 95, // 80% SWE-bench Verified, 55.6% SWE-bench Pro
      'code-review': 90,
      debugging: 92, // 92.4% GPQA Diamond
      planning: 88,
      documentation: 85,
      testing: 90,
      security: 85,
      performance: 88, // 52.9% ARC-AGI-2 (best reasoning)
      synthesis: 88, // 100% AIME 2025 without tools
      speed: 55,
      'context-length': 75,
    },
    notes: 'Premium coding: 80% SWE-bench. Best raw reasoning (52.9% ARC-AGI-2). Expensive.',
  },

  'o3-deep-research': {
    model: 'o3-deep-research',
    provider: 'openai',
    displayName: 'O3 Deep Research',
    costPer1MTokens: 100.0, // Expensive reasoning model
    contextWindow: 200000,
    skills: {
      'code-generation': 85,
      'code-review': 95,
      debugging: 98, // Best for debugging
      planning: 95,
      documentation: 88,
      testing: 85,
      security: 92,
      performance: 92,
      synthesis: 95,
      speed: 20, // Very slow (reasoning chains)
      'context-length': 95,
    },
    notes: 'Deep reasoning model, excellent for complex debugging and analysis',
  },

  'gpt-4o': {
    model: 'gpt-4o',
    provider: 'openai',
    displayName: 'GPT-4o',
    costPer1MTokens: 15.0, // $5 in / $15 out
    contextWindow: 128000,
    skills: {
      'code-generation': 88,
      'code-review': 85,
      debugging: 85,
      planning: 82,
      documentation: 88,
      testing: 82,
      security: 78,
      performance: 80,
      synthesis: 85,
      speed: 75,
      'context-length': 75,
    },
    notes: 'Good all-rounder, competitive with Sonnet',
  },

  'gpt-4o-mini': {
    model: 'gpt-4o-mini',
    provider: 'openai',
    displayName: 'GPT-4o Mini',
    costPer1MTokens: 1.0, // Very cheap
    contextWindow: 128000,
    skills: {
      'code-generation': 72,
      'code-review': 68,
      debugging: 65,
      planning: 60,
      documentation: 70,
      testing: 65,
      security: 55,
      performance: 60,
      synthesis: 62,
      speed: 92,
      'context-length': 75,
    },
    notes: 'Budget option, good for simple tasks',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GOOGLE MODELS
  // ═══════════════════════════════════════════════════════════════════════════

  'gemini-3-pro-preview': {
    model: 'gemini-3-pro-preview',
    provider: 'google',
    displayName: 'Gemini 3 Pro',
    costPer1MTokens: 12.0, // $4.2 in / $18.9 out
    contextWindow: 1000000, // 1M context!
    skills: {
      'code-generation': 90, // 2439 Elo LiveCodeBench Pro (first >1500 on LMArena)
      'code-review': 88,
      debugging: 85,
      planning: 85,
      documentation: 88,
      testing: 85, // ~95% AIME 2025
      security: 78,
      performance: 85, // Strong multimodal
      synthesis: 90, // Best for combining large codebases
      speed: 80,
      'context-length': 100, // Best context - 1M tokens
    },
    notes: 'First to exceed 1500 Elo on LMArena. Best for large codebase analysis with 1M context.',
  },

  'gemini-3-flash-preview': {
    model: 'gemini-3-flash-preview',
    provider: 'google',
    displayName: 'Gemini 3 Flash',
    costPer1MTokens: 0.5, // Very cheap
    contextWindow: 1000000,
    skills: {
      'code-generation': 75,
      'code-review': 70,
      debugging: 68,
      planning: 62,
      documentation: 72,
      testing: 68,
      security: 55,
      performance: 65,
      synthesis: 70,
      speed: 98, // Fastest overall
      'context-length': 100,
    },
    notes: 'Extremely fast and cheap, huge context, great for exploration',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Z.AI MODELS
  // ═══════════════════════════════════════════════════════════════════════════

  'glm-4.7': {
    model: 'glm-4.7',
    provider: 'zai',
    displayName: 'GLM 4.7',
    costPer1MTokens: 5.0,
    contextWindow: 200000, // 200K context, 128K output
    skills: {
      'code-generation': 88, // 73.8% SWE-bench, 84.9 LiveCodeBench v6 (open-source SOTA)
      'code-review': 85,
      debugging: 85, // Strong debugging with Interleaved Thinking
      planning: 82, // 95.7% AIME 2025 (beats Gemini 3 & GPT-5.1)
      documentation: 80,
      testing: 82, // 87.4 τ²-Bench (SOTA for tool use)
      security: 72,
      performance: 78,
      synthesis: 85, // Preserved Thinking retains context across turns
      speed: 80,
      'context-length': 95, // 200K context
    },
    notes: 'Top open-source for agentic coding. 73.8% SWE-bench, best tool use. 400B params with Interleaved Thinking.',
  },

  'glm-4.7-flash': {
    model: 'glm-4.7-flash',
    provider: 'zai',
    displayName: 'GLM 4.7 Flash',
    costPer1MTokens: 1.5,
    contextWindow: 128000,
    skills: {
      'code-generation': 72,
      'code-review': 68,
      debugging: 65,
      planning: 62,
      documentation: 70,
      testing: 65,
      security: 55,
      performance: 62,
      synthesis: 65,
      speed: 92, // Fast inference
      'context-length': 75,
    },
    notes: 'Fast and affordable. Good for quick iterations and exploration.',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // KIMI MODELS
  // ═══════════════════════════════════════════════════════════════════════════

  'kimi-k2': {
    model: 'kimi-k2',
    provider: 'kimi',
    displayName: 'Kimi K2',
    costPer1MTokens: 1.4, // $0.16 in / $2.63 out → very cheap
    contextWindow: 131000,
    skills: {
      'code-generation': 82, // 65.8% SWE-bench (beats GPT-4.1 at 54.6%)
      'code-review': 80,
      debugging: 78,
      planning: 75,
      documentation: 80,
      testing: 75,
      security: 70,
      performance: 72,
      synthesis: 78,
      speed: 80,
      'context-length': 75,
    },
    notes: 'Strong value: 65.8% SWE-bench at very low cost. Good for routine tasks.',
  },

  'kimi-k2.5': {
    model: 'kimi-k2.5',
    provider: 'kimi',
    displayName: 'Kimi K2.5',
    costPer1MTokens: 8.0, // ~5.1x cheaper than GPT-5.2
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
};

/**
 * Get capability profile for a model
 */
export function getModelCapability(model: ModelId): ModelCapability {
  return MODEL_CAPABILITIES[model];
}

/**
 * Get all models sorted by a specific skill (descending)
 */
export function getModelsBySkill(skill: SkillDimension): ModelId[] {
  return (Object.keys(MODEL_CAPABILITIES) as ModelId[]).sort(
    (a, b) => MODEL_CAPABILITIES[b].skills[skill] - MODEL_CAPABILITIES[a].skills[skill]
  );
}

/**
 * Get all models for a provider
 */
export function getModelsForProvider(
  provider: ModelCapability['provider']
): ModelId[] {
  return (Object.keys(MODEL_CAPABILITIES) as ModelId[]).filter(
    (model) => MODEL_CAPABILITIES[model].provider === provider
  );
}

/**
 * Get cheapest models (sorted by cost ascending)
 */
export function getCheapestModels(): ModelId[] {
  return (Object.keys(MODEL_CAPABILITIES) as ModelId[]).sort(
    (a, b) => MODEL_CAPABILITIES[a].costPer1MTokens - MODEL_CAPABILITIES[b].costPer1MTokens
  );
}

/**
 * Calculate cost efficiency score for a skill
 * Higher = better value (skill score / cost)
 */
export function getValueScore(model: ModelId, skill: SkillDimension): number {
  const cap = MODEL_CAPABILITIES[model];
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
