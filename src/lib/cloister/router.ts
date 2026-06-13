/**
 * Model Router
 *
 * Routes tasks to appropriate models based on complexity detection
 * and configuration.
 */

import type { ComplexityLevel, BeadsTask, WorkspaceMetadata, ComplexityDetectionResult } from './complexity.js';
import type { CloisterConfig, ModelSelectionConfig } from './config.js';
import { detectComplexity, complexityToModel } from './complexity.js';
import { loadCloisterConfigSync } from './config.js';
import { loadConfigSync as loadYamlConfigSync } from '../config-yaml.js';
import type { Role } from '../agents.js';
import type { RuntimeName } from '../runtimes/types.js';

type SpecialistHarnessKey = 'merge_agent' | 'review_agent' | 'test_agent' | 'inspect_agent' | 'uat_agent';

const SPECIALIST_ROLE_BY_KEY: Record<SpecialistHarnessKey, Role> = {
  merge_agent: 'ship',
  review_agent: 'review',
  test_agent: 'test',
  inspect_agent: 'work',
  uat_agent: 'test',
};

const warnedSpecialistHarnessAliases = new Set<SpecialistHarnessKey>();

function normalizeSpecialistHarnessKey(specialistName: string): SpecialistHarnessKey | null {
  const normalizedName = specialistName.replace(/-/g, '_');
  if (
    normalizedName === 'merge_agent' ||
    normalizedName === 'review_agent' ||
    normalizedName === 'test_agent' ||
    normalizedName === 'inspect_agent' ||
    normalizedName === 'uat_agent'
  ) {
    return normalizedName;
  }
  return null;
}

function warnDeprecatedSpecialistHarnessAlias(key: SpecialistHarnessKey, role: Role): void {
  if (warnedSpecialistHarnessAliases.has(key)) return;
  warnedSpecialistHarnessAliases.add(key);
  console.warn(
    `model_selection.specialist_harnesses.${key} is deprecated; use roles.${role}.harness instead.`
  );
}

/**
 * Model routing result
 */
export interface ModelRoutingResult {
  model: 'opus' | 'sonnet' | 'haiku';
  complexity: ComplexityLevel;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  signals: string[];
}

/**
 * Model router for task-based routing
 */
export class ModelRouter {
  private config: CloisterConfig;

  constructor(config?: CloisterConfig) {
    this.config = config || loadCloisterConfigSync();
  }

  /**
   * Route a task to the appropriate model
   *
   * @param task - Beads task metadata
   * @param workspace - Optional workspace metadata
   * @returns Model routing result
   */
  routeTask(task: BeadsTask, workspace?: WorkspaceMetadata): ModelRoutingResult {
    // Detect complexity
    const detection = detectComplexity(task, workspace);

    // Get model selection config
    const modelSelection = this.config.model_selection;
    if (!modelSelection) {
      // Fall back to default complexity-based routing
      const model = complexityToModel(detection.level) as 'opus' | 'sonnet' | 'haiku';
      return {
        model,
        complexity: detection.level,
        confidence: detection.confidence,
        reason: `${detection.reason} (using default routing)`,
        signals: detection.signals,
      };
    }

    // Map complexity to model using configuration
    const model = this.getModelForComplexity(detection.level, modelSelection);

    return {
      model,
      complexity: detection.level,
      confidence: detection.confidence,
      reason: detection.reason,
      signals: detection.signals,
    };
  }

  /**
   * Get model for a specific specialist
   *
   * @param specialistName - Name of the specialist (e.g., 'merge-agent', 'test-agent')
   * @returns Model name for the specialist
   */
  getSpecialistModel(specialistName: string): 'opus' | 'sonnet' | 'haiku' {
    const modelSelection = this.config.model_selection;
    if (!modelSelection) {
      return 'sonnet'; // Default for specialists
    }

    // Normalize specialist name (handle both 'merge-agent' and 'merge_agent')
    const normalizedName = specialistName.replace(/-/g, '_') as keyof typeof modelSelection.specialist_models;

    return modelSelection.specialist_models[normalizedName] || 'sonnet';
  }

  /**
   * Get the configured harness for a specialist.
   *
   * PAN-1787: model_selection.specialist_harnesses is a deprecated alias at
   * role-tier precedence. The modern roles.<role>.harness value wins when set;
   * the legacy key applies only when the role value is absent.
   */
  getSpecialistHarness(specialistName: string): RuntimeName {
    const key = normalizeSpecialistHarnessKey(specialistName);
    if (!key) return 'claude-code';

    const role = SPECIALIST_ROLE_BY_KEY[key];
    const roleHarness = loadYamlConfigSync().config.roles?.[role]?.harness;
    if (roleHarness) return roleHarness;

    const legacyHarness = this.config.model_selection?.specialist_harnesses?.[key];
    if (legacyHarness) {
      warnDeprecatedSpecialistHarnessAlias(key, role);
      return legacyHarness;
    }

    return 'claude-code';
  }

  /**
   * Get the default model for general tasks
   *
   * @returns Default model name
   */
  getDefaultModel(): 'opus' | 'sonnet' | 'haiku' {
    const modelSelection = this.config.model_selection;
    return modelSelection?.default_model || 'sonnet';
  }

  /**
   * Map complexity level to model using configuration
   *
   * @param complexity - Complexity level
   * @param modelSelection - Model selection configuration
   * @returns Model name
   */
  private getModelForComplexity(
    complexity: ComplexityLevel,
    modelSelection: ModelSelectionConfig
  ): 'opus' | 'sonnet' | 'haiku' {
    return modelSelection.complexity_routing[complexity];
  }

  /**
   * Reload configuration
   *
   * Useful when configuration is updated at runtime.
   */
  reloadConfig(): void {
    this.config = loadCloisterConfigSync();
  }
}

/**
 * Global router instance
 */
let globalRouter: ModelRouter | null = null;

/**
 * Get the global model router instance
 *
 * @returns Global model router
 */
export function getGlobalRouter(): ModelRouter {
  if (!globalRouter) {
    globalRouter = new ModelRouter();
  }
  return globalRouter;
}

/**
 * Reset the global router (useful for testing)
 */
export function resetGlobalRouter(): void {
  globalRouter = null;
  warnedSpecialistHarnessAliases.clear();
}

/**
 * Convenience function to route a task using the global router
 *
 * @param task - Beads task metadata
 * @param workspace - Optional workspace metadata
 * @returns Model routing result
 */
export function routeTask(task: BeadsTask, workspace?: WorkspaceMetadata): ModelRoutingResult {
  return getGlobalRouter().routeTask(task, workspace);
}

/**
 * Convenience function to get specialist model using the global router
 *
 * @param specialistName - Name of the specialist
 * @returns Model name for the specialist
 */
export function getSpecialistModel(specialistName: string): 'opus' | 'sonnet' | 'haiku' {
  return getGlobalRouter().getSpecialistModel(specialistName);
}

/**
 * Convenience function to get the configured specialist harness via the
 * global router (PAN-636).
 */
export function getSpecialistHarness(specialistName: string): 'claude-code' | 'pi' | 'codex' {
  return getGlobalRouter().getSpecialistHarness(specialistName);
}

/**
 * Convenience function to get default model using the global router
 *
 * @returns Default model name
 */
export function getDefaultModel(): 'opus' | 'sonnet' | 'haiku' {
  return getGlobalRouter().getDefaultModel();
}
