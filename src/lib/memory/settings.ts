import { readFile } from 'fs/promises';
import yaml from 'js-yaml';
import { getGlobalConfigPath } from '../config-yaml.js';

export const DEFAULT_MEMORY_ROLLUP_PENDING_THRESHOLD = 4;

export interface MemorySettings {
  rollupPendingThreshold: number;
}

export async function loadMemorySettings(configPath = getGlobalConfigPath()): Promise<MemorySettings> {
  let parsed: unknown;
  try {
    parsed = yaml.load(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return defaultMemorySettings();
    }
    throw error;
  }

  const config = isRecord(parsed) ? parsed : {};
  const memory = isRecord(config.memory) ? config.memory : {};
  const threshold = memory.rollup_pending_threshold;

  return {
    rollupPendingThreshold: positiveIntegerOrDefault(threshold, DEFAULT_MEMORY_ROLLUP_PENDING_THRESHOLD),
  };
}

export async function getMemoryRollupPendingThreshold(): Promise<number> {
  return (await loadMemorySettings()).rollupPendingThreshold;
}

function defaultMemorySettings(): MemorySettings {
  return { rollupPendingThreshold: DEFAULT_MEMORY_ROLLUP_PENDING_THRESHOLD };
}

function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  return Number.isInteger(value) && (value as number) > 0 ? value as number : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
