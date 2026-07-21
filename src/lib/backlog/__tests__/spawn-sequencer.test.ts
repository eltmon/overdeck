import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/agents.js', () => ({
  spawnRun: vi.fn().mockResolvedValue({ id: 'sequencer-runner', role: 'sequencer' }),
  determineModel: vi.fn().mockReturnValue('claude-opus-4-8'),
  listRunningAgentsSync: vi.fn().mockReturnValue([]),
  getAgentStateSync: vi.fn().mockReturnValue(null),
  getAgentRuntimeStateSync: vi.fn().mockReturnValue(null),
  stopAgent: vi.fn(),
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
  listRunningAgentsSync,
  getAgentStateSync,
  getAgentRuntimeStateSync,
} from '../../../lib/agents.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('spawnSequencerAgent', () => {
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

  it('treats a live sequencer with fresh sequence.md as done', () => {
    (listRunningAgentsSync as ReturnType<typeof vi.fn>).mockReturnValue([{ id: SEQUENCER_AGENT_ID, tmuxActive: true }]);
    (getAgentStateSync as ReturnType<typeof vi.fn>).mockReturnValue({ startedAt: '2026-01-01T00:00:00.000Z' });
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (statSync as ReturnType<typeof vi.fn>).mockReturnValue({ mtimeMs: new Date('2026-01-01T00:00:01.000Z').getTime() });

    expect(getSequencerRunStatus('/tmp/proj')).toMatchObject({
      alive: true,
      running: false,
      done: true,
      doneReason: 'fresh-sequence',
    });
  });

  it('clears a finished lingering sequencer before a retry', async () => {
    (listRunningAgentsSync as ReturnType<typeof vi.fn>).mockReturnValue([{ id: SEQUENCER_AGENT_ID, tmuxActive: true }]);
    (getAgentStateSync as ReturnType<typeof vi.fn>).mockReturnValue({ startedAt: '2026-01-01T00:00:00.000Z' });
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (statSync as ReturnType<typeof vi.fn>).mockReturnValue({ mtimeMs: new Date('2026-01-01T00:00:01.000Z').getTime() });

    const stop = vi.fn().mockResolvedValue(undefined);

    await clearFinishedSequencerRun('/tmp/proj', stop);

    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not clear an active sequencer pass', async () => {
    (listRunningAgentsSync as ReturnType<typeof vi.fn>).mockReturnValue([{ id: SEQUENCER_AGENT_ID, tmuxActive: true }]);
    (getAgentStateSync as ReturnType<typeof vi.fn>).mockReturnValue({ startedAt: '2026-01-01T00:00:01.000Z' });
    (getAgentRuntimeStateSync as ReturnType<typeof vi.fn>).mockReturnValue({ state: 'active' });
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (statSync as ReturnType<typeof vi.fn>).mockReturnValue({ mtimeMs: new Date('2026-01-01T00:00:00.000Z').getTime() });

    const stop = vi.fn().mockResolvedValue(undefined);

    await clearFinishedSequencerRun('/tmp/proj', stop);

    expect(stop).not.toHaveBeenCalled();
  });

  it('treats an idle live sequencer as done even without a fresh sequence file', () => {
    (listRunningAgentsSync as ReturnType<typeof vi.fn>).mockReturnValue([{ id: SEQUENCER_AGENT_ID, tmuxActive: true }]);
    (getAgentStateSync as ReturnType<typeof vi.fn>).mockReturnValue({ startedAt: '2026-01-01T00:00:01.000Z' });
    (getAgentRuntimeStateSync as ReturnType<typeof vi.fn>).mockReturnValue({ state: 'idle' });
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    expect(getSequencerRunStatus('/tmp/proj')).toMatchObject({
      alive: true,
      running: false,
      done: true,
      doneReason: 'idle',
    });
  });
});
