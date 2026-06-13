import { exec } from 'child_process';
import { promisify } from 'util';
import { canUseHarnessSync, canUseModelWithAuthSync } from './harness-policy.js';
import { getBuiltInDefaultHarness, getProviderForModelSync } from './providers.js';
import type { RuntimeName } from './runtimes/types.js';
import type { Role } from './agents.js';
import { loadConfigSync as loadYamlConfig } from './config-yaml.js';

const execAsync = promisify(exec);
const BINARY_BY_HARNESS: Partial<Record<RuntimeName, string>> = {
  pi: 'pi',
  codex: 'codex',
};
const harnessAvailabilityCache = new Map<RuntimeName, Promise<boolean>>();
const builtInDefaultNoticeProviders = new Set<string>();

export function resetHarnessResolveCachesForTests(): void {
  if (process.env.NODE_ENV !== 'test') return;
  harnessAvailabilityCache.clear();
  builtInDefaultNoticeProviders.clear();
}

export type ResolveHarnessInput = {
  explicit?: RuntimeName;
  role?: Role;
  model: string;
};

export class HarnessResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarnessResolutionError';
  }
}

async function getProviderAuthModeForModel(model: string) {
  const { getProviderAuthMode } = await import('./agents.js');
  return getProviderAuthMode(model);
}

async function hasHarnessBinary(harness: RuntimeName): Promise<boolean> {
  const binary = BINARY_BY_HARNESS[harness];
  if (!binary) return true;

  const cached = harnessAvailabilityCache.get(harness);
  if (cached) return cached;

  const check = execAsync(`command -v ${binary}`).then(
    () => true,
    () => false
  );
  harnessAvailabilityCache.set(harness, check);
  return check;
}

function logBuiltInDefaultNotice(provider: string, harness: RuntimeName): void {
  if (builtInDefaultNoticeProviders.has(provider)) return;
  builtInDefaultNoticeProviders.add(provider);
  console.info(`harness ${harness} chosen by provider default — override in Settings → Providers`);
}

export async function resolveHarness(input: ResolveHarnessInput): Promise<RuntimeName> {
  const provider = getProviderForModelSync(input.model).name;
  const { config } = loadYamlConfig();
  const roleHarness = input.role ? config.roles?.[input.role]?.harness : undefined;
  const providerHarness = config.providerHarnesses?.[provider];
  const builtInHarness = getBuiltInDefaultHarness(provider);

  const winner = input.explicit ?? roleHarness ?? providerHarness ?? builtInHarness ?? 'claude-code';
  const winnerIsExplicit = input.explicit !== undefined;

  if (!input.explicit && !roleHarness && !providerHarness) {
    logBuiltInDefaultNotice(provider, winner);
  }

  const authMode = await getProviderAuthModeForModel(input.model);
  const modelDecision = canUseModelWithAuthSync(input.model, authMode);
  if (!modelDecision.allowed) {
    throw new HarnessResolutionError(modelDecision.reason ?? `Model ${input.model} is not allowed with the current auth mode`);
  }

  const decision = canUseHarnessSync(winner, input.model, authMode);
  if (!decision.allowed) {
    if (winnerIsExplicit) {
      throw new HarnessResolutionError(decision.reason ?? `Harness ${winner} is not allowed for ${input.model}`);
    }

    const fallbackDecision = canUseHarnessSync('claude-code', input.model, authMode);
    if (!fallbackDecision.allowed) {
      throw new HarnessResolutionError(decision.reason ?? fallbackDecision.reason ?? `Harness ${winner} is not allowed for ${input.model}`);
    }

    console.warn(`harness ${winner} denied for ${provider}: ${decision.reason ?? 'policy denied'} — falling back to claude-code`);
    return 'claude-code';
  }

  if (!(await hasHarnessBinary(winner))) {
    const binary = BINARY_BY_HARNESS[winner];
    console.warn(`harness ${winner} requested for ${provider}, but ${binary} is not installed — falling back to claude-code`);
    return 'claude-code';
  }

  return winner;
}
