import { describe, expect, it, vi } from 'vitest';
import {
  RELAY_USAGE_TELEMETRY_INTERVAL_MS,
  RelayUsageSampler,
  captureChannelOpen,
  captureLinkApproved,
  captureLinkFailed,
  captureLinkStarted,
  capturePhonePaired,
  capturePhoneRemoved,
  linkFailureReason,
  linkMethodForTransport,
  type AnywhereAnalytics,
} from '../../../../src/lib/telemetry/anywhere.js';

function fakeAnalytics() {
  const capture = vi.fn();
  return { capture, analytics: { capture } as AnywhereAnalytics };
}

function throwingAnalytics(): AnywhereAnalytics {
  return {
    capture: () => {
      throw new Error('posthog down');
    },
  };
}

describe('Anywhere telemetry capture helpers', () => {
  it('sends each event with exactly its closed-domain properties', () => {
    const { capture, analytics } = fakeAnalytics();

    captureLinkStarted('ssh', analytics);
    captureLinkApproved('fly', 'requester', analytics);
    captureLinkFailed('directory_approval', 'approver', 'approval_failed', analytics);
    capturePhonePaired(true, analytics);
    capturePhoneRemoved('operator', analytics);
    captureChannelOpen({ route: 'relay', ok: false, error_class: 'unreachable' }, analytics);

    expect(capture.mock.calls).toEqual([
      ['machine_link_started', { method: 'ssh' }],
      ['machine_link_approved', { method: 'fly', side: 'requester' }],
      ['machine_link_failed', { method: 'directory_approval', side: 'approver', reason: 'approval_failed' }],
      ['phone_paired', { replaced_previous: true }],
      ['phone_removed', { by: 'operator' }],
      ['anywhere_channel_opened', { route: 'relay', ok: false, error_class: 'unreachable' }],
    ]);
  });

  it('swallows a throwing analytics client in every helper', () => {
    const analytics = throwingAnalytics();

    expect(() => captureLinkStarted('pairing_code', analytics)).not.toThrow();
    expect(() => captureLinkApproved('pairing_code', 'approver', analytics)).not.toThrow();
    expect(() => captureLinkFailed('pairing_code', 'approver', 'grant_refused', analytics)).not.toThrow();
    expect(() => capturePhonePaired(false, analytics)).not.toThrow();
    expect(() => capturePhoneRemoved('phone', analytics)).not.toThrow();
    expect(() => captureChannelOpen({ route: 'lan', ok: true, error_class: 'none' }, analytics)).not.toThrow();

    for (const factory of [() => analytics, (): AnywhereAnalytics => { throw new Error('no client'); }]) {
      let now = 0;
      const sampler = new RelayUsageSampler({ now: () => now, analytics: factory });
      sampler.record(1);
      now = RELAY_USAGE_TELEMETRY_INTERVAL_MS;
      expect(() => sampler.record(1)).not.toThrow();
    }
  });
});

describe('linkMethodForTransport', () => {
  it('derives the method from the transport kind (D-8)', () => {
    expect(linkMethodForTransport(undefined)).toBe('pairing_code');
    expect(linkMethodForTransport('ssh')).toBe('ssh');
    expect(linkMethodForTransport('public')).toBe('fly');
    expect(linkMethodForTransport('lan')).toBe('other');
  });
});

describe('linkFailureReason', () => {
  it('maps every known error code to its failure reason', () => {
    const cases = [
      ['bad-pairing-url', 'bad_pairing_url'],
      ['unreachable', 'unreachable'],
      ['pairing-refused', 'pairing_refused'],
      ['unsupported', 'unsupported'],
      ['identity-mismatch', 'identity_mismatch'],
      ['exchange-failed', 'exchange_failed'],
      ['offline', 'offline'],
    ] as const;
    for (const [code, reason] of cases) {
      expect(linkFailureReason(Object.assign(new Error('x'), { code }))).toBe(reason);
    }
  });

  it('returns other for an unknown or missing code', () => {
    expect(linkFailureReason(new Error('x'))).toBe('other');
    expect(linkFailureReason(null)).toBe('other');
    expect(linkFailureReason({ code: 'toString' })).toBe('other');
    expect(linkFailureReason({ code: 42 })).toBe('other');
  });
});

describe('RelayUsageSampler', () => {
  it('sends one bucketed sample once an hour has passed in the window', () => {
    const { capture, analytics } = fakeAnalytics();
    let now = 0;
    const sampler = new RelayUsageSampler({ now: () => now, analytics: () => analytics });

    sampler.record(5_000_000);
    now = 59 * 60_000;
    sampler.record(1);
    expect(capture).not.toHaveBeenCalled();

    now = 60 * 60_000;
    sampler.record(1);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('relay_usage_sampled', { bytes: '1mb-9mb' });

    now = 200 * 60_000;
    sampler.record(0);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('starts a new window after each sample', () => {
    const { capture, analytics } = fakeAnalytics();
    let now = 0;
    const sampler = new RelayUsageSampler({ now: () => now, analytics: () => analytics });

    sampler.record(1);
    now = RELAY_USAGE_TELEMETRY_INTERVAL_MS;
    sampler.record(1);
    now += RELAY_USAGE_TELEMETRY_INTERVAL_MS - 1;
    sampler.record(2_000_000_000);
    expect(capture).toHaveBeenCalledTimes(1);

    now += 1;
    sampler.record(1);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenLastCalledWith('relay_usage_sampled', { bytes: '1gb+' });
  });
});
