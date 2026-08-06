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
      expect(item.sub).toContain('2×');
      expect(item.agentId).toBeUndefined();
    });

    it('returns an item with severity critical for code agent.runtime.inactive.stalled', () => {
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
      });

      const items = buildAttentionItems(snapshot);
      expect(items).toHaveLength(1);
      expect(items[0]?.severity).toBe('critical');
      expect(items[0]?.code).toBe('agent.runtime.inactive.stalled');
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
