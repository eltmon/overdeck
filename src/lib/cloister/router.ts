/**
 * Model Router
 *
 * Routes tasks to appropriate models based on complexity detection
 * and configuration.
 */

import type { ComplexityLevel, BeadsTask, WorkspaceMetadata, ComplexityDetectionResult } from './complexity.js';
import type { CloisterConfig, ModelSelectionConfig } from './config.js';
import { detectComplexity, complexityToModel } from './complexity.js';
import { loadCloisterConfig } from './config.js';

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
    this.config = config || loadCloisterConfig();
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
   * Get the configured harness for a specialist (PAN-636).
   *
   * Mirrors getSpecialistModel: normalizes dash-form names ('merge-agent')
   * to underscore-form ('merge_agent'), reads
   * model_selection.specialist_harnesses, and falls back to 'claude-code'
   * for unknown specialists or absent overrides.
   */
  getSpecialistHarness(specialistName: string): 'claude-code' | 'pi' {
    const harnesses = this.config.model_selection?.specialist_harnesses;
    if (!harnesses) return 'claude-code';
    const normalizedName = specialistName.replace(/-/g, '_') as keyof typeof harnesses;
    return harnesses[normalizedName] ?? 'claude-code';
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
    this.config = loadCloisterConfig();
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
export function getSpecialistHarness(specialistName: string): 'claude-code' | 'pi' {
  return getGlobalRouter().getSpecialistHarness(specialistName);
}

/**
 * Resolve a specialist's launcher base command (PAN-636).
 *
 * Single producer of `LauncherConfig.baseCommand` strings for all
 * specialist dispatch sites in cloister/. Routes by harness and gates
 * the harness/model combination through canUseHarness; if the gate
 * blocks the request, the helper falls back to claude-code and logs a
 * warning with the human-readable reason.
 *
 * @param role     specialist role name ('review-agent', 'merge-agent', etc.)
 * @param model    model id for the specialist
 * @param harness  optional harness override; defaults to the role's
 *                 configured harness via getSpecialistHarness
 */
export async function resolveSpecialistBaseCommand(
  role: string,
  model: string,
  harness?: 'claude-code' | 'pi',
): Promise<string> {
  const { canUseHarness } = await import('../harness-policy.js')
  const { getAgentRuntimeBaseCommand, getProviderAuthMode } = await import('../agents.js')

  const requested = harness ?? getSpecialistHarness(role)
  const authMode = await getProviderAuthMode(model)
  const decision = canUseHarness(requested, model, authMode)
  if (!decision.allowed) {
    console.warn(
      `[router] specialist ${role}: canUseHarness(${requested},${model},${authMode}) blocked — ${decision.reason}. Falling back to claude-code.`,
    )
    return getAgentRuntimeBaseCommand(model, 'claude-code')
  }
  return getAgentRuntimeBaseCommand(model, requested)
}

/**
 * Convenience function to get default model using the global router
 *
 * @returns Default model name
 */
export function getDefaultModel(): 'opus' | 'sonnet' | 'haiku' {
  return getGlobalRouter().getDefaultModel();
}
