/**
 * Per-model harness-policy decision builder (PAN-2528).
 *
 * Builds the `Record<model, Record<harness, decision>>` map served by
 * GET /api/settings/harness-policy. The previous in-route implementation
 * emitted a 'pi' decision key while the pickers queried 'ohmypi', so the
 * ohmypi + Anthropic + subscription ToS block was silently dropped before
 * the picker UI could read it. The picker-visible key is now 'ohmypi', the
 * current RuntimeName for that harness ('pi' is no longer a RuntimeName).
 *
 * The auth-mode resolver is injected so this helper is pure and can be
 * unit-tested without spinning up an Effect HTTP server.
 */

import { getProviderForModelSync } from './providers.js';
import { canUseHarnessSync } from './harness-policy.js';
import type { AuthMode } from './subscription-types.js';

export type HarnessPolicyDecisionMap = Record<
  string,
  Record<string, { allowed: boolean; reason?: string }>
>;

export type HarnessPolicyAuthModeResolver = (model: string) => Promise<AuthMode | undefined>;

/**
 * Resolve a per-model harness-policy decision map for `models`.
 *
 * Caches the auth-mode resolver per provider so multiple models under one
 * provider only pay one resolver call. Order of `models` is preserved via
 * the `Set` dedup pass before iteration.
 */
export async function buildHarnessPolicyDecisions(
  models: readonly string[],
  resolveAuthMode: HarnessPolicyAuthModeResolver,
): Promise<HarnessPolicyDecisionMap> {
  const decisions: HarnessPolicyDecisionMap = {};
  const authModeByProvider = new Map<string, AuthMode | undefined>();
  for (const model of Array.from(new Set(models))) {
    const providerName = getProviderForModelSync(model).name;
    let authMode = authModeByProvider.get(providerName);
    if (!authModeByProvider.has(providerName)) {
      authMode = await resolveAuthMode(model);
      authModeByProvider.set(providerName, authMode);
    }
    decisions[model] = {
      'claude-code': canUseHarnessSync('claude-code', model, authMode),
      ohmypi: canUseHarnessSync('ohmypi', model, authMode),
      codex: canUseHarnessSync('codex', model, authMode),
    };
  }
  return decisions;
}