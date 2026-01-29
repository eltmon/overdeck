/**
 * Work Type Router
 *
 * Routes work types to appropriate models based on:
 * 1. Per-project overrides (.panopticon.yaml)
 * 2. Global overrides (~/.panopticon/config.yaml)
 * 3. Preset defaults (Premium, Balanced, Budget)
 * 4. Fallback strategy (when provider API keys missing)
 *
 * This replaces the complexity-based router with a work-type-based approach.
 */

import { WorkTypeId, isValidWorkType, validateWorkType } from './work-types.js';
import { ModelId } from './settings.js';
import { getPreset, PresetName } from './model-presets.js';
import { applyFallback, ModelProvider } from './model-fallback.js';
import { loadConfig, NormalizedConfig } from './config-yaml.js';

/**
 * Model resolution result with debugging info
 */
export interface ModelResolutionResult {
  /** Final model to use */
  model: ModelId;
  /** Work type that was resolved */
  workType: WorkTypeId;
  /** How the model was determined */
  source: 'override' | 'preset' | 'fallback';
  /** Selected preset name */
  preset: PresetName;
  /** Whether fallback was applied */
  usedFallback: boolean;
  /** Original model before fallback (if fallback was used) */
  originalModel?: ModelId;
}

/**
 * Work Type Router
 *
 * Main router class for resolving work types to models.
 */
export class WorkTypeRouter {
  private config: NormalizedConfig;

  constructor(config?: NormalizedConfig) {
    this.config = config || loadConfig();
  }

  /**
   * Get model for a specific work type
   *
   * Resolution order:
   * 1. Per-project/global override
   * 2. Preset default
   * 3. Fallback if provider disabled
   *
   * @param workTypeId Work type to resolve
   * @returns Model resolution result
   */
  getModel(workTypeId: WorkTypeId): ModelResolutionResult {
    // Validate work type
    validateWorkType(workTypeId);

    let model: ModelId;
    let source: 'override' | 'preset' | 'fallback';
    let originalModel: ModelId | undefined;

    // Check for override first
    if (this.config.overrides[workTypeId]) {
      model = this.config.overrides[workTypeId]!;
      source = 'override';
    } else {
      // Use preset default
      const preset = getPreset(this.config.preset);
      model = preset.models[workTypeId];
      source = 'preset';
    }

    // Apply fallback if provider is disabled
    originalModel = model;
    model = applyFallback(model, this.config.enabledProviders);

    return {
      model,
      workType: workTypeId,
      source,
      preset: this.config.preset,
      usedFallback: model !== originalModel,
      originalModel: model !== originalModel ? originalModel : undefined,
    };
  }

  /**
   * Get just the model ID for a work type (convenience method)
   *
   * @param workTypeId Work type to resolve
   * @returns Model ID to use
   */
  getModelId(workTypeId: WorkTypeId): ModelId {
    return this.getModel(workTypeId).model;
  }

  /**
   * Check if a work type has an override configured
   *
   * @param workTypeId Work type to check
   * @returns true if override exists
   */
  hasOverride(workTypeId: WorkTypeId): boolean {
    return workTypeId in this.config.overrides;
  }

  /**
   * Get the current preset name
   */
  getPreset(): PresetName {
    return this.config.preset;
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
   *
   * Useful when configuration is updated at runtime.
   */
  reloadConfig(): void {
    this.config = loadConfig();
  }

  /**
   * Get debug information about current configuration
   */
  getDebugInfo(): {
    preset: PresetName;
    enabledProviders: string[];
    overrideCount: number;
    hasApiKeys: {
      openai: boolean;
      google: boolean;
      zai: boolean;
      kimi: boolean;
    };
  } {
    return {
      preset: this.config.preset,
      enabledProviders: Array.from(this.config.enabledProviders),
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
 *
 * @returns Global work type router
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
 * Convenience function to get model using the global router
 *
 * @param workTypeId Work type to resolve
 * @returns Model resolution result
 */
export function getModel(workTypeId: WorkTypeId): ModelResolutionResult {
  return getGlobalRouter().getModel(workTypeId);
}

/**
 * Convenience function to get just the model ID using the global router
 *
 * @param workTypeId Work type to resolve
 * @returns Model ID to use
 */
export function getModelId(workTypeId: WorkTypeId): ModelId {
  return getGlobalRouter().getModelId(workTypeId);
}

/**
 * Convenience function to check for override using the global router
 *
 * @param workTypeId Work type to check
 * @returns true if override exists
 */
export function hasOverride(workTypeId: WorkTypeId): boolean {
  return getGlobalRouter().hasOverride(workTypeId);
}

/**
 * Convenience function to get current preset using the global router
 */
export function getPresetName(): PresetName {
  return getGlobalRouter().getPreset();
}

/**
 * Convenience function to get debug info using the global router
 */
export function getDebugInfo() {
  return getGlobalRouter().getDebugInfo();
}
