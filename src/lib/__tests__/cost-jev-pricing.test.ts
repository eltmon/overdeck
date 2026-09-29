import { describe, expect, it } from 'vitest';

import { calculateCost, getPricing } from '../cost.js';

describe('Jev pricing rows (PAN-4369)', () => {
  it('prices jev-1.13-free at zero through its exact row', () => {
    const pricing = getPricing('custom', 'jev-1.13-free');
    expect(pricing?.model).toBe('jev-1.13-free');
    expect(pricing?.inputPer1k).toBe(0);
    expect(pricing?.outputPer1k).toBe(0);
  });

  it('prices jev-1.13 at $0.042 per million input tokens with free output', () => {
    const pricing = getPricing('custom', 'jev-1.13');
    expect(pricing?.inputPer1k).toBe(0.000042);
    expect(pricing?.outputPer1k).toBe(0);
  });

  it('prefix-resolves the direct API model id jev-1.13.0 to the paid row', () => {
    expect(getPricing('custom', 'jev-1.13.0')?.model).toBe('jev-1.13');
  });

  it('charges 0.042 for one million input tokens', () => {
    const pricing = getPricing('custom', 'jev-1.13');
    expect(pricing).not.toBeNull();
    expect(calculateCost({ inputTokens: 1_000_000, outputTokens: 5_000 }, pricing!)).toBe(0.042);
  });
});
