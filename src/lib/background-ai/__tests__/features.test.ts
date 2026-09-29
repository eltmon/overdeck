import { describe, expect, it } from 'vitest';

import {
  BACKGROUND_AI_FEATURE_META,
  BACKGROUND_AI_FEATURES,
  defaultBackgroundAiFeatures,
  isBackgroundFeatureEnabled,
} from '../features.js';
import type { NormalizedConfig } from '../../config-yaml.js';

function configWith(
  cheapMode: boolean,
  overrides: Partial<Record<(typeof BACKGROUND_AI_FEATURES)[number], boolean>> = {},
): Pick<NormalizedConfig, 'backgroundAi'> {
  return {
    backgroundAi: {
      cheapMode,
      features: { ...defaultBackgroundAiFeatures(), ...overrides },
    },
  };
}

describe('defaultBackgroundAiFeatures', () => {
  it('returns an entry for every registered feature', () => {
    const defaults = defaultBackgroundAiFeatures();
    expect(Object.keys(defaults).sort()).toEqual([...BACKGROUND_AI_FEATURES].sort());
  });

  it('defaults sessionEmbeddings and ttsSummarizer off, others on', () => {
    const defaults = defaultBackgroundAiFeatures();
    expect(defaults.sessionEmbeddings).toBe(false);
    expect(defaults.ttsSummarizer).toBe(false);
    expect(defaults.conversationTitles).toBe(true);
    expect(defaults.memoryExtraction).toBe(true);
  });
});

describe('jev* features (PAN-4369)', () => {
  const JEV_FEATURES = ['jevTurnEndAssessment', 'jevAcceptanceCriteriaReview', 'jevMemoryRelevance'] as const;

  it('defaults all three jev features off', () => {
    const defaults = defaultBackgroundAiFeatures();
    for (const key of JEV_FEATURES) expect(defaults[key]).toBe(false);
  });

  it('enables a jev feature only when its toggle is on and cheap mode is off', () => {
    expect(isBackgroundFeatureEnabled('jevTurnEndAssessment', configWith(false))).toBe(false);
    expect(
      isBackgroundFeatureEnabled('jevTurnEndAssessment', configWith(false, { jevTurnEndAssessment: true })),
    ).toBe(true);
    expect(
      isBackgroundFeatureEnabled('jevTurnEndAssessment', configWith(true, { jevTurnEndAssessment: true })),
    ).toBe(false);
  });

  it('describes the data each jev feature sends to TypeSafe', () => {
    for (const key of JEV_FEATURES) {
      const meta = BACKGROUND_AI_FEATURE_META.find((m) => m.key === key);
      expect(meta?.description.startsWith('Sends ')).toBe(true);
      expect(meta?.description).toContain('TypeSafe');
    }
  });
});

describe('isBackgroundFeatureEnabled', () => {
  it('returns the per-feature flag when cheap mode is off', () => {
    expect(isBackgroundFeatureEnabled('conversationTitles', configWith(false))).toBe(true);
    expect(isBackgroundFeatureEnabled('ttsSummarizer', configWith(false))).toBe(false);
  });

  it('honors an explicit per-feature toggle', () => {
    expect(
      isBackgroundFeatureEnabled('conversationTitles', configWith(false, { conversationTitles: false })),
    ).toBe(false);
    expect(
      isBackgroundFeatureEnabled('ttsSummarizer', configWith(false, { ttsSummarizer: true })),
    ).toBe(true);
  });

  it('disables every feature when cheap mode is on, regardless of toggles', () => {
    const cfg = configWith(true, { conversationTitles: true, memoryExtraction: true, ttsSummarizer: true });
    for (const feature of BACKGROUND_AI_FEATURES) {
      expect(isBackgroundFeatureEnabled(feature, cfg)).toBe(false);
    }
  });
});
