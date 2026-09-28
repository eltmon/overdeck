/**
 * Harness policy gate (PAN-636 + PAN-1067 + PAN-1989).
 *
 * Single source of truth for "is this {harness, model, authMode} combination
 * allowed?". Every spawn entry point and every harness/model picker UI MUST
 * call canUseHarnessSync() before showing or accepting an option, so a stale
 * setting cannot bypass the rule.
 *
 * Rules:
 *   1. gpt-5.5 and the gpt-5.6 family require ChatGPT subscription auth — OpenAI
 *      does not expose them via the standard API-key endpoint. (PAN-1067)
 *   2. ohmypi running an Anthropic model under Anthropic *subscription* auth is
 *      blocked (Claude Code subscription terms forbid using the Anthropic
 *      subscription with non-Anthropic harnesses). (Formerly applied to 'pi'.)
 *   3. prime-agent running an Anthropic model under Anthropic *subscription*
 *      auth is blocked for the same Terms-of-Service reason as rule 2
 *      (PAN-3668). Every other prime-agent cell follows the model-level rules.
 *   4. A harness with no explicit rule below is denied, never allowed by
 *      default, so a new RuntimeName cannot bypass rules 2 and 3 silently.
 *
 * Allowed cells:
 *   - claude-code + any provider + any authMode -> allowed (modulo rule 1)
 *   - ohmypi + non-Anthropic provider + any authMode -> allowed (modulo rule 1)
 *   - ohmypi + Anthropic provider + api-key -> allowed
 *   - ohmypi + Anthropic provider + subscription -> BLOCKED
 *   - ohmypi + Anthropic provider + undefined authMode -> allowed (no
 *     subscription is in play, so the ToS bar is not engaged)
 */

import type { RuntimeName } from './runtimes/types.js'
import type { AuthMode } from './subscription-types.js'
import { getProviderForModel } from './providers.js'

export type HarnessPolicyDecision = {
  allowed: boolean
  reason?: string
}

const ALLOWED: HarnessPolicyDecision = { allowed: true }

/**
 * Every RuntimeName the policy covers. The `satisfies` clause makes a new
 * RuntimeName without an entry here a type error; tests iterate this list to
 * check that each harness has a real decision.
 */
export const POLICY_RUNTIME_NAMES = Object.keys({
  'claude-code': true,
  ohmypi: true,
  codex: true,
  acp: true,
  'kimi-code': true,
  opencode: true,
  muse: true,
  'prime-agent': true,
} satisfies Record<RuntimeName, true>) as RuntimeName[]

const OHMYPI_ANTHROPIC_SUBSCRIPTION_BLOCK: HarnessPolicyDecision = {
  allowed: false,
  reason:
    'Claude Code subscription Terms of Service restrict Anthropic models to the Claude Code harness — ohmypi cannot run Anthropic models under subscription auth. ' +
    'To proceed, switch the Anthropic provider to API-key auth, or pick a non-Anthropic model for ohmypi.',
}

/** Canonical reason returned for the blocked cell (exposed for tests + UI). */
export const OHMYPI_ANTHROPIC_SUBSCRIPTION_BLOCK_REASON = OHMYPI_ANTHROPIC_SUBSCRIPTION_BLOCK.reason!

const PRIME_AGENT_ANTHROPIC_SUBSCRIPTION_BLOCK: HarnessPolicyDecision = {
  allowed: false,
  reason:
    'Claude Code subscription Terms of Service restrict Anthropic models to the Claude Code harness — Prime Agent cannot run Anthropic models under subscription auth. ' +
    'To proceed, switch the Anthropic provider to API-key auth, or pick a non-Anthropic model for Prime Agent.',
}

/** Canonical reason returned for the blocked prime-agent cell (exposed for tests + UI). */
export const PRIME_AGENT_ANTHROPIC_SUBSCRIPTION_BLOCK_REASON = PRIME_AGENT_ANTHROPIC_SUBSCRIPTION_BLOCK.reason!

const ACP_KIMI_ONLY_BLOCK: HarnessPolicyDecision = {
  allowed: false,
  reason: 'ACP currently supports the Kimi provider only. Pick a Kimi model or use the provider\'s supported harness.',
}

const KIMI_CODE_KIMI_ONLY_BLOCK: HarnessPolicyDecision = {
  allowed: false,
  reason: 'The Kimi Code harness runs Kimi (Moonshot) models only. Pick a Kimi model, or use the model\'s supported harness.',
}

const KIMI_NATIVE_ID_FOREIGN_HARNESS_BLOCK: HarnessPolicyDecision = {
  allowed: false,
  reason:
    'kimi-code/* model ids exist only in the native Kimi Code CLI catalog — no other harness can serve them. ' +
    'Pick a "— Kimi Code CLI" or "— ACP (Kimi Code)" row for this model, or switch to a bare Kimi id (e.g. k3), which every Kimi route accepts.',
}

const SUBSCRIPTION_ONLY_MODEL_BLOCK: HarnessPolicyDecision = {
  allowed: false,
  reason:
    'This OpenAI model needs a ChatGPT/Codex subscription sign-in — it is not served by the plain OpenAI API key. ' +
    'Run `codex login` on the host (workspace containers inherit the host sign-in), or pick a different model.',
}

/** Models that are gated to ChatGPT subscription auth only (no API-key path). */
const SUBSCRIPTION_ONLY_OPENAI_MODELS = new Set(['gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6-sol[372k]', 'gpt-5.6-terra[372k]', 'gpt-5.6-luna[372k]'])

/**
 * Check whether a (model, authMode) pair is allowed, independent of harness.
 * Use this in pickers to lock model options that the current auth setup can't reach.
 */
export function canUseModelWithAuth(
  model: string,
  authMode: AuthMode | undefined,
): HarnessPolicyDecision {
  const provider = getProviderForModel(model)
  if (provider.name === 'openai' && SUBSCRIPTION_ONLY_OPENAI_MODELS.has(model) && authMode === 'api-key') {
    return SUBSCRIPTION_ONLY_MODEL_BLOCK
  }
  return ALLOWED
}

export function canUseHarness(
  harness: RuntimeName,
  model: string,
  authMode: AuthMode | undefined,
): HarnessPolicyDecision {
  const providerName = getProviderForModel(model).name;
  const isOpenCodeProvider = providerName === 'opencode' || providerName === 'opencode-go';
  if (harness === 'opencode' || isOpenCodeProvider) {
    return harness === 'opencode' && isOpenCodeProvider
      ? ALLOWED
      : { allowed: false, reason: 'OpenCode Go and Zen model IDs require the OpenCode harness. Select an opencode/* or opencode-go/* model.' };
  }
  const isMuseModel = providerName === 'meta';
  if (harness === 'muse' || isMuseModel) {
    return harness === 'muse' && isMuseModel ? ALLOWED : {
      allowed: false,
      reason: 'Muse Code supports Meta Muse models. Select a Muse Spark model with the Muse Code harness.',
    };
  }
  // Model-level auth restrictions apply to every harness.
  const modelAuth = canUseModelWithAuth(model, authMode)
  if (!modelAuth.allowed) return modelAuth

  // kimi-code/* ids live only in the native kimi CLI's catalog (served by the
  // kimi-code and acp harnesses, both of which spawn the kimi binary). Bare
  // Kimi ids translate INTO that catalog, never back — so any other harness
  // handed a kimi-code/* id would pass the literal string to a provider
  // endpoint that does not know it. Fail loud instead (2026-08-02 id-space
  // correctness, companion to the picker's harness-labeled rows).
  if (model.startsWith('kimi-code/') && harness !== 'kimi-code' && harness !== 'acp') {
    return KIMI_NATIVE_ID_FOREIGN_HARNESS_BLOCK
  }

  if (harness === 'claude-code') {
    return ALLOWED
  }

  if (harness === 'codex') {
    return ALLOWED
  }

  if (harness === 'acp') {
    return getProviderForModel(model).name === 'kimi' ? ALLOWED : ACP_KIMI_ONLY_BLOCK
  }

  if (harness === 'kimi-code') {
    return getProviderForModel(model).name === 'kimi' ? ALLOWED : KIMI_CODE_KIMI_ONLY_BLOCK
  }

  if (harness === 'ohmypi') {
    const provider = getProviderForModel(model)
    if (provider.name === 'anthropic' && authMode === 'subscription') {
      return OHMYPI_ANTHROPIC_SUBSCRIPTION_BLOCK
    }
    return ALLOWED
  }

  // Legacy 'pi' is normally rewritten to 'ohmypi' at settings load; a raw value
  // that slips through gets the ohmypi rules, never a free pass.
  if ((harness as string) === 'pi') {
    return canUseHarness('ohmypi', model, authMode)
  }

  if (harness === 'prime-agent') {
    if (getProviderForModel(model).name === 'anthropic' && authMode === 'subscription') {
      return PRIME_AGENT_ANTHROPIC_SUBSCRIPTION_BLOCK
    }
    return ALLOWED
  }

  // Every RuntimeName is handled above. A harness that reaches this point has
  // no policy decision, so it is denied until one is added here.
  const unlisted: never = harness
  return {
    allowed: false,
    reason: `Harness "${String(unlisted)}" has no harness-policy decision. Add an explicit rule in src/lib/harness-policy.ts before it can run.`,
  }
}
