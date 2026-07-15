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
  spawnAgent: vi.fn(async () => ({
    id: 'agent-pan-x',
    issueId: 'PAN-X',
    workspace: '/tmp',
    model: 'm',
    startedAt: new Date().toISOString(),
    kickoffDelivered: true,
  })),
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

vi.mock('../../../lib/vbrief/io.js', () => ({
  findPlanSync: findPlanSyncMock,
}));

vi.mock('../../../lib/agents.js', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/agents.js')>('../../../lib/agents.js');
  return {
    ...actual,
    getAgentStateSync: agentMocks.getAgentStateSync,
    clearAgentPausedSync: agentMocks.clearAgentPausedSync,
    spawnAgent: agentMocks.spawnAgent,
  };
});

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: resolveProjectMock,
  findProjectByPathSync: vi.fn(),
  getIssuePrefix: vi.fn(() => 'PAN'),
}));

vi.mock('ora', () => ({ default: oraMocks.ora }));

describe('pan start on already-running work agent (PAN-2407)', () => {
  let tmpDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
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
    tmpDir = mkdtempSync(join(tmpdir(), 'pan-2407-running-'));

    lifecycleMocks.getWorkAgentLifecycleStateSync.mockReset();
    lifecycleMocks.assertCanStartFreshSync.mockReset();
    agentMocks.getAgentStateSync.mockReset();
    agentMocks.clearAgentPausedSync.mockReset();
    agentMocks.spawnAgent.mockReset();
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
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    consoleLogSpy.mockRestore();
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
    const written = allConsoleOutput(consoleLogSpy);
    expect(written).toMatch(/already running/);
    expect(written).toMatch(/pan tell PAN-X/);
    expect(written).toMatch(/tmux -L overdeck attach -t agent-pan-x/);
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

  it('preserves the resume/fresh refusal for a stopped agent with a resumable session', async () => {
    createWorkspace('PAN-X');
    findPlanSyncMock.mockReturnValue('/tmp/.pan/specs/PAN-X.vbrief.json');
    agentMocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-x',
      issueId: 'PAN-X',
      paused: false,
      troubled: false,
      workspace: join(tmpDir, 'workspaces', 'feature-pan-x'),
    });
    mockLifecycle({ isRunning: false, isRunningButStuck: false });
    lifecycleMocks.assertCanStartFreshSync.mockImplementation(() => {
      throw new Error('use pan resume or --fresh');
    });

    const { issueCommand } = await import('../start.js');
    await expect(issueCommand('PAN-X', { model: '', plan: 'auto' } as any)).rejects.toThrow(/__exit__:1/);

    expect(oraMocks.spinner.fail).toHaveBeenCalledWith(expect.stringContaining('use pan resume or --fresh'));
  });
});
