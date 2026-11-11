import { describe, expect, it } from 'vitest';
import { getModelCapability, getModelEffortLevels } from '../model-capabilities.js';
import { capabilityClassOf } from '../model-capability-class.js';
import { getPricing } from '../cost.js';
import type { ModelId } from '../settings.js';
import type { EffortLevel } from '../model-capability-types.js';
import type { ModelCapabilityClass } from '../model-capability-class.js';

const LOW_MAX: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const LOW_XHIGH: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh'];

const MUSE_CATALOG: Array<{
  id: ModelId;
  inputPer1k: number;
  cacheReadPer1k: number;
  outputPer1k: number;
  effortLevels: readonly EffortLevel[];
  blended: number;
  class: ModelCapabilityClass;
}> = [
  { id: 'muse-wonder-1.0', inputPer1k: 0.004, cacheReadPer1k: 0.0002, outputPer1k: 0.02, effortLevels: LOW_MAX, blended: 12, class: 'frontier' },
  { id: 'muse-spark-1.3', inputPer1k: 0.00125, cacheReadPer1k: 0.00015, outputPer1k: 0.00425, effortLevels: LOW_MAX, blended: 2.75, class: 'workhorse' },
  { id: 'muse-spark-1.3-contributor', inputPer1k: 0.0001, cacheReadPer1k: 0.000002, outputPer1k: 0.0002, effortLevels: LOW_XHIGH, blended: 0.15, class: 'workhorse' },
  { id: 'muse-ember-1.0', inputPer1k: 0.0001, cacheReadPer1k: 0.000004, outputPer1k: 0.0005, effortLevels: LOW_MAX, blended: 0.3, class: 'small' },
];

describe('Muse catalog matches Meta (PAN-5106)', () => {
  it.each(MUSE_CATALOG)('pins exact pricing, effort levels, blended cost and class for $id', ({ id, inputPer1k, cacheReadPer1k, outputPer1k, effortLevels, blended, class: expectedClass }) => {
    const pricing = getPricing('custom', id);
    expect(pricing?.inputPer1k).toBe(inputPer1k);
    expect(pricing?.cacheReadPer1k).toBe(cacheReadPer1k);
    expect(pricing?.outputPer1k).toBe(outputPer1k);
    expect(getModelEffortLevels(id)).toEqual(effortLevels);
    const capability = getModelCapability(id);
    expect(capability.contextWindow).toBe(1048576);
    expect(capability.costPer1MTokens).toBe(blended);
    expect(capabilityClassOf(id)).toBe(expectedClass);
  });

  it('Muse Ember allows up to 524288 max output tokens', () => {
    expect(getModelCapability('muse-ember-1.0').maxOutputTokens).toBe(524288);
  });
});
