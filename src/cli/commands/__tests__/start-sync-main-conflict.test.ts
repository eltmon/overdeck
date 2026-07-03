/**
 * PAN-1872 regression test: pan start must continue to spawn the work agent
 * when sync-main reports a merge conflict, instead of crashing with
 * `Cannot read properties of undefined (reading 'toUpperCase')`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Effect } from 'effect';

const syncMainMock = vi.hoisted(() => vi.fn());
const spawnAgentMock = vi.hoisted(() => vi.fn());
const stopAgentMock = vi.hoisted(() => vi.fn());
const getAgentStateSyncMock = vi.hoisted(() => vi.fn());
const execSyncMock = vi.hoisted(() => vi.fn());
const execFileSyncMock = vi.hoisted(() => vi.fn());
const resolveProjectFromIssueSyncMock = vi.hoisted(() => vi.fn());
const vbriefLifecycleMocks = vi.hoisted(() => ({
  transitionVBriefOnMain: vi.fn(),
  updatePlanStatus: vi.fn(),
}));
const promptMocks = vi.hoisted(() => ({
  buildWorkAgentPrompt: vi.fn(async () => 'prompt'),
  getTrackerContext: vi.fn(async () => ''),
  readPlanningContext: vi.fn(async () => null),
  readBeadsTasks: vi.fn(async () => []),
}));
const oraMocks = vi.hoisted(() => {
  const spinner = {
    text: '',
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  };
  spinner.start.mockReturnValue(spinner);
  return {
    ora: vi.fn(() => spinner),
    spinner,
  };
});

vi.mock('../../../lib/cloister/merge-agent.js', () => ({
  syncMainIntoWorkspace: syncMainMock,
}));

vi.mock('../../../lib/agents.js', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/agents.js')>('../../../lib/agents.js');
  return {
    ...actual,
    spawnAgent: spawnAgentMock,
    stopAgent: stopAgentMock,
    getAgentStateSync: getAgentStateSyncMock,
    clearAgentPausedSync: vi.fn(),
  };
});

vi.mock('ora', () => ({
  default: oraMocks.ora,
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    exec: vi.fn((_cmd: string, _opts: any, cb?: any) => {
      if (cb) cb(null, { stdout: '', stderr: '' });
      return { stdout: '', stderr: '' } as any;
    }),
    execSync: execSyncMock,
    execFileSync: execFileSyncMock,
  };
});

vi.mock('../../../lib/work-agent-lifecycle.js', () => ({
  assertCanStartFreshSync: vi.fn(() => ({ canStartFresh: true })),
}));

vi.mock('../../../lib/vbrief/lifecycle-io.js', () => ({
  transitionVBriefOnMain: vbriefLifecycleMocks.transitionVBriefOnMain,
  updatePlanStatus: vbriefLifecycleMocks.updatePlanStatus,
}));

vi.mock('../../../lib/cloister/work-agent-prompt.js', () => ({
  buildWorkAgentPrompt: promptMocks.buildWorkAgentPrompt,
  getTrackerContext: promptMocks.getTrackerContext,
  readPlanningContext: promptMocks.readPlanningContext,
  readBeadsTasks: promptMocks.readBeadsTasks,
}));

vi.mock('../../../lib/config.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/config.js')>()),
}));

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: resolveProjectFromIssueSyncMock,
  findProjectByPathSync: vi.fn(),
  getIssuePrefix: vi.fn(() => 'PAN'),
}));

describe('pan start sync-main conflict (PAN-1872)', () => {
  let tmpDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let originalExitCode: string | number | undefined;

  function createWorkspace(issueId: string) {
    const workspacePath = join(tmpDir, 'workspaces', `feature-${issueId.toLowerCase()}`);
    mkdirSync(workspacePath, { recursive: true });
    // Provide a beads JSONL fallback so the async bd list retry path counts a
    // task even though this test does not exercise the bd CLI.
    mkdirSync(join(workspacePath, '.beads'), { recursive: true });
    writeFileSync(
      join(workspacePath, '.beads', 'issues.jsonl'),
      JSON.stringify({ id: 'bead-1', title: 'Implement issue', labels: [issueId.toLowerCase()] }) + '\n',
    );
    return workspacePath;
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pan-1872-start-'));
    createWorkspace('PAN-1872');

    syncMainMock.mockReset();
    spawnAgentMock.mockReset();
    stopAgentMock.mockReset();
    getAgentStateSyncMock.mockReset();
    execSyncMock.mockReset();
    execFileSyncMock.mockReset();
    resolveProjectFromIssueSyncMock.mockReset();
    vbriefLifecycleMocks.transitionVBriefOnMain.mockReset();
    vbriefLifecycleMocks.updatePlanStatus.mockReset();
    promptMocks.buildWorkAgentPrompt.mockClear();
    promptMocks.getTrackerContext.mockClear();
    promptMocks.readPlanningContext.mockReset();
    promptMocks.readPlanningContext.mockResolvedValue(null);
    promptMocks.readBeadsTasks.mockReset();
    promptMocks.readBeadsTasks.mockResolvedValue([]);
    oraMocks.ora.mockClear();
    oraMocks.spinner.text = '';
    oraMocks.spinner.start.mockClear();
    oraMocks.spinner.succeed.mockClear();
    oraMocks.spinner.fail.mockClear();
    oraMocks.spinner.warn.mockClear();
    oraMocks.spinner.info.mockClear();
    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    resolveProjectFromIssueSyncMock.mockImplementation(() => ({
      projectKey: 'overdeck',
      projectName: 'overdeck',
      projectPath: tmpDir,
      linearTeam: 'PAN',
    }));

    syncMainMock.mockResolvedValue({ success: true, commitCount: 0 });
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('git branch --show-current')) return 'feature/pan-1872\n';
      return '';
    });

    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'bd' && args[0] === 'list') {
        return JSON.stringify([{ id: 'bead-1', title: 'Implement issue', status: 'open' }]);
      }
      return '';
    });

    getAgentStateSyncMock.mockReturnValue(null);
    spawnAgentMock.mockResolvedValue({
      id: 'agent-pan-1872',
      issueId: 'PAN-1872',
      workspace: join(tmpDir, 'workspaces', 'feature-pan-1872'),
      harness: 'claude-code',
      model: 'claude-sonnet-4-6',
      role: 'work',
      startedAt: '2026-06-29T00:00:00.000Z',
      kickoffDelivered: true,
    });
    vbriefLifecycleMocks.transitionVBriefOnMain.mockReturnValue(Effect.succeed({
      fromDir: 'proposed',
      toDir: 'active',
      toPath: join(tmpDir, '.pan', 'specs', 'PAN-1872.vbrief.json'),
      statusUpdated: true,
      committed: false,
      moved: true,
    }));

    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code ?? 'undefined'}`);
    }) as never);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    process.exitCode = originalExitCode;
    vi.resetModules();
  });

  it('continues to spawn the agent when sync-main reports a conflict', async () => {
    syncMainMock.mockResolvedValue({
      success: false,
      conflictFiles: ['tests/foo.test.ts'],
      reason: 'Sync-main produced 1 conflict(s) in PAN-1872: tests/foo.test.ts. Resolve manually in the workspace, then re-run sync-main.',
    });

    const { issueCommand } = await import('../start.js');

    await issueCommand('PAN-1872', {
      model: 'claude-sonnet-4-6',
      force: true,
    } as any);

    expect(syncMainMock).toHaveBeenCalledWith(expect.any(String), 'PAN-1872');
    expect(spawnAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 'PAN-1872',
        role: 'work',
      }),
    );
    expect(vbriefLifecycleMocks.transitionVBriefOnMain).toHaveBeenCalledWith(
      tmpDir,
      'PAN-1872',
      'active',
      'approved',
      'scope: approve PAN-1872 vBRIEF',
    );
  });

  it('reuses a stopped agent model when sync-main conflicts before spawning', async () => {
    createWorkspace('PAN-1491');
    getAgentStateSyncMock.mockReturnValue({
      id: 'agent-pan-1491',
      issueId: 'PAN-1491',
      workspace: join(tmpDir, 'workspaces', 'feature-pan-1491'),
      harness: 'claude-code',
      model: 'gpt-5.5',
      role: 'work',
      status: 'stopped',
    });
    syncMainMock.mockResolvedValue({
      success: false,
      conflictFiles: ['roles/flywheel.md', 'tests/integration/agent-spawning.test.ts'],
      reason: 'Sync-main produced 2 conflict(s) in PAN-1491: roles/flywheel.md, tests/integration/agent-spawning.test.ts. Resolve manually in the workspace, then re-run sync-main.',
    });

    const { issueCommand } = await import('../start.js');

    await issueCommand('PAN-1491', {
      force: true,
    } as any);

    expect(syncMainMock).toHaveBeenCalledWith(expect.any(String), 'PAN-1491');
    expect(spawnAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 'PAN-1491',
        model: 'gpt-5.5',
        role: 'work',
      }),
    );
  });

  it('reports kickoff delivery failure with non-zero exit while preserving the live session', async () => {
    spawnAgentMock.mockResolvedValueOnce({
      id: 'agent-pan-1872',
      issueId: 'PAN-1872',
      workspace: join(tmpDir, 'workspaces', 'feature-pan-1872'),
      harness: 'claude-code',
      model: 'claude-sonnet-4-6',
      role: 'work',
      startedAt: '2026-06-29T00:00:00.000Z',
      kickoffDelivered: false,
    });
    promptMocks.readPlanningContext.mockResolvedValueOnce('context');
    promptMocks.readBeadsTasks.mockResolvedValueOnce([{ id: 'bead-1', title: 'Implement issue' }]);

    const { issueCommand } = await import('../start.js');

    await issueCommand('PAN-1872', {
      model: 'claude-sonnet-4-6',
      force: true,
    } as any);

    const output = consoleLogSpy.mock.calls.map(call => String(call[0])).join('\n');
    expect(oraMocks.spinner.fail).toHaveBeenCalledWith(expect.stringContaining('kickoff'));
    expect(oraMocks.spinner.succeed).not.toHaveBeenCalledWith(expect.stringContaining('Agent spawned'));
    expect(process.exitCode).toBe(1);
    expect(output).toContain('agent-pan-1872');
    expect(output.toLowerCase()).toContain('kickoff');
    expect(output).toContain('session is preserved');
    expect(output).toContain('pan tell PAN-1872');
    expect(output).not.toContain('Beads:');
    expect(stopAgentMock).not.toHaveBeenCalled();
  });

  it('preserves success output when kickoff delivery was confirmed', async () => {
    promptMocks.readPlanningContext.mockResolvedValueOnce('context');
    promptMocks.readBeadsTasks.mockResolvedValueOnce([{ id: 'bead-1', title: 'Implement issue' }]);

    const { issueCommand } = await import('../start.js');

    await issueCommand('PAN-1872', {
      model: 'claude-sonnet-4-6',
      force: true,
    } as any);

    const output = consoleLogSpy.mock.calls.map(call => String(call[0])).join('\n');
    expect(oraMocks.spinner.succeed).toHaveBeenCalledWith('Agent spawned: agent-pan-1872');
    expect(oraMocks.spinner.fail).not.toHaveBeenCalledWith(expect.stringContaining('kickoff'));
    expect(output).toContain('Agent Details:');
    expect(output).toContain('Context Loaded:');
    expect(output).toContain('Beads:');
    expect(process.exitCode).not.toBe(1);
  });
});
