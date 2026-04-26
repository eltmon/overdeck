import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../src/lib/projects.js', () => ({
  listProjects: vi.fn(),
}));

vi.mock('../../../../../src/lib/tmux.js', () => ({
  listSessionNamesAsync: vi.fn(),
}));

vi.mock('../../../../../src/dashboard/server/routes/command-deck.js', () => ({
  fetchActivityDataWithContext: vi.fn(),
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
  };
});

import { fetchProjectSessionTree } from '../../../../../src/dashboard/server/routes/projects.ts';
import { listProjects } from '../../../../../src/lib/projects.js';
import { listSessionNamesAsync } from '../../../../../src/lib/tmux.js';
import { fetchActivityDataWithContext } from '../../../../../src/dashboard/server/routes/command-deck.js';
import { access, readdir, readFile } from 'node:fs/promises';

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
    (listSessionNamesAsync as any).mockResolvedValue([]);
    mockAccess(new Set([
      '/tmp/panopticon-cli/workspaces',
      '/tmp/panopticon-cli/workspaces/feature-pan-821/.planning',
      '/home/eltmon/.panopticon/agents/agent-pan-539',
    ]));
    (readdir as any).mockResolvedValue([
      { name: 'feature-pan-821', isDirectory: () => true },
      { name: 'feature-pan-539', isDirectory: () => true },
    ]);
    (fetchActivityDataWithContext as any).mockImplementation(async (issueId: string) => ({
      issueId,
      sections: [
        {
          type: 'work',
          sessionId: `agent-${issueId.toLowerCase()}`,
          model: 'gpt-4',
          startedAt: '2026-01-01T00:00:00Z',
          duration: 100,
          status: 'running',
          presence: 'active',
        },
      ],
    }));

    const result = await fetchProjectSessionTree('panopticon-cli');
    expect(result).not.toBeNull();
    const tree = result as { projectKey: string; features: Array<{ issueId: string; sessions: unknown[] }> };
    expect(tree.projectKey).toBe('panopticon-cli');
    expect(tree.features).toHaveLength(2);
    expect(tree.features[0]?.issueId).toBe('PAN-539');
    expect(tree.features[1]?.issueId).toBe('PAN-821');
    expect(tree.features[0]?.sessions).toHaveLength(1);
    expect(tree.features[1]?.sessions).toHaveLength(1);

    // Subprocess fan-out fix: listSessionNamesAsync called exactly once
    expect(listSessionNamesAsync).toHaveBeenCalledTimes(1);
    // fetchActivityDataWithContext called per feature but without redundant tmux spawns
    expect(fetchActivityDataWithContext).toHaveBeenCalledTimes(2);
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

  it('resolves feature title from PLANNING_PROMPT.md when available', async () => {
    (listProjects as any).mockReturnValue([
      {
        key: 'panopticon-cli',
        config: { name: 'panopticon-cli', path: '/tmp/panopticon-cli', workspace: { workspaces_dir: 'workspaces' } },
      },
    ]);
    (listSessionNamesAsync as any).mockResolvedValue([]);
    mockAccess(new Set([
      '/tmp/panopticon-cli/workspaces',
      '/tmp/panopticon-cli/workspaces/feature-pan-123/.planning',
    ]));
    (readdir as any).mockResolvedValue([
      { name: 'feature-pan-123', isDirectory: () => true },
    ]);
    (readFile as any).mockImplementation((p: string) => {
      if (p.includes('PLANNING_PROMPT.md')) {
        return Promise.resolve('# Implement Command Deck Session Tree\n\nSome details here.');
      }
      const err = new Error('ENOENT');
      (err as any).code = 'ENOENT';
      return Promise.reject(err);
    });
    (fetchActivityDataWithContext as any).mockResolvedValue({
      issueId: 'PAN-123',
      sections: [
        {
          type: 'work',
          sessionId: 'agent-pan-123',
          model: 'gpt-4',
          startedAt: '2026-01-01T00:00:00Z',
          duration: 100,
          status: 'running',
          presence: 'active',
        },
      ],
    });

    const result = await fetchProjectSessionTree('panopticon-cli');
    const tree = result as { features: Array<{ issueId: string; title: string }> };
    expect(tree.features).toHaveLength(1);
    expect(tree.features[0]?.issueId).toBe('PAN-123');
    expect(tree.features[0]?.title).toBe('Implement Command Deck Session Tree');
  });
});
