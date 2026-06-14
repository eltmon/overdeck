import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { join } from 'node:path';
import { getPanopticonHome } from '../../../../../src/lib/paths.js';

vi.mock('../../../../../src/lib/projects.js', () => ({
  listProjects: vi.fn(),
  listProjectsSync: vi.fn(),
  resolveProjectFromIssue: vi.fn(() => Effect.succeed({ projectKey: 'panopticon-cli' })),
  resolveProjectFromIssueSync: vi.fn(() => ({ projectKey: 'panopticon-cli' })),
}));

vi.mock('../../../../../src/lib/tmux.js', () => ({
  listSessionNames: vi.fn(),
  capturePane: vi.fn(() => Effect.succeed('')),
}));

vi.mock('../../../../../src/lib/agents.js', () => ({
  getAgentRuntimeState: vi.fn(),
  getAgentRuntimeStateProgram: vi.fn(),
}));

vi.mock('../../../../../src/lib/cloister/specialists.js', () => ({
  getTmuxSessionName: vi.fn(() => 'review-agent-panopticon-cli'),
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
}));

vi.mock('../../../../../src/dashboard/server/services/issue-service-singleton.js', () => ({
  getSharedIssueService: () => ({
    getIssues: () => [],
  }),
}));

// Mock findSpecByIssue from specs.js — used by resolveFeatureTitle in the new
// single-spec-on-main model (PAN-1124). This replaces the old approach of
// reading workspace-local .pan/spec.vbrief.json via async readFile.
const mockFindSpecByIssue = vi.hoisted(() => vi.fn());
vi.mock('../../../../../src/lib/pan-dir/specs.js', () => ({
  findSpecByIssue: mockFindSpecByIssue,
}));

const mockListActiveRemoteAgentStates = vi.hoisted(() => vi.fn(() => []));
const mockListActiveRemoteAgentStatesAsync = vi.hoisted(() => vi.fn(async () => []));
vi.mock('../../../../../src/lib/remote/remote-agents.js', () => ({
  listActiveRemoteAgentStates: mockListActiveRemoteAgentStates,
  listActiveRemoteAgentStatesAsync: mockListActiveRemoteAgentStatesAsync,
}));

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

import { fetchProjectSessionTree } from '../../../../../src/dashboard/server/routes/projects.ts';
import { listProjectsSync, resolveProjectFromIssue } from '../../../../../src/lib/projects.js';
import { listSessionNames } from '../../../../../src/lib/tmux.js';
import { getAgentRuntimeState } from '../../../../../src/lib/agents.js';
import { access, readdir, readFile, stat } from 'node:fs/promises';

const RECENT_PLANNING_MTIME = new Date(Date.now() - 60_000);

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
    (stat as any).mockResolvedValue({ mtime: RECENT_PLANNING_MTIME });
    mockFindSpecByIssue.mockReturnValue(Effect.succeed(null));
    mockListActiveRemoteAgentStates.mockReturnValue([]);
    mockListActiveRemoteAgentStatesAsync.mockResolvedValue([]);
  });

  it('returns null for unknown project key', async () => {
    (listProjectsSync as any).mockReturnValue([
      { key: 'panopticon-cli', config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli' } },
    ]);

    const result = await fetchProjectSessionTree('unknown-project');
    expect(result).toBeNull();
  });

  it('returns empty features array when workspaces directory does not exist', async () => {
    (listProjectsSync as any).mockReturnValue([
      { key: 'panopticon-cli', config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli' } },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed([]));
    mockAccess(new Set());
    (readdir as any).mockResolvedValue([]);

    const result = await fetchProjectSessionTree('panopticon-cli');
    expect(result).toEqual({ projectKey: 'panopticon-cli', features: [] });
  });

  it('aggregates sessions for active feature workspaces', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'panopticon-cli',
        config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed(['agent-pan-539']));
    (getAgentRuntimeState as any).mockReturnValue(Effect.succeed({ state: 'active' }));
    mockAccess(new Set([
      '/tmp/panopticon-cli/workspaces',
      '/tmp/panopticon-cli/workspaces/feature-pan-821/.pan',
      '/tmp/panopticon-cli/workspaces/feature-pan-821/.pan/continue.json',
      join(getPanopticonHome(), 'agents', 'agent-pan-539'),
      join(getPanopticonHome(), 'agents', 'agent-pan-539', 'state.json'),
    ]));
    (readdir as any).mockResolvedValue([
      { name: 'feature-pan-821', isDirectory: () => true },
      { name: 'feature-pan-539', isDirectory: () => true },
    ]);
    (readFile as any).mockImplementation((p: string) => {
      if (p === join(getPanopticonHome(), 'agents', 'agent-pan-539', 'state.json')) {
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

    const result = await fetchProjectSessionTree('panopticon-cli');
    expect(result).not.toBeNull();
    const tree = result as { projectKey: string; features: Array<{ issueId: string; sessions: unknown[] }> };
    expect(tree.projectKey).toBe('panopticon-cli');
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
        key: 'panopticon-cli',
        config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed([]));
    mockAccess(new Set(['/tmp/panopticon-cli/workspaces']));
    (readdir as any).mockResolvedValue([
      { name: 'feature-pan-999', isDirectory: () => true },
    ]);

    const result = await fetchProjectSessionTree('panopticon-cli');
    const tree = result as { projectKey: string; features: Array<{ issueId: string }> };
    expect(tree.features).toHaveLength(0);
  });

  it('matches project by config name when key differs from name', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'panopticon-cli',
        config: { name: 'Panopticon CLI', path: '/tmp/panopticon-cli' },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed([]));
    mockAccess(new Set());
    (readdir as any).mockResolvedValue([]);

    const result = await fetchProjectSessionTree('Panopticon CLI');
    expect(result).toEqual({ projectKey: 'Panopticon CLI', features: [] });
  });

  it('resolves feature title from main-side .pan/specs/ via findSpecByIssue', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'panopticon-cli',
        config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed([]));
    mockAccess(new Set([
      '/tmp/panopticon-cli/workspaces',
      '/tmp/panopticon-cli/workspaces/feature-pan-123/.pan',
      '/tmp/panopticon-cli/workspaces/feature-pan-123/.pan/continue.json',
    ]));
    (readdir as any).mockResolvedValue([
      { name: 'feature-pan-123', isDirectory: () => true },
    ]);

    // Mock findSpecByIssue to return a spec entry — Effect-returning post-PAN-1249.
    const specPath = '/tmp/panopticon-cli/.pan/specs/2026-01-01-PAN-123-implement-command-deck.vbrief.json';
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

    const result = await fetchProjectSessionTree('panopticon-cli');
    const tree = result as { features: Array<{ issueId: string; title: string }> };
    expect(tree.features).toHaveLength(1);
    expect(tree.features[0]?.issueId).toBe('PAN-123');
    expect(tree.features[0]?.title).toBe('Implement Command Deck Session Tree');
  });

  it('synthesizes a remote session row when the remote agent has no local workspace directory', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'panopticon-cli',
        config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed([]));
    const agentDir = join(getPanopticonHome(), 'agents', 'agent-pan-1762');
    mockAccess(new Set([agentDir]));
    (readdir as any).mockImplementation((p: string) => {
      if (p === join(getPanopticonHome(), 'agents')) {
        return Promise.resolve([]);
      }
      const err = new Error('ENOENT');
      (err as any).code = 'ENOENT';
      return Promise.reject(err);
    });
    const remoteState = {
      id: 'agent-pan-1762',
      issueId: 'PAN-1762',
      vmName: 'pan-pan-1762-ws',
      model: 'claude-fable-5',
      status: 'running',
      startedAt: '2026-06-11T00:00:00Z',
      location: 'remote',
    };
    (readFile as any).mockImplementation((p: string) => {
      if (p === join(agentDir, 'remote-state.json')) {
        return Promise.resolve(JSON.stringify(remoteState));
      }
      const err = new Error('ENOENT');
      (err as any).code = 'ENOENT';
      return Promise.reject(err);
    });
    mockListActiveRemoteAgentStatesAsync.mockResolvedValue([remoteState]);

    const result = await fetchProjectSessionTree('panopticon-cli');
    const tree = result as { features: Array<{ issueId: string; sessions: Array<Record<string, unknown>> }> };
    expect(tree.features).toHaveLength(1);
    expect(tree.features[0]?.issueId).toBe('PAN-1762');
    expect(tree.features[0]?.sessions).toEqual([
      expect.objectContaining({
        type: 'work',
        sessionId: 'agent-pan-1762',
        model: 'claude-fable-5',
        status: 'running',
        presence: 'active',
        tmuxSession: undefined,
        remote: { provider: 'fly.io', vmName: 'pan-pan-1762-ws' },
      }),
    ]);
    expect(getAgentRuntimeState).not.toHaveBeenCalled();
  });

  it('deduplicates remote candidates against workspace-scan candidates', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'panopticon-cli',
        config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed([]));
    const agentDir = join(getPanopticonHome(), 'agents', 'agent-pan-1762');
    mockAccess(new Set([
      '/tmp/panopticon-cli/workspaces',
      agentDir,
    ]));
    const remoteState = {
      id: 'agent-pan-1762',
      issueId: 'PAN-1762',
      vmName: 'pan-pan-1762-ws',
      model: 'claude-fable-5',
      status: 'running',
      startedAt: '2026-06-11T00:00:00Z',
      location: 'remote',
    };
    (readdir as any).mockImplementation((p: string) => {
      if (p === '/tmp/panopticon-cli/workspaces') {
        return Promise.resolve([{ name: 'feature-pan-1762', isDirectory: () => true }]);
      }
      if (p === join(getPanopticonHome(), 'agents')) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    (readFile as any).mockImplementation((p: string) => {
      if (p === join(agentDir, 'remote-state.json')) {
        return Promise.resolve(JSON.stringify(remoteState));
      }
      const err = new Error('ENOENT');
      (err as any).code = 'ENOENT';
      return Promise.reject(err);
    });
    mockListActiveRemoteAgentStatesAsync.mockResolvedValue([remoteState]);

    const result = await fetchProjectSessionTree('panopticon-cli');
    const tree = result as { features: Array<{ issueId: string; sessions: Array<Record<string, unknown>> }> };
    expect(tree.features).toHaveLength(1);
    expect(tree.features[0]?.issueId).toBe('PAN-1762');
  });

  it('excludes remote agents whose issue resolves to a different project', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'panopticon-cli',
        config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed([]));
    (resolveProjectFromIssue as any).mockReturnValue(Effect.succeed({ projectKey: 'mind-your-now' }));
    mockAccess(new Set([]));
    (readdir as any).mockResolvedValue([]);
    (readFile as any).mockRejectedValue({ code: 'ENOENT' });
    mockListActiveRemoteAgentStatesAsync.mockResolvedValue([{
      id: 'agent-min-123',
      issueId: 'MIN-123',
      vmName: 'min-min-123-ws',
      model: 'claude-fable-5',
      status: 'running',
      startedAt: '2026-06-11T00:00:00Z',
      location: 'remote',
    }]);

    const result = await fetchProjectSessionTree('panopticon-cli');
    const tree = result as { features: Array<unknown> };
    expect(tree.features).toHaveLength(0);
  });

  it('falls back to workspace-derived features when remote seeding throws', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'panopticon-cli',
        config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed(['agent-pan-539']));
    (getAgentRuntimeState as any).mockReturnValue(Effect.succeed({ state: 'active' }));
    (resolveProjectFromIssue as any).mockReturnValue(Effect.succeed({ projectKey: 'panopticon-cli' }));
    mockAccess(new Set([
      '/tmp/panopticon-cli/workspaces',
      '/tmp/panopticon-cli/workspaces/feature-pan-539/.pan',
      '/tmp/panopticon-cli/workspaces/feature-pan-539/.pan/continue.json',
      join(getPanopticonHome(), 'agents', 'agent-pan-539'),
      join(getPanopticonHome(), 'agents', 'agent-pan-539', 'state.json'),
    ]));
    (readdir as any).mockResolvedValue([
      { name: 'feature-pan-539', isDirectory: () => true },
    ]);
    (readFile as any).mockImplementation((p: string) => {
      if (p === join(getPanopticonHome(), 'agents', 'agent-pan-539', 'state.json')) {
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
    mockListActiveRemoteAgentStatesAsync.mockImplementation(() => {
      throw new Error('remote-agents unavailable');
    });

    const result = await fetchProjectSessionTree('panopticon-cli');
    expect(result).not.toBeNull();
    const tree = result as { features: Array<{ issueId: string }> };
    expect(tree.features).toHaveLength(1);
    expect(tree.features[0]?.issueId).toBe('PAN-539');
  });

  it('includes strike agent sessions in the session tree', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'panopticon-cli',
        config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed(['strike-pan-539']));
    (getAgentRuntimeState as any).mockReturnValue(Effect.succeed({ state: 'active' }));
    mockAccess(new Set([
      '/tmp/panopticon-cli/workspaces',
      '/tmp/panopticon-cli/workspaces/feature-pan-539/.pan',
      '/tmp/panopticon-cli/workspaces/feature-pan-539/.pan/continue.json',
      join(getPanopticonHome(), 'agents', 'strike-pan-539'),
      join(getPanopticonHome(), 'agents', 'strike-pan-539', 'state.json'),
    ]));
    (readdir as any).mockResolvedValue([
      { name: 'feature-pan-539', isDirectory: () => true },
    ]);
    (readFile as any).mockImplementation((p: string) => {
      if (p === join(getPanopticonHome(), 'agents', 'strike-pan-539', 'state.json')) {
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

    const result = await fetchProjectSessionTree('panopticon-cli');
    const tree = result as { features: Array<{ issueId: string; sessions: Array<Record<string, unknown>> }> };
    expect(tree.features).toHaveLength(1);
    expect(tree.features[0]?.issueId).toBe('PAN-539');
    const strikeSession = tree.features[0]?.sessions.find((s) => s.sessionId === 'strike-pan-539');
    expect(strikeSession).toEqual(expect.objectContaining({
      type: 'strike',
      sessionId: 'strike-pan-539',
      tmuxSession: 'strike-pan-539',
    }));
  });

  it('computes endedAt and duration for ended slot work sessions from state.json mtime', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'panopticon-cli',
        config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed([]));
    (getAgentRuntimeState as any).mockReturnValue(Effect.succeed({ state: 'completed' }));
    const startedAt = '2026-01-01T00:00:00Z';
    const endedAt = '2026-01-01T01:30:00Z';
    const slotAgentDir = join(getPanopticonHome(), 'agents', 'agent-pan-539-1');
    mockAccess(new Set([
      '/tmp/panopticon-cli/workspaces',
      '/tmp/panopticon-cli/workspaces/feature-pan-539/.pan',
      '/tmp/panopticon-cli/workspaces/feature-pan-539/.pan/continue.json',
      slotAgentDir,
      join(slotAgentDir, 'state.json'),
    ]));
    (readdir as any).mockImplementation((p: string) => {
      if (p === '/tmp/panopticon-cli/workspaces') {
        return Promise.resolve([{ name: 'feature-pan-539', isDirectory: () => true }]);
      }
      if (p === join(getPanopticonHome(), 'agents')) {
        return Promise.resolve([{ name: 'agent-pan-539-1', isDirectory: () => true }]);
      }
      return Promise.resolve([]);
    });
    (stat as any).mockImplementation((p: string) => {
      if (p === join(slotAgentDir, 'state.json')) {
        return Promise.resolve({ mtime: new Date(endedAt) });
      }
      return Promise.resolve({ mtime: RECENT_PLANNING_MTIME });
    });
    (readFile as any).mockImplementation((p: string) => {
      if (p === join(slotAgentDir, 'state.json')) {
        return Promise.resolve(JSON.stringify({
          model: 'gpt-4',
          startedAt,
          status: 'completed',
        }));
      }
      const err = new Error('ENOENT');
      (err as any).code = 'ENOENT';
      return Promise.reject(err);
    });

    const result = await fetchProjectSessionTree('panopticon-cli');
    const tree = result as { features: Array<{ issueId: string; sessions: Array<Record<string, unknown>> }> };
    expect(tree.features).toHaveLength(1);
    expect(tree.features[0]?.issueId).toBe('PAN-539');
    expect(tree.features[0]?.sessions).toHaveLength(2);
    const slotSession = tree.features[0]?.sessions.find((s) => s.sessionId === 'agent-pan-539-1');
    expect(slotSession).toEqual(expect.objectContaining({
      type: 'work',
      sessionId: 'agent-pan-539-1',
      endedAt: new Date(endedAt).toISOString(),
      duration: 5400,
      tmuxSession: 'agent-pan-539-1',
    }));
  });

  it('synthesizes an active work session for a remote fly.io agent with no local tmux', async () => {
    (listProjectsSync as any).mockReturnValue([
      {
        key: 'panopticon-cli',
        config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNames as any).mockReturnValue(Effect.succeed([]));
    const agentDir = join(getPanopticonHome(), 'agents', 'agent-pan-1762');
    mockAccess(new Set([
      '/tmp/panopticon-cli/workspaces',
      agentDir,
    ]));
    (readdir as any).mockImplementation((p: string) => {
      if (p === '/tmp/panopticon-cli/workspaces') {
        return Promise.resolve([{ name: 'feature-pan-1762', isDirectory: () => true }]);
      }
      if (p === join(getPanopticonHome(), 'agents')) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    (readFile as any).mockImplementation((p: string) => {
      if (p === join(agentDir, 'remote-state.json')) {
        return Promise.resolve(JSON.stringify({
          id: 'agent-pan-1762',
          issueId: 'PAN-1762',
          vmName: 'pan-pan-1762-ws',
          model: 'claude-fable-5',
          status: 'running',
          startedAt: '2026-06-11T00:00:00Z',
          location: 'remote',
        }));
      }
      const err = new Error('ENOENT');
      (err as any).code = 'ENOENT';
      return Promise.reject(err);
    });

    const result = await fetchProjectSessionTree('panopticon-cli');
    const tree = result as { features: Array<{ issueId: string; sessions: Array<Record<string, unknown>> }> };
    expect(tree.features).toHaveLength(1);
    expect(tree.features[0]?.issueId).toBe('PAN-1762');
    expect(tree.features[0]?.sessions).toEqual([
      expect.objectContaining({
        type: 'work',
        sessionId: 'agent-pan-1762',
        model: 'claude-fable-5',
        status: 'running',
        presence: 'active',
        tmuxSession: undefined,
        remote: { provider: 'fly.io', vmName: 'pan-pan-1762-ws' },
      }),
    ]);
    expect(getAgentRuntimeState).not.toHaveBeenCalled();
  });
});
