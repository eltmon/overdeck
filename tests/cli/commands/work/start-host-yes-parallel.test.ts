import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  spawnAgent: vi.fn(),
  getAgentStateSync: vi.fn(),
  clearAgentPausedSync: vi.fn(),
  syncMainIntoWorkspace: vi.fn(),
  buildWorkAgentPrompt: vi.fn(),
  getTrackerContext: vi.fn(),
  readPlanningContext: vi.fn(),
  readBeadsTasks: vi.fn(),
  spinnerFail: vi.fn(),
  spinnerWarn: vi.fn(),
  spinnerInfo: vi.fn(),
  spinnerSucceed: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: mocks.exec,
  execFile: mocks.execFile,
  execFileSync: mocks.execFileSync,
}));

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start() { return this; },
    text: '',
    fail: mocks.spinnerFail,
    warn: mocks.spinnerWarn,
    info: mocks.spinnerInfo,
    succeed: mocks.spinnerSucceed,
  })),
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  spawnAgent: mocks.spawnAgent,
  getAgentStateSync: mocks.getAgentStateSync,
  clearAgentPausedSync: mocks.clearAgentPausedSync,
  getProviderAuthMode: vi.fn(async () => 'api'),
  getProviderEnvForModel: vi.fn(async () => ({})),
  getProviderExportsForModel: vi.fn(async () => ''),
  getAgentRuntimeBaseCommand: vi.fn(async () => 'claude'),
}));

vi.mock('../../../../src/lib/config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/config-yaml.js')>();
  return {
    ...actual,
    loadConfigSync: vi.fn(() => ({ config: {} })),
    resolveModel: vi.fn((_role: string, model?: string) => model ?? 'claude-sonnet-4-6'),
  };
});

vi.mock('../../../../src/lib/model-capabilities.js', () => ({
  getModelEffortLevelsSync: vi.fn(() => undefined),
}));

vi.mock('../../../../src/lib/cloister/merge-agent.js', () => ({
  syncMainIntoWorkspace: mocks.syncMainIntoWorkspace,
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: vi.fn(() => ({
    projectKey: 'panopticon',
    projectName: 'Panopticon',
    projectPath: projectRoot,
  })),
  hasProjectsSync: vi.fn(() => true),
  listProjectsSync: vi.fn(() => [{ key: 'panopticon', config: { name: 'Panopticon', path: projectRoot } }]),
}));

vi.mock('../../../../src/lib/prd-draft.js', () => ({
  hasPRDDraft: vi.fn(() => Effect.succeed(false)),
  getPRDDraftPathSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/tracker-utils.js', () => ({
  isGitHubIssueSync: vi.fn(() => false),
  resolveGitHubIssueSync: vi.fn(() => ({ isGitHub: false })),
}));

vi.mock('../../../../src/lib/shadow-utils.js', () => ({
  getLinearApiKey: vi.fn(() => Effect.succeed(null)),
}));

vi.mock('../../../../src/lib/shadow-mode.js', () => ({
  shouldSkipTrackerUpdate: vi.fn(() => Effect.succeed(false)),
  getShadowModeStatus: vi.fn(() => ({ enabled: false })),
}));

vi.mock('../../../../src/lib/shadow-state.js', () => ({
  createShadowState: vi.fn(() => Effect.succeed(undefined)),
  updateShadowState: vi.fn(() => Effect.succeed(undefined)),
}));

vi.mock('../../../../src/lib/config.js', () => ({
  loadConfigSync: vi.fn(() => ({ remote: { enabled: false } })),
}));

vi.mock('../../../../src/lib/remote/workspace-metadata.js', () => ({
  loadWorkspaceMetadataSync: vi.fn(() => null),
  findRemoteWorkspaceMetadataSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/remote/index.js', () => ({
  isRemoteAvailable: vi.fn(async () => false),
  spawnRemoteAgent: vi.fn(),
  isRemoteAgentRunning: vi.fn(async () => false),
  createFlyProviderFromConfig: vi.fn(),
}));

vi.mock('../../../../src/lib/work-agent-lifecycle.js', () => ({
  assertCanStartFreshSync: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/work-agent-prompt.js', () => ({
  buildWorkAgentPrompt: mocks.buildWorkAgentPrompt,
  getTrackerContext: mocks.getTrackerContext,
  readPlanningContext: mocks.readPlanningContext,
  readBeadsTasks: mocks.readBeadsTasks,
}));

let projectRoot = '';
let originalPanopticonHome: string | undefined;
let stdinIsTTYDescriptor: PropertyDescriptor | undefined;

type Bead = { id: string; title: string; labels: string[] };

function writePlan(workspacePath: string): void {
  mkdirSync(join(workspacePath, '.pan'), { recursive: true });
  writeFileSync(join(workspacePath, '.pan', 'spec.vbrief.json'), JSON.stringify({
    vBRIEFInfo: { version: '0.5', created: '2026-06-10T00:00:00.000Z' },
    plan: {
      id: 'PAN-1629',
      title: 'Parallel host start regression',
      status: 'active',
      items: [
        { id: 'first', title: 'First task', status: 'pending', metadata: { issueLabel: 'pan-1629', difficulty: 'simple' } },
        { id: 'second', title: 'Second task', status: 'pending', metadata: { issueLabel: 'pan-1629', difficulty: 'simple' } },
      ],
      edges: [],
    },
  }, null, 2));
}

describe('pan start --host --yes parallel spawn regression (PAN-1629)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    projectRoot = mkdtempSync(join(tmpdir(), 'pan-start-host-yes-parallel-'));
    originalPanopticonHome = process.env.PANOPTICON_HOME;
    process.env.PANOPTICON_HOME = join(projectRoot, '.panopticon-home');
    stdinIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    mocks.getAgentStateSync.mockReturnValue(null);
    mocks.execFileSync.mockReturnValue('feature/pan-1629\n');
    mocks.syncMainIntoWorkspace.mockResolvedValue({ success: true, alreadyUpToDate: true });
    mocks.buildWorkAgentPrompt.mockResolvedValue('prompt');
    mocks.getTrackerContext.mockResolvedValue(null);
    mocks.readPlanningContext.mockResolvedValue(null);
    mocks.readBeadsTasks.mockResolvedValue([]);
    mocks.spawnAgent.mockImplementation(async () => ({
      id: `agent-pan-1629-${mocks.spawnAgent.mock.calls.length}`,
      issueId: 'PAN-1629',
      workspace: join(projectRoot, 'workspaces', 'feature-pan-1629'),
      harness: 'claude-code',
      model: 'claude-sonnet-4-6',
      role: 'work',
      startedAt: new Date().toISOString(),
    }));
  });

  afterEach(() => {
    if (stdinIsTTYDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', stdinIsTTYDescriptor);
    } else {
      delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
    }
    if (originalPanopticonHome === undefined) delete process.env.PANOPTICON_HOME;
    else process.env.PANOPTICON_HOME = originalPanopticonHome;
    rmSync(projectRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns from N parallel starts, materializes/dedups beads, and spawns every work agent', async () => {
    const workspace = join(projectRoot, 'workspaces', 'feature-pan-1629');
    mkdirSync(join(workspace, '.beads'), { recursive: true });
    writeFileSync(join(workspace, '.beads', 'redirect'), '../../.beads');
    writePlan(workspace);

    const beads: Bead[] = [];
    let nextBeadId = 1;
    mocks.execFile.mockImplementation((file: string, args: string[], _options: unknown, callback: Function) => {
      if (file === 'which') {
        callback(null, { stdout: '/usr/bin/bd', stderr: '' }, '');
        return;
      }
      if (file === 'bd' && args[0] === 'ping') {
        callback(null, { stdout: '', stderr: '' }, '');
        return;
      }
      if (file === 'bd' && args[0] === 'list') {
        callback(null, { stdout: JSON.stringify(beads), stderr: '' }, '');
        return;
      }
      if (file === 'bd' && args[0] === 'delete') {
        const index = beads.findIndex(bead => bead.id === args[1]);
        if (index !== -1) beads.splice(index, 1);
        callback(null, { stdout: '', stderr: '' }, '');
        return;
      }
      if (file === 'bd' && args[0] === 'create') {
        const id = `bead-${nextBeadId++}`;
        const labelsIndex = args.indexOf('-l');
        const labels = labelsIndex === -1 ? [] : args[labelsIndex + 1].split(',');
        beads.push({ id, title: args[1], labels });
        callback(null, { stdout: `${id}\n`, stderr: '' }, '');
        return;
      }
      callback(null, { stdout: '', stderr: '' }, '');
    });

    const { issueCommand } = await import('../../../../src/cli/commands/start.js');
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => { logs.push(parts.join(' ')); });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...parts: unknown[]) => { logs.push(parts.join(' ')); });

    const startedAt = Date.now();
    await Promise.all(Array.from({ length: 5 }, () => issueCommand('PAN-1629', {
      model: '',
      host: true,
      yes: true,
    } as any)));

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(mocks.spawnAgent).toHaveBeenCalledTimes(5);
    for (const call of mocks.spawnAgent.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({
        issueId: 'PAN-1629',
        workspace,
        role: 'work',
        allowHost: true,
      }));
    }
    expect(beads.map(bead => bead.title).sort()).toEqual([
      'PAN-1629: First task',
      'PAN-1629: Second task',
    ]);
    expect(beads).toHaveLength(2);
    const output = logs.join('\n');
    expect(output).not.toMatch(/dedup failed: list failed/i);
    expect(output).not.toMatch(/No beads tasks found/i);
    expect(output).not.toMatch(/Planning must create/i);
    expect(mocks.spinnerFail).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
  }, 10_000);
});
