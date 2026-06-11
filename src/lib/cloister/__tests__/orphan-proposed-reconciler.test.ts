import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const activityLogger = vi.hoisted(() => ({
  emitActivityEntrySync: vi.fn(),
}));

const reviewStatusStore = vi.hoisted(() => ({
  getReviewStatusSync: vi.fn(() => null),
}));

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntrySync: activityLogger.emitActivityEntrySync,
}));

vi.mock('../../review-status.js', () => ({
  getReviewStatusSync: reviewStatusStore.getReviewStatusSync,
}));

import {
  clearOrphanProposedAttemptCooldowns,
  findOrphanProposedSpecsForReconciler,
  hasReviewPipelinePresence,
  reconcileOrphanProposedSpecs,
  spawnWorkAgentThroughAgentsEndpoint,
} from '../orphan-proposed-reconciler.js';

let testDir: string;

function writeSpec(projectPath: string, issueId: string, status: string, planItemCount = 2): void {
  const specsDir = join(projectPath, '.pan', 'specs');
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(join(specsDir, `${issueId}.vbrief.json`), JSON.stringify({
    vBRIEFInfo: { version: '0.5', created: '2026-05-25T00:00:00.000Z' },
    plan: {
      id: issueId,
      title: issueId,
      status,
      items: Array.from({ length: planItemCount }, (_, index) => ({ id: `item-${index + 1}`, title: `Item ${index + 1}` })),
      edges: [],
    },
  }, null, 2));
}

function writeBeads(projectPath: string, issueId: string, beadCount = 2): void {
  const beadsDir = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`, '.beads');
  mkdirSync(beadsDir, { recursive: true });
  const lines = Array.from({ length: beadCount }, (_, index) => JSON.stringify({
    _type: 'issue',
    id: `workspace-${issueId.toLowerCase()}-${index + 1}`,
    title: `${issueId} bead ${index + 1}`,
    labels: [issueId.toLowerCase()],
  }));
  writeFileSync(join(beadsDir, 'issues.jsonl'), lines.join('\n'));
}

function writeRedirectBeads(projectPath: string, issueId: string, beadCount = 2): void {
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  const workspaceBeadsDir = join(workspacePath, '.beads');
  const sharedBeadsDir = join(projectPath, '.beads');
  mkdirSync(workspaceBeadsDir, { recursive: true });
  mkdirSync(sharedBeadsDir, { recursive: true });
  const lines = Array.from({ length: beadCount }, (_, index) => JSON.stringify({
    _type: 'issue',
    id: `shared-${issueId.toLowerCase()}-${index + 1}`,
    title: `${issueId} bead ${index + 1}`,
    labels: [issueId.toLowerCase()],
  }));
  writeFileSync(join(workspaceBeadsDir, 'redirect'), '../../.beads');
  writeFileSync(join(sharedBeadsDir, 'issues.jsonl'), lines.join('\n'));
}

describe('orphan proposed spec reconciler', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'orphan-proposed-reconciler-'));
    activityLogger.emitActivityEntrySync.mockReset();
    reviewStatusStore.getReviewStatusSync.mockReset();
    reviewStatusStore.getReviewStatusSync.mockReturnValue(null);
    clearOrphanProposedAttemptCooldowns();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearOrphanProposedAttemptCooldowns();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('returns false when review pipeline status is absent or all pending', () => {
    expect(hasReviewPipelinePresence(null)).toBe(false);
    expect(hasReviewPipelinePresence({
      reviewStatus: 'pending',
      testStatus: 'pending',
      readyForMerge: false,
    })).toBe(false);
  });

  it.each([
    ['reviewStatus beyond pending', { reviewStatus: 'reviewing', testStatus: 'pending', readyForMerge: false }],
    ['testStatus skipped', { reviewStatus: 'pending', testStatus: 'skipped', readyForMerge: false }],
    ['mergeStatus beyond pending', { reviewStatus: 'pending', testStatus: 'pending', mergeStatus: 'queued', readyForMerge: false }],
    ['readyForMerge true', { reviewStatus: 'pending', testStatus: 'pending', readyForMerge: true }],
    ['prNumber set', { reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, prNumber: 1707 }],
    ['prUrl set', { reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1707' }],
  ] as const)('returns true for %s', (_label, status) => {
    expect(hasReviewPipelinePresence(status)).toBe(true);
  });

  it('excludes in-review issues with stopped work agents before spawning', async () => {
    const projectPath = join(testDir, 'project');
    mkdirSync(projectPath, { recursive: true });
    writeSpec(projectPath, 'PAN-3401', 'proposed');
    writeBeads(projectPath, 'PAN-3401');
    const spawnWorkAgent = vi.fn(async () => ({ spawned: true, agentId: 'agent-pan-3401' }));
    const getReviewStatusForIssue = vi.fn(() => ({
      reviewStatus: 'passed' as const,
      testStatus: 'pending' as const,
      readyForMerge: false,
      prNumber: 1707,
    }));
    const options = {
      projects: [{ key: 'panopticon', config: { name: 'Panopticon CLI', path: projectPath } }],
      tmuxSessionNames: [] as string[],
      getAgentStateForIssue: async () => ({ status: 'stopped' as const, paused: false, troubled: false }),
      getReviewStatusForIssue,
      closedIssueIds: new Set<string>(),
    };

    await expect(findOrphanProposedSpecsForReconciler(options)).resolves.toEqual([]);
    await expect(reconcileOrphanProposedSpecs({
      ...options,
      now: new Date('2026-05-25T20:00:00.000Z'),
      config: { enabled: true, minAttemptIntervalMs: 5 * 60 * 1000 },
      spawnWorkAgent,
    })).resolves.toEqual([]);

    expect(spawnWorkAgent).not.toHaveBeenCalled();
    expect(activityLogger.emitActivityEntrySync).not.toHaveBeenCalled();
  });

  it('keeps all-pending review status rows eligible as candidates', async () => {
    const projectPath = join(testDir, 'project');
    mkdirSync(projectPath, { recursive: true });
    writeSpec(projectPath, 'PAN-3402', 'proposed');
    writeBeads(projectPath, 'PAN-3402');

    await expect(findOrphanProposedSpecsForReconciler({
      projects: [{ key: 'panopticon', config: { name: 'Panopticon CLI', path: projectPath } }],
      tmuxSessionNames: [],
      getAgentStateForIssue: async () => null,
      getReviewStatusForIssue: () => ({
        reviewStatus: 'pending',
        testStatus: 'pending',
        readyForMerge: false,
      }),
      closedIssueIds: new Set(),
    })).resolves.toEqual([
      expect.objectContaining({
        issueId: 'PAN-3402',
        beadCount: 2,
        planItemCount: 2,
      }),
    ]);
  });

  it('uses the default review status reader and keeps review-status exclusions out of the activity feed', async () => {
    const projectPath = join(testDir, 'project');
    mkdirSync(projectPath, { recursive: true });
    writeSpec(projectPath, 'PAN-3403', 'proposed');
    writeBeads(projectPath, 'PAN-3403');
    reviewStatusStore.getReviewStatusSync.mockReturnValue({
      reviewStatus: 'passed',
      testStatus: 'pending',
      readyForMerge: false,
      prNumber: 1707,
    });

    await expect(findOrphanProposedSpecsForReconciler({
      projects: [{ key: 'panopticon', config: { name: 'Panopticon CLI', path: projectPath } }],
      tmuxSessionNames: [],
      getAgentStateForIssue: async () => null,
      closedIssueIds: new Set(),
    })).resolves.toEqual([]);

    expect(reviewStatusStore.getReviewStatusSync).toHaveBeenCalledWith('PAN-3403');
    expect(activityLogger.emitActivityEntrySync).not.toHaveBeenCalled();
  });

  it('detects proposed orphan specs and skips active, paused, and completed issues', async () => {
    const projectPath = join(testDir, 'project');
    mkdirSync(projectPath, { recursive: true });
    writeSpec(projectPath, 'PAN-3001', 'proposed');
    writeBeads(projectPath, 'PAN-3001');
    writeSpec(projectPath, 'PAN-3002', 'proposed');
    writeBeads(projectPath, 'PAN-3002');
    writeSpec(projectPath, 'PAN-3003', 'proposed');
    writeBeads(projectPath, 'PAN-3003');
    writeSpec(projectPath, 'PAN-3004', 'completed');
    writeBeads(projectPath, 'PAN-3004');

    await expect(findOrphanProposedSpecsForReconciler({
      projects: [{ key: 'panopticon', config: { name: 'Panopticon CLI', path: projectPath } }],
      tmuxSessionNames: ['agent-pan-3002'],
      getAgentStateForIssue: async (agentId) => agentId === 'agent-pan-3003'
        ? { status: 'stopped', paused: true, troubled: false }
        : null,
      closedIssueIds: new Set(),
    })).resolves.toEqual([
      expect.objectContaining({
        projectKey: 'panopticon',
        projectName: 'Panopticon CLI',
        issueId: 'PAN-3001',
        beadCount: 2,
        planItemCount: 2,
      }),
    ]);
  });

  it('excludes issues with live issue-scoped pipeline tmux sessions', async () => {
    const projectPath = join(testDir, 'project');
    mkdirSync(projectPath, { recursive: true });
    writeSpec(projectPath, 'PAN-3501', 'proposed');
    writeBeads(projectPath, 'PAN-3501');

    await expect(findOrphanProposedSpecsForReconciler({
      projects: [{ key: 'panopticon', config: { name: 'Panopticon CLI', path: projectPath } }],
      tmuxSessionNames: ['agent-pan-3501-review-security'],
      getAgentStateForIssue: async () => null,
      closedIssueIds: new Set(),
    })).resolves.toEqual([]);
  });

  it('does not treat longer issue-number sessions as issue-scoped matches', async () => {
    const projectPath = join(testDir, 'project');
    mkdirSync(projectPath, { recursive: true });
    writeSpec(projectPath, 'PAN-3501', 'proposed');
    writeBeads(projectPath, 'PAN-3501');

    await expect(findOrphanProposedSpecsForReconciler({
      projects: [{ key: 'panopticon', config: { name: 'Panopticon CLI', path: projectPath } }],
      tmuxSessionNames: ['agent-pan-35011-review-security'],
      getAgentStateForIssue: async () => null,
      closedIssueIds: new Set(),
    })).resolves.toEqual([
      expect.objectContaining({ issueId: 'PAN-3501' }),
    ]);
  });

  it('detects proposed orphan specs with redirect-backed beads stores', async () => {
    const projectPath = join(testDir, 'project');
    mkdirSync(projectPath, { recursive: true });
    writeSpec(projectPath, 'PAN-3005', 'proposed');
    writeRedirectBeads(projectPath, 'PAN-3005');

    await expect(findOrphanProposedSpecsForReconciler({
      projects: [{ key: 'panopticon', config: { name: 'Panopticon CLI', path: projectPath } }],
      tmuxSessionNames: [],
      getAgentStateForIssue: async () => null,
      closedIssueIds: new Set(),
    })).resolves.toEqual([
      expect.objectContaining({
        issueId: 'PAN-3005',
        beadCount: 2,
        planItemCount: 2,
      }),
    ]);
  });

  it('spawns each orphan at most once per five minutes', async () => {
    const projectPath = join(testDir, 'project');
    mkdirSync(projectPath, { recursive: true });
    writeSpec(projectPath, 'PAN-3101', 'proposed');
    writeBeads(projectPath, 'PAN-3101');
    const spawnWorkAgent = vi.fn(async () => ({ spawned: true, agentId: 'agent-pan-3101' }));
    const projects = [{ key: 'panopticon', config: { name: 'Panopticon CLI', path: projectPath } }];

    await expect(reconcileOrphanProposedSpecs({
      projects,
      tmuxSessionNames: [],
      getAgentStateForIssue: async () => null,
      closedIssueIds: new Set(),
      now: new Date('2026-05-25T20:00:00.000Z'),
      config: { enabled: true, minAttemptIntervalMs: 5 * 60 * 1000 },
      spawnWorkAgent,
    })).resolves.toEqual(['Spawned work agent for orphan proposed spec PAN-3101']);

    await expect(reconcileOrphanProposedSpecs({
      projects,
      tmuxSessionNames: [],
      getAgentStateForIssue: async () => null,
      closedIssueIds: new Set(),
      now: new Date('2026-05-25T20:01:00.000Z'),
      config: { enabled: true, minAttemptIntervalMs: 5 * 60 * 1000 },
      spawnWorkAgent,
    })).resolves.toEqual([]);

    expect(spawnWorkAgent).toHaveBeenCalledTimes(1);
  });

  it('surfaces only the actioned spawn outcome in the activity feed, with a human-readable message (PAN-1626)', async () => {
    const projectPath = join(testDir, 'project');
    mkdirSync(projectPath, { recursive: true });
    writeSpec(projectPath, 'PAN-3151', 'proposed');
    writeBeads(projectPath, 'PAN-3151');

    await reconcileOrphanProposedSpecs({
      projects: [{ key: 'panopticon', config: { name: 'Panopticon CLI', path: projectPath } }],
      tmuxSessionNames: [],
      getAgentStateForIssue: async () => null,
      closedIssueIds: new Set(),
      now: new Date('2026-05-25T20:00:00.000Z'),
      config: { enabled: true, minAttemptIntervalMs: 5 * 60 * 1000 },
      spawnWorkAgent: async () => ({ spawned: true, agentId: 'agent-pan-3151' }),
    });

    const events = activityLogger.emitActivityEntrySync.mock.calls.map(([event]) => ({
      ...event,
      details: JSON.parse(String(event.details)),
    }));

    // Exactly one feed entry — the spawn success — with a plain-sentence message.
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(expect.objectContaining({
      source: 'cloister',
      level: 'success',
      issueId: 'PAN-3151',
      message: 'Started work agent for PAN-3151 — proposed spec had tasks but no running agent',
      details: expect.objectContaining({ issueId: 'PAN-3151', agentId: 'agent-pan-3151', timestamp: expect.any(String) }),
    }));

    // Per-cycle diagnostics (scan-start, orphan-detected, spawn-attempt) must NOT
    // reach the feed — they were the spam (PAN-1626).
    const messages = events.map((e) => e.message);
    expect(messages.some((m) => m.startsWith('orphan-proposed-reconciler.'))).toBe(false);
  });

  it('emits no activity-feed events for an orphan sitting in attempt cooldown (PAN-1626)', async () => {
    const projectPath = join(testDir, 'project');
    mkdirSync(projectPath, { recursive: true });
    writeSpec(projectPath, 'PAN-3152', 'proposed');
    writeBeads(projectPath, 'PAN-3152');

    const baseOpts = {
      projects: [{ key: 'panopticon', config: { name: 'Panopticon CLI', path: projectPath } }],
      tmuxSessionNames: [] as string[],
      getAgentStateForIssue: async () => null,
      closedIssueIds: new Set<string>(),
      config: { enabled: true, minAttemptIntervalMs: 5 * 60 * 1000 },
      spawnWorkAgent: async () => ({ spawned: true, agentId: 'agent-pan-3152' }),
    };

    // First scan attempts a spawn (one success entry).
    await reconcileOrphanProposedSpecs({ ...baseOpts, now: new Date('2026-05-25T20:00:00.000Z') });
    activityLogger.emitActivityEntrySync.mockReset();

    // Second scan a minute later: still within cooldown → no feed events at all.
    await reconcileOrphanProposedSpecs({ ...baseOpts, now: new Date('2026-05-25T20:01:00.000Z') });
    expect(activityLogger.emitActivityEntrySync).not.toHaveBeenCalled();
  });

  it('does not scan or spawn when disabled by config', async () => {
    const spawnWorkAgent = vi.fn(async () => ({ spawned: true, agentId: 'agent-pan-3201' }));

    await expect(reconcileOrphanProposedSpecs({
      projects: [{ key: 'panopticon', config: { name: 'Panopticon CLI', path: join(testDir, 'missing') } }],
      config: { enabled: false },
      spawnWorkAgent,
    })).resolves.toEqual([]);

    expect(spawnWorkAgent).not.toHaveBeenCalled();
  });

  it('posts to the existing agents endpoint for spawn attempts', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, agentId: 'agent-pan-3301' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(spawnWorkAgentThroughAgentsEndpoint('PAN-3301', 'http://127.0.0.1:3011')).resolves.toEqual({
      spawned: true,
      agentId: 'agent-pan-3301',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:3011/api/agents');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ origin: 'http://127.0.0.1:3011' });
    expect(JSON.parse(String(init?.body))).toEqual({ issueId: 'PAN-3301', role: 'work' });
  });
});
