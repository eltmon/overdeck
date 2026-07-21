import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createResourceSpikeSampler,
  type ResourceSpikeDetails,
  type ResourceSpikeSample,
} from '../../../../src/dashboard/server/routes/resources/spike-sampler.js';

const baseProcessGroups = [
  {
    label: 'vitest workers',
    cpuPercent: 740,
    count: 10,
    agentId: 'agent-pan-2341-test',
    issueId: 'PAN-2341',
    command: 'vitest',
    pids: [101, 102],
  },
  {
    label: 'mvn compile',
    cpuPercent: 180,
    count: 1,
    issueId: 'MIN-862',
    command: 'mvn',
    pids: [201],
  },
  {
    label: 'chrome renderers',
    cpuPercent: 22,
    count: 14,
    command: 'chrome',
    pids: [301, 302],
  },
];

function sample(overrides: Partial<ResourceSpikeSample> = {}): ResourceSpikeSample {
  return {
    cpuPercent: 20,
    load1: 1.2,
    cores: 8,
    processGroups: baseProcessGroups,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('PAN-2464 resource spike sampler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-07T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits exactly one activity entry when fixture CPU remains above threshold for three ticks', () => {
    const emit = vi.fn();
    const sampler = createResourceSpikeSampler({ emit });

    sampler.sample(sample({ cpuPercent: 92 }));
    vi.advanceTimersByTime(5_000);
    sampler.sample(sample({ cpuPercent: 96 }));
    vi.advanceTimersByTime(5_000);
    sampler.sample(sample({ cpuPercent: 91 }));

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      source: 'dashboard',
      level: 'warn',
      issueId: 'PAN-2341',
      link: '/resources',
      message: expect.stringContaining('vitest workers x10 (agent-pan-2341-test)'),
    }));
  });

  it('suppresses repeated events inside one spike episode and emits again after two recovered ticks', () => {
    const emit = vi.fn();
    const sampler = createResourceSpikeSampler({ emit, cpuThreshold: 80, hysteresis: 10 });

    sampler.sample(sample({ cpuPercent: 93 }));
    sampler.sample(sample({ cpuPercent: 84 }));
    sampler.sample(sample({ cpuPercent: 90 }));

    expect(emit).toHaveBeenCalledTimes(1);

    sampler.sample(sample({ cpuPercent: 62, load1: 4 }));
    sampler.sample(sample({ cpuPercent: 61, load1: 3 }));
    sampler.sample(sample({ cpuPercent: 94 }));

    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('emits resource-category attribution details for history annotation round-trip', () => {
    const emit = vi.fn();
    const sampler = createResourceSpikeSampler({ emit });

    sampler.sample(sample({ load1: 45, cpuPercent: 76 }));

    const details = emit.mock.calls[0]?.[0]?.details as ResourceSpikeDetails;
    expect(details).toMatchObject({
      category: 'resources',
      targetKind: 'host-process',
      targetId: 'agent-pan-2341-test',
      attributedAgentId: 'agent-pan-2341-test',
      attributedIssueId: 'PAN-2341',
      load1: 45,
      cores: 8,
    });
    expect(details.processGroups).toHaveLength(3);
    expect(details.processGroups[0]).toMatchObject({
      label: 'vitest workers',
      issueId: 'PAN-2341',
    });
  });
});
