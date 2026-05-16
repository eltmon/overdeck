import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';
import {
  getDefaultTtsDaemonConfig,
  getGlobalConfigPath,
  mergeTtsDaemonConfigs,
  type NormalizedTtsDaemonConfig,
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

  while (true) {
    if (await pathExists(join(currentDir, '.git'))) return currentDir;

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

async function readProjectConfig(): Promise<YamlConfig | null> {
  const projectRoot = await findProjectRootAsync();
  if (!projectRoot) return null;

  const configPath = join(projectRoot, '.pan.yaml');
  if (await pathExists(configPath)) return stripProjectTtsEndpoint(await readYamlConfig(configPath));

  const legacyConfigPath = join(projectRoot, '.panopticon.yaml');
  if (await pathExists(legacyConfigPath)) return stripProjectTtsEndpoint(await readYamlConfig(legacyConfigPath));

  return null;
}

export function getTtsRuntimeConfig(): NormalizedTtsDaemonConfig {
  return cloneTtsConfig(currentConfig);
}

export function setTtsRuntimeConfig(config: NormalizedTtsDaemonConfig): void {
  currentConfig = cloneTtsConfig(config);
}

export async function refreshTtsRuntimeConfig(): Promise<NormalizedTtsDaemonConfig> {
  const [globalConfig, projectConfig] = await Promise.all([
    readYamlConfig(getGlobalConfigPath()),
    readProjectConfig(),
  ]);

  currentConfig = mergeTtsDaemonConfigs(globalConfig, projectConfig);
  return getTtsRuntimeConfig();
}
