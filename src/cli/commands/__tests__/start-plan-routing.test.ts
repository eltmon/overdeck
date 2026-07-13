import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Effect } from 'effect';

const loadConfigSyncMock = vi.hoisted(() => vi.fn(() => ({ remote: { enabled: false } })));
const fetchMock = vi.hoisted(() => vi.fn());
const findPlanSyncMock = vi.hoisted(() => vi.fn());
const findSpecByIssueMock = vi.hoisted(() => vi.fn(() => Effect.succeed(null)));
const findRemoteWorkspaceMetadataSyncMock = vi.hoisted(() => vi.fn(() => null));
const concurrencyMocks = vi.hoisted(() => ({
  getConcurrencyLimits: vi.fn(() => ({ maxWorkAgents: 5 })),
  countRunningAgents: vi.fn(() => ({ work: 0 })),
}));
const autoSynthesizeMocks = vi.hoisted(() => ({
  writeAutoStartVBrief: vi.fn(() => Effect.succeed(undefined)),
}));
const beadsMocks = vi.hoisted(() => ({
  createBeadsFromVBrief: vi.fn(() => Effect.succeed({ created: [{ id: 'bead-1' }], errors: [], success: true })),
}));
const spawnAgentMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'agent-pan-x',
  issueId: 'PAN-X',
  workspace: '/tmp',
  model: 'claude-sonnet-4-6',
  harness: 'claude-code',
  role: 'work',
  startedAt: new Date().toISOString(),
  kickoffDelivered: true,
})));
const resolveProjectMock = vi.hoisted(() => vi.fn());
const lifecycleMocks = vi.hoisted(() => ({
  getWorkAgentLifecycleStateSync: vi.fn(() => ({ isRunning: false, isRunningButStuck: false })),
  assertCanStartFreshSync: vi.fn(() => ({ canStartFresh: true })),
}));
const agentMocks = vi.hoisted(() => ({
  getAgentStateSync: vi.fn(),
  clearAgentPausedSync: vi.fn(),
}));
const promptMocks = vi.hoisted(() => ({
  buildWorkAgentPrompt: vi.fn(async () => 'prompt'),
  getTrackerContext: vi.fn(async () => ''),
  readPlanningContext: vi.fn(async () => null),
  readBeadsTasks: vi.fn(async () => []),
}));
const vbriefLifecycleMocks = vi.hoisted(() => ({
  transitionVBriefOnMain: vi.fn(() => Effect.succeed({
    fromDir: 'proposed',
    toDir: 'active',
    toPath: '/tmp/.pan/specs/PAN-X.vbrief.json',
    statusUpdated: true,
    committed: false,
    moved: true,
  })),
  updatePlanStatus: vi.fn(),
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
  return { ora: vi.fn(() => spinner), spinner };
});

global.fetch = fetchMock;

vi.mock('../../../lib/vbrief/io.js', () => ({
  findPlanSync: findPlanSyncMock,
}));

vi.mock('../../../lib/pan-dir/specs.js', () => ({
  findSpecByIssue: findSpecByIssueMock,
  buildPanSpecPath: vi.fn(),
  buildPanSpecFilename: vi.fn(),
  getProjectPanPaths: vi.fn(() => ({ specsDir: '/tmp/.pan/specs' })),
  projectPanPaths: vi.fn(() => ({ specsDir: '/tmp/.pan/specs' })),
}));

vi.mock('../../../lib/remote/workspace-metadata.js', () => ({
  findRemoteWorkspaceMetadataSync: findRemoteWorkspaceMetadataSyncMock,
  loadWorkspaceMetadataSync: vi.fn(() => null),
  saveWorkspaceMetadataSync: vi.fn(),
}));

vi.mock('../../../lib/cloister/concurrency.js', () => concurrencyMocks);

vi.mock('../../../lib/vbrief/auto-synthesize.js', () => autoSynthesizeMocks);

vi.mock('../../../lib/vbrief/beads.js', () => beadsMocks);
vi.mock('../../../lib/beads/resolver.js', () => ({
  createBeadsResolver: () => ({
    getBeadsForIssueSync: () => ({ ok: true, value: [{ id: 'bead-1', title: 'Implement issue', status: 'open', labels: [] }] }),
    getBeadsForIssue: async () => ({ ok: true, value: [{ id: 'bead-1', title: 'Implement issue', status: 'open', labels: [] }] }),
  }),
}));

vi.mock('../../../lib/vbrief/lifecycle-io.js', () => vbriefLifecycleMocks);

vi.mock('../../../lib/cloister/work-agent-prompt.js', () => promptMocks);

vi.mock('../../../lib/work-agent-lifecycle.js', () => lifecycleMocks);

vi.mock('../../../lib/agents.js', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/agents.js')>('../../../lib/agents.js');
  return {
    ...actual,
    spawnAgent: spawnAgentMock,
    getAgentStateSync: agentMocks.getAgentStateSync,
    clearAgentPausedSync: agentMocks.clearAgentPausedSync,
  };
});

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: resolveProjectMock,
  findProjectByPathSync: vi.fn(),
  getIssuePrefix: vi.fn(() => 'PAN'),
}));

vi.mock('ora', () => ({ default: oraMocks.ora }));

vi.mock('../../../lib/config.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/config.js')>('../../../lib/config.js')),
  getDashboardApiUrlSync: () => 'http://pan.test',
  loadConfigSync: loadConfigSyncMock,
}));

const { issueCommand } = await import('../start.js');

describe('pan start planning-mode routing (PAN-2407)', () => {
  let tmpDir: string;
  let stableCwd: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let originalExitCode: number | undefined;

  function createWorkspace(issueId: string) {
    const workspacePath = join(tmpDir, 'workspaces', `feature-${issueId.toLowerCase()}`);
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(join(workspacePath, '.beads'), { recursive: true });
    writeFileSync(
      join(workspacePath, '.beads', 'issues.jsonl'),
      JSON.stringify({ id: 'bead-1', title: 'Implement issue', labels: [issueId.toLowerCase()] }) + '\n',
    );
    return workspacePath;
  }

  beforeEach(() => {
    stableCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'pan-2407-routing-'));

    fetchMock.mockReset();
    findPlanSyncMock.mockReset();
    findSpecByIssueMock.mockReset().mockReturnValue(Effect.succeed(null));
    findRemoteWorkspaceMetadataSyncMock.mockReset().mockReturnValue(null);
    loadConfigSyncMock.mockReset().mockReturnValue({ remote: { enabled: false } });
    concurrencyMocks.getConcurrencyLimits.mockReset().mockReturnValue({ maxWorkAgents: 5 });
    concurrencyMocks.countRunningAgents.mockReset().mockReturnValue({ work: 0 });
    autoSynthesizeMocks.writeAutoStartVBrief.mockReset().mockReturnValue(Effect.succeed(undefined));
    beadsMocks.createBeadsFromVBrief.mockReset().mockReturnValue(Effect.succeed({ created: [{ id: 'bead-1' }], errors: [], success: true }));
    spawnAgentMock.mockReset().mockResolvedValue({
      id: 'agent-pan-x',
      issueId: 'PAN-X',
      workspace: '/tmp',
      model: 'claude-sonnet-4-6',
      harness: 'claude-code',
      role: 'work',
      startedAt: new Date().toISOString(),
      kickoffDelivered: true,
    });
    resolveProjectMock.mockReset().mockImplementation(() => ({
      projectKey: 'overdeck',
      projectName: 'overdeck',
      projectPath: tmpDir,
      linearTeam: 'PAN',
    }));
    lifecycleMocks.getWorkAgentLifecycleStateSync.mockReset().mockReturnValue({ isRunning: false, isRunningButStuck: false });
    lifecycleMocks.assertCanStartFreshSync.mockReset().mockReturnValue({ canStartFresh: true });
    agentMocks.getAgentStateSync.mockReset().mockReturnValue(null);
    agentMocks.clearAgentPausedSync.mockReset();
    promptMocks.buildWorkAgentPrompt.mockClear();
    promptMocks.getTrackerContext.mockClear();
    promptMocks.readPlanningContext.mockReset().mockResolvedValue(null);
    promptMocks.readBeadsTasks.mockReset().mockResolvedValue([]);
    vbriefLifecycleMocks.transitionVBriefOnMain.mockReset().mockReturnValue(Effect.succeed({
      fromDir: 'proposed',
      toDir: 'active',
      toPath: join(tmpDir, '.pan', 'specs', 'PAN-X.vbrief.json'),
      statusUpdated: true,
      committed: false,
      moved: true,
    }));
    vbriefLifecycleMocks.updatePlanStatus.mockReset();
    oraMocks.ora.mockClear();
    oraMocks.spinner.text = '';
    oraMocks.spinner.start.mockClear();
    oraMocks.spinner.succeed.mockClear();
    oraMocks.spinner.fail.mockClear();
    oraMocks.spinner.warn.mockClear();
    oraMocks.spinner.info.mockClear();

    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code ?? 'undefined'}`);
    }) as never);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(stableCwd);
    rmSync(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    process.exitCode = originalExitCode;
    vi.resetModules();
  });

  function mockFetchStream(options?: { ok?: boolean; events?: Array<{ type: string; sessionName?: string }> }) {
    const { ok = true, events = [{ type: 'complete', sessionName: 'planning-pan-x' }] } = options ?? {};
    fetchMock.mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      body: {
        getReader: () => {
          let index = 0;
          const lines = events.map((e) => `data: ${JSON.stringify(e)}\n`);
          return {
            read: vi.fn().mockImplementation(() => {
              if (index >= lines.length) {
                return Promise.resolve({ done: true, value: undefined });
              }
              const value = new TextEncoder().encode(lines[index]);
              index += 1;
              return Promise.resolve({ done: false, value });
            }),
          };
        },
      },
    });
  }

  it('POSTs start-planning with auto:true/autoStart:true when no plan exists and mode is auto', async () => {
    mockFetchStream();

    await issueCommand('PAN-X', { model: 'claude-sonnet-4-6', plan: 'auto' } as any);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://pan.test/api/issues/PAN-X/start-planning',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ auto: true, autoStart: true });
    expect(spawnAgentMock).not.toHaveBeenCalled();
  });

  it('POSTs start-planning with auto:false/autoStart:true when mode is interactive', async () => {
    mockFetchStream();

    await issueCommand('PAN-X', { model: 'claude-sonnet-4-6', plan: 'interactive' } as any);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ auto: false, autoStart: true });
  });

  it('POSTs start-planning with workspaceLocation: remote when a remote workspace exists without --remote flag', async () => {
    mockFetchStream();
    findRemoteWorkspaceMetadataSyncMock.mockReturnValue({
      id: 'pan-x',
      issue: 'PAN-X',
      provider: 'fly',
      vmName: 'pan-x-vm',
      urls: {},
      created: new Date(),
      location: 'remote',
    });

    const originalCwd = process.cwd();
    process.chdir(tmpDir);

    await issueCommand('PAN-X', { model: 'claude-sonnet-4-6', plan: 'auto' } as any);

    process.chdir(originalCwd);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ auto: true, autoStart: true, workspaceLocation: 'remote' });
  });

  it('POSTs start-planning with workspaceLocation: remote when overflow_to_remote triggers for a fresh issue', async () => {
    mockFetchStream();
    loadConfigSyncMock.mockReturnValue({ remote: { enabled: true, overflow_to_remote: true } });
    concurrencyMocks.getConcurrencyLimits.mockReturnValue({ maxWorkAgents: 3 });
    concurrencyMocks.countRunningAgents.mockReturnValue({ work: 3 });

    const originalCwd = process.cwd();
    process.chdir(tmpDir);

    await issueCommand('PAN-X', { model: 'claude-sonnet-4-6', plan: 'auto' } as any);

    process.chdir(originalCwd);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ auto: true, autoStart: true, workspaceLocation: 'remote' });
  });

  it('proceeds to spawn for an existing remote workspace that already has a plan on main', async () => {
    findRemoteWorkspaceMetadataSyncMock.mockReturnValue({
      id: 'pan-x',
      issue: 'PAN-X',
      provider: 'fly',
      vmName: 'pan-x-vm',
      urls: {},
      created: new Date(),
      location: 'remote',
    });
    findSpecByIssueMock.mockReturnValue(Effect.succeed({ path: '/tmp/.pan/specs/PAN-X.vbrief.json' }));

    const originalCwd = process.cwd();
    process.chdir(tmpDir);

    const { issueCommand } = await import('../start.js');
    await expect(issueCommand('PAN-X', { model: 'claude-sonnet-4-6', plan: 'auto' } as any)).rejects.toThrow(/__exit__:1/);

    process.chdir(originalCwd);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('synthesizes vBRIEF and beads in skip mode without calling start-planning', async () => {
    createWorkspace('PAN-X');

    const { issueCommand } = await import('../start.js');
    await issueCommand('PAN-X', { model: 'claude-sonnet-4-6', plan: 'skip' } as any);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(autoSynthesizeMocks.writeAutoStartVBrief).toHaveBeenCalled();
    expect(beadsMocks.createBeadsFromVBrief).toHaveBeenCalled();
    expect(spawnAgentMock).toHaveBeenCalled();
  });

  it('proceeds to spawn when a plan already exists in the workspace', async () => {
    createWorkspace('PAN-X');
    findPlanSyncMock.mockReturnValue('/tmp/.pan/specs/PAN-X.vbrief.json');

    const { issueCommand } = await import('../start.js');
    await issueCommand('PAN-X', { model: 'claude-sonnet-4-6', plan: 'auto' } as any);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(spawnAgentMock).toHaveBeenCalled();
  });

  it('uses findSpecByIssue and proceeds to spawn path when a plan exists on main but no workspace exists', async () => {
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    findSpecByIssueMock.mockReturnValue(Effect.succeed({ path: join(tmpDir, '.pan', 'specs', 'PAN-X.vbrief.json') }));

    const { issueCommand } = await import('../start.js');
    await expect(issueCommand('PAN-X', { model: 'claude-sonnet-4-6', plan: 'auto' } as any)).rejects.toThrow(/__exit__:1/);

    process.chdir(originalCwd);

    expect(findSpecByIssueMock).toHaveBeenCalledWith(tmpDir, 'PAN-X');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prints dry-run message and returns without HTTP request or file creation', async () => {
    const { issueCommand } = await import('../start.js');
    await issueCommand('PAN-X', { model: 'claude-sonnet-4-6', plan: 'auto', dryRun: true } as any);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(autoSynthesizeMocks.writeAutoStartVBrief).not.toHaveBeenCalled();
    expect(oraMocks.spinner.info).toHaveBeenCalledWith(
      expect.stringContaining('Would start auto planning session for PAN-X'),
    );
  });

  it('exits 1 with dashboard-down guidance when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('Connection refused'));

    const { issueCommand } = await import('../start.js');
    await expect(issueCommand('PAN-X', { model: 'claude-sonnet-4-6', plan: 'auto' } as any)).rejects.toThrow(/__exit__:1/);

    const errors = consoleErrorSpy.mock.calls.map(call => call.map(arg => String(arg)).join(' ')).join('\n');
    expect(errors).toMatch(/pan up/);
    expect(errors).toMatch(/--plan skip/);
  });
});
