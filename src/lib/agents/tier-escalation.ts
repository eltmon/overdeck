/**
 * Pure escalation decision engine (PAN-1791, restored by PAN-4512 after the
 * Cut deleted it as dead code — PAN-4014 CH-8b — once its triggers were
 * removed; this item reconnects it with an effort-first step ahead of a tier
 * promotion). `decideEscalation` and `applyEscalationAction` only compute the
 * next action and the resulting override; callers own retry event
 * persistence, dispatch, and notifications.
 */
import type { EffortLevel } from '@overdeck/contracts';
import type { TierEffortRaiseHistoryEntry, TierOverride, TierOverridesMap, TierPromotionHistoryEntry } from '../xbrief/io.js';
import type { XBriefDifficulty, XBriefItem } from '../xbrief/types.js';
import type { RuntimeName } from '../runtimes/types.js';
import type { ValidatedEscalationConfig } from './tier-table.js';
import { TIERED_EXECUTION_DIFFICULTIES } from './tier-table-types.js';
import { supportedEffortLevels } from './effort-support.js';

export type EscalationTrigger =
  | { kind: 'supervisor-blocked'; itemId: string; sha: string; attemptsAtCurrentTier?: number }
  | { kind: 'verification-failed'; itemId: string; detail: string; attemptsAtCurrentTier?: number };

export type EscalationAction =
  | { action: 'retry'; attempt: number }
  | { action: 'raise-effort'; difficulty: XBriefDifficulty; from: EffortLevel; to: EffortLevel; reason: string }
  | { action: 'promote'; from: XBriefDifficulty; to: XBriefDifficulty; reason: string }
  | { action: 'block'; reason: string };

/** The effort an item is currently staffed at, and the model/harness that
 * bounds which levels it can raise to (PAN-4257 D9 step 5). */
export interface EscalationEffortContext {
  currentEffort: EffortLevel;
  model?: string;
  harness?: RuntimeName;
}

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
      ...(override.effectiveEffort !== undefined ? { effort: override.effectiveEffort } : {}),
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
  effortContext?: EscalationEffortContext,
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

  // PAN-4257 D9 step 5: when effort_first is on and this item has not already
  // raised its effort, spend this escalation raising effort one supported
  // level instead of promoting to the next tier's model. A second escalation
  // (override.effectiveEffort already set) falls through to the promotion
  // below, exactly as it would have before effort_first existed.
  if (config.effort_first && override?.effectiveEffort === undefined && effortContext) {
    const supported = supportedEffortLevels(effortContext.model, effortContext.harness);
    const fromIndex = supported.indexOf(effortContext.currentEffort);
    const to = fromIndex >= 0 ? supported[fromIndex + 1] : undefined;
    if (to) {
      return {
        action: 'raise-effort',
        difficulty: currentDifficulty,
        from: effortContext.currentEffort,
        to,
        reason: triggerReason(trigger),
      };
    }
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

/**
 * Pure reducer from a decided action to the next TierOverridesMap. Never
 * mutates `overrides` — always returns a new map (or the same reference for
 * 'retry'/'block', which carry no override state to write).
 */
export function applyEscalationAction(
  overrides: TierOverridesMap,
  itemId: string,
  action: EscalationAction,
  now: string = new Date().toISOString(),
): TierOverridesMap {
  if (action.action === 'retry' || action.action === 'block') return overrides;

  const existing = overrides[itemId];

  if (action.action === 'raise-effort') {
    const historyEntry: TierEffortRaiseHistoryEntry = {
      at: now,
      kind: 'effort',
      from: action.from,
      to: action.to,
      reason: action.reason,
    };
    const next: TierOverride = {
      effectiveDifficulty: action.difficulty,
      promotions: existing?.promotions ?? 0,
      effectiveEffort: action.to,
      history: [...(existing?.history ?? []), historyEntry],
    };
    return { ...overrides, [itemId]: next };
  }

  const historyEntry: TierPromotionHistoryEntry = {
    at: now,
    from: action.from,
    to: action.to,
    reason: action.reason,
  };
  const next: TierOverride = {
    effectiveDifficulty: action.to,
    promotions: (existing?.promotions ?? 0) + 1,
    // A promotion moves the item onto the new tier's own effort — any prior
    // effort-first raise no longer applies, so effectiveEffort is dropped.
    history: [...(existing?.history ?? []), historyEntry],
  };
  return { ...overrides, [itemId]: next };
}
