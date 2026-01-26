/**
 * Model Presets
 *
 * Defines three preset configurations (Premium, Balanced, Budget) with
 * model assignments for all 23 work types. Users can select a preset
 * and optionally override specific work types.
 */

import { WorkTypeId } from './work-types.js';
import { ModelId } from './settings.js';

/**
 * Preset name
 */
export type PresetName = 'premium' | 'balanced' | 'budget';

/**
 * Configuration for a single preset
 */
export interface PresetConfig {
  /** Internal preset identifier */
  name: PresetName;
  /** Display name for UI */
  displayName: string;
  /** Description of preset purpose */
  description: string;
  /** Model assignments for all work types */
  models: Record<WorkTypeId, ModelId>;
  /** Cost level indicator (1=cheapest, 5=most expensive) */
  costLevel: 1 | 2 | 3 | 4 | 5;
}

/**
 * Premium Preset - Best quality, uses top-tier models
 *
 * Strategy:
 * - Critical work (planning, security) → Opus 4.5
 * - Complex work (implementation) → GPT-5.2 Codex or Opus
 * - Fast exploration → Gemini 3 Flash
 */
const PREMIUM_PRESET: PresetConfig = {
  name: 'premium',
  displayName: 'Premium',
  description: 'Best quality - uses top-tier models for maximum accuracy',
  costLevel: 5,
  models: {
    // Issue agent phases - Mix of high-quality models
    'issue-agent:exploration': 'gemini-3-flash-preview', // Fast exploration
    'issue-agent:planning': 'claude-opus-4-5', // Critical thinking
    'issue-agent:implementation': 'gpt-5.2-codex', // Code generation excellence
    'issue-agent:testing': 'claude-sonnet-4-5', // Thorough test verification
    'issue-agent:documentation': 'claude-sonnet-4-5', // Clear writing
    'issue-agent:review-response': 'claude-opus-4-5', // Nuanced responses

    // Specialists - High quality models
    'specialist-review-agent': 'claude-opus-4-5', // Comprehensive reviews
    'specialist-test-agent': 'claude-sonnet-4-5', // Test expertise
    'specialist-merge-agent': 'claude-sonnet-4-5', // Merge finalization

    // Subagents - Fast and efficient
    'subagent:explore': 'gemini-3-flash-preview', // Quick exploration
    'subagent:plan': 'claude-sonnet-4-5', // Planning quality
    'subagent:bash': 'claude-haiku-4-5', // Command execution
    'subagent:general-purpose': 'claude-sonnet-4-5', // General tasks

    // Convoy members - Top-tier for parallel reviews
    'convoy:security-reviewer': 'claude-opus-4-5', // Security critical
    'convoy:performance-reviewer': 'claude-sonnet-4-5', // Performance analysis
    'convoy:correctness-reviewer': 'claude-sonnet-4-5', // Correctness verification
    'convoy:synthesis-agent': 'claude-opus-4-5', // Synthesis requires nuance

    // Pre-work agents - Planning quality
    'prd-agent': 'claude-opus-4-5', // PRD requires clarity
    'decomposition-agent': 'claude-sonnet-4-5', // Task breakdown
    'triage-agent': 'claude-sonnet-4-5', // Prioritization
    'planning-agent': 'claude-opus-4-5', // Architecture decisions

    // CLI contexts - Interactive needs quality
    'cli:interactive': 'claude-sonnet-4-5', // User interaction
    'cli:quick-command': 'claude-haiku-4-5', // Fast commands
  },
};

/**
 * Balanced Preset - Good cost/performance ratio (DEFAULT)
 *
 * Strategy:
 * - Planning/critical work → Sonnet 4.5
 * - Implementation → Sonnet or Gemini Pro
 * - Quick tasks → Haiku or Gemini Flash
 */
const BALANCED_PRESET: PresetConfig = {
  name: 'balanced',
  displayName: 'Balanced',
  description: 'Smart model routing - good balance of cost and quality',
  costLevel: 3,
  models: {
    // Issue agent phases - Sonnet for most work
    'issue-agent:exploration': 'gemini-3-flash-preview', // Fast exploration
    'issue-agent:planning': 'claude-sonnet-4-5', // Good planning
    'issue-agent:implementation': 'gemini-3-pro-preview', // Solid implementation
    'issue-agent:testing': 'claude-sonnet-4-5', // Thorough testing
    'issue-agent:documentation': 'claude-sonnet-4-5', // Clear docs
    'issue-agent:review-response': 'claude-sonnet-4-5', // Good responses

    // Specialists - Sonnet quality
    'specialist-review-agent': 'claude-sonnet-4-5', // Good reviews
    'specialist-test-agent': 'claude-sonnet-4-5', // Test quality
    'specialist-merge-agent': 'claude-sonnet-4-5', // Merge quality

    // Subagents - Mix of fast and quality
    'subagent:explore': 'gemini-3-flash-preview', // Fast exploration
    'subagent:plan': 'claude-sonnet-4-5', // Planning quality
    'subagent:bash': 'claude-haiku-4-5', // Fast commands
    'subagent:general-purpose': 'claude-haiku-4-5', // General efficiency

    // Convoy members - Sonnet for most, Opus for security
    'convoy:security-reviewer': 'claude-opus-4-5', // Security still critical
    'convoy:performance-reviewer': 'claude-sonnet-4-5', // Good analysis
    'convoy:correctness-reviewer': 'claude-sonnet-4-5', // Good verification
    'convoy:synthesis-agent': 'claude-sonnet-4-5', // Good synthesis

    // Pre-work agents - Sonnet for planning
    'prd-agent': 'claude-sonnet-4-5', // Good PRDs
    'decomposition-agent': 'claude-sonnet-4-5', // Good breakdown
    'triage-agent': 'claude-haiku-4-5', // Fast triage
    'planning-agent': 'claude-sonnet-4-5', // Good planning

    // CLI contexts - Haiku for speed
    'cli:interactive': 'claude-haiku-4-5', // Fast interaction
    'cli:quick-command': 'claude-haiku-4-5', // Fast commands
  },
};

/**
 * Budget Preset - Cost-optimized for high-volume work
 *
 * Strategy:
 * - Most work → Haiku 4.5 or Gemini Flash
 * - Security only → Sonnet 4.5 (never compromise)
 * - Everything else → cheapest viable option
 */
const BUDGET_PRESET: PresetConfig = {
  name: 'budget',
  displayName: 'Budget',
  description: 'Cost-optimized - economy models for high-volume work',
  costLevel: 1,
  models: {
    // Issue agent phases - Haiku/Gemini Flash
    'issue-agent:exploration': 'gemini-3-flash-preview', // Fast exploration
    'issue-agent:planning': 'claude-haiku-4-5', // Economy planning
    'issue-agent:implementation': 'gemini-3-flash-preview', // Fast implementation
    'issue-agent:testing': 'claude-haiku-4-5', // Economy testing
    'issue-agent:documentation': 'claude-haiku-4-5', // Economy docs
    'issue-agent:review-response': 'claude-haiku-4-5', // Economy responses

    // Specialists - Haiku efficiency
    'specialist-review-agent': 'claude-haiku-4-5', // Fast reviews
    'specialist-test-agent': 'claude-haiku-4-5', // Fast tests
    'specialist-merge-agent': 'claude-haiku-4-5', // Fast merge

    // Subagents - All economy
    'subagent:explore': 'gemini-3-flash-preview', // Fast exploration
    'subagent:plan': 'claude-haiku-4-5', // Economy planning
    'subagent:bash': 'claude-haiku-4-5', // Fast commands
    'subagent:general-purpose': 'claude-haiku-4-5', // Economy general

    // Convoy members - ONLY security gets Sonnet
    'convoy:security-reviewer': 'claude-sonnet-4-5', // Never compromise security
    'convoy:performance-reviewer': 'claude-haiku-4-5', // Economy performance
    'convoy:correctness-reviewer': 'claude-haiku-4-5', // Economy correctness
    'convoy:synthesis-agent': 'claude-haiku-4-5', // Economy synthesis

    // Pre-work agents - All economy
    'prd-agent': 'claude-haiku-4-5', // Economy PRDs
    'decomposition-agent': 'claude-haiku-4-5', // Economy breakdown
    'triage-agent': 'claude-haiku-4-5', // Fast triage
    'planning-agent': 'claude-haiku-4-5', // Economy planning

    // CLI contexts - All Haiku
    'cli:interactive': 'claude-haiku-4-5', // Fast interaction
    'cli:quick-command': 'claude-haiku-4-5', // Fast commands
  },
};

/**
 * All preset configurations
 */
export const PRESETS: Record<PresetName, PresetConfig> = {
  premium: PREMIUM_PRESET,
  balanced: BALANCED_PRESET,
  budget: BUDGET_PRESET,
};

/**
 * Default preset (Balanced)
 */
export const DEFAULT_PRESET: PresetName = 'balanced';

/**
 * Get preset configuration by name
 */
export function getPreset(name: PresetName): PresetConfig {
  return PRESETS[name];
}

/**
 * Get model for a specific work type in a preset
 */
export function getPresetModel(preset: PresetName, workType: WorkTypeId): ModelId {
  return PRESETS[preset].models[workType];
}

/**
 * Check if a string is a valid preset name
 */
export function isValidPreset(name: string): name is PresetName {
  return name in PRESETS;
}

/**
 * Get all preset names
 */
export function getAllPresets(): PresetName[] {
  return Object.keys(PRESETS) as PresetName[];
}

/**
 * Get preset metadata (without full model mappings) for UI display
 */
export interface PresetMetadata {
  name: PresetName;
  displayName: string;
  description: string;
  costLevel: number;
}

/**
 * Get metadata for all presets (lightweight for UI)
 */
export function getPresetsMetadata(): PresetMetadata[] {
  return getAllPresets().map((name) => {
    const preset = PRESETS[name];
    return {
      name: preset.name,
      displayName: preset.displayName,
      description: preset.description,
      costLevel: preset.costLevel,
    };
  });
}
