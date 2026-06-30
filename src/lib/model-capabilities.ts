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
 * Last updated: 2026-06-30
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
  // OpenAI retired/superseded models — addendum 2026-05-23 trim to the
  // Codex CLI catalog (gpt-5.5, 5.4, 5.4-mini, 5.3-codex, 5.3-codex-spark,
  // 5.2). Pro tiers and the o-series reasoning models are out.
  'gpt-5.2-codex': 'gpt-5.3-codex',     // superseded by gpt-5.3-codex (April 2026)
  'gpt-5.5-mini': 'gpt-5.4-mini',       // hallucinated tier — never shipped
  'gpt-5.5-nano': 'gpt-5.4-mini',       // hallucinated tier — never shipped
  'gpt-5.4-nano': 'gpt-5.4-mini',       // hallucinated tier — never shipped
  'gpt-5.5-pro': 'gpt-5.5',             // dropped 2026-05-23 — flagship absorbs Pro role
  'gpt-5.4-pro': 'gpt-5.4',             // dropped 2026-05-23 — drop the -pro tier
  'o3': 'gpt-5.4',                      // dropped 2026-05-23 — reasoning -> balanced flagship
  'o3-deep-research': 'gpt-5.4',        // dropped 2026-05-23 — was already aliased to o3
  'o4-mini': 'gpt-5.4-mini',            // dropped 2026-05-23 — compact reasoning -> mini
  'gpt-4o': 'gpt-5.4',                  // dropped 2026-05-23 — legacy flagship -> current balanced
  'gpt-4o-mini': 'gpt-5.4-mini',        // dropped 2026-05-23 — legacy economy -> mini
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
export function resolveModelIdSync(modelId: string): ModelId {
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
 * Canonical effort/reasoning levels accepted by Claude Code's `--effort` flag.
 * `xhigh` was added in Opus 4.7 (between `high` and `max`); `max` predates it
 * (Opus 4.6+/Sonnet 4.6). This is the single source of truth for the union —
 * `RoleEffort` in config-yaml.ts aliases it.
 */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Capability profile for a single model
 */
type CapabilityModelId = ModelId;

/**
 * Conservative effective ceiling for Codex/ChatGPT subscription models routed
 * through CLIProxy into Claude Code. Claude Code's native auto-compact path does
 * not know the proxied model's larger marketing window; the harness status line
 * reports a 200.0k budget for gpt-5.5 sessions, and PAN-1615 observed hard
 * `input exceeds the context window` 400s instead of a native pre-ceiling
 * compaction. See the context-overflow recovery note in
 * `src/lib/cloister/deacon.ts` for why the deacon owns this recovery path.
 *
 * PAN-1672: 200k is gpt-5.5's *marketing* window, not its effective one via
 * CLIProxy — the backend 400s with `input exceeds the context window` well
 * before 85% of 200k (≈170k) is reached, so proactive compaction (keyed to this
 * budget at CONTEXT_PROACTIVE_COMPACT_HIGH_WATER_PERCENT) never fires in time
 * and agents hard-wedge. Set a conservative effective ceiling so the 85%
 * high-water (≈127.5k) lands comfortably below the real failure zone. Tune up
 * if gpt-5.5's true CLIProxy window is later measured to be higher.
 */
export const CLIPROXY_CODEX_CONTEXT_WINDOW = 150_000;

export interface ModelCapability {
  /** Model identifier */
  model: ModelId;
  /** Provider for this model */
  provider: 'anthropic' | 'openai' | 'google' | 'kimi' | 'minimax' | 'openrouter' | 'zai' | 'mimo' | 'nous' | 'dashscope' | 'xai';
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
  /**
   * Effort levels this model accepts via Claude Code's `--effort` flag.
   * Undefined means the levels aren't enumerated for this model — callers treat
   * that as "no model-specific restriction" and accept the full {@link EffortLevel}
   * set. Populate only where there's ground truth (see docs/research/*-work-type-fit.md).
   */
  effortLevels?: readonly EffortLevel[];
  /**
   * Whether this model accepts image input (vision) on the endpoint Overdeck
   * routes it through. Tri-state by design:
   *   - `false` — proven text-only; image attachments must be blocked.
   *   - `true`  — proven to accept images.
   *   - `undefined` — not yet verified; callers treat as "allow" and rely on
   *     the harness/provider to error if unsupported. Only populate from ground
   *     truth (a real request against the live endpoint), never from marketing
   *     copy — e.g. mimo-v2.5-pro's architecture is multimodal but its Token-Plan
   *     serving endpoints are text-only (PAN-1685). Most models are intentionally
   *     left undefined pending the per-model vision audit in PAN-1685.
   */
  supportsImages?: boolean;
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

  'claude-fable-5': {
    model: 'claude-fable-5',
    provider: 'anthropic',
    displayName: 'Claude Fable 5',
    // Real API pricing is $10/M input, $50/M output (≈2× Opus 4.8). The blended
    // figure mirrors the inflated Opus-4.8 baseline (45) at the same 2× ratio so
    // cost-awareness badges order Fable above Opus. Exact per-token rates live in
    // cost.ts DEFAULT_PRICING.
    costPer1MTokens: 90.0,
    contextWindow: 200000,
    skills: {
      'code-generation': 99,
      'code-review': 99,
      debugging: 99,
      planning: 99,
      documentation: 97,
      testing: 96,
      security: 99,
      performance: 95,
      synthesis: 99,
      speed: 42,
      'context-length': 95,
    },
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    notes: 'Mythos-class flagship (June 2026). Tuned for long-horizon autonomous work spanning millions of tokens. Beats Opus 4.8 across effort levels; same effort set (high is the default, xhigh between high and max). Adaptive thinking always on. Premium pricing (~2× Opus 4.8) — opt-in for the most demanding planning/coding.',
  },

  'claude-opus-4-8': {
    model: 'claude-opus-4-8',
    provider: 'anthropic',
    displayName: 'Claude Opus 4.8',
    costPer1MTokens: 45.0, // Same pricing tier as Opus 4.7/4.6 — verify at launch
    contextWindow: 200000,
    skills: {
      'code-generation': 98,
      'code-review': 99,
      debugging: 98,
      planning: 99,
      documentation: 96,
      testing: 95,
      security: 99,
      performance: 93,
      synthesis: 99,
      speed: 40,
      'context-length': 95,
    },
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    notes: 'Successor to Opus 4.7 and current flagship. Same effort levels (xhigh between high and max). Best for deepest reasoning and long-horizon coding tasks. Scores provisional — verify against benchmarks.',
  },

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
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    notes: 'Successor to Opus 4.6. Adds the xhigh effort level (between high and max) for extended thinking. Best for deepest reasoning and long-horizon coding tasks.',
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
    effortLevels: ['low', 'medium', 'high', 'max'],
    notes: 'Successor to Opus 4.5. Same pricing, 1M context available (opt-in beta). Best for planning, security, complex reasoning.',
  },

  'claude-sonnet-5': {
    model: 'claude-sonnet-5',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 5',
    // Introductory pricing through 2026-08-31: $2/M input, $10/M output.
    // Standard pricing starts 2026-09-01: $3/M input, $15/M output.
    costPer1MTokens: 6.0,
    contextWindow: 1000000,
    skills: {
      'code-generation': 96,
      'code-review': 96,
      debugging: 94,
      planning: 92,
      documentation: 94,
      testing: 94,
      security: 90,
      performance: 90,
      synthesis: 92,
      speed: 70,
      'context-length': 95,
    },
    effortLevels: ['low', 'medium', 'high'],
    notes: 'Current Sonnet generation (June 2026). Balanced native Anthropic model for implementation, review, testing, and routine agent work. 1M context at standard pricing; introductory pricing through 2026-08-31 is $2/M input and $10/M output, then $3/M input and $15/M output from 2026-09-01. Scores are provisional until benchmarks are verified.',
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
    effortLevels: ['low', 'medium', 'high'],
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
    contextWindow: CLIPROXY_CODEX_CONTEXT_WINDOW,
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
      'context-length': 95,
    },
    notes: 'OpenAI flagship (April 2026). Successor to GPT-5.4 with improved reasoning and coding. Effective Claude Code/CLIProxy ceiling is 150K (CLIPROXY_CODEX_CONTEXT_WINDOW), 128K max output.',
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
    notes: 'Previous-generation general-purpose model (Oct 2025). Positioned by OpenAI for long-running agent workloads — strong candidate for orchestrator/flywheel roles.',
  },

  'gpt-5.3-codex-spark': {
    model: 'gpt-5.3-codex-spark',
    provider: 'openai',
    displayName: 'GPT-5.3 Codex Spark',
    // Headline rate card matches the Codex family ($1.75 in / $14 out) when
    // the model is reachable, but Spark is a ChatGPT-Pro-only research
    // preview as of 2026-05-23 — no raw API access. Overdeck routes via
    // Codex CLI subscription auth through CLIProxy, so it is reachable
    // when the operator has a Pro account.
    costPer1MTokens: 7.875,
    contextWindow: 128000, // 128K per OpenAI excerpt + multiple secondary sources
    skills: {
      'code-generation': 92,
      'code-review': 86,
      debugging: 84,
      planning: 78,
      documentation: 82,
      testing: 88,
      security: 76,
      performance: 82,
      synthesis: 84,
      speed: 98, // "1000+ tok/sec" per OpenAI launch material
      'context-length': 72, // 128K — smaller than the Codex base 400K
    },
    notes: 'Ultra-fast coding research preview (Feb 2026). Text-only, 128K context, ChatGPT-Pro-only. Candidate for work.inspect / high-volume code scans when a Pro account is available.',
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

  'kimi-k2.7-code': {
    model: 'kimi-k2.7-code',
    provider: 'kimi',
    displayName: 'Kimi K2.7 Code',
    costPer1MTokens: 2.5, // $0.95 in (cache-miss) / $4.00 out; $0.19 in (cache-hit)
    contextWindow: 262144,
    skills: {
      'code-generation': 95, // Coding-first flagship, surpasses K2.6
      'code-review': 93,
      debugging: 93,
      planning: 90,
      documentation: 90,
      testing: 90,
      security: 85,
      performance: 88,
      synthesis: 94, // Long-horizon agentic task decomposition
      speed: 75, // MoE: 1T total params, 32B active
      'context-length': 98, // 262K context
    },
    notes: 'Moonshot/Kimi\'s coding-first open-weight model (June 2026). 1T MoE / 32B active, multimodal, extended thinking modes. API id `kimi-k2.7-code`. Source: https://platform.moonshot.ai/docs/pricing/chat',
  },

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

  'MiniMax-M3': {
    model: 'MiniMax-M3',
    provider: 'minimax',
    displayName: 'MiniMax M3',
    costPer1MTokens: 1.5, // Same $0.30/M in / $1.20/M out blended as M2.7; confirm at launch
    contextWindow: 1024000, // 1M context via MSA architecture
    skills: {
      'code-generation': 93, // Top-tier coding; MSA architecture for scalable context
      'code-review': 90,
      debugging: 90,
      planning: 88,
      documentation: 88,
      testing: 88,
      security: 82,
      performance: 85,
      synthesis: 92,
      speed: 80,
      'context-length': 100, // 1M context
    },
    notes: 'MSA (MiniMax Sparse Attention), 1M context, native multimodal, top-tier coding/agentic. Same pricing as M2.7.',
  },

  // Z.AI models
  'glm-5.2': {
    model: 'glm-5.2',
    provider: 'zai',
    displayName: 'GLM-5.2',
    // $1.4 in / $4.4 out → avg $2.9 (docs.z.ai/guides/overview/pricing). PAN-1956.
    costPer1MTokens: 2.9,
    // 1M input context per Z.AI docs (docs.z.ai/guides/llm/glm-5.2 spec table:
    // "Context Length: 1M", "Maximum Output Tokens: 128K"). PAN-1956 — the prior
    // 128000 was the max *output* limit misread as the input context window.
    contextWindow: 1000000,
    // GLM-5.2 exposes only two reasoning efforts (high and max); lower/xhigh
    // levels are rejected by the role effort validator.
    effortLevels: ['high', 'max'],
    // Text-only: Z.AI's spec table lists Input/Output Modalities as "Text", and
    // vision lives in a separate model line (GLM-5V-Turbo, GLM-4.6V, GLM-OCR) —
    // same text-only profile as the GLM-5.1 predecessor (PAN-1685 audit).
    supportsImages: false,
    skills: {
      'code-generation': 85,
      'code-review': 83,
      debugging: 83,
      planning: 81,
      documentation: 80,
      testing: 80,
      security: 77,
      performance: 77,
      synthesis: 82,
      speed: 84,
      'context-length': 75,
    },
    notes: 'Z.AI GLM-5.2 flagship via Anthropic-compatible API. Supports only high and max effort levels. Scores provisional — verify against benchmarks.',
  },

  'glm-5.1': {
    model: 'glm-5.1',
    provider: 'zai',
    displayName: 'GLM-5.1',
    // $1.4 in / $4.4 out → avg $2.9 (docs.z.ai/guides/overview/pricing). PAN-1956.
    costPer1MTokens: 2.9,
    // 200K input context per Z.AI docs (docs.z.ai/guides/llm/glm-5.1 spec table:
    // "Context Length: 200K", "Maximum Output Tokens: 128K"). PAN-1956 — the prior
    // 128000 was the max *output* limit misread as the input context window.
    contextWindow: 200000,
    // Text-only: Z.AI's spec table lists Input/Output Modalities as "Text", and
    // vision lives in a separate model line (GLM-5V-Turbo, GLM-4.6V, GLM-OCR).
    // Confirmed in docs/research/glm-5.1-work-type-fit.md (PAN-1685 audit).
    supportsImages: false,
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
    notes: 'Z.AI GLM-5.1 model via Anthropic-compatible API. Previous flagship; retained alongside GLM-5.2.',
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
    // Text-only on the Xiaomi Token-Plan serving endpoints: an image request
    // returns 404 "No endpoints found that support image input". The model's
    // architecture is multimodal, but the served -pro endpoints are not. PAN-1685.
    supportsImages: false,
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
    // Multimodal — verified to accept image input on the same Token-Plan
    // endpoint where -pro rejects it. PAN-1685.
    supportsImages: true,
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

  // ═══════════════════════════════════════════════════════════════════════════
  // XAI (GROK) MODELS
  // ═══════════════════════════════════════════════════════════════════════════

  'grok-build-0.1': {
    model: 'grok-build-0.1',
    provider: 'xai',
    displayName: 'Grok Build 0.1',
    costPer1MTokens: 1.5, // $1.00/M in, $2.00/M out, $0.20/M cached in
    contextWindow: 256000,
    supportsImages: true, // text + image input per xAI docs (May 2026)
    skills: {
      'code-generation': 90, // purpose-trained agentic coding model
      'code-review': 88,
      debugging: 88,
      planning: 87, // plan-mode built into the CLI; reasoning always active
      documentation: 85,
      testing: 86,
      security: 82,
      performance: 84,
      synthesis: 88, // multi-agent parallel subagent support (up to 8)
      speed: 82, // fast coding variant per xAI naming
      'context-length': 97, // 256K context window
    },
    notes: 'xAI\'s agentic coding model (May 2026). 256K context, $1/M in / $2/M out / $0.20/M cached. Reasoning always active. API id `grok-build-0.1` at https://api.x.ai/v1 (Anthropic-compatible). Sources: openrouter.ai/x-ai/grok-build-0.1/api, x.ai/news/grok-build-cli.',
  },
};

/**
 * Get capability profile for a model
 */
export function getModelCapabilitySync(model: ModelId): ModelCapability {
  const capability = MODEL_CAPABILITIES[model as CapabilityModelId];
  if (!capability) {
    throw new Error(`No capability profile registered for model: ${model}`);
  }
  return capability;
}

export function hasModelCapabilitySync(model: ModelId | string): boolean {
  return model in MODEL_CAPABILITIES;
}

/**
 * Effort levels a model accepts, or `undefined` when not enumerated for that
 * model (treat undefined as "no model-specific restriction"). Resolves
 * deprecated IDs first so callers can pass raw config refs.
 */
export function getModelEffortLevelsSync(model: ModelId | string): readonly EffortLevel[] | undefined {
  const resolved = resolveModelIdSync(String(model));
  return MODEL_CAPABILITIES[resolved as CapabilityModelId]?.effortLevels;
}

/**
 * Whether a model accepts the given effort level. Returns true when the model
 * has no enumerated effort levels (permissive fallback — see {@link getModelEffortLevelsSync}).
 */
export function modelSupportsEffortSync(model: ModelId | string, effort: EffortLevel): boolean {
  const levels = getModelEffortLevelsSync(model);
  return levels === undefined || levels.includes(effort);
}

/**
 * Whether image attachments may be sent to a model. Permissive by design:
 * returns `false` ONLY for models proven text-only (`supportsImages === false`);
 * `true` and unverified (`undefined`) both allow, so the harness/provider stays
 * the final authority for unaudited models. Resolves deprecated IDs first.
 * See {@link ModelCapability.supportsImages} and PAN-1685.
 */
export function modelSupportsImagesSync(model: ModelId | string): boolean {
  const resolved = resolveModelIdSync(String(model));
  return MODEL_CAPABILITIES[resolved as CapabilityModelId]?.supportsImages !== false;
}

/**
 * Get all models sorted by a specific skill (descending)
 */
export function getModelsBySkillSync(skill: SkillDimension): ModelId[] {
  return (Object.keys(MODEL_CAPABILITIES) as CapabilityModelId[]).sort(
    (a, b) => MODEL_CAPABILITIES[b].skills[skill] - MODEL_CAPABILITIES[a].skills[skill]
  );
}

/**
 * Get all models for a provider
 */
export function getModelsForProviderSync(
  provider: ModelCapability['provider']
): ModelId[] {
  return (Object.keys(MODEL_CAPABILITIES) as CapabilityModelId[]).filter(
    (model) => MODEL_CAPABILITIES[model].provider === provider
  );
}

/**
 * Get cheapest models (sorted by cost ascending)
 */
export function getCheapestModelsSync(): ModelId[] {
  return (Object.keys(MODEL_CAPABILITIES) as CapabilityModelId[]).sort(
    (a, b) => MODEL_CAPABILITIES[a].costPer1MTokens - MODEL_CAPABILITIES[b].costPer1MTokens
  );
}

/**
 * Calculate cost efficiency score for a skill
 * Higher = better value (skill score / cost)
 */
export function getValueScoreSync(model: ModelId, skill: SkillDimension): number {
  const cap = getModelCapabilitySync(model);
  return cap.skills[skill] / Math.log10(cap.costPer1MTokens + 1);
}

/**
 * Get all skill dimensions
 */
export function getAllSkillDimensionsSync(): SkillDimension[] {
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
export const resolveModelId = (modelId: string): Effect.Effect<ModelId> =>
  Effect.sync(() => resolveModelIdSync(modelId));

/** Look up a model's capability matrix. Pure. */
export const getModelCapability = (
  model: ModelId,
): Effect.Effect<ModelCapability> => Effect.sync(() => getModelCapabilitySync(model));

/** List models ranked best-first for a given skill. Pure. */
export const getModelsBySkill = (
  skill: SkillDimension,
): Effect.Effect<ModelId[]> => Effect.sync(() => getModelsBySkillSync(skill));

/** List models for a specific provider. Pure. */
export const getModelsForProvider = (
  provider: ModelCapability['provider'],
): Effect.Effect<ModelId[]> => Effect.sync(() => getModelsForProviderSync(provider));

/** List the cheapest models ranked best-first. Pure. */
export const getCheapestModels = (): Effect.Effect<ModelId[]> =>
  Effect.sync(() => getCheapestModelsSync());

/** Compute the cost-adjusted value score for a model + skill. Pure. */
export const getValueScore = (
  model: ModelId,
  skill: SkillDimension,
): Effect.Effect<number> => Effect.sync(() => getValueScoreSync(model, skill));

/** Enumerate all known skill dimensions. Pure. */
export const getAllSkillDimensions = (): Effect.Effect<SkillDimension[]> =>
  Effect.sync(() => getAllSkillDimensionsSync());
