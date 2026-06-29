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
    paused?: boolean | null;
    troubled?: boolean | null;
    stoppedByUser?: boolean | null;
  }>,
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
}));

vi.mock('../../overdeck/agents.js', () => ({
  listAllAgentsSync: vi.fn(() => mocks.agents),
}));

vi.mock('../../persistent-logger.js', () => ({
  logDeaconEventSync: mocks.logDeaconEventSync,
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

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    testHome = join(tmpdir(), `pan-2076-boot-reconciliation-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    process.env.OVERDECK_HOME = testHome;
    delete process.env.OVERDECK_NO_RESUME;
    delete process.env.OVERDECK_BOOT_ID;
    mocks.agents = [];
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
    const completedWorkspace = join(testHome, 'completed-workspace');
    mkdirSync(join(completedWorkspace, '.pan'), { recursive: true });
    mkdirSync(join(completedWorkspace, '.pan', 'completed.processed'), { recursive: true });

    mocks.agents = [
      { id: 'agent-pan-1', role: 'work', status: 'stopped', workspace: join(testHome, 'plain') },
      { id: 'agent-pan-2', role: 'work', status: 'running', workspace: join(testHome, 'running') },
      { id: 'agent-pan-3', role: 'review', status: 'stopped', workspace: join(testHome, 'review') },
      { id: 'agent-pan-4', role: 'work', status: 'stopped', workspace: join(testHome, 'paused'), paused: true },
      { id: 'agent-pan-5', role: 'work', status: 'stopped', workspace: join(testHome, 'troubled'), troubled: true },
      { id: 'agent-pan-6', role: 'work', status: 'stopped', workspace: join(testHome, 'killed'), stoppedByUser: true },
      { id: 'agent-pan-7', role: 'work', status: 'stopped', workspace: completedWorkspace, stoppedByUser: true },
    ];

    expect(listBootReconciliationCandidateIds()).toEqual(['agent-pan-1', 'agent-pan-7']);
  });

  it('stamps pending state and flips to resume_all when the grace timer expires', async () => {
    const onGraceExpired = vi.fn();
    mocks.agents = [
      { id: 'agent-pan-2076', role: 'work', status: 'stopped', workspace: join(testHome, 'workspace') },
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

  it('uses hold_all immediately when no-resume mode is active at boot', () => {
    mocks.noResumeActive = true;
    mocks.agents = [
      { id: 'agent-pan-2076', role: 'work', status: 'stopped', workspace: join(testHome, 'workspace') },
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
      { id: 'agent-pan-2076', role: 'work', status: 'stopped', workspace: join(testHome, 'workspace') },
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
      { id: 'agent-pan-2076', role: 'work', status: 'stopped', workspace: join(testHome, 'workspace') },
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
