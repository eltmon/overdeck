/**
 * `pan spawn` against a fake terminal backend (PAN-3917 W9, AC-9).
 *
 * The adapters land with W8; this pins the contract `pan spawn` codes against:
 * the pane goes into the issue's workspace, carries the FR-5 tokens with role
 * `worker`, and an item with a `files_scope` gets its own worktree.
 */

import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentPaneRef,
  StartAgentSpec,
  TerminalBackend,
  WorkspaceRef,
} from '../../../../src/lib/terminal-backends/types.js';

const mocks = vi.hoisted(() => ({
  readPlan: vi.fn(),
  exists: vi.fn(() => true),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: () => ({ projectKey: 'test', projectPath: '/tmp/proj' }),
}));
vi.mock('../../../../src/lib/issue-id.js', () => ({ resolveIssueIdSync: (id: string) => id.toUpperCase() }));
vi.mock('../../../../src/lib/xbrief/io.js', () => ({ readWorkspacePlanSync: mocks.readPlan }));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: (path: string) => mocks.exists(path),
}));

import { spawnCommand } from '../../../../src/cli/commands/spawn.js';

interface Started {
  workspace: WorkspaceRef;
  spec: StartAgentSpec;
}

function fakeBackend(started: Started[]): TerminalBackend {
  const pane: AgentPaneRef = {
    backend: 'herdr',
    workspaceId: 'w1',
    paneId: 'w1:p2',
    terminalId: 'w1:p2',
    agentName: 'worker',
  };
  return {
    name: 'herdr',
    workspaceFor: (issueId: string, cwd: string) =>
      Effect.succeed({ backend: 'herdr', workspaceId: 'w1', issueId, cwd } as WorkspaceRef),
    startAgent: (workspace: WorkspaceRef, spec: StartAgentSpec) => {
      started.push({ workspace, spec });
      return Effect.succeed(pane);
    },
  } as unknown as TerminalBackend;
}

function plan(metadata?: Record<string, unknown>) {
  return { plan: { id: 'PAN-1', items: [{ id: 'item-a', title: 'A', status: 'pending', metadata }], edges: [] } };
}

describe('pan spawn', () => {
  let started: Started[];
  let printed: string[];

  beforeEach(() => {
    started = [];
    printed = [];
    vi.clearAllMocks();
    mocks.exists.mockReturnValue(true);
    mocks.readPlan.mockReturnValue(plan());
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => { printed.push(String(line)); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('starts a worker pane in the issue workspace and prints the pane id', async () => {
    await spawnCommand(
      { issue: 'PAN-1', item: 'item-a', model: 'opus', harness: 'claude-code' },
      { resolveBackend: async () => fakeBackend(started) },
    );

    expect(started).toHaveLength(1);
    expect(started[0].workspace.issueId).toBe('PAN-1');
    expect(started[0].workspace.cwd).toBe('/tmp/proj/workspaces/feature-pan-1');
    expect(started[0].spec.cwd).toBe('/tmp/proj/workspaces/feature-pan-1');
    expect(printed).toEqual(['w1:p2']);
  });

  it('stamps the FR-5 metadata tokens with role worker', async () => {
    await spawnCommand(
      { issue: 'PAN-1', item: 'item-a', model: 'sonnet', harness: 'codex' },
      { resolveBackend: async () => fakeBackend(started) },
    );

    expect(started[0].spec.tokens).toEqual({
      issue: 'PAN-1',
      role: 'worker',
      harness: 'codex',
      model: 'sonnet',
    });
    expect(started[0].spec.kind).toBe('codex');
  });

  it('gives an item with a files_scope its own worktree under .swarm/', async () => {
    mocks.readPlan.mockReturnValue(plan({ files_scope: ['src/lib/**'] }));
    const createWorktree = vi.fn(async (workspacePath: string, itemId: string) => `${workspacePath}/.swarm/${itemId}`);

    await spawnCommand(
      { issue: 'PAN-1', item: 'item-a', model: 'opus' },
      { resolveBackend: async () => fakeBackend(started), createWorktree },
    );

    expect(createWorktree).toHaveBeenCalledWith('/tmp/proj/workspaces/feature-pan-1', 'item-a');
    expect(started[0].spec.cwd).toBe('/tmp/proj/workspaces/feature-pan-1/.swarm/item-a');
  });

  it('refuses an item that is not in the issue xBRIEF', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    mocks.readPlan.mockReturnValue(plan());

    await spawnCommand(
      { issue: 'PAN-1', item: 'nope', model: 'opus' },
      { resolveBackend: async () => fakeBackend(started) },
    );

    expect(started).toHaveLength(0);
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore();
  });
});
