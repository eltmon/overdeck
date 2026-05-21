/**
 * Smart Model Selector
 *
 * Intelligently selects the best model for each work type based on:
 * 1. What models the user has enabled (API keys configured)
 * 2. Capability scores for the required skills
 *
 * This is an opinionated system - always pick the BEST model for each job.
 * Users control cost by which providers they enable, not a sensitivity slider.
 */

import { Effect } from 'effect';
import { ModelId } from './settings.js';
import {
  MODEL_CAPABILITIES,
  SkillDimension,
  ModelCapability,
  getModelCapability,
} from './model-capabilities.js';
import type { SubscriptionPlan } from './subscription-types.js';

/**
 * Tier rank for comparison: undefined = accessible to all, then free < plus < pro
 */
const TIER_RANK: Record<SubscriptionPlan | 'none', number> = {
  none: -1, // minTier undefined: accessible to all authenticated users
  free: 0,
  plus: 1,
  pro: 2,
};

/**
 * Skill requirements for a work type
 * Higher weight = more important for this task
 */
export interface SkillRequirement {
  skill: SkillDimension;
  weight: number; // 0-1, how important this skill is
}

/**
 * Work type to skill mapping
 * Defines what skills each work type needs
 */
export const WORK_TYPE_REQUIREMENTS: Record<string, SkillRequirement[]> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // ISSUE AGENT PHASES
  // ═══════════════════════════════════════════════════════════════════════════

  'role-plan': [
    { skill: 'speed', weight: 0.4 }, // Need fast exploration
    { skill: 'context-length', weight: 0.3 }, // Large codebases
    { skill: 'synthesis', weight: 0.3 }, // Understanding structure
  ],

  'role-work': [
    { skill: 'code-generation', weight: 0.6 }, // Primary skill
    { skill: 'debugging', weight: 0.2 }, // Avoiding bugs
    { skill: 'testing', weight: 0.2 }, // Writing testable code
  ],

  'role-test': [
    { skill: 'testing', weight: 0.5 }, // Primary skill
    { skill: 'code-generation', weight: 0.3 }, // Writing test code
    { skill: 'debugging', weight: 0.2 }, // Finding edge cases
  ],

  'role-work-docs': [
    { skill: 'documentation', weight: 0.6 }, // Primary skill
    { skill: 'synthesis', weight: 0.3 }, // Summarizing
    { skill: 'speed', weight: 0.1 }, // Fast iteration
  ],

  'role-work-review-response': [
    { skill: 'code-review', weight: 0.4 }, // Understanding feedback
    { skill: 'code-generation', weight: 0.3 }, // Making fixes
    { skill: 'debugging', weight: 0.3 }, // Finding issues
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // SPECIALIST AGENTS
  // ═══════════════════════════════════════════════════════════════════════════

  'role-review': [
    { skill: 'code-review', weight: 0.5 }, // Primary skill
    { skill: 'security', weight: 0.25 }, // Security awareness
    { skill: 'performance', weight: 0.25 }, // Performance awareness
  ],

  'role-test-runner': [
    { skill: 'testing', weight: 0.5 }, // Primary skill
    { skill: 'code-generation', weight: 0.3 }, // Writing tests
    { skill: 'debugging', weight: 0.2 }, // Finding issues
  ],

  'role-ship': [
    { skill: 'code-review', weight: 0.4 }, // Understanding conflicts
    { skill: 'synthesis', weight: 0.3 }, // Merging changes
    { skill: 'debugging', weight: 0.3 }, // Resolving issues
  ],

  'role-work-inspect': [
    { skill: 'code-review', weight: 0.4 }, // Compare implementation to bead/spec
    { skill: 'debugging', weight: 0.3 }, // Catch regressions and bad diffs
    { skill: 'testing', weight: 0.3 }, // Compile/smoke verification
  ],

  'role-test-uat': [
    { skill: 'testing', weight: 0.4 }, // Browser verification is primary
    { skill: 'debugging', weight: 0.3 }, // Investigating console/network failures
    { skill: 'documentation', weight: 0.3 }, // Requirement coverage and evidence capture
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // SUBAGENTS
  // ═══════════════════════════════════════════════════════════════════════════

  'helper-explore': [
    { skill: 'speed', weight: 0.5 }, // Need speed
    { skill: 'context-length', weight: 0.3 }, // Large scope
    { skill: 'synthesis', weight: 0.2 }, // Quick understanding
  ],

  'helper-plan': [
    { skill: 'planning', weight: 0.5 }, // Primary skill
    { skill: 'synthesis', weight: 0.3 }, // Combining info
    { skill: 'speed', weight: 0.2 }, // Quick iteration
  ],

  'helper-bash': [
    { skill: 'speed', weight: 0.6 }, // Fast execution
    { skill: 'code-generation', weight: 0.3 }, // Command generation
    { skill: 'debugging', weight: 0.1 }, // Error handling
  ],

  'helper-general-purpose': [
    { skill: 'speed', weight: 0.3 }, // Balanced
    { skill: 'synthesis', weight: 0.3 }, // General understanding
    { skill: 'code-generation', weight: 0.4 }, // General tasks
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // REVIEW AGENTS
  // ═══════════════════════════════════════════════════════════════════════════

  'review-security': [
    { skill: 'security', weight: 0.7 }, // PRIMARY - never compromise
    { skill: 'code-review', weight: 0.2 }, // Code understanding
    { skill: 'debugging', weight: 0.1 }, // Finding vulnerabilities
  ],

  'review-performance': [
    { skill: 'performance', weight: 0.6 }, // Primary skill
    { skill: 'code-review', weight: 0.3 }, // Code understanding
    { skill: 'debugging', weight: 0.1 }, // Finding bottlenecks
  ],

  'review-correctness': [
    { skill: 'code-review', weight: 0.4 }, // Primary skill
    { skill: 'debugging', weight: 0.4 }, // Finding bugs
    { skill: 'testing', weight: 0.2 }, // Test coverage
  ],

  'review-requirements': [
    { skill: 'planning', weight: 0.4 },    // Mapping requirements to code
    { skill: 'code-review', weight: 0.4 }, // Understanding what code does
    { skill: 'documentation', weight: 0.2 }, // Reading vBRIEF structure
  ],

  'review-synthesis': [
    { skill: 'synthesis', weight: 0.6 }, // Primary skill
    { skill: 'documentation', weight: 0.2 }, // Clear writing
    { skill: 'planning', weight: 0.2 }, // Organizing findings
  ],

  'review-lightweight': [
    { skill: 'speed', weight: 0.5 }, // Speed-first: resolves to haiku-tier
    { skill: 'code-review', weight: 0.3 }, // Basic code understanding
    { skill: 'debugging', weight: 0.2 }, // Lightweight issue spotting
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // PRE-WORK AGENTS
  // ═══════════════════════════════════════════════════════════════════════════

  'planning-agent': [
    { skill: 'planning', weight: 0.5 }, // Primary skill
    { skill: 'synthesis', weight: 0.3 }, // Combining requirements
    { skill: 'documentation', weight: 0.2 }, // Documenting decisions
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // WORKFLOW JOBS
  // ═══════════════════════════════════════════════════════════════════════════

  'status-review': [
    { skill: 'synthesis', weight: 0.4 }, // Summarize current planning state
    { skill: 'planning', weight: 0.4 }, // Judge progress vs intended plan
    { skill: 'documentation', weight: 0.2 }, // Write clear executive summary
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // CLI CONTEXTS
  // ═══════════════════════════════════════════════════════════════════════════

  'cli-interactive': [
    { skill: 'speed', weight: 0.4 }, // Responsive
    { skill: 'synthesis', weight: 0.3 }, // Understanding context
    { skill: 'code-generation', weight: 0.3 }, // Quick code
  ],

  'cli-quick-command': [
    { skill: 'speed', weight: 0.7 }, // Must be fast
    { skill: 'code-generation', weight: 0.2 }, // Simple generation
    { skill: 'synthesis', weight: 0.1 }, // Quick understanding
  ],

  'tts:summarizer': [
    { skill: 'speed', weight: 0.5 }, // Low latency for real-time TTS
    { skill: 'synthesis', weight: 0.4 }, // Condensing activity into brief utterances
    { skill: 'documentation', weight: 0.1 }, // Clear, speakable output
  ],
};

/**
 * Selection result with explanation
 */
export interface ModelSelectionResult {
  /** Selected model */
  model: ModelId;
  /** Score that led to selection (0-100) */
  score: number;
  /** Why this model was selected */
  reason: string;
  /** All candidates that were considered */
  candidates: Array<{
    model: ModelId;
    score: number;
    available: boolean;
  }>;
}

/**
 * Selection options
 */
export interface SelectionOptions {
  /**
   * Minimum capability threshold (0-100)
   * Models below this score are excluded
   * Default: 50
   */
  minCapability?: number;

  /**
   * Force a specific model (bypass selection)
   */
  forceModel?: ModelId;

  /**
   * User's subscription tier (for OAuth-authenticated providers).
   * Models with minTier > userTier are excluded from selection.
   * Undefined means API key auth (only minTier: undefined models accessible).
   */
  userTier?: SubscriptionPlan;
}

/**
 * Calculate weighted skill score for a model given requirements
 */
function calculateSkillScore(
  model: ModelId,
  requirements: SkillRequirement[]
): number {
  const cap = getModelCapability(model);
  let totalScore = 0;
  let totalWeight = 0;

  for (const req of requirements) {
    totalScore += cap.skills[req.skill] * req.weight;
    totalWeight += req.weight;
  }

  return totalWeight > 0 ? totalScore / totalWeight : 0;
}

/**
 * Calculate final selection score - pure capability based
 *
 * We're opinionated: always pick the BEST model for the job.
 * Users control cost by which providers they enable.
 */
function calculateSelectionScore(
  model: ModelId,
  skillScore: number
): number {
  // Pure quality - just return the skill score
  // Cost control is done by which providers the user enables
  return skillScore;
}

/**
 * Check if a model is accessible at the given user tier.
 * - Models with minTier: undefined are accessible to all authenticated users
 * - Models with minTier: 'free' are accessible to free/plus/pro tiers
 * - Models with minTier: 'plus' are accessible to plus/pro tiers only
 * - Models with minTier: 'pro' are accessible to pro tier only
 */
function isAccessibleAtTier(
  modelTier: SubscriptionPlan | undefined,
  userTier: SubscriptionPlan | undefined
): boolean {
  const modelRank = modelTier !== undefined ? TIER_RANK[modelTier] : TIER_RANK.none;
  // undefined userTier = API key auth: only models with no tier restriction (rank -1)
  // defined userTier: only models where modelRank <= userRank
  if (userTier === undefined) {
    return modelRank === TIER_RANK.none;
  }
  return modelRank <= TIER_RANK[userTier];
}

/**
 * Select the best model for a work type from available models
 */
export function selectModel(
  workType: string,
  availableModels: ModelId[],
  options: SelectionOptions = {}
): ModelSelectionResult {
  const { minCapability = 50, forceModel, userTier } = options;

  // Force model if specified and available
  if (forceModel) {
    if (availableModels.includes(forceModel)) {
      return {
        model: forceModel,
        score: 100,
        reason: `Forced selection: ${forceModel}`,
        candidates: [{ model: forceModel, score: 100, available: true }],
      };
    }
    // Fall through to normal selection if forced model not available
  }

  const requirements = WORK_TYPE_REQUIREMENTS[workType];
  const allModels = Object.keys(MODEL_CAPABILITIES) as ModelId[];

  // Calculate scores for all models - pure capability based
  // Users control cost by which providers they enable
  const candidates = allModels.map((model) => {
    const skillScore = calculateSkillScore(model, requirements);
    const selectionScore = calculateSelectionScore(model, skillScore);
    const available = availableModels.includes(model);

    return {
      model,
      skillScore,
      score: selectionScore,
      available,
    };
  });

  // Filter to available models with minimum capability and tier access
  const eligible = candidates.filter((c) => {
    if (!c.available || c.skillScore < minCapability) return false;
    if (userTier === undefined) return true; // caller responsible for tier filtering
    const cap = getModelCapability(c.model);
    return isAccessibleAtTier(cap.minTier, userTier);
  });

  // Sort by selection score (descending)
  eligible.sort((a, b) => b.score - a.score);

  // Fallback: if no eligible models, use best available regardless of threshold
  if (eligible.length === 0) {
    const fallback = candidates
      .filter((c) => c.available)
      .sort((a, b) => b.score - a.score)[0];

    if (!fallback) {
      // No available models at all - use Anthropic default
      return {
        model: 'claude-sonnet-4-6',
        score: 0,
        reason: 'No models available, falling back to default',
        candidates: candidates.map((c) => ({
          model: c.model,
          score: c.score,
          available: c.available,
        })),
      };
    }

    return {
      model: fallback.model,
      score: fallback.score,
      reason: `Best available (below min threshold): ${fallback.model}`,
      candidates: candidates.map((c) => ({
        model: c.model,
        score: c.score,
        available: c.available,
      })),
    };
  }

  const selected = eligible[0];
  const cap = getModelCapability(selected.model);

  // Generate reason
  const topSkills = requirements
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2)
    .map((r) => r.skill);

  const reason = `Best for ${workType}: ${cap.displayName} (${topSkills.join(', ')}: ${Math.round(selected.skillScore)}, cost: $${cap.costPer1MTokens}/1M)`;

  return {
    model: selected.model,
    score: selected.score,
    reason,
    candidates: candidates.map((c) => ({
      model: c.model,
      score: c.score,
      available: c.available,
    })),
  };
}

/**
 * Select models for all work types at once
 */
export function selectAllModels(
  availableModels: ModelId[],
  options: SelectionOptions = {}
): Record<string, ModelSelectionResult> {
  const workTypes = Object.keys(WORK_TYPE_REQUIREMENTS);
  const results: Record<string, ModelSelectionResult> = {};

  for (const workType of workTypes) {
    results[workType] = selectModel(workType, availableModels, options);
  }

  return results;
}

/**
 * Get simple model mapping (for backward compatibility with presets)
 */
export function getSimpleModelMapping(
  availableModels: ModelId[],
  options: SelectionOptions = {}
): Record<string, ModelId> {
  const results = selectAllModels(availableModels, options);
  const mapping: Record<string, ModelId> = {} as Record<string, ModelId>;

  for (const [workType, result] of Object.entries(results)) {
    mapping[workType] = result.model;
  }

  return mapping;
}

/**
 * Pretty print selection results for debugging
 */
export function formatSelectionResults(
  results: Record<string, ModelSelectionResult>
): string {
  const lines: string[] = ['Model Selection Results', '='.repeat(60)];

  for (const [workType, result] of Object.entries(results)) {
    lines.push(`${workType}: ${result.model}`);
    lines.push(`  Reason: ${result.reason}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// These mirror the pure synchronous selectors so callers in Effect graphs can
// stay end-to-end Effect without `Effect.sync`-wrapping every call site.

/** Select the best model for a single work type. Pure. */
export const selectModelEffect = (
  workType: string,
  availableModels: readonly ModelId[],
  options: SelectionOptions = {},
): Effect.Effect<ModelSelectionResult> =>
  Effect.sync(() => selectModel(workType, [...availableModels], options));

/** Select the best model for every known work type. Pure. */
export const selectAllModelsEffect = (
  availableModels: readonly ModelId[],
  options: SelectionOptions = {},
): Effect.Effect<Record<string, ModelSelectionResult>> =>
  Effect.sync(() => selectAllModels([...availableModels], options));

/** Compact map { workType → selected model } for preset compatibility. Pure. */
export const getSimpleModelMappingEffect = (
  availableModels: readonly ModelId[],
  options: SelectionOptions = {},
): Effect.Effect<Record<string, ModelId>> =>
  Effect.sync(() => getSimpleModelMapping([...availableModels], options));
