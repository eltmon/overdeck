import { readFile } from 'fs/promises';
import yaml from 'js-yaml';
import { getGlobalConfigPath } from '../config-yaml.js';
import type { ExtractionProviderTarget, MemoryProviderSettings } from './providers/types.js';

const CACHE_TTL_MS = 5_000;
let cachedSettings: { path: string; settings: MemorySettings; expiresAt: number } | null = null;

export const DEFAULT_MEMORY_ROLLUP_PENDING_THRESHOLD = 4;
export const DEFAULT_MEMORY_SIDEBAR_REFRESH_INTERVAL_MS = 10_000;
export const DEFAULT_MEMORY_WORKER_CONCURRENCY = 4;

export interface MemorySettings {
  extraction: MemoryProviderSettings;
  observationsEnabled: boolean;
  promptTimeInjectionEnabled: boolean;
  rollupPendingThreshold: number;
  sidebarRefreshIntervalMs: number;
  workerConcurrency: number;
}

export async function loadMemorySettings(configPath = getGlobalConfigPath()): Promise<MemorySettings> {
  const now = Date.now();
  if (cachedSettings && cachedSettings.path === configPath && cachedSettings.expiresAt > now) {
    return cachedSettings.settings;
  }

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
  const extraction = isRecord(memory.extraction) ? memory.extraction : {};
  const features = isRecord(memory.features) ? memory.features : {};
  const fallbackChain = parseFallbackChain(extraction.fallback_chain);

  const settings: MemorySettings = {
    extraction: {
      provider: stringOrUndefined(extraction.provider),
      model: stringOrUndefined(extraction.model),
      perDayCostCapUsd: nonNegativeNumberOrUndefined(extraction.per_day_cost_cap_usd),
      fallbackChain,
    },
    observationsEnabled: booleanOrDefault(features.observations, true),
    promptTimeInjectionEnabled: booleanOrDefault(features.prompt_time_injection, true),
    rollupPendingThreshold: positiveIntegerOrDefault(memory.rollup_pending_threshold, DEFAULT_MEMORY_ROLLUP_PENDING_THRESHOLD),
    sidebarRefreshIntervalMs: positiveIntegerOrDefault(memory.sidebar_refresh_interval_ms, DEFAULT_MEMORY_SIDEBAR_REFRESH_INTERVAL_MS),
    workerConcurrency: positiveIntegerOrDefault(memory.worker_concurrency, DEFAULT_MEMORY_WORKER_CONCURRENCY),
  };

  cachedSettings = { path: configPath, settings, expiresAt: now + CACHE_TTL_MS };
  return settings;
}

export async function getMemoryRollupPendingThreshold(): Promise<number> {
  return (await loadMemorySettings()).rollupPendingThreshold;
}

export async function getMemoryWorkerConcurrency(): Promise<number> {
  return (await loadMemorySettings()).workerConcurrency;
}

export async function areMemoryObservationsEnabled(): Promise<boolean> {
  return (await loadMemorySettings()).observationsEnabled;
}

export async function isMemoryPromptTimeInjectionEnabled(): Promise<boolean> {
  return (await loadMemorySettings()).promptTimeInjectionEnabled;
}

/** Clear the in-memory settings cache. Used by tests that mutate config files. */
export function clearMemorySettingsCache(): void {
  cachedSettings = null;
}

function defaultMemorySettings(): MemorySettings {
  return {
    extraction: {},
    observationsEnabled: true,
    promptTimeInjectionEnabled: true,
    rollupPendingThreshold: DEFAULT_MEMORY_ROLLUP_PENDING_THRESHOLD,
    sidebarRefreshIntervalMs: DEFAULT_MEMORY_SIDEBAR_REFRESH_INTERVAL_MS,
    workerConcurrency: DEFAULT_MEMORY_WORKER_CONCURRENCY,
  };
}

function parseFallbackChain(value: unknown): ExtractionProviderTarget[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const targets = value
    .filter(isRecord)
    .map((target) => ({ provider: stringOrUndefined(target.provider), model: stringOrUndefined(target.model) }))
    .filter((target): target is ExtractionProviderTarget => !!target.provider && !!target.model);
  return targets.length > 0 ? targets : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function nonNegativeNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  return Number.isInteger(value) && (value as number) > 0 ? value as number : fallback;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
