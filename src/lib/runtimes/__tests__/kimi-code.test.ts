import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmuxMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  killSession: vi.fn(),
  sessionExists: vi.fn(),
}));

vi.mock('../tmux-cli.js', () => ({
  tmuxCreateSession: tmuxMocks.createSession,
  tmuxKillSession: tmuxMocks.killSession,
  tmuxSessionExists: tmuxMocks.sessionExists,
}));

const agentStateMocks = vi.hoisted(() => ({ getAgentStateSync: vi.fn(), saveAgentStateSync: vi.fn() }));
vi.mock('../../agents/agent-state.js', () => ({
  getAgentStateSync: agentStateMocks.getAgentStateSync,
  saveAgentStateSync: agentStateMocks.saveAgentStateSync,
}));

import {
  createKimiCodeRuntimeSync,
  findKimiWirePath,
  findLatestKimiSession,
  kimiSessionsRoot,
  kimiWorkDirKey,
  KimiCodeRuntimeSync,
} from '../kimi-code.js';

const tempHomes: string[] = [];

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'overdeck-kimi-code-runtime-'));
  tempHomes.push(home);
  return home;
}

function writeWireFixture(kimiHome: string, workDir: string, sessionId: string, contents = '{}\n'): string {
  const dir = join(kimiSessionsRoot(kimiHome, workDir), sessionId, 'agents', 'main');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'wire.jsonl');
  writeFileSync(path, contents);
  return path;
}

beforeEach(() => {
  tmuxMocks.createSession.mockReset();
  tmuxMocks.killSession.mockReset();
  tmuxMocks.sessionExists.mockReset();
  agentStateMocks.getAgentStateSync.mockReset();
  agentStateMocks.saveAgentStateSync.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  tempHomes.splice(0).forEach((home) => rmSync(home, { recursive: true, force: true }));
});

describe('kimiWorkDirKey (D2 — verified against installed kimi 0.29.2)', () => {
  it('derives wd_<basename>_<sha256[:12]> from the working directory', () => {
    expect(kimiWorkDirKey('/tmp/kimi-fixture-scratch')).toBe('wd_kimi-fixture-scratch_ef33f89ad7cf');
    expect(kimiWorkDirKey('/home/eltmon/Projects/overdeck')).toBe('wd_overdeck_b289e7acb782');
    expect(kimiWorkDirKey('/home/eltmon/Projects/overdeck/workspaces/feature-pan-2858')).toBe('wd_feature-pan-2858_1dc66dc5021d');
  });
});

describe('findKimiWirePath / findLatestKimiSession', () => {
  it('resolves the captured session id under the workspace bucket', () => {
    const kimiHome = makeHome();
    const workDir = '/tmp/some-workspace';
    const wirePath = writeWireFixture(kimiHome, workDir, 'session_captured');
    writeWireFixture(kimiHome, workDir, 'session_other');

    expect(findKimiWirePath(kimiHome, workDir, 'session_captured')).toBe(wirePath);
  });

  it('falls back to the newest session dir when no id is captured (AC2)', async () => {
    const kimiHome = makeHome();
    const workDir = '/tmp/some-workspace';
    writeWireFixture(kimiHome, workDir, 'session_older');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = writeWireFixture(kimiHome, workDir, 'session_newer');

    expect(findKimiWirePath(kimiHome, workDir, null)).toBe(newer);
    expect(findLatestKimiSession(kimiHome, workDir)).toBe(newer);
  });

  it('falls back to the newest session dir when the captured id has no wire.jsonl', () => {
    const kimiHome = makeHome();
    const workDir = '/tmp/some-workspace';
    const fallback = writeWireFixture(kimiHome, workDir, 'session_real');

    expect(findKimiWirePath(kimiHome, workDir, 'session_stale-never-written')).toBe(fallback);
  });

  it('returns null when the bucket does not exist', () => {
    const kimiHome = makeHome();
    expect(findLatestKimiSession(kimiHome, '/tmp/never-launched')).toBeNull();
  });
});

describe('KimiCodeRuntimeSync', () => {
  it('uses the resolved wire.jsonl mtime for activity and heartbeat; no cost data when the transcript has no usage.record yet', () => {
    const kimiHome = makeHome();
    const overdeckHome = makeHome();
    const workDir = '/tmp/activity-workspace';
    agentStateMocks.getAgentStateSync.mockReturnValue({ workspace: workDir });
    mkdirSync(join(overdeckHome, 'agents', 'agent-activity'), { recursive: true });
    writeFileSync(join(overdeckHome, 'agents', 'agent-activity', 'kimi-session-id'), 'session_activity\n');
    const wirePath = writeWireFixture(kimiHome, workDir, 'session_activity');

    const runtime = new KimiCodeRuntimeSync({ overdeckHome, kimiHome });

    expect(runtime.getSessionPath('agent-activity')).toBe(wirePath);
    expect(runtime.getLastActivity('agent-activity')).toEqual(expect.any(Date));
    expect(runtime.getHeartbeat('agent-activity')).toMatchObject({
      agentId: 'agent-activity',
      source: 'jsonl',
      confidence: 'medium',
    });
    expect(runtime.getTokenUsage('agent-activity')).toBeNull();
    expect(runtime.getSessionCost('agent-activity')).toBeNull();
  });

  it('getTokenUsage/getSessionCost return real, non-zero values via wi8b parseKimiSessionSync (AC3)', () => {
    const kimiHome = makeHome();
    const overdeckHome = makeHome();
    const workDir = '/tmp/cost-workspace';
    agentStateMocks.getAgentStateSync.mockReturnValue({ workspace: workDir });
    mkdirSync(join(overdeckHome, 'agents', 'agent-cost'), { recursive: true });
    writeFileSync(join(overdeckHome, 'agents', 'agent-cost', 'kimi-session-id'), 'session_cost\n');
    const wireDir = join(kimiSessionsRoot(kimiHome, workDir), 'session_cost', 'agents', 'main');
    mkdirSync(wireDir, { recursive: true });
    writeFileSync(join(wireDir, 'wire.jsonl'), [
      JSON.stringify({ type: 'usage.record', model: 'kimi-code/k3', usage: { inputOther: 100, output: 20, inputCacheRead: 500, inputCacheCreation: 0 }, usageScope: 'turn', time: 1 }),
    ].join('\n') + '\n');

    const runtime = new KimiCodeRuntimeSync({ overdeckHome, kimiHome });

    expect(runtime.getTokenUsage('agent-cost')).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 500,
      cacheWriteTokens: 0,
    });
    const cost = runtime.getSessionCost('agent-cost');
    expect(cost?.totalCost).toBeGreaterThan(0);
    expect(cost?.currency).toBe('USD');
  });

  it('returns null session info for an agent with no known workspace', () => {
    const overdeckHome = makeHome();
    agentStateMocks.getAgentStateSync.mockReturnValue(null);
    const runtime = new KimiCodeRuntimeSync({ overdeckHome, kimiHome: makeHome() });

    expect(runtime.getSessionPath('agent-unknown')).toBeNull();
    expect(runtime.getLastActivity('agent-unknown')).toBeNull();
    expect(runtime.getHeartbeat('agent-unknown')).toBeNull();
  });

  it('spawns via the wi6 launcher command, captures the newly-appeared session id, and persists it (AC1/AC2)', async () => {
    const kimiHome = makeHome();
    const overdeckHome = makeHome();
    const workspace = '/tmp/kimi-spawn-workspace';
    // A pre-existing session in the bucket must NOT be mistaken for the new one.
    writeWireFixture(kimiHome, workspace, 'session_preexisting');

    tmuxMocks.createSession.mockImplementation(async () => {
      writeWireFixture(kimiHome, workspace, 'session_fresh');
    });
    tmuxMocks.sessionExists.mockResolvedValue(true);

    const writePtyTokenFor = vi.fn(async (agentId: string) => {
      const dir = join(overdeckHome, 'agents', agentId);
      mkdirSync(dir, { recursive: true });
      const token = 'test-pty-token';
      writeFileSync(join(dir, 'pty-token'), `${token}\n`);
      return token;
    });
    agentStateMocks.getAgentStateSync.mockReturnValue({ id: 'agent-kimi-spawn', workspace });

    const runtime = new KimiCodeRuntimeSync({
      overdeckHome,
      kimiHome,
      prepareLaunch: async () => ({
        binaryPath: '/home/eltmon/.kimi-code/bin/kimi',
        pathExport: 'export PATH=\'/home/eltmon/.kimi-code/bin\':"$PATH"',
      }),
      deliverMessage: vi.fn(async () => ({ ok: true })),
      resolveSupervisorScriptPath: () => '/dist/pty-supervisor.js',
      writePtyTokenFor,
    });

    const agent = await runtime.spawnAgent({
      agentId: 'agent-kimi-spawn',
      workspace,
      model: 'k3',
      runtime: 'kimi-code',
      env: { EXTRA: 'value' },
    });

    expect(agent).toMatchObject({
      id: 'agent-kimi-spawn',
      sessionId: 'session_fresh',
      runtime: 'kimi-code',
      model: 'k3',
      workspace,
    });
    expect(tmuxMocks.createSession).toHaveBeenCalledWith(
      'agent-kimi-spawn',
      workspace,
      expect.stringContaining('launcher.sh'),
      { EXTRA: 'value' },
    );
    const launcherScript = join(overdeckHome, 'agents', 'agent-kimi-spawn', 'launcher.sh');
    expect(existsSync(launcherScript)).toBe(true);
    const launcherContent = readFileSync(launcherScript, 'utf-8');
    expect(launcherContent).toMatch(/kimi -m 'k3' --yolo/);
    expect(launcherContent).toContain('unset ANTHROPIC_BASE_URL');
    expect(launcherContent).toContain("node '/dist/pty-supervisor.js'");

    const persistedId = readFileSync(join(overdeckHome, 'agents', 'agent-kimi-spawn', 'kimi-session-id'), 'utf-8');
    expect(persistedId).toBe('session_fresh');

    // FIX 3 (inspection finding): the PTY supervisor tier of deliverAgentMessage
    // requires a readable pty-token file — spawnAgent must write it, and write
    // it BEFORE the tmux session (and thus the supervisor process) exists.
    expect(writePtyTokenFor).toHaveBeenCalledWith('agent-kimi-spawn');
    expect(writePtyTokenFor.mock.invocationCallOrder[0]).toBeLessThan(
      tmuxMocks.createSession.mock.invocationCallOrder[0],
    );
    const tokenPath = join(overdeckHome, 'agents', 'agent-kimi-spawn', 'pty-token');
    expect(existsSync(tokenPath)).toBe(true);
    expect(readFileSync(tokenPath, 'utf-8')).toBe('test-pty-token\n');

    // FIX 1: the agent state is marked supervisor-enabled so relaunch re-supervises.
    expect(agentStateMocks.saveAgentStateSync).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-kimi-spawn', supervisorEnabled: true }),
    );
  });

  it('kills the tmux session and throws when no new session appears within the readiness timeout', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const kimiHome = makeHome();
    const overdeckHome = makeHome();
    const workspace = '/tmp/kimi-timeout-workspace';
    tmuxMocks.createSession.mockResolvedValue(undefined);
    tmuxMocks.sessionExists.mockResolvedValue(true);

    const runtime = new KimiCodeRuntimeSync({
      overdeckHome,
      kimiHome,
      prepareLaunch: async () => ({ binaryPath: '/opt/kimi/bin/kimi', pathExport: 'export PATH=/opt/kimi/bin:"$PATH"' }),
      resolveSupervisorScriptPath: () => '/dist/pty-supervisor.js',
      writePtyTokenFor: vi.fn(async () => 'test-token'),
    });

    const spawn = runtime.spawnAgent({
      agentId: 'agent-kimi-timeout',
      workspace,
      model: 'k3',
      runtime: 'kimi-code',
    });
    const rejection = expect(spawn).rejects.toThrow(
      'did not write a new session under its workDirKey bucket',
    );
    await vi.advanceTimersByTimeAsync(60_000);

    await rejection;
    expect(tmuxMocks.killSession).toHaveBeenCalledWith('agent-kimi-timeout');
  });

  it('sendMessage delegates to deliverAgentMessage and throws on failure (AC3)', async () => {
    const deliverMessage = vi.fn(async (_agentId: string, _message: string) => ({ ok: true }));
    const runtime = new KimiCodeRuntimeSync({ overdeckHome: makeHome(), kimiHome: makeHome(), deliverMessage });

    await runtime.sendMessage('agent-deliver', 'hello kimi');
    expect(deliverMessage).toHaveBeenCalledWith('agent-deliver', 'hello kimi');

    const failing = new KimiCodeRuntimeSync({
      overdeckHome: makeHome(),
      kimiHome: makeHome(),
      deliverMessage: vi.fn(async () => ({ ok: false, failure: 'socket-missing' })),
    });
    await expect(failing.sendMessage('agent-deliver-fail', 'hello')).rejects.toThrow(
      'Kimi Code agent agent-deliver-fail: message delivery failed (socket-missing)',
    );
  });

  it('does not import or call any sync sendKeys/execSync primitive (AC3)', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'kimi-code.ts'), 'utf-8');
    expect(source).not.toMatch(/\bsendKeysSync\b/);
    expect(source).not.toMatch(/\bexecSync\b/);
  });

  it('killAgent Ctrl-C\'s the pane then escalates to SIGTERM once the first poll window lapses (AC4)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    let terminated = false;
    tmuxMocks.sessionExists.mockImplementation(async () => !terminated);
    const execCommand = vi.fn(async (command: string) => {
      if (command.includes('list-panes')) return { stdout: '4242\n' };
      if (command.includes('kill -TERM')) terminated = true;
      return { stdout: '' };
    });
    const runtime = new KimiCodeRuntimeSync({ overdeckHome: makeHome(), kimiHome: makeHome(), execCommand });

    const killPromise = runtime.killAgent('agent-kill');
    await vi.advanceTimersByTimeAsync(2_000); // exhausts the post-Ctrl-C poll window
    await vi.advanceTimersByTimeAsync(300); // SIGTERM fires; the second poll notices it's gone
    await killPromise;

    expect(execCommand).toHaveBeenCalledWith(expect.stringContaining('send-keys -t \'agent-kill\' C-c'));
    expect(execCommand).toHaveBeenCalledWith(expect.stringContaining('list-panes'));
    expect(execCommand).toHaveBeenCalledWith(expect.stringContaining('kill -TERM'));
    expect(tmuxMocks.killSession).not.toHaveBeenCalled();
  });

  it('falls back to tmuxKillSession when the escalation ladder cannot confirm exit', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    tmuxMocks.sessionExists.mockResolvedValue(true);
    const execCommand = vi.fn(async (command: string) => {
      if (command.includes('list-panes')) return { stdout: '' };
      return { stdout: '' };
    });
    const runtime = new KimiCodeRuntimeSync({ overdeckHome: makeHome(), kimiHome: makeHome(), execCommand });

    const killPromise = runtime.killAgent('agent-kill-fallback');
    await vi.advanceTimersByTimeAsync(2_000); // first poll window
    await vi.advanceTimersByTimeAsync(5_000); // second poll window (session never dies — no pane pid to signal)
    await killPromise;

    expect(tmuxMocks.killSession).toHaveBeenCalledWith('agent-kill-fallback');
  });

  it('isRunning mirrors tmuxSessionExists (AC4)', async () => {
    tmuxMocks.sessionExists.mockResolvedValue(true);
    const runtime = new KimiCodeRuntimeSync({ overdeckHome: makeHome(), kimiHome: makeHome() });
    await expect(runtime.isRunning('agent-x')).resolves.toBe(true);
    expect(tmuxMocks.sessionExists).toHaveBeenCalledWith('agent-x');
  });

  it('listSessions returns only kimi-code agents with a captured session id (AC4)', () => {
    const kimiHome = makeHome();
    const overdeckHome = makeHome();
    const workspace = '/tmp/list-sessions-workspace';
    writeWireFixture(kimiHome, workspace, 'session_listed');
    mkdirSync(join(overdeckHome, 'agents', 'agent-listed'), { recursive: true });
    writeFileSync(join(overdeckHome, 'agents', 'agent-listed', 'kimi-session-id'), 'session_listed');

    const runtime = new KimiCodeRuntimeSync({
      overdeckHome,
      kimiHome,
      listAgentStates: () => ([
        { id: 'agent-listed', harness: 'kimi-code', workspace, model: 'k3', startedAt: new Date().toISOString() },
        { id: 'agent-other-harness', harness: 'claude-code', workspace, model: 'sonnet', startedAt: new Date().toISOString() },
        { id: 'agent-no-session-id', harness: 'kimi-code', workspace, model: 'k3', startedAt: new Date().toISOString() },
      ] as never),
    });

    const sessions = runtime.listSessions(workspace);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: 'session_listed', agentId: 'agent-listed', workspace });
  });

  it('createKimiCodeRuntimeSync builds a usable instance named kimi-code', () => {
    const runtime = createKimiCodeRuntimeSync();
    expect(runtime.name).toBe('kimi-code');
    expect(runtime.getHarnessBehavior().transcriptKind).toBe('kimi-wire-jsonl');
  });
});
