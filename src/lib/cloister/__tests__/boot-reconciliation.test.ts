import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  candidateListBootStartedAt: null as string | null,
  agents: [] as Array<{
    id: string;
    issueId?: string;
    role: string;
    status: string;
    workspace: string | null;
    startedAt?: string | null;
    lastActivity?: string | null;
    stoppedAt?: string | null;
    paused?: boolean | null;
    troubled?: boolean | null;
    stoppedByUser?: boolean | null;
    merged?: boolean | null;
  }>,
  issueStages: {} as Record<string, string | null>,
  reviewStatuses: new Map<string, {
    reviewStatus?: string;
    testStatus?: string;
    readyForMerge?: boolean;
    mergeStatus?: string;
  }>(),
  graceSeconds: 30,
  maxCandidateAgeSeconds: 60 as number | undefined,
  noResumeActive: false,
  logDeaconEventSync: vi.fn(),
  bootState: {
    decision: null as 'pending' | 'resume_all' | 'hold_all' | 'per_agent' | null,
    perAgent: {} as Record<string, 'resume' | 'hold'>,
    decidedAt: null as string | null,
    bootId: null as string | null,
    bootStartedAt: null as string | null,
    graceDeadline: null as string | null,
  },
}));

vi.mock('../config.js', () => ({
  loadCloisterConfigSync: vi.fn(() => ({
    startup: {
      auto_start: true,
      reconciliation_grace_secs: mocks.graceSeconds,
      reconciliation_max_candidate_age_secs: mocks.maxCandidateAgeSeconds,
    },
  })),
}));

vi.mock('../no-resume-mode.js', () => ({
  getNoResumeMode: vi.fn(() => ({ active: mocks.noResumeActive, since: null })),
  // PAN-2278: startBootReconciliation short-circuits to hold_all only on an
  // explicit request; mocks.noResumeActive now models "explicit".
  isExplicitNoResumeRequest: vi.fn(() => mocks.noResumeActive),
}));

vi.mock('../../overdeck/agents.js', () => ({
  listAllAgentsSync: vi.fn(() => {
    mocks.candidateListBootStartedAt = mocks.bootState.bootStartedAt;
    return mocks.agents;
  }),
  getIssueStageSync: vi.fn((issueId: string) => mocks.issueStages[issueId] ?? 'working'),
  isTerminalIssueStage: vi.fn((stage: string | null) =>
    stage === 'verifying_on_main' || stage === 'closed' || stage === 'cancelled',
  ),
}));

vi.mock('../../persistent-logger.js', () => ({
  logDeaconEventSync: mocks.logDeaconEventSync,
}));

vi.mock('../../review-status.js', () => ({
  getReviewStatusSync: vi.fn((issueId: string) => mocks.reviewStatuses.get(issueId) ?? null),
}));

vi.mock('../../overdeck/control-settings.js', () => ({
  getBootReconciliationState: vi.fn(() => ({ ...mocks.bootState })),
  setBootReconciliationDecision: vi.fn((decision, perAgent = {}) => {
    mocks.bootState.decision = decision;
    mocks.bootState.perAgent = perAgent;
    mocks.bootState.decidedAt = new Date().toISOString();
  }),
  stampBootReconciliation: vi.fn((bootId, graceDeadline, bootStartedAt) => {
    mocks.bootState.bootId = bootId;
    mocks.bootState.bootStartedAt = bootStartedAt;
    mocks.bootState.graceDeadline = graceDeadline;
  }),
}));

import {
  clearBootReconciliationGraceTimer,
  DEFAULT_BOOT_RECONCILIATION_GRACE_SECS,
  getBootReconciliationGraceSeconds,
  getBootReconciliationMaxCandidateAgeSeconds,
  isBootReconciliationCandidate,
  listBootReconciliationCandidateIds,
  startBootReconciliation,
} from '../boot-reconciliation.js';
import {
  getBootReconciliationState,
  setBootReconciliationDecision,
  stampBootReconciliation,
} from '../../overdeck/control-settings.js';

const BASE_TIME = new Date('2026-06-29T15:00:00.000Z');
const RECENT_ACTIVITY = '2026-06-29T14:59:50.000Z';

function workspacePath(testHome: string, name: string): string {
  const workspace = join(testHome, name);
  mkdirSync(workspace, { recursive: true });
  return workspace;
}

function stoppedWorkAgent(
  testHome: string,
  id: string,
  overrides: Partial<typeof mocks.agents[number]> = {},
): typeof mocks.agents[number] {
  return {
    id,
    issueId: id.replace('agent-', 'PAN-').toUpperCase(),
    role: 'work',
    status: 'stopped',
    workspace: workspacePath(testHome, id),
    lastActivity: RECENT_ACTIVITY,
    ...overrides,
  };
}

describe('boot reconciliation', () => {
  let testHome: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    testHome = join(tmpdir(), `pan-2076-boot-reconciliation-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    process.env.OVERDECK_HOME = testHome;
    delete process.env.OVERDECK_NO_RESUME;
    delete process.env.OVERDECK_BOOT_ID;
    mocks.candidateListBootStartedAt = null;
    mocks.agents = [];
    mocks.issueStages = {};
    mocks.reviewStatuses.clear();
    mocks.graceSeconds = 30;
    mocks.maxCandidateAgeSeconds = 60;
    mocks.noResumeActive = false;
    mocks.logDeaconEventSync.mockClear();
    mocks.bootState = {
      decision: null,
      perAgent: {},
      decidedAt: null,
      bootId: null,
      bootStartedAt: null,
      graceDeadline: null,
    };
    vi.mocked(setBootReconciliationDecision).mockClear();
    vi.mocked(stampBootReconciliation).mockClear();
  });

  afterEach(() => {
    clearBootReconciliationGraceTimer();
    vi.useRealTimers();
    delete process.env.OVERDECK_HOME;
    delete process.env.OVERDECK_NO_RESUME;
    delete process.env.OVERDECK_BOOT_ID;
    rmSync(testHome, { recursive: true, force: true });
  });

  it('uses the 120 second default grace when config is invalid', () => {
    mocks.graceSeconds = 0;

    expect(DEFAULT_BOOT_RECONCILIATION_GRACE_SECS).toBe(120);
    expect(getBootReconciliationGraceSeconds()).toBe(120);
  });

  it('keeps a positive configured grace override', () => {
    mocks.graceSeconds = 45;

    expect(getBootReconciliationGraceSeconds()).toBe(45);
  });

  it('uses the configured max candidate age and falls back to 2x grace when invalid', () => {
    mocks.maxCandidateAgeSeconds = 90;
    expect(getBootReconciliationMaxCandidateAgeSeconds()).toBe(90);

    mocks.maxCandidateAgeSeconds = 0;
    expect(getBootReconciliationMaxCandidateAgeSeconds()).toBe(60);

    mocks.graceSeconds = 45;
    mocks.maxCandidateAgeSeconds = undefined;
    expect(getBootReconciliationMaxCandidateAgeSeconds()).toBe(90);
  });

  it('lists only stopped work agents that are resumable boot reconciliation candidates', () => {
    mocks.bootState.bootStartedAt = BASE_TIME.toISOString();
    const completedWorkspace = join(testHome, 'completed-workspace');
    mkdirSync(join(completedWorkspace, '.pan'), { recursive: true });
    mkdirSync(join(completedWorkspace, '.pan', 'completed.processed'), { recursive: true });

    mocks.agents = [
      stoppedWorkAgent(testHome, 'agent-pan-1', { workspace: workspacePath(testHome, 'plain') }),
      stoppedWorkAgent(testHome, 'agent-pan-2', { status: 'running', workspace: workspacePath(testHome, 'running') }),
      stoppedWorkAgent(testHome, 'agent-pan-3', { role: 'review', workspace: workspacePath(testHome, 'review') }),
      stoppedWorkAgent(testHome, 'agent-pan-4', { workspace: workspacePath(testHome, 'paused'), paused: true }),
      stoppedWorkAgent(testHome, 'agent-pan-5', { workspace: workspacePath(testHome, 'troubled'), troubled: true }),
      stoppedWorkAgent(testHome, 'agent-pan-6', { workspace: workspacePath(testHome, 'killed'), stoppedByUser: true }),
      stoppedWorkAgent(testHome, 'agent-pan-7', { workspace: completedWorkspace, stoppedByUser: true }),
    ];

    expect(listBootReconciliationCandidateIds()).toEqual(['agent-pan-1', 'agent-pan-7']);
  });

  it('rejects stale or missing-workspace stopped work agents', () => {
    mocks.bootState.bootStartedAt = BASE_TIME.toISOString();

    expect(isBootReconciliationCandidate(stoppedWorkAgent(testHome, 'agent-stale', {
      lastActivity: '2026-06-17T03:00:00.000Z',
    }))).toBe(false);
    expect(isBootReconciliationCandidate(stoppedWorkAgent(testHome, 'agent-missing-workspace', {
      workspace: join(testHome, 'missing-workspace'),
    }))).toBe(false);
  });

  it('accepts recent stopped work agents with a live workspace and open issue', () => {
    mocks.bootState.bootStartedAt = BASE_TIME.toISOString();
    const agent = stoppedWorkAgent(testHome, 'agent-recent', {
      issueId: 'PAN-RECENT',
      stoppedAt: '2026-06-29T14:59:58.000Z',
    });
    mocks.issueStages['PAN-RECENT'] = 'working';

    expect(isBootReconciliationCandidate(agent)).toBe(true);
  });

  it('rejects stopped work agents whose issue stage is terminal', () => {
    mocks.bootState.bootStartedAt = BASE_TIME.toISOString();

    for (const stage of ['verifying_on_main', 'closed', 'cancelled']) {
      const issueId = `PAN-${stage}`;
      mocks.issueStages[issueId] = stage;
      expect(isBootReconciliationCandidate(stoppedWorkAgent(testHome, `agent-${stage}`, { issueId }))).toBe(false);
    }
  });

  it('returns no candidates when stopped work agents are stale, terminal, or workspace-gone', () => {
    mocks.bootState.bootStartedAt = BASE_TIME.toISOString();
    mocks.issueStages['PAN-TERMINAL'] = 'verifying_on_main';
    mocks.agents = [
      stoppedWorkAgent(testHome, 'agent-stale', { lastActivity: '2026-06-17T03:00:00.000Z' }),
      stoppedWorkAgent(testHome, 'agent-terminal', { issueId: 'PAN-TERMINAL' }),
      stoppedWorkAgent(testHome, 'agent-missing', { workspace: join(testHome, 'missing') }),
    ];

    expect(listBootReconciliationCandidateIds()).toEqual([]);
  });

  it('rejects already-merged and completed-passed agents while preserving a genuinely stopped candidate', () => {
    mocks.bootState.bootStartedAt = BASE_TIME.toISOString();
    const completedAgentDir = join(testHome, 'agents', 'agent-completed');
    mkdirSync(completedAgentDir, { recursive: true });
    writeFileSync(join(completedAgentDir, 'completed.processed'), '');
    mocks.reviewStatuses.set('PAN-MERGED', { mergeStatus: 'merged' });
    mocks.reviewStatuses.set('PAN-COMPLETED', { reviewStatus: 'passed', testStatus: 'passed' });
    mocks.agents = [
      stoppedWorkAgent(testHome, 'agent-live', { issueId: 'PAN-LIVE' }),
      stoppedWorkAgent(testHome, 'agent-merged', { issueId: 'PAN-MERGED' }),
      stoppedWorkAgent(testHome, 'agent-completed', { issueId: 'PAN-COMPLETED' }),
    ];

    expect(listBootReconciliationCandidateIds()).toEqual(['agent-live']);
  });

  it('PAN-2510: opens the grace window in pending on an empty candidate list, then resolves resume_all at expiry', async () => {
    // An empty candidate list at stamp time is ambiguous: it can mean "genuinely
    // nothing to resume" (only phantoms) OR "the deacon child has not marked the
    // crashed agents `stopped` yet" (the cross-process boot race). We can't tell
    // the two apart synchronously, so we must open the grace window in `pending`
    // rather than terminally committing resume_all — otherwise the operator
    // dialog is skipped and late-arriving candidates auto-resume ungated.
    const onGraceExpired = vi.fn();
    const completedAgentDir = join(testHome, 'agents', 'agent-completed');
    mkdirSync(completedAgentDir, { recursive: true });
    writeFileSync(join(completedAgentDir, 'completed.processed'), '');
    mocks.issueStages['PAN-TERMINAL'] = 'verifying_on_main';
    mocks.reviewStatuses.set('PAN-MERGED', { mergeStatus: 'merged' });
    mocks.reviewStatuses.set('PAN-COMPLETED', { reviewStatus: 'passed', testStatus: 'passed' });
    mocks.agents = [
      stoppedWorkAgent(testHome, 'agent-missing', { workspace: join(testHome, 'missing') }),
      stoppedWorkAgent(testHome, 'agent-merged', { issueId: 'PAN-MERGED' }),
      stoppedWorkAgent(testHome, 'agent-completed', { issueId: 'PAN-COMPLETED' }),
      stoppedWorkAgent(testHome, 'agent-terminal', { issueId: 'PAN-TERMINAL' }),
    ];

    const result = startBootReconciliation({
      bootId: 'boot-phantoms',
      now: BASE_TIME,
      onGraceExpired,
    });

    expect(result).toEqual({
      bootId: 'boot-phantoms',
      graceDeadline: '2026-06-29T15:00:30.000Z',
      candidateIds: [],
      decision: 'pending',
      timerArmed: true,
    });
    expect(getBootReconciliationState()).toMatchObject({
      decision: 'pending',
      bootId: 'boot-phantoms',
      bootStartedAt: '2026-06-29T15:00:00.000Z',
      graceDeadline: '2026-06-29T15:00:30.000Z',
    });

    // Still nothing genuine to resume by the deadline → harmless resume_all no-op.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getBootReconciliationState().decision).toBe('resume_all');
    expect(onGraceExpired).toHaveBeenCalledTimes(1);
  });

  it('PAN-2510: holds late-materializing candidates that reconcile in during the grace window (full-reboot race)', () => {
    // Simulates the OOM / power-cycle race: at stamp time the crashed agents are
    // still marked `running` in the table (0 candidates), then the deacon child's
    // reconcileAgentLiveness marks them `stopped` ~1s later. The decision must
    // remain `pending` so the live-computed held set picks them up and the
    // operator dialog renders — it must NOT have been locked to resume_all.
    mocks.agents = [
      stoppedWorkAgent(testHome, 'agent-crashed', {
        status: 'running',
        workspace: workspacePath(testHome, 'crashed'),
      }),
    ];

    const result = startBootReconciliation({ bootId: 'boot-reboot', now: BASE_TIME });
    expect(result.candidateIds).toEqual([]);
    expect(result.decision).toBe('pending');
    expect(result.timerArmed).toBe(true);

    // Deacon child reconciliation lands: the agent flips to `stopped`.
    mocks.agents[0].status = 'stopped';
    mocks.agents[0].stoppedAt = '2026-06-29T15:00:01.000Z';

    // The candidate is now discoverable, and the boot decision is still pending
    // (not terminally resume_all), so it will be held and surfaced in the dialog.
    expect(listBootReconciliationCandidateIds()).toEqual(['agent-crashed']);
    expect(getBootReconciliationState().decision).toBe('pending');
  });

  it('stamps pending state and flips to resume_all when the grace timer expires', async () => {
    const onGraceExpired = vi.fn();
    mocks.agents = [
      stoppedWorkAgent(testHome, 'agent-pan-2076', { workspace: workspacePath(testHome, 'workspace') }),
    ];

    const result = startBootReconciliation({
      bootId: 'boot-test',
      now: BASE_TIME,
      onGraceExpired,
    });

    expect(result).toEqual({
      bootId: 'boot-test',
      graceDeadline: '2026-06-29T15:00:30.000Z',
      candidateIds: ['agent-pan-2076'],
      decision: 'pending',
      timerArmed: true,
    });
    expect(getBootReconciliationState()).toMatchObject({
      decision: 'pending',
      bootId: 'boot-test',
      bootStartedAt: '2026-06-29T15:00:00.000Z',
      graceDeadline: '2026-06-29T15:00:30.000Z',
    });
    expect(mocks.candidateListBootStartedAt).toBe('2026-06-29T15:00:00.000Z');

    await vi.advanceTimersByTimeAsync(30_000);

    expect(getBootReconciliationState().decision).toBe('resume_all');
    expect(onGraceExpired).toHaveBeenCalledTimes(1);
  });

  it('uses hold_all immediately when an explicit no-resume request is active at boot', () => {
    mocks.noResumeActive = true;
    mocks.agents = [
      stoppedWorkAgent(testHome, 'agent-pan-2076', { workspace: workspacePath(testHome, 'workspace') }),
    ];

    const result = startBootReconciliation({
      bootId: 'boot-no-resume',
      now: BASE_TIME,
    });

    expect(result.decision).toBe('hold_all');
    expect(result.timerArmed).toBe(false);
    expect(getBootReconciliationState()).toMatchObject({
      decision: 'hold_all',
      bootId: 'boot-no-resume',
      bootStartedAt: '2026-06-29T15:00:00.000Z',
      graceDeadline: '2026-06-29T15:00:30.000Z',
    });
  });

  it('preserves an already-written same-boot decision without re-prompting', () => {
    mocks.bootState = {
      decision: 'resume_all',
      perAgent: {},
      decidedAt: '2026-06-29T15:00:05.000Z',
      bootId: 'boot-watchdog',
      bootStartedAt: '2026-06-29T15:00:00.000Z',
      graceDeadline: '2026-06-29T15:00:30.000Z',
    };
    mocks.agents = [
      stoppedWorkAgent(testHome, 'agent-pan-2076', {
        workspace: workspacePath(testHome, 'workspace'),
        stoppedAt: '2026-06-29T15:01:58.000Z',
      }),
    ];

    const result = startBootReconciliation({
      bootId: 'boot-watchdog',
      now: new Date('2026-06-29T15:01:00.000Z'),
    });

    expect(result).toEqual({
      bootId: 'boot-watchdog',
      graceDeadline: '2026-06-29T15:00:30.000Z',
      candidateIds: ['agent-pan-2076'],
      decision: 'resume_all',
      timerArmed: false,
    });
    expect(stampBootReconciliation).not.toHaveBeenCalled();
    expect(setBootReconciliationDecision).not.toHaveBeenCalled();
    expect(getBootReconciliationState()).toMatchObject({
      decision: 'resume_all',
      bootId: 'boot-watchdog',
      bootStartedAt: '2026-06-29T15:00:00.000Z',
      graceDeadline: '2026-06-29T15:00:30.000Z',
    });
  });

  it('uses a fresh boot id to re-open the grace window', () => {
    mocks.bootState = {
      decision: 'resume_all',
      perAgent: {},
      decidedAt: '2026-06-29T15:00:05.000Z',
      bootId: 'boot-watchdog',
      bootStartedAt: '2026-06-29T15:00:00.000Z',
      graceDeadline: '2026-06-29T15:00:30.000Z',
    };
    mocks.agents = [
      stoppedWorkAgent(testHome, 'agent-pan-2076', {
        workspace: workspacePath(testHome, 'workspace'),
        stoppedAt: '2026-06-29T15:01:58.000Z',
      }),
    ];

    const result = startBootReconciliation({
      bootId: 'boot-fresh',
      now: new Date('2026-06-29T15:02:00.000Z'),
    });

    expect(result).toEqual({
      bootId: 'boot-fresh',
      graceDeadline: '2026-06-29T15:02:30.000Z',
      candidateIds: ['agent-pan-2076'],
      decision: 'pending',
      timerArmed: true,
    });
    expect(stampBootReconciliation).toHaveBeenCalledWith(
      'boot-fresh',
      '2026-06-29T15:02:30.000Z',
      '2026-06-29T15:02:00.000Z',
    );
    expect(setBootReconciliationDecision).toHaveBeenCalledWith('pending');
    expect(getBootReconciliationState()).toMatchObject({
      decision: 'pending',
      bootId: 'boot-fresh',
      bootStartedAt: '2026-06-29T15:02:00.000Z',
      graceDeadline: '2026-06-29T15:02:30.000Z',
    });
  });
});
