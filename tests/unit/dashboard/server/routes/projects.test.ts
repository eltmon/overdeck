import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { homedir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../../../../src/lib/projects.js', () => ({
  listProjects: vi.fn(),
  resolveProjectFromIssue: vi.fn(() => ({ projectKey: 'panopticon-cli' })),
}));

vi.mock('../../../../../src/lib/tmux.js', () => ({
  listSessionNamesAsyncEffect: vi.fn(),
  capturePaneAsyncEffect: vi.fn(() => Effect.succeed('')),
}));

vi.mock('../../../../../src/lib/agents.js', () => ({
  getAgentRuntimeStateEffect: vi.fn(),
}));

vi.mock('../../../../../src/lib/cloister/specialists.js', () => ({
  getTmuxSessionName: vi.fn(() => 'review-agent-panopticon-cli'),
}));

vi.mock('../../../../../src/dashboard/server/review-status.js', () => ({
  getReviewStatus: vi.fn(() => null),
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
import { listProjects } from '../../../../../src/lib/projects.js';
import { listSessionNamesAsyncEffect } from '../../../../../src/lib/tmux.js';
import { getAgentRuntimeStateEffect } from '../../../../../src/lib/agents.js';
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
    mockFindSpecByIssue.mockReturnValue(null);
  });

  it('returns null for unknown project key', async () => {
    (listProjects as any).mockReturnValue([
      { key: 'panopticon-cli', config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli' } },
    ]);

    const result = await fetchProjectSessionTree('unknown-project');
    expect(result).toBeNull();
  });

  it('returns empty features array when workspaces directory does not exist', async () => {
    (listProjects as any).mockReturnValue([
      { key: 'panopticon-cli', config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli' } },
    ]);
    (listSessionNamesAsyncEffect as any).mockReturnValue(Effect.succeed([]));
    mockAccess(new Set());
    (readdir as any).mockResolvedValue([]);

    const result = await fetchProjectSessionTree('panopticon-cli');
    expect(result).toEqual({ projectKey: 'panopticon-cli', features: [] });
  });

  it('aggregates sessions for active feature workspaces', async () => {
    (listProjects as any).mockReturnValue([
      {
        key: 'panopticon-cli',
        config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNamesAsyncEffect as any).mockReturnValue(Effect.succeed(['agent-pan-539']));
    (getAgentRuntimeStateEffect as any).mockReturnValue(Effect.succeed({ state: 'active' }));
    mockAccess(new Set([
      '/tmp/panopticon-cli/workspaces',
      '/tmp/panopticon-cli/workspaces/feature-pan-821/.pan',
      '/tmp/panopticon-cli/workspaces/feature-pan-821/.pan/continue.json',
      join(homedir(), '.panopticon', 'agents', 'agent-pan-539'),
      join(homedir(), '.panopticon', 'agents', 'agent-pan-539', 'state.json'),
    ]));
    (readdir as any).mockResolvedValue([
      { name: 'feature-pan-821', isDirectory: () => true },
      { name: 'feature-pan-539', isDirectory: () => true },
    ]);
    (readFile as any).mockImplementation((p: string) => {
      if (p === join(homedir(), '.panopticon', 'agents', 'agent-pan-539', 'state.json')) {
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
    expect(listSessionNamesAsyncEffect).toHaveBeenCalledTimes(1);
  });

  it('skips features with no agent dir and no planning dir', async () => {
    (listProjects as any).mockReturnValue([
      {
        key: 'panopticon-cli',
        config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNamesAsyncEffect as any).mockReturnValue(Effect.succeed([]));
    mockAccess(new Set(['/tmp/panopticon-cli/workspaces']));
    (readdir as any).mockResolvedValue([
      { name: 'feature-pan-999', isDirectory: () => true },
    ]);

    const result = await fetchProjectSessionTree('panopticon-cli');
    const tree = result as { projectKey: string; features: Array<{ issueId: string }> };
    expect(tree.features).toHaveLength(0);
  });

  it('matches project by config name when key differs from name', async () => {
    (listProjects as any).mockReturnValue([
      {
        key: 'panopticon-cli',
        config: { name: 'Panopticon CLI', path: '/tmp/panopticon-cli' },
      },
    ]);
    (listSessionNamesAsyncEffect as any).mockReturnValue(Effect.succeed([]));
    mockAccess(new Set());
    (readdir as any).mockResolvedValue([]);

    const result = await fetchProjectSessionTree('Panopticon CLI');
    expect(result).toEqual({ projectKey: 'Panopticon CLI', features: [] });
  });

  it('resolves feature title from main-side .pan/specs/ via findSpecByIssue', async () => {
    (listProjects as any).mockReturnValue([
      {
        key: 'panopticon-cli',
        config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNamesAsyncEffect as any).mockReturnValue(Effect.succeed([]));
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
});
