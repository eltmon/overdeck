import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  agents: [] as Array<{
    id: string;
    role: string;
    status: string;
    workspace: string | null;
    issueId?: string;
    merged?: boolean | null;
    paused?: boolean | null;
    troubled?: boolean | null;
    stoppedByUser?: boolean | null;
  }>,
  reviewStatuses: new Map<string, unknown>(),
  graceSeconds: 30,
  noResumeActive: false,
  logDeaconEventSync: vi.fn(),
  bootState: {
    decision: null as 'pending' | 'resume_all' | 'hold_all' | 'per_agent' | null,
    perAgent: {} as Record<string, 'resume' | 'hold'>,
    decidedAt: null as string | null,
    bootId: null as string | null,
    graceDeadline: null as string | null,
  },
}));

vi.mock('../config.js', () => ({
  loadCloisterConfigSync: vi.fn(() => ({
    startup: {
      auto_start: true,
      reconciliation_grace_secs: mocks.graceSeconds,
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
  listAllAgentsSync: vi.fn(() => mocks.agents),
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
  stampBootReconciliation: vi.fn((bootId, graceDeadline) => {
    mocks.bootState.bootId = bootId;
    mocks.bootState.graceDeadline = graceDeadline;
  }),
}));

import {
  clearBootReconciliationGraceTimer,
  listBootReconciliationCandidateIds,
  startBootReconciliation,
} from '../boot-reconciliation.js';
import {
  getBootReconciliationState,
  setBootReconciliationDecision,
  stampBootReconciliation,
} from '../../overdeck/control-settings.js';

const BASE_TIME = new Date('2026-06-29T15:00:00.000Z');

describe('boot reconciliation', () => {
  let testHome: string;

  function makeWorkspace(name: string): string {
    const workspace = join(testHome, name);
    mkdirSync(workspace, { recursive: true });
    return workspace;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    testHome = join(tmpdir(), `pan-2076-boot-reconciliation-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    process.env.OVERDECK_HOME = testHome;
    delete process.env.OVERDECK_NO_RESUME;
    delete process.env.OVERDECK_BOOT_ID;
    mocks.agents = [];
    mocks.reviewStatuses.clear();
    mocks.graceSeconds = 30;
    mocks.noResumeActive = false;
    mocks.logDeaconEventSync.mockClear();
    mocks.bootState = {
      decision: null,
      perAgent: {},
      decidedAt: null,
      bootId: null,
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

  it('lists only stopped work agents that are resumable boot reconciliation candidates', () => {
    const completedWorkspace = makeWorkspace('completed-workspace');
    mkdirSync(join(completedWorkspace, '.pan'), { recursive: true });
    mkdirSync(join(completedWorkspace, '.pan', 'completed.processed'), { recursive: true });

    mocks.agents = [
      { id: 'agent-pan-1', issueId: 'PAN-1', role: 'work', status: 'stopped', workspace: makeWorkspace('plain') },
      { id: 'agent-pan-2', issueId: 'PAN-2', role: 'work', status: 'running', workspace: join(testHome, 'running') },
      { id: 'agent-pan-3', issueId: 'PAN-3', role: 'review', status: 'stopped', workspace: join(testHome, 'review') },
      { id: 'agent-pan-4', issueId: 'PAN-4', role: 'work', status: 'stopped', workspace: join(testHome, 'paused'), paused: true },
      { id: 'agent-pan-5', issueId: 'PAN-5', role: 'work', status: 'stopped', workspace: join(testHome, 'troubled'), troubled: true },
      { id: 'agent-pan-6', issueId: 'PAN-6', role: 'work', status: 'stopped', workspace: join(testHome, 'killed'), stoppedByUser: true },
      { id: 'agent-pan-7', issueId: 'PAN-7', role: 'work', status: 'stopped', workspace: completedWorkspace, stoppedByUser: true },
    ];

    expect(listBootReconciliationCandidateIds()).toEqual(['agent-pan-1', 'agent-pan-7']);
  });

  it('excludes workspace-missing, merged, and completed-passed agents from boot candidates', () => {
    const completedAgentDir = join(testHome, 'agents', 'agent-completed');
    mkdirSync(completedAgentDir, { recursive: true });
    mkdirSync(join(completedAgentDir, 'completed'), { recursive: true });
    mocks.reviewStatuses.set('PAN-MERGED', {
      issueId: 'PAN-MERGED',
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'merged',
      readyForMerge: false,
    });
    mocks.reviewStatuses.set('PAN-COMPLETED', {
      issueId: 'PAN-COMPLETED',
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'pending',
      readyForMerge: false,
    });
    mocks.agents = [
      { id: 'agent-missing', issueId: 'PAN-MISSING', role: 'work', status: 'stopped', workspace: join(testHome, 'missing') },
      { id: 'agent-merged', issueId: 'PAN-MERGED', role: 'work', status: 'stopped', workspace: makeWorkspace('merged') },
      { id: 'agent-completed', issueId: 'PAN-COMPLETED', role: 'work', status: 'stopped', workspace: makeWorkspace('completed') },
      { id: 'agent-clean', issueId: 'PAN-CLEAN', role: 'work', status: 'stopped', workspace: makeWorkspace('clean') },
    ];

    expect(listBootReconciliationCandidateIds()).toEqual(['agent-clean']);
  });

  it('marks resume_all without a held modal when only phantom stopped work agents exist', () => {
    mocks.agents = [
      { id: 'agent-missing', issueId: 'PAN-MISSING', role: 'work', status: 'stopped', workspace: join(testHome, 'missing') },
      { id: 'agent-merged', issueId: 'PAN-MERGED', role: 'work', status: 'stopped', workspace: makeWorkspace('merged') },
    ];
    mocks.reviewStatuses.set('PAN-MERGED', {
      issueId: 'PAN-MERGED',
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'merged',
      readyForMerge: false,
    });

    const result = startBootReconciliation({
      bootId: 'boot-phantoms',
      now: BASE_TIME,
    });

    expect(result).toEqual({
      bootId: 'boot-phantoms',
      graceDeadline: '2026-06-29T15:00:30.000Z',
      candidateIds: [],
      decision: 'resume_all',
      timerArmed: false,
    });
    expect(getBootReconciliationState()).toMatchObject({
      decision: 'resume_all',
      bootId: 'boot-phantoms',
      graceDeadline: '2026-06-29T15:00:30.000Z',
    });
  });

  it('stamps pending state and flips to resume_all when the grace timer expires', async () => {
    const onGraceExpired = vi.fn();
    mocks.agents = [
      { id: 'agent-pan-2076', issueId: 'PAN-2076', role: 'work', status: 'stopped', workspace: makeWorkspace('workspace') },
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
      graceDeadline: '2026-06-29T15:00:30.000Z',
    });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(getBootReconciliationState().decision).toBe('resume_all');
    expect(onGraceExpired).toHaveBeenCalledTimes(1);
  });

  it('uses hold_all immediately when an explicit no-resume request is active at boot', () => {
    mocks.noResumeActive = true;
    mocks.agents = [
      { id: 'agent-pan-2076', issueId: 'PAN-2076', role: 'work', status: 'stopped', workspace: makeWorkspace('workspace') },
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
      graceDeadline: '2026-06-29T15:00:30.000Z',
    });
  });

  it('preserves an already-written same-boot decision without re-prompting', () => {
    mocks.bootState = {
      decision: 'resume_all',
      perAgent: {},
      decidedAt: '2026-06-29T15:00:05.000Z',
      bootId: 'boot-watchdog',
      graceDeadline: '2026-06-29T15:00:30.000Z',
    };
    mocks.agents = [
      { id: 'agent-pan-2076', issueId: 'PAN-2076', role: 'work', status: 'stopped', workspace: makeWorkspace('workspace') },
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
      graceDeadline: '2026-06-29T15:00:30.000Z',
    });
  });

  it('uses a fresh boot id to re-open the grace window', () => {
    mocks.bootState = {
      decision: 'resume_all',
      perAgent: {},
      decidedAt: '2026-06-29T15:00:05.000Z',
      bootId: 'boot-watchdog',
      graceDeadline: '2026-06-29T15:00:30.000Z',
    };
    mocks.agents = [
      { id: 'agent-pan-2076', issueId: 'PAN-2076', role: 'work', status: 'stopped', workspace: makeWorkspace('workspace') },
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
    expect(stampBootReconciliation).toHaveBeenCalledWith('boot-fresh', '2026-06-29T15:02:30.000Z');
    expect(setBootReconciliationDecision).toHaveBeenCalledWith('pending');
    expect(getBootReconciliationState()).toMatchObject({
      decision: 'pending',
      bootId: 'boot-fresh',
      graceDeadline: '2026-06-29T15:02:30.000Z',
    });
  });
});
