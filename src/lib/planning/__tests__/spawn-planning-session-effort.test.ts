/**
 * PAN-4258: spawnPlanningSession resolves effort through resolveEffort
 * (role 'plan') and threads the resolved level — never the raw explicit
 * value — into getAgentRuntimeBaseCommand, the planning prompt, and every
 * harness launcher.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { fakeTerminalBackend, type FakeTerminalBackend } from '../../../../tests/helpers/fake-terminal-backend.js';

const mocks = vi.hoisted(() => ({
  host: 'herdr' as 'herdr' | 'tmux',
  resolveHarness: vi.fn(async () => 'claude-code'),
  prepareHarnessLaunch: vi.fn(async () => ({ binaryPath: '/opt/claude/bin/claude', pathExport: 'export PATH="$PATH"' })),
  tmuxCreateSession: vi.fn(() => Effect.succeed(undefined)),
  tmuxSessionExists: vi.fn(() => Effect.succeed(true)),
  tmuxSetOption: vi.fn(() => Effect.succeed(undefined)),
  tmuxExecAsync: vi.fn(async () => ({ stdout: '', stderr: '' })),
  getAgentRuntimeBaseCommand: vi.fn(async () => 'claude --agent plan'),
}));

vi.mock('../../terminal-backends/select.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../terminal-backends/select.js')>();
  return {
    ...actual,
    hostTerminalBackendName: vi.fn(async () => mocks.host),
    probeHerdrAvailability: vi.fn(async () => ({
      binary: '/usr/bin/herdr', session: 'overdeck', socket: '/tmp/herdr.sock', socketExists: true, available: true,
    })),
  };
});

vi.mock('../../terminal-backends/herdr.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../terminal-backends/herdr.js')>();
  return {
    ...actual,
    findHerdrAgent: vi.fn(async () => null),
    findHerdrAgentPane: vi.fn(async () => null),
  };
});

vi.mock('../../tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../tmux.js')>();
  return {
    ...actual,
    createSession: mocks.tmuxCreateSession,
    sessionExists: mocks.tmuxSessionExists,
    killSession: vi.fn(() => Effect.succeed(undefined)),
    setOption: mocks.tmuxSetOption,
    tmuxExecAsync: mocks.tmuxExecAsync,
  };
});

vi.mock('../../harness-resolve.js', () => ({ resolveHarness: mocks.resolveHarness }));

vi.mock('../../harness-binary.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../harness-binary.js')>();
  return { ...actual, prepareHarnessLaunch: mocks.prepareHarnessLaunch };
});

vi.mock('../../agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agents.js')>();
  return {
    ...actual,
    retrieveSpawnTimeMemoryContext: vi.fn(async () => ''),
    getAgentRuntimeBaseCommand: mocks.getAgentRuntimeBaseCommand,
    getProviderExportsForModel: vi.fn(async () => ''),
    deliverInitialPromptWithRetry: vi.fn(async () => ({ ok: true, path: 'herdr' })),
  };
});

import { spawnPlanningSession } from '../spawn-planning-session.js';
import { registerTerminalBackend } from '../../terminal-backends/registry.js';

let herdr: FakeTerminalBackend;
let tmux: FakeTerminalBackend;
let tempHome: string;
let workspace: string;
let prevHome: string | undefined;
let prevOverdeckHome: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.host = 'herdr';
  mocks.resolveHarness.mockImplementation(async () => 'claude-code');
  mocks.getAgentRuntimeBaseCommand.mockImplementation(async () => 'claude --agent plan');
  herdr = fakeTerminalBackend('herdr');
  tmux = fakeTerminalBackend('tmux');
  registerTerminalBackend(herdr);
  registerTerminalBackend(tmux);

  tempHome = mkdtempSync(join(tmpdir(), 'pan-4258-plan-effort-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'pan-4258-plan-effort-ws-'));
  writeFileSync(join(workspace, 'README.md'), '# workspace\n');
  prevHome = process.env.HOME;
  prevOverdeckHome = process.env.OVERDECK_HOME;
  process.env.HOME = tempHome;
  process.env.OVERDECK_HOME = join(tempHome, '.overdeck');
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  if (prevOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = prevOverdeckHome;
  rmSync(tempHome, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

function spawnPlanner(sessionName: string, overrides: Partial<Parameters<typeof spawnPlanningSession>[0]> = {}) {
  mkdirSync(join(tempHome, '.overdeck', 'agents', sessionName), { recursive: true });
  return spawnPlanningSession({
    issue: {
      id: 'PAN-4258',
      identifier: 'PAN-4258',
      title: 'Planning effort: all five levels',
      description: 'test',
      url: 'https://github.com/eltmon/overdeck/issues/4258',
      source: 'github',
    },
    workspacePath: workspace,
    projectPath: workspace,
    sessionName,
    workspaceLocation: 'local',
    model: 'claude-sonnet-5',
    harness: 'claude-code',
    startedBy: 'test',
    ...overrides,
  });
}

describe('spawnPlanningSession effort resolution (PAN-4258)', () => {
  it('threads an explicit max effort into getAgentRuntimeBaseCommand and the planning prompt', async () => {
    const sessionName = 'planning-pan-4258-max';

    const result = await spawnPlanner(sessionName, { effort: 'max' });

    expect(result).toEqual({ success: true });
    expect(mocks.getAgentRuntimeBaseCommand).toHaveBeenCalledWith(
      'claude-sonnet-5',
      sessionName,
      expect.any(String),
      'claude-code',
      'max',
    );
    const promptFile = join(tempHome, '.overdeck', 'agents', sessionName, 'planning-prompt.md');
    const prompt = readFileSync(promptFile, 'utf-8');
    expect(prompt).toContain('MAX effort planning');
    expect(prompt).not.toContain('LOW effort planning');
  });

  it('defaults to high when no explicit effort and no roles.plan.effort config is set', async () => {
    const sessionName = 'planning-pan-4258-default';

    const result = await spawnPlanner(sessionName);

    expect(result).toEqual({ success: true });
    expect(mocks.getAgentRuntimeBaseCommand).toHaveBeenCalledWith(
      'claude-sonnet-5',
      sessionName,
      expect.any(String),
      'claude-code',
      'high',
    );
  });

  it('clamps an explicit max effort to xhigh for the muse harness', async () => {
    mocks.resolveHarness.mockImplementation(async () => 'muse');
    const sessionName = 'planning-pan-4258-muse';

    const result = await spawnPlanner(sessionName, { model: 'muse-spark-1.3', harness: 'muse', effort: 'max' });

    expect(result).toEqual({ success: true });
    const launcherScript = join(tempHome, '.overdeck', 'agents', sessionName, 'launcher.sh');
    const launcher = readFileSync(launcherScript, 'utf-8');
    expect(launcher).toContain("--reasoning-effort 'xhigh'");
    expect(launcher).not.toContain("--reasoning-effort 'max'");
  });
});
