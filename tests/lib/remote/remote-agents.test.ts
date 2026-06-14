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
} from '../../../src/lib/remote/remote-agents.js';

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
    const scriptPath = join(tmpDir, `watchdog-${thresholdSeconds}-${intervalSeconds}.js`);
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
});
