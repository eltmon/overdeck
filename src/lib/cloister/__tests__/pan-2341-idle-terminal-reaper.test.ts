import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isIdlePastThreshold,
  selectNonMergedTerminalAdvancingSessions,
  type ReapableStatus,
} from '../reap-terminal-sessions.js';

const TEN_MINUTES_MS = 10 * 60 * 1000;

function status(fields: Partial<ReapableStatus> = {}): ReapableStatus {
  return {
    reviewStatus: 'passed',
    testStatus: 'pending',
    mergeStatus: 'pending',
    readyForMerge: false,
    ...fields,
  };
}

describe('PAN-2341 idle terminal advancing reaper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-07T12:10:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('selects non-merged terminal advancing sessions and the idle gate admits panes idle >= 10m', () => {
    const sessions = selectNonMergedTerminalAdvancingSessions({
      'PAN-3001': status({ reviewStatus: 'passed' }),
    }, ['agent-pan-3001-review']);

    expect(sessions).toEqual(['agent-pan-3001-review']);
    expect(isIdlePastThreshold({
      state: 'idle',
      lastActivity: '2026-07-07T12:00:00.000Z',
    }, TEN_MINUTES_MS)).toBe(true);
  });

  it('preserves terminal sessions idle for less than 10 minutes', () => {
    expect(isIdlePastThreshold({
      state: 'idle',
      lastActivity: '2026-07-07T12:00:01.000Z',
    }, TEN_MINUTES_MS)).toBe(false);
  });

  it('does not select non-terminal or merged advancing sessions', () => {
    const sessions = selectNonMergedTerminalAdvancingSessions({
      'PAN-3001': status({ reviewStatus: 'reviewing' }),
      'PAN-3002': status({ reviewStatus: 'passed', mergeStatus: 'merged' }),
    }, [
      'agent-pan-3001-review',
      'agent-pan-3002-review',
    ]);

    expect(sessions).toEqual([]);
  });

  it('reaps only after virtual time crosses the 10-minute idle threshold', async () => {
    const runtime = {
      state: 'idle',
      lastActivity: '2026-07-07T12:00:00.000Z',
    };

    vi.setSystemTime(new Date('2026-07-07T12:09:59.000Z'));
    expect(isIdlePastThreshold(runtime, TEN_MINUTES_MS)).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    expect(isIdlePastThreshold(runtime, TEN_MINUTES_MS)).toBe(true);
  });

  it('wires checkIdleTerminalAdvancingSessions after checkMergedAdvancingSessions in the patrol', () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const deaconSource = readFileSync(join(testDir, '..', 'deacon.ts'), 'utf-8');

    const mergedIndex = deaconSource.indexOf('await checkMergedAdvancingSessions()');
    const idleIndex = deaconSource.indexOf('await checkIdleTerminalAdvancingSessions()');

    expect(mergedIndex).toBeGreaterThan(-1);
    expect(idleIndex).toBeGreaterThan(-1);
    expect(idleIndex).toBeGreaterThan(mergedIndex);
  });
});
