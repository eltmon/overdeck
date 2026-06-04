import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const activityLogger = vi.hoisted(() => ({
  emitActivityEntrySync: vi.fn(),
}));

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntrySync: activityLogger.emitActivityEntrySync,
}));

import {
  clearOrphanProposedAttemptCooldowns,
  findOrphanProposedSpecsForReconciler,
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
    clearOrphanProposedAttemptCooldowns();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearOrphanProposedAttemptCooldowns();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
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

  it('emits structured reconciler activity metadata for scan and spawn lifecycle', async () => {
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
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        issueId: 'ALL',
        message: 'orphan-proposed-reconciler.scan-start',
        details: expect.objectContaining({ issueId: 'ALL', reason: expect.any(String), timestamp: expect.any(String) }),
      }),
      expect.objectContaining({
        issueId: 'PAN-3151',
        message: 'orphan-proposed-reconciler.orphan-detected',
        details: expect.objectContaining({ issueId: 'PAN-3151', reason: expect.any(String), timestamp: expect.any(String) }),
      }),
      expect.objectContaining({
        issueId: 'PAN-3151',
        message: 'orphan-proposed-reconciler.spawn-attempt',
        details: expect.objectContaining({ issueId: 'PAN-3151', reason: expect.any(String), timestamp: expect.any(String) }),
      }),
      expect.objectContaining({
        issueId: 'PAN-3151',
        message: 'orphan-proposed-reconciler.spawn-success',
        details: expect.objectContaining({ issueId: 'PAN-3151', reason: expect.any(String), timestamp: expect.any(String) }),
      }),
    ]));
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
