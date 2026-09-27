import { describe, it, expect } from 'vitest';
import {
  computeGovernorReserveDefaultsGb,
  computeSpawnMemoryThresholdDefaultsGb,
} from '../../../../src/lib/config-yaml/governor-reserves.js';

describe('computeGovernorReserveDefaultsGb', () => {
  const table: Array<{ totalGb: number; hard: number; soft: number; watch: number; recovery: number }> = [
    { totalGb: 8, hard: 0.8, soft: 1.6, watch: 2.0, recovery: 2.8 },
    { totalGb: 16, hard: 1.6, soft: 3.2, watch: 4.0, recovery: 5.6 },
    { totalGb: 32, hard: 3.2, soft: 6.4, watch: 8.0, recovery: 11.2 },
    { totalGb: 64, hard: 5.12, soft: 9.6, watch: 12.8, recovery: 16.0 },
  ];

  for (const row of table) {
    it(`returns the exact PRD table values for ${row.totalGb} GB`, () => {
      const result = computeGovernorReserveDefaultsGb(row.totalGb);
      expect(result.hard).toBeCloseTo(row.hard, 5);
      expect(result.soft).toBeCloseTo(row.soft, 5);
      expect(result.watch).toBeCloseTo(row.watch, 5);
      expect(result.recovery).toBeCloseTo(row.recovery, 5);
    });

    it(`respects the caps and ordering for ${row.totalGb} GB`, () => {
      const result = computeGovernorReserveDefaultsGb(row.totalGb);
      expect(result.hard).toBeLessThanOrEqual(0.10 * row.totalGb + 1e-9);
      expect(result.soft).toBeLessThanOrEqual(0.20 * row.totalGb + 1e-9);
      expect(result.watch).toBeLessThanOrEqual(0.25 * row.totalGb + 1e-9);
      expect(result.recovery).toBeLessThanOrEqual(0.35 * row.totalGb + 1e-9);

      expect(result.hard).toBeLessThan(result.soft);
      expect(result.soft).toBeLessThan(result.watch);
      expect(result.soft).toBeLessThan(result.recovery);
      expect(result.recovery).toBeLessThan(row.totalGb);
    });
  }
});

describe('computeSpawnMemoryThresholdDefaultsGb', () => {
  const table: Array<{ totalGb: number; warnGb: number; blockGb: number }> = [
    { totalGb: 8, warnGb: 1.0, blockGb: 0.5 },
    { totalGb: 16, warnGb: 2.0, blockGb: 1.0 },
    { totalGb: 32, warnGb: 4.0, blockGb: 2.0 },
    { totalGb: 64, warnGb: 4.0, blockGb: 2.0 },
  ];

  for (const row of table) {
    it(`returns warnGb ${row.warnGb} and blockGb ${row.blockGb} for ${row.totalGb} GB`, () => {
      const result = computeSpawnMemoryThresholdDefaultsGb(row.totalGb);
      expect(result.warnGb).toBeCloseTo(row.warnGb, 5);
      expect(result.blockGb).toBeCloseTo(row.blockGb, 5);
      expect(result.blockGb).toBeLessThan(result.warnGb);
    });
  }
});
