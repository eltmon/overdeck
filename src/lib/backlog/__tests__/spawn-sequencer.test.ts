import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/agents.js', () => ({
  spawnRun: vi.fn().mockResolvedValue({ id: 'sequencer-runner', role: 'sequencer' }),
  determineModel: vi.fn().mockReturnValue('claude-opus-4-8'),
  getAgentState: vi.fn().mockReturnValue(null),
  getAgentRuntimeStateSync: vi.fn().mockReturnValue(null),
  stopAgent: vi.fn(),
}));

vi.mock('../../agents/liveness.js', () => ({
  isAlive: vi.fn().mockResolvedValue({ alive: false, reason: 'no-session' }),
  isConfirmedDead: (v: { alive: boolean; reason?: string }) => !v.alive && v.reason !== 'runtime-indeterminate',
  idleAgeMs: vi.fn().mockReturnValue(null),
}));

vi.mock('../../terminal-backends/launch.js', () => ({
  agentPaneExists: vi.fn().mockResolvedValue(false),
  closeAgentPane: vi.fn().mockResolvedValue(false),
}));

vi.mock('../backlog-input.js', () => ({
  normalizeBacklogIssues: vi.fn((raw) => raw),
  collectOpenBacklog: vi.fn().mockResolvedValue({
    manifest: [{ id: 'PAN-1', title: 'Test', labels: [], priority: 1, ageMs: 0, inPipeline: false, hasPrd: false, ready: false }],
    bodies: { count: 1, getBatch: () => [] },
    priorSequence: null,
  }),
}));

vi.mock('node:fs', () => ({ existsSync: vi.fn(), statSync: vi.fn() }));

import { existsSync, statSync } from 'node:fs';
import {
  clearFinishedSequencerRun,
  getSequencerRunStatus,
  spawnSequencerAgent,
  SEQUENCER_AGENT_ID,
} from '../sequencer-agent.js';
import {
  spawnRun,
  determineModel,
  getAgentState,
  getAgentRuntimeStateSync,
} from '../../../lib/agents.js';
import { idleAgeMs, isAlive } from '../../agents/liveness.js';
import { FINISHED_IDLE_MIN_AGE_MS, FINISHED_REPROBE_DELAY_MS } from '../../agents/warm-idle-reap.js';

const livePane = () => vi.mocked(isAlive).mockResolvedValue({ alive: true, paneAlive: true });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAlive).mockResolvedValue({ alive: false, reason: 'no-session' });
  vi.mocked(idleAgeMs).mockReturnValue(null);
});

const STALE_WORK_MS = FINISHED_IDLE_MIN_AGE_MS + 1_000;

describe('spawnSequencerAgent', () => {
  it('honors the persistent pause before collecting or spawning background work', async () => {
    vi.mocked(getAgentState).mockReturnValueOnce({ paused: true } as never);
    const { collectOpenBacklog } = await import('../backlog-input.js');
    await expect(spawnSequencerAgent('incremental', { issues: [] })).rejects.toThrow('Sequencer is paused');
    expect(collectOpenBacklog).not.toHaveBeenCalled();
    expect(spawnRun).not.toHaveBeenCalled();
  });

  it('honors a pause applied while preparing a pass', async () => {
    vi.mocked(getAgentState).mockReturnValueOnce(null).mockReturnValueOnce({ paused: true } as never);
    await expect(spawnSequencerAgent('review', { projectRoot: '/tmp/proj', issues: [] })).rejects.toThrow('Sequencer is paused');
    expect(spawnRun).not.toHaveBeenCalled();
  });

  it('resolves to creation pass when no sequence.md exists', async () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    await spawnSequencerAgent('auto', { projectRoot: '/tmp/proj', projectKey: 'overdeck' });
    expect(spawnRun).toHaveBeenCalledWith(
      SEQUENCER_AGENT_ID,
      'sequencer',
      expect.objectContaining({ agentId: SEQUENCER_AGENT_ID }),
    );
    const prompt = (spawnRun as ReturnType<typeof vi.fn>).mock.calls[0][2].prompt as string;
    expect(prompt).toContain('CREATION pass');
  });

  it('resolves to incremental pass when sequence.md exists', async () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    await spawnSequencerAgent('auto', { projectRoot: '/tmp/proj', projectKey: 'overdeck' });
    const prompt = (spawnRun as ReturnType<typeof vi.fn>).mock.calls[0][2].prompt as string;
    expect(prompt).toContain('INCREMENTAL pass');
  });

  it('downgrades an explicit incremental pass to creation when no sequence.md exists', async () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    await spawnSequencerAgent('incremental', { projectRoot: '/tmp/proj', projectKey: 'overdeck' });
    const prompt = (spawnRun as ReturnType<typeof vi.fn>).mock.calls[0][2].prompt as string;
    expect(prompt).toContain('CREATION pass');
  });

  it('refuses to spawn when the backlog manifest is empty', async () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const { collectOpenBacklog } = await import('../backlog-input.js');
    (collectOpenBacklog as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      manifest: [],
      bodies: { count: 0, getBatch: () => [] },
      priorSequence: null,
    });
    await expect(
      spawnSequencerAgent('creation', { projectRoot: '/tmp/proj', projectKey: 'overdeck', issues: [] }),
    ).rejects.toThrow(/refusing to spawn: backlog manifest is empty/);
    expect(spawnRun).not.toHaveBeenCalled();
  });

  it('accepts explicit review pass regardless of sequence.md state', async () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    await spawnSequencerAgent('review', { projectRoot: '/tmp/proj', projectKey: 'overdeck' });
    const prompt = (spawnRun as ReturnType<typeof vi.fn>).mock.calls[0][2].prompt as string;
    expect(prompt).toContain('REVIEW pass');
  });

  it('resolves model from roles.sequencer.model via determineModel', async () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    await spawnSequencerAgent('creation', { projectRoot: '/tmp/proj', projectKey: 'overdeck' });
    expect(determineModel).toHaveBeenCalledWith(expect.objectContaining({ role: 'sequencer' }));
  });

  it('spawns with allowHost=true and registerConversation=true', async () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    await spawnSequencerAgent('creation', { projectRoot: '/tmp/proj', projectKey: 'overdeck' });
    expect(spawnRun).toHaveBeenCalledWith(
      expect.any(String),
      'sequencer',
      expect.objectContaining({ allowHost: true, registerConversation: true }),
    );
  });

  it('prompt references the backlog manifest built from collectOpenBacklog', async () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    await spawnSequencerAgent('creation', { projectRoot: '/tmp/proj', projectKey: 'overdeck' });
    const { collectOpenBacklog } = await import('../backlog-input.js');
    expect(collectOpenBacklog).toHaveBeenCalled();
    const prompt = (spawnRun as ReturnType<typeof vi.fn>).mock.calls[0][2].prompt as string;
    // PAN-1866: the backlog is written to .pan/backlog/manifest.json and the
    // prompt references it by count + instructs reading bodies via `gh issue view`,
    // rather than inlining issue IDs/titles into the prompt.
    expect(prompt).toContain('Backlog manifest (1 open issue');
    expect(prompt).toContain('gh issue view');
  });

  it('passes provided issues to collectOpenBacklog instead of an empty array', async () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const issues = [
      { id: '42', ref: 'PAN-42', title: 'Real Issue', description: 'body', state: 'open', labels: [], tracker: 'github', url: '' },
    ] as Parameters<typeof spawnSequencerAgent>[1]['issues'];
    await spawnSequencerAgent('creation', { projectRoot: '/tmp/proj', issues });
    const { collectOpenBacklog } = await import('../backlog-input.js');
    expect(collectOpenBacklog).toHaveBeenCalledWith(
      '/tmp/proj',
      issues,
    );
  });

  it('treats a live sequencer with fresh sequence.md as done', async () => {
    livePane();
    (getAgentState as ReturnType<typeof vi.fn>).mockReturnValue({ startedAt: '2026-01-01T00:00:00.000Z' });
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (statSync as ReturnType<typeof vi.fn>).mockReturnValue({ mtimeMs: new Date('2026-01-01T00:00:01.000Z').getTime() });

    expect(await getSequencerRunStatus('/tmp/proj')).toMatchObject({
      alive: true,
      running: false,
      done: true,
      doneReason: 'fresh-sequence',
    });
  });

  it('clears a finished lingering sequencer before a retry', async () => {
    livePane();
    (getAgentState as ReturnType<typeof vi.fn>).mockReturnValue({ startedAt: '2026-01-01T00:00:00.000Z' });
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (statSync as ReturnType<typeof vi.fn>).mockReturnValue({ mtimeMs: new Date('2026-01-01T00:00:01.000Z').getTime() });

    const stop = vi.fn().mockResolvedValue(undefined);

    await clearFinishedSequencerRun('/tmp/proj', stop);

    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not clear an active sequencer pass', async () => {
    livePane();
    (getAgentState as ReturnType<typeof vi.fn>).mockReturnValue({ startedAt: '2026-01-01T00:00:01.000Z' });
    (getAgentRuntimeStateSync as ReturnType<typeof vi.fn>).mockReturnValue({ state: 'active' });
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (statSync as ReturnType<typeof vi.fn>).mockReturnValue({ mtimeMs: new Date('2026-01-01T00:00:00.000Z').getTime() });

    const stop = vi.fn().mockResolvedValue(undefined);

    await clearFinishedSequencerRun('/tmp/proj', stop);

    expect(stop).not.toHaveBeenCalled();
  });

  // PAN-4172: the mirror's idle label is only a hint, judged by the same rule
  // as Herdr's (isFinishedRoleRun): a one-shot run with stale work activity.
  it('keeps a live sequencer running when the mirror reads idle but work activity is fresh', async () => {
    livePane();
    vi.mocked(idleAgeMs).mockReturnValue(5_000);
    (getAgentState as ReturnType<typeof vi.fn>).mockReturnValue({ role: 'sequencer', status: 'running', startedAt: '2026-01-01T00:00:01.000Z' });
    (getAgentRuntimeStateSync as ReturnType<typeof vi.fn>).mockReturnValue({ state: 'idle' });
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    expect(await getSequencerRunStatus('/tmp/proj')).toMatchObject({
      alive: true,
      running: true,
      done: false,
      doneReason: null,
    });
  });

  it('treats a live sequencer the mirror reads idle, with stale work activity, as done without a fresh sequence file', async () => {
    livePane();
    vi.mocked(idleAgeMs).mockReturnValue(STALE_WORK_MS);
    (getAgentState as ReturnType<typeof vi.fn>).mockReturnValue({ role: 'sequencer', status: 'running', startedAt: '2026-01-01T00:00:01.000Z' });
    (getAgentRuntimeStateSync as ReturnType<typeof vi.fn>).mockReturnValue({ state: 'idle' });
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    expect(await getSequencerRunStatus('/tmp/proj')).toMatchObject({
      alive: true,
      running: false,
      done: true,
      doneReason: 'idle',
    });
  });

  it('lets a Herdr unknown state win over an idle mirror', async () => {
    vi.mocked(isAlive).mockResolvedValue({ alive: true, paneAlive: true, backendState: 'unknown' });
    vi.mocked(idleAgeMs).mockReturnValue(STALE_WORK_MS);
    (getAgentState as ReturnType<typeof vi.fn>).mockReturnValue({ role: 'sequencer', status: 'running', startedAt: '2026-01-01T00:00:01.000Z' });
    (getAgentRuntimeStateSync as ReturnType<typeof vi.fn>).mockReturnValue({ state: 'idle' });
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    expect(await getSequencerRunStatus('/tmp/proj')).toMatchObject({ running: true, done: false, doneReason: null });
  });

  it('treats a pane whose harness exited as present and done', async () => {
    vi.mocked(isAlive).mockResolvedValue({ alive: false, reason: 'pane-dead' });
    (getAgentState as ReturnType<typeof vi.fn>).mockReturnValue({ startedAt: '2026-01-01T00:00:01.000Z' });
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    expect(await getSequencerRunStatus('/tmp/proj')).toMatchObject({
      alive: true,
      running: false,
      done: true,
      doneReason: 'pane-dead',
    });
  });

  // PAN-3923: the runtime mirror is in-process (empty after a dashboard
  // restart) and a failed pass writes no sequence, so the backend's own state
  // has to be able to say "finished".
  it('treats a Herdr pane idle at its prompt after delivery, with stale work activity, as done with no mirror or fresh file', async () => {
    vi.mocked(isAlive).mockResolvedValue({ alive: true, paneAlive: true, backendState: 'idle' });
    vi.mocked(idleAgeMs).mockReturnValue(STALE_WORK_MS);
    (getAgentState as ReturnType<typeof vi.fn>).mockReturnValue({ role: 'sequencer', status: 'running', startedAt: '2026-01-01T00:00:01.000Z' });
    (getAgentRuntimeStateSync as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    expect(await getSequencerRunStatus('/tmp/proj')).toMatchObject({
      alive: true,
      running: false,
      done: true,
      doneReason: 'pane-finished',
    });
  });

  it('keeps a Herdr pane running while it works, before its prompt is delivered, or while its work activity is fresh', async () => {
    (getAgentRuntimeStateSync as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const cases = [
      ['working', 'running', STALE_WORK_MS],
      ['blocked', 'running', STALE_WORK_MS],
      ['idle', 'starting', STALE_WORK_MS],
      ['idle', 'running', 5_000],
      ['done', 'running', null],
    ] as const;
    for (const [backendState, status, idleAge] of cases) {
      vi.mocked(isAlive).mockResolvedValue({ alive: true, paneAlive: true, backendState });
      vi.mocked(idleAgeMs).mockReturnValue(idleAge);
      (getAgentState as ReturnType<typeof vi.fn>).mockReturnValue({ role: 'sequencer', status, startedAt: '2026-01-01T00:00:01.000Z' });
      expect(await getSequencerRunStatus('/tmp/proj')).toMatchObject({ alive: true, running: true, done: false, doneReason: null });
    }
  });

  describe('clearing a Herdr pane that reads finished (two probes)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      (getAgentRuntimeStateSync as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      (getAgentState as ReturnType<typeof vi.fn>).mockReturnValue({ role: 'sequencer', status: 'running', startedAt: '2026-01-01T00:00:01.000Z' });
      vi.mocked(idleAgeMs).mockReturnValue(STALE_WORK_MS);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('stops it only after a second probe a few seconds later still reads idle', async () => {
      vi.mocked(isAlive).mockResolvedValue({ alive: true, paneAlive: true, backendState: 'idle' });
      const stop = vi.fn().mockResolvedValue(undefined);

      const pending = clearFinishedSequencerRun('/tmp/proj', stop);
      await vi.advanceTimersByTimeAsync(FINISHED_REPROBE_DELAY_MS - 1);
      expect(stop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await pending;

      expect(isAlive).toHaveBeenCalledTimes(2);
      expect(stop).toHaveBeenCalledOnce();
    });

    it('keeps it when the second probe reads working', async () => {
      vi.mocked(isAlive)
        .mockResolvedValueOnce({ alive: true, paneAlive: true, backendState: 'idle' })
        .mockResolvedValueOnce({ alive: true, paneAlive: true, backendState: 'working' });
      const stop = vi.fn().mockResolvedValue(undefined);

      const pending = clearFinishedSequencerRun('/tmp/proj', stop);
      await vi.advanceTimersByTimeAsync(FINISHED_REPROBE_DELAY_MS);
      const status = await pending;

      expect(status).toMatchObject({ done: false, running: true });
      expect(stop).not.toHaveBeenCalled();
    });
  });

  describe('clearing a pane the mirror reads idle (two probes)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      livePane();
      (getAgentRuntimeStateSync as ReturnType<typeof vi.fn>).mockReturnValue({ state: 'idle' });
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      (getAgentState as ReturnType<typeof vi.fn>).mockReturnValue({ role: 'sequencer', status: 'running', startedAt: '2026-01-01T00:00:01.000Z' });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('stops it only after work activity is still stale on a second probe', async () => {
      vi.mocked(idleAgeMs).mockReturnValue(STALE_WORK_MS);
      const stop = vi.fn().mockResolvedValue(undefined);

      const pending = clearFinishedSequencerRun('/tmp/proj', stop);
      await vi.advanceTimersByTimeAsync(FINISHED_REPROBE_DELAY_MS - 1);
      expect(stop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await pending;

      expect(isAlive).toHaveBeenCalledTimes(2);
      expect(stop).toHaveBeenCalledOnce();
    });

    it('keeps it when work activity is fresh on the second probe', async () => {
      vi.mocked(idleAgeMs).mockReturnValueOnce(STALE_WORK_MS).mockReturnValueOnce(5_000);
      const stop = vi.fn().mockResolvedValue(undefined);

      const pending = clearFinishedSequencerRun('/tmp/proj', stop);
      await vi.advanceTimersByTimeAsync(FINISHED_REPROBE_DELAY_MS);
      const status = await pending;

      expect(status).toMatchObject({ done: false, running: true });
      expect(stop).not.toHaveBeenCalled();
    });
  });

  it('reaps a finished lingering pass before spawning the next one', async () => {
    // The auto-trigger reaches spawnSequencerAgent directly (never the route),
    // so the reap has to live inside the spawn itself.
    livePane();
    (getAgentState as ReturnType<typeof vi.fn>).mockReturnValue({ startedAt: '2026-01-01T00:00:00.000Z' });
    (getAgentRuntimeStateSync as ReturnType<typeof vi.fn>).mockReturnValue({ state: 'idle' });
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (statSync as ReturnType<typeof vi.fn>).mockReturnValue({ mtimeMs: new Date('2026-01-01T00:00:01.000Z').getTime() });

    const order: string[] = [];
    const stop = vi.fn(async () => { order.push('stop'); });
    vi.mocked(spawnRun).mockImplementationOnce(async () => { order.push('spawn'); return { id: SEQUENCER_AGENT_ID, role: 'sequencer' } as never; });

    await spawnSequencerAgent('incremental', { projectRoot: '/tmp/proj', issues: [], stopFinishedRun: stop });

    expect(order).toEqual(['stop', 'spawn']);
  });

  it('does not reap an active pass before spawning', async () => {
    livePane();
    (getAgentState as ReturnType<typeof vi.fn>).mockReturnValue({ startedAt: '2026-01-01T00:00:01.000Z' });
    (getAgentRuntimeStateSync as ReturnType<typeof vi.fn>).mockReturnValue({ state: 'active' });
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (statSync as ReturnType<typeof vi.fn>).mockReturnValue({ mtimeMs: new Date('2026-01-01T00:00:00.000Z').getTime() });

    const stop = vi.fn().mockResolvedValue(undefined);
    await spawnSequencerAgent('incremental', { projectRoot: '/tmp/proj', issues: [], stopFinishedRun: stop });

    expect(stop).not.toHaveBeenCalled();
  });
});
