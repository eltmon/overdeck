/**
 * Harness policy gate (PAN-636).
 *
 * Single source of truth for "is this {harness, model, authMode} combination
 * allowed?". Every spawn entry point and every harness/model picker UI MUST
 * call canUseHarness() before showing or accepting an option, so a stale
 * setting cannot bypass the rule.
 *
 * Rule: Pi running an Anthropic model under Anthropic *subscription* auth is
 * blocked (Claude Code subscription terms forbid using the Anthropic
 * subscription with non-Anthropic harnesses). All other cells are allowed:
 *   - claude-code + any provider + any authMode -> allowed
 *   - pi + non-Anthropic provider + any authMode -> allowed
 *   - pi + Anthropic provider + api-key -> allowed
 *   - pi + Anthropic provider + subscription -> BLOCKED
 *   - pi + Anthropic provider + undefined authMode -> allowed (no
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

const PI_ANTHROPIC_SUBSCRIPTION_BLOCK: HarnessPolicyDecision = {
  allowed: false,
  reason:
    'Pi cannot run Anthropic models when authenticated via Claude Code subscription. ' +
    'Switch the Anthropic provider to API-key auth, or pick a non-Anthropic model for Pi.',
}

export function canUseHarness(
  harness: RuntimeName,
  model: string,
  authMode: AuthMode | undefined,
): HarnessPolicyDecision {
  if (harness === 'claude-code') {
    return ALLOWED
  }

  // harness === 'pi'
  const provider = getProviderForModel(model)
  if (provider.name !== 'anthropic') {
    return ALLOWED
  }

  if (authMode === 'subscription') {
    return PI_ANTHROPIC_SUBSCRIPTION_BLOCK
  }

  return ALLOWED
}
