import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FLYWHEEL_REPORT_REQUEST,
  FLYWHEEL_STOP_REQUEST,
  abortFlywheel,
  pauseFlywheel,
  requestFlywheelReport,
  resumeFlywheel,
  startFlywheel,
  stopFlywheel,
  type FlywheelActionDeps,
} from '../../../../src/lib/flywheel/actions.js';
import {
  FlywheelAlreadyRunning,
  FlywheelNotRunning,
  FlywheelOrphanSession,
  FlywheelPausedExists,
} from '../../../../src/lib/flywheel/errors.js';
import type { LegacyConversation } from '../../../../src/lib/overdeck/conversations.js';

function conv(overrides: Partial<LegacyConversation> = {}): LegacyConversation {
  return {
    id: 1, name: 'conv-flywheel', tmuxSession: 'conv-flywheel', status: 'active', cwd: '/repos/overdeck', forkStatus: null,
    ...overrides,
  } as LegacyConversation;
}

type State = 'idle' | 'paused' | 'running';

function depsFor(state: State, overrides: FlywheelActionDeps = {}) {
  const calls = {
    sendKeys: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => {}),
    createConversation: vi.fn(),
    spawnSession: vi.fn(async () => {}),
    waitReady: vi.fn(async () => {}),
    killSession: vi.fn(async () => {}),
    stopConversation: vi.fn(async () => ({ status: 200 })),
    resumeConversation: vi.fn(async (): Promise<{ status: number; reattached?: boolean }> => ({ status: 200 })),
    rollbackStart: vi.fn(async () => {}),
  };
  const deps: FlywheelActionDeps = {
    getConversation: () => (state === 'idle' ? null : conv({ status: state === 'running' ? 'active' : 'ended' })),
    sessionAlive: async () => state === 'running',
    tmuxSessionExists: async () => state === 'running',
    resolveModelAndHarness: async (opts) => ({ model: opts.model ?? 'resolved-model', harness: 'claude-code' }),
    resolveProjectPath: (dir) => dir,
    resolvePlanHome: (dir) => dir,
    readTranscript: async () => [],
    ...calls,
    ...overrides,
  };
  return { deps, calls };
}

describe('startFlywheel (PAN-3964 FR-5, D5)', () => {
  it('creates the conversation, spawns it, and sends the skill with the book', async () => {
    const { deps, calls } = depsFor('idle');
    const result = await startFlywheel({ cwd: '/repos/overdeck', orders: 'book-1' }, deps);
    expect(result).toEqual({ session: 'conv-flywheel', harness: 'claude-code', model: 'resolved-model', prompt: '/pan-flywheel book-1', cwd: '/repos/overdeck' });
    expect(calls.createConversation).toHaveBeenCalledWith(expect.objectContaining({ name: 'conv-flywheel', cwd: '/repos/overdeck', model: 'resolved-model', harness: 'claude-code' }));
    expect(calls.spawnSession).toHaveBeenCalled();
    expect(calls.waitReady).toHaveBeenCalledWith('conv-flywheel', 'claude-code', 'spawn');
    expect(calls.sendKeys.mock.calls.map((c) => c[1])).toEqual(['/pan-flywheel book-1', 'Enter']);
  });

  it('refuses a running flywheel', async () => {
    const { deps, calls } = depsFor('running');
    await expect(startFlywheel({}, deps)).rejects.toBeInstanceOf(FlywheelAlreadyRunning);
    expect(calls.createConversation).not.toHaveBeenCalled();
  });

  it('refuses a paused flywheel without --fresh and keeps its row', async () => {
    const { deps, calls } = depsFor('paused');
    const error = await startFlywheel({}, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FlywheelPausedExists);
    expect((error as Error).message).toBe('paused flywheel exists — `pan flywheel resume` to continue, `pan flywheel start --fresh` to start over');
    expect(calls.createConversation).not.toHaveBeenCalled();
  });

  it('refuses a row-less orphan session with FlywheelOrphanSession, which names --fresh', async () => {
    const { deps, calls } = depsFor('idle', { tmuxSessionExists: async () => true });
    const error = await startFlywheel({}, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FlywheelOrphanSession);
    expect((error as Error).message).toContain('pan flywheel start --fresh');
    expect(calls.killSession).not.toHaveBeenCalled();
    expect(calls.createConversation).not.toHaveBeenCalled();
  });

  it('rolls back the conversation row when the session never comes up', async () => {
    const { deps, calls } = depsFor('idle', { spawnSession: vi.fn(async () => { throw new Error('spawn failed'); }) });
    await expect(startFlywheel({ cwd: '/repos/overdeck' }, deps)).rejects.toThrow('spawn failed');
    expect(calls.createConversation).toHaveBeenCalledOnce();
    expect(calls.rollbackStart).toHaveBeenCalledWith('conv-flywheel');
    expect(calls.sendKeys).not.toHaveBeenCalled();
  });

  it('treats an archived row (a rolled-back start) as idle, so the next start needs no --fresh', async () => {
    const { deps, calls } = depsFor('idle', { getConversation: () => conv({ status: 'ended', archivedAt: '2026-09-23T10:00:00.000Z' }) });
    await startFlywheel({ cwd: '/repos/overdeck' }, deps);
    expect(calls.createConversation).toHaveBeenCalledOnce();
  });

  it('replaces a paused flywheel with --fresh, killing a leftover session', async () => {
    const { deps, calls } = depsFor('paused', { tmuxSessionExists: async () => true });
    await startFlywheel({ fresh: true, cwd: '/repos/overdeck' }, deps);
    expect(calls.killSession).toHaveBeenCalledWith('conv-flywheel');
    expect(calls.createConversation).toHaveBeenCalled();
  });
});

describe('pause / abort / resume (D4)', () => {
  it('pause stops the conversation through the conversation stop path', async () => {
    const { deps, calls } = depsFor('running');
    await pauseFlywheel(deps);
    expect(calls.stopConversation).toHaveBeenCalledWith('conv-flywheel');
  });

  it('pause maps a missing row to FlywheelNotRunning', async () => {
    const { deps } = depsFor('idle', { stopConversation: async () => ({ status: 404 }) });
    await expect(pauseFlywheel(deps)).rejects.toBeInstanceOf(FlywheelNotRunning);
  });

  it('abort is a pause that never asks for a report', async () => {
    const { deps, calls } = depsFor('running');
    await abortFlywheel(deps);
    expect(calls.stopConversation).toHaveBeenCalledOnce();
    expect(calls.sendMessage).not.toHaveBeenCalled();
  });

  it('resume respawns the paused conversation and re-sends /pan-flywheel', async () => {
    const { deps, calls } = depsFor('paused');
    await resumeFlywheel(deps);
    expect(calls.resumeConversation).toHaveBeenCalledWith('conv-flywheel');
    expect(calls.sendKeys.mock.calls.map((c) => c[1])).toEqual(['/pan-flywheel', 'Enter']);
  });

  it('resume does not re-send the skill when the harness was already alive (reattached)', async () => {
    const { deps, calls } = depsFor('paused', { resumeConversation: async () => ({ status: 200, reattached: true }) });
    await resumeFlywheel(deps);
    expect(calls.sendKeys).not.toHaveBeenCalled();
  });

  it('resume refuses idle and running', async () => {
    await expect(resumeFlywheel(depsFor('idle').deps)).rejects.toBeInstanceOf(FlywheelNotRunning);
    await expect(resumeFlywheel(depsFor('running').deps)).rejects.toBeInstanceOf(FlywheelAlreadyRunning);
  });

  it('resume surfaces a respawn failure', async () => {
    const { deps, calls } = depsFor('paused', { resumeConversation: async () => ({ status: 500, error: 'spawn failed' }) });
    await expect(resumeFlywheel(deps)).rejects.toThrow('spawn failed');
    expect(calls.sendKeys).not.toHaveBeenCalled();
  });
});

describe('report / stop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('report sends the report request to the running loop', async () => {
    const { deps, calls } = depsFor('running');
    await requestFlywheelReport(deps);
    expect(calls.sendMessage).toHaveBeenCalledWith('conv-flywheel', FLYWHEEL_REPORT_REQUEST, 'pan flywheel report');
  });

  it('report refuses a paused flywheel', async () => {
    await expect(requestFlywheelReport(depsFor('paused').deps)).rejects.toBeInstanceOf(FlywheelNotRunning);
  });

  function stoppingTick(atMs: number) {
    return {
      role: 'assistant',
      text: 'Report committed and pushed.\nflywheel-tick: tick=9 pick=none phase=stopping in-flight=none needs-you=none',
      createdAt: new Date(atMs).toISOString(),
    };
  }

  it('stop waits for the phase=stopping tick, not the report mtime, then pauses', async () => {
    let transcript: Array<{ role: string; text: string; createdAt: string }> = [];
    let reportAt: string | null = null;
    const readReport = vi.fn(async () => ({ exists: reportAt !== null, path: '.pan/flywheel/report.md', content: reportAt ? '# r' : null, lastModified: reportAt }));
    const readTranscript = vi.fn(async () => transcript);
    const { deps, calls } = depsFor('running', { readReport, readTranscript });

    const pending = stopFlywheel({}, deps);
    await vi.waitFor(() => expect(calls.sendMessage).toHaveBeenCalledWith('conv-flywheel', FLYWHEEL_STOP_REQUEST, 'pan flywheel stop'));

    // The report file lands first (before git add/commit/push): not done yet.
    reportAt = new Date(Date.now() + 1_000).toISOString();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(readTranscript).toHaveBeenCalledTimes(1);
    expect(calls.stopConversation).not.toHaveBeenCalled();

    // An older stopping tick from a previous stop does not count.
    transcript = [stoppingTick(Date.now() - 60_000)];
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls.stopConversation).not.toHaveBeenCalled();

    transcript = [stoppingTick(Date.now())];
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toEqual({ reportWritten: true, stopped: true });
    expect(readTranscript).toHaveBeenCalledTimes(3);
    expect(calls.stopConversation).toHaveBeenCalledOnce();
  });

  it('stop reports reportWritten:false for a report older than the request', async () => {
    const stale = new Date('2026-09-22T00:00:00.000Z').toISOString();
    const readReport = vi.fn(async () => ({ exists: true, path: '.pan/flywheel/report.md', content: '# old', lastModified: stale }));
    const { deps } = depsFor('running', { readReport, readTranscript: async () => [stoppingTick(Date.now() + 1_000)] });

    const pending = stopFlywheel({ timeoutMs: 10_000 }, deps);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toEqual({ reportWritten: false, stopped: true });
  });

  it('stop pauses after the timeout when the loop never confirms', async () => {
    const readReport = vi.fn(async () => ({ exists: false, path: '.pan/flywheel/report.md', content: null, lastModified: null }));
    const readTranscript = vi.fn(async () => []);
    const { deps, calls } = depsFor('running', { readReport, readTranscript });

    const pending = stopFlywheel({}, deps);
    await vi.waitFor(() => expect(calls.sendMessage).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(120_000);

    await expect(pending).resolves.toEqual({ reportWritten: false, stopped: false });
    expect(readTranscript).toHaveBeenCalledTimes(24);
    expect(calls.stopConversation).toHaveBeenCalledOnce();
  });

  it('stop reads the report from the project root plan home, like the page', async () => {
    const readReport = vi.fn(async () => ({ exists: false, path: '.pan/flywheel/report.md', content: null, lastModified: null }));
    const { deps } = depsFor('running', {
      getConversation: () => conv({ cwd: '/repos/overdeck/workspaces/feature-pan-1' }),
      resolveProjectPath: () => '/repos/overdeck',
      resolvePlanHome: (root) => `${root}/plan-home`,
      readReport,
    });
    const pending = stopFlywheel({ timeoutMs: 5_000 }, deps);
    await vi.advanceTimersByTimeAsync(5_000);
    await pending;
    expect(readReport).toHaveBeenCalledWith('/repos/overdeck/plan-home');
  });

  it('stop refuses when the flywheel is not running', async () => {
    await expect(stopFlywheel({}, depsFor('idle').deps)).rejects.toBeInstanceOf(FlywheelNotRunning);
  });
});
