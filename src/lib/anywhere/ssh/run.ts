/**
 * SSH process runners (PAN-4404 WI-5).
 *
 * The one place that spawns `ssh`: a bounded command run (version probe, helper
 * start and stop) and the long-running port forward. `ssh` comes from `PATH`
 * and is always spawned with an argv array from `target.ts`, never a shell
 * (NFR-2). Everything is async with explicit timeouts (NFR-1, NFR-5), so the
 * dashboard server can call it. No dashboard code is imported here.
 */
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { connect, createServer } from 'node:net';

import { SshMachineError, sshCommandArgv, sshForwardArgv } from './target.js';

export type SpawnFn = typeof spawn;

export interface SshRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface SshRunOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

const MAX_CAPTURE = 1_048_576;
const PORT_POLL_MS = 250;
const PS_TIMEOUT_MS = 5_000;

function append(buffer: string, chunk: Buffer | string): string {
  const next = buffer + chunk.toString();
  return next.length > MAX_CAPTURE ? next.slice(-MAX_CAPTURE) : next;
}

/**
 * Run one command over SSH. Resolves with the exit code and output whatever the
 * exit code (the caller classifies failures); rejects with `unreachable` when the
 * timeout passes (the child is killed) or `ssh` cannot be started.
 */
export function runSshCommand(
  dest: string,
  remoteCmd: string,
  options: SshRunOptions,
  spawnFn: SpawnFn = spawn,
): Promise<SshRunResult> {
  const argv = sshCommandArgv(dest, remoteCmd);
  return new Promise((resolve, reject) => {
    const child = spawnFn('ssh', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const killChild = (): void => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    };
    const timer = setTimeout(() => {
      killChild();
      settle(() =>
        reject(
          new SshMachineError('unreachable', `SSH to ${dest} did not answer within ${Math.round(options.timeoutMs / 1000)} s.`, {
            timeoutMs: options.timeoutMs,
            stderr: stderr.slice(-2_000),
          }),
        ),
      );
    }, options.timeoutMs);
    const onAbort = (): void => {
      killChild();
      settle(() => reject(new SshMachineError('unreachable', `SSH to ${dest} was cancelled.`)));
    };
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.once('error', (error) => {
      settle(() => reject(new SshMachineError('unreachable', `Could not run ssh on this machine: ${error.message}`)));
    });
    // `close` (not `exit`): every byte of output has arrived by then.
    child.once('close', (code) => {
      settle(() => resolve({ exitCode: code, stdout, stderr }));
    });
  });
}

/** Spawn the long-running forward `ssh -N -L 127.0.0.1:<lp>:127.0.0.1:<rp> -- <dest>`. */
export function spawnSshForward(dest: string, localPort: number, remotePort: number, spawnFn: SpawnFn = spawn): ChildProcess {
  return spawnFn('ssh', sshForwardArgv(dest, localPort, remotePort), { stdio: ['ignore', 'ignore', 'pipe'] });
}

/** A loopback port that is free right now (listen on port 0, read it, close). */
export function pickFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('could not pick a free loopback port'))));
    });
  });
}

function tryConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const done = (ok: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(PORT_POLL_MS * 4, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** True once `127.0.0.1:<port>` accepts a TCP connection; false after `timeoutMs`. */
export async function waitForLocalPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await tryConnect(port)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, PORT_POLL_MS));
  }
}

/** The command line of `pid` (`ps -o args= -p <pid>`), or null when it is not running. */
export function commandLineOf(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'args=', '-p', String(pid)], { timeout: PS_TIMEOUT_MS }, (error, stdout) => {
      const line = String(stdout ?? '').trim();
      resolve(error || line === '' ? null : line);
    });
  });
}
