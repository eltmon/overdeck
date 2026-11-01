/**
 * PAN-4654 WI-5: the per-machine update job. Every seam is injected: an
 * in-memory job file, fake CLIs, a fake UpdateManager and fake timers. Nothing
 * here runs a real command or touches the file system.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetInstallMode, FleetUpdateJob, UpdateSnapshot } from '@overdeck/contracts';

import type { InstalledHarnessCli } from '../../../../lib/fleet/harness-versions.js';
import {
  type FleetUpdateDeps,
  FleetUpdateService,
  INSTALL_POLL_MS,
  type OverdeckUpdater,
  TURN_POLL_MS,
} from '../fleet-update-service.js';

const JOB_PATH = '/home/u/.overdeck/fleet-update.json';

function cli(binary: string, label: string, version: string, argv: string[] | null): InstalledHarnessCli {
  return {
    binary, label, harnesses: [binary], version,
    updatable: argv !== null, command: argv ? argv.join(' ') : '', reason: argv ? null : `Overdeck does not update ${label}`,
    binaryPath: `/b/${binary}`, plan: { argv, display: argv ? argv.join(' ') : '', reason: argv ? null : `Overdeck does not update ${label}` },
  };
}

function snapshot(phase: UpdateSnapshot['phase'], extra: Partial<UpdateSnapshot> = {}): UpdateSnapshot {
  return {
    phase, installMode: 'npm-global', channel: 'stable', currentVersion: '0.73.0', targetVersion: null,
    releaseName: null, releaseNotes: null, releaseUrl: null, publishedAt: null, progressPercent: null,
    error: null, lastCheckedAt: null, compatibility: 'unknown', currentDashboardProtocol: 1,
    currentAgentProtocol: 1, targetDashboardProtocol: null, targetAgentProtocol: null, ...extra,
  };
}

interface Harness {
  service: FleetUpdateService;
  deps: FleetUpdateDeps;
  files: Map<string, string>;
  runCommand: ReturnType<typeof vi.fn<FleetUpdateDeps['runCommand']>>;
  restart: ReturnType<typeof vi.fn<FleetUpdateDeps['restart']>>;
  job: () => FleetUpdateJob;
  fileJob: () => FleetUpdateJob;
}

function harness(options: {
  turns?: () => number;
  installMode?: FleetInstallMode;
  version?: string;
  after?: Record<string, string>;
  run?: FleetUpdateDeps['runCommand'];
  manager?: OverdeckUpdater;
  files?: Map<string, string>;
} = {}): Harness {
  const files = options.files ?? new Map<string, string>();
  const after = options.after ?? { '/b/claude': '2.1.5', '/b/codex': '0.159.0' };
  const runCommand = vi.fn<FleetUpdateDeps['runCommand']>(options.run ?? (async () => ({ code: 0, output: '' })));
  const restart = vi.fn<FleetUpdateDeps['restart']>(async () => ({ ok: true, pid: 4242 }));
  let ids = 0;
  const deps: FleetUpdateDeps = {
    jobPath: JOB_PATH,
    readFile: async (path) => {
      const body = files.get(path);
      if (body === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return body;
    },
    writeFile: async (path, data) => { files.set(path, data); },
    rename: async (from, to) => { files.set(to, files.get(from)!); files.delete(from); },
    detectClis: async () => [
      cli('claude', 'Claude Code', '2.1.0', ['/b/claude', 'update']),
      cli('codex', 'Codex CLI', '0.150.0', ['/p/bin/npm', 'install', '-g', '--prefix', '/p', '@openai/codex@latest']),
      cli('muse', 'Muse Code', '1.4.7', null),
    ],
    readVersion: async (binaryPath) => after[binaryPath] ?? null,
    runCommand,
    countWorkingTurns: async () => (options.turns ?? (() => 0))(),
    overdeck: {
      installMode: () => options.installMode ?? 'development',
      version: async () => options.version ?? '0.73.0',
      manager: async () => options.manager ?? { check: async () => snapshot('current'), install: () => snapshot('error'), getSnapshot: () => snapshot('current') },
    },
    restart,
    emit: () => undefined,
    now: () => Date.now(),
    randomId: () => `id-${++ids}`,
  };
  const service = new FleetUpdateService(deps);
  return {
    service, deps, files, runCommand, restart,
    job: () => service.current()!,
    fileJob: () => JSON.parse(files.get(JOB_PATH)!) as FleetUpdateJob,
  };
}

/** Lets the un-awaited job loop run up to its next timer. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

const component = (job: FleetUpdateJob, name: string) => job.components.find((entry) => entry.name === name)!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FleetUpdateService (PAN-4654 WI-5)', () => {
  it('waits while a turn is working and starts within 5 s of the last turn ending', async () => {
    const counts = [2, 2, 0];
    const h = harness({ turns: () => counts.shift() ?? 0 });
    const { outcome, job } = await h.service.start('when-idle', 'operator');
    expect(outcome).toBe('started');
    expect(job).toMatchObject({ phase: 'waiting', mode: 'when-idle', waitingSince: '2026-11-01T12:00:00.000Z' });
    await flush();
    expect(h.job()).toMatchObject({ phase: 'waiting', waitingTurns: 2 });
    await vi.advanceTimersByTimeAsync(TURN_POLL_MS);
    expect(h.job().phase).toBe('waiting');
    expect(h.runCommand).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(TURN_POLL_MS);
    expect(h.runCommand).toHaveBeenCalledTimes(2);
    expect(h.job()).toMatchObject({ phase: 'done', waitingTurns: 0 });
  });

  it('never starts on its own while a turn works', async () => {
    const h = harness({ turns: () => 1 });
    await h.service.start('when-idle', 'operator');
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    expect(h.runCommand).not.toHaveBeenCalled();
    expect(h.job()).toMatchObject({ phase: 'waiting', waitingTurns: 1 });
    expect(h.fileJob()).toMatchObject({ phase: 'waiting', waitingTurns: 1 });
  });

  it('Update now escalates a waiting job', async () => {
    const h = harness({ turns: () => 1 });
    await h.service.start('when-idle', 'operator');
    await flush();
    const escalated = await h.service.escalate();
    expect(escalated?.mode).toBe('now');
    await flush();
    expect(h.runCommand.mock.calls.map(([argv]) => argv[0])).toEqual(['/b/claude', '/p/bin/npm']);
    expect(h.job().phase).toBe('done');
  });

  it('records before and after for claude and codex', async () => {
    const h = harness();
    await h.service.start('now', 'operator');
    await flush();
    const job = h.job();
    expect(component(job, 'claude')).toMatchObject({ before: '2.1.0', after: '2.1.5', status: 'updated' });
    expect(component(job, 'codex')).toMatchObject({ before: '0.150.0', after: '0.159.0', status: 'updated' });
    expect(component(job, 'muse')).toMatchObject({ before: '1.4.7', status: 'skipped', detail: 'Overdeck does not update Muse Code' });
    expect(job.phase).toBe('done');
    expect(h.fileJob()).toEqual(job);
  });

  it('a failing CLI update does not stop the next one', async () => {
    const h = harness({
      after: { '/b/claude': '2.1.0', '/b/codex': '0.159.0' },
      run: async (argv) => (argv[0] === '/b/claude' ? { code: 1, output: `${'x'.repeat(3000)}permission denied` } : { code: 0, output: '' }),
    });
    await h.service.start('now', 'operator');
    await flush();
    const job = h.job();
    expect(h.runCommand).toHaveBeenCalledTimes(2);
    expect(component(job, 'claude').status).toBe('failed');
    expect(component(job, 'claude').detail).toHaveLength(2000);
    expect(component(job, 'claude').detail?.endsWith('permission denied')).toBe(true);
    expect(component(job, 'codex').status).toBe('updated');
    expect(job.phase).toBe('failed');
  });

  it('an unchanged version with exit code 0 is current', async () => {
    const h = harness({ after: { '/b/claude': '2.1.0', '/b/codex': '0.150.0' } });
    await h.service.start('now', 'operator');
    await flush();
    expect(component(h.job(), 'claude').status).toBe('current');
    expect(h.job().phase).toBe('done');
  });

  it('development install skips Overdeck and still updates CLIs', async () => {
    const manager = vi.fn();
    const h = harness({ installMode: 'development' });
    h.deps.overdeck.manager = manager;
    await h.service.start('now', 'operator');
    await flush();
    expect(component(h.job(), 'overdeck')).toMatchObject({ status: 'skipped', before: '0.73.0', detail: 'development install: update it from the repository (pan reload)' });
    expect(component(h.job(), 'claude').status).toBe('updated');
    expect(manager).not.toHaveBeenCalled();
    expect(h.restart).not.toHaveBeenCalled();
  });

  it('a desktop install skips Overdeck with the app reason', async () => {
    const h = harness({ installMode: 'desktop' });
    await h.service.start('now', 'operator');
    await flush();
    expect(component(h.job(), 'overdeck')).toMatchObject({ status: 'skipped', detail: 'desktop app: update it from the app' });
  });

  it('npm-global with an available release installs, restarts and is finished by boot()', async () => {
    let polls = 0;
    const manager: OverdeckUpdater = {
      check: async () => snapshot('available', { targetVersion: '0.74.0' }),
      install: () => snapshot('installing'),
      getSnapshot: () => snapshot(++polls < 3 ? 'installing' : 'ready'),
    };
    const h = harness({ installMode: 'npm-global', manager });
    const { job } = await h.service.start('now', 'operator');
    await flush();
    expect(h.restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3 * INSTALL_POLL_MS);
    expect(h.restart).toHaveBeenCalledTimes(1);
    expect(h.restart).toHaveBeenCalledWith(`fleet-update:${job.id}`);
    await h.service.settled();
    expect(h.fileJob().phase).toBe('restarting');

    const next = harness({ installMode: 'npm-global', version: '0.74.0', files: h.files });
    await next.service.boot();
    await next.service.settled();
    expect(next.job().phase).toBe('done');
    expect(component(next.job(), 'overdeck')).toMatchObject({ before: '0.73.0', after: '0.74.0', status: 'updated' });
    expect(next.fileJob().phase).toBe('done');
  });

  it('boot() fails a restarted job whose dashboard still runs the old version', async () => {
    const h = harness({ installMode: 'npm-global' });
    h.files.set(JOB_PATH, JSON.stringify({
      id: 'j1', mode: 'now', phase: 'restarting', requestedBy: 'operator', startedAt: '2026-11-01T11:00:00.000Z',
      waitingTurns: 0, waitingSince: null, finishedAt: null,
      components: [{ name: 'overdeck', label: 'Overdeck', before: '0.73.0', after: null, status: 'running', detail: null }],
    }));
    await h.service.boot();
    expect(h.job().phase).toBe('failed');
    expect(component(h.job(), 'overdeck')).toMatchObject({ status: 'failed', detail: 'the restarted dashboard still runs 0.73.0' });
  });

  it('boot() marks an interrupted job failed', async () => {
    const h = harness();
    h.files.set(JOB_PATH, JSON.stringify({
      id: 'j1', mode: 'now', phase: 'updating', requestedBy: 'operator', startedAt: '2026-11-01T11:00:00.000Z',
      waitingTurns: 0, waitingSince: null, finishedAt: null,
      components: [
        { name: 'claude', label: 'Claude Code', before: '2.1.0', after: null, status: 'running', detail: null },
        { name: 'overdeck', label: 'Overdeck', before: '0.73.0', after: null, status: 'pending', detail: null },
      ],
    }));
    await h.service.boot();
    await h.service.settled();
    expect(h.job()).toMatchObject({ phase: 'failed', finishedAt: '2026-11-01T12:00:00.000Z' });
    expect(component(h.job(), 'claude')).toMatchObject({ status: 'failed', detail: 'interrupted by a dashboard restart' });
    expect(component(h.job(), 'overdeck')).toMatchObject({ status: 'skipped', detail: 'interrupted by a dashboard restart' });
    expect(h.fileJob().phase).toBe('failed');
  });

  it('boot() loads a finished job as-is and ignores a missing or corrupt file', async () => {
    const empty = harness();
    await empty.service.boot();
    expect(empty.service.current()).toBeNull();
    const corrupt = harness({ files: new Map([[JOB_PATH, '{not json']]) });
    await corrupt.service.boot();
    expect(corrupt.service.current()).toBeNull();
  });

  it('a second start while updating is refused; start(now) on a waiting job escalates (D-13)', async () => {
    const busy = harness({ run: () => new Promise(() => undefined) });
    await busy.service.start('now', 'operator');
    await flush();
    expect(busy.job().phase).toBe('updating');
    expect((await busy.service.start('when-idle', 'operator')).outcome).toBe('in-progress');
    expect((await busy.service.start('now', 'operator')).outcome).toBe('in-progress');

    const waiting = harness({ turns: () => 1 });
    await waiting.service.start('when-idle', 'operator');
    expect((await waiting.service.start('when-idle', 'machine:desk')).outcome).toBe('in-progress');
    const escalated = await waiting.service.start('now', 'machine:desk');
    expect(escalated.outcome).toBe('escalated');
    expect(escalated.job.mode).toBe('now');
    await flush();
    expect(waiting.runCommand).toHaveBeenCalled();
  });

  it('a finished job does not block a new start', async () => {
    const h = harness();
    await h.service.start('now', 'operator');
    await flush();
    expect(h.job().phase).toBe('done');
    const again = await h.service.start('now', 'operator');
    expect(again.outcome).toBe('started');
    expect(again.job.id).not.toBe('id-1');
  });

  it('cancel only works while waiting', async () => {
    const h = harness({ turns: () => 1 });
    await h.service.start('when-idle', 'operator');
    await flush();
    const cancelled = await h.service.cancel();
    expect(cancelled?.phase).toBe('cancelled');
    expect(component(cancelled!, 'claude')).toMatchObject({ status: 'skipped', detail: 'cancelled' });
    expect(component(cancelled!, 'muse').detail).toBe('Overdeck does not update Muse Code');
    await vi.advanceTimersByTimeAsync(TURN_POLL_MS * 3);
    expect(h.runCommand).not.toHaveBeenCalled();
    expect(await h.service.cancel()).toBeNull();

    const busy = harness({ run: () => new Promise(() => undefined) });
    await busy.service.start('now', 'operator');
    await flush();
    expect(await busy.service.cancel()).toBeNull();
    expect(busy.job().phase).toBe('updating');
  });
});
