import { canUseHarnessSync, canUseModelWithAuthSync } from './harness-policy.js';
import {
  configuredHarnessBinaryPath,
  harnessBinaryName,
  resolveHarnessBinary,
} from './harness-binary.js';
import { getBuiltInDefaultHarness, getProviderForModelSync } from './providers.js';
import type { RuntimeName } from './runtimes/types.js';
import type { Role } from './agents.js';
import { loadConfigSync as loadYamlConfig } from './config-yaml.js';

const harnessAvailabilityCache = new Map<string, Promise<boolean>>();
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

  const executablePath = configuredHarnessBinaryPath(harness);
  const cacheKey = `${harness}\0${executablePath ?? ''}`;
  const cached = harnessAvailabilityCache.get(cacheKey);
  if (cached) return cached;

  const check = resolveHarnessBinary(
    harness,
    executablePath ? { executablePath } : undefined,
  ).then((resolved) => resolved !== null);
  harnessAvailabilityCache.set(cacheKey, check);
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
  // Harness is provider-default UNLESS an explicit pick arrives (PAN-1984 plus
  // the 2026-08-02 explicit-pick refinement). Without `input.explicit`, the
  // harness derives solely from the model's provider — the per-provider default
  // (Settings → Providers) else the built-in default — which kills the class of
  // harness↔model mismatch bugs (e.g. Pi+GPT-5.5 selected when Codex is
  // GPT-5.5's real provider default) and the stale-harness-on-resume bug.
  // `input.role` is accepted for signature compatibility but INTENTIONALLY
  // IGNORED.
  //
  // `input.explicit` IS honored: surfaces that let the operator choose the
  // harness directly (the model picker's harness-labeled rows — "Kimi K3 (1M)
  // — Kimi Code CLI" vs "… — Claude Code" vs "… — ACP") pass it through, and
  // silently discarding it would launch a harness the operator did not pick.
  // The pick is still policy-gated (canUseHarnessSync) and fail-loud: a denied
  // combo or a missing binary throws instead of rerouting to the provider
  // default.
  const providerHarness = config.providerHarnesses?.[provider];
  const builtInHarness = getBuiltInDefaultHarness(provider);
  const explicit = input.explicit;

  const winner = explicit ?? providerHarness ?? builtInHarness ?? 'claude-code';

  if (!providerHarness && !explicit) {
    logBuiltInDefaultNotice(provider, winner);
  }

  const authMode = await getProviderAuthModeForModel(input.model);
  const modelDecision = canUseModelWithAuthSync(input.model, authMode);
  if (!modelDecision.allowed) {
    throw new HarnessResolutionError(modelDecision.reason ?? `Model ${input.model} is not allowed with the current auth mode`);
  }

  const decision = canUseHarnessSync(winner, input.model, authMode);
  if (!decision.allowed) {
    if (explicit) {
      throw new HarnessResolutionError(
        `Harness ${explicit} denied for ${input.model} (${decision.reason ?? 'policy denied'}) — refusing to silently reroute an explicit harness pick to the provider default.`,
      );
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

  assertHarnessProviderSupported(winner, provider);

  if (!(await hasHarnessBinary(winner))) {
    const binary = configuredHarnessBinaryPath(winner) ?? harnessBinaryName(winner);
    // PAN-1871 — never silently fall back to claude-code from a non-native
    // (CLIProxy) model whose own binary is missing at spawn. An explicitly
    // configured ACP harness — or any explicit operator pick — has the same
    // fail-loud contract: falling back would silently ignore the operator's
    // transport choice.
    if (explicit || winner === 'acp' || (builtInHarness && builtInHarness !== 'claude-code')) {
      const remediation = configuredHarnessBinaryPath(winner)
        ? `Fix the configured executable path ${binary} and retry.`
        : `Install ${binary} (check its PATH) and retry.`;
      throw new HarnessResolutionError(
        `Harness ${winner} for ${input.model} has no installed ${binary} binary at spawn — refusing to silently fall back to claude-code. ${remediation}`,
      );
    }
    console.warn(`harness ${winner} requested for ${provider}, but ${binary} is not installed — falling back to native claude-code`);
    return 'claude-code';
  }

  return winner;
}
