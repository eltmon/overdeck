import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { join } from 'node:path';
import { getOverdeckHome } from '../../../../../src/lib/paths.js';
import type { AgentState } from '../../../../../src/lib/agents.js';

vi.mock('../../../../../src/lib/projects.js', () => ({
  listProjects: vi.fn(),
  listProjectsSync: vi.fn(),
  resolveProjectFromIssue: vi.fn(() => ({ projectKey: 'overdeck' })),
  resolveProjectFromIssueSync: vi.fn(() => ({ projectKey: 'overdeck' })),
}));

vi.mock('../../../../../src/lib/tmux.js', () => ({
  listSessionNames: vi.fn(),
  capturePane: vi.fn(() => Effect.succeed('')),
}));

const mockAgentStates = vi.hoisted(() => new Map<string, Partial<AgentState>>());

vi.mock('../../../../../src/lib/agents.js', () => ({
  getAgentDir: vi.fn((agentId: string) => join(getOverdeckHome(), 'agents', agentId)),
  getAgentRuntimeState: vi.fn(),
  getAgentRuntimeStateProgram: vi.fn(),
  // fetchProjectSessionTree → collectSessionTreeNodes calls
  // getAgentStateSync for each candidate session id. The test seeds
  // agent-pan-539 via the readFile mock (readFileSync from node:fs is not
  // mocked here, so the rollback layer would throw ENOENT), so resolve the
  // agent state through this direct hook instead.
  getAgentStateSync: vi.fn((id: string) => mockAgentStates.get(id) ?? null),
}));

vi.mock('../../../../../src/lib/cloister/specialists.js', () => ({
  getTmuxSessionName: vi.fn(() => 'review-agent-overdeck'),
}));

vi.mock('../../../../../src/dashboard/server/review-status.js', () => ({
  getReviewStatus: vi.fn(() => null),
  getReviewStatusSync: vi.fn(() => null),
}));

vi.mock('../../../../../src/dashboard/server/routes/jsonl-resolver.js', () => ({
  resolveJsonlPath: vi.fn(async () => null),
}));

vi.mock('../../../../../src/dashboard/server/routes/reviewer-tree.js', () => ({
  buildReviewerNodes: vi.fn(async () => []),
  readSynthesisRounds: vi.fn(async () => []),
}));

vi.mock('../../../../../src/dashboard/server/services/issue-service-singleton.js', () => ({
  getSharedIssueService: () => ({
    getIssues: () => [],
  }),
}));

// Mock findSpecByIssue from specs.js — used by resolveFeatureTitle in the new
// single-spec-on-main model (PAN-1124). This replaces the old approach of
// reading workspace-local .pan/spec.vbrief.json via async readFile. Preserve
// other exports (e.g. getProjectPanPaths) so sync vBRIEF helpers keep working.
const mockFindSpecByIssue = vi.hoisted(() => vi.fn());
vi.mock(import('../../../../../src/lib/pan-dir/specs.js'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    findSpecByIssue: mockFindSpecByIssue,
  };
});

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual('node:fs/promises') as object;
  return {
    ...actual,
    access: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
  };
});

const mockIsPlanningCompleteSync = vi.hoisted(() => vi.fn(() => false));
vi.mock('../../../../../src/lib/vbrief/io.js', () => ({
  isPlanningCompleteSync: mockIsPlanningCompleteSync,
}));

import { fetchProjectSessionTree, getSlotWorkSessionNumber } from '../../../../../src/dashboard/server/routes/projects.ts';
import { listProjectsSync } from '../../../../../src/lib/projects.js';
import { listSessionNames } from '../../../../../src/lib/tmux.js';
import { getAgentRuntimeState } from '../../../../../src/lib/agents.js';
import { getReviewStatusSync } from '../../../../../src/dashboard/server/review-status.js';
import { access, readdir, readFile, stat } from 'node:fs/promises';

const RECENT_PLANNING_MTIME = new Date(Date.now() - 60_000);
const FEATURE_PAN_539_DIRENT = { name: 'feature-pan-539', isDirectory: () => true, isFile: () => false };
const FEATURE_PAN_821_DIRENT = { name: 'feature-pan-821', isDirectory: () => true, isFile: () => false };

function agentState(overrides: Partial<AgentState> = {}): AgentState {
  const id = overrides.id ?? 'agent-pan-539';
  return {
    id,
    issueId: overrides.issueId ?? 'PAN-539',
    workspace: overrides.workspace ?? '/tmp/overdeck/workspaces/feature-pan-539',
    role: overrides.role ?? 'work',
    model: overrides.model ?? 'gpt-4',
    status: overrides.status ?? 'running',
    startedAt: overrides.startedAt ?? '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function mockWorkspaceReaddir(entries: Array<{ name: string; isDirectory: () => boolean; isFile?: () => boolean }>) {
  (readdir as any).mockImplementation((p: string) => {
    if (p === '/tmp/overdeck/workspaces') return Promise.resolve(entries);
    if (p === join(getOverdeckHome(), 'agents')) return Promise.resolve([]);
    const err = new Error('ENOENT');
    (err as any).code = 'ENOENT';
    return Promise.reject(err);
  });
}

function mockAccess(paths: Set<string>) {
  return (access as any).mockImplementation((p: string) => {
    if (paths.has(p)) return Promise.resolve(undefined);
    const err = new Error('ENOENT');
    (err as any).code = 'ENOENT';
    return Promise.reject(err);
  });
}

describe('fetchProjectSessionTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentStates.clear();
    (stat as any).mockResolvedValue({ mtime: RECENT_PLANNING_MTIME });
    mockFindSpecByIssue.mockReturnValue(Effect.succeed(null));
  });

  it('returns null for unknown project key', async () => {
    (listProjectsSync as any).mockReturnValue([
      { key: 'overdeck', config: { name: 'overdeck', path: '/tmp/overdeck' } },
    ]);

    const result = await fetchProjectSessionTree('unknown-project');
    expect(result).toBeNull();
  });

  it('returns empty features array when workspaces directory does not exist', async () => {
    (listProjectsSync as any).mockReturnValue([
      { key: 'overdeck', config: { name: 'overdeck', path: '/tmp/overdeck' } },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed([]));
    mockAccess(new Set());
    (readdir as any).mockResolvedValue([]);

    const result = await fetchProjectSessionTree('overdeck');
    expect(result).toEqual({ projectKey: 'overdeck', features: [] });
  });

  it('recognizes registered swarm slot session names', () => {
    expect(getSlotWorkSessionNumber('agent-pan-2203-slot-1', 'pan-2203')).toBe(1);
    expect(getSlotWorkSessionNumber('agent-pan-2203-slot-2', 'pan-2203')).toBe(2);
    expect(getSlotWorkSessionNumber('agent-pan-2203-2', 'pan-2203')).toBeNull();
  });

  it('aggregates sessions for active feature workspaces', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'overdeck',
        config: { name: 'overdeck', path: '/tmp/overdeck', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed(['agent-pan-539']));
    (getAgentRuntimeState as any).mockReturnValue(Effect.succeed({ state: 'active' }));
    mockAgentStates.set('agent-pan-539', agentState());
    mockAccess(new Set([
      '/tmp/overdeck/workspaces',
      '/tmp/overdeck/workspaces/feature-pan-821/.pan',
      '/tmp/overdeck/workspaces/feature-pan-821/.pan/continue.json',
      join(getOverdeckHome(), 'agents', 'agent-pan-539'),
      join(getOverdeckHome(), 'agents', 'agent-pan-539', 'state.json'),
    ]));
    mockWorkspaceReaddir([FEATURE_PAN_821_DIRENT, FEATURE_PAN_539_DIRENT]);
    (readFile as any).mockImplementation((p: string) => {
      if (p === join(getOverdeckHome(), 'agents', 'agent-pan-539', 'state.json')) {
        return Promise.resolve(JSON.stringify({
          model: 'gpt-4',
          startedAt: '2026-01-01T00:00:00Z',
          status: 'running',
        }));
      }
      const err = new Error('ENOENT');
      (err as any).code = 'ENOENT';
      return Promise.reject(err);
    });

    const result = await fetchProjectSessionTree('overdeck');
    expect(result).not.toBeNull();
    const tree = result as { projectKey: string; features: Array<{ issueId: string; sessions: unknown[] }> };
    expect(tree.projectKey).toBe('overdeck');
    expect(tree.features).toHaveLength(2);
    expect(tree.features[0]?.issueId).toBe('PAN-539');
    expect(tree.features[1]?.issueId).toBe('PAN-821');
    expect(tree.features[0]?.sessions).toHaveLength(1);
    expect(tree.features[1]?.sessions).toHaveLength(1);
    expect((tree.features[1]?.sessions as Array<{ startedAt: string }>)[0]?.startedAt).toBe(RECENT_PLANNING_MTIME.toISOString());
    expect(listSessionNames).toHaveBeenCalledTimes(1);
  });

  it('skips features with no agent dir and no planning dir', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'overdeck',
        config: { name: 'overdeck', path: '/tmp/overdeck', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed([]));
    mockAccess(new Set(['/tmp/overdeck/workspaces']));
    mockWorkspaceReaddir([{ name: 'feature-pan-999', isDirectory: () => true, isFile: () => false }]);

    const result = await fetchProjectSessionTree('overdeck');
    const tree = result as { projectKey: string; features: Array<{ issueId: string }> };
    expect(tree.features).toHaveLength(0);
  });

  it('matches project by config name when key differs from name', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'overdeck',
        config: { name: 'Overdeck CLI', path: '/tmp/overdeck' },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed([]));
    mockAccess(new Set());
    (readdir as any).mockResolvedValue([]);

    const result = await fetchProjectSessionTree('Overdeck CLI');
    expect(result).toEqual({ projectKey: 'Overdeck CLI', features: [] });
  });

  it('resolves feature title from main-side .pan/specs/ via findSpecByIssue', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'overdeck',
        config: { name: 'overdeck', path: '/tmp/overdeck', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed([]));
    mockAccess(new Set([
      '/tmp/overdeck/workspaces',
      '/tmp/overdeck/workspaces/feature-pan-123/.pan',
      '/tmp/overdeck/workspaces/feature-pan-123/.pan/continue.json',
    ]));
    mockWorkspaceReaddir([{ name: 'feature-pan-123', isDirectory: () => true, isFile: () => false }]);

    // Mock findSpecByIssue to return a spec entry — Effect-returning post-PAN-1249.
    const specPath = '/tmp/overdeck/.pan/specs/2026-01-01-PAN-123-implement-command-deck.vbrief.json';
    mockFindSpecByIssue.mockReturnValue(Effect.succeed({ path: specPath }));

    // Mock readFile to return spec content when the spec path is read (by readOptional)
    (readFile as any).mockImplementation((p: string) => {
      if (p === specPath) {
        return Promise.resolve(JSON.stringify({
          plan: { title: 'Implement Command Deck Session Tree' },
        }));
      }
      const err = new Error('ENOENT');
      (err as any).code = 'ENOENT';
      return Promise.reject(err);
    });

    const result = await fetchProjectSessionTree('overdeck');
    const tree = result as { features: Array<{ issueId: string; title: string }> };
    expect(tree.features).toHaveLength(1);
    expect(tree.features[0]?.issueId).toBe('PAN-123');
    expect(tree.features[0]?.title).toBe('Implement Command Deck Session Tree');
  });

  it('returns troubled metadata and queued mail count for troubled agents', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'overdeck',
        config: { name: 'overdeck', path: '/tmp/overdeck', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed(['agent-pan-539']));
    (getAgentRuntimeState as any).mockReturnValue(Effect.succeed({ state: 'active' }));
    mockAgentStates.set('agent-pan-539', agentState({
      troubled: true,
      troubledAt: '2026-02-03T04:05:06Z',
      consecutiveFailures: 2,
      lastFailureReason: 'PTY echo-confirm timed out',
    }));
    mockAccess(new Set([
      '/tmp/overdeck/workspaces',
      join(getOverdeckHome(), 'agents', 'agent-pan-539'),
      '/tmp/overdeck/workspaces/feature-pan-539/.pan',
    ]));
    (readdir as any).mockImplementation((p: string) => {
      if (p === '/tmp/overdeck/workspaces') return Promise.resolve([FEATURE_PAN_539_DIRENT]);
      if (p === join(getOverdeckHome(), 'agents')) return Promise.resolve([]);
      if (p === join(getOverdeckHome(), 'agents', 'agent-pan-539', 'mail')) {
        return Promise.resolve([
          { name: '2026-02-03T04-06-00-000Z.md', isDirectory: () => false, isFile: () => true },
          { name: '2026-02-03T04-07-00-000Z.md', isDirectory: () => false, isFile: () => true },
          { name: 'ignored.tmp', isDirectory: () => false, isFile: () => true },
        ]);
      }
      const err = new Error('ENOENT');
      (err as any).code = 'ENOENT';
      return Promise.reject(err);
    });

    const result = await fetchProjectSessionTree('overdeck');

    const tree = result as { features: Array<{ issueId: string; sessions: Array<Record<string, unknown>> }> };
    const session = tree.features.find((feature) => feature.issueId === 'PAN-539')?.sessions[0];
    expect(session).toMatchObject({
      troubled: true,
      troubledReason: 'PTY echo-confirm timed out',
      troubledAt: '2026-02-03T04:05:06Z',
      consecutiveFailures: 2,
      queuedMailCount: 2,
    });
  });

  it('returns queuedMailCount 0 for troubled agents with no mail directory', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'overdeck',
        config: { name: 'overdeck', path: '/tmp/overdeck', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed(['agent-pan-539']));
    (getAgentRuntimeState as any).mockReturnValue(Effect.succeed({ state: 'active' }));
    mockAgentStates.set('agent-pan-539', agentState({
      troubled: true,
      troubledAt: '2026-02-03T04:05:06Z',
      consecutiveFailures: 0,
      lastFailureReason: 'troubled gate set',
    }));
    mockAccess(new Set([
      '/tmp/overdeck/workspaces',
      join(getOverdeckHome(), 'agents', 'agent-pan-539'),
      '/tmp/overdeck/workspaces/feature-pan-539/.pan',
    ]));
    mockWorkspaceReaddir([FEATURE_PAN_539_DIRENT]);

    const result = await fetchProjectSessionTree('overdeck');

    const tree = result as { features: Array<{ issueId: string; sessions: Array<Record<string, unknown>> }> };
    const session = tree.features.find((feature) => feature.issueId === 'PAN-539')?.sessions[0];
    expect(session).toMatchObject({
      troubled: true,
      troubledReason: 'troubled gate set',
      troubledAt: '2026-02-03T04:05:06Z',
      consecutiveFailures: 0,
      queuedMailCount: 0,
    });
  });

  it('omits troubled-only values for untroubled agents', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'overdeck',
        config: { name: 'overdeck', path: '/tmp/overdeck', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed(['agent-pan-539']));
    (getAgentRuntimeState as any).mockReturnValue(Effect.succeed({ state: 'active' }));
    mockAgentStates.set('agent-pan-539', agentState({
      troubled: false,
      troubledAt: '2026-02-03T04:05:06Z',
      consecutiveFailures: 3,
      lastFailureReason: 'old failure',
    }));
    mockAccess(new Set([
      '/tmp/overdeck/workspaces',
      join(getOverdeckHome(), 'agents', 'agent-pan-539'),
      '/tmp/overdeck/workspaces/feature-pan-539/.pan',
    ]));
    mockWorkspaceReaddir([FEATURE_PAN_539_DIRENT]);

    const result = await fetchProjectSessionTree('overdeck');

    const tree = result as { features: Array<{ issueId: string; sessions: Array<Record<string, unknown>> }> };
    const session = tree.features.find((feature) => feature.issueId === 'PAN-539')?.sessions[0];
    expect(session?.troubled).toBeUndefined();
    expect(session?.troubledReason).toBeUndefined();
    expect(session?.troubledAt).toBeUndefined();
    expect(session?.consecutiveFailures).toBeUndefined();
    expect(session?.queuedMailCount).toBeUndefined();
  });

  it('returns troubled metadata and queued mail count for review session nodes', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'overdeck',
        config: { name: 'overdeck', path: '/tmp/overdeck', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed(['agent-pan-539-review']));
    (getReviewStatusSync as any).mockReturnValue({
      history: [
        {
          type: 'review',
          status: 'reviewing',
          timestamp: '2026-02-03T04:00:00Z',
        },
      ],
    });
    mockAgentStates.set('agent-pan-539-review', agentState({
      id: 'agent-pan-539-review',
      role: 'review',
      troubled: true,
      troubledAt: '2026-02-03T04:05:06Z',
      consecutiveFailures: 1,
      lastFailureReason: 'review delivery queued',
    }));
    mockAccess(new Set([
      '/tmp/overdeck/workspaces',
      '/tmp/overdeck/workspaces/feature-pan-539/.pan',
    ]));
    (readdir as any).mockImplementation((p: string) => {
      if (p === '/tmp/overdeck/workspaces') return Promise.resolve([FEATURE_PAN_539_DIRENT]);
      if (p === join(getOverdeckHome(), 'agents')) return Promise.resolve([]);
      if (p === join(getOverdeckHome(), 'agents', 'agent-pan-539-review', 'mail')) {
        return Promise.resolve([
          { name: '2026-02-03T04-06-00-000Z.md', isDirectory: () => false, isFile: () => true },
        ]);
      }
      const err = new Error('ENOENT');
      (err as any).code = 'ENOENT';
      return Promise.reject(err);
    });

    const result = await fetchProjectSessionTree('overdeck');

    const tree = result as { features: Array<{ issueId: string; sessions: Array<Record<string, unknown>> }> };
    const session = tree.features
      .find((feature) => feature.issueId === 'PAN-539')
      ?.sessions.find((candidate) => candidate.sessionId === 'agent-pan-539-review');
    expect(session).toMatchObject({
      type: 'review',
      troubled: true,
      troubledReason: 'review delivery queued',
      troubledAt: '2026-02-03T04:05:06Z',
      consecutiveFailures: 1,
      queuedMailCount: 1,
    });
  });

  it('leaves endedAt undefined for a live planning session and marks planningComplete false without a finished spec', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'overdeck',
        config: { name: 'overdeck', path: '/tmp/overdeck', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed(['planning-pan-539']));
    (getAgentRuntimeState as any).mockReturnValue(Effect.succeed({ state: 'active' }));
    mockAgentStates.set('planning-pan-539', agentState({
      id: 'planning-pan-539',
      role: 'plan',
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
    }));
    mockAccess(new Set([
      '/tmp/overdeck/workspaces',
      join(getOverdeckHome(), 'agents', 'planning-pan-539'),
      '/tmp/overdeck/workspaces/feature-pan-539/.pan',
      '/tmp/overdeck/workspaces/feature-pan-539/.pan/continue.json',
    ]));
    mockWorkspaceReaddir([FEATURE_PAN_539_DIRENT]);

    const result = await fetchProjectSessionTree('overdeck');

    const tree = result as { features: Array<{ issueId: string; sessions: Array<Record<string, unknown>> }> };
    const session = tree.features
      .find((feature) => feature.issueId === 'PAN-539')
      ?.sessions.find((candidate) => candidate.sessionId === 'planning-pan-539');
    expect(session).toBeDefined();
    expect(session?.type).toBe('planning');
    expect(session?.endedAt).toBeUndefined();
    expect(session?.planningComplete).toBe(false);
    expect(typeof session?.duration).toBe('number');
    expect(Number.isFinite(session?.duration)).toBe(true);
  });

  it('populates endedAt from stoppedAt when the session has ended and preserves duration', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'overdeck',
        config: { name: 'overdeck', path: '/tmp/overdeck', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed([]));
    (getAgentRuntimeState as any).mockReturnValue(Effect.succeed(null));
    mockAgentStates.set('agent-pan-539', agentState({
      status: 'stopped',
      stoppedAt: '2026-01-01T02:30:00Z',
      lastActivity: '2026-01-01T02:25:00Z',
      startedAt: '2026-01-01T00:00:00Z',
    }));
    mockAccess(new Set([
      '/tmp/overdeck/workspaces',
      join(getOverdeckHome(), 'agents', 'agent-pan-539'),
      '/tmp/overdeck/workspaces/feature-pan-539/.pan',
    ]));
    mockWorkspaceReaddir([FEATURE_PAN_539_DIRENT]);

    const result = await fetchProjectSessionTree('overdeck');

    const tree = result as { features: Array<{ issueId: string; sessions: Array<Record<string, unknown>> }> };
    const session = tree.features.find((feature) => feature.issueId === 'PAN-539')?.sessions[0];
    expect(session).toBeDefined();
    expect(session?.endedAt).toBe('2026-01-01T02:30:00Z');
    expect(session?.presence).toBe('ended');
    expect(typeof session?.duration).toBe('number');
    expect(Number.isFinite(session?.duration)).toBe(true);
  });

  it('sets planningComplete true when a canonical spec has a finished planning status', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'overdeck',
        config: { name: 'overdeck', path: '/tmp/overdeck', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed(['planning-pan-539']));
    (getAgentRuntimeState as any).mockReturnValue(Effect.succeed({ state: 'active' }));
    mockAgentStates.set('planning-pan-539', agentState({
      id: 'planning-pan-539',
      role: 'plan',
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
    }));
    mockAccess(new Set([
      '/tmp/overdeck/workspaces',
      join(getOverdeckHome(), 'agents', 'planning-pan-539'),
      '/tmp/overdeck/workspaces/feature-pan-539/.pan',
      '/tmp/overdeck/workspaces/feature-pan-539/.pan/continue.json',
    ]));
    mockWorkspaceReaddir([FEATURE_PAN_539_DIRENT]);
    mockIsPlanningCompleteSync.mockReturnValue(true);

    const result = await fetchProjectSessionTree('overdeck');

    const tree = result as { features: Array<{ issueId: string; sessions: Array<Record<string, unknown>> }> };
    const session = tree.features
      .find((feature) => feature.issueId === 'PAN-539')
      ?.sessions.find((candidate) => candidate.sessionId === 'planning-pan-539');
    expect(session).toBeDefined();
    expect(session?.planningComplete).toBe(true);
  });
});
