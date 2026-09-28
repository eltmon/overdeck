/**
 * PAN-4320: `paneAlreadyExited` joined the backend pane inventory to an agent
 * by `id === agentId || terminalId === agentId`. On Herdr both `id` and
 * `terminalId` are backend handles, never agent ids, so it never found the
 * agent's pane and `session-started` always applied — even once the pane had
 * genuinely exited. This is a separate file so its module-level mock of
 * `backend-inventory.js` does not disturb `agent-projection.test.ts`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentState } from '../../../../../src/lib/agents.js';

vi.mock('../../../../../src/lib/persistent-logger.js', () => ({
  logAgentLifecycle: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  getBackendPanes: vi.fn(),
}));

vi.mock('../../../../../src/dashboard/server/services/backend-inventory.js', () => ({
  getBackendPanes: mocks.getBackendPanes,
}));

import {
  _resetAgentLifecycleDedupeForTests,
  applyAgentLifecycleEventWithDeps,
} from '../../../../../src/dashboard/server/services/agent-projection.js';

function makeAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-pan-4311',
    issueId: 'PAN-4311',
    workspace: '/tmp/ws',
    role: 'work',
    harness: 'claude-code',
    model: 'claude-sonnet-4-6',
    status: 'running',
    startedAt: '2026-09-28T10:00:00.000Z',
    ...overrides,
  } as AgentState;
}

function makeEventStore() {
  let next = 1;
  const appended: Array<Record<string, unknown>> = [];
  return {
    appended,
    append: vi.fn((event: Record<string, unknown>) => {
      appended.push(event);
      return next++;
    }),
  };
}

/** A Herdr-shaped pane: `id`/`terminalId` are backend handles, not agent ids. */
function herdrPane(agentId: string, state: 'working' | 'exited') {
  return {
    id: 'wKZ:p3',
    terminalId: 'term_65c8b78d3f05a5df',
    agentId,
    issue: 'PAN-4311',
    role: 'work',
    state,
    harness: 'claude-code',
    model: 'unknown',
  };
}

beforeEach(() => {
  _resetAgentLifecycleDedupeForTests();
  vi.clearAllMocks();
});

describe('applyAgentLifecycleEventWithDeps — paneAlreadyExited over Herdr panes (PAN-4320)', () => {
  const at = '2026-09-28T10:05:00.000Z';
  // No hasExited stub: this exercises the real paneAlreadyExited, which reads
  // getBackendPanes and joins by agent key.
  const deps = { readAgentState: () => makeAgentState() };

  it('rejects session-started when only a Herdr-shaped exited pane exists', async () => {
    mocks.getBackendPanes.mockResolvedValue([herdrPane('agent-pan-4311', 'exited')]);
    const eventStore = makeEventStore();

    const result = await applyAgentLifecycleEventWithDeps(eventStore, 'agent-pan-4311', { event: 'session-started', at }, deps);

    expect(result).toEqual({ applied: false, reason: 'already-stopped' });
    expect(eventStore.append).not.toHaveBeenCalled();
  });

  it('applies session-started when a Herdr-shaped live pane exists', async () => {
    mocks.getBackendPanes.mockResolvedValue([herdrPane('agent-pan-4311', 'working')]);
    const eventStore = makeEventStore();

    const result = await applyAgentLifecycleEventWithDeps(eventStore, 'agent-pan-4311', { event: 'session-started', at }, deps);

    expect(result).toEqual({ applied: true, status: 'running' });
    expect(eventStore.appended[0]?.['type']).toBe('agent.started');
  });
});
