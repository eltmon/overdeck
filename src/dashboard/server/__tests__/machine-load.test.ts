/** PAN-4651 WI-2 (D-4651-8): the load sampler and its place in the heartbeat. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { heartbeatPayload, setHeartbeatMachineFactsSource } from '../services/link-heartbeat.js';
import {
  currentMachineLoad,
  LOAD_SAMPLE_INTERVAL_MS,
  type MachineLoadDeps,
  sampleMachineLoad,
  startMachineLoadSampler,
  stopMachineLoadSampler,
} from '../services/machine-load.js';

function deps(overrides: Partial<MachineLoadDeps> = {}): MachineLoadDeps {
  return {
    assessCpu: async () => ({ saturated: false, psiSomeAvg10: 3.2 }),
    memAvailableBytes: async () => 41 * 2 ** 30,
    workingAgents: async () => 2,
    now: () => new Date(),
    env: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
});

afterEach(() => {
  stopMachineLoadSampler();
  setHeartbeatMachineFactsSource(null);
  vi.useRealTimers();
});

describe('machine load sample (D-4651-8)', () => {
  it('combines CPU pressure, available memory and working agents', async () => {
    expect(await sampleMachineLoad(deps())).toEqual({
      cpuPsiSomeAvg10: 3.2, cpuSaturated: false, memAvailableBytes: 41 * 2 ** 30, workingAgents: 2, sampledAt: '2026-11-01T12:00:00.000Z',
    });
  });

  it('a failing reader yields its unknown value', async () => {
    const sample = await sampleMachineLoad(deps({
      assessCpu: async () => { throw new Error('no psi'); },
      memAvailableBytes: async () => { throw new Error('no meminfo'); },
      workingAgents: async () => { throw new Error('no directory'); },
    }));
    expect(sample).toMatchObject({ cpuPsiSomeAvg10: null, cpuSaturated: false, memAvailableBytes: null, workingAgents: 0 });
  });

  it('OVERDECK_TEST_FORCE_CPU_SATURATED=1 forces cpuSaturated (smoke hook)', async () => {
    expect((await sampleMachineLoad(deps({ env: { OVERDECK_TEST_FORCE_CPU_SATURATED: '1' } }))).cpuSaturated).toBe(true);
  });

  it('samples at start and every 15 s; the heartbeat carries the last sample without waiting', async () => {
    let working = 1;
    startMachineLoadSampler(deps({ workingAgents: async () => working }));
    await vi.advanceTimersByTimeAsync(0);
    expect(currentMachineLoad()?.workingAgents).toBe(1);
    working = 4;
    await vi.advanceTimersByTimeAsync(LOAD_SAMPLE_INTERVAL_MS);
    expect(currentMachineLoad()?.workingAgents).toBe(4);
    setHeartbeatMachineFactsSource(() => ({ load: currentMachineLoad() ?? undefined, tags: ['docker', 'linux'], placement: 'on-request' }));
    expect(heartbeatPayload(7, '0.73.0')).toMatchObject({ seq: 7, load: { workingAgents: 4 }, tags: ['docker', 'linux'], placement: 'on-request' });
  });

  it('a beat without a machine source carries none of the fields', () => {
    const payload = heartbeatPayload(1, '0.73.0');
    expect(payload).not.toHaveProperty('load');
    expect(payload).not.toHaveProperty('tags');
    expect(payload).not.toHaveProperty('placement');
  });
});
