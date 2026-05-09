import { describe, it, expect, vi, beforeEach } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../../../../src/lib/projects.js', () => ({
  listProjects: vi.fn(),
  resolveProjectFromIssue: vi.fn(() => ({ projectKey: 'panopticon-cli' })),
}));

vi.mock('../../../../../src/lib/tmux.js', () => ({
  listSessionNamesAsync: vi.fn(),
  capturePaneAsync: vi.fn(async () => ''),
}));

vi.mock('../../../../../src/lib/agents.js', () => ({
  getAgentRuntimeStateAsync: vi.fn(),
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
import { listSessionNamesAsync } from '../../../../../src/lib/tmux.js';
import { getAgentRuntimeStateAsync } from '../../../../../src/lib/agents.js';
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
    (listSessionNamesAsync as any).mockResolvedValue([]);
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
    (listSessionNamesAsync as any).mockResolvedValue(['agent-pan-539']);
    (getAgentRuntimeStateAsync as any).mockResolvedValue({ state: 'active' });
    mockAccess(new Set([
      '/tmp/panopticon-cli/workspaces',
      '/tmp/panopticon-cli/workspaces/feature-pan-821/.pan',
      '/tmp/panopticon-cli/workspaces/feature-pan-821/.pan/spec.vbrief.json',
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
    expect(listSessionNamesAsync).toHaveBeenCalledTimes(1);
  });

  it('skips features with no agent dir and no planning dir', async () => {
    (listProjects as any).mockReturnValue([
      {
        key: 'panopticon-cli',
        config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNamesAsync as any).mockResolvedValue([]);
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
    (listSessionNamesAsync as any).mockResolvedValue([]);
    mockAccess(new Set());
    (readdir as any).mockResolvedValue([]);

    const result = await fetchProjectSessionTree('Panopticon CLI');
    expect(result).toEqual({ projectKey: 'Panopticon CLI', features: [] });
  });

  it('resolves feature title from .pan/spec.vbrief.json when available', async () => {
    (listProjects as any).mockReturnValue([
      {
        key: 'panopticon-cli',
        config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNamesAsync as any).mockResolvedValue([]);
    mockAccess(new Set([
      '/tmp/panopticon-cli/workspaces',
      '/tmp/panopticon-cli/workspaces/feature-pan-123/.pan',
      '/tmp/panopticon-cli/workspaces/feature-pan-123/.pan/spec.vbrief.json',
    ]));
    (readdir as any).mockResolvedValue([
      { name: 'feature-pan-123', isDirectory: () => true },
    ]);
    (readFile as any).mockImplementation((p: string) => {
      if (p.includes('.pan/spec.vbrief.json')) {
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
