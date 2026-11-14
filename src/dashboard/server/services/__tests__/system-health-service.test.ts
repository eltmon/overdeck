import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const getSnapshot = vi.fn();
  const createSystemHealthSampler = vi.fn(() => ({ getSnapshot, stop: vi.fn() }));
  return { getSnapshot, createSystemHealthSampler };
});

vi.mock('../../../../lib/system-health/sampler.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/system-health/sampler.js')>();
  return { ...actual, createSystemHealthSampler: mocks.createSystemHealthSampler };
});

import { getDeployStaleness, isWebhookRelayRunningInLastSample } from '../system-health-service.js';

describe('deploy staleness health surface', () => {
  it('reports no staleness now that the deploy patrol is gone (PAN-3917 D1)', async () => {
    await expect(getDeployStaleness()).resolves.toBeNull();
  });
});

function assessment(freshness: { status: string; observedAt: string }, serviceStatus: string) {
  return {
    freshness,
    metrics: { accepted: { services: [{ id: 'smee-relay', status: serviceStatus }] } },
  } as never;
}

describe('isWebhookRelayRunningInLastSample (PAN-5224)', () => {
  afterEach(() => {
    mocks.getSnapshot.mockReset();
  });

  it('a measuring assessment with a running relay row reads false (ac3)', () => {
    mocks.getSnapshot.mockReturnValue(assessment({ status: 'measuring', observedAt: new Date().toISOString() }, 'running'));

    expect(isWebhookRelayRunningInLastSample()).toBe(false);
  });

  it('a stale assessment with a running relay row reads false (ac3)', () => {
    mocks.getSnapshot.mockReturnValue(assessment({ status: 'stale', observedAt: new Date().toISOString() }, 'running'));

    expect(isWebhookRelayRunningInLastSample()).toBe(false);
  });

  it('a fresh assessment with a running row reads true at 30s old and false at 61s old (ac4)', () => {
    const now = Date.parse('2026-11-14T00:01:00.000Z');
    const observedAt = new Date(now - 30_000).toISOString();
    mocks.getSnapshot.mockReturnValue(assessment({ status: 'fresh', observedAt }, 'running'));

    expect(isWebhookRelayRunningInLastSample(now)).toBe(true);

    const staleObservedAt = new Date(now - 61_000).toISOString();
    mocks.getSnapshot.mockReturnValue(assessment({ status: 'fresh', observedAt: staleObservedAt }, 'running'));

    expect(isWebhookRelayRunningInLastSample(now)).toBe(false);
  });

  it('a fresh assessment with a stopped relay row reads false', () => {
    mocks.getSnapshot.mockReturnValue(assessment({ status: 'fresh', observedAt: new Date().toISOString() }, 'stopped'));

    expect(isWebhookRelayRunningInLastSample()).toBe(false);
  });
});
