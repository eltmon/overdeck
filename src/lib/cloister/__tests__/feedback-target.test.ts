import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';

// ── Mocks ─────────────────────────────────────────────────────────────────────
const tmux = vi.hoisted(() => ({
  liveSessions: new Set<string>(),
}));
const filesystem = vi.hoisted(() => ({
  existingPaths: new Set<string>(),
}));
const spawn = vi.hoisted(() => ({
  workAgent: vi.fn(),
}));
vi.mock('fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('fs')>(),
  existsSync: (path: string) => filesystem.existingPaths.has(String(path)),
}));
vi.mock('../../tmux.js', () => ({
  listSessionNames: () => Effect.succeed([...tmux.liveSessions]),
}));

// PAN-3849: feedback routing reads liveness from the single oracle — map the
// fixture's liveSessions set to the same verdicts the old mock produced.
vi.mock('../../agents/liveness.js', () => ({
  isAlive: (name: string) => Promise.resolve(
    tmux.liveSessions.has(name)
      ? { alive: true, paneAlive: true }
      : { alive: false, reason: 'no-session' },
  ),
  // Mirrors the real isConfirmedDead: only a confirmed absence is death.
  isConfirmedDead: (verdict: { alive: boolean; reason?: string }) =>
    !verdict.alive && verdict.reason !== 'runtime-indeterminate',
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: vi.fn(() => ({ projectKey: 'test', projectPath: '/repo' })),
  getProjectSync: vi.fn(() => null),
  // PAN-3917: resolvePlanHome() asks projects.ts which repo owns `.pan/`.
  findProjectByPath: vi.fn(() => null),
  resolveInfraRepo: (_project: unknown, checkoutRoot: string) => ({ repoPath: checkoutRoot }),
}));

const agentState = vi.hoisted(() => ({
  states: new Map<string, Record<string, unknown>>(),
  clearPaused: vi.fn(),
  clearTroubled: vi.fn(),
  /** Runs after each state read: lets a test change the pause under the ladder. */
  afterRead: undefined as undefined | ((id: string) => void),
}));
const swarm = vi.hoisted(() => ({
  slots: [] as Array<{ itemId: string; slotIndex: number; agentId?: string }>,
}));
vi.mock('../deacon-swarm-record.js', () => ({
  readSwarmSlotAssignments: () => swarm.slots,
}));
vi.mock('../../agents/agent-state.js', () => ({
  getAgentState: (id: string) => {
    const state = agentState.states.get(id) ?? null;
    agentState.afterRead?.(id);
    return state;
  },
  // Compare-and-clear, like the real one: the predicate sees the state read inside the clear.
  clearAgentPausedSync: (id: string, onlyIf?: (state: Record<string, unknown>) => boolean) => {
    const state = agentState.states.get(id);
    if (!state) return false;
    if (onlyIf && !onlyIf(state)) return false;
    agentState.clearPaused(id);
    agentState.states.set(id, { ...state, paused: false, pausedReason: undefined });
    return true;
  },
  clearAgentTroubled: (id: string) => Effect.sync(() => { agentState.clearTroubled(id); return null; }),
}));

const resume = vi.hoisted(() => ({
  resumeAgent: vi.fn(),
}));
vi.mock('../../agents/resume.js', () => ({
  resumeAgent: resume.resumeAgent,
}));
vi.mock('../work-agent-start.js', () => ({
  spawnWorkAgentThroughAgentsEndpoint: spawn.workAgent,
}));

// PAN-3917: surfaceIssueFeedbackNeedsYou announces on the activity stream —
// there is no stuck flag and no verdict to restore.
const activity = vi.hoisted(() => ({ emitActivityEntry: vi.fn() }));
vi.mock('../../activity-logger.js', () => ({
  emitActivityEntry: activity.emitActivityEntry,
}));

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveIssueFeedbackTarget, surfaceIssueFeedbackNeedsYou } from '../feedback-target.js';
import { resolveProjectFromIssueSync } from '../../projects.js';
import { VERDICT_REPORT_FILENAMES } from '../review-verdict-report.js';

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('resolveIssueFeedbackTarget — resurrection-first delivery (PAN-2209 + PAN-2461)', () => {
  const AGENT = 'agent-pan-9999';

  beforeEach(() => {
    vi.clearAllMocks();
    tmux.liveSessions.clear();
    filesystem.existingPaths.clear();
    agentState.states.clear();
    agentState.afterRead = undefined;
    swarm.slots = [];
    // Default: a successful resume brings the session up.
    resume.resumeAgent.mockImplementation(async (id: string) => {
      tmux.liveSessions.add(id);
      return { success: true };
    });
    spawn.workAgent.mockImplementation(async (issueId: string) => {
      const agentId = `agent-${issueId.toLowerCase()}`;
      tmux.liveSessions.add(agentId);
      return { spawned: true, agentId };
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

  it('holds an operator pause that a later machine pause re-labelled with a needs-you reason (PAN-3911)', async () => {
    // `pan pause`, then a verification-stuck escalation writes its reason over
    // it. The pause is still the operator's: the same test getIssuePause uses.
    agentState.states.set(AGENT, {
      id: AGENT, status: 'stopped', paused: true, pausedBy: 'operator',
      pausedReason: 'needs-you: verification failed 3x',
    });

    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(agentState.clearPaused).not.toHaveBeenCalled();
    expect(resume.resumeAgent).not.toHaveBeenCalled();
    expect(target).toMatchObject({ needsYou: true });
  });

  it('keeps a pipeline pause the caller names, read at resurrection time (CodeRabbit on #4039)', async () => {
    // The verification door read "not stuck" before a concurrent escalation
    // paused the agent; the pause it finds when resurrecting is the stuck one.
    agentState.states.set(AGENT, {
      id: AGENT, status: 'stopped', paused: true,
      pausedReason: 'needs-you: verification stuck after 3/3 attempts (test)',
    });

    const target = await resolveIssueFeedbackTarget('PAN-9999', {
      keepPause: (reason) => reason.startsWith('needs-you: verification stuck'),
    });

    expect(agentState.clearPaused).not.toHaveBeenCalled();
    expect(resume.resumeAgent).not.toHaveBeenCalled();
    expect(spawn.workAgent).not.toHaveBeenCalled();
    expect(target).toMatchObject({ needsYou: true });
  });

  it('revives no swarm slot once keepPause holds the whole-issue agent', async () => {
    agentState.states.set(AGENT, {
      id: AGENT, status: 'stopped', paused: true,
      pausedReason: 'needs-you: verification stuck after 3/3 attempts (test)',
    });
    const SLOT = 'agent-pan-9999-slot-1';
    swarm.slots = [{ itemId: 'item-1', slotIndex: 1, agentId: SLOT }];
    agentState.states.set(SLOT, { id: SLOT, status: 'stopped' });

    const target = await resolveIssueFeedbackTarget('PAN-9999', {
      keepPause: (reason) => reason.startsWith('needs-you: verification stuck'),
    });

    expect(resume.resumeAgent).not.toHaveBeenCalled();
    expect(target).toMatchObject({ needsYou: true });
  });

  it('control: a slot is still revived when the whole-issue agent cannot be', async () => {
    const SLOT = 'agent-pan-9999-slot-1';
    swarm.slots = [{ itemId: 'item-1', slotIndex: 1, agentId: SLOT }];
    agentState.states.set(SLOT, { id: SLOT, status: 'stopped' });
    resume.resumeAgent.mockImplementation(async (id: string) => {
      if (id !== SLOT) return { success: false, error: 'no session' };
      tmux.liveSessions.add(id);
      return { success: true };
    });

    const target = await resolveIssueFeedbackTarget('PAN-9999', {
      keepPause: (reason) => reason.startsWith('needs-you: verification stuck'),
    });

    expect(target).toEqual({ agentId: SLOT });
  });

  it('compare-and-clear: a pause that turns into a kept one before the clear is not lifted', async () => {
    // Another process escalates between the ladder's read and its clear.
    agentState.states.set(AGENT, {
      id: AGENT, status: 'stopped', paused: true, pausedReason: 'needs-you: verification failed 3x',
    });
    agentState.afterRead = (id) => {
      if (id !== AGENT) return;
      agentState.afterRead = undefined;
      agentState.states.set(AGENT, {
        id: AGENT, status: 'stopped', paused: true,
        pausedReason: 'needs-you: verification stuck after 3/3 attempts (test)',
      });
    };

    const target = await resolveIssueFeedbackTarget('PAN-9999', {
      keepPause: (reason) => reason.startsWith('needs-you: verification stuck'),
    });

    expect(agentState.clearPaused).not.toHaveBeenCalled();
    expect(resume.resumeAgent).not.toHaveBeenCalled();
    expect(agentState.states.get(AGENT)).toMatchObject({ paused: true });
    expect(target).toMatchObject({ needsYou: true });
  });

  it('still lifts a pipeline pause that keepPause does not name', async () => {
    agentState.states.set(AGENT, {
      id: AGENT, status: 'stopped', paused: true, pausedReason: 'needs-you: verification failed 3x',
    });

    const target = await resolveIssueFeedbackTarget('PAN-9999', {
      keepPause: (reason) => reason.startsWith('needs-you: verification stuck'),
    });

    expect(agentState.clearPaused).toHaveBeenCalledWith(AGENT);
    expect(target).toEqual({ agentId: AGENT });
  });

  it('clears a troubled gate for one resurrection attempt', async () => {
    agentState.states.set(AGENT, { id: AGENT, status: 'stopped', troubled: true, consecutiveFailures: 3 });

    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(agentState.clearTroubled).toHaveBeenCalledWith(AGENT);
    expect(target).toEqual({ agentId: AGENT });
  });

  it('starts a missing registry agent when its workspace continue state is healthy', async () => {
    filesystem.existingPaths.add('/repo/workspaces/feature-pan-9999');
    filesystem.existingPaths.add('/repo/workspaces/feature-pan-9999/.overdeck');
    filesystem.existingPaths.add('/repo/workspaces/feature-pan-9999/.overdeck/continue.json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(resume.resumeAgent).not.toHaveBeenCalled();
    expect(spawn.workAgent).toHaveBeenCalledWith('PAN-9999', undefined, false, 'resume-agent');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('agent registry row is missing'));
    expect(target).toEqual({ agentId: AGENT });
    warn.mockRestore();
  });

  it('parks needs-you only after resume and start both fail', async () => {
    agentState.states.set(AGENT, { id: AGENT, status: 'stopped' });
    filesystem.existingPaths.add('/repo/workspaces/feature-pan-9999');
    filesystem.existingPaths.add('/repo/workspaces/feature-pan-9999/.overdeck');
    filesystem.existingPaths.add('/repo/workspaces/feature-pan-9999/.overdeck/continue.json');
    resume.resumeAgent.mockResolvedValue({ success: false, error: 'resume failed' });
    spawn.workAgent.mockResolvedValue({ spawned: false, error: 'start failed' });

    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(resume.resumeAgent).toHaveBeenCalledWith(AGENT);
    expect(spawn.workAgent).toHaveBeenCalledWith('PAN-9999', undefined, false, 'resume-agent');
    expect(target).toMatchObject({ needsYou: true });
    expect((target as { reason: string }).reason).toContain('resurrection');
  });

  it('parks needs-you when no agent state or continue state exists', async () => {
    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(resume.resumeAgent).not.toHaveBeenCalled();
    expect(spawn.workAgent).not.toHaveBeenCalled();
    expect(target).toMatchObject({ needsYou: true });
  });
});

describe('surfaceIssueFeedbackNeedsYou (PAN-3917: an announcement, not a flag)', () => {
  const ISSUE = 'PAN-9999';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('announces the reason and the issue on the activity stream', async () => {
    await surfaceIssueFeedbackNeedsYou(ISSUE, 'no live feedback target', { agentId: 'agent-pan-9999' });

    expect(activity.emitActivityEntry).toHaveBeenCalledTimes(1);
    expect(activity.emitActivityEntry).toHaveBeenCalledWith({
      source: 'cloister',
      level: 'warn',
      issueId: ISSUE,
      message: `${ISSUE} needs you: no live feedback target`,
      details: JSON.stringify({ agentId: 'agent-pan-9999' }),
    });
  });

  it('omits the details payload when there is nothing to attach', async () => {
    await surfaceIssueFeedbackNeedsYou(ISSUE, 'no live feedback target');

    expect(activity.emitActivityEntry).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: ISSUE, details: undefined }),
    );
  });

  it('never throws when the announcement itself fails', async () => {
    activity.emitActivityEntry.mockImplementationOnce(() => { throw new Error('feed unavailable'); });

    await expect(
      surfaceIssueFeedbackNeedsYou(ISSUE, 'no live feedback target', {}),
    ).resolves.toBeUndefined();
  });
});
