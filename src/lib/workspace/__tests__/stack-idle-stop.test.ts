/**
 * PAN-5250 WI-6: the idle stop's pure rules. Plain numbers for time; no timers.
 */
import type { BackendPane } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';

import type { ComposeContainer } from '../stack-reclaim-docker.js';
import type { ContainerUsageResult } from '../stack-usage-probe.js';
import { advanceIdleClock, idleStopTargets, workspaceInUse, type IdleUseFacts } from '../stack-idle-stop.js';

const PROJECT = 'myn-feature-min-1';
const SERVICES: ReadonlySet<string> = new Set(['frontend', 'fe', 'dev']);
const MINUTE = 60_000;

function container(service: string, overrides: Partial<ComposeContainer> = {}): ComposeContainer {
  const name = `${PROJECT}-${service}-1`;
  return { id: `id-${name}`, name, state: 'running', composeProject: PROJECT, composeService: service, ...overrides };
}

function pane(role: BackendPane['role'], state: BackendPane['state'] = 'idle'): BackendPane {
  return { id: `p-${role}`, role, harness: 'claude-code', model: 'claude-opus-5-5', state, issue: 'MIN-1' };
}

const FE = container('fe');
const quiet = new Map<string, ContainerUsageResult>([[FE.name, { inboundConnections: 0, execSessions: 0 }]]);

function facts(overrides: Partial<IdleUseFacts> = {}): IdleUseFacts {
  return { targets: [FE], usage: quiet, panes: [], verificationBusy: false, inGateQueue: false, pinned: false, ...overrides };
}

describe('workspaceInUse', () => {
  it('is not in use with only a working work pane or a review pane', () => {
    expect(workspaceInUse(facts())).toBeNull();
    expect(workspaceInUse(facts({ panes: [pane('work', 'working')] }))).toBeNull();
    expect(workspaceInUse(facts({ panes: [pane('review', 'working'), pane('plan'), pane('conversation')] }))).toBeNull();
  });

  it('names each reason when it holds alone', () => {
    expect(workspaceInUse(facts({ pinned: true }))).toBe('pinned');
    expect(workspaceInUse(facts({ panes: [pane('uat')] }))).toBe('test-agent');
    expect(workspaceInUse(facts({ panes: [pane('test')] }))).toBe('test-agent');
    expect(workspaceInUse(facts({ verificationBusy: true }))).toBe('verification');
    expect(workspaceInUse(facts({ inGateQueue: true }))).toBe('gate-queue');
    expect(workspaceInUse(facts({ usage: new Map([[FE.name, 'unknown']]) }))).toBe('probe-unknown');
    expect(workspaceInUse(facts({ usage: new Map() }))).toBe('probe-unknown');
    expect(workspaceInUse(facts({ usage: new Map([[FE.name, { inboundConnections: 0, execSessions: 1 }]]) }))).toBe('exec-session');
    expect(workspaceInUse(facts({ usage: new Map([[FE.name, { inboundConnections: 2, execSessions: 0 }]]) }))).toBe('browser');
  });

  it('checks the pin first', () => {
    expect(workspaceInUse(facts({ pinned: true, verificationBusy: true, panes: [pane('uat')] }))).toBe('pinned');
  });
});

describe('advanceIdleClock', () => {
  const t0 = 1_000_000;
  const limit = 20 * MINUTE;

  it('starts, waits, then comes due at the limit', () => {
    const clock = new Map<string, number>();
    expect(advanceIdleClock(clock, 'min-1', null, t0, limit)).toEqual({ kind: 'idle-started' });
    expect(clock.get('MIN-1')).toBe(t0);
    expect(advanceIdleClock(clock, 'MIN-1', null, t0 + 19 * MINUTE, limit)).toEqual({ kind: 'idle-waiting', idleMs: 19 * MINUTE });
    expect(advanceIdleClock(clock, 'MIN-1', null, t0 + 20 * MINUTE, limit)).toEqual({ kind: 'due', idleMs: 1_200_000 });
  });

  it('clears the clock when in use, so the next idle step starts again', () => {
    const clock = new Map<string, number>();
    advanceIdleClock(clock, 'MIN-1', null, t0, limit);
    expect(advanceIdleClock(clock, 'MIN-1', 'browser', t0 + 15 * MINUTE, limit)).toEqual({ kind: 'in-use', reason: 'browser' });
    expect(clock.has('MIN-1')).toBe(false);
    expect(advanceIdleClock(clock, 'MIN-1', null, t0 + 21 * MINUTE, limit)).toEqual({ kind: 'idle-started' });
  });
});

describe('idleStopTargets', () => {
  it('keeps only running idle-stop services of the exact compose project', () => {
    const running = [
      FE,
      container('dev'),
      container('frontend', { state: 'exited' }),
      container('postgres'),
      container('frontend', { name: 'other-frontend-1', composeProject: 'other' }),
    ];
    expect(idleStopTargets(running, PROJECT, SERVICES).map((c) => c.name)).toEqual([FE.name, `${PROJECT}-dev-1`]);
  });
});
