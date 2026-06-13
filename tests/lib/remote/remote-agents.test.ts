import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(
    (_cmd: string, _args: string[], callback?: (err: Error | null) => void) => {
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

import { generatePushDaemonScript, installPushDaemon } from '../../../src/lib/remote/remote-agents.js';

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
