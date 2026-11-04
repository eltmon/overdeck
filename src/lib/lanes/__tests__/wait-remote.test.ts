/**
 * PAN-4638 WI-9 step 5: `pan lane wait <name>` on a lane that runs on another
 * machine judges it from home's stand-in. Real stand-in store, report store
 * and lane resolver in a temp OVERDECK_HOME; the clock is a fake.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `lane-wait-remote-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;
mkdirSync(TEST_HOME, { recursive: true });

const { closeOverdeckDatabase } = await import('../../overdeck/infra.js');
const { mirrorRemoteReport } = await import('../../agents/worker/remote-standin.js');
const { writeRemoteLaneFacts, writeRemoteLaneMirror } = await import('../remote-lanes.js');
const { waitForLane } = await import('../wait.js');
const { defaultLaneCliDeps, laneWaitCommand } = await import('../../../cli/commands/lane.js');
const { WORKER_EXIT } = await import('../../../cli/commands/worker.js');

type Facts = import('../remote-lanes.js').RemoteLaneFacts;
type Mirror = import('../remote-lanes.js').RemoteLaneMirror;

function facts(name: string): Facts {
  return {
    v: 1, name, environmentId: 'env-desk', label: 'desk', run: 'hotel', key: name, role: 'builder', iteration: 1,
    parentName: 'orch', criticOfName: null, projectKey: 'lexerra', cwd: `/home/desk/lanes/${name}`, branch: `hotel/${name}`, at: null,
    model: 'claude-opus-5-5', harness: 'claude-code', effort: null, title: name, createdAt: '2026-11-01T12:00:00.000Z',
  };
}

function mirror(overrides: Partial<Mirror>): Mirror {
  return {
    v: 1, state: 'running', activity: 'working', lastActivityAt: '2026-11-01T12:00:00.000Z', git: null, costUsd: null, ownerArchived: false,
    lastSeq: 0, lastSeenAt: '2026-11-01T12:00:00.000Z', unreachableSince: null, lastAssistantMessage: null, spawnError: null,
    ...overrides,
  };
}

/** The CLI with real lane resolution and a wait core on a fake clock. */
function cli() {
  const out: string[] = [];
  const err: string[] = [];
  let clock = Date.parse('2026-11-01T13:00:00.000Z');
  const deps = {
    ...defaultLaneCliDeps(),
    waitForLane: (name: string, options: Parameters<typeof waitForLane>[1]) => waitForLane(name, options, {
      now: () => clock,
      sleep: async (ms: number) => { clock += ms; },
      harnessAlive: async () => { throw new Error('a remote lane never reads local liveness'); },
    }),
    stdout: (text: string) => { out.push(text); },
    stderr: (text: string) => { err.push(text); },
  };
  return { deps, out, err };
}

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('pan lane wait on a remote lane (PAN-4638 WI-9)', () => {
  it('ac4: a mirrored done report exits 0 and prints the report body', async () => {
    await writeRemoteLaneFacts(facts('wait-done'));
    await writeRemoteLaneMirror('wait-done', mirror({ lastSeq: 1, activity: 'idle' }));
    await mirrorRemoteReport('conv-wait-done', { seq: 1, at: '2026-11-01T12:30:00.000Z', status: 'done', body: 'The hex map renders.' });

    const { deps, out, err } = cli();
    expect(await laneWaitCommand('wait-done', {}, deps)).toBe(WORKER_EXIT.done);
    expect(out).toEqual(['The hex map renders.']);
    expect(err[0]).toContain('lane wait-done report 1: done');
  });

  it('ac5: an unreachable owner with no report times out (exit 3), never "no report" (exit 2)', async () => {
    await writeRemoteLaneFacts(facts('wait-away'));
    await writeRemoteLaneMirror('wait-away', mirror({ activity: 'idle', lastActivityAt: '2026-11-01T10:00:00.000Z', unreachableSince: '2026-11-01T12:01:00.000Z' }));

    const { deps, err } = cli();
    expect(await laneWaitCommand('wait-away', { timeout: '5' }, deps)).toBe(WORKER_EXIT.timeout);
    expect(err).toEqual(['lane wait-away is still running; run: pan lane wait wait-away']);
  });

  it('a lane gone from its owner without a report exits 2 with the mirrored last message', async () => {
    await writeRemoteLaneFacts(facts('wait-gone'));
    await writeRemoteLaneMirror('wait-gone', mirror({ state: 'gone', activity: 'stopped', lastAssistantMessage: 'I could not build it.' }));

    const { deps, out } = cli();
    expect(await laneWaitCommand('wait-gone', { timeout: '600' }, deps)).toBe(WORKER_EXIT.noReport);
    expect(out).toEqual(['[no report — last assistant message]\nI could not build it.']);
  });

  it('a long-idle reachable remote lane exits 2 as idle without a report', async () => {
    await writeRemoteLaneFacts(facts('wait-idle'));
    await writeRemoteLaneMirror('wait-idle', mirror({ activity: 'idle', lastActivityAt: '2026-11-01T11:00:00.000Z', lastAssistantMessage: 'Waiting for input.' }));

    const { deps, err } = cli();
    expect(await laneWaitCommand('wait-idle', {}, deps)).toBe(WORKER_EXIT.noReport);
    expect(err[0]).toContain('is idle without a report');
  });
});
