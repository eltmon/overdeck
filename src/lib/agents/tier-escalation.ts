import type { TierOverridesMap } from '../xbrief/io.js';
import type { XBriefDifficulty, XBriefItem } from '../xbrief/types.js';
import type { ValidatedEscalationConfig } from './tier-table.js';

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
