/**
 * Configuration Migration
 *
 * Migrates from legacy settings.json format to new config.yaml format.
 * Preserves all existing configuration while adopting the new structure.
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';
import { loadSettings, type SettingsConfig, type ComplexityLevel } from './settings.js';
import { type YamlConfig } from './config-yaml.js';
import { type WorkTypeId } from './work-types.js';
import { type ModelId } from './settings.js';
import { PresetName } from './model-presets.js';

/** Path to legacy settings file */
const LEGACY_SETTINGS_PATH = join(homedir(), '.panopticon', 'settings.json');

/** Path to new config file */
const NEW_CONFIG_PATH = join(homedir(), '.panopticon', 'config.yaml');

/** Path to backup of legacy settings */
const BACKUP_SETTINGS_PATH = join(homedir(), '.panopticon', 'settings.json.backup');

/**
 * Check if migration is needed
 * Returns true if settings.json exists and config.yaml doesn't
 */
export function needsMigration(): boolean {
  return existsSync(LEGACY_SETTINGS_PATH) && !existsSync(NEW_CONFIG_PATH);
}

/**
 * Check if legacy settings exist (even if already migrated)
 */
export function hasLegacySettings(): boolean {
  return existsSync(LEGACY_SETTINGS_PATH);
}

/**
 * Detect which preset the current settings most closely match
 *
 * Analyzes the complexity-level assignments to infer the preset
 */
function detectPreset(settings: SettingsConfig): PresetName {
  const complexity = settings.models.complexity;

  // Count how many complexity levels use each model tier
  const modelTiers = {
    opus: 0, // claude-opus-4-5, gpt-5.2-codex, o3-deep-research
    sonnet: 0, // claude-sonnet-4-5, gpt-4o, gemini-3-pro-preview
    haiku: 0, // claude-haiku-4-5, gpt-4o-mini, gemini-3-flash-preview
  };

  const levels: ComplexityLevel[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];
  for (const level of levels) {
    const model = complexity[level];

    if (
      model === 'claude-opus-4-5' ||
      model === 'gpt-5.2-codex' ||
      model === 'o3-deep-research'
    ) {
      modelTiers.opus++;
    } else if (
      model === 'claude-sonnet-4-5' ||
      model === 'gpt-4o' ||
      model === 'gemini-3-pro-preview'
    ) {
      modelTiers.sonnet++;
    } else if (
      model === 'claude-haiku-4-5' ||
      model === 'gpt-4o-mini' ||
      model === 'gemini-3-flash-preview' ||
      model === 'glm-4.7' ||
      model === 'glm-4.7-flash'
    ) {
      modelTiers.haiku++;
    }
  }

  // Premium: mostly opus/top-tier models
  if (modelTiers.opus >= 2) {
    return 'premium';
  }

  // Budget: mostly haiku/cheap models
  if (modelTiers.haiku >= 3) {
    return 'budget';
  }

  // Default: balanced
  return 'balanced';
}

/**
 * Map legacy complexity-based settings to work type overrides
 *
 * Since the old system used 5 complexity levels and the new system
 * has 23 work types, we can't do a perfect mapping. Instead, we
 * map critical work types based on the old complexity assignments.
 */
function mapComplexityToOverrides(settings: SettingsConfig): Partial<Record<WorkTypeId, ModelId>> {
  const overrides: Partial<Record<WorkTypeId, ModelId>> = {};

  // Map old specialist assignments
  if (settings.models.specialists.review_agent !== 'claude-sonnet-4-5') {
    overrides['specialist-review-agent'] = settings.models.specialists.review_agent;
  }
  if (settings.models.specialists.test_agent !== 'claude-haiku-4-5') {
    overrides['specialist-test-agent'] = settings.models.specialists.test_agent;
  }
  if (settings.models.specialists.merge_agent !== 'claude-sonnet-4-5') {
    overrides['specialist-merge-agent'] = settings.models.specialists.merge_agent;
  }

  // Map old planning agent
  if (settings.models.planning_agent !== 'claude-opus-4-5') {
    overrides['planning-agent'] = settings.models.planning_agent;
  }

  // Map complexity levels to representative work types
  const complexity = settings.models.complexity;

  // Trivial → exploration (fast scanning)
  if (complexity.trivial !== 'claude-haiku-4-5') {
    overrides['issue-agent:exploration'] = complexity.trivial;
  }

  // Simple → documentation, quick commands
  if (complexity.simple !== 'claude-haiku-4-5') {
    overrides['issue-agent:documentation'] = complexity.simple;
    overrides['cli:quick-command'] = complexity.simple;
  }

  // Medium → implementation, testing
  if (complexity.medium !== 'claude-sonnet-4-5') {
    overrides['issue-agent:implementation'] = complexity.medium;
    overrides['issue-agent:testing'] = complexity.medium;
  }

  // Complex → planning, review
  if (complexity.complex !== 'claude-sonnet-4-5') {
    overrides['issue-agent:planning'] = complexity.complex;
    overrides['issue-agent:review-response'] = complexity.complex;
  }

  // Expert → security review, architecture
  if (complexity.expert !== 'claude-opus-4-5') {
    overrides['convoy:security-reviewer'] = complexity.expert;
    overrides['decomposition-agent'] = complexity.expert;
  }

  return overrides;
}

/**
 * Determine which providers are enabled based on API keys
 */
function detectEnabledProviders(settings: SettingsConfig): YamlConfig['models']['providers'] {
  return {
    anthropic: true, // Always enabled
    openai: !!settings.api_keys.openai,
    google: !!settings.api_keys.google,
    zai: !!settings.api_keys.zai,
  };
}

/**
 * Convert legacy settings.json to new config.yaml format
 *
 * @param settings Loaded legacy settings
 * @returns New config structure
 */
export function convertToYamlConfig(settings: SettingsConfig): YamlConfig {
  const preset = detectPreset(settings);
  const overrides = mapComplexityToOverrides(settings);
  const providers = detectEnabledProviders(settings);

  const config: YamlConfig = {
    models: {
      preset,
      providers,
      overrides,
      gemini_thinking_level: 3, // Default to medium
    },
    // Preserve API keys for backward compatibility
    api_keys: settings.api_keys,
  };

  return config;
}

/**
 * Perform migration from settings.json to config.yaml
 *
 * Steps:
 * 1. Load legacy settings.json
 * 2. Convert to new YAML format
 * 3. Write to config.yaml
 * 4. Back up settings.json to settings.json.backup
 *
 * @param options Migration options
 * @returns Migration result with details
 */
export interface MigrationOptions {
  /** Backup legacy settings (default: true) */
  backup?: boolean;
  /** Delete legacy settings after migration (default: false) */
  deleteLegacy?: boolean;
  /** Dry run - don't actually write files (default: false) */
  dryRun?: boolean;
}

export interface MigrationResult {
  success: boolean;
  preset: PresetName;
  overridesCount: number;
  providersEnabled: string[];
  message: string;
  error?: string;
}

export function migrateConfig(options: MigrationOptions = {}): MigrationResult {
  const { backup = true, deleteLegacy = false, dryRun = false } = options;

  try {
    // Check if migration is needed
    if (!existsSync(LEGACY_SETTINGS_PATH)) {
      return {
        success: false,
        preset: 'balanced',
        overridesCount: 0,
        providersEnabled: [],
        message: 'No legacy settings.json found',
        error: 'settings.json does not exist',
      };
    }

    if (existsSync(NEW_CONFIG_PATH) && !dryRun) {
      return {
        success: false,
        preset: 'balanced',
        overridesCount: 0,
        providersEnabled: [],
        message: 'config.yaml already exists - migration not needed',
        error: 'config.yaml already exists',
      };
    }

    // Load legacy settings
    const settings = loadSettings();

    // Convert to YAML format
    const yamlConfig = convertToYamlConfig(settings);

    // Generate YAML content
    const yamlContent = yaml.dump(yamlConfig, {
      indent: 2,
      lineWidth: 100,
      noRefs: true,
      sortKeys: false,
    });

    // Dry run - just return what would happen
    if (dryRun) {
      const providersEnabled = Object.entries(yamlConfig.models?.providers || {})
        .filter(([_, enabled]) => enabled)
        .map(([name]) => name);

      return {
        success: true,
        preset: yamlConfig.models?.preset || 'balanced',
        overridesCount: Object.keys(yamlConfig.models?.overrides || {}).length,
        providersEnabled,
        message: `Would migrate to ${yamlConfig.models?.preset || 'balanced'} preset with ${Object.keys(yamlConfig.models?.overrides || {}).length} overrides`,
      };
    }

    // Write new config.yaml
    writeFileSync(NEW_CONFIG_PATH, yamlContent, 'utf-8');

    // Back up legacy settings if requested
    if (backup) {
      const legacyContent = readFileSync(LEGACY_SETTINGS_PATH, 'utf-8');
      writeFileSync(BACKUP_SETTINGS_PATH, legacyContent, 'utf-8');
    }

    // Delete legacy settings if requested
    if (deleteLegacy) {
      renameSync(LEGACY_SETTINGS_PATH, `${LEGACY_SETTINGS_PATH}.migrated`);
    }

    const providersEnabled = Object.entries(yamlConfig.models?.providers || {})
      .filter(([_, enabled]) => enabled)
      .map(([name]) => name);

    return {
      success: true,
      preset: yamlConfig.models?.preset || 'balanced',
      overridesCount: Object.keys(yamlConfig.models?.overrides || {}).length,
      providersEnabled,
      message: `Successfully migrated to ${yamlConfig.models?.preset} preset with ${Object.keys(yamlConfig.models?.overrides || {}).length} overrides`,
    };
  } catch (error: any) {
    return {
      success: false,
      preset: 'balanced',
      overridesCount: 0,
      providersEnabled: [],
      message: 'Migration failed',
      error: error.message,
    };
  }
}

/**
 * Generate a preview of what the migration would produce
 *
 * Useful for showing users what will change before running migration
 */
export function previewMigration(): { yaml: string; result: MigrationResult } | null {
  if (!existsSync(LEGACY_SETTINGS_PATH)) {
    return null;
  }

  const settings = loadSettings();
  const yamlConfig = convertToYamlConfig(settings);
  const yamlContent = yaml.dump(yamlConfig, {
    indent: 2,
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  });

  const result = migrateConfig({ dryRun: true });

  return { yaml: yamlContent, result };
}
