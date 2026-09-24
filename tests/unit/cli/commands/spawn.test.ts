/**
 * `pan spawn` against a fake terminal backend (PAN-3917 W9, AC-9).
 *
 * The adapters land with W8; this pins the contract `pan spawn` codes against:
 * the pane goes into the issue's workspace, carries the FR-5 tokens with role
 * `worker`, and an item with a `files_scope` gets its own worktree.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('../../../../src/lib/issue-id.js', () => ({ resolveIssueId: (id: string) => id.toUpperCase() }));
vi.mock('../../../../src/lib/xbrief/io.js', () => ({ readWorkspacePlanSync: mocks.readPlan }));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: (path: string) => mocks.exists(path),
}));

import { spawnCommand } from '../../../../src/cli/commands/spawn.js';

// HOME is a temp dir for every test in this file: a Claude Code worker spawn
// pre-trusts its cwd in ~/.claude.json (PAN-3905), and the only one it may
// touch is the one seeded here, never the operator's.
let tempHome: string;
let claudeJsonPath: string;
let prevHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'pan-3905-spawn-home-'));
  prevHome = process.env.HOME;
  process.env.HOME = tempHome;
  claudeJsonPath = join(tempHome, '.claude.json');
  writeFileSync(claudeJsonPath, JSON.stringify({ projects: {} }));
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmSync(tempHome, { recursive: true, force: true });
});

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

describe('pan spawn pre-trusts the worker cwd (PAN-3905)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exists.mockReturnValue(true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('trusts the item worktree before starting a Claude Code worker in it', async () => {
    mocks.readPlan.mockReturnValue(plan({ files_scope: ['src/lib/**'] }));
    const itemCwd = '/tmp/proj/workspaces/feature-pan-1/.swarm/item-a';
    const started: Started[] = [];
    let trustedAtStart: boolean | undefined;
    const backend = fakeBackend(started);
    const startAgent = backend.startAgent.bind(backend);
    backend.startAgent = (workspace, spec) => {
      trustedAtStart = JSON.parse(readFileSync(claudeJsonPath, 'utf-8')).projects[itemCwd]?.hasTrustDialogAccepted;
      return startAgent(workspace, spec);
    };

    await spawnCommand(
      { issue: 'PAN-1', item: 'item-a', model: 'opus' },
      { resolveBackend: async () => backend, createWorktree: async () => itemCwd },
    );

    expect(started[0].spec.cwd).toBe(itemCwd);
    expect(trustedAtStart).toBe(true);
  });

  it('leaves ~/.claude.json alone for a worker on another harness', async () => {
    await spawnCommand(
      { issue: 'PAN-1', item: 'item-a', model: 'sonnet', harness: 'codex' },
      { resolveBackend: async () => fakeBackend([]) },
    );

    expect(readFileSync(claudeJsonPath, 'utf-8')).toBe(JSON.stringify({ projects: {} }));
  });
});
