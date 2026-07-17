import { describe, expect, it } from 'vitest';

import {
  classifyAgentHealth,
  type ClassifyAgentHealthInput,
} from '../health.js';

const NOW = Date.parse('2026-07-16T12:00:00.000Z');

function input(
  overrides: Partial<ClassifyAgentHealthInput> = {},
): ClassifyAgentHealthInput {
  return {
    agentId: 'agent-pan-2647',
    persisted: {
      status: 'available',
      value: {
        id: 'agent-pan-2647',
        issueId: 'PAN-2647',
        role: 'work',
        status: 'running',
        startedAt: '2026-07-16T11:50:00.000Z',
        lastActivity: '2026-07-16T11:59:00.000Z',
        kickoffDelivered: true,
      },
    },
    runtime: {
      state: 'active',
      lastActivity: '2026-07-16T11:59:30.000Z',
    },
    liveSessions: new Set(['agent-pan-2647']),
    reviewLifecycle: 'active',
    nowMs: NOW,
    ...overrides,
  };
}

describe('classifyAgentHealth', () => {
  it('reports unreadable persisted state as unavailable with structured evidence', () => {
    const snapshot = classifyAgentHealth(input({
      persisted: {
        status: 'unavailable',
        reason: 'Agent state could not be decoded.',
      },
      runtime: null,
      liveSessions: new Set(),
    }));

    expect(snapshot).toMatchObject({
      status: 'unavailable',
      reasons: [{
        code: 'agent.persisted_state.unavailable',
        domain: 'agent',
        severity: 'warning',
        message: 'Agent state could not be decoded.',
      }],
    });
  });

  it('classifies context saturation before missing tmux', () => {
    const snapshot = classifyAgentHealth(input({
      runtime: {
        state: 'active',
        contextSaturatedAt: '2026-07-16T11:54:00.000Z',
      },
      liveSessions: new Set(),
    }));

    expect(snapshot.status).toBe('wedged');
    expect(snapshot.reasons[0]?.code).toBe('agent.context.saturated');
  });

  it('allows the full five-minute startup grace before declaring missing tmux dead', () => {
    const persisted = {
      status: 'available' as const,
      value: {
        role: 'work',
        status: 'starting',
        startedAt: '2026-07-16T11:55:01.000Z',
      },
    };

    expect(classifyAgentHealth(input({
      persisted,
      runtime: { state: 'uninitialized' },
      liveSessions: new Set(),
    })).status).toBe('healthy');

    expect(classifyAgentHealth(input({
      persisted: {
        ...persisted,
        value: { ...persisted.value, startedAt: '2026-07-16T11:55:00.000Z' },
      },
      runtime: { state: 'uninitialized' },
      liveSessions: new Set(),
    }))).toMatchObject({
      status: 'dead',
      reasons: [{ code: 'agent.tmux.missing' }],
    });
  });

  it('reports an undelivered work kickoff as stalled after startup grace', () => {
    const snapshot = classifyAgentHealth(input({
      persisted: {
        status: 'available',
        value: {
          role: 'work',
          status: 'running',
          startedAt: '2026-07-16T11:54:59.000Z',
          kickoffDelivered: false,
        },
      },
    }));

    expect(snapshot).toMatchObject({
      status: 'stalled',
      reasons: [{ code: 'agent.kickoff.not_delivered' }],
    });
  });

  it.each([
    ['waiting-on-human', 'waiting'],
    ['idle', 'idle'],
    ['suspended', 'idle'],
  ] as const)(
    'keeps %s runtime intentional after more than 30 minutes of inactivity',
    (state, expectedStatus) => {
      const snapshot = classifyAgentHealth(input({
        persisted: {
          status: 'available',
          value: {
            role: 'work',
            status: 'running',
            startedAt: '2026-07-16T10:00:00.000Z',
            lastActivity: '2026-07-16T10:30:00.000Z',
            kickoffDelivered: true,
          },
        },
        runtime: {
          state,
          lastActivity: '2026-07-16T10:45:00.000Z',
        },
      }));

      expect(snapshot.status).toBe(expectedStatus);
      expect(snapshot.status).not.toBe('stalled');
    },
  );

  it('classifies terminal-verdict advancing sessions as warm idle', () => {
    const snapshot = classifyAgentHealth(input({
      persisted: {
        status: 'available',
        value: {
          role: 'review',
          status: 'running',
          startedAt: '2026-07-16T10:00:00.000Z',
          lastActivity: '2026-07-16T10:30:00.000Z',
        },
      },
      runtime: {
        state: 'active',
        lastActivity: '2026-07-16T10:30:00.000Z',
      },
      reviewLifecycle: 'warm',
    }));

    expect(snapshot).toMatchObject({
      status: 'idle',
      lifecycle: 'warm',
    });
  });

  it('uses the latest activity timestamp and applies exact active thresholds', () => {
    const persisted = {
      status: 'available' as const,
      value: {
        role: 'work',
        status: 'running',
        startedAt: '2026-07-16T10:00:00.000Z',
        lastActivity: '2026-07-16T11:44:00.000Z',
        kickoffDelivered: true,
      },
    };

    const warning = classifyAgentHealth(input({
      persisted,
      runtime: {
        state: 'active',
        lastActivity: '2026-07-16T11:45:00.000Z',
      },
    }));
    expect(warning).toMatchObject({
      status: 'warning',
      lastActivityAt: '2026-07-16T11:45:00.000Z',
      reasons: [{ code: 'agent.runtime.inactive.warning' }],
    });

    const stalled = classifyAgentHealth(input({
      persisted: {
        ...persisted,
        value: {
          ...persisted.value,
          lastActivity: '2026-07-16T11:30:00.000Z',
        },
      },
      runtime: {
        state: 'active',
        lastActivity: '2026-07-16T11:29:00.000Z',
      },
    }));
    expect(stalled).toMatchObject({
      status: 'stalled',
      lastActivityAt: '2026-07-16T11:30:00.000Z',
      reasons: [{ code: 'agent.runtime.inactive.stalled' }],
    });
  });

  it('preserves zero context and real failure counters in the projection', () => {
    const snapshot = classifyAgentHealth(input({
      observations: {
        contextPercent: 0,
        consecutiveFailures: 3,
        killCount: 2,
      },
    }));

    expect(snapshot).toMatchObject({
      contextPercent: 0,
      consecutiveFailures: 3,
      killCount: 2,
    });
  });

  it('classifies deliberately stopped or paused persisted agents as idle', () => {
    const snapshot = classifyAgentHealth(input({
      persisted: {
        status: 'available',
        value: {
          role: 'work',
          status: 'stopped',
          paused: true,
          lastActivity: '2026-07-16T10:00:00.000Z',
        },
      },
      runtime: null,
      liveSessions: new Set(),
    }));

    expect(snapshot.status).toBe('idle');
  });
});
