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

import { ModelId } from './settings.js';
import { WorkTypeId } from './work-types.js';
import {
  MODEL_CAPABILITIES,
  SkillDimension,
  ModelCapability,
  getModelCapability,
} from './model-capabilities.js';

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
export const WORK_TYPE_REQUIREMENTS: Record<WorkTypeId, SkillRequirement[]> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // ISSUE AGENT PHASES
  // ═══════════════════════════════════════════════════════════════════════════

  'issue-agent:exploration': [
    { skill: 'speed', weight: 0.4 }, // Need fast exploration
    { skill: 'context-length', weight: 0.3 }, // Large codebases
    { skill: 'synthesis', weight: 0.3 }, // Understanding structure
  ],

  'issue-agent:planning': [
    { skill: 'planning', weight: 0.5 }, // Primary skill
    { skill: 'code-review', weight: 0.2 }, // Understanding existing code
    { skill: 'synthesis', weight: 0.3 }, // Combining requirements
  ],

  'issue-agent:implementation': [
    { skill: 'code-generation', weight: 0.6 }, // Primary skill
    { skill: 'debugging', weight: 0.2 }, // Avoiding bugs
    { skill: 'testing', weight: 0.2 }, // Writing testable code
  ],

  'issue-agent:testing': [
    { skill: 'testing', weight: 0.5 }, // Primary skill
    { skill: 'code-generation', weight: 0.3 }, // Writing test code
    { skill: 'debugging', weight: 0.2 }, // Finding edge cases
  ],

  'issue-agent:documentation': [
    { skill: 'documentation', weight: 0.6 }, // Primary skill
    { skill: 'synthesis', weight: 0.3 }, // Summarizing
    { skill: 'speed', weight: 0.1 }, // Fast iteration
  ],

  'issue-agent:review-response': [
    { skill: 'code-review', weight: 0.4 }, // Understanding feedback
    { skill: 'code-generation', weight: 0.3 }, // Making fixes
    { skill: 'debugging', weight: 0.3 }, // Finding issues
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // SPECIALIST AGENTS
  // ═══════════════════════════════════════════════════════════════════════════

  'specialist-review-agent': [
    { skill: 'code-review', weight: 0.5 }, // Primary skill
    { skill: 'security', weight: 0.25 }, // Security awareness
    { skill: 'performance', weight: 0.25 }, // Performance awareness
  ],

  'specialist-test-agent': [
    { skill: 'testing', weight: 0.5 }, // Primary skill
    { skill: 'code-generation', weight: 0.3 }, // Writing tests
    { skill: 'debugging', weight: 0.2 }, // Finding issues
  ],

  'specialist-merge-agent': [
    { skill: 'code-review', weight: 0.4 }, // Understanding conflicts
    { skill: 'synthesis', weight: 0.3 }, // Merging changes
    { skill: 'debugging', weight: 0.3 }, // Resolving issues
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // SUBAGENTS
  // ═══════════════════════════════════════════════════════════════════════════

  'subagent:explore': [
    { skill: 'speed', weight: 0.5 }, // Need speed
    { skill: 'context-length', weight: 0.3 }, // Large scope
    { skill: 'synthesis', weight: 0.2 }, // Quick understanding
  ],

  'subagent:plan': [
    { skill: 'planning', weight: 0.5 }, // Primary skill
    { skill: 'synthesis', weight: 0.3 }, // Combining info
    { skill: 'speed', weight: 0.2 }, // Quick iteration
  ],

  'subagent:bash': [
    { skill: 'speed', weight: 0.6 }, // Fast execution
    { skill: 'code-generation', weight: 0.3 }, // Command generation
    { skill: 'debugging', weight: 0.1 }, // Error handling
  ],

  'subagent:general-purpose': [
    { skill: 'speed', weight: 0.3 }, // Balanced
    { skill: 'synthesis', weight: 0.3 }, // General understanding
    { skill: 'code-generation', weight: 0.4 }, // General tasks
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVOY MEMBERS
  // ═══════════════════════════════════════════════════════════════════════════

  'convoy:security-reviewer': [
    { skill: 'security', weight: 0.7 }, // PRIMARY - never compromise
    { skill: 'code-review', weight: 0.2 }, // Code understanding
    { skill: 'debugging', weight: 0.1 }, // Finding vulnerabilities
  ],

  'convoy:performance-reviewer': [
    { skill: 'performance', weight: 0.6 }, // Primary skill
    { skill: 'code-review', weight: 0.3 }, // Code understanding
    { skill: 'debugging', weight: 0.1 }, // Finding bottlenecks
  ],

  'convoy:correctness-reviewer': [
    { skill: 'code-review', weight: 0.4 }, // Primary skill
    { skill: 'debugging', weight: 0.4 }, // Finding bugs
    { skill: 'testing', weight: 0.2 }, // Test coverage
  ],

  'convoy:synthesis-agent': [
    { skill: 'synthesis', weight: 0.6 }, // Primary skill
    { skill: 'documentation', weight: 0.2 }, // Clear writing
    { skill: 'planning', weight: 0.2 }, // Organizing findings
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // PRE-WORK AGENTS
  // ═══════════════════════════════════════════════════════════════════════════

  'prd-agent': [
    { skill: 'documentation', weight: 0.5 }, // Primary skill
    { skill: 'planning', weight: 0.3 }, // Structure
    { skill: 'synthesis', weight: 0.2 }, // Combining requirements
  ],

  'decomposition-agent': [
    { skill: 'planning', weight: 0.5 }, // Primary skill
    { skill: 'synthesis', weight: 0.3 }, // Breaking down
    { skill: 'documentation', weight: 0.2 }, // Clear tasks
  ],

  'triage-agent': [
    { skill: 'speed', weight: 0.4 }, // Quick decisions
    { skill: 'synthesis', weight: 0.3 }, // Understanding scope
    { skill: 'planning', weight: 0.3 }, // Prioritization
  ],

  'planning-agent': [
    { skill: 'planning', weight: 0.5 }, // Primary skill
    { skill: 'code-review', weight: 0.3 }, // Understanding codebase
    { skill: 'synthesis', weight: 0.2 }, // Combining approaches
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // CLI CONTEXTS
  // ═══════════════════════════════════════════════════════════════════════════

  'cli:interactive': [
    { skill: 'speed', weight: 0.4 }, // Responsive
    { skill: 'synthesis', weight: 0.3 }, // Understanding context
    { skill: 'code-generation', weight: 0.3 }, // Quick code
  ],

  'cli:quick-command': [
    { skill: 'speed', weight: 0.7 }, // Must be fast
    { skill: 'code-generation', weight: 0.2 }, // Simple generation
    { skill: 'synthesis', weight: 0.1 }, // Quick understanding
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
 * Select the best model for a work type from available models
 */
export function selectModel(
  workType: WorkTypeId,
  availableModels: ModelId[],
  options: SelectionOptions = {}
): ModelSelectionResult {
  const { minCapability = 50, forceModel } = options;

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

  // Filter to available models with minimum capability
  const eligible = candidates.filter(
    (c) => c.available && c.skillScore >= minCapability
  );

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
        model: 'claude-sonnet-4-5',
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
): Record<WorkTypeId, ModelSelectionResult> {
  const workTypes = Object.keys(WORK_TYPE_REQUIREMENTS) as WorkTypeId[];
  const results: Record<WorkTypeId, ModelSelectionResult> = {} as Record<
    WorkTypeId,
    ModelSelectionResult
  >;

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
): Record<WorkTypeId, ModelId> {
  const results = selectAllModels(availableModels, options);
  const mapping: Record<WorkTypeId, ModelId> = {} as Record<WorkTypeId, ModelId>;

  for (const [workType, result] of Object.entries(results)) {
    mapping[workType as WorkTypeId] = result.model;
  }

  return mapping;
}

/**
 * Pretty print selection results for debugging
 */
export function formatSelectionResults(
  results: Record<WorkTypeId, ModelSelectionResult>
): string {
  const lines: string[] = ['Model Selection Results', '='.repeat(60)];

  for (const [workType, result] of Object.entries(results)) {
    lines.push(`${workType}: ${result.model}`);
    lines.push(`  Reason: ${result.reason}`);
    lines.push('');
  }

  return lines.join('\n');
}

