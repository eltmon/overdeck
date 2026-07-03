import type { TierOverridesMap } from '../vbrief/io.js';
import type { VBriefDifficulty, VBriefItem } from '../vbrief/types.js';
import type { ValidatedEscalationConfig } from './tier-table.js';
import { TIERED_EXECUTION_DIFFICULTIES } from './tier-table.js';

export type EscalationTrigger =
  | { kind: 'supervisor-blocked'; beadId: string; sha: string; attemptsAtCurrentTier?: number }
  | { kind: 'verification-failed'; beadId: string; detail: string; attemptsAtCurrentTier?: number }
  | { kind: 'floundering'; beadId: string; dispatchedAt: string; now: string; attemptsAtCurrentTier?: number };

export type EscalationAction =
  | { action: 'retry'; attempt: number }
  | { action: 'promote'; from: VBriefDifficulty; to: VBriefDifficulty; reason: string }
  | { action: 'block'; reason: string };

export interface VerificationFailureEscalationInput {
  bead: Pick<VBriefItem, 'id' | 'metadata'>;
  config: ValidatedEscalationConfig;
  overrides: TierOverridesMap;
  detail: string;
  attemptsAtCurrentTier?: number;
}

export interface FlounderingEscalationInput {
  bead: Pick<VBriefItem, 'id' | 'metadata'>;
  config: ValidatedEscalationConfig;
  overrides: TierOverridesMap;
  dispatchedAt: string;
  now: string;
  attemptsAtCurrentTier?: number;
}

export function applyEffectiveDifficulty<T extends Pick<VBriefItem, 'id' | 'metadata'>>(
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
  bead: Pick<VBriefItem, 'id' | 'metadata'>,
  config: ValidatedEscalationConfig,
  overrides: TierOverridesMap,
): EscalationAction {
  const beadId = trigger.beadId || bead.id;
  const override = overrides[bead.id];
  const currentDifficulty = override?.effectiveDifficulty ?? bead.metadata?.difficulty;
  if (!currentDifficulty) {
    return { action: 'block', reason: `bead ${beadId} has no effective difficulty` };
  }

  const promotions = override?.promotions ?? 0;
  if (promotions >= config.max_promotions) {
    return {
      action: 'block',
      reason: `max promotions reached for ${beadId} at ${currentDifficulty}`,
    };
  }

  if (currentDifficulty === 'expert') {
    return {
      action: 'block',
      reason: `expert bead ${beadId} cannot promote beyond expert`,
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
      reason: `bead ${beadId} cannot promote beyond ${currentDifficulty}`,
    };
  }

  return {
    action: 'promote',
    from: currentDifficulty,
    to,
    reason: triggerReason(trigger),
  };
}

export function isFloundering(
  dispatchedAtIso: string,
  nowIso: string,
  budgetMinutes?: number,
): boolean {
  if (budgetMinutes === undefined || budgetMinutes === null) return false;
  if (!Number.isFinite(budgetMinutes) || budgetMinutes <= 0) return false;

  const dispatchedAt = Date.parse(dispatchedAtIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(dispatchedAt) || !Number.isFinite(now)) return false;

  return (now - dispatchedAt) / 60_000 > budgetMinutes;
}

export function decideVerificationFailureEscalation(
  input: VerificationFailureEscalationInput,
): EscalationAction {
  return decideEscalation({
    kind: 'verification-failed',
    beadId: input.bead.id,
    detail: input.detail,
    attemptsAtCurrentTier: input.attemptsAtCurrentTier,
  }, input.bead, input.config, input.overrides);
}

export function decideFlounderingEscalation(
  input: FlounderingEscalationInput,
): EscalationAction | null {
  const effectiveDifficulty = input.overrides[input.bead.id]?.effectiveDifficulty ?? input.bead.metadata?.difficulty;
  const budget = effectiveDifficulty ? input.config.flounder_budget_minutes[effectiveDifficulty] : undefined;
  if (!isFloundering(input.dispatchedAt, input.now, budget)) return null;
  return decideEscalation({
    kind: 'floundering',
    beadId: input.bead.id,
    dispatchedAt: input.dispatchedAt,
    now: input.now,
    attemptsAtCurrentTier: input.attemptsAtCurrentTier,
  }, input.bead, input.config, input.overrides);
}

function triggerReason(trigger: EscalationTrigger): string {
  switch (trigger.kind) {
    case 'supervisor-blocked':
      return `supervisor blocked commit ${trigger.sha}`;
    case 'verification-failed':
      return `verification failed: ${trigger.detail}`;
    case 'floundering':
      return `floundering since ${trigger.dispatchedAt}`;
  }
}
