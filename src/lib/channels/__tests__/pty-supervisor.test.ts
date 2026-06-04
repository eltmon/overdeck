import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PTY_TOKEN_HEADER, writePtyToken } from '../../pty-token.js';

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

async function waitForProcessOutput(predicate: () => boolean, message: string): Promise<void> {
  if (predicate()) return;
  await new Promise<void>((resolve) => {
    const check = () => {
      if (!predicate()) return;
      proc?.stdout?.off('data', check);
      proc?.stderr?.off('data', check);
      resolve();
    };
    proc?.stdout?.on('data', check);
    proc?.stderr?.on('data', check);
  });
  if (!predicate()) throw new Error(`${message}. stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`);
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

afterEach(async () => {
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

  it('echoes a socket-delivered message to stdout exactly once when the child is quiet', async () => {
    const { token, socketPath } = await readySupervisor('agent-echo', 'bash', ['-lc', 'stty -echo; printf READY; sleep 30']);
    await waitForProcessOutput(() => stdout.includes('READY'), 'child did not disable TTY echo');
    stdout = '';

    const result = await postToUnixSocket(socketPath, token, { content: 'echo-once' });

    expect(result.status).toBe(200);
    await waitForProcessOutput(() => stdout.includes('echo-once'), 'supervisor did not echo posted content');
    expect(stdout.match(/echo-once/g)).toHaveLength(1);
    const logPath = join(tmpHome, 'logs', 'pty-supervisor-agent-echo.log');
    expect(readFileSync(logPath, 'utf8')).toContain('"kind":"socket_write"');
  });

  it('creates the supervisor socket at mode 0600', async () => {
    const { socketPath } = await readySupervisor('agent-mode');

    expect(statSync(socketPath).mode & 0o777).toBe(0o600);
  });
});
