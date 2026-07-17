import { DEFAULT_CONFIG } from '../config-yaml/defaults.js';
import { loadConfigSync } from '../config-yaml/load.js';

const GIB = 1024 ** 3;

export const SYSTEM_HEALTH_DEFAULTS = Object.freeze({
  pollSeconds: 15,
  memoryWarnGb: DEFAULT_CONFIG.resources.memoryWarnGb,
  memoryBlockGb: DEFAULT_CONFIG.resources.memoryBlockGb,
  agentWarnCount: DEFAULT_CONFIG.resources.agentWarnCount,
  agentBlockCount: DEFAULT_CONFIG.resources.agentBlockCount,
  swapUsedWarningPercent: 20,
  swapUsedCriticalPercent: 50,
  cpuLoadWarningPerCore: 1,
  cpuLoadCriticalPerCore: 1.5,
  overcommitWarningPercent: 150,
  overcommitCriticalPercent: 200,
});

export interface SystemHealthThresholds {
  memoryAvailableWarningBytes: number;
  memoryAvailableCriticalBytes: number;
  swapUsedWarningPercent: number;
  swapUsedCriticalPercent: number;
  cpuLoadWarningPerCore: number;
  cpuLoadCriticalPerCore: number;
  overcommitWarningPercent: number;
  overcommitCriticalPercent: number;
}

export interface SystemHealthResourceConfig {
  memoryWarnGb: number;
  memoryBlockGb: number;
  agentWarnCount: number;
  agentBlockCount: number;
}

export interface EffectiveSystemHealthConfig {
  pollSeconds: number;
  resources: SystemHealthResourceConfig;
  thresholds: SystemHealthThresholds;
}

interface SystemHealthConfigInput {
  pollSeconds: unknown;
  memoryWarnGb: unknown;
  memoryBlockGb: unknown;
  agentWarnCount: unknown;
  agentBlockCount: unknown;
  swapUsedWarningPercent: unknown;
  swapUsedCriticalPercent: unknown;
  cpuLoadWarningPerCore: unknown;
  cpuLoadCriticalPerCore: unknown;
  overcommitWarningPercent: unknown;
  overcommitCriticalPercent: unknown;
}

interface ResolveSystemHealthConfigOptions {
  resources?: SystemHealthResourceConfig;
  env?: Record<string, string | undefined>;
  warn?: (message: string) => void;
}

function finiteNonnegative(value: unknown): number | null {
  if (value === '' || value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Normalizes every health threshold in one pass. Any invalid value or reversed
 * pair falls back to its named defaults, and the caller receives one warning
 * describing the complete fallback rather than one warning per field.
 */
export function normalizeSystemHealthThresholds(
  input: SystemHealthConfigInput,
  warn: (message: string) => void = console.warn,
): EffectiveSystemHealthConfig {
  const invalid: string[] = [];

  const scalar = (
    name: keyof SystemHealthConfigInput,
    fallback: number,
    minimum = 0,
  ): number => {
    const value = finiteNonnegative(input[name]);
    if (value == null || value < minimum) {
      invalid.push(String(name));
      return fallback;
    }
    return value;
  };

  const increasingPair = (
    warningName: keyof SystemHealthConfigInput,
    criticalName: keyof SystemHealthConfigInput,
    warningDefault: number,
    criticalDefault: number,
  ): readonly [number, number] => {
    const warning = finiteNonnegative(input[warningName]);
    const critical = finiteNonnegative(input[criticalName]);
    if (warning == null || critical == null || warning > critical) {
      invalid.push(`${String(warningName)}/${String(criticalName)}`);
      return [warningDefault, criticalDefault];
    }
    return [warning, critical];
  };

  const decreasingPair = (
    warningName: keyof SystemHealthConfigInput,
    criticalName: keyof SystemHealthConfigInput,
    warningDefault: number,
    criticalDefault: number,
  ): readonly [number, number] => {
    const warning = finiteNonnegative(input[warningName]);
    const critical = finiteNonnegative(input[criticalName]);
    if (warning == null || critical == null || warning < critical) {
      invalid.push(`${String(warningName)}/${String(criticalName)}`);
      return [warningDefault, criticalDefault];
    }
    return [warning, critical];
  };

  const [memoryWarnGb, memoryBlockGb] = decreasingPair(
    'memoryWarnGb',
    'memoryBlockGb',
    SYSTEM_HEALTH_DEFAULTS.memoryWarnGb,
    SYSTEM_HEALTH_DEFAULTS.memoryBlockGb,
  );
  const [agentWarnCountValue, agentBlockCountValue] = increasingPair(
    'agentWarnCount',
    'agentBlockCount',
    SYSTEM_HEALTH_DEFAULTS.agentWarnCount,
    SYSTEM_HEALTH_DEFAULTS.agentBlockCount,
  );
  const [swapUsedWarningPercent, swapUsedCriticalPercent] = increasingPair(
    'swapUsedWarningPercent',
    'swapUsedCriticalPercent',
    SYSTEM_HEALTH_DEFAULTS.swapUsedWarningPercent,
    SYSTEM_HEALTH_DEFAULTS.swapUsedCriticalPercent,
  );
  const [cpuLoadWarningPerCore, cpuLoadCriticalPerCore] = increasingPair(
    'cpuLoadWarningPerCore',
    'cpuLoadCriticalPerCore',
    SYSTEM_HEALTH_DEFAULTS.cpuLoadWarningPerCore,
    SYSTEM_HEALTH_DEFAULTS.cpuLoadCriticalPerCore,
  );
  const [overcommitWarningPercent, overcommitCriticalPercent] = increasingPair(
    'overcommitWarningPercent',
    'overcommitCriticalPercent',
    SYSTEM_HEALTH_DEFAULTS.overcommitWarningPercent,
    SYSTEM_HEALTH_DEFAULTS.overcommitCriticalPercent,
  );

  const pollSeconds = scalar('pollSeconds', SYSTEM_HEALTH_DEFAULTS.pollSeconds, 1);
  const agentWarnCount = Math.max(1, Math.floor(agentWarnCountValue));
  const agentBlockCount = Math.max(1, Math.floor(agentBlockCountValue));

  if (invalid.length > 0) {
    warn(`[system-health] Invalid thresholds (${invalid.join(', ')}); using named defaults.`);
  }

  return {
    pollSeconds: Math.max(1, Math.floor(pollSeconds)),
    resources: {
      memoryWarnGb,
      memoryBlockGb,
      agentWarnCount,
      agentBlockCount,
    },
    thresholds: {
      memoryAvailableWarningBytes: memoryWarnGb * GIB,
      memoryAvailableCriticalBytes: memoryBlockGb * GIB,
      swapUsedWarningPercent,
      swapUsedCriticalPercent,
      cpuLoadWarningPerCore,
      cpuLoadCriticalPerCore,
      overcommitWarningPercent,
      overcommitCriticalPercent,
    },
  };
}

export function resolveSystemHealthConfig(
  options: ResolveSystemHealthConfigOptions = {},
): EffectiveSystemHealthConfig {
  const resources = options.resources ?? loadConfigSync().config.resources;
  const env = options.env ?? process.env;

  return normalizeSystemHealthThresholds({
    pollSeconds: env['PAN_HEALTH_POLL_SECONDS'] ?? SYSTEM_HEALTH_DEFAULTS.pollSeconds,
    memoryWarnGb: env['PAN_MEMORY_WARN_GB'] ?? resources.memoryWarnGb,
    memoryBlockGb: env['PAN_MEMORY_BLOCK_GB'] ?? resources.memoryBlockGb,
    agentWarnCount: env['PAN_AGENT_WARN_COUNT'] ?? resources.agentWarnCount,
    agentBlockCount: env['PAN_AGENT_BLOCK_COUNT'] ?? resources.agentBlockCount,
    swapUsedWarningPercent: env['PAN_HEALTH_SWAP_WARN_PERCENT'] ?? SYSTEM_HEALTH_DEFAULTS.swapUsedWarningPercent,
    swapUsedCriticalPercent: env['PAN_HEALTH_SWAP_CRITICAL_PERCENT'] ?? SYSTEM_HEALTH_DEFAULTS.swapUsedCriticalPercent,
    cpuLoadWarningPerCore: env['PAN_HEALTH_LOAD_WARN_PER_CORE'] ?? SYSTEM_HEALTH_DEFAULTS.cpuLoadWarningPerCore,
    cpuLoadCriticalPerCore: env['PAN_HEALTH_LOAD_CRITICAL_PER_CORE'] ?? SYSTEM_HEALTH_DEFAULTS.cpuLoadCriticalPerCore,
    overcommitWarningPercent: env['PAN_HEALTH_OVERCOMMIT_WARN_PERCENT'] ?? SYSTEM_HEALTH_DEFAULTS.overcommitWarningPercent,
    overcommitCriticalPercent: env['PAN_HEALTH_OVERCOMMIT_CRITICAL_PERCENT'] ?? SYSTEM_HEALTH_DEFAULTS.overcommitCriticalPercent,
  }, options.warn);
}
