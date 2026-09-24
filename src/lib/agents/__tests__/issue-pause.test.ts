/**
 * The issue-level pause gate (PAN-3911): `pan pause <issue>` pauses the work
 * agent, and dispatchers read that pause as a hold on the whole issue.
 */
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAgentState: vi.fn(),
  listAgentStates: vi.fn(),
  agentPaneExists: vi.fn(),
  closeAgentPane: vi.fn(),
}));

vi.mock('../agent-state-read.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agent-state-read.js')>()),
  getAgentState: mocks.getAgentState,
}));
vi.mock('../queries.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries.js')>()),
  listAgentStates: mocks.listAgentStates,
}));
vi.mock('../../terminal-backends/launch.js', () => ({
  agentPaneExists: mocks.agentPaneExists,
  closeAgentPane: mocks.closeAgentPane,
}));
vi.mock('../../tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../tmux.js')>()),
  sessionExists: () => Effect.succeed(false),
}));
vi.mock('../../agent-runtime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agent-runtime.js')>()),
  emitAgentEvent: () => Effect.void,
}));
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  // pgrep for launcher.sh: report "no match" so the sweep never signals anything.
  exec: (_cmd: string, cb: (err: Error) => void) => cb(new Error('no match')),
}));

const { getIssuePause } = await import('../agent-state.js');
const { stopIssueSpecialistAgents } = await import('../termination.js');

beforeEach(() => {
  mocks.getAgentState.mockReset();
  mocks.listAgentStates.mockReset();
  mocks.agentPaneExists.mockReset();
  mocks.agentPaneExists.mockResolvedValue(false);
  mocks.closeAgentPane.mockReset();
  mocks.closeAgentPane.mockResolvedValue(true);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('getIssuePause', () => {
  it('reads the pause from the issue work agent', () => {
    mocks.getAgentState.mockReturnValue({
      id: 'agent-pan-3911', paused: true, pausedAt: '2026-09-24T10:00:00.000Z', pausedReason: 'cut spend',
    });

    expect(getIssuePause('PAN-3911')).toEqual({
      agentId: 'agent-pan-3911', pausedAt: '2026-09-24T10:00:00.000Z', pausedReason: 'cut spend',
    });
    expect(mocks.getAgentState).toHaveBeenCalledWith('agent-pan-3911');
  });

  it('is null for an unpaused or unknown work agent', () => {
    mocks.getAgentState.mockReturnValue({ id: 'agent-pan-3911', paused: false });
    expect(getIssuePause('PAN-3911')).toBeNull();

    mocks.getAgentState.mockReturnValue(null);
    expect(getIssuePause('PAN-3911')).toBeNull();
  });

  it('does not treat a scheduler yield as an operator hold', () => {
    mocks.getAgentState.mockReturnValue({ id: 'agent-pan-3911', paused: true, yieldedByScheduler: true });
    expect(getIssuePause('PAN-3911')).toBeNull();
  });
});

describe('stopIssueSpecialistAgents', () => {
  it("stops the issue's live review and test agents and nothing else", async () => {
    mocks.listAgentStates.mockReturnValue([
      { id: 'agent-pan-3911', role: 'work', issueId: 'PAN-3911', status: 'running' },
      { id: 'agent-pan-3911-review', role: 'review', issueId: 'PAN-3911', status: 'running' },
      { id: 'agent-pan-3911-review-security', role: 'review', issueId: 'pan-3911', status: 'stopped' },
      { id: 'agent-pan-3911-review-logic', role: 'review', issueId: 'PAN-3911', status: 'stopped' },
      { id: 'agent-pan-3911-test', role: 'test', issueId: 'PAN-3911', status: 'starting' },
      { id: 'agent-pan-4000-review', role: 'review', issueId: 'PAN-4000', status: 'running' },
    ]);
    // A "stopped" row whose pane is still up (Herdr idle harness) counts as live.
    mocks.agentPaneExists.mockImplementation(async (id: string) => id === 'agent-pan-3911-review-security');

    const stopped = await stopIssueSpecialistAgents('PAN-3911');

    expect(stopped).toEqual([
      'agent-pan-3911-review',
      'agent-pan-3911-review-security',
      'agent-pan-3911-test',
    ]);
    expect(mocks.closeAgentPane.mock.calls.map(([id]) => id)).toEqual(stopped);
  });

  it('returns [] when the agent list cannot be read', async () => {
    mocks.listAgentStates.mockImplementation(() => { throw new Error('EACCES'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await stopIssueSpecialistAgents('PAN-3911')).toEqual([]);
  });
});
