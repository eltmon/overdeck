import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

/**
 * PAN-806 regression: the async lifecycle snapshot used by /has-session omitted
 * `hasSavedSession` from canResumeSession — every stopped agent with a
 * workspace looked resumable, so the CTA offered "Resume session" with nothing
 * to resume. The flag must require a saved session AND resumable backing state.
 */
const mockGetAgentState = vi.fn();
const mockGetAgentRuntimeState = vi.fn();
const mockGetLatestSessionId = vi.fn();
const mockSessionExists = vi.fn();
const mockHasCompletionMarker = vi.fn(() => false);

vi.mock('../agents.js', () => ({
  getAgentStateSync: () => mockGetAgentState(),
  getAgentState: () => Effect.succeed(mockGetAgentState()),
  getAgentRuntimeStateSync: () => mockGetAgentRuntimeState(),
  getAgentRuntimeState: () => Effect.succeed(mockGetAgentRuntimeState()),
  getLatestSessionIdSync: () => mockGetLatestSessionId(),
  getLatestSessionId: () => Effect.succeed(mockGetLatestSessionId()),
  normalizeAgentId: (id: string) => id,
}));

vi.mock('../agents/supervisor-channels.js', () => ({
  hasCompletionMarkerForAgent: () => mockHasCompletionMarker(),
}));

vi.mock('../tmux.js', () => ({
  sessionExistsSync: () => mockSessionExists(),
  sessionExists: () => Effect.succeed(mockSessionExists()),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: () => true };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, access: () => Promise.resolve() };
});

import { getWorkAgentLifecycleState } from '../work-agent-lifecycle.js';

function agentState(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-pan-806',
    issueId: 'PAN-806',
    workspace: '/tmp/ws',
    status: 'stopped',
    role: 'work',
    model: 'claude-sonnet-4-6',
    ...overrides,
  };
}

describe('canResumeSession truth (PAN-806)', () => {
  it('is FALSE for a stopped agent with workspace but NO saved session', async () => {
    mockGetAgentState.mockReturnValue(agentState());
    mockGetAgentRuntimeState.mockReturnValue({ state: 'stopped' });
    mockGetLatestSessionId.mockReturnValue(null);
    mockSessionExists.mockReturnValue(false);

    const lifecycle = await Effect.runPromise(getWorkAgentLifecycleState('agent-pan-806'));

    expect(lifecycle.hasSavedSession).toBe(false);
    expect(lifecycle.canResumeSession).toBe(false);
    expect(lifecycle.recommendedAction).toBe('start');
    expect(lifecycle.reason).toContain('no saved Claude session');
  });

  it('is TRUE for a stopped agent with workspace AND a saved session', async () => {
    mockGetAgentState.mockReturnValue(agentState());
    mockGetAgentRuntimeState.mockReturnValue({ state: 'stopped' });
    mockGetLatestSessionId.mockReturnValue('session-abc-123');
    mockSessionExists.mockReturnValue(false);

    const lifecycle = await Effect.runPromise(getWorkAgentLifecycleState('agent-pan-806'));

    expect(lifecycle.hasSavedSession).toBe(true);
    expect(lifecycle.canResumeSession).toBe(true);
    expect(lifecycle.recommendedAction).toBe('resume');
  });

  it('is FALSE with action none for a handed-off agent (completion marker, PAN-3334)', async () => {
    mockHasCompletionMarker.mockReturnValue(true);
    try {
      mockGetAgentState.mockReturnValue(agentState());
      mockGetAgentRuntimeState.mockReturnValue({ state: 'stopped' });
      mockGetLatestSessionId.mockReturnValue('session-abc-123');
      mockSessionExists.mockReturnValue(false);

      const lifecycle = await Effect.runPromise(getWorkAgentLifecycleState('agent-pan-806'));

      expect(lifecycle.handedOff).toBe(true);
      expect(lifecycle.canResumeSession).toBe(false);
      expect(lifecycle.recommendedAction).toBe('none');
      expect(lifecycle.reason).toContain('handed off');
    } finally {
      mockHasCompletionMarker.mockReturnValue(false);
    }
  });
});
