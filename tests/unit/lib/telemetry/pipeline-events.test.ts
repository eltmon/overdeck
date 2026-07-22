import { describe, expect, it, vi } from 'vitest';
import {
  capturePipelineStage,
  resolvePipelineTelemetryContext,
  toTelemetryModelFamily,
  type PipelineTelemetryContext,
} from '../../../../src/lib/telemetry/pipeline.js';

const postHogConstructorMock = vi.hoisted(() => vi.fn(function PostHogMock() {
  return {
    capture: vi.fn(),
    shutdown: vi.fn(),
  };
}));

vi.mock('posthog-node', () => ({ PostHog: postHogConstructorMock }));

const context: PipelineTelemetryContext = {
  harness: 'claude-code',
  model: 'claude',
};

describe('pipeline telemetry events', () => {
  it('captures each funnel transition with enum-only properties', () => {
    const capture = vi.fn();

    capturePipelineStage('work_done', context, { capture });
    capturePipelineStage('review_passed', context, { capture });
    capturePipelineStage('verification_passed', context, { capture });
    capturePipelineStage('merged', context, { capture });
    capturePipelineStage('closed_out', context, { capture });

    expect(capture.mock.calls).toEqual([
      ['pipeline_stage_changed', { stage: 'work_done', ...context }],
      ['pipeline_stage_changed', { stage: 'review_passed', ...context }],
      ['pipeline_stage_changed', { stage: 'verification_passed', ...context }],
      ['pipeline_stage_changed', { stage: 'merged', ...context }],
      ['pipeline_stage_changed', { stage: 'closed_out', ...context }],
    ]);
    for (const [, properties] of capture.mock.calls) {
      expect(Object.keys(properties)).toEqual(['stage', 'harness', 'model']);
      expect(JSON.stringify(properties)).not.toContain('PAN-');
      expect(JSON.stringify(properties)).not.toContain('/');
    }
  });

  it('resolves harness and model family from the work agent only', () => {
    const readAgent = vi.fn(() => ({
      harness: 'codex',
      model: 'gpt-5.6-sol',
    }) as never);

    expect(resolvePipelineTelemetryContext('PAN-2599', readAgent)).toEqual({
      harness: 'codex',
      model: 'gpt',
    });
    expect(readAgent).toHaveBeenCalledWith('agent-pan-2599');
  });

  it('maps model names into the declared privacy-safe families', () => {
    expect(toTelemetryModelFamily('claude-sonnet-5')).toBe('claude');
    expect(toTelemetryModelFamily('gemini-3-pro')).toBe('gemini');
    expect(toTelemetryModelFamily('kimi-k2.5')).toBe('kimi');
    expect(toTelemetryModelFamily('minimax-m2.5')).toBe('minimax');
    expect(toTelemetryModelFamily('glm-5')).toBe('glm');
    expect(toTelemetryModelFamily('mimo-v2')).toBe('mimo');
    expect(toTelemetryModelFamily('local-model')).toBe('other');
  });

  it('does not construct PostHog when telemetry is test-disabled', () => {
    capturePipelineStage('merged', context);

    expect(postHogConstructorMock).not.toHaveBeenCalled();
  });

  it('does not leak telemetry failures into pipeline flows', () => {
    expect(() => capturePipelineStage('closed_out', context, {
      capture: () => { throw new Error('network failure'); },
    })).not.toThrow();
  });
});
