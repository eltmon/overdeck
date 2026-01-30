/**
 * Work Type Router
 *
 * Routes work types to appropriate models using smart (capability-based) selection.
 * Picks the best model for each job based on:
 * 1. What models the user has enabled (API keys configured)
 * 2. Capability scores for the required skills
 * 3. Cost optimization (configurable)
 */

import { WorkTypeId, isValidWorkType, validateWorkType, getAllWorkTypes } from './work-types.js';
import { ModelId } from './settings.js';
import { applyFallback, ModelProvider, getModelsByProvider } from './model-fallback.js';
import { loadConfig, NormalizedConfig } from './config-yaml.js';
import { selectModel, ModelSelectionResult } from './smart-model-selector.js';

// Re-export WorkTypeId for backward compatibility
export type { WorkTypeId } from './work-types.js';

/**
 * Model resolution result with debugging info
 */
export interface ModelResolutionResult {
  /** Final model to use */
  model: ModelId;
  /** Work type that was resolved */
  workType: WorkTypeId;
  /** How the model was determined */
  source: 'override' | 'smart';
  /** Whether fallback was applied (provider disabled) */
  usedFallback: boolean;
  /** Original model before fallback */
  originalModel?: ModelId;
  /** Smart selection details */
  selection: {
    score: number;
    reason: string;
  };
}

/**
 * Work Type Router
 *
 * Main router class for resolving work types to models.
 */
export class WorkTypeRouter {
  private config: NormalizedConfig;
  private availableModels: ModelId[] | null = null;

  constructor(config?: NormalizedConfig) {
    this.config = config || loadConfig();
  }

  /**
   * Get list of available models based on enabled providers
   */
  private getAvailableModels(): ModelId[] {
    if (this.availableModels) {
      return this.availableModels;
    }

    const available: ModelId[] = [];
    for (const provider of this.config.enabledProviders) {
      available.push(...getModelsByProvider(provider));
    }
    this.availableModels = available;
    return available;
  }

  /**
   * Get model for a specific work type
   *
   * Resolution order:
   * 1. Per-project/global override (if configured)
   * 2. Smart selection (capability-based)
   */
  getModel(workTypeId: WorkTypeId): ModelResolutionResult {
    validateWorkType(workTypeId);

    let model: ModelId;
    let source: 'override' | 'smart';
    let originalModel: ModelId | undefined;
    let selection: { score: number; reason: string };

    // Check for override first
    if (this.config.overrides[workTypeId]) {
      model = this.config.overrides[workTypeId]!;
      source = 'override';
      selection = {
        score: 100,
        reason: `Explicit override: ${model}`,
      };
    } else {
      // Use smart (capability-based) selection
      const availableModels = this.getAvailableModels();
      const result = selectModel(workTypeId, availableModels);
      model = result.model;
      source = 'smart';
      selection = {
        score: result.score,
        reason: result.reason,
      };
    }

    // Apply fallback if provider is disabled
    originalModel = model;
    model = applyFallback(model, this.config.enabledProviders);

    return {
      model,
      workType: workTypeId,
      source,
      usedFallback: model !== originalModel,
      originalModel: model !== originalModel ? originalModel : undefined,
      selection,
    };
  }

  /**
   * Get just the model ID for a work type (convenience method)
   */
  getModelId(workTypeId: WorkTypeId): ModelId {
    return this.getModel(workTypeId).model;
  }

  /**
   * Check if a work type has an override configured
   */
  hasOverride(workTypeId: WorkTypeId): boolean {
    return workTypeId in this.config.overrides;
  }

  /**
   * Get the set of enabled providers
   */
  getEnabledProviders(): Set<ModelProvider> {
    return this.config.enabledProviders;
  }

  /**
   * Get all configured overrides
   */
  getOverrides(): Partial<Record<WorkTypeId, ModelId>> {
    return { ...this.config.overrides };
  }

  /**
   * Get API keys configuration
   */
  getApiKeys(): { openai?: string; google?: string; zai?: string; kimi?: string } {
    return { ...this.config.apiKeys };
  }

  /**
   * Get Gemini thinking level
   */
  getGeminiThinkingLevel(): 1 | 2 | 3 | 4 {
    return this.config.geminiThinkingLevel;
  }

  /**
   * Reload configuration from disk
   */
  reloadConfig(): void {
    this.config = loadConfig();
    this.availableModels = null; // Clear cache
  }

  /**
   * Get debug information about current configuration
   */
  getDebugInfo(): {
    enabledProviders: string[];
    availableModelCount: number;
    overrideCount: number;
    hasApiKeys: {
      openai: boolean;
      google: boolean;
      zai: boolean;
      kimi: boolean;
    };
  } {
    return {
      enabledProviders: Array.from(this.config.enabledProviders),
      availableModelCount: this.getAvailableModels().length,
      overrideCount: Object.keys(this.config.overrides).length,
      hasApiKeys: {
        openai: !!this.config.apiKeys.openai,
        google: !!this.config.apiKeys.google,
        zai: !!this.config.apiKeys.zai,
        kimi: !!this.config.apiKeys.kimi,
      },
    };
  }
}

/**
 * Global router instance
 */
let globalRouter: WorkTypeRouter | null = null;

/**
 * Get the global work type router instance
 */
export function getGlobalRouter(): WorkTypeRouter {
  if (!globalRouter) {
    globalRouter = new WorkTypeRouter();
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
 * Reload global router configuration
 */
export function reloadGlobalRouter(): void {
  if (globalRouter) {
    globalRouter.reloadConfig();
  }
}

/**
 * Get model using the global router
 */
export function getModel(workTypeId: WorkTypeId): ModelResolutionResult {
  return getGlobalRouter().getModel(workTypeId);
}

/**
 * Get just the model ID using the global router
 */
export function getModelId(workTypeId: WorkTypeId): ModelId {
  return getGlobalRouter().getModelId(workTypeId);
}

/**
 * Check for override using the global router
 */
export function hasOverride(workTypeId: WorkTypeId): boolean {
  return getGlobalRouter().hasOverride(workTypeId);
}

/**
 * Get debug info using the global router
 */
export function getDebugInfo() {
  return getGlobalRouter().getDebugInfo();
}
