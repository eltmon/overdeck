import { describe, it, expect } from 'vitest';
import { derivePipeline, describePipeline, type PipeSegState, type PipelineFeature } from './pipelineStrip';

function makeFeature(overrides?: Partial<PipelineFeature>): PipelineFeature {
  return {
    stateLabel: 'In Progress',
    hasPlanning: false,
    ...overrides,
  };
}

describe('describePipeline', () => {
  it('describes an all-none pipeline as not started', () => {
    const segments: PipeSegState[] = ['none', 'none', 'none', 'none', 'none'];
    expect(describePipeline(segments)).toBe(
      'Not started — plan pending · work pending · review pending · test pending · merge pending',
    );
  });

  it('names the current step for a running review', () => {
    const segments: PipeSegState[] = ['done', 'done', 'working', 'none', 'none'];
    expect(describePipeline(segments)).toBe(
      'Step 3 of 5: review (running) — plan done · work done · review running · test pending · merge pending',
    );
  });

  it('starts with Step 5 of 5: merge (merged) when fully merged', () => {
    const segments: PipeSegState[] = ['done', 'done', 'done', 'done', 'merged'];
    expect(describePipeline(segments).startsWith('Step 5 of 5: merge (merged)')).toBe(true);
  });

  it('describes an error segment as failed', () => {
    const segments: PipeSegState[] = ['done', 'working', 'error', 'none', 'none'];
    expect(describePipeline(segments)).toContain('review (failed)');
  });
});

describe('derivePipeline', () => {
  it('returns all done + merged for a done feature', () => {
    const feature = makeFeature({ stateLabel: 'Done' });
    expect(derivePipeline(feature, [])).toEqual(['done', 'done', 'done', 'done', 'merged']);
  });
});
