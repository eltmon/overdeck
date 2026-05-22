/**
 * Configuration Migration
 *
 * Migrates from legacy settings.json format to new config.yaml format.
 * Legacy presets are no longer supported - all selection is now smart/capability-based.
 */

import { Effect } from 'effect';
import { readFileSync, writeFileSync, existsSync, renameSync, readdirSync, lstatSync, readlinkSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';
import { loadSettingsSync, type SettingsConfig } from './settings.js';
import { type YamlConfig } from './config-yaml.js';
import { type ModelId } from './settings.js';
import { FsError } from './errors.js';

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
export function needsMigrationSync(): boolean {
  return existsSync(LEGACY_SETTINGS_PATH) && !existsSync(NEW_CONFIG_PATH);
}

/**
 * Check if legacy settings exist (even if already migrated)
 */
export function hasLegacySettingsSync(): boolean {
  return existsSync(LEGACY_SETTINGS_PATH);
}

/**
 * Determine which providers are enabled based on API keys
 */
function detectEnabledProviders(settings: SettingsConfig): {
  anthropic: boolean;
  openai: boolean;
  google: boolean;
  kimi: boolean;
} {
  return {
    anthropic: true, // Always enabled
    openai: !!settings.api_keys.openai,
    google: !!settings.api_keys.google,
    kimi: false, // Legacy settings don't have Kimi
  };
}

/**
 * Convert legacy settings.json to new config.yaml format
 */
export function convertToYamlConfigSync(settings: SettingsConfig): YamlConfig {
  const providers = detectEnabledProviders(settings);

  const config: YamlConfig = {
    models: {
      providers,
      overrides: {}, // No overrides from legacy
      gemini_thinking_level: 3,
    },
    api_keys: settings.api_keys,
  };

  return config;
}

/**
 * Migration options
 */
export interface MigrationOptions {
  /** Create backup of legacy settings (default: true) */
  backup?: boolean;
  /** Delete legacy settings after migration (default: false) */
  deleteLegacy?: boolean;
  /** Dry run - don't actually write files (default: false) */
  dryRun?: boolean;
}

/**
 * Migration result
 */
export interface MigrationResult {
  success: boolean;
  overridesCount: number;
  providersEnabled: string[];
  message: string;
  error?: string;
}

export function migrateConfigSync(options: MigrationOptions = {}): MigrationResult {
  const { backup = true, deleteLegacy = false, dryRun = false } = options;

  try {
    // Check if migration is needed
    if (!needsMigrationSync()) {
      if (existsSync(NEW_CONFIG_PATH)) {
        return {
          success: true,
          overridesCount: 0,
          providersEnabled: ['anthropic'],
          message: 'Config already migrated (config.yaml exists)',
        };
      }
      return {
        success: false,
        overridesCount: 0,
        providersEnabled: [],
        message: 'No legacy settings.json found to migrate',
      };
    }

    // Load legacy settings
    const settings = loadSettingsSync();

    // Convert to YAML config
    const yamlConfig = convertToYamlConfigSync(settings);

    // Generate YAML content
    const yamlContent = yaml.dump(yamlConfig, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
    });

    // Dry run - just return what would happen
    if (dryRun) {
      const providersEnabled = Object.entries(yamlConfig.models?.providers || {})
        .filter(([_, enabled]) => enabled)
        .map(([name]) => name);

      return {
        success: true,
        overridesCount: Object.keys(yamlConfig.models?.overrides || {}).length,
        providersEnabled,
        message: `Would migrate to smart selection with ${providersEnabled.length} providers enabled`,
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
      overridesCount: Object.keys(yamlConfig.models?.overrides || {}).length,
      providersEnabled,
      message: `Successfully migrated to smart selection with ${providersEnabled.length} providers`,
    };
  } catch (error: any) {
    return {
      success: false,
      overridesCount: 0,
      providersEnabled: [],
      message: 'Migration failed',
      error: error.message,
    };
  }
}

/**
 * Get migration status
 */
export function getMigrationStatusSync(): {
  needsMigration: boolean;
  hasLegacySettings: boolean;
  hasNewConfig: boolean;
} {
  return {
    needsMigration: needsMigrationSync(),
    hasLegacySettings: existsSync(LEGACY_SETTINGS_PATH),
    hasNewConfig: existsSync(NEW_CONFIG_PATH),
  };
}

/**
 * Clean up legacy runtime symlinks from removed runtimes.
 *
 * PAN-142: Panopticon consolidated to Claude Code as the sole runtime.
 * This removes any Panopticon-managed symlinks from legacy runtime directories
 * (codex, cursor, gemini, opencode).
 */
export interface LegacyCleanupResult {
  cleaned: string[];
  total: number;
  errors: string[];
}

export function cleanupLegacyRuntimeSymlinksSync(): LegacyCleanupResult {
  const legacyDirs = [
    { name: 'codex', base: join(homedir(), '.codex') },
    { name: 'cursor', base: join(homedir(), '.cursor') },
    { name: 'gemini', base: join(homedir(), '.gemini') },
    { name: 'opencode', base: join(homedir(), '.opencode') },
  ];

  const cleaned: string[] = [];
  const errors: string[] = [];

  for (const { name, base } of legacyDirs) {
    for (const subdir of ['skills', 'commands', 'agents']) {
      const dir = join(base, subdir);
      if (!existsSync(dir)) continue;

      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const entryPath = join(dir, entry);
          try {
            const stats = lstatSync(entryPath);
            if (!stats.isSymbolicLink()) continue;

            const linkTarget = readlinkSync(entryPath);
            // Only remove symlinks pointing to Panopticon directories
            if (linkTarget.includes('.panopticon')) {
              unlinkSync(entryPath);
              cleaned.push(`${name}/${subdir}/${entry}`);
            }
          } catch (err: any) {
            errors.push(`${name}/${subdir}/${entry}: ${err.message}`);
          }
        }
      } catch (err: any) {
        // Directory may not be readable, that's fine
        errors.push(`${name}/${subdir}: ${err.message}`);
      }
    }
  }

  return { cleaned, total: cleaned.length, errors };
}

/**
 * Migrate legacy sync config by stripping the 'targets' field from config.toml.
 * This handles users who had `targets = ["claude", "codex"]` in their config.
 */
export function migrateSyncTargetsSync(): { migrated: boolean; hadNonClaudeTargets: boolean } {
  const configPath = join(homedir(), '.panopticon', 'config.toml');

  if (!existsSync(configPath)) {
    return { migrated: false, hadNonClaudeTargets: false };
  }

  try {
    const content = readFileSync(configPath, 'utf-8');

    // Check if targets field exists
    const targetsMatch = content.match(/^targets\s*=\s*\[([^\]]*)\]/m);
    if (!targetsMatch) {
      return { migrated: false, hadNonClaudeTargets: false };
    }

    // Check if non-claude targets were configured
    const targetsStr = targetsMatch[1];
    const hadNonClaudeTargets = /codex|cursor|gemini|opencode/i.test(targetsStr);

    // Remove the targets line
    const newContent = content.replace(/^targets\s*=\s*\[[^\]]*\]\s*\n?/m, '');
    writeFileSync(configPath, newContent, 'utf-8');

    return { migrated: true, hadNonClaudeTargets };
  } catch {
    return { migrated: false, hadNonClaudeTargets: false };
  }
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// One-shot config-migration helpers. Each is run at most once per install at
// CLI startup. Errors are caught internally (return false / empty result), so
// Effect.sync is appropriate here.

/** True when legacy settings.json exists and config.yaml doesn't. Pure. */
export const needsMigration = (): Effect.Effect<boolean> =>
  Effect.sync(() => needsMigrationSync());

/** True if any legacy settings.json is present (with or without yaml). Pure. */
export const hasLegacySettings = (): Effect.Effect<boolean> =>
  Effect.sync(() => hasLegacySettingsSync());

/** Convert a SettingsConfig into a YamlConfig. Pure. */
export const convertToYamlConfig = (
  settings: SettingsConfig,
): Effect.Effect<YamlConfig> => Effect.sync(() => convertToYamlConfigSync(settings));

/** Run the settings.json → config.yaml migration. Surfaces FsError on IO failure. */
export const migrateConfig = (
  options: MigrationOptions = {},
): Effect.Effect<MigrationResult, FsError> =>
  Effect.try({
    try: () => migrateConfigSync(options),
    catch: (cause) =>
      new FsError({ path: NEW_CONFIG_PATH, operation: 'migrate-config', cause }),
  });

/** Inspect migration state without modifying anything. Pure. */
export const getMigrationStatus = (): Effect.Effect<
  ReturnType<typeof getMigrationStatusSync>
> => Effect.sync(() => getMigrationStatusSync());

/** Sweep legacy runtime symlinks under ~/.panopticon (idempotent). */
export const cleanupLegacyRuntimeSymlinks =
  (): Effect.Effect<LegacyCleanupResult> =>
    Effect.sync(() => cleanupLegacyRuntimeSymlinksSync());

/** Migrate `targets = [...]` lines out of config.toml. Pure-ish (catches). */
export const migrateSyncTargets = (): Effect.Effect<{
  migrated: boolean;
  hadNonClaudeTargets: boolean;
}> => Effect.sync(() => migrateSyncTargetsSync());
