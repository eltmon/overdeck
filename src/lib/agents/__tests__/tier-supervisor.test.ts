import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AgentState } from '../agent-state.js';
import type { TieredExecutionSupervisorConfig } from '../tier-table.js';

vi.mock('../spawn.js', () => ({
  spawnRun: vi.fn(),
}));

import { spawnRun } from '../spawn.js';
import {
  DEFAULT_SUPERVISOR_SAMPLE_RATE,
  shouldSupervise,
  spawnTierSupervisor,
  supervisorAgentId,
  SUPERVISOR_SUB_ROLE,
} from '../tier-supervisor.js';

function bead(id: string, requiresInspection?: boolean) {
  return {
    id,
    metadata: requiresInspection === undefined ? {} : { requiresInspection },
  };
}

describe('shouldSupervise', () => {
  it("under policy 'flagged', returns true only for beads with requiresInspection=true", () => {
    expect(shouldSupervise(bead('a', true), 'flagged')).toBe(true);
    expect(shouldSupervise(bead('b', false), 'flagged')).toBe(false);
    expect(shouldSupervise(bead('c'), 'flagged')).toBe(false);
    expect(shouldSupervise({ id: 'd' }, 'flagged')).toBe(false);
  });

  it("under policy 'all', returns true for every bead", () => {
    expect(shouldSupervise(bead('a', true), 'all')).toBe(true);
    expect(shouldSupervise(bead('b', false), 'all')).toBe(true);
    expect(shouldSupervise(bead('c'), 'all')).toBe(true);
    expect(shouldSupervise({ id: 'd' }, 'all')).toBe(true);
  });

  it("under policy 'sampled', rate 0 selects nothing and rate 1 selects everything", () => {
    const beads = ['a', 'b', 'c', 'd', 'e'].map(id => bead(id));
    for (const b of beads) {
      expect(shouldSupervise(b, 'sampled', { sampleRate: 0 })).toBe(false);
      expect(shouldSupervise(b, 'sampled', { sampleRate: 1 })).toBe(true);
    }
  });

  it("under policy 'sampled', the decision is deterministic per bead id", () => {
    for (let i = 0; i < 50; i++) {
      const b = bead(`bead-${i}`);
      const first = shouldSupervise(b, 'sampled');
      expect(shouldSupervise(b, 'sampled')).toBe(first);
      expect(shouldSupervise(b, 'sampled', { sampleRate: DEFAULT_SUPERVISOR_SAMPLE_RATE })).toBe(first);
    }
  });

  it("under policy 'sampled', a bead selected at a lower rate stays selected at a higher rate", () => {
    for (let i = 0; i < 200; i++) {
      const b = bead(`bead-${i}`);
      if (shouldSupervise(b, 'sampled', { sampleRate: 0.1 })) {
        expect(shouldSupervise(b, 'sampled', { sampleRate: 0.9 })).toBe(true);
      }
    }
  });

  it("under policy 'sampled', the selected fraction approximates the configured rate", () => {
    const total = 2000;
    let selected = 0;
    for (let i = 0; i < total; i++) {
      if (shouldSupervise(bead(`bead-${i}`), 'sampled', { sampleRate: 0.25 })) selected++;
    }
    const fraction = selected / total;
    expect(fraction).toBeGreaterThan(0.15);
    expect(fraction).toBeLessThan(0.35);
  });
});

describe('spawnTierSupervisor', () => {
  const supervisor: TieredExecutionSupervisorConfig = {
    model: 'claude-opus-4-8',
    harness: 'claude-code',
    subscribe: 'flagged',
  };

  beforeEach(() => {
    vi.mocked(spawnRun).mockReset();
    vi.mocked(spawnRun).mockResolvedValue({ id: 'agent-pan-9999-review-supervisor' } as AgentState);
  });

  it('spawns a registered review run using the tier-table supervisor model and harness', async () => {
    await spawnTierSupervisor('PAN-9999', supervisor);

    expect(spawnRun).toHaveBeenCalledTimes(1);
    const [issueId, role, options] = vi.mocked(spawnRun).mock.calls[0];
    expect(issueId).toBe('PAN-9999');
    expect(role).toBe('review');
    expect(options).toMatchObject({
      agentId: 'agent-pan-9999-review-supervisor',
      subRole: SUPERVISOR_SUB_ROLE,
      model: 'claude-opus-4-8',
      harness: 'claude-code',
    });
  });

  it('delivers a review-only standing prompt carrying the subscription policy', async () => {
    await spawnTierSupervisor('PAN-9999', supervisor);

    const [, , options] = vi.mocked(spawnRun).mock.calls[0];
    expect(options?.prompt).toContain('Standing Supervisor: PAN-9999');
    expect(options?.prompt).toContain('flagged');
    expect(options?.prompt).toContain('NEVER write, edit, or commit implementation code');
  });

  it('honors workspace and prompt overrides', async () => {
    await spawnTierSupervisor('PAN-9999', supervisor, {
      workspace: '/tmp/ws',
      prompt: 'custom prompt',
    });

    const [, , options] = vi.mocked(spawnRun).mock.calls[0];
    expect(options?.workspace).toBe('/tmp/ws');
    expect(options?.prompt).toBe('custom prompt');
  });
});

describe('supervisorAgentId', () => {
  it('derives a review sub-role run id from the issue id', () => {
    expect(supervisorAgentId('PAN-9999')).toBe('agent-pan-9999-review-supervisor');
  });
});
