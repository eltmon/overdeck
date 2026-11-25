/**
 * PAN-5342 WI-7: boot consumes a leftover shutdown record through endShutdown.
 * The record lives in a fresh temp OVERDECK_HOME; the reboot guard and the
 * resume-offer seed are fakes.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isShutdownDrainingSync,
  shutdownRecordPath,
  writeShutdownRecord,
  type ShutdownRecord,
} from '../../../../../lib/shutdown/drain-record.js';
import { startShutdownServices } from '../boot.js';
import { endShutdown, resumeOfferSessions } from '../end.js';

let home: string;
const savedHome = process.env.OVERDECK_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pan-5342-boot-'));
  process.env.OVERDECK_HOME = home;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function fakes() {
  const seed = vi.fn();
  const startRebootGuard = vi.fn();
  return {
    seed,
    startRebootGuard,
    deps: {
      endShutdown: (record: ShutdownRecord) => endShutdown(record, { seedShutdownOffer: seed }),
      startRebootGuard,
    },
  };
}

const record: ShutdownRecord = {
  version: 1,
  startedAt: '2026-11-15T11:00:00.000Z',
  deadlineAt: '2026-11-15T11:02:00.000Z',
  reboot: true,
  force: 'never',
  phase: 'complete',
  stopped: [
    { kind: 'agent', id: 'agent-pan-1', issueId: 'PAN-1', label: 'PAN-1 work agent', wasWorking: false },
    { kind: 'conversation', id: 'conv-busy', name: 'busy', label: 'Busy', wasWorking: true },
    { kind: 'conversation', id: 'conv-idle', name: 'idle', label: 'Idle', wasWorking: false },
  ],
};

describe('startShutdownServices (PAN-5342 WI-7)', () => {
  it('ends a leftover record: the file is gone and the offer lists agents plus mid-turn conversations', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await writeShutdownRecord(record);
    expect(isShutdownDrainingSync()).toBe(true);
    const f = fakes();
    await startShutdownServices(f.deps);
    expect(isShutdownDrainingSync()).toBe(false);
    expect(f.seed).toHaveBeenCalledTimes(1);
    expect(f.seed.mock.calls[0]![0].map((s: { id: string }) => s.id)).toEqual(['agent-pan-1', 'conv-busy']);
    expect(f.startRebootGuard).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(
      '[shutdown] boot ended a shutdown record from 2026-11-15T11:00:00.000Z: offering 2 sessions',
    );
  });

  it('seeds nothing without a record, and still starts the reboot guard', async () => {
    const f = fakes();
    await startShutdownServices(f.deps);
    expect(f.seed).not.toHaveBeenCalled();
    expect(f.startRebootGuard).toHaveBeenCalledTimes(1);
  });

  it('deletes an unreadable record so admissions reopen, offering nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    writeFileSync(shutdownRecordPath(), '{not json');
    const f = fakes();
    await startShutdownServices(f.deps);
    expect(isShutdownDrainingSync()).toBe(false);
    expect(f.seed).not.toHaveBeenCalled();
  });

  it('never throws, even when ending the record fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const f = fakes();
    await expect(startShutdownServices({
      readRecord: async () => record,
      endShutdown: async () => { throw new Error('disk full'); },
      startRebootGuard: f.startRebootGuard,
    })).resolves.toBeUndefined();
    expect(f.startRebootGuard).toHaveBeenCalledTimes(1);
  });
});

describe('resumeOfferSessions (PAN-5342 D-9, PAN-5671)', () => {
  const flywheel = { kind: 'conversation' as const, id: 'conv-flywheel', name: 'conv-flywheel', label: 'Flywheel', wasWorking: false };

  it('lists every agent and the mid-turn conversations, not other idle conversations', () => {
    expect(resumeOfferSessions(record).map((s) => s.id)).toEqual(['agent-pan-1', 'conv-busy']);
  });

  it('lists the Flywheel conversation the drain stopped between ticks', () => {
    const offered = resumeOfferSessions({ ...record, stopped: [...record.stopped, flywheel] });
    expect(offered.map((s) => s.id)).toEqual(['agent-pan-1', 'conv-busy', 'conv-flywheel']);
  });

  it('lists the Flywheel conversation the drain stopped mid-turn once', () => {
    const offered = resumeOfferSessions({ ...record, stopped: [{ ...flywheel, wasWorking: true }] });
    expect(offered.map((s) => s.id)).toEqual(['conv-flywheel']);
  });
});
