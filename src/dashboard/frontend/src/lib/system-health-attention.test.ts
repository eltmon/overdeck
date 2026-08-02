import type { HealthState, SystemHealthSnapshot } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';

import { buildAttentionItems, contextNotes, summaryLine } from './system-health-attention';

const GIB = 1024 ** 3;

function createSnapshot(
  state: HealthState,
  overrides?: Partial<SystemHealthSnapshot>,
): SystemHealthSnapshot {
  const hostReason = state === 'critical'
    ? [{
        code: 'host.linux.psi_full.critical',
        domain: 'host' as const,
        severity: 'critical' as const,
        message: 'Current memory pressure is critical.',
      }]
    : state === 'warning'
      ? [{
          code: 'host.linux.swap_activity.warning',
          domain: 'host' as const,
          severity: 'warning' as const,
          message: '1.2 GB swap activity/min',
        }]
      : [];

  const infoReason = [{
    code: 'host.current_pressure.unavailable',
    domain: 'host' as const,
    severity: 'info' as const,
    message: 'Current pressure sampling unavailable.',
  }];

  return {
    version: 2,
    state,
    updatedAt: '2026-07-17T04:00:00.000Z',
    nextPollMs: 15_000,
    host: {
      state,
      platform: 'linux',
      reasons: state === 'info_only' ? infoReason : hostReason,
      metrics: {
        cpuPercent: 12.5,
        loadAverage1m: 1.2,
        loadPerCore1m: 0.2,
        totalMemoryBytes: 64 * GIB,
        usedMemoryBytes: 23 * GIB,
        availableMemoryBytes: 41 * GIB,
        memoryUsedPercent: 35.9,
        memoryPressureSomeAvg10: 0,
        memoryPressureFullAvg10: 0,
        memoryPressureFreePercent: null,
        swapTotalBytes: 8 * GIB,
        swapUsedBytes: 0,
        swapUsedPercent: 0,
        swapActivityBytesPerMinute: 0,
        committedMemoryBytes: 24 * GIB,
        commitLimitBytes: 72 * GIB,
        virtualCommitmentPercent: 33.3,
      },
    },
    admission: {
      state: 'open',
      availableMemoryBytes: 41 * GIB,
      admittedWorkAgentCount: 2,
      reasons: [],
    },
    agents: [],
    services: [{
      id: 'smee-relay',
      label: 'Webhook relay',
      required: false,
      status: 'running',
      message: 'Running',
      reasons: [],
    }],
    topConsumers: [],
    summary: {
      cpuPercent: 12.5,
      loadAverage1m: 1.2,
      loadPerCore1m: 0.2,
      totalMemoryBytes: 64 * GIB,
      usedMemoryBytes: 23 * GIB,
      availableMemoryBytes: 41 * GIB,
      memoryUsedPercent: 35.9,
      swapTotalBytes: 8 * GIB,
      swapUsedBytes: 0,
      swapUsedPercent: 0,
      committedMemoryBytes: 24 * GIB,
      commitLimitBytes: 72 * GIB,
      overcommitPercent: 33.3,
      agentCount: 0,
      workAgentCount: 0,
      planningAgentCount: 0,
      specialistSessionCount: 0,
      leakedSpecialistCount: 0,
      containerCount: 0,
      containerMemoryBytes: 0,
      overdeckMemoryBytes: 3 * GIB,
      overdeckMemoryPercent: 4.7,
      smeeRelay: {
        configured: true,
        running: true,
        status: 'running',
        message: 'Running',
      },
    },
    ...overrides,
  };
}

describe('system-health-attention', () => {
  describe('contextNotes', () => {
    it('excludes every severity:info reason and contextNotes returns exactly those info reasons', () => {
      const snapshot = createSnapshot('healthy', {
        host: {
          ...createSnapshot('healthy').host,
          reasons: [
            {
              code: 'host.linux.inotify_watches.warning',
              domain: 'host',
              severity: 'warning',
              message: 'Warning message',
            },
            {
              code: 'host.current_pressure.unavailable',
              domain: 'host',
              severity: 'info',
              message: 'Info message 1',
            },
          ],
        },
        admission: {
          ...createSnapshot('healthy').admission,
          reasons: [
            {
              code: 'admission.memory_available.soft',
              domain: 'admission',
              severity: 'info',
              message: 'Info message 2',
            },
          ],
        },
      });

      const notes = contextNotes(snapshot);
      expect(notes).toHaveLength(2);
      expect(notes[0]?.code).toBe('host.current_pressure.unavailable');
      expect(notes[1]?.code).toBe('admission.memory_available.soft');
    });

    it('returns empty when no info reasons exist', () => {
      const snapshot = createSnapshot('warning');
      const notes = contextNotes(snapshot);
      expect(notes).toHaveLength(0);
    });
  });

  describe('buildAttentionItems', () => {
    it('excludes every severity:info reason from buildAttentionItems output', () => {
      const snapshot = createSnapshot('warning', {
        host: {
          ...createSnapshot('warning').host,
          reasons: [
            {
              code: 'host.linux.swap_activity.warning',
              domain: 'host',
              severity: 'warning',
              message: 'Swap activity',
            },
            {
              code: 'host.current_pressure.unavailable',
              domain: 'host',
              severity: 'info',
              message: 'Info message',
            },
          ],
        },
      });

      const items = buildAttentionItems(snapshot);
      expect(items).toHaveLength(1);
      expect(items[0]?.code).toBe('host.linux.swap_activity.warning');
    });

    it('groups two agents sharing a reason code into one item with x2 badge and both agents listed', () => {
      const snapshot = createSnapshot('healthy', {
        agents: [
          {
            id: 'agent-1',
            issueId: 'PAN-1',
            status: 'stalled',
            reasons: [{
              code: 'agent.runtime.inactive.warning',
              domain: 'agent',
              severity: 'warning',
              message: 'agent-1 has produced no activity for 20 min.',
            }],
          },
          {
            id: 'agent-2',
            issueId: 'PAN-2',
            status: 'stalled',
            reasons: [{
              code: 'agent.runtime.inactive.warning',
              domain: 'agent',
              severity: 'warning',
              message: 'agent-2 has produced no activity for 25 min.',
            }],
          },
        ],
      });

      const items = buildAttentionItems(snapshot);
      expect(items).toHaveLength(1);
      const item = items[0]!;
      expect(item.agents).toHaveLength(2);
      expect(item.agents).toContain('agent-1');
      expect(item.agents).toContain('agent-2');
      expect(item.targets).toEqual([
        expect.objectContaining({ agentId: 'agent-1', issueId: 'PAN-1' }),
        expect.objectContaining({ agentId: 'agent-2', issueId: 'PAN-2' }),
      ]);
      expect(item.sub).toContain('2×');
      expect(item.agentId).toBeUndefined();
    });

    it('carries the canonical issue and matching kill consumer for a singleton agent', () => {
      const snapshot = createSnapshot('healthy', {
        agents: [
          {
            id: 'agent-stalled',
            issueId: 'PAN-1',
            status: 'stalled',
            reasons: [{
              code: 'agent.runtime.inactive.stalled',
              domain: 'agent',
              severity: 'warning',
              message: 'agent-stalled has produced no activity for 35 min.',
            }],
          },
        ],
        topConsumers: [{
          id: 'agent-stalled',
          label: 'agent-stalled',
          type: 'agent',
          memoryBytes: GIB,
          memoryGb: 1,
          issueId: 'PAN-1',
          killTarget: { kind: 'agent', agentId: 'agent-stalled' },
        }],
      });

      const items = buildAttentionItems(snapshot);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        severity: 'critical',
        code: 'agent.runtime.inactive.stalled',
        agentId: 'agent-stalled',
        issueId: 'PAN-1',
      });
      expect(items[0]?.killConsumer?.killTarget).toEqual({
        kind: 'agent',
        agentId: 'agent-stalled',
      });
    });

    it('preserves the first matching consumer when duplicate identities appear', () => {
      const snapshot = createSnapshot('healthy', {
        agents: [{
          id: 'agent-stalled',
          issueId: 'PAN-1',
          status: 'stalled',
          reasons: [{
            code: 'agent.runtime.inactive.stalled',
            domain: 'agent',
            severity: 'warning',
            message: 'agent-stalled has produced no activity for 35 min.',
          }],
        }],
        topConsumers: [
          {
            id: 'agent-stalled',
            label: 'agent-stalled',
            type: 'agent',
            memoryBytes: GIB,
            memoryGb: 1,
            issueId: 'PAN-1',
            killTarget: { kind: 'agent', agentId: 'agent-stalled' },
          },
          {
            id: 'duplicate-consumer',
            label: 'duplicate-consumer',
            type: 'agent',
            memoryBytes: GIB / 2,
            memoryGb: 0.5,
            issueId: 'PAN-2',
            killTarget: { kind: 'agent', agentId: 'agent-stalled' },
          },
        ],
      });

      const items = buildAttentionItems(snapshot);

      expect(items[0]?.killConsumer?.label).toBe('agent-stalled');
      expect(items[0]?.killConsumer?.issueId).toBe('PAN-1');
    });

    it('carries the matching specialist kill consumer for a singleton specialist', () => {
      const snapshot = createSnapshot('healthy', {
        agents: [{
          id: 'specialist-review-agent',
          issueId: 'PAN-1',
          kind: 'specialist',
          status: 'stalled',
          reasons: [{
            code: 'agent.runtime.inactive.stalled',
            domain: 'agent',
            severity: 'warning',
            message: 'specialist-review-agent has produced no activity for 35 min.',
          }],
        }],
        topConsumers: [{
          id: 'specialist-review-agent',
          label: 'specialist-review-agent',
          type: 'specialist',
          memoryBytes: GIB,
          memoryGb: 1,
          currentIssue: 'PAN-1',
          killTarget: {
            kind: 'specialist',
            projectKey: 'overdeck',
            issueId: 'PAN-1',
            specialistType: 'review-agent',
          },
        }],
      });

      const items = buildAttentionItems(snapshot);
      expect(items).toHaveLength(1);
      expect(items[0]?.killConsumer?.killTarget).toEqual({
        kind: 'specialist',
        projectKey: 'overdeck',
        issueId: 'PAN-1',
        specialistType: 'review-agent',
      });
    });

    it('carries each matching specialist kill consumer in a grouped row', () => {
      const specialist = (id: string, issueId: string) => ({
        id,
        issueId,
        kind: 'specialist' as const,
        status: 'stalled' as const,
        reasons: [{
          code: 'agent.runtime.inactive.stalled',
          domain: 'agent' as const,
          severity: 'warning' as const,
          message: `${id} has produced no activity for 35 min.`,
        }],
      });
      const consumer = (id: string, issueId: string, specialistType: string) => ({
        id,
        label: id,
        type: 'specialist' as const,
        memoryBytes: GIB,
        memoryGb: 1,
        currentIssue: issueId,
        killTarget: {
          kind: 'specialist' as const,
          projectKey: 'overdeck',
          issueId,
          specialistType,
        },
      });
      const snapshot = createSnapshot('healthy', {
        agents: [
          specialist('specialist-review-agent', 'PAN-1'),
          specialist('specialist-test-agent', 'PAN-2'),
        ],
        topConsumers: [
          consumer('specialist-review-agent', 'PAN-1', 'review-agent'),
          consumer('specialist-test-agent', 'PAN-2', 'test-agent'),
        ],
      });

      const items = buildAttentionItems(snapshot);
      expect(items).toHaveLength(1);
      expect(items[0]?.targets.map(target => target.killConsumer?.killTarget)).toEqual([
        expect.objectContaining({ kind: 'specialist', specialistType: 'review-agent' }),
        expect.objectContaining({ kind: 'specialist', specialistType: 'test-agent' }),
      ]);
    });

    it('returns stalled items before idle items in the sort order', () => {
      const snapshot = createSnapshot('healthy', {
        agents: [
          {
            id: 'agent-idle',
            issueId: 'PAN-1',
            status: 'stalled',
            reasons: [{
              code: 'agent.runtime.inactive.warning',
              domain: 'agent',
              severity: 'warning',
              message: 'Idle warning',
            }],
          },
          {
            id: 'agent-stalled',
            issueId: 'PAN-2',
            status: 'stalled',
            reasons: [{
              code: 'agent.runtime.inactive.stalled',
              domain: 'agent',
              severity: 'warning',
              message: 'Stalled',
            }],
          },
        ],
      });

      const items = buildAttentionItems(snapshot);
      expect(items).toHaveLength(2);
      expect(items[0]?.code).toBe('agent.runtime.inactive.stalled');
      expect(items[1]?.code).toBe('agent.runtime.inactive.warning');
    });
  });

  describe('summaryLine', () => {
    it('returns an empty items array and summaryLine returns the all-clear variant', () => {
      const snapshot = createSnapshot('healthy');
      const items = buildAttentionItems(snapshot);
      const line = summaryLine(snapshot, items);

      expect(items).toHaveLength(0);
      expect(line).toContain('All clear');
      expect(line).toContain('spawn headroom');
      expect(line).toContain('relay running');
      expect(line).toContain('0 stalled agents');
    });

    it('describes warning state with count', () => {
      const snapshot = createSnapshot('warning');
      const items = buildAttentionItems(snapshot);
      const line = summaryLine(snapshot, items);

      expect(line).toContain('Attention needed');
      expect(line).toContain('warning');
    });

    it('describes critical state with stalled agent count', () => {
      const snapshot = createSnapshot('healthy', {
        agents: [
          {
            id: 'agent-stalled-1',
            issueId: 'PAN-1',
            status: 'stalled',
            reasons: [{
              code: 'agent.runtime.inactive.stalled',
              domain: 'agent',
              severity: 'warning',
              message: 'Stalled 1',
            }],
          },
          {
            id: 'agent-stalled-2',
            issueId: 'PAN-2',
            status: 'stalled',
            reasons: [{
              code: 'agent.runtime.inactive.stalled',
              domain: 'agent',
              severity: 'warning',
              message: 'Stalled 2',
            }],
          },
        ],
      });

      const items = buildAttentionItems(snapshot);
      const line = summaryLine(snapshot, items);

      expect(line).toContain('Action required');
      expect(line).toContain('2 stalled agents');
    });
  });
});
