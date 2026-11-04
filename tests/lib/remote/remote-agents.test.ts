import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, writeFileSync, rmSync, utimesSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(
    (_cmd: string, _args: string[], callback?: (err: Error | null) => void) => {
      // Intercept the VM self-stop kill so tests never actually signal PID 1.
      if (_cmd === 'kill' && _args[0] === '1') {
        if (callback) callback(null);
        return {} as ReturnType<typeof import('child_process').execFile>;
      }
      if (_args.includes('diff')) {
        if (callback) callback(new Error('changes'));
        return {} as ReturnType<typeof import('child_process').execFile>;
      }
      if (callback) callback(null);
      return {} as ReturnType<typeof import('child_process').execFile>;
    },
  ),
}));

const { flySshCommands } = vi.hoisted(() => ({ flySshCommands: [] as string[] }));

vi.mock('../../../src/lib/remote/fly-provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/remote/fly-provider.js')>();
  const { Effect: E } = await import('effect');
  return {
    ...actual,
    createFlyProvider: () => ({
      ssh: (_vm: string, command: string) => {
        flySshCommands.push(command);
        return E.succeed({ stdout: '', stderr: '', exitCode: 0 });
      },
    }),
  };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFile: execFileMock };
});

import {
  generatePushDaemonScript,
  installPushDaemon,
  generateEphemeralWatchdogScript,
  installEphemeralWatchdog,
  refreshHostHeartbeatForEphemeralVms,
  checkRemoteSpendCap,
  checkRemoteDurabilityPreflight,
  getRemoteAgentOutput,
  sendToRemoteAgent,
  killRemoteAgent,
  saveRemoteAgentState,
  loadRemoteAgentState,
  type RemoteAgentState,
} from '../../../src/lib/remote/remote-agents.js';
import { getManagedTmuxSocketName } from '../../../src/lib/tmux.js';

describe('generatePushDaemonScript', () => {
  it('includes the issue branch and wip(remote) prefix', () => {
    const script = generatePushDaemonScript({ issueId: 'PAN-1845', branch: 'feature/pan-1845' });
    expect(script).toContain('"feature/pan-1845"');
    expect(script).toContain("'wip(remote): heartbeat for ' + \"PAN-1845\"");
    expect(script).toContain('setInterval');
  });

  it('schedules the heartbeat at the configured interval', () => {
    const script = generatePushDaemonScript({ issueId: 'PAN-1845', branch: 'feature/pan-1845', intervalSeconds: 42 });
    expect(script).toContain("'42'");
    expect(script).toContain('intervalSeconds * 1000');
  });
});

describe('installPushDaemon', () => {
  function recordingProvider(sshCommands: string[], scriptBytes: number) {
    return {
      ssh: vi.fn((_vm: string, command: string) => {
        sshCommands.push(command);
        const stdout = command.includes('wc -c') && command.includes('push-daemon-pan-1.js') ? `${scriptBytes}\n` : '';
        return Effect.succeed({ stdout, stderr: '', exitCode: 0 });
      }),
    } as unknown as import('../../../src/lib/remote/fly-provider.js').FlyProvider;
  }

  it('runs in a linked agent\'s VM worktree (PAN-4734 FR-9)', async () => {
    const workdir = '/workspace/overdeck/workspaces/feature-pan-1';
    const script = generatePushDaemonScript({ issueId: 'PAN-1', branch: 'feature/pan-1', logFile: '/workspace/.pan/push-daemon-pan-1.log', workdir });
    expect(script).toContain(`const cwd = "${workdir}";`);
    const sshCommands: string[] = [];

    await installPushDaemon(recordingProvider(sshCommands, Buffer.byteLength(script)), 'vm-1', 'PAN-1', workdir);

    const heartbeatTmux = sshCommands.find((cmd) => cmd.includes('new-session') && cmd.includes('push-daemon-pan-1'));
    expect(heartbeatTmux).toContain(`'-c' '${workdir}'`);
  });

  it('runs in /workspace when no workdir is given', async () => {
    const script = generatePushDaemonScript({ issueId: 'PAN-1', branch: 'feature/pan-1', logFile: '/workspace/.pan/push-daemon-pan-1.log' });
    expect(script).toContain('const cwd = "/workspace";');
    const sshCommands: string[] = [];

    await installPushDaemon(recordingProvider(sshCommands, Buffer.byteLength(script)), 'vm-1', 'PAN-1');

    const heartbeatTmux = sshCommands.find((cmd) => cmd.includes('new-session') && cmd.includes('push-daemon-pan-1'));
    expect(heartbeatTmux).toContain(`'-c' '/workspace'`);
  });

  it('writes the daemon script and starts a detached tmux heartbeat session', async () => {
    const sshCommands: string[] = [];
    const logFile = '/workspace/.pan/push-daemon-pan-1845.log';
    const script = generatePushDaemonScript({ issueId: 'PAN-1845', branch: 'feature/pan-1845', logFile });
    const expectedBytes = Buffer.byteLength(script);

    const provider = {
      ssh: vi.fn((_vm: string, command: string) => {
        sshCommands.push(command);
        let stdout = '';
        if (command.includes('wc -c') && command.includes('push-daemon-pan-1845.js')) {
          stdout = `${expectedBytes}\n`;
        }
        return Effect.succeed({ stdout, stderr: '', exitCode: 0 });
      }),
    } as unknown as import('../../../src/lib/remote/fly-provider.js').FlyProvider;

    await installPushDaemon(provider, 'vm-123', 'PAN-1845');

    const heartbeatTmux = sshCommands.find(
      (cmd) => cmd.includes('new-session') && cmd.includes('push-daemon-pan-1845'),
    );
    expect(heartbeatTmux).toBeDefined();
    expect(heartbeatTmux).toContain("'feature/pan-1845'");
    expect(heartbeatTmux).toContain('node /workspace/.pan/push-daemon-pan-1845.js');

    const scriptWrite = sshCommands.find((cmd) => cmd.includes('push-daemon-pan-1845.js.b64'));
    expect(scriptWrite).toBeDefined();
  });
});

describe('generateEphemeralWatchdogScript', () => {
  it('includes heartbeat path, stale threshold, and interval', () => {
    const script = generateEphemeralWatchdogScript({
      heartbeatPath: '/workspace/.pan/host-heartbeat',
      staleThresholdSeconds: 300,
      intervalSeconds: 60,
      logFile: '/workspace/.pan/watchdog.log',
    });
    expect(script).toContain('/workspace/.pan/host-heartbeat');
    expect(script).toContain('300');
    expect(script).toContain('60');
    expect(script).toContain("execFile('kill', ['1']");
    expect(script).toContain('setInterval');
  });
});

describe('installEphemeralWatchdog', () => {
  it('writes the watchdog script and starts a detached tmux watchdog session', async () => {
    const sshCommands: string[] = [];
    const logFile = '/workspace/.pan/ephemeral-watchdog-pan-1845.log';
    const script = generateEphemeralWatchdogScript({
      heartbeatPath: '/workspace/.pan/host-heartbeat',
      intervalSeconds: 60,
      staleThresholdSeconds: 300,
      logFile,
    });
    const expectedBytes = Buffer.byteLength(script);

    const provider = {
      ssh: vi.fn((_vm: string, command: string) => {
        sshCommands.push(command);
        let stdout = '';
        if (command.includes('wc -c') && command.includes('ephemeral-watchdog-pan-1845.js')) {
          stdout = `${expectedBytes}\n`;
        }
        return Effect.succeed({ stdout, stderr: '', exitCode: 0 });
      }),
    } as unknown as import('../../../src/lib/remote/fly-provider.js').FlyProvider;

    await installEphemeralWatchdog(provider, 'vm-123', 'PAN-1845');

    const watchdogTmux = sshCommands.find(
      (cmd) => cmd.includes('new-session') && cmd.includes('ephemeral-watchdog-pan-1845'),
    );
    expect(watchdogTmux).toBeDefined();
    expect(watchdogTmux).toContain('node /workspace/.pan/ephemeral-watchdog-pan-1845.js');
    expect(watchdogTmux).toContain('PAN_WATCHDOG_STALE_SECONDS=300');

    const scriptWrite = sshCommands.find((cmd) => cmd.includes('ephemeral-watchdog-pan-1845.js.b64'));
    expect(scriptWrite).toBeDefined();
  });
});

describe('ephemeral watchdog behavior', () => {
  let tmpDir: string;
  let heartbeatPath: string;
  let logFile: string;

  beforeEach(() => {
    vi.useFakeTimers();
    tmpDir = join(tmpdir(), `watchdog-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    heartbeatPath = join(tmpDir, 'host-heartbeat');
    logFile = join(tmpDir, 'watchdog.log');
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function runWatchdog(thresholdSeconds = 300, intervalSeconds = 60) {
    const script = generateEphemeralWatchdogScript({
      heartbeatPath,
      intervalSeconds,
      staleThresholdSeconds: thresholdSeconds,
      logFile,
    });
    const scriptPath = join(tmpDir, `watchdog-${thresholdSeconds}-${intervalSeconds}.cjs`);
    writeFileSync(scriptPath, script);
    delete require.cache[scriptPath];
    const mod = require(scriptPath);
    mod.runWatchdog({ intervalSeconds, staleThresholdSeconds: thresholdSeconds });
  }

  it('does not stop the machine when heartbeat is fresh', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    writeFileSync(heartbeatPath, 'fresh');
    runWatchdog();
    await vi.advanceTimersByTimeAsync(60_000);
    const log = existsSync(logFile) ? readFileSync(logFile, 'utf-8') : '<no log>';
    expect(log).toContain('Heartbeat fresh');
    expect(log).not.toContain('stopping machine');
  });

  it('stops the machine when heartbeat is stale', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const now = Date.now();
    writeFileSync(heartbeatPath, 'stale');
    utimesSync(heartbeatPath, now / 1000, (now - 400_000) / 1000);
    runWatchdog();
    await vi.advanceTimersByTimeAsync(60_000);
    const log = existsSync(logFile) ? readFileSync(logFile, 'utf-8') : '<no log>';
    expect(log).toContain('Heartbeat stale');
    expect(log).toContain('stopping machine (kill 1)');
  });

  it('keeps checking on each interval after going stale', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const now = Date.now();
    writeFileSync(heartbeatPath, 'stale');
    utimesSync(heartbeatPath, now / 1000, (now - 400_000) / 1000);
    runWatchdog();
    // Initial synchronous check logs the first stop decision.
    let log = existsSync(logFile) ? readFileSync(logFile, 'utf-8') : '<no log>';
    expect(log.split('stopping machine').length - 1).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    log = existsSync(logFile) ? readFileSync(logFile, 'utf-8') : '<no log>';
    expect(log.split('stopping machine').length - 1).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    log = existsSync(logFile) ? readFileSync(logFile, 'utf-8') : '<no log>';
    expect(log.split('stopping machine').length - 1).toBe(3);
  });
});

describe('checkRemoteSpendCap', () => {
  it('allows spawn when cap is unset', () => {
    const result = checkRemoteSpendCap(
      { remote: { max_concurrent_agents: undefined } },
      { listActiveRemoteAgentStates: () => [{ id: 'agent-pan-1', issueId: 'PAN-1', vmName: 'vm-1', model: 'claude-sonnet-4-6', status: 'running', startedAt: '2026-01-01T00:00:00Z', location: 'remote' }] },
    );
    expect(result.allowed).toBe(true);
    expect(result.cap).toBe(0);
  });

  it('allows spawn when cap is zero', () => {
    const result = checkRemoteSpendCap(
      { remote: { max_concurrent_agents: 0 } },
      { listActiveRemoteAgentStates: () => [{ id: 'agent-pan-1', issueId: 'PAN-1', vmName: 'vm-1', model: 'claude-sonnet-4-6', status: 'running', startedAt: '2026-01-01T00:00:00Z', location: 'remote' }] },
    );
    expect(result.allowed).toBe(true);
    expect(result.cap).toBe(0);
  });

  it('allows spawn when active count is below cap', () => {
    const result = checkRemoteSpendCap(
      { remote: { max_concurrent_agents: 3 } },
      { listActiveRemoteAgentStates: () => [{ id: 'agent-pan-1', issueId: 'PAN-1', vmName: 'vm-1', model: 'claude-sonnet-4-6', status: 'running', startedAt: '2026-01-01T00:00:00Z', location: 'remote' }] },
    );
    expect(result.allowed).toBe(true);
    expect(result.current).toBe(1);
    expect(result.cap).toBe(3);
  });

  it('refuses spawn when active count reaches cap', () => {
    const active = [
      { id: 'agent-pan-1', issueId: 'PAN-1', vmName: 'vm-1', model: 'claude-sonnet-4-6', status: 'running', startedAt: '2026-01-01T00:00:00Z', location: 'remote' as const },
      { id: 'agent-pan-2', issueId: 'PAN-2', vmName: 'vm-2', model: 'claude-sonnet-4-6', status: 'running', startedAt: '2026-01-01T00:00:00Z', location: 'remote' as const },
    ];
    const result = checkRemoteSpendCap(
      { remote: { max_concurrent_agents: 2 } },
      { listActiveRemoteAgentStates: () => active },
    );
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(2);
    expect(result.cap).toBe(2);
    expect(result.message).toContain('cap reached');
    expect(result.message).toContain('2/2');
  });

  it('counts starting agents against the cap', () => {
    const active = [
      { id: 'agent-pan-1', issueId: 'PAN-1', vmName: 'vm-1', model: 'claude-sonnet-4-6', status: 'starting', startedAt: '2026-01-01T00:00:00Z', location: 'remote' as const },
    ];
    const result = checkRemoteSpendCap(
      { remote: { max_concurrent_agents: 1 } },
      { listActiveRemoteAgentStates: () => active },
    );
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(1);
  });

  it('counts Fly machines against the same cap (PAN-4652 FR-12)', () => {
    const active = [
      { id: 'agent-pan-1', issueId: 'PAN-1', vmName: 'vm-1', model: 'claude-sonnet-4-6', status: 'running', startedAt: '2026-01-01T00:00:00Z', location: 'remote' as const },
    ];
    const result = checkRemoteSpendCap(
      { remote: { max_concurrent_agents: 2 } },
      { listActiveRemoteAgentStates: () => active, countFlyMachines: () => 1 },
    );
    expect(result).toMatchObject({ allowed: false, current: 2, cap: 2 });
    expect(result.message).toContain('Fly machines');
  });

  it('ignores an unreadable Fly machine store when no cap applies, and fails closed when one does', () => {
    const corrupt = () => { throw new Error('Fly machine store /x/fly-machines.json has an unexpected shape'); };
    expect(checkRemoteSpendCap({ remote: {} }, { listActiveRemoteAgentStates: () => [], countFlyMachines: corrupt }))
      .toMatchObject({ allowed: true, cap: 0 });
    expect(() => checkRemoteSpendCap({ remote: { max_concurrent_agents: 2 } }, { listActiveRemoteAgentStates: () => [], countFlyMachines: corrupt }))
      .toThrow('unexpected shape');
  });

  it('does not count a linked work agent on top of its Fly machine (PAN-4734 FR-10)', () => {
    const active = [
      { id: 'agent-pan-1', issueId: 'PAN-1', vmName: 'overdeck-machine-1a2b3c4d', model: 'claude-opus-5-5', status: 'running', startedAt: '2026-01-01T00:00:00Z', location: 'remote' as const, startedBy: 'operator', linked: true as const },
    ];
    const result = checkRemoteSpendCap(
      { remote: { max_concurrent_agents: 2 } },
      { listActiveRemoteAgentStates: () => active, countFlyMachines: () => 1 },
    );
    expect(result).toMatchObject({ allowed: true, current: 1, cap: 2 });
  });

  it('allows any count of agents and Fly machines when the cap is zero', () => {
    const result = checkRemoteSpendCap(
      { remote: { max_concurrent_agents: 0 } },
      { listActiveRemoteAgentStates: () => [], countFlyMachines: () => 5 },
    );
    expect(result).toMatchObject({ allowed: true, current: 5, cap: 0 });
  });
});

describe('checkRemoteDurabilityPreflight', () => {
  it('passes for ephemeral tier without checking volume', async () => {
    const provider = {
      ssh: vi.fn(() => Effect.succeed({ stdout: '', stderr: '', exitCode: 0 })),
    } as unknown as import('../../../src/lib/remote/fly-provider.js').FlyProvider;

    const result = await checkRemoteDurabilityPreflight(provider, 'vm-eph', 'ephemeral');
    expect(result.ok).toBe(true);
    expect(provider.ssh).not.toHaveBeenCalled();
  });

  it('passes for durable tier when /workspace is mounted', async () => {
    const provider = {
      ssh: vi.fn(() => Effect.succeed({ stdout: 'mounted\n', stderr: '', exitCode: 0 })),
    } as unknown as import('../../../src/lib/remote/fly-provider.js').FlyProvider;

    const result = await checkRemoteDurabilityPreflight(provider, 'vm-dur', 'durable');
    expect(result.ok).toBe(true);
    expect(provider.ssh).toHaveBeenCalledTimes(1);
    expect(provider.ssh).toHaveBeenCalledWith('vm-dur', expect.stringContaining('/workspace'));
  });

  it('fails for durable tier when /workspace is not mounted', async () => {
    const provider = {
      ssh: vi.fn(() => Effect.succeed({ stdout: 'missing\n', stderr: '', exitCode: 0 })),
    } as unknown as import('../../../src/lib/remote/fly-provider.js').FlyProvider;

    const result = await checkRemoteDurabilityPreflight(provider, 'vm-dur', 'durable');
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('volume');
    expect(result.message).toContain('volume');
    expect(result.message).toContain('Durable remote work requires a Fly volume');
  });
});

describe('refreshHostHeartbeatForEphemeralVms', () => {
  it('skips when no active remote agents exist', async () => {
    const ssh = vi.fn();
    const createFlyProvider = vi.fn(() => ({ ssh }));
    const actions = await refreshHostHeartbeatForEphemeralVms({
      listActiveRemoteAgentStates: () => [],
      createFlyProvider: createFlyProvider as any,
      now: () => new Date('2026-01-01T00:00:00Z'),
    });
    expect(actions).toEqual([]);
    expect(createFlyProvider).not.toHaveBeenCalled();
    expect(ssh).not.toHaveBeenCalled();
  });

  it('writes heartbeat to active ephemeral VMs and skips durable ones', async () => {
    const sshCommands: string[] = [];
    const ssh = vi.fn((_vm: string, command: string) => {
      sshCommands.push(command);
      return Effect.succeed({ stdout: '', stderr: '', exitCode: 0 });
    });
    const createFlyProvider = vi.fn(() => ({ ssh }));
    const actions = await refreshHostHeartbeatForEphemeralVms({
      listActiveRemoteAgentStates: () => [
        {
          id: 'agent-pan-1845',
          issueId: 'PAN-1845',
          vmName: 'vm-eph',
          model: 'claude-sonnet-4-6',
          status: 'running',
          startedAt: '2026-01-01T00:00:00Z',
          location: 'remote',
          tier: 'ephemeral',
        },
        {
          id: 'agent-pan-1846',
          issueId: 'PAN-1846',
          vmName: 'vm-dur',
          model: 'claude-sonnet-4-6',
          status: 'running',
          startedAt: '2026-01-01T00:00:00Z',
          location: 'remote',
          tier: 'durable',
        },
      ],
      createFlyProvider: createFlyProvider as any,
      now: () => new Date('2026-01-01T00:00:00Z'),
    });

    expect(actions).toEqual(['Host heartbeat refreshed for PAN-1845 on vm-eph']);
    expect(ssh).toHaveBeenCalledTimes(1);
    expect(sshCommands[0]).toContain('/workspace/.pan/host-heartbeat');
    expect(sshCommands[0]).toContain('2026-01-01T00:00:00.000Z');
  });

  it('skips a linked work agent, whose Fly machine record owns the heartbeat (PAN-4734 FR-10)', async () => {
    const createFlyProvider = vi.fn();
    const actions = await refreshHostHeartbeatForEphemeralVms({
      listActiveRemoteAgentStates: () => [
        {
          id: 'agent-pan-1',
          issueId: 'PAN-1',
          vmName: 'overdeck-machine-1a2b3c4d',
          model: 'claude-opus-5-5',
          status: 'running',
          startedAt: '2026-01-01T00:00:00Z',
          location: 'remote',
          startedBy: 'operator',
          tier: 'ephemeral',
          linked: true,
        },
      ],
      createFlyProvider: createFlyProvider as any,
      now: () => new Date('2026-01-01T00:00:00Z'),
    });
    expect(actions).toEqual([]);
    expect(createFlyProvider).not.toHaveBeenCalled();
  });

  it('returns a failure message when SSH fails', async () => {
    const ssh = vi.fn(() => Effect.fail(new Error('fly API down')));
    const actions = await refreshHostHeartbeatForEphemeralVms({
      listActiveRemoteAgentStates: () => [
        {
          id: 'agent-pan-1845',
          issueId: 'PAN-1845',
          vmName: 'vm-eph',
          model: 'claude-sonnet-4-6',
          status: 'running',
          startedAt: '2026-01-01T00:00:00Z',
          location: 'remote',
          tier: 'ephemeral',
        },
      ],
      createFlyProvider: () => ({ ssh }) as any,
      now: () => new Date('2026-01-01T00:00:00Z'),
    });
    expect(actions[0]).toContain('failed');
    expect(actions[0]).toContain('fly API down');
  });

  it('reports a failure when the heartbeat exec exits non-zero', async () => {
    const ssh = vi.fn(() => Effect.succeed({ stdout: '', stderr: 'machine not started', exitCode: 1 }));
    const actions = await refreshHostHeartbeatForEphemeralVms({
      listActiveRemoteAgentStates: () => [
        {
          id: 'agent-pan-1845',
          issueId: 'PAN-1845',
          vmName: 'vm-eph',
          model: 'claude-sonnet-4-6',
          status: 'running',
          startedAt: '2026-01-01T00:00:00Z',
          location: 'remote',
          tier: 'ephemeral',
        },
      ],
      createFlyProvider: () => ({ ssh }) as any,
      now: () => new Date('2026-01-01T00:00:00Z'),
    });
    expect(actions).toEqual(['Host heartbeat failed for PAN-1845 on vm-eph (exit 1): machine not started']);
    expect(actions[0]).not.toContain('refreshed');
  });
});

describe('remote tmux target (PAN-4734)', () => {
  const VM = 'overdeck-machine-1a2b3c4d';
  const CONFIG = `'-f' '/workspace/.pan/tmux/overdeck.tmux.conf'`;

  function seedState(id: string, extra: Partial<RemoteAgentState> = {}): void {
    saveRemoteAgentState({
      id,
      issueId: 'PAN-4734',
      vmName: VM,
      model: 'claude-opus-5-5',
      status: 'running',
      startedAt: '2026-11-02T00:00:00.000Z',
      location: 'remote',
      startedBy: 'operator',
      ...extra,
    });
  }

  const tmuxCommands = (): string[] => flySshCommands.filter((command) => command.startsWith(`'tmux'`));

  beforeEach(() => {
    flySshCommands.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('linked work agent', () => {
    const AGENT = 'agent-pan-4734-linked';

    beforeEach(() => {
      seedState(AGENT, {
        linked: true,
        environmentId: 'env-1',
        tmuxSession: 'conv-20261102-1234',
        tmuxSocket: 'overdeck',
      });
    });

    it('captures output from the conversation session on the VM socket', async () => {
      await getRemoteAgentOutput(AGENT, VM);
      expect(tmuxCommands()).toEqual([
        `'tmux' '-L' 'overdeck' ${CONFIG} 'capture-pane' '-t' 'conv-20261102-1234' '-p' '-S' '-100'`,
      ]);
    });

    it('pastes into the conversation session and keeps the agent id for the buffer', async () => {
      vi.useFakeTimers();
      const pending = sendToRemoteAgent(AGENT, VM, 'hello');
      await vi.advanceTimersByTimeAsync(300);
      expect(await pending).toEqual({ ok: true });
      expect(tmuxCommands()).toEqual([
        `'tmux' '-L' 'overdeck' ${CONFIG} 'load-buffer' '-b' '${AGENT}' '/workspace/.pan/prompts/${AGENT}-message.txt'`,
        `'tmux' '-L' 'overdeck' ${CONFIG} 'paste-buffer' '-b' '${AGENT}' '-t' 'conv-20261102-1234' '-d'`,
        `'tmux' '-L' 'overdeck' ${CONFIG} 'send-keys' '-t' 'conv-20261102-1234' 'C-m'`,
      ]);
    });

    it('kills the conversation session and records stopped on the agent id', async () => {
      await killRemoteAgent(AGENT, VM);
      expect(tmuxCommands()).toEqual([
        `'tmux' '-L' 'overdeck' ${CONFIG} 'kill-session' '-t' 'conv-20261102-1234' 2>/dev/null || true`,
      ]);
      expect(loadRemoteAgentState(AGENT)?.status).toBe('stopped');
    });
  });

  describe('legacy remote agent', () => {
    const AGENT = 'agent-pan-4734-legacy';

    beforeEach(() => {
      seedState(AGENT);
    });

    it('produces the unchanged output, send and kill commands', async () => {
      vi.useFakeTimers();
      const socket = getManagedTmuxSocketName();
      await getRemoteAgentOutput(AGENT, VM);
      const pending = sendToRemoteAgent(AGENT, VM, 'hello');
      await vi.advanceTimersByTimeAsync(300);
      await pending;
      await killRemoteAgent(AGENT, VM);
      expect(tmuxCommands()).toEqual([
        `'tmux' '-L' '${socket}' ${CONFIG} 'capture-pane' '-t' '${AGENT}' '-p' '-S' '-100'`,
        `'tmux' '-L' '${socket}' ${CONFIG} 'load-buffer' '-b' '${AGENT}' '/workspace/.pan/prompts/${AGENT}-message.txt'`,
        `'tmux' '-L' '${socket}' ${CONFIG} 'paste-buffer' '-b' '${AGENT}' '-t' '${AGENT}' '-d'`,
        `'tmux' '-L' '${socket}' ${CONFIG} 'send-keys' '-t' '${AGENT}' 'C-m'`,
        `'tmux' '-L' '${socket}' ${CONFIG} 'kill-session' '-t' '${AGENT}' 2>/dev/null || true`,
      ]);
      expect(loadRemoteAgentState(AGENT)?.status).toBe('stopped');
    });
  });
});
