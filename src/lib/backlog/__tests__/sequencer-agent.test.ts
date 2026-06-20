import { describe, it, expect } from 'vitest';
import { buildSequencerPrompt } from '../sequencer-agent.js';
import type { CollectOpenBacklogResult } from '../backlog-input.js';

const MANIFEST_ENTRY = {
  id: 'PAN-1',
  title: 'Issue One',
  labels: [],
  priority: 1,
  ageMs: 86400000,
  inPipeline: false,
  hasPrd: false,
  ready: false,
  updatedAt: '2026-06-19T12:00:00Z',
};

const EMPTY_INPUT: CollectOpenBacklogResult = {
  manifest: [MANIFEST_ENTRY],
  bodies: { count: 1, getBatch: () => [{ id: 'PAN-1', body: 'Body.' }] },
  priorSequence: null,
};

const INPUT_WITH_PRIOR: CollectOpenBacklogResult = {
  ...EMPTY_INPUT,
  priorSequence: {
    version: 1, project: 'overdeck', generatedAt: '2026-06-18T00:00:00Z',
    model: 'claude-opus-4-8', pass: 'creation', openCount: 1,
    nodes: [{ issue: 'PAN-1', rank: 1, size: 'M', importance: 'high', score: 80, condition: 'ok', dependsOn: [], why: 'Core.', gate: 'auto', planning: 'auto' }],
    edges: [],
  },
};

describe('buildSequencerPrompt', () => {
  it('incremental pass contains preserve-prior-order instruction', () => {
    const prompt = buildSequencerPrompt('incremental', {
      projectRoot: '/tmp/proj', projectKey: 'overdeck', input: INPUT_WITH_PRIOR,
    });
    expect(prompt).toContain('Preserve existing ranks');
    expect(prompt).toContain('operator-owned fields');
    expect(prompt).toContain('operator-sourced edges VERBATIM');
  });

  it('incremental pass instructs agent to use updatedAt to identify changed issues', () => {
    const prompt = buildSequencerPrompt('incremental', {
      projectRoot: '/tmp/proj', projectKey: 'overdeck', input: INPUT_WITH_PRIOR,
    });
    expect(prompt).toContain('updatedAt');
    expect(prompt).toContain('generatedAt');
    expect(prompt).toContain('2026-06-18T00:00:00Z');
    expect(prompt).toContain('Read bodies ONLY for those issues');
  });

  it('creation pass instructs batched body reads and forbids inlining', () => {
    const prompt = buildSequencerPrompt('creation', {
      projectRoot: '/tmp/proj', projectKey: 'overdeck', input: EMPTY_INPUT,
    });
    expect(prompt).toContain('NEVER request all bodies at once');
    expect(prompt).toContain('Read batch 0');
    expect(prompt).toContain('do NOT inline the entire backlog');
  });

  it('all passes contain condition assignment instruction', () => {
    for (const pass of ['creation', 'incremental', 'review'] as const) {
      const prompt = buildSequencerPrompt(pass, {
        projectRoot: '/tmp/proj', projectKey: 'overdeck', input: EMPTY_INPUT,
      });
      expect(prompt).toContain('condition');
      expect(prompt).toContain('ok / needs-refinement / stale');
    }
  });

  it('all passes contain operator gate/planning preservation instruction', () => {
    for (const pass of ['creation', 'incremental', 'review'] as const) {
      const prompt = buildSequencerPrompt(pass, {
        projectRoot: '/tmp/proj', projectKey: 'overdeck', input: EMPTY_INPUT,
      });
      expect(prompt).toContain('operator-owned gate and planning fields verbatim');
    }
  });

  it('all passes contain operator-sourced edge preservation instruction', () => {
    for (const pass of ['creation', 'incremental', 'review'] as const) {
      const prompt = buildSequencerPrompt(pass, {
        projectRoot: '/tmp/proj', projectKey: 'overdeck', input: EMPTY_INPUT,
      });
      expect(prompt).toContain('operator-sourced edges verbatim');
    }
  });

  it('all passes contain rank-by-impact instruction treating priority as input only', () => {
    for (const pass of ['creation', 'incremental', 'review'] as const) {
      const prompt = buildSequencerPrompt(pass, {
        projectRoot: '/tmp/proj', projectKey: 'overdeck', input: EMPTY_INPUT,
      });
      expect(prompt).toContain('Rank by IMPACT toward shipping');
      expect(prompt).toContain('GitHub priority and issue age are inputs, not determinants');
    }
  });

  it('review pass also forbids inlining', () => {
    const prompt = buildSequencerPrompt('review', {
      projectRoot: '/tmp/proj', projectKey: 'overdeck', input: INPUT_WITH_PRIOR,
    });
    expect(prompt).toContain('NEVER inline the entire backlog');
    expect(prompt).toContain('read them batch by batch');
  });
});
