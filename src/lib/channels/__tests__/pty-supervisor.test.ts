import type * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PTY_TOKEN_HEADER, writePtyToken } from '../../pty-token.js';
import { createPtySupervisorServer, injectPtyMessage } from '../pty-supervisor.js';

const REPO_ROOT = process.cwd();
const SUPERVISOR_ENTRY = join(REPO_ROOT, 'dist/pty-supervisor.js');
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

let tmpHome: string;
let proc: ChildProcess | null;
let stdout = '';
let stderr = '';

function startSupervisor(agentId: string, command: string, args: string[] = []): ChildProcess {
  proc = spawn(process.execPath, [SUPERVISOR_ENTRY, command, ...args], {
    env: {
      ...process.env,
      PANOPTICON_HOME: tmpHome,
      PANOPTICON_AGENT_ID: agentId,
      TERM: 'xterm-256color',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  proc.stdout?.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
  });
  proc.stderr?.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });
  return proc;
}

async function waitForProcessOutput(predicate: () => boolean, message: string, timeoutMs = 5_000): Promise<void> {
  if (predicate()) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      proc?.stdout?.off('data', check);
      proc?.stderr?.off('data', check);
    };
    const check = () => {
      if (!predicate()) return;
      cleanup();
      resolve();
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`${message}. stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`));
    }, timeoutMs);
    proc?.stdout?.on('data', check);
    proc?.stderr?.on('data', check);
  });
}

async function waitForSocketPath(socketPath: string, predicate: () => boolean, message: string): Promise<void> {
  const socketsDir = join(socketPath, '..');
  mkdirSync(socketsDir, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 5_000;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!predicate()) throw new Error(`${message}. stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`);
}

async function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function postToUnixSocket(
  socketPath: string,
  token: string | null,
  body: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = httpRequest(
      {
        socketPath,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(token ? { [PTY_TOKEN_HEADER]: token } : {}),
        },
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: responseBody });
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function readySupervisor(agentId: string, command = 'cat', args: string[] = []): Promise<{ token: string; socketPath: string }> {
  const token = await writePtyToken(agentId);
  startSupervisor(agentId, command, args);
  const socketPath = join(tmpHome, 'sockets', `pty-${agentId}.sock`);
  await waitForSocketPath(socketPath, () => {
    try {
      return (statSync(socketPath).mode & 0o777) === 0o600;
    } catch {
      return false;
    }
  }, 'supervisor socket was not created with mode 0600');
  return { token, socketPath };
}

function createFakePty(): { child: pty.IPty; writes: string[]; emit: (data: string) => void } {
  const listeners = new Set<(data: string) => void>();
  const writes: string[] = [];
  return {
    writes,
    emit: (data: string) => {
      for (const listener of listeners) listener(data);
    },
    child: {
      write: (data: string) => writes.push(data),
      onData: (listener: (data: string) => void) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    } as unknown as pty.IPty,
  };
}

afterEach(async () => {
  vi.useRealTimers();
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
    await waitForExit(proc);
  }
  proc = null;
  rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'pan-pty-supervisor-'));
  process.env.PANOPTICON_HOME = tmpHome;
  stdout = '';
  stderr = '';
  proc = null;
});

describe.skipIf(isBun)('injectPtyMessage', () => {
  it('waits for a normalized child PTY echo before sending Enter', async () => {
    vi.useFakeTimers();
    const fake = createFakePty();

    const delivered = injectPtyMessage(fake.child, 'agent-unit-confirm', { content: 'hello   world', echo: false });
    expect(fake.writes).toEqual(['hello   world']);
    fake.emit('[32mhello world[0m');
    await vi.advanceTimersByTimeAsync(400);

    await expect(delivered).resolves.toBeUndefined();
    expect(fake.writes).toEqual(['hello   world', '\r']);
  });

  it('retries content once and rejects without Enter when the child PTY never echoes input', async () => {
    vi.useFakeTimers();
    const fake = createFakePty();

    const delivered = injectPtyMessage(fake.child, 'agent-unit-miss', { content: 'missing echo', echo: false });
    const rejected = expect(delivered).rejects.toThrow(/input echo confirmation failed/);
    expect(fake.writes).toEqual(['missing echo']);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(fake.writes).toEqual(['missing echo', 'missing echo']);
    await vi.advanceTimersByTimeAsync(1_500);

    await rejected;
    expect(fake.writes).toEqual(['missing echo', 'missing echo']);
  });

  it('returns non-2xx from the supervisor server when echo confirmation fails', async () => {
    vi.useFakeTimers();
    const agentId = 'agent-server-no-confirm';
    const token = await writePtyToken(agentId);
    const fake = createFakePty();
    const server = createPtySupervisorServer(agentId, fake.child);
    const socketPath = join(tmpHome, 'sockets', `pty-${agentId}.sock`);
    mkdirSync(join(tmpHome, 'sockets'), { recursive: true, mode: 0o700 });
    await new Promise<void>((resolve) => server.listen(socketPath, () => resolve()));

    try {
      const posted = postToUnixSocket(socketPath, token, { content: 'never echoed', echo: false });
      await vi.waitFor(() => expect(fake.writes).toEqual(['never echoed']));
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(posted).resolves.toMatchObject({ status: 502 });
      expect(fake.writes).toEqual(['never echoed', 'never echoed']);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe.skipIf(isBun)('pty-supervisor subprocess', () => {
  it('sends socket POST content to the child PTY stdin', async () => {
    const { token, socketPath } = await readySupervisor('agent-stdin');

    const result = await postToUnixSocket(socketPath, token, { content: 'ping', echo: false });

    expect(result.status).toBe(200);
    await waitForProcessOutput(() => stdout.includes('ping'), 'child did not echo posted content');
  });

  it('rejects Unix socket posts without a matching token', async () => {
    const { socketPath } = await readySupervisor('agent-auth');

    const result = await postToUnixSocket(socketPath, 'wrong-token', { content: 'nope' });

    expect(result.status).toBe(403);
    expect(result.body).toContain('forbidden');
    expect(stdout).not.toContain('nope');
  });

  it('unlinks the socket on SIGTERM', async () => {
    const { socketPath } = await readySupervisor('agent-cleanup');

    proc?.kill('SIGTERM');
    const exit = proc ? await waitForExit(proc) : null;
    proc = null;

    expect(exit?.code === 0 || exit?.signal === 'SIGTERM').toBe(true);
    await waitForSocketPath(socketPath, () => !existsSync(socketPath), 'supervisor socket was not unlinked');
  });

  it('confirms child PTY output before Enter and echoes a socket-delivered message to stdout exactly once', async () => {
    const { token, socketPath } = await readySupervisor('agent-echo', 'bash', [
      '-lc',
      'stty raw -echo; printf READY; dd bs=1 count=40 2>/dev/null; sleep 30',
    ]);
    await waitForProcessOutput(() => stdout.includes('READY'), 'child did not enter raw echo mode');
    stdout = '';
    const content = `echo-once-${'x'.repeat(80)}`;

    const result = await postToUnixSocket(socketPath, token, { content });

    expect(result.status).toBe(200);
    await waitForProcessOutput(() => stdout.includes(content), 'supervisor did not echo posted content');
    expect(stdout.match(new RegExp(content, 'g'))).toHaveLength(1);
    const logPath = join(tmpHome, 'logs', 'pty-supervisor-agent-echo.log');
    expect(readFileSync(logPath, 'utf8')).toContain('"kind":"socket_write"');
  });

  it('returns non-2xx after one retry when child PTY output never reflects the input', async () => {
    const content = `swallowed-${'x'.repeat(32)}`;
    const byteCount = Buffer.byteLength(content, 'utf8') * 2;
    const { token, socketPath } = await readySupervisor('agent-no-echo', 'bash', [
      '-lc',
      `stty raw -echo; printf READY; dd bs=1 count=${byteCount} of=/dev/null 2>/dev/null; printf READ_TWO; sleep 30`,
    ]);
    await waitForProcessOutput(() => stdout.includes('READY'), 'child did not enter raw no-echo mode');
    stdout = '';
    const started = Date.now();

    const result = await postToUnixSocket(socketPath, token, { content, echo: false });

    expect(result.status).toBe(502);
    expect(result.body).toContain('input echo confirmation failed');
    expect(Date.now() - started).toBeLessThan(6_000);
    await waitForProcessOutput(() => stdout.includes('READ_TWO'), 'child did not consume both supervisor write attempts');
    expect(stdout).not.toContain(content);
    const logPath = join(tmpHome, 'logs', 'pty-supervisor-agent-no-echo.log');
    expect(existsSync(logPath)).toBe(false);
  }, 10_000);

  it('creates the supervisor socket at mode 0600', async () => {
    const { socketPath } = await readySupervisor('agent-mode');

    expect(statSync(socketPath).mode & 0o777).toBe(0o600);
  });
});
