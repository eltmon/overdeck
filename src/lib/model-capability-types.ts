import type { ModelId } from './settings.js';
import type { SubscriptionPlan } from './subscription-types.js';

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

export interface ModelCapability {
  /** Model identifier */
  model: ModelId;
  /** Provider for this model */
  provider: 'anthropic' | 'openai' | 'google' | 'kimi' | 'minimax' | 'openrouter' | 'zai' | 'mimo' | 'nous' | 'dashscope' | 'xai' | 'quantumllama';
  /** Display name */
  displayName: string;
  /** Cost per 1M tokens (average of input/output) in USD */
  costPer1MTokens: number;
  /** Capability scores (0-100) for each skill dimension */
  skills: Record<SkillDimension, number>;
  /** Context window size in tokens */
  contextWindow: number;
  /** Maximum output tokens per response (undefined = not specified by the provider) */
  maxOutputTokens?: number;
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

