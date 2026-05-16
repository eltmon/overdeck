import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';
import {
  getDefaultTtsDaemonConfig,
  getGlobalConfigPath,
  mergeTtsDaemonConfigs,
  type NormalizedTtsDaemonConfig,
  type TtsDaemonConfig,
  type YamlConfig,
} from '../../../lib/config-yaml.js';

let currentConfig: NormalizedTtsDaemonConfig = getDefaultTtsDaemonConfig();

function cloneTtsConfig(config: NormalizedTtsDaemonConfig): NormalizedTtsDaemonConfig {
  return {
    ...config,
    voiceMap: { ...config.voiceMap },
    mutedSources: [...config.mutedSources],
    utteranceTemplates: { ...config.utteranceTemplates },
    mutedIssues: [...config.mutedIssues],
  };
}

async function readYamlConfig(filePath: string): Promise<YamlConfig | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return (yaml.load(content) as YamlConfig | undefined) ?? {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.error(`Error loading YAML config from ${filePath}:`, error);
    return null;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    return false;
  }
}

async function findProjectRootAsync(startDir: string = process.cwd()): Promise<string | null> {
  let currentDir = startDir;

  while (currentDir !== '/') {
    if (await pathExists(join(currentDir, '.git'))) return currentDir;
    currentDir = join(currentDir, '..');
  }

  return null;
}

async function readProjectConfig(): Promise<YamlConfig | null> {
  const projectRoot = await findProjectRootAsync();
  if (!projectRoot) return null;

  const configPath = join(projectRoot, '.pan.yaml');
  if (await pathExists(configPath)) return readYamlConfig(configPath);

  const legacyConfigPath = join(projectRoot, '.panopticon.yaml');
  if (await pathExists(legacyConfigPath)) return readYamlConfig(legacyConfigPath);

  return null;
}

export function getTtsRuntimeConfig(): NormalizedTtsDaemonConfig {
  return cloneTtsConfig(currentConfig);
}

export function setTtsRuntimeConfig(config: NormalizedTtsDaemonConfig): void {
  currentConfig = cloneTtsConfig(config);
}

export function applyTtsRuntimeSettings(tts: TtsDaemonConfig | undefined): NormalizedTtsDaemonConfig {
  if (!tts) return getTtsRuntimeConfig();

  currentConfig = mergeTtsDaemonConfigs({ tts: currentConfig }, { tts });
  return getTtsRuntimeConfig();
}

export async function refreshTtsRuntimeConfig(): Promise<NormalizedTtsDaemonConfig> {
  const [globalConfig, projectConfig] = await Promise.all([
    readYamlConfig(getGlobalConfigPath()),
    readProjectConfig(),
  ]);

  currentConfig = mergeTtsDaemonConfigs(globalConfig, projectConfig);
  return getTtsRuntimeConfig();
}
