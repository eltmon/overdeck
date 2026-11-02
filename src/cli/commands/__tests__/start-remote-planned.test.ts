/**
 * PAN-4683 WI-2: `pan start <id> --remote` finds a planned issue's spec on the
 * local workspace or the feature branch and does not re-plan it.
 */
import { Effect } from 'effect';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../../../lib/state-auto-migrate.js', () => ({
  requireAutomaticStateMigration: vi.fn(),
}));

const lifecycleMocks = vi.hoisted(() => ({
  getWorkAgentLifecycleState: vi.fn(),
  assertCanStartFresh: vi.fn(),
}));

const agentMocks = vi.hoisted(() => ({
  getAgentState: vi.fn(),
  clearAgentPaused: vi.fn(),
  clearAgentTroubled: vi.fn(),
  stopAgent: vi.fn(),
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

const interventionMocks = vi.hoisted(() => ({
  appendOperatorInterventionEvent: vi.fn(async () => {}),
}));

const resolveProjectMock = vi.hoisted(() => vi.fn());
const findPlanSyncMock = vi.hoisted(() => vi.fn());
const findIssuePlanMock = vi.hoisted(() => vi.fn());

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

vi.mock('../../../lib/xbrief/issue-plan-lookup.js', () => ({
  findIssuePlan: findIssuePlanMock,
}));

vi.mock('../../../lib/agents.js', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/agents.js')>('../../../lib/agents.js');
  return {
    ...actual,
    getAgentState: agentMocks.getAgentState,
    clearAgentPaused: agentMocks.clearAgentPaused,
    clearAgentTroubled: agentMocks.clearAgentTroubled,
    stopAgent: (...args: unknown[]) => Effect.sync(() => { agentMocks.stopAgent(...args); }),
    wipeAgentStateDirs: agentMocks.wipeAgentStateDirs,
    spawnAgent: agentMocks.spawnAgent,
  };
});

vi.mock('../../../lib/operator-interventions.js', () => ({
  appendOperatorInterventionEvent: interventionMocks.appendOperatorInterventionEvent,
}));

vi.mock('../../../lib/tmux.js', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/tmux.js')>('../../../lib/tmux.js');
  return {
    ...actual,
    sessionExistsSync: tmuxMocks.sessionExistsSync,
    sessionExists: (name: string) => Effect.sync(() => tmuxMocks.sessionExistsSync(name)),
  };
});

// PAN-4012: --fresh probes the host's terminal backend; the same liveness world drives it here.
vi.mock('../../../lib/terminal-backends/launch.js', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/terminal-backends/launch.js')>('../../../lib/terminal-backends/launch.js');
  return { ...actual, agentPaneExists: async (name: string) => tmuxMocks.sessionExistsSync(name) };
});

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: resolveProjectMock,
  getProjectSync: vi.fn(),
  findProjectByPath: vi.fn(),
  getIssuePrefix: vi.fn(() => 'PAN'),
}));

vi.mock('ora', () => ({ default: oraMocks.ora }));

const startOnMachineMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../start-machine.js', () => ({ startOnMachine: startOnMachineMock }));

import { issueCommand } from '../start.js';

describe('pan start --remote on a planned issue (PAN-4683)', () => {
  let tmpDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let originalExitCode: number | undefined;
  const fetchMock = vi.fn();

  function startPlanningCalls(): unknown[][] {
    return fetchMock.mock.calls.filter(([url]) => String(url).includes('/start-planning'));
  }

  beforeEach(() => {
    delete process.env['OVERDECK_AGENT_STARTED_BY'];
    tmpDir = mkdtempSync(join(tmpdir(), 'pan-4683-remote-planned-'));

    lifecycleMocks.getWorkAgentLifecycleState.mockReset();
    lifecycleMocks.getWorkAgentLifecycleState.mockReturnValue({ agentId: 'agent-pan-4677', isRunning: false, isRunningButStuck: false });
    lifecycleMocks.assertCanStartFresh.mockReset();
    // Stop the run right after the planning route, before remote provisioning.
    lifecycleMocks.assertCanStartFresh.mockImplementation(() => {
      throw new Error('__past_planning__');
    });
    agentMocks.getAgentState.mockReset();
    agentMocks.getAgentState.mockReturnValue(null);
    findPlanSyncMock.mockReset();
    findIssuePlanMock.mockReset();
    resolveProjectMock.mockReset();
    resolveProjectMock.mockImplementation(() => ({
      projectKey: 'overdeck',
      projectName: 'overdeck',
      projectPath: tmpDir,
      linearTeam: 'PAN',
    }));
    oraMocks.spinner.text = '';
    oraMocks.spinner.fail.mockClear();
    oraMocks.spinner.info.mockClear();

    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'planning refused in test' }) });
    vi.stubGlobal('fetch', fetchMock);

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
    vi.unstubAllGlobals();
    exitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    stderrSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  it('does not request start-planning when the plan is on the feature branch', async () => {
    findIssuePlanMock.mockResolvedValue('refs/heads/feature/pan-4677:.pan/specs/x.xbrief.json');

    await issueCommand('PAN-4677', { model: '', remote: true, plan: 'auto' } as any).catch(() => undefined);

    expect(findIssuePlanMock).toHaveBeenCalledWith({ issueId: 'PAN-4677', projectRoot: tmpDir, localWorkspace: null });
    expect(startPlanningCalls()).toHaveLength(0);
    expect(lifecycleMocks.assertCanStartFresh).toHaveBeenCalled();
  });

  it('requests start-planning when no plan is found', async () => {
    findIssuePlanMock.mockResolvedValue(null);

    await issueCommand('PAN-4677', { model: '', remote: true, plan: 'auto' } as any).catch(() => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/issues\/PAN-4677\/start-planning$/);
    expect(lifecycleMocks.assertCanStartFresh).not.toHaveBeenCalled();
  });

  it('checks the local workspace even when --remote is given', async () => {
    const workspace = join(tmpDir, 'workspaces', 'feature-pan-4677');
    mkdirSync(workspace, { recursive: true });
    findIssuePlanMock.mockResolvedValue(join(workspace, '.pan', 'specs', 'x.xbrief.json'));

    await issueCommand('PAN-4677', { model: '', remote: true, plan: 'auto' } as any).catch(() => undefined);

    expect(findIssuePlanMock).toHaveBeenCalledWith({ issueId: 'PAN-4677', projectRoot: tmpDir, localWorkspace: workspace });
    expect(startPlanningCalls()).toHaveLength(0);
  });

  it('treats --machine fly as --remote and never starts on a linked machine (PAN-4734 FR-2)', async () => {
    findIssuePlanMock.mockResolvedValue('refs/heads/feature/pan-4677:.pan/specs/x.xbrief.json');
    startOnMachineMock.mockClear();
    const options = { model: '', machine: 'Fly', plan: 'auto' } as any;

    await issueCommand('PAN-4677', options).catch(() => undefined);

    expect(startOnMachineMock).not.toHaveBeenCalled();
    expect(options.remote).toBe(true);
    expect(options.machine).toBeUndefined();
    expect(lifecycleMocks.assertCanStartFresh).toHaveBeenCalled();
  });
});
