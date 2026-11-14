import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isWebhookRelayRunningInLastSample: vi.fn() }));

vi.mock('../../../../../src/dashboard/server/services/system-health-service.js', () => ({
  isWebhookRelayRunningInLastSample: mocks.isWebhookRelayRunningInLastSample,
}));

import { startPrWebhookFreshness } from '../../../../../src/dashboard/server/services/pr-webhook-freshness.js';
import { setWebhookHealthProvider, webhooksHealthy } from '../../../../../src/lib/overdeck/pr-freshness.js';

describe('startPrWebhookFreshness (PAN-5224)', () => {
  afterEach(() => setWebhookHealthProvider(() => false));

  it('a peer dashboard never registers: webhooksHealthy() stays false even when the relay check would return true (ac1)', () => {
    mocks.isWebhookRelayRunningInLastSample.mockReturnValue(true);

    startPrWebhookFreshness({ isPeerDashboard: true });

    expect(webhooksHealthy()).toBe(false);
  });

  it('the primary dashboard registers the relay check, and the returned stop function restores false (ac2)', () => {
    mocks.isWebhookRelayRunningInLastSample.mockReturnValue(true);

    const stop = startPrWebhookFreshness({ isPeerDashboard: false });

    expect(webhooksHealthy()).toBe(true);

    stop();

    expect(webhooksHealthy()).toBe(false);
  });
});
