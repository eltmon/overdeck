import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/agents.js', () => ({
  spawnRun: vi.fn().mockResolvedValue({ id: 'sequencer-runner', role: 'sequencer' }),
  determineModel: vi.fn().mockReturnValue('claude-opus-4-8'),
}));

vi.mock('../backlog-input.js', () => ({
  normalizeBacklogIssues: vi.fn((raw) => raw),
  collectOpenBacklog: vi.fn().mockResolvedValue({
    manifest: [{ id: 'PAN-1', title: 'Test', labels: [], priority: 1, ageMs: 0, inPipeline: false, hasPrd: false, ready: false }],
    bodies: { count: 1, getBatch: () => [] },
    priorSequence: null,
  }),
}));

vi.mock('node:fs', () => ({ existsSync: vi.fn() }));

import { existsSync } from 'node:fs';
import { spawnSequencerAgent, SEQUENCER_AGENT_ID } from '../sequencer-agent.js';
import { spawnRun, determineModel } from '../../../lib/agents.js';

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

  it('prompt contains backlog input from collectOpenBacklog', async () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    await spawnSequencerAgent('creation', { projectRoot: '/tmp/proj', projectKey: 'overdeck' });
    const prompt = (spawnRun as ReturnType<typeof vi.fn>).mock.calls[0][2].prompt as string;
    expect(prompt).toContain('PAN-1');
    expect(prompt).toContain('Test');
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
});
