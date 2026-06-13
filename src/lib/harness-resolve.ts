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

    // PAN-1871 — only fall back to claude-code when it is the model's NATIVE
    // harness (Anthropic). For CLIProxy-routed models (kimi, gpt-5.5, …) the
    // provider default is pi/codex; claude-code would route them through
    // CLIProxy and hit the 200k-window-illusion deadlock. Silently degrading
    // there is worse than failing, so refuse it loudly.
    if (builtInHarness && builtInHarness !== 'claude-code') {
      throw new HarnessResolutionError(
        `Harness ${winner} denied for ${input.model} (${decision.reason ?? 'policy denied'}); ${input.model} is not native to claude-code (provider default is ${builtInHarness}), so refusing to silently fall back to claude-code/CLIProxy. Resolve ${winner} availability/auth and retry.`,
      );
    }

    const fallbackDecision = canUseHarnessSync('claude-code', input.model, authMode);
    if (!fallbackDecision.allowed) {
      throw new HarnessResolutionError(decision.reason ?? fallbackDecision.reason ?? `Harness ${winner} is not allowed for ${input.model}`);
    }

    console.warn(`harness ${winner} denied for ${provider}: ${decision.reason ?? 'policy denied'} — falling back to native claude-code`);
    return 'claude-code';
  }

  if (!(await hasHarnessBinary(winner))) {
    const binary = BINARY_BY_HARNESS[winner];
    // PAN-1871 — never silently fall back to claude-code from (a) an
    // explicitly-requested harness, or (b) a non-native (CLIProxy) model whose
    // own binary is missing at spawn. Silently routing kimi onto claude-code is
    // what leaked PAN-1845. Fail loudly so the cause is visible and recoverable.
    if (winnerIsExplicit || (builtInHarness && builtInHarness !== 'claude-code')) {
      throw new HarnessResolutionError(
        `Harness ${winner} (${winnerIsExplicit ? 'explicitly requested' : `provider default for ${input.model}`}) has no installed ${binary} binary at spawn — refusing to silently fall back to claude-code. Install ${binary} (check its PATH) and retry.`,
      );
    }
    console.warn(`harness ${winner} requested for ${provider}, but ${binary} is not installed — falling back to native claude-code`);
    return 'claude-code';
  }

  return winner;
}
