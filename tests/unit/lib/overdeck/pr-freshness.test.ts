import { afterEach, describe, expect, it } from 'vitest';

import {
  MEMBERSHIP_FALLBACK_HEALTHY_MS,
  MEMBERSHIP_FALLBACK_MS,
  PR_LISTING_ACTIVE_TTL_HEALTHY_MS,
  PR_LISTING_ACTIVE_TTL_MS,
  PR_LISTING_IDLE_TTL_HEALTHY_MS,
  PR_LISTING_IDLE_TTL_MS,
  membershipFallbackMs,
  prListingActiveTtlMs,
  prListingIdleTtlMs,
  setWebhookHealthProvider,
  webhooksHealthy,
} from '../../../../src/lib/overdeck/pr-freshness.js';

describe('pr-freshness', () => {
  afterEach(() => setWebhookHealthProvider(() => false));

  it('with no provider registered, returns the unhealthy TTLs (AC1)', () => {
    expect(prListingActiveTtlMs()).toBe(PR_LISTING_ACTIVE_TTL_MS);
    expect(prListingActiveTtlMs()).toBe(30_000);
    expect(prListingIdleTtlMs()).toBe(PR_LISTING_IDLE_TTL_MS);
    expect(prListingIdleTtlMs()).toBe(300_000);
  });

  it('with a provider returning true, returns the healthy TTLs and membership fallback (AC2)', () => {
    setWebhookHealthProvider(() => true);

    expect(prListingActiveTtlMs()).toBe(PR_LISTING_ACTIVE_TTL_HEALTHY_MS);
    expect(prListingActiveTtlMs()).toBe(300_000);
    expect(prListingIdleTtlMs()).toBe(PR_LISTING_IDLE_TTL_HEALTHY_MS);
    expect(prListingIdleTtlMs()).toBe(900_000);
    expect(membershipFallbackMs(true)).toBe(MEMBERSHIP_FALLBACK_HEALTHY_MS);
    expect(membershipFallbackMs(true)).toBe(1_800_000);
    expect(membershipFallbackMs(false)).toBe(MEMBERSHIP_FALLBACK_MS);
    expect(membershipFallbackMs(false)).toBe(300_000);
  });

  it('a throwing provider reads as not healthy, and the restore function falls back to default false (AC3)', () => {
    const restore = setWebhookHealthProvider(() => {
      throw new Error('boom');
    });

    expect(webhooksHealthy()).toBe(false);

    setWebhookHealthProvider(() => true);
    expect(webhooksHealthy()).toBe(true);

    restore();
    expect(webhooksHealthy()).toBe(false);
  });
});
