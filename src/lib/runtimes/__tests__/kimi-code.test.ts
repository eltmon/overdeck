import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdir as readdirAsync } from 'node:fs/promises';
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
  findKimiWirePathAsync,
  findLatestKimiSession,
  findLatestKimiSessionAsync,
  kimiSessionsRoot,
  kimiWorkDirKey,
  KimiCodeRuntimeSync,
  waitForNewKimiSessionAsync,
  withKimiSessionCaptureLock,
  writeKimiSessionId,
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

describe('findKimiWirePathAsync / findLatestKimiSessionAsync (PAN-1837 review fix, P2)', () => {
  it('resolves the captured session id under the workspace bucket', async () => {
    const kimiHome = makeHome();
    const workDir = '/tmp/some-workspace';
    const wirePath = writeWireFixture(kimiHome, workDir, 'session_captured');
    writeWireFixture(kimiHome, workDir, 'session_other');

    await expect(findKimiWirePathAsync(kimiHome, workDir, 'session_captured')).resolves.toBe(wirePath);
  });

  it('falls back to the newest session dir when no id is captured, matching the sync version', async () => {
    const kimiHome = makeHome();
    const workDir = '/tmp/some-workspace';
    writeWireFixture(kimiHome, workDir, 'session_older');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = writeWireFixture(kimiHome, workDir, 'session_newer');

    await expect(findKimiWirePathAsync(kimiHome, workDir, null)).resolves.toBe(newer);
    await expect(findLatestKimiSessionAsync(kimiHome, workDir)).resolves.toBe(newer);
  });

  it('returns null when the bucket does not exist', async () => {
    const kimiHome = makeHome();
    await expect(findLatestKimiSessionAsync(kimiHome, '/tmp/never-launched')).resolves.toBeNull();
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

  // AC3 (no sync sendKeys/execSync primitive) is exercised at runtime, not by
  // reading source text: the killAgent escalation-ladder tests below run
  // under vi.useFakeTimers() and only resolve once every awaited step
  // (tmuxSessionExists polls, execCommand calls) actually yields to the event
  // loop — a sync execSync/sendKeysSync call would block the fake-timer
  // advance instead of interleaving with it.

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

/**
 * Repeatedly advance the fake clock in small steps until `promise` settles.
 * A single large `advanceTimersByTimeAsync` cannot drive this: real fs I/O
 * (readdirAsync) sits between fake `setTimeout` calls, so a new timer
 * scheduled only after real I/O resolves would never fire once the one big
 * advance window has already closed. Small repeated advances give the real
 * I/O a chance to resolve and schedule its next timer between each step.
 */
async function drainFakeTimersUntilSettled(promise: Promise<unknown>, maxSteps = 300, stepMs = 10): Promise<void> {
  let isSettled = false;
  promise.then(() => { isSettled = true; }, () => { isSettled = true; });
  for (let i = 0; i < maxSteps && !isSettled; i++) {
    await vi.advanceTimersByTimeAsync(stepMs);
  }
}

describe('withKimiSessionCaptureLock (PAN-1837 review fix — concurrent same-cwd conversations)', () => {
  // PAN-1837 review fix (P2): repository policy requires fake timers for any
  // delay-based test — real setTimeout delays here (however small) keep the
  // test's timer/microtask state alive longer than necessary and are the
  // documented source of flake/OOM under parallel workers.
  let previousOverdeckHome: string | undefined;
  let lockOverdeckHome: string;

  beforeEach(() => {
    vi.useFakeTimers();
    // PAN-1837 review fix (cycle 7): the lock is now a cross-process
    // filesystem lock rooted at getOverdeckHome(), not an in-memory Map —
    // point it at a throwaway home so these tests never touch the real
    // ~/.overdeck/locks/kimi-capture/.
    previousOverdeckHome = process.env.OVERDECK_HOME;
    lockOverdeckHome = makeHome();
    process.env.OVERDECK_HOME = lockOverdeckHome;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousOverdeckHome;
  });

  it('serializes two concurrent launches sharing one cwd so each captures its own distinct session id', async () => {
    const kimiHome = makeHome();
    const workDir = '/tmp/concurrent-conversations-workspace';
    const bucketDir = kimiSessionsRoot(kimiHome, workDir);

    // Mirrors the real conversation-runtime.ts usage: the "existing sessions"
    // snapshot is taken freshly INSIDE the locked callback, right before the
    // new session directory is created — not shared/precomputed across
    // launches. That is what makes serialization correct: launch B's snapshot
    // (which only runs once launch A's callback has fully released the lock)
    // already contains launch A's captured directory, so only launch B's own
    // new directory is ever "fresh" for it.
    const launch = (sessionId: string) =>
      withKimiSessionCaptureLock(kimiHome, workDir, async () => {
        let existingBefore: Set<string>;
        try {
          existingBefore = new Set(await readdirAsync(bucketDir));
        } catch {
          existingBefore = new Set();
        }
        // Simulate the real gap between "tmux session created" and "Kimi's
        // own process has written its session directory" — this delay is
        // exactly what let two unlocked launches both observe both
        // directories as fresh in the pre-fix implementation.
        await new Promise((resolve) => setTimeout(resolve, 5));
        writeWireFixture(kimiHome, workDir, sessionId);
        return waitForNewKimiSessionAsync(kimiHome, workDir, existingBefore, 2_000);
      });

    const result1 = launch('session_alpha');
    const result2 = launch('session_beta');
    const both = Promise.all([result1, result2]);

    await drainFakeTimersUntilSettled(both);

    const [captured1, captured2] = await both;

    expect(captured1).not.toBeNull();
    expect(captured2).not.toBeNull();
    expect(captured1).not.toBe(captured2);
    expect(new Set([captured1, captured2])).toEqual(new Set(['session_alpha', 'session_beta']));
  });

  it('lets a second bucket proceed immediately — the lock is per-workDirKey, not global', async () => {
    const kimiHome = makeHome();
    const order: string[] = [];

    const slow = withKimiSessionCaptureLock(kimiHome, '/tmp/workspace-one', async () => {
      order.push('slow-start');
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push('slow-end');
    });
    const fast = withKimiSessionCaptureLock(kimiHome, '/tmp/workspace-two', async () => {
      order.push('fast-start');
      order.push('fast-end');
    });

    const both = Promise.all([slow, fast]);
    await drainFakeTimersUntilSettled(both);
    await both;

    // The unrelated-bucket task completes without waiting on the slow one.
    expect(order.indexOf('fast-end')).toBeLessThan(order.indexOf('slow-end'));
  });

  it('pins distinct ids when a work/restart-shaped launch and a conversation-shaped launch race in the same cwd (PAN-1837 review fix)', async () => {
    // PAN-1837 review cycle 6: the lock was previously wired into
    // spawnConversationSession() only; spawnAgent(), restartAgent(), and
    // recoverAgent() snapshotted/polled outside it, so a work agent and a
    // conversation launched concurrently against the same cwd could each
    // capture the OTHER's session directory. All four owners now route
    // through this same withKimiSessionCaptureLock — this proves two
    // DIFFERENT identity shapes (a work-agent id, a conversation tmux-session
    // id) racing on one cwd each still pin their own, distinct session.
    const kimiHome = makeHome();
    const overdeckHome = makeHome();
    const workDir = '/tmp/cross-owner-workspace';
    const bucketDir = kimiSessionsRoot(kimiHome, workDir);
    // writeKimiSessionId doesn't create parent dirs — real callers always run
    // after the agent/conversation dir already exists (getAgentDir mkdir's it
    // at spawn time); mirror that here.
    mkdirSync(join(overdeckHome, 'agents', 'agent-work-1'), { recursive: true });
    mkdirSync(join(overdeckHome, 'agents', 'conv-abc'), { recursive: true });

    const launch = (identityId: string, sessionId: string) =>
      withKimiSessionCaptureLock(kimiHome, workDir, async () => {
        let existingBefore: Set<string>;
        try {
          existingBefore = new Set(await readdirAsync(bucketDir));
        } catch {
          existingBefore = new Set();
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
        writeWireFixture(kimiHome, workDir, sessionId);
        const captured = await waitForNewKimiSessionAsync(kimiHome, workDir, existingBefore, 2_000);
        if (captured) writeKimiSessionId(identityId, captured, overdeckHome);
        return captured;
      });

    const workLaunch = launch('agent-work-1', 'session_work');
    const conversationLaunch = launch('conv-abc', 'session_conversation');
    const both = Promise.all([workLaunch, conversationLaunch]);
    await drainFakeTimersUntilSettled(both);
    const [workCaptured, conversationCaptured] = await both;

    expect(workCaptured).not.toBeNull();
    expect(conversationCaptured).not.toBeNull();
    expect(workCaptured).not.toBe(conversationCaptured);
    expect(readFileSync(join(overdeckHome, 'agents', 'agent-work-1', 'kimi-session-id'), 'utf-8').trim()).toBe(workCaptured);
    expect(readFileSync(join(overdeckHome, 'agents', 'conv-abc', 'kimi-session-id'), 'utf-8').trim()).toBe(conversationCaptured);
  });
});
