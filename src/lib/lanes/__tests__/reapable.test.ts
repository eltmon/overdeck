/**
 * PAN-5094 WI-4: the pure superseded-lane rule, one case per PRD bullet.
 */
import { describe, expect, it } from 'vitest';

import { supersededLanes, type ReapableRow } from '../reapable.js';

function row(overrides: Partial<ReapableRow> & { name: string; iteration: number }): ReapableRow {
  return {
    run: 'hotel',
    key: 'k1',
    role: 'builder',
    createdAt: '2026-01-01T00:00:00.000Z',
    archived: false,
    activity: 'idle',
    reported: false,
    ...overrides,
  };
}

describe('supersededLanes (reapable-rule)', () => {
  it('maps builder i1 (idle, reported) to builder i2 (working), with no entry for i2 (ac1)', () => {
    const i1 = row({ name: 'i1', iteration: 1, activity: 'idle', reported: true, createdAt: '2026-01-01T00:00:00.000Z' });
    const i2 = row({ name: 'i2', iteration: 2, activity: 'working', createdAt: '2026-01-02T00:00:00.000Z' });

    const result = supersededLanes([i1, i2]);

    expect(result.get('i1')).toBe('i2');
    expect(result.has('i2')).toBe(false);
  });

  it('never flags a working i1, even when reported (ac2)', () => {
    const i1 = row({ name: 'i1', iteration: 1, activity: 'working', reported: true });
    const i2 = row({ name: 'i2', iteration: 2, activity: 'idle', createdAt: '2026-01-02T00:00:00.000Z' });

    expect(supersededLanes([i1, i2]).has('i1')).toBe(false);
  });

  it('never flags an idle i1 with no report, but flags a stopped i1 with no report (ac2)', () => {
    const i2 = row({ name: 'i2', iteration: 2, activity: 'idle', createdAt: '2026-01-02T00:00:00.000Z' });

    const idleUnreported = row({ name: 'i1', iteration: 1, activity: 'idle', reported: false });
    expect(supersededLanes([idleUnreported, i2]).has('i1')).toBe(false);

    const stoppedUnreported = row({ name: 'i1', iteration: 1, activity: 'stopped', reported: false });
    expect(supersededLanes([stoppedUnreported, i2]).get('i1')).toBe('i2');
  });

  it('never surfaces an archived row (ac5)', () => {
    const i1 = row({ name: 'i1', iteration: 1, activity: 'stopped', reported: true, archived: true });
    const i2 = row({ name: 'i2', iteration: 2, activity: 'idle', createdAt: '2026-01-02T00:00:00.000Z' });

    expect(supersededLanes([i1, i2]).has('i1')).toBe(false);
  });

  it('flags neither --reuse row of i1 while one is working, but flags both once both are stopped (ac3)', () => {
    const i2 = row({ name: 'i2', iteration: 2, activity: 'idle', createdAt: '2026-01-03T00:00:00.000Z' });

    const i1Stopped = row({ name: 'i1a', iteration: 1, activity: 'stopped', reported: true, createdAt: '2026-01-01T00:00:00.000Z' });
    const i1Working = row({ name: 'i1b', iteration: 1, activity: 'working', createdAt: '2026-01-02T00:00:00.000Z' });
    const mixed = supersededLanes([i1Stopped, i1Working, i2]);
    expect(mixed.has('i1a')).toBe(false);
    expect(mixed.has('i1b')).toBe(false);

    const i1StoppedA = row({ name: 'i1a', iteration: 1, activity: 'stopped', reported: true, createdAt: '2026-01-01T00:00:00.000Z' });
    const i1StoppedB = row({ name: 'i1b', iteration: 1, activity: 'stopped', createdAt: '2026-01-02T00:00:00.000Z' });
    const bothStopped = supersededLanes([i1StoppedA, i1StoppedB, i2]);
    expect(bothStopped.get('i1a')).toBe('i2');
    expect(bothStopped.get('i1b')).toBe('i2');
  });

  it('judges a critic group against a critic iteration 2, not the builder\'s (ac4)', () => {
    const criticI1 = row({ name: 'crit-i1', role: 'critic', iteration: 1, activity: 'stopped', reported: true, createdAt: '2026-01-01T00:00:00.000Z' });
    const builderI2 = row({ name: 'build-i2', role: 'builder', iteration: 2, activity: 'idle', createdAt: '2026-01-02T00:00:00.000Z' });
    expect(supersededLanes([criticI1, builderI2]).has('crit-i1')).toBe(false);

    const criticI2 = row({ name: 'crit-i2', role: 'critic', iteration: 2, activity: 'idle', createdAt: '2026-01-03T00:00:00.000Z' });
    expect(supersededLanes([criticI1, builderI2, criticI2]).get('crit-i1')).toBe('crit-i2');
  });

  it('never flags an orchestrator lane, even stopped and reported with a newer iteration (ac4)', () => {
    const orchI1 = row({ name: 'orch-i1', role: 'orchestrator', iteration: 1, activity: 'stopped', reported: true });
    const orchI2 = row({ name: 'orch-i2', role: 'orchestrator', iteration: 2, activity: 'idle', createdAt: '2026-01-02T00:00:00.000Z' });

    const result = supersededLanes([orchI1, orchI2]);
    expect(result.has('orch-i1')).toBe(false);
    expect(result.has('orch-i2')).toBe(false);
  });

  it('flags nothing for a single iteration, and never supersedes across a different run or key (ac5)', () => {
    const onlyIteration = row({ name: 'solo', iteration: 1, activity: 'stopped', reported: true });
    expect(supersededLanes([onlyIteration]).size).toBe(0);

    const differentRun = row({ name: 'other-run', run: 'alfa', iteration: 1, activity: 'stopped', reported: true });
    const differentKey = row({ name: 'other-key', key: 'k2', iteration: 2, activity: 'idle', createdAt: '2026-01-02T00:00:00.000Z' });
    expect(supersededLanes([differentRun, differentKey]).size).toBe(0);
  });
});
