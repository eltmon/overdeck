import type { HealthReason, HealthState } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSystemHealthSampler,
  type AtomicHealthAssessment,
  type RawHealthAssessment,
} from '../sampler.js';

interface FixtureMetrics {
  sequence: number;
  availableMemoryBytes: number | null;
}

function reason(state: HealthState, sequence: number): HealthReason {
  return {
    code: `host.fixture.${state}.${sequence}`,
    domain: 'host',
    severity: state === 'critical' ? 'critical' : state === 'warning' ? 'warning' : 'info',
    message: `${state} fixture ${sequence}`,
  };
}

function valid(
  state: HealthState,
  sequence: number,
): RawHealthAssessment<FixtureMetrics> {
  const assessment: AtomicHealthAssessment<FixtureMetrics> = {
    state,
    reasons: [reason(state, sequence)],
    metrics: {
      sequence,
      availableMemoryBytes: sequence * 1024,
    },
    sampledAt: `2026-07-16T00:00:0${sequence}.000Z`,
  };
  return { status: 'valid', assessment };
}

function invalid(sequence: number): RawHealthAssessment<FixtureMetrics> {
  return {
    status: 'invalid',
    sampledAt: `2026-07-16T00:00:0${sequence}.000Z`,
    reason: {
      code: 'host.fixture.invalid',
      domain: 'host',
      severity: 'info',
      message: 'The fixture sample is invalid.',
    },
  };
}

function queueCollector(samples: RawHealthAssessment<FixtureMetrics>[]) {
  let index = 0;
  return vi.fn(async () => {
    const sample = samples[index++];
    if (!sample) throw new Error(`No fixture sample at index ${index - 1}`);
    return sample;
  });
}

async function flushImmediateSample(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('system health sampler', () => {
  it('returns measuring immediately and starts one collector for concurrent readers', async () => {
    const collect = queueCollector([
      valid('healthy', 1),
      valid('healthy', 2),
      valid('healthy', 3),
    ]);
    const sampler = createSystemHealthSampler({
      collect,
      measuringMetrics: { sequence: 0, availableMemoryBytes: null },
      pollIntervalMs: 15_000,
    });

    const first = sampler.getSnapshot();
    const second = sampler.getSnapshot();

    expect(first.state).toBe('measuring');
    expect(second).toEqual(first);
    expect(collect).toHaveBeenCalledTimes(1);

    await flushImmediateSample();
    expect(collect).toHaveBeenCalledTimes(1);
    sampler.stop();
  });

  it('publishes state, reasons, and metrics atomically on the third escalation sample', async () => {
    const transitions = vi.fn();
    const sampler = createSystemHealthSampler({
      collect: queueCollector([
        valid('warning', 1),
        valid('warning', 2),
        valid('warning', 3),
      ]),
      measuringMetrics: { sequence: 0, availableMemoryBytes: null },
      pollIntervalMs: 15_000,
      onTransition: transitions,
    });

    expect(sampler.getSnapshot()).toMatchObject({
      state: 'measuring',
      metrics: { sequence: 0 },
    });
    await flushImmediateSample();
    expect(sampler.getSnapshot()).toMatchObject({ state: 'measuring', metrics: { sequence: 0 } });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sampler.getSnapshot()).toMatchObject({ state: 'measuring', metrics: { sequence: 0 } });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sampler.getSnapshot()).toMatchObject({
      state: 'warning',
      reasons: [{ code: 'host.fixture.warning.3' }],
      metrics: { sequence: 3, availableMemoryBytes: 3 * 1024 },
      transitionVersion: 1,
    });
    expect(transitions).toHaveBeenCalledTimes(1);
    expect(transitions).toHaveBeenCalledWith({
      version: 1,
      previousState: 'measuring',
      state: 'warning',
      reasonCodes: ['host.fixture.warning.3'],
      acceptedAt: '2026-07-16T00:00:03.000Z',
    });
    sampler.stop();
  });

  it('requires three consecutive recovery samples and resets the candidate on invalid input', async () => {
    const transitions = vi.fn();
    const sampler = createSystemHealthSampler({
      collect: queueCollector([
        valid('warning', 1),
        valid('warning', 2),
        valid('warning', 3),
        valid('healthy', 4),
        valid('healthy', 5),
        invalid(6),
        valid('healthy', 7),
        valid('healthy', 8),
        valid('healthy', 9),
      ]),
      measuringMetrics: { sequence: 0, availableMemoryBytes: null },
      pollIntervalMs: 5_000,
      onTransition: transitions,
    });

    sampler.getSnapshot();
    await flushImmediateSample();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sampler.getSnapshot().state).toBe('warning');

    await vi.advanceTimersByTimeAsync(15_000);
    expect(sampler.getSnapshot()).toMatchObject({
      state: 'warning',
      metrics: { sequence: 3 },
      freshness: {
        status: 'stale',
        reason: { code: 'host.fixture.invalid' },
      },
    });
    expect(transitions).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(sampler.getSnapshot()).toMatchObject({
      state: 'healthy',
      reasons: [{ code: 'host.fixture.healthy.9' }],
      metrics: { sequence: 9 },
      transitionVersion: 2,
    });
    expect(transitions).toHaveBeenCalledTimes(2);
    sampler.stop();
  });

  it('refreshes an unchanged accepted state without emitting another transition', async () => {
    const transitions = vi.fn();
    const sampler = createSystemHealthSampler({
      collect: queueCollector([
        valid('healthy', 1),
        valid('healthy', 2),
        valid('healthy', 3),
        valid('healthy', 4),
      ]),
      measuringMetrics: { sequence: 0, availableMemoryBytes: null },
      pollIntervalMs: 10_000,
      onTransition: transitions,
    });

    sampler.getSnapshot();
    await flushImmediateSample();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(transitions).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(sampler.getSnapshot()).toMatchObject({
      state: 'healthy',
      reasons: [{ code: 'host.fixture.healthy.4' }],
      metrics: { sequence: 4 },
      transitionVersion: 1,
    });
    expect(transitions).toHaveBeenCalledTimes(1);
    sampler.stop();
  });

  it('uses one-second warm-up spacing before the configured steady-state interval', async () => {
    const collect = queueCollector([
      valid('healthy', 1),
      valid('healthy', 2),
      valid('healthy', 3),
      valid('healthy', 4),
    ]);
    const sampler = createSystemHealthSampler({
      collect,
      measuringMetrics: { sequence: 0, availableMemoryBytes: null },
      pollIntervalMs: 12_000,
    });

    sampler.getSnapshot();
    await flushImmediateSample();
    expect(collect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(collect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(collect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(collect).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(11_999);
    expect(collect).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(collect).toHaveBeenCalledTimes(4);
    sampler.stop();
  });
});
