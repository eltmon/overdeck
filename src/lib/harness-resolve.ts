import { canUseHarnessSync, canUseModelWithAuthSync } from './harness-policy.js';
import { harnessBinaryName, resolveHarnessBinary } from './harness-binary.js';
import { getBuiltInDefaultHarness, getProviderForModelSync } from './providers.js';
import type { RuntimeName } from './runtimes/types.js';
import type { Role } from './agents.js';
import { loadConfigSync as loadYamlConfig } from './config-yaml.js';

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

function assertHarnessProviderSupported(harness: RuntimeName, provider: string): void {
  if (harness === 'acp' && provider !== 'kimi') {
    throw new HarnessResolutionError(`ACP provider ${provider} is not supported; Kimi is the only ACP provider in v1.`);
  }
}

async function hasHarnessBinary(harness: RuntimeName): Promise<boolean> {
  // Claude Code availability is enforced by the shared launch preflight. Keep
  // the native fallback decision here independent of whether Claude is installed.
  if (harness === 'claude-code') return true;

  const cached = harnessAvailabilityCache.get(harness);
  if (cached) return cached;

  const check = resolveHarnessBinary(harness).then((resolved) => resolved !== null);
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
  // Harness is PROVIDER-DEFAULT-ONLY (PAN-1984). It is derived solely from the model's
  // provider — the per-provider default (Settings → Providers) else the built-in default.
  // We no longer honor a per-spawn explicit override or a per-role harness:
  // `input.explicit` / `input.role` are accepted for signature compatibility but
  // INTENTIONALLY IGNORED. This removes the entire class of harness↔model mismatch bugs
  // (e.g. Pi+GPT-5.5 selected when Codex is GPT-5.5's real provider default) and the
  // stale-harness-on-resume bug — a provider/config change now always flows through
  // instead of a frozen state.json harness winning forever.
  const providerHarness = config.providerHarnesses?.[provider];
  const builtInHarness = getBuiltInDefaultHarness(provider);

  const winner = providerHarness ?? builtInHarness ?? 'claude-code';

  if (!providerHarness) {
    logBuiltInDefaultNotice(provider, winner);
  }

  const authMode = await getProviderAuthModeForModel(input.model);
  const modelDecision = canUseModelWithAuthSync(input.model, authMode);
  if (!modelDecision.allowed) {
    throw new HarnessResolutionError(modelDecision.reason ?? `Model ${input.model} is not allowed with the current auth mode`);
  }

  const decision = canUseHarnessSync(winner, input.model, authMode);
  if (!decision.allowed) {
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

  assertHarnessProviderSupported(winner, provider);

  if (!(await hasHarnessBinary(winner))) {
    const binary = harnessBinaryName(winner);
    // PAN-1871 — never silently fall back to claude-code from a non-native
    // (CLIProxy) model whose own binary is missing at spawn. An explicitly
    // configured ACP harness has the same fail-loud contract: falling back
    // would silently ignore the operator's transport choice.
    if (winner === 'acp' || (builtInHarness && builtInHarness !== 'claude-code')) {
      throw new HarnessResolutionError(
        `Harness ${winner} for ${input.model} has no installed ${binary} binary at spawn — refusing to silently fall back to claude-code. Install ${binary} (check its PATH) and retry.`,
      );
    }
    console.warn(`harness ${winner} requested for ${provider}, but ${binary} is not installed — falling back to native claude-code`);
    return 'claude-code';
  }

  return winner;
}
