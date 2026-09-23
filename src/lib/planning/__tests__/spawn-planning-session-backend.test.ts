/**
 * PAN-3960: `spawnPlanningSession` launches the planner through
 * `launchAgentPane` on the terminal backend the host selects — a Herdr pane
 * stamped `role=plan` on a Herdr host, a tmux session on a tmux host — and never
 * with a direct tmux `createSession`. Both backends are recording fakes
 * registered over the real adapters; nothing here touches a real tmux server or
 * Herdr socket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import type { TerminalBackendName } from '../../terminal-backends/types.js';
import { fakeTerminalBackend, type FakeTerminalBackend } from '../../../../tests/helpers/fake-terminal-backend.js';

const mocks = vi.hoisted(() => ({
  host: 'herdr' as 'herdr' | 'tmux',
  resolveHarness: vi.fn(async () => 'claude-code'),
  prepareHarnessLaunch: vi.fn(async () => ({ binaryPath: '/opt/claude/bin/claude', pathExport: 'export PATH="$PATH"' })),
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
    getAgentRuntimeBaseCommand: vi.fn(async () => 'claude --agent plan'),
    getProviderExportsForModel: vi.fn(async () => ''),
    deliverInitialPromptWithRetry: vi.fn(async () => ({ ok: true, path: 'herdr' })),
  };
});

import { spawnPlanningSession } from '../spawn-planning-session.js';
import { registerTerminalBackend } from '../../terminal-backends/registry.js';
import { getAgentStateSync } from '../../agents.js';

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

  tempHome = mkdtempSync(join(tmpdir(), 'pan-3960-plan-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'pan-3960-plan-ws-'));
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

function spawnPlanner(sessionName: string) {
  // The caller (start-planning route / CLI) creates the agent dir first.
  mkdirSync(join(tempHome, '.overdeck', 'agents', sessionName), { recursive: true });
  return spawnPlanningSession({
    issue: {
      id: 'PAN-3960',
      identifier: 'PAN-3960',
      title: 'Route planning through launchAgentPane',
      description: 'test',
      url: 'https://github.com/eltmon/overdeck/issues/3960',
      source: 'github',
    },
    workspacePath: workspace,
    projectPath: workspace,
    sessionName,
    workspaceLocation: 'local',
    model: 'claude-sonnet-5',
    harness: 'claude-code',
    startedBy: 'test',
  });
}

describe('spawnPlanningSession launches through the host backend (PAN-3960)', () => {
  it.each<TerminalBackendName>(['herdr', 'tmux'])('%s host', async (host) => {
    mocks.host = host;
    const sessionName = `planning-pan-3960-${host}`;

    const result = await spawnPlanner(sessionName);

    expect(result).toEqual({ success: true });
    const selected = host === 'herdr' ? herdr : tmux;
    const other = host === 'herdr' ? tmux : herdr;
    expect(other.starts).toHaveLength(0);
    expect(selected.starts).toHaveLength(1);
    const { workspace: ws, spec } = selected.starts[0]!;
    expect(ws.issueId).toBe('PAN-3960');
    const launcherScript = join(tempHome, '.overdeck', 'agents', sessionName, 'launcher.sh');
    expect(spec).toMatchObject({
      name: sessionName,
      cwd: workspace,
      argv: ['bash', launcherScript],
      tokens: { issue: 'PAN-3960', role: 'plan', harness: 'claude-code', model: 'claude-sonnet-5' },
      env: expect.objectContaining({
        TERM: 'xterm-256color',
        OVERDECK_AGENT_ID: sessionName,
        OVERDECK_ISSUE_ID: 'PAN-3960',
        OVERDECK_SESSION_TYPE: 'plan',
        OVERDECK_AGENT_STARTED_BY: 'test',
      }),
    });
    // Never a direct tmux session, on either host.
    expect(mocks.tmuxCreateSession).not.toHaveBeenCalled();
    expect(getAgentStateSync(sessionName)).toMatchObject({ backend: host, role: 'plan', status: 'running' });

    // The keep-alive sleep loop is tmux-only: on Herdr it would be a non-shell
    // foreground process and a finished planner would read alive forever.
    const launcher = readFileSync(launcherScript, 'utf-8');
    if (host === 'tmux') expect(launcher).toContain('while true; do sleep 60; done');
    else expect(launcher).not.toContain('while true; do sleep 60; done');
  });

  it('keeps the tmux-only server hygiene on tmux and skips it on Herdr', async () => {
    mocks.host = 'tmux';
    await spawnPlanner('planning-pan-3960-hygiene-tmux');
    expect(mocks.tmuxExecAsync).toHaveBeenCalledWith(['set-environment', '-g', '-u', 'GITHUB_TOKEN']);
    expect(mocks.tmuxSetOption).toHaveBeenCalledWith('planning-pan-3960-hygiene-tmux', 'destroy-unattached', 'off');

    vi.clearAllMocks();
    mocks.host = 'herdr';
    await spawnPlanner('planning-pan-3960-hygiene-herdr');
    expect(mocks.tmuxExecAsync).not.toHaveBeenCalled();
    expect(mocks.tmuxSetOption).not.toHaveBeenCalled();
  });
});
