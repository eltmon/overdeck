import { describe, expect, it } from 'vitest';
import { SLOT_MARGIN, computeLayout, fitText, shelfSlotWidth, staleSlotWidth } from '../model';

const measure = (value: string) => value.length * 6;

describe('fitText', () => {
  it('returns short text unchanged', () => {
    expect(fitText('PAN-1234', 200, measure)).toBe('PAN-1234');
  });

  it('truncates a long reason so the result fits and ends in an ellipsis', () => {
    const reason = 'x'.repeat(58);
    const maxWidth = 120;
    const result = fitText(reason, maxWidth, measure);
    expect(result.endsWith('…')).toBe(true);
    expect(measure(result)).toBeLessThanOrEqual(maxWidth);
    expect(result.length).toBeLessThan(reason.length);
  });

  it('returns an empty string when even the ellipsis does not fit', () => {
    expect(fitText('anything', 1, measure)).toBe('');
  });
});

describe('shelfSlotWidth / staleSlotWidth', () => {
  const layout = computeLayout(1280, 800);
  const width = layout.colW * 5 + layout.padX * 2;
  const longReason = 'yield: freeing a slot for an urgent higher-priority issue that needs the lane now';
  const longStaleLabel = '❄ PAN-4507 · zombie-session 3h';

  it('sizes the shelf slot to the neighbour spacing minus SLOT_MARGIN and keeps fitted text inside it', () => {
    for (let count = 1; count <= 8; count++) {
      const spacing = count <= 1 ? width * 0.7 : (width * 0.7) / (count - 1);
      const slot = shelfSlotWidth(layout, count);
      expect(slot).toBeCloseTo(spacing - SLOT_MARGIN);
      expect(slot).toBeGreaterThan(0);
      expect(measure(fitText(longReason, slot, measure))).toBeLessThanOrEqual(slot);
    }
  });

  it('sizes the stale slot to the same-row neighbour spacing minus SLOT_MARGIN and keeps fitted text inside it', () => {
    for (let count = 1; count <= 14; count++) {
      const spacing = (2 * (width * 0.72 - layout.padX)) / Math.max(1, count);
      const slot = staleSlotWidth(layout, count);
      expect(slot).toBeCloseTo(spacing - SLOT_MARGIN);
      expect(slot).toBeGreaterThan(0);
      expect(measure(fitText(longStaleLabel, slot, measure))).toBeLessThanOrEqual(slot);
    }
  });
});
