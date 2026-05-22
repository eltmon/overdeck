/**
 * Harness policy gate (PAN-636 + PAN-1067).
 *
 * Single source of truth for "is this {harness, model, authMode} combination
 * allowed?". Every spawn entry point and every harness/model picker UI MUST
 * call canUseHarness() before showing or accepting an option, so a stale
 * setting cannot bypass the rule.
 *
 * Rules:
 *   1. gpt-5.5 requires ChatGPT subscription auth — OpenAI does not expose it
 *      via the standard API-key endpoint. (PAN-1067)
 *   2. Pi running an Anthropic model under Anthropic *subscription* auth is
 *      blocked (Claude Code subscription terms forbid using the Anthropic
 *      subscription with non-Anthropic harnesses).
 *
 * Allowed cells:
 *   - claude-code + any provider + any authMode -> allowed (modulo rule 1)
 *   - pi + non-Anthropic provider + any authMode -> allowed (modulo rule 1)
 *   - pi + Anthropic provider + api-key -> allowed
 *   - pi + Anthropic provider + subscription -> BLOCKED
 *   - pi + Anthropic provider + undefined authMode -> allowed (no
 *     subscription is in play, so the ToS bar is not engaged)
 */

import { Effect } from 'effect'
import type { RuntimeName } from './runtimes/types.js'
import type { AuthMode } from './subscription-types.js'
import { getProviderForModelSync } from './providers.js'

export type HarnessPolicyDecision = {
  allowed: boolean
  reason?: string
}

const ALLOWED: HarnessPolicyDecision = { allowed: true }

const PI_ANTHROPIC_SUBSCRIPTION_BLOCK: HarnessPolicyDecision = {
  allowed: false,
  reason:
    'Pi cannot run Anthropic models when authenticated via Claude Code subscription. ' +
    'Switch the Anthropic provider to API-key auth, or pick a non-Anthropic model for Pi.',
}

const GPT_5_5_API_KEY_BLOCK: HarnessPolicyDecision = {
  allowed: false,
  reason:
    'GPT-5.5 requires ChatGPT subscription auth (Codex sign-in). ' +
    'It is not available via the standard OpenAI API-key endpoint. Sign in via Codex, or pick a different model.',
}

/** Models that are gated to ChatGPT subscription auth only (no API-key path). */
const SUBSCRIPTION_ONLY_OPENAI_MODELS = new Set(['gpt-5.5'])

/**
 * Check whether a (model, authMode) pair is allowed, independent of harness.
 * Use this in pickers to lock model options that the current auth setup can't reach.
 */
export function canUseModelWithAuthSync(
  model: string,
  authMode: AuthMode | undefined,
): HarnessPolicyDecision {
  const provider = getProviderForModelSync(model)
  if (provider.name === 'openai' && SUBSCRIPTION_ONLY_OPENAI_MODELS.has(model) && authMode === 'api-key') {
    return GPT_5_5_API_KEY_BLOCK
  }
  return ALLOWED
}

export function canUseHarnessSync(
  harness: RuntimeName,
  model: string,
  authMode: AuthMode | undefined,
): HarnessPolicyDecision {
  // Model-level auth restrictions apply to every harness.
  const modelAuth = canUseModelWithAuthSync(model, authMode)
  if (!modelAuth.allowed) return modelAuth

  if (harness === 'claude-code') {
    return ALLOWED
  }

  // harness === 'pi'
  const provider = getProviderForModelSync(model)
  if (provider.name !== 'anthropic') {
    return ALLOWED
  }

  if (authMode === 'subscription') {
    return PI_ANTHROPIC_SUBSCRIPTION_BLOCK
  }

  return ALLOWED
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// Pure-sync policy checks — additive Effect.sync wrappers for callers in Effect graphs.

/** Check whether a (model, authMode) pair is allowed. Pure. */
export const canUseModelWithAuth = (
  model: string,
  authMode: AuthMode | undefined,
): Effect.Effect<HarnessPolicyDecision> =>
  Effect.sync(() => canUseModelWithAuthSync(model, authMode))

/** Check whether a (harness, model, authMode) triple is allowed. Pure. */
export const canUseHarness = (
  harness: RuntimeName,
  model: string,
  authMode: AuthMode | undefined,
): Effect.Effect<HarnessPolicyDecision> =>
  Effect.sync(() => canUseHarnessSync(harness, model, authMode))
