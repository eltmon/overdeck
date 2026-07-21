import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';

// ── Mocks ─────────────────────────────────────────────────────────────────────
const tmux = vi.hoisted(() => ({
  liveSessions: new Set<string>(),
}));
vi.mock('../../tmux.js', () => ({
  sessionExists: (name: string) => Effect.succeed(tmux.liveSessions.has(name)),
  listSessionNames: () => Effect.succeed([...tmux.liveSessions]),
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: vi.fn(() => null),
  getProjectSync: vi.fn(() => null),
}));
vi.mock('../../pan-dir/record.js', () => ({
  readIssueRecordSync: vi.fn(() => null),
  writeIssueRecordSync: vi.fn(),
}));

const agentState = vi.hoisted(() => ({
  states: new Map<string, Record<string, unknown>>(),
  clearPaused: vi.fn(),
  clearTroubled: vi.fn(),
}));
vi.mock('../../agents/agent-state.js', () => ({
  getAgentStateSync: (id: string) => agentState.states.get(id) ?? null,
  clearAgentPausedSync: agentState.clearPaused,
  clearAgentTroubledSync: agentState.clearTroubled,
}));

const resume = vi.hoisted(() => ({
  resumeAgent: vi.fn(),
}));
vi.mock('../../agents/resume.js', () => ({
  resumeAgent: resume.resumeAgent,
}));

import { resolveIssueFeedbackTarget } from '../feedback-target.js';

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('resolveIssueFeedbackTarget — resurrection-first delivery (PAN-2209 + PAN-2461)', () => {
  const AGENT = 'agent-pan-9999';

  beforeEach(() => {
    vi.clearAllMocks();
    tmux.liveSessions.clear();
    agentState.states.clear();
    // Default: a successful resume brings the session up.
    resume.resumeAgent.mockImplementation(async (id: string) => {
      tmux.liveSessions.add(id);
      return { success: true };
    });
  });

  it('returns the live whole-issue agent without any resurrection', async () => {
    tmux.liveSessions.add(AGENT);

    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(target).toEqual({ agentId: AGENT });
    expect(resume.resumeAgent).not.toHaveBeenCalled();
  });

  it('resurrects a plain STOPPED work agent instead of parking needs-you (PAN-2209)', async () => {
    agentState.states.set(AGENT, { id: AGENT, status: 'stopped' });

    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(resume.resumeAgent).toHaveBeenCalledWith(AGENT);
    expect(target).toEqual({ agentId: AGENT });
  });

  it('unpauses + resumes a pipeline needs-you paused agent (PAN-2461)', async () => {
    agentState.states.set(AGENT, {
      id: AGENT, status: 'stopped', paused: true, pausedReason: 'needs-you: verification failed 3x',
    });

    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(agentState.clearPaused).toHaveBeenCalledWith(AGENT);
    expect(target).toEqual({ agentId: AGENT });
  });

  it('unpauses + resumes a governor/scheduler-yielded agent', async () => {
    agentState.states.set(AGENT, {
      id: AGENT, status: 'stopped', paused: true, pausedReason: 'yielded', yieldedByScheduler: true,
    });

    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(agentState.clearPaused).toHaveBeenCalledWith(AGENT);
    expect(target).toEqual({ agentId: AGENT });
  });

  it('NEVER overrides an operator pause — parks needs-you instead', async () => {
    agentState.states.set(AGENT, {
      id: AGENT, status: 'stopped', paused: true, pausedReason: 'operator investigating flaky build',
    });

    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(agentState.clearPaused).not.toHaveBeenCalled();
    expect(resume.resumeAgent).not.toHaveBeenCalled();
    expect(target).toMatchObject({ needsYou: true });
  });

  it('clears a troubled gate for one resurrection attempt', async () => {
    agentState.states.set(AGENT, { id: AGENT, status: 'stopped', troubled: true, consecutiveFailures: 3 });

    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(agentState.clearTroubled).toHaveBeenCalledWith(AGENT);
    expect(target).toEqual({ agentId: AGENT });
  });

  it('parks needs-you only after resurrection fails', async () => {
    agentState.states.set(AGENT, { id: AGENT, status: 'stopped' });
    resume.resumeAgent.mockResolvedValue({ success: false, error: 'spawn failed' });

    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(resume.resumeAgent).toHaveBeenCalled();
    expect(target).toMatchObject({ needsYou: true });
    expect((target as { reason: string }).reason).toContain('resurrection');
  });

  it('parks needs-you when no agent state exists at all', async () => {
    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(resume.resumeAgent).not.toHaveBeenCalled();
    expect(target).toMatchObject({ needsYou: true });
  });
});
