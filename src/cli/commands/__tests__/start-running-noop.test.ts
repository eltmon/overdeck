import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../../../lib/state-auto-migrate.js', () => ({
  requireAutomaticStateMigration: vi.fn(),
}));

const lifecycleMocks = vi.hoisted(() => ({
  getWorkAgentLifecycleStateSync: vi.fn(),
  assertCanStartFreshSync: vi.fn(),
}));

const agentMocks = vi.hoisted(() => ({
  getAgentStateSync: vi.fn(),
  clearAgentPausedSync: vi.fn(),
  stopAgentSync: vi.fn(),
  wipeAgentStateDirs: vi.fn(async () => ({ removed: ['agent-pan-x'], path: '/tmp/agents/agent-pan-x' })),
  spawnAgent: vi.fn(async () => ({
    id: 'agent-pan-x',
    issueId: 'PAN-X',
    workspace: '/tmp',
    model: 'm',
    startedAt: new Date().toISOString(),
    kickoffDelivered: true,
  })),
}));

const tmuxMocks = vi.hoisted(() => ({
  sessionExistsSync: vi.fn(() => false),
}));

const resolveProjectMock = vi.hoisted(() => vi.fn());
const findPlanSyncMock = vi.hoisted(() => vi.fn());

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
  return { ora: vi.fn(() => spinner), spinner };
});

vi.mock('../../../lib/work-agent-lifecycle.js', () => lifecycleMocks);

vi.mock('../../../lib/xbrief/io.js', () => ({
  findPlanSync: findPlanSyncMock,
}));

vi.mock('../../../lib/agents.js', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/agents.js')>('../../../lib/agents.js');
  return {
    ...actual,
    getAgentStateSync: agentMocks.getAgentStateSync,
    clearAgentPausedSync: agentMocks.clearAgentPausedSync,
    stopAgentSync: agentMocks.stopAgentSync,
    wipeAgentStateDirs: agentMocks.wipeAgentStateDirs,
    spawnAgent: agentMocks.spawnAgent,
  };
});

vi.mock('../../../lib/tmux.js', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/tmux.js')>('../../../lib/tmux.js');
  return { ...actual, sessionExistsSync: tmuxMocks.sessionExistsSync };
});

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: resolveProjectMock,
  getProjectSync: vi.fn(),
  findProjectByPathSync: vi.fn(),
  getIssuePrefix: vi.fn(() => 'PAN'),
}));

vi.mock('ora', () => ({ default: oraMocks.ora }));

describe('pan start on already-running work agent (PAN-2407)', () => {
  let tmpDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let originalExitCode: number | undefined;

  function createWorkspace(issueId: string) {
    const workspacePath = join(tmpDir, 'workspaces', `feature-${issueId.toLowerCase()}`);
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(join(workspacePath, '.tasks'), { recursive: true });
    writeFileSync(
      join(workspacePath, '.tasks', 'issues.jsonl'),
      JSON.stringify({ id: 'task-1', title: 'Implement issue', labels: [issueId.toLowerCase()] }) + '\n',
    );
    return workspacePath;
  }

  function allConsoleOutput(spy: ReturnType<typeof vi.spyOn>): string {
    return spy.mock.calls.map(call => call.map(arg => String(arg)).join(' ')).join('\n');
  }

  beforeEach(() => {
    delete process.env['OVERDECK_AGENT_STARTED_BY'];
    delete process.env['OVERDECK_FLYWHEEL_RUN_ID'];
    tmpDir = mkdtempSync(join(tmpdir(), 'pan-2407-running-'));

    lifecycleMocks.getWorkAgentLifecycleStateSync.mockReset();
    lifecycleMocks.assertCanStartFreshSync.mockReset();
    agentMocks.getAgentStateSync.mockReset();
    agentMocks.clearAgentPausedSync.mockReset();
    agentMocks.stopAgentSync.mockReset();
    agentMocks.wipeAgentStateDirs.mockReset();
    agentMocks.wipeAgentStateDirs.mockResolvedValue({ removed: ['agent-pan-x'], path: '/tmp/agents/agent-pan-x' });
    agentMocks.spawnAgent.mockReset();
    tmuxMocks.sessionExistsSync.mockReset();
    tmuxMocks.sessionExistsSync.mockReturnValue(false);
    resolveProjectMock.mockReset();
    findPlanSyncMock.mockReset();
    oraMocks.ora.mockClear();
    oraMocks.spinner.text = '';
    oraMocks.spinner.start.mockClear();
    oraMocks.spinner.succeed.mockClear();
    oraMocks.spinner.fail.mockClear();
    oraMocks.spinner.warn.mockClear();
    oraMocks.spinner.info.mockClear();

    resolveProjectMock.mockImplementation(() => ({
      projectKey: 'overdeck',
      projectName: 'overdeck',
      projectPath: tmpDir,
      linearTeam: 'PAN',
    }));

    lifecycleMocks.assertCanStartFreshSync.mockReturnValue({ canStartFresh: true });

    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code ?? 'undefined'}`);
    }) as never);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    stderrSpy.mockRestore();
    process.exitCode = originalExitCode;
    vi.resetModules();
  });

  function mockLifecycle(partial: Partial<ReturnType<typeof lifecycleMocks.getWorkAgentLifecycleStateSync>>) {
    lifecycleMocks.getWorkAgentLifecycleStateSync.mockReturnValue({
      agentId: 'agent-pan-x',
      isRunning: false,
      isRunningButStuck: false,
      ...partial,
    } as ReturnType<typeof lifecycleMocks.getWorkAgentLifecycleStateSync>);
  }

  it('exits 0 with a no-op message when the work agent is already running', async () => {
    agentMocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-x',
      issueId: 'PAN-X',
      paused: false,
      troubled: false,
    });
    mockLifecycle({ isRunning: true, isRunningButStuck: false });

    const { issueCommand } = await import('../start.js');
    await expect(issueCommand('PAN-X', { model: '' } as any)).resolves.toBeUndefined();

    expect(process.exitCode).toBe(0);
    expect(process.env['OVERDECK_AGENT_STARTED_BY']).toBe('operator:cli:pan-start');
    const written = allConsoleOutput(consoleLogSpy);
    expect(written).toMatch(/already running/);
    expect(written).toMatch(/pan tell PAN-X/);
    expect(written).toMatch(/tmux -L overdeck attach -t agent-pan-x/);
  });

  it('derives flywheel provenance from an inherited run id', async () => {
    process.env['OVERDECK_FLYWHEEL_RUN_ID'] = 'RUN-82';
    agentMocks.getAgentStateSync.mockReturnValue({ id: 'agent-pan-x', issueId: 'PAN-X', paused: false, troubled: false });
    mockLifecycle({ isRunning: true, isRunningButStuck: false });

    const { issueCommand } = await import('../start.js');
    await issueCommand('PAN-X', { model: '' } as any);

    expect(process.env['OVERDECK_AGENT_STARTED_BY']).toBe('flywheel:RUN-82');
  });

  it('preserves inherited route provenance', async () => {
    process.env['OVERDECK_AGENT_STARTED_BY'] = 'orphan-proposed-reconciler';
    agentMocks.getAgentStateSync.mockReturnValue({ id: 'agent-pan-x', issueId: 'PAN-X', paused: false, troubled: false });
    mockLifecycle({ isRunning: true, isRunningButStuck: false });

    const { issueCommand } = await import('../start.js');
    await issueCommand('PAN-X', { model: '' } as any);

    expect(process.env['OVERDECK_AGENT_STARTED_BY']).toBe('orphan-proposed-reconciler');
  });

  it('preserves exit 1 and pause refusal when the agent is paused', async () => {
    agentMocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-x',
      issueId: 'PAN-X',
      paused: true,
      pausedReason: 'needs inspection',
      troubled: false,
    });

    const { issueCommand } = await import('../start.js');
    await expect(issueCommand('PAN-X', { model: '' } as any)).rejects.toThrow(/__exit__:1/);

    const written = allConsoleOutput(stderrSpy);
    expect(written).toContain('paused');
    expect(written).toContain('pan unpause PAN-X');
    expect(lifecycleMocks.getWorkAgentLifecycleStateSync).not.toHaveBeenCalled();
  });

  it('preserves exit 1 and troubled refusal when the agent is troubled', async () => {
    agentMocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-x',
      issueId: 'PAN-X',
      paused: false,
      troubled: true,
      consecutiveFailures: 3,
      lastFailureReason: 'spawn timeout',
    });

    const { issueCommand } = await import('../start.js');
    await expect(issueCommand('PAN-X', { model: '' } as any)).rejects.toThrow(/__exit__:1/);

    const written = allConsoleOutput(stderrSpy);
    expect(written).toContain('troubled');
    expect(written).toContain('pan untroubled PAN-X');
    expect(lifecycleMocks.getWorkAgentLifecycleStateSync).not.toHaveBeenCalled();
  });

  it('preserves the resume/reset refusal for a stopped agent with a resumable session', async () => {
    createWorkspace('PAN-X');
    findPlanSyncMock.mockReturnValue('/tmp/.pan/specs/PAN-X.xbrief.json');
    agentMocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-x',
      issueId: 'PAN-X',
      paused: false,
      troubled: false,
      workspace: join(tmpDir, 'workspaces', 'feature-pan-x'),
    });
    mockLifecycle({ isRunning: false, isRunningButStuck: false });
    lifecycleMocks.assertCanStartFreshSync.mockImplementation(() => {
      throw new Error('use pan resume or pan reset-session');
    });

    const { issueCommand } = await import('../start.js');
    await expect(issueCommand('PAN-X', { model: '', plan: 'auto' } as any)).rejects.toThrow(/__exit__:1/);

    expect(oraMocks.spinner.fail).toHaveBeenCalledWith(expect.stringContaining('use pan resume or pan reset-session'));
  });

  // PAN-3150: an inert-but-alive agent had no recovery door — the already-running
  // no-op swallowed --fresh, and --fresh itself refused a live session by telling
  // the caller to run `pan kill` first, which the flywheel role is forbidden.
  describe('--fresh against a live session (PAN-3150)', () => {
    function arrangeLiveFreshStart() {
      createWorkspace('PAN-X');
      findPlanSyncMock.mockReturnValue('/tmp/.pan/specs/PAN-X.xbrief.json');
      agentMocks.getAgentStateSync.mockReturnValue({
        id: 'agent-pan-x',
        issueId: 'PAN-X',
        paused: false,
        troubled: false,
        workspace: join(tmpDir, 'workspaces', 'feature-pan-x'),
      });
      mockLifecycle({ isRunning: true, isRunningButStuck: false });
      // Live going in; gone once stopAgentSync has run.
      tmuxMocks.sessionExistsSync.mockImplementation(() => agentMocks.stopAgentSync.mock.calls.length === 0);
      lifecycleMocks.assertCanStartFreshSync.mockReturnValue({ canStartFresh: true });
    }

    it('does not no-op on an already-running agent when --fresh is passed', async () => {
      arrangeLiveFreshStart();

      const { issueCommand } = await import('../start.js');
      await issueCommand('PAN-X', { model: '', plan: 'auto', fresh: true } as any).catch(() => undefined);

      expect(allConsoleOutput(consoleLogSpy)).not.toMatch(/already running/);
    });

    it('stops the live session itself instead of demanding pan kill', async () => {
      arrangeLiveFreshStart();

      const { issueCommand } = await import('../start.js');
      await issueCommand('PAN-X', { model: '', plan: 'auto', fresh: true } as any).catch(() => undefined);

      expect(agentMocks.stopAgentSync).toHaveBeenCalledWith('agent-pan-x');
      expect(agentMocks.wipeAgentStateDirs).toHaveBeenCalledWith('PAN-X');
      expect(allConsoleOutput(consoleErrorSpy)).not.toMatch(/pan kill/);
      expect(lifecycleMocks.assertCanStartFreshSync).toHaveBeenCalledWith('PAN-X', {
        allowPausedForce: false,
        allowLiveSessionReplacement: true,
        explicitFresh: true,
      });
    });

    it('refuses only when the session survives the stop', async () => {
      arrangeLiveFreshStart();
      tmuxMocks.sessionExistsSync.mockReturnValue(true); // never dies

      const { issueCommand } = await import('../start.js');
      await issueCommand('PAN-X', { model: '', plan: 'auto', fresh: true } as any).catch(() => undefined);

      expect(agentMocks.stopAgentSync).toHaveBeenCalledWith('agent-pan-x');
      expect(agentMocks.wipeAgentStateDirs).not.toHaveBeenCalled();
      expect(allConsoleOutput(consoleErrorSpy)).toMatch(/still has a live tmux session/);
    });
  });
});
