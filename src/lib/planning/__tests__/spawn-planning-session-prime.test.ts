/**
 * PAN-3668 WI-13: a planning session on the Prime Agent harness launches the Prime
 * host through the terminal backend and receives its kickoff over the host socket,
 * like ACP, instead of a prompt file on the command line.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { fakeTerminalBackend, type FakeTerminalBackend } from '../../../../tests/helpers/fake-terminal-backend.js';

const mocks = vi.hoisted(() => ({
  host: 'herdr' as 'herdr' | 'tmux',
  resolveHarness: vi.fn(async () => 'prime-agent'),
  prepareHarnessLaunch: vi.fn(async () => ({ binaryPath: '/opt/prime/bin/prime-agent', pathExport: 'export PATH="$PATH"' })),
  getPrimeAgentLauncherFields: vi.fn(),
  tmuxCreateSession: vi.fn(() => Effect.succeed(undefined)),
  tmuxSessionExists: vi.fn(() => Effect.succeed(true)),
  tmuxSetOption: vi.fn(() => Effect.succeed(undefined)),
  tmuxExecAsync: vi.fn(async () => ({ stdout: '', stderr: '' })),
}));

vi.mock('../../terminal-backends/select.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../terminal-backends/select.js')>();
  return {
    ...actual,
    hostTerminalBackendName: vi.fn(async () => mocks.host),
    // PAN-3956: a herdr host in these tests has a live session server.
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
    getAgentRuntimeBaseCommand: vi.fn(async () => 'prime-agent-host'),
    getProviderExportsForModel: vi.fn(async () => ''),
    deliverInitialPromptWithRetry: vi.fn(async () => ({ ok: true, path: 'herdr' })),
  };
});

vi.mock('../../prime-agent/launcher-fields.js', () => ({ getPrimeAgentLauncherFields: mocks.getPrimeAgentLauncherFields }));

import { spawnPlanningSession } from '../spawn-planning-session.js';
import { registerTerminalBackend } from '../../terminal-backends/registry.js';
import { deliverInitialPromptWithRetry, getAgentState } from '../../agents.js';

let herdr: FakeTerminalBackend;
let tmux: FakeTerminalBackend;
let tempHome: string;
let workspace: string;
let prevHome: string | undefined;
let prevOverdeckHome: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  herdr = fakeTerminalBackend('herdr');
  tmux = fakeTerminalBackend('tmux');
  registerTerminalBackend(herdr);
  registerTerminalBackend(tmux);

  tempHome = mkdtempSync(join(tmpdir(), 'pan-3668-plan-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'pan-3668-plan-ws-'));
  // A non-empty workspace is an existing one: no workspace creation.
  writeFileSync(join(workspace, 'README.md'), '# workspace\n');
  prevHome = process.env.HOME;
  prevOverdeckHome = process.env.OVERDECK_HOME;
  process.env.HOME = tempHome;
  // The planner's state dir is ~/.overdeck/agents/<session> (homedir-based).
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


function spawnPrimePlanner(sessionName: string) {
  mkdirSync(join(tempHome, '.overdeck', 'agents', sessionName), { recursive: true });
  return spawnPlanningSession({
    issue: {
      id: 'PAN-3668',
      identifier: 'PAN-3668',
      title: 'Add Prime Agent as a managed harness',
      description: 'test',
      url: 'https://github.com/eltmon/overdeck/issues/3668',
      source: 'github',
    },
    workspacePath: workspace,
    projectPath: workspace,
    sessionName,
    workspaceLocation: 'local',
    model: 'gpt-5.4',
    harness: 'prime-agent',
    startedBy: 'test',
  });
}

describe('spawnPlanningSession — Prime Agent (PAN-3668 WI-13)', () => {
  it('launches the Prime host, delivers the kickoff over the host, and uses no prompt file', async () => {
    mocks.host = 'herdr';
    const sessionName = 'planning-pan-3668';
    const agentDir = join(tempHome, '.overdeck', 'agents', sessionName);
    mocks.getPrimeAgentLauncherFields.mockResolvedValue({
      fields: {
        harness: 'prime-agent',
        primeAgent: {
          agentId: sessionName,
          binaryPath: '/opt/prime/bin/prime-agent',
          provider: 'openai',
          workspace,
          contextFile: join(agentDir, 'prime-agent-context.md'),
        },
        model: 'gpt-5.4',
        unsetProviderEnv: true,
        preserveProviderEnv: ['OPENAI_API_KEY'],
      },
      paneEnv: { OPENAI_API_KEY: 'sk-plan-test' },
    });

    const result = await spawnPrimePlanner(sessionName);

    expect(result).toEqual({ success: true });
    expect(mocks.getPrimeAgentLauncherFields).toHaveBeenCalledWith(sessionName, 'gpt-5.4', workspace, '/opt/prime/bin/prime-agent', expect.anything());
    const launcher = readFileSync(join(agentDir, 'launcher.sh'), 'utf-8');
    expect(launcher).toMatch(/node '.+\/dist\/prime-agent-host\.js' --agent 'planning-pan-3668'/);
    expect(launcher).not.toContain('init-prompt.txt');
    expect(launcher).not.toContain('sk-plan-test');
    expect(herdr.starts).toHaveLength(1);
    expect(herdr.starts[0]!.spec).toMatchObject({
      tokens: { issue: 'PAN-3668', role: 'plan', harness: 'prime-agent', model: 'gpt-5.4' },
      env: expect.objectContaining({ OPENAI_API_KEY: 'sk-plan-test' }),
    });
    expect(vi.mocked(deliverInitialPromptWithRetry)).toHaveBeenCalledWith(
      sessionName,
      expect.stringContaining('planning-prompt.md'),
      'spawnPlanningSession:initial-prompt',
    );
    expect(getAgentState(sessionName)).toMatchObject({ harness: 'prime-agent', role: 'plan', status: 'running' });
  });
});
