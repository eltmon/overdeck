import { describe, expect, it } from 'vitest';

import { BACKGROUND_AI_FEATURE_META } from '../types';
import { BG_FEATURE_COST_SOURCE } from '../settingsPageConstants';

const JEV_FEATURES = ['jevTurnEndAssessment', 'jevAcceptanceCriteriaReview', 'jevMemoryRelevance'] as const;

describe('jev* Settings toggles (PAN-4369)', () => {
  it.each(JEV_FEATURES)('%s discloses the data it sends to TypeSafe', (key) => {
    const meta = BACKGROUND_AI_FEATURE_META.find((row) => row.key === key);
    expect(meta).toBeDefined();
    expect(meta?.label.startsWith('Jev: ')).toBe(true);
    expect(meta?.description.startsWith('Sends ')).toBe(true);
    expect(meta?.description).toContain('TypeSafe');
  });

  it.each(JEV_FEATURES)('%s maps to its background cost source', (key) => {
    expect(BG_FEATURE_COST_SOURCE[key]).toBe(`background:${key}`);
  });
});
