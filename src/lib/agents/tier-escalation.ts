import type { TierOverridesMap } from '../vbrief/io.js';
import type { VBriefItem } from '../vbrief/types.js';

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
