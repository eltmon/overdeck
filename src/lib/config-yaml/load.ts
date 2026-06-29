import { readFileSync, existsSync, writeFileSync, copyFileSync, statSync, chmodSync } from 'fs';
import { readFile as readFileAsync, writeFile as writeFileAsync, stat as statAsync, mkdir as mkdirAsync, chmod as chmodAsync } from 'fs/promises';
import { dirname, join } from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';
import { parseDocument } from 'yaml';
import { Effect } from 'effect';
import { ConfigError, ConfigParseError } from '../errors.js';
import { MODEL_DEPRECATIONS } from '../model-capabilities.js';
import type { ModelProvider } from '../model-fallback.js';
import type { ModelId } from '../settings.js';
import { DEFAULT_CONFIG, GLOBAL_CONFIG_PATH } from './defaults.js';
import { mergeConfigs } from './merge.js';
import {
  type ConfigLoadResult,
  type ConversationsConfig,
  type MigrationResult,
  type NormalizedConfig,
  type NormalizedConversationSearchConfig,
  type RuntimeConversationsConfig,
  type YamlConfig,
} from './schema.js';

export function resolveConversationWatchDirs(config: RuntimeConversationsConfig): RuntimeConversationsConfig {
  return {
    ...config,
    watchDirs: config.watchDirs.map((dir) =>
      dir.startsWith('~/') ? join(homedir(), dir.slice(2)) : dir,
    ),
  };
}

export function getConversationsConfigSync(): RuntimeConversationsConfig {
  const { config } = loadConfigSync();
  return resolveConversationWatchDirs({
    ...config.conversations,
    apiKeys: config.apiKeys,
    enabledProviders: config.enabledProviders,
  });
}

export function getConversationSearchConfigSync(): NormalizedConversationSearchConfig {
  const { config } = loadConfigSync();
  return config.conversationSearch;
}

/**
 * Load and parse a YAML config file
 */
function loadYamlFile(filePath: string): YamlConfig | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(content) as YamlConfig;
    return parsed || {};
  } catch (error) {
    console.error(`Error loading YAML config from ${filePath}:`, error);
    return null;
  }
}

/**
 * Find project root by looking for .git directory
 */
function findProjectRoot(startDir: string = process.cwd()): string | null {
  let currentDir = startDir;

  while (true) {
    if (existsSync(join(currentDir, '.git'))) {
      return currentDir;
    }

    const parent = dirname(currentDir);
    if (parent === currentDir) return null;
    currentDir = parent;
  }
}

export function stripProjectTtsEndpoint(config: YamlConfig | null): YamlConfig | null {
  if (!config?.tts) return config;
  const { daemonHost: _daemonHost, daemonPort: _daemonPort, ...tts } = config.tts;
  return { ...config, tts };
}

/**
 * Load per-project config (.pan.yaml in project root, with fallback to .overdeck.yaml)
 */
function loadProjectConfig(): YamlConfig | null {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    return null;
  }

  const newConfigPath = join(projectRoot, '.pan.yaml');
  if (existsSync(newConfigPath)) {
    return stripProjectTtsEndpoint(loadYamlFile(newConfigPath));
  }

  const legacyConfigPath = join(projectRoot, '.overdeck.yaml');
  if (existsSync(legacyConfigPath)) {
    process.stderr.write(
      `[overdeck] Deprecation warning: .overdeck.yaml is deprecated. Rename it to .pan.yaml.\n`
    );
    return stripProjectTtsEndpoint(loadYamlFile(legacyConfigPath));
  }

  return null;
}

/**
 * Load global config (~/.overdeck/config.yaml)
 */
function loadGlobalConfig(): YamlConfig | null {
  return loadYamlFile(GLOBAL_CONFIG_PATH);
}

async function loadYamlFileFromDisk(filePath: string): Promise<YamlConfig | null> {
  try {
    const content = await readFileAsync(filePath, 'utf-8');
    const parsed = yaml.load(content) as YamlConfig;
    return parsed || {};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    console.error(`Error loading YAML config from ${filePath}:`, error);
    return null;
  }
}

async function findProjectRootFromDisk(startDir: string = process.cwd()): Promise<string | null> {
  let currentDir = startDir;

  while (currentDir !== '/') {
    try {
      await statAsync(join(currentDir, '.git'));
      return currentDir;
    } catch { /* keep walking */ }
    currentDir = join(currentDir, '..');
  }

  return null;
}

async function loadProjectConfigFromDisk(): Promise<YamlConfig | null> {
  const projectRoot = await findProjectRootFromDisk();
  if (!projectRoot) return null;

  const newConfigPath = join(projectRoot, '.pan.yaml');
  if (await pathExistsFromDisk(newConfigPath)) return stripProjectTtsEndpoint(await loadYamlFileFromDisk(newConfigPath));

  const legacyConfigPath = join(projectRoot, '.overdeck.yaml');
  if (await pathExistsFromDisk(legacyConfigPath)) {
    process.stderr.write(
      `[overdeck] Deprecation warning: .overdeck.yaml is deprecated. Rename it to .pan.yaml.\n`
    );
    return stripProjectTtsEndpoint(await loadYamlFileFromDisk(legacyConfigPath));
  }

  return null;
}

async function loadGlobalConfigFromDisk(): Promise<YamlConfig | null> {
  return loadYamlFileFromDisk(GLOBAL_CONFIG_PATH);
}

async function pathExistsFromDisk(filePath: string): Promise<boolean> {
  try {
    await statAsync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect deprecated model IDs in config overrides
 *
 * Returns array of migrations to perform, or empty array if none found.
 */
function detectDeprecatedModels(config: YamlConfig | null): Array<{
  workType: string;
  from: string;
  to: string;
}> {
  if (!config?.models?.overrides) {
    return [];
  }

  const migrations: Array<{ workType: string; from: string; to: string }> = [];

  for (const [workType, modelId] of Object.entries(config.models.overrides)) {
    if (modelId && MODEL_DEPRECATIONS[modelId]) {
      migrations.push({
        workType,
        from: modelId,
        to: MODEL_DEPRECATIONS[modelId],
      });
    }
  }

  return migrations;
}

/**
 * Apply deprecation migrations to a YamlConfig (in-place)
 */
function applyMigrations(
  config: YamlConfig,
  migrations: Array<{ workType: string; from: string; to: string }>
): void {
  if (!config.models) {
    config.models = {};
  }
  if (!config.models.overrides) {
    config.models.overrides = {};
  }

  for (const { workType, to } of migrations) {
    config.models.overrides[workType] = to as ModelId;
  }
}

/**
 * Create backup of global config file
 */
function backupGlobalConfig(): boolean {
  try {
    const backupPath = `${GLOBAL_CONFIG_PATH}.bak`;
    copyFileSync(GLOBAL_CONFIG_PATH, backupPath);
    console.log(`✓ Backed up config.yaml → config.yaml.bak`);
    return true;
  } catch (error) {
    console.error(`Failed to create config backup:`, error);
    return false;
  }
}

/**
 * Write YamlConfig back to global config file
 */
function writeGlobalConfig(config: YamlConfig): void {
  const yamlContent = yaml.dump(config, {
    indent: 2,
    lineWidth: 100,
    noRefs: true,
  });

  writeFileSync(GLOBAL_CONFIG_PATH, yamlContent, 'utf-8');
  // config.yaml contains API keys in api_keys.* — must not be world-readable.
  // writeFileSync's `mode` option is only honored on file creation, so chmod
  // explicitly to handle the case where the file already exists with looser
  // permissions (e.g. from an older install).
  chmodSync(GLOBAL_CONFIG_PATH, 0o600);
}

// ─── In-memory config cache (invalidated on file mtime change) ───────────────

interface ConfigCache {
  globalMtime: number;
  projectMtime: number;
  result: ConfigLoadResult;
}

let configCache: ConfigCache | null = null;

/**
 * Explicitly clear the in-memory config cache.
 *
 * The mtime-based cache invalidation in loadConfig() can miss rapid writes
 * (same-millisecond save → spawn) or coarse filesystem mtime resolution.
 * Call this after writing config.yaml to guarantee the next loadConfig()
 * reads from disk rather than returning stale cached data.
 */
export function clearConfigCache(): void {
  configCache = null;
}

function applyEnvironmentFallbacks(config: NormalizedConfig, explicitlyDisabled: Set<ModelProvider>): void {
  if (process.env.OPENAI_API_KEY && !config.apiKeys.openai) {
    config.apiKeys.openai = process.env.OPENAI_API_KEY;
    if (!explicitlyDisabled.has('openai')) config.enabledProviders.add('openai');
  }
  if (process.env.VOYAGE_API_KEY && !config.apiKeys.voyage) {
    config.apiKeys.voyage = process.env.VOYAGE_API_KEY;
  }
  if (process.env.GOOGLE_API_KEY && !config.apiKeys.google) {
    config.apiKeys.google = process.env.GOOGLE_API_KEY;
    if (!explicitlyDisabled.has('google')) config.enabledProviders.add('google');
  }
  if (process.env.MINIMAX_API_KEY && !config.apiKeys.minimax) {
    config.apiKeys.minimax = process.env.MINIMAX_API_KEY;
    if (!explicitlyDisabled.has('minimax')) config.enabledProviders.add('minimax');
  }
  if (process.env.ZAI_API_KEY && !config.apiKeys.zai) {
    config.apiKeys.zai = process.env.ZAI_API_KEY;
    if (!explicitlyDisabled.has('zai')) config.enabledProviders.add('zai');
  }
  const kimiKey = process.env.KIMI_CODING_API_KEY || process.env.KIMI_API_KEY;
  if (kimiKey && !config.apiKeys.kimi) {
    config.apiKeys.kimi = kimiKey;
    if (!explicitlyDisabled.has('kimi')) config.enabledProviders.add('kimi');
  }
  if (process.env.OPENROUTER_API_KEY && !config.apiKeys.openrouter) {
    config.apiKeys.openrouter = process.env.OPENROUTER_API_KEY;
    if (!explicitlyDisabled.has('openrouter')) config.enabledProviders.add('openrouter');
  }
  if (process.env.MIMO_API_KEY && !config.apiKeys.mimo) {
    config.apiKeys.mimo = process.env.MIMO_API_KEY;
    if (!explicitlyDisabled.has('mimo')) config.enabledProviders.add('mimo');
  }
  if (process.env.NOUS_API_KEY && !config.apiKeys.nous) {
    config.apiKeys.nous = process.env.NOUS_API_KEY;
    if (!explicitlyDisabled.has('nous')) config.enabledProviders.add('nous');
  }
  if (process.env.DASHSCOPE_API_KEY && !config.apiKeys.dashscope) {
    config.apiKeys.dashscope = process.env.DASHSCOPE_API_KEY;
    if (!explicitlyDisabled.has('dashscope')) config.enabledProviders.add('dashscope');
  }
  if (process.env.LINEAR_API_KEY && !config.trackerKeys.linear) config.trackerKeys.linear = process.env.LINEAR_API_KEY;
  if (process.env.GITHUB_TOKEN && !config.trackerKeys.github) config.trackerKeys.github = process.env.GITHUB_TOKEN;
  if (process.env.GITLAB_TOKEN && !config.trackerKeys.gitlab) config.trackerKeys.gitlab = process.env.GITLAB_TOKEN;
  if (process.env.RALLY_API_KEY && !config.trackerKeys.rally) config.trackerKeys.rally = process.env.RALLY_API_KEY;
  if (process.env.SHADOW_MODE !== undefined) {
    config.shadow.enabled = ['true', '1', 'yes'].includes(process.env.SHADOW_MODE.toLowerCase());
  }
}

function getConfigMtimes(): { global: number; project: number } {
  let globalMtime = 0;
  let projectMtime = 0;

  try {
    if (existsSync(GLOBAL_CONFIG_PATH)) {
      globalMtime = statSync(GLOBAL_CONFIG_PATH).mtimeMs;
    }
  } catch { /* file may race */ }

  const projectRoot = findProjectRoot();
  if (projectRoot) {
    for (const name of ['.pan.yaml', '.overdeck.yaml']) {
      const path = join(projectRoot, name);
      try {
        if (existsSync(path)) {
          projectMtime = statSync(path).mtimeMs;
          break;
        }
      } catch { /* file may race */ }
    }
  }

  return { global: globalMtime, project: projectMtime };
}

async function getConfigMtimesFromDisk(): Promise<{ global: number; project: number }> {
  const globalMtime = await getMtimeFromDisk(GLOBAL_CONFIG_PATH);
  let projectMtime = 0;

  const projectRoot = await findProjectRootFromDisk();
  if (projectRoot) {
    for (const name of ['.pan.yaml', '.overdeck.yaml']) {
      projectMtime = await getMtimeFromDisk(join(projectRoot, name));
      if (projectMtime > 0) break;
    }
  }

  return { global: globalMtime, project: projectMtime };
}

async function getMtimeFromDisk(filePath: string): Promise<number> {
  try {
    return (await statAsync(filePath)).mtimeMs;
  } catch {
    return 0;
  }
}

async function loadConfigWithoutMigration(): Promise<ConfigLoadResult> {
  const mtimes = await getConfigMtimesFromDisk();
  if (
    configCache &&
    configCache.globalMtime === mtimes.global &&
    configCache.projectMtime === mtimes.project
  ) {
    return configCache.result;
  }

  const [globalConfig, projectConfig] = await Promise.all([
    loadGlobalConfigFromDisk(),
    loadProjectConfigFromDisk(),
  ]);
  const { config, explicitlyDisabled } = mergeConfigs(projectConfig, globalConfig);
  applyEnvironmentFallbacks(config, explicitlyDisabled);

  const result: ConfigLoadResult = { config };
  const freshMtimes = await getConfigMtimesFromDisk();
  configCache = {
    globalMtime: freshMtimes.global,
    projectMtime: freshMtimes.project,
    result,
  };
  return result;
}

/**
 * Load complete configuration (global + project + defaults)
 * Also loads API keys from environment variables as fallback
 *
 * IMPORTANT: This function may modify config.yaml if deprecated model IDs
 * are detected. A backup is created before any modifications.
 *
 * Results are cached in memory and invalidated when the underlying config
 * files change (checked via mtime).
 */
export function loadConfigSync(): ConfigLoadResult {
  const mtimes = getConfigMtimes();
  if (
    configCache &&
    configCache.globalMtime === mtimes.global &&
    configCache.projectMtime === mtimes.project
  ) {
    return configCache.result;
  }

  let globalConfig = loadGlobalConfig();
  const projectConfig = loadProjectConfig();

  // Check for deprecated models in global config
  let migrationResult: MigrationResult | undefined;
  if (globalConfig && hasGlobalConfig()) {
    const migrations = detectDeprecatedModels(globalConfig);

    if (migrations.length > 0) {
      const backedUp = backupGlobalConfig();

      applyMigrations(globalConfig, migrations);
      writeGlobalConfig(globalConfig);

      if (migrations.length > 0) {
        console.log('\n🔄 Model ID Migration:');
        for (const { workType, from, to } of migrations) {
          console.log(`  ${workType}: ${from} → ${to}`);
        }
      }
      console.log('');

      migrationResult = { migrated: migrations, backedUp };
    }
  }

  const { config, explicitlyDisabled } = mergeConfigs(projectConfig, globalConfig);

  applyEnvironmentFallbacks(config, explicitlyDisabled);

  const result: ConfigLoadResult = { config, migration: migrationResult };

  // Update cache with fresh mtimes (migration may have written global config)
  const freshMtimes = getConfigMtimes();
  configCache = {
    globalMtime: freshMtimes.global,
    projectMtime: freshMtimes.project,
    result,
  };

  return result;
}

/**
 * Check if a project-level config exists (.pan.yaml or .overdeck.yaml)
 */
export function hasProjectConfig(): boolean {
  const projectRoot = findProjectRoot();
  if (!projectRoot) return false;
  return existsSync(join(projectRoot, '.pan.yaml')) || existsSync(join(projectRoot, '.overdeck.yaml'));
}

/**
 * Check if global config exists
 */
export function hasGlobalConfig(): boolean {
  return existsSync(GLOBAL_CONFIG_PATH);
}

/**
 * Get path to global config file
 */
export function getGlobalConfigPath(): string {
  return GLOBAL_CONFIG_PATH;
}

/**
 * Get path to project config file (null if not in a project).
 * Returns .pan.yaml if it exists, falls back to .overdeck.yaml, otherwise returns .pan.yaml as default.
 */
export function getProjectConfigPath(): string | null {
  const projectRoot = findProjectRoot();
  if (!projectRoot) return null;
  if (existsSync(join(projectRoot, '.pan.yaml'))) {
    return join(projectRoot, '.pan.yaml');
  }
  if (existsSync(join(projectRoot, '.overdeck.yaml'))) {
    return join(projectRoot, '.overdeck.yaml');
  }
  return join(projectRoot, '.pan.yaml');
}

/**
 * Returns whether the experimental Claude Code Channels prompt-delivery flag
 * is enabled. Resolves via loadConfig() so the value reflects merged global,
 * project, and env-var sources at the moment of the call.
 */
export function isClaudeCodeChannelsEnabled(): boolean {
  return loadConfigSync().config.experimental.claudeCodeChannels;
}

export function isClaudeCodeChannelsMcpEnabled(): boolean {
  return loadConfigSync().config.experimental.claudeCodeChannelsMcp;
}

/**
 * Whether TLDR (token-efficient code analysis) is enabled. Gates whether agents
 * advertise/use the TLDR MCP tools and whether the per-workspace TLDR daemon is
 * started at spawn. Read at session launch — a change only affects sessions
 * launched/resumed after it. Defaults to true when unset.
 */
export function isTldrEnabledSync(): boolean {
  try {
    return loadConfigSync().config.tldr.enabled;
  } catch {
    return DEFAULT_CONFIG.tldr.enabled;
  }
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect-native loadConfigWithoutMigration. Reads global + project config,
 * merges with defaults, applies env fallbacks. Fails with ConfigParseError
 * for malformed YAML or ConfigError for other I/O failures.
 */
export const loadConfigNoMigration = (): Effect.Effect<
  ConfigLoadResult,
  ConfigError | ConfigParseError
> =>
  Effect.tryPromise({
    try: () => loadConfigWithoutMigration(),
    catch: (cause) =>
      new ConfigError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

export const getConversationsConfig = (): Effect.Effect<
  RuntimeConversationsConfig,
  ConfigError | ConfigParseError
> =>
  Effect.gen(function* () {
    const { config } = yield* loadConfigNoMigration();
    return resolveConversationWatchDirs({
      ...config.conversations,
      apiKeys: config.apiKeys,
      enabledProviders: config.enabledProviders,
    });
  });

/**
 * Effect-native loadConfig — sync read, wraps any failure (parse / fs) as
 * ConfigError. Use this from Effect contexts that need merged config without
 * forcing the codebase to migrate every loadConfig call site.
 */
export const loadConfig = (): Effect.Effect<ConfigLoadResult, ConfigError> =>
  Effect.try({
    try: () => loadConfigSync(),
    catch: (cause) =>
      new ConfigError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/**
 * Effect-native updateConversationsConfig. Persists the supplied
 * ConversationsConfig overrides into config.yaml. Fails with ConfigError on
 * write failure.
 */
export const updateConversationsConfig = (
  updates: ConversationsConfig,
): Effect.Effect<void, ConfigError | ConfigParseError> =>
  Effect.tryPromise({
    try: async () => {
      await loadConfigWithoutMigration();
      let existingContent = '{}\n';
      try {
        const content = await readFileAsync(GLOBAL_CONFIG_PATH, 'utf-8');
        existingContent = content.trim().length > 0 ? content : '{}\n';
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw error;
      }

      const doc = parseDocument(existingContent);
      if (doc.contents === null) {
        doc.contents = parseDocument('{}\n').contents;
      }

      for (const [key, value] of Object.entries(updates) as Array<[keyof ConversationsConfig, unknown]>) {
        if (value !== undefined) doc.setIn(['conversations', key], value);
      }

      await mkdirAsync(dirname(GLOBAL_CONFIG_PATH), { recursive: true });
      await writeFileAsync(GLOBAL_CONFIG_PATH, doc.toString({ lineWidth: 120 }), 'utf-8');
      // config.yaml contains API keys in api_keys.* — must not be world-readable.
      // writeFile's `mode` option is only honored on file creation, so chmod
      // explicitly to handle the case where the file already exists with looser
      // permissions (e.g. from an older install).
      await chmodAsync(GLOBAL_CONFIG_PATH, 0o600);
      clearConfigCache();
    },
    catch: (cause) =>
      new ConfigError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
