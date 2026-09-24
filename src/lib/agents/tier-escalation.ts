import type { TierOverridesMap } from '../xbrief/io.js';
import type { XBriefDifficulty, XBriefItem } from '../xbrief/types.js';
import type { ValidatedEscalationConfig } from './tier-table.js';
import { TIERED_EXECUTION_DIFFICULTIES } from './tier-table.js';

export type EscalationTrigger =
  | { kind: 'supervisor-blocked'; itemId: string; sha: string; attemptsAtCurrentTier?: number }
  | { kind: 'verification-failed'; itemId: string; detail: string; attemptsAtCurrentTier?: number };

export type EscalationAction =
  | { action: 'retry'; attempt: number }
  | { action: 'promote'; from: XBriefDifficulty; to: XBriefDifficulty; reason: string }
  | { action: 'block'; reason: string };

export interface VerificationFailureEscalationInput {
  bead: Pick<XBriefItem, 'id' | 'metadata'>;
  config: ValidatedEscalationConfig;
  overrides: TierOverridesMap;
  detail: string;
  attemptsAtCurrentTier?: number;
}

export function applyEffectiveDifficulty<T extends Pick<XBriefItem, 'id' | 'metadata'>>(
  item: T,
  overrides: TierOverridesMap,
): T {
  const override = overrides[item.id];
  if (!override) return item;

  return {
    ...item,
    metadata: {
      ...(item.metadata ?? {}),
      difficulty: override.effectiveDifficulty,
    },
  };
}

/**
 * Pure escalation decision engine. It only emits the next action; callers own
 * retry event persistence, tier promotion writes, dispatch, and notifications.
 */
export function decideEscalation(
  trigger: EscalationTrigger,
  bead: Pick<XBriefItem, 'id' | 'metadata'>,
  config: ValidatedEscalationConfig,
  overrides: TierOverridesMap,
): EscalationAction {
  const itemId = trigger.itemId || bead.id;
  const override = overrides[bead.id];
  const currentDifficulty = override?.effectiveDifficulty ?? bead.metadata?.difficulty;
  if (!currentDifficulty) {
    return { action: 'block', reason: `task ${itemId} has no effective difficulty` };
  }

  const promotions = override?.promotions ?? 0;
  if (promotions >= config.max_promotions) {
    return {
      action: 'block',
      reason: `max promotions reached for ${itemId} at ${currentDifficulty}`,
    };
  }

  if (currentDifficulty === 'expert') {
    return {
      action: 'block',
      reason: `expert task ${itemId} cannot promote beyond expert`,
    };
  }

  const attemptsAtCurrentTier = trigger.attemptsAtCurrentTier ?? 0;
  if (attemptsAtCurrentTier < config.retries_at_tier) {
    return { action: 'retry', attempt: attemptsAtCurrentTier + 1 };
  }

  const fromIndex = TIERED_EXECUTION_DIFFICULTIES.indexOf(currentDifficulty);
  const to = TIERED_EXECUTION_DIFFICULTIES[fromIndex + 1];
  if (!to) {
    return {
      action: 'block',
      reason: `task ${itemId} cannot promote beyond ${currentDifficulty}`,
    };
  }

  return {
    action: 'promote',
    from: currentDifficulty,
    to,
    reason: triggerReason(trigger),
  };
}

function triggerReason(trigger: EscalationTrigger): string {
  switch (trigger.kind) {
    case 'supervisor-blocked':
      return `supervisor blocked commit ${trigger.sha}`;
    case 'verification-failed':
      return `verification failed: ${trigger.detail}`;
  }
}
