import { ChannelOpenError } from '@overdeck/anywhere-channel/web';
import { describe, expect, it, vi } from 'vitest';

import type { ConnectionPhase } from '../../../../../src/dashboard/frontend/src/lib/connectionState';
import { ConnectionError, connectionText } from '../connection';
import {
  installLinkTelemetry,
  LINK_FAILURE_THROTTLE_MS,
  linkReasonOf,
  RESUME_DROP_WINDOW_MS,
  type LinkTelemetryDeps,
} from '../linkTelemetry';

function setup(overrides: Partial<LinkTelemetryDeps> = {}) {
  let nowMs = 0;
  let phase: ConnectionPhase = 'live';
  let resumedAt: number | null = null;
  let sessionListener: (() => void) | null = null;
  let phaseListener: ((p: ConnectionPhase) => void) | null = null;
  let dialError: ConnectionError | null = null;
  const report = vi.fn();

  const deps: LinkTelemetryDeps = {
    currentEnvironmentId: () => 'env-a',
    onSessionChange: (listener) => {
      sessionListener = listener;
      return () => { sessionListener = null; };
    },
    lastDialError: () => dialError,
    subscribePhase: (listener) => {
      phaseListener = listener;
      return () => { phaseListener = null; };
    },
    currentPhase: () => phase,
    lastResumedAt: () => resumedAt,
    report,
    now: () => nowMs,
    ...overrides,
  };

  const telemetry = installLinkTelemetry(deps);

  return {
    telemetry,
    report,
    setNow: (ms: number) => { nowMs = ms; },
    setResumedAt: (ms: number | null) => { resumedAt = ms; },
    emitPhase: (p: ConnectionPhase) => { phase = p; phaseListener?.(p); },
    fail: (error: ConnectionError) => { dialError = error; sessionListener?.(); },
    clearFailure: () => { dialError = null; sessionListener?.(); },
  };
}

describe('linkReasonOf', () => {
  it.each<[ConnectionError, string]>([
    [new ConnectionError('directory-offline', connectionText.directoryOffline()), 'offline'],
    [new ConnectionError('no-path', connectionText.noPath('desk')), 'no_path'],
    [new ConnectionError('removed', connectionText.removed('desk')), 'removed'],
    [new ConnectionError('pairing-refused', connectionText.pairingRefused('desk')), 'pairing_refused'],
    [new ConnectionError('identity', connectionText.identity('desk')), 'identity_mismatch'],
    [new ConnectionError('outdated', connectionText.outdated('desk')), 'unsupported'],
    [new ConnectionError('other', connectionText.channelFailed('desk'), { cause: new ChannelOpenError('timeout', 'x') }), 'channel_failed'],
    [new ConnectionError('other', connectionText.channelFailed('desk'), { cause: new Error('boom') }), 'other'],
  ])('maps %s to %s', (error, reason) => {
    expect(linkReasonOf(error)).toBe(reason);
  });
});

describe('installLinkTelemetry', () => {
  it('reports failed once for a new dial error', () => {
    const { report, fail } = setup();
    fail(new ConnectionError('no-path', connectionText.noPath('desk')));

    expect(report).toHaveBeenCalledWith({ state: 'failed', reason: 'no_path', route: 'unknown', recover_time: 'none' });
  });

  it('throttles two identical failures within 60s to one report', () => {
    const { report, fail, setNow } = setup();
    setNow(0);
    fail(new ConnectionError('no-path', connectionText.noPath('desk')));
    setNow(1_000);
    fail(new ConnectionError('no-path', connectionText.noPath('desk')));

    expect(report).toHaveBeenCalledTimes(1);

    setNow(LINK_FAILURE_THROTTLE_MS);
    fail(new ConnectionError('no-path', connectionText.noPath('desk')));
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('reports nothing on the first transition into live', () => {
    const { report, emitPhase } = setup({ currentPhase: () => 'delayed' });
    emitPhase('live');
    expect(report).not.toHaveBeenCalled();
  });

  it('reports dropped then recovered with recover_time 1s-4s for live -> delayed -> live 3s apart', () => {
    const { report, emitPhase, setNow } = setup();
    setNow(0);
    emitPhase('delayed');
    expect(report).toHaveBeenCalledWith({ state: 'dropped', reason: 'delayed', route: 'unknown', recover_time: 'none' });

    setNow(3_000);
    emitPhase('live');
    expect(report).toHaveBeenCalledWith({ state: 'recovered', reason: 'delayed', route: 'unknown', recover_time: '1s-4s' });
  });

  it('reports a drop with reason resume when it starts within the resume window', () => {
    const { report, emitPhase, setNow, setResumedAt } = setup();
    setResumedAt(0);
    setNow(2_000);
    expect(2_000 - 0).toBeLessThanOrEqual(RESUME_DROP_WINDOW_MS);

    emitPhase('delayed');

    expect(report).toHaveBeenCalledWith({ state: 'dropped', reason: 'resume', route: 'unknown', recover_time: 'none' });
  });

  it('reports one route_changed with route relay when direct is followed by relay', () => {
    const { report, telemetry } = setup();
    telemetry.routeOpened('env-a', 'direct');
    expect(report).not.toHaveBeenCalled();

    telemetry.routeOpened('env-a', 'relay');

    expect(report).toHaveBeenCalledWith({ state: 'route_changed', reason: 'none', route: 'relay', recover_time: 'none' });
  });

  it('ignores routeOpened for another machine, and a later drop still carries the current machine\'s route', () => {
    const { report, telemetry, emitPhase } = setup({ currentEnvironmentId: () => 'env-a' });
    telemetry.routeOpened('env-a', 'direct');
    report.mockClear();

    telemetry.routeOpened('env-b', 'relay');
    expect(report).not.toHaveBeenCalled();

    emitPhase('delayed');
    expect(report).toHaveBeenCalledWith({ state: 'dropped', reason: 'delayed', route: 'direct', recover_time: 'none' });
  });

  it('reports nothing for a drop or recovery while no machine is open', () => {
    const { report, emitPhase } = setup({ currentEnvironmentId: () => null });

    emitPhase('delayed');
    emitPhase('live');

    expect(report).not.toHaveBeenCalled();
  });

  it('stops reporting once uninstalled', () => {
    const { report, telemetry, fail } = setup();
    telemetry.uninstall();
    fail(new ConnectionError('no-path', connectionText.noPath('desk')));
    expect(report).not.toHaveBeenCalled();
  });

  it('never throws when report throws', () => {
    const throwingReport = vi.fn(() => { throw new Error('telemetry blew up'); });
    const { fail } = setup({ report: throwingReport });
    expect(() => fail(new ConnectionError('no-path', connectionText.noPath('desk')))).not.toThrow();
  });
});
