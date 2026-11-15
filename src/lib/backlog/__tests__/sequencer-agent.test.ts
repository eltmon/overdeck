import { describe, it, expect } from 'vitest';
import { backlogManifestKey, buildSequencerPrompt, manifestKeyFromText } from '../sequencer-agent.js';
import type { BacklogManifestEntry, CollectOpenBacklogResult } from '../backlog-input.js';

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

describe('backlogManifestKey (PAN-5357)', () => {
  const ENTRY_A: BacklogManifestEntry = {
    id: 'PAN-1', title: 'A', labels: ['x', 'y'], priority: 1, ageMs: 1000,
    inPipeline: false, hasPrd: false, ready: false, updatedAt: '2026-06-19T00:00:00Z', isEpic: false,
  };
  const ENTRY_B: BacklogManifestEntry = {
    id: 'PAN-2', title: 'B', labels: ['z'], priority: 2, ageMs: 2000,
    inPipeline: true, hasPrd: true, ready: true, updatedAt: '2026-06-18T00:00:00Z', isEpic: true, partOf: 'PAN-9',
  };

  it('ignores ageMs, entry order and label order', () => {
    const base = backlogManifestKey([ENTRY_A, ENTRY_B]);
    const differentAge = backlogManifestKey([{ ...ENTRY_A, ageMs: 999_999 }, ENTRY_B]);
    const reorderedEntries = backlogManifestKey([ENTRY_B, ENTRY_A]);
    const reorderedLabels = backlogManifestKey([{ ...ENTRY_A, labels: ['y', 'x'] }, ENTRY_B]);

    expect(differentAge).toBe(base);
    expect(reorderedEntries).toBe(base);
    expect(reorderedLabels).toBe(base);
  });

  it('changes when updatedAt changes', () => {
    const base = backlogManifestKey([ENTRY_A, ENTRY_B]);
    const changed = backlogManifestKey([{ ...ENTRY_A, updatedAt: '2026-06-20T00:00:00Z' }, ENTRY_B]);
    expect(changed).not.toBe(base);
  });
});

describe('manifestKeyFromText (PAN-5357)', () => {
  it('returns null for non-JSON text', () => {
    expect(manifestKeyFromText('not json')).toBeNull();
  });

  it('returns null for a JSON object (non-array)', () => {
    expect(manifestKeyFromText('{"id":"PAN-1"}')).toBeNull();
  });

  it('returns the manifest key for a JSON array', () => {
    const entries: BacklogManifestEntry[] = [{
      id: 'PAN-1', title: 'A', labels: [], priority: undefined, ageMs: 0,
      inPipeline: false, hasPrd: false, ready: false, updatedAt: '2026-06-19T00:00:00Z', isEpic: false,
    }];
    expect(manifestKeyFromText(JSON.stringify(entries))).toBe(backlogManifestKey(entries));
  });
});
