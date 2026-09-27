/** PAN-4264 Work Item 20: quota bucket boundaries and the github_caller domain. */
import { describe, expect, it } from 'vitest';
import {
  GITHUB_QUOTA_CALLERS,
  TELEMETRY_PROPERTY_DOMAINS,
  bucketQuotaPoints,
  bucketQuotaRemaining,
} from '@overdeck/contracts';

describe('GitHub quota telemetry buckets (PAN-4264)', () => {
  it('buckets points at every boundary', () => {
    expect([0, -3, 1, 49, 50, 199, 200, 499, 500, 999, 1000, 2499, 2500, 90_000].map(bucketQuotaPoints)).toEqual([
      '0', '0', '1-49', '1-49', '50-199', '50-199', '200-499', '200-499', '500-999', '500-999', '1000-2499', '1000-2499', '2500+', '2500+',
    ]);
  });

  it('buckets remaining at every boundary, unknown without a sample', () => {
    expect([undefined, Number.NaN, 0, 1, 99, 100, 499, 500, 999, 1000, 2499, 2500, 5000].map(bucketQuotaRemaining)).toEqual([
      'unknown', 'unknown', '0', '1-99', '1-99', '100-499', '100-499', '500-999', '500-999', '1000-2499', '1000-2499', '2500+', '2500+',
    ]);
  });

  it('keeps github_caller in step with GITHUB_QUOTA_CALLERS', () => {
    expect([...TELEMETRY_PROPERTY_DOMAINS.github_caller]).toEqual(GITHUB_QUOTA_CALLERS.map((caller) => caller.replace(/-/g, '_')));
  });
});
