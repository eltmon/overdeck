import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Use vi.hoisted to avoid initialization order issues
const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));
vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>();
  return {
    ...actual,
    promisify: () => mockExecAsync,
  };
});

vi.mock('../../../../src/lib/tmux.js', async () => {
  const { Effect } = await import('effect');
  return {
    sessionExistsAsync: vi.fn().mockResolvedValue(false),
    killSessionAsync: vi.fn().mockResolvedValue(undefined),
    listSessionNamesAsync: vi.fn().mockResolvedValue([]),
    sessionExistsAsyncEffect: vi.fn(() => Effect.succeed(false)),
    killSessionAsyncEffect: vi.fn(() => Effect.succeed(undefined)),
    listSessionNamesAsyncEffect: vi.fn(() => Effect.succeed([])),
  };
});

vi.mock('../../../../src/lib/paths.js', () => ({
  AGENTS_DIR: join(tmpdir(), 'panopticon-test-agents'),
  PANOPTICON_HOME: join(tmpdir(), 'panopticon-test-home'),
  PROJECT_PRDS_SUBDIR: 'prds',
  PROJECT_PRDS_ACTIVE_SUBDIR: 'active',
  PROJECT_PRDS_PLANNED_SUBDIR: 'planned',
  PROJECT_PRDS_COMPLETED_SUBDIR: 'completed',
}));

vi.mock('../../../../src/lib/shadow-state.js', () => ({
  removeShadowState: vi.fn().mockReturnValue({ success: true }),
}));

import { Effect } from 'effect';
import { teardownWorkspace as teardownWorkspaceEffect } from '../../../../src/lib/lifecycle/teardown-workspace.js';
import { sessionExistsAsyncEffect } from '../../../../src/lib/tmux.js';
import { AGENTS_DIR } from '../../../../src/lib/paths.js';

const teardownWorkspace = (...args: Parameters<typeof teardownWorkspaceEffect>) =>
  Effect.runPromise(teardownWorkspaceEffect(...args));

describe('teardown-workspace', () => {
  let testDir: string;
  let agentsDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `panopticon-teardown-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    agentsDir = AGENTS_DIR;
    mkdirSync(agentsDir, { recursive: true });

    vi.clearAllMocks();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    if (existsSync(agentsDir)) {
      rmSync(agentsDir, { recursive: true, force: true });
    }
  });

  it('should kill tmux sessions when they exist', async () => {
    vi.mocked(sessionExistsAsyncEffect).mockReturnValue(Effect.succeed(true));
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

    const results = await teardownWorkspace({
      issueId: 'PAN-100',
      projectPath: testDir,
    });

    const tmuxResult = results.find(r => r.step === 'teardown:tmux-sessions');
    expect(tmuxResult).toBeDefined();
    expect(tmuxResult!.success).toBe(true);
  });

  it('should skip tmux sessions when none exist', async () => {
    vi.mocked(sessionExistsAsyncEffect).mockReturnValue(Effect.succeed(false));

    const results = await teardownWorkspace({
      issueId: 'PAN-100',
      projectPath: testDir,
    });

    const tmuxResult = results.find(r => r.step === 'teardown:tmux-sessions');
    expect(tmuxResult).toBeDefined();
    expect(tmuxResult!.skipped).toBe(true);
  });

  it('should clear shadow state', async () => {
    const results = await teardownWorkspace({
      issueId: 'PAN-100',
      projectPath: testDir,
    });

    const shadowResult = results.find(r => r.step === 'teardown:shadow-state');
    expect(shadowResult).toBeDefined();
    expect(shadowResult!.success).toBe(true);
  });

  it('should clear legacy planning directory when it exists', async () => {
    const legacyDir = join(testDir, '.planning', 'pan-100');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'STATE.md'), '# State');

    const results = await teardownWorkspace({
      issueId: 'PAN-100',
      projectPath: testDir,
    });

    const legacyResult = results.find(r => r.step === 'teardown:legacy-planning-dir');
    expect(legacyResult).toBeDefined();
    expect(legacyResult!.success).toBe(true);
    expect(legacyResult!.skipped).toBe(false);
    expect(existsSync(legacyDir)).toBe(false);
  });

  it('should skip legacy planning directory when it does not exist', async () => {
    const results = await teardownWorkspace({
      issueId: 'PAN-100',
      projectPath: testDir,
    });

    const legacyResult = results.find(r => r.step === 'teardown:legacy-planning-dir');
    expect(legacyResult).toBeDefined();
    expect(legacyResult!.skipped).toBe(true);
  });

  it('should remove agent state directories', async () => {
    // Create agent state dirs
    const agentDir = join(agentsDir, 'agent-pan-100');
    const planningDir = join(agentsDir, 'planning-pan-100');
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(planningDir, { recursive: true });

    const results = await teardownWorkspace({
      issueId: 'PAN-100',
      projectPath: testDir,
    });

    const agentResult = results.find(r => r.step === 'teardown:agent-state');
    expect(agentResult).toBeDefined();
    expect(agentResult!.success).toBe(true);
    expect(existsSync(agentDir)).toBe(false);
    expect(existsSync(planningDir)).toBe(false);
  });

  it('should skip workspace cleanup when no workspace exists', async () => {
    const results = await teardownWorkspace({
      issueId: 'PAN-100',
      projectPath: testDir,
    });

    const wsResult = results.find(r => r.step === 'teardown:workspace');
    expect(wsResult).toBeDefined();
    expect(wsResult!.skipped).toBe(true);
  });

  it('should delete branches when explicitly requested', async () => {
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

    const results = await teardownWorkspace(
      { issueId: 'PAN-100', projectPath: testDir },
      { deleteBranches: true },
    );

    const branchResult = results.find(r => r.step === 'teardown:branches');
    expect(branchResult).toBeDefined();
    expect(branchResult!.success).toBe(true);
  });

  it('should not delete branches by default', async () => {
    const results = await teardownWorkspace({
      issueId: 'PAN-100',
      projectPath: testDir,
    });

    const branchResult = results.find(r => r.step === 'teardown:branches');
    expect(branchResult).toBeUndefined();
  });

  it('should not delete workspace when deleteWorkspace is false', async () => {
    // Create workspace (findWorkspacePath looks for workspaces/<issueLower>)
    const wsPath = join(testDir, 'workspaces', 'pan-100');
    mkdirSync(wsPath, { recursive: true });
    writeFileSync(join(wsPath, 'file.txt'), 'content');

    const results = await teardownWorkspace(
      { issueId: 'PAN-100', projectPath: testDir },
      { deleteWorkspace: false },
    );

    // Workspace should still exist
    expect(existsSync(wsPath)).toBe(true);

    // Worktree removal step should not appear
    const worktreeResult = results.find(r => r.step === 'teardown:worktree');
    expect(worktreeResult).toBeUndefined();
  });

  it('should NOT clear beads by default (normal completion preserves beads)', async () => {
    const wsPath = join(testDir, 'workspaces', 'pan-100');
    const beadsDir = join(testDir, '.beads');
    mkdirSync(wsPath, { recursive: true });
    mkdirSync(beadsDir, { recursive: true });
    writeFileSync(
      join(beadsDir, 'issues.jsonl'),
      JSON.stringify({ id: 'bead-1', title: 'PAN-100: Task one', status: 'closed' }) + '\n'
    );

    const results = await teardownWorkspace({
      issueId: 'PAN-100',
      projectPath: testDir,
    });

    // clear-beads step should NOT appear (beads preserved)
    const clearResult = results.find(r => r.step === 'teardown:clear-beads');
    expect(clearResult).toBeUndefined();

    // Project JSONL should still contain the bead
    const { readFileSync } = await import('fs');
    const content = readFileSync(join(beadsDir, 'issues.jsonl'), 'utf-8');
    expect(content).toContain('PAN-100');
  });

  it('should clear beads when clearBeads is true (wipe scenario)', async () => {
    const wsPath = join(testDir, 'workspaces', 'pan-100');
    const beadsDir = join(testDir, '.beads');
    mkdirSync(wsPath, { recursive: true });
    mkdirSync(beadsDir, { recursive: true });
    writeFileSync(
      join(beadsDir, 'issues.jsonl'),
      JSON.stringify({ id: 'bead-1', title: 'PAN-100: Task one', status: 'closed' }) + '\n' +
      JSON.stringify({ id: 'bead-2', title: 'PAN-200: Other issue', status: 'open' }) + '\n'
    );

    const results = await teardownWorkspace(
      { issueId: 'PAN-100', projectPath: testDir },
      { clearBeads: true },
    );

    const clearResult = results.find(r => r.step === 'teardown:clear-beads');
    expect(clearResult).toBeDefined();
    expect(clearResult!.success).toBe(true);

    // PAN-100 bead should be removed, PAN-200 preserved
    const { readFileSync } = await import('fs');
    const content = readFileSync(join(beadsDir, 'issues.jsonl'), 'utf-8');
    expect(content).not.toContain('PAN-100');
    expect(content).toContain('PAN-200');
  });
});
