import type * as pty from '@lydell/node-pty';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PTY_TOKEN_HEADER, writePtyToken } from '../../pty-token.js';
import { createPtySupervisorServer, createSocketWriteLogQueue, injectPtyMessage } from '../pty-supervisor.js';
import {
  INPUT_PURGE_MAX_CHARS,
  INPUT_SUBMIT_CONFIRM_INTERVAL_MS,
  echoConfirmTimeoutMs,
  purgeSettleMs,
} from '../injection-budget.js';

const REPO_ROOT = process.cwd();
const SUPERVISOR_ENTRY = join(REPO_ROOT, 'dist/pty-supervisor.js');
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

let tmpHome: string;
let proc: ChildProcess | null;
let stdout = '';
let stderr = '';

describe('socket write log queue', () => {
  it('bounds stalled logging and retains metadata instead of full payloads', async () => {
    const stalledWrite = vi.fn(() => new Promise<void>(() => undefined));
    const queue = createSocketWriteLogQueue(stalledWrite, 2);
    const payload = { content: 'x'.repeat(INPUT_PURGE_MAX_CHARS), caller: 'queue-test' };

    expect(queue.enqueue('agent-one', payload)).toBe(true);
    expect(queue.enqueue('agent-two', payload)).toBe(true);
    expect(queue.enqueue('agent-three', payload)).toBe(false);
    await Promise.resolve();

    expect(stalledWrite).toHaveBeenCalledOnce();
    expect(stalledWrite).toHaveBeenCalledWith({
      agentId: 'agent-one',
      contentLength: INPUT_PURGE_MAX_CHARS,
      caller: 'queue-test',
    });
    expect(stalledWrite.mock.calls[0]?.[0]).not.toHaveProperty('content');
  });
});

function startSupervisor(agentId: string, command: string, args: string[] = []): ChildProcess {
  proc = spawn(process.execPath, [SUPERVISOR_ENTRY, command, ...args], {
    env: {
      ...process.env,
      OVERDECK_HOME: tmpHome,
      OVERDECK_AGENT_ID: agentId,
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
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }

  return new Promise((resolve) => {
    const forceKill = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }, 2_000);
    child.once('exit', (code, signal) => {
      clearTimeout(forceKill);
      resolve({ code, signal });
    });
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
  process.env.OVERDECK_HOME = tmpHome;
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

  it('retries Enter when the payload remains in the active composer', async () => {
    vi.useFakeTimers();
    const fake = createFakePty();
    const readPayloadPresence = vi.fn()
      .mockResolvedValueOnce('present')
      .mockResolvedValueOnce('absent');

    const delivered = injectPtyMessage(
      fake.child,
      'agent-unit-submit-retry',
      { content: 'retry dropped Enter', echo: false },
      { readPayloadPresence },
    );
    fake.emit('retry dropped Enter');
    await vi.advanceTimersByTimeAsync(400);
    expect(fake.writes).toEqual(['retry dropped Enter', '\r']);

    await vi.advanceTimersByTimeAsync(INPUT_SUBMIT_CONFIRM_INTERVAL_MS);
    expect(fake.writes).toEqual(['retry dropped Enter', '\r', '\r']);
    await vi.advanceTimersByTimeAsync(INPUT_SUBMIT_CONFIRM_INTERVAL_MS);

    await expect(delivered).resolves.toBeUndefined();
    expect(readPayloadPresence).toHaveBeenCalledTimes(2);
  });

  it('purges a payload that survives every Enter before allowing fallback', async () => {
    vi.useFakeTimers();
    const fake = createFakePty();
    const content = 'persistently stranded payload';
    const purge = '\x7f'.repeat(content.length + 8);

    const delivered = injectPtyMessage(
      fake.child,
      'agent-unit-submit-failed',
      { content, echo: false },
      { readPayloadPresence: () => Promise.resolve('present') },
    );
    const rejected = expect(delivered).rejects.toThrow(/submit confirmation failed/);
    fake.emit(content);
    await vi.advanceTimersByTimeAsync(
      400 + (2 * INPUT_SUBMIT_CONFIRM_INTERVAL_MS) + purgeSettleMs(content.length + 8),
    );

    await rejected;
    expect(fake.writes).toEqual([content, '\r', '\r', purge]);
  });

  it('purges between retries and before rejecting so unconfirmed writes never stack', async () => {
    vi.useFakeTimers();
    const fake = createFakePty();
    const content = 'missing echo';
    const purge = '\x7f'.repeat(content.length + 8);

    const delivered = injectPtyMessage(fake.child, 'agent-unit-miss', { content, echo: false });
    const rejected = expect(delivered).rejects.toThrow(/input echo confirmation failed/);
    expect(fake.writes).toEqual([content]);
    // 12 bytes => echoConfirmTimeoutMs = 2600ms; second write lands after purge settle.
    await vi.advanceTimersByTimeAsync(2_800);
    expect(fake.writes).toEqual([content, purge, content]);
    await vi.advanceTimersByTimeAsync(2_800);

    await rejected;
    expect(fake.writes).toEqual([content, purge, content, purge]);
    expect(fake.writes).not.toContain('\r');
  });

  it('confirms a long line whose echo is wrapped mid-word across bordered composer rows', async () => {
    vi.useFakeTimers();
    const fake = createFakePty();
    const content = 'Ok please fix it immediately here on main and verify the result';

    const delivered = injectPtyMessage(fake.child, 'agent-unit-wrap', { content, echo: false });
    fake.emit('│ Ok please fix it immediat │\r\n│ ely here on main and veri │\r\n│ fy the result             │');
    await vi.advanceTimersByTimeAsync(400);

    await expect(delivered).resolves.toBeUndefined();
    expect(fake.writes).toEqual([content, '\r']);
  });

  it('accepts the collapsed paste placeholder as echo confirmation', async () => {
    vi.useFakeTimers();
    const fake = createFakePty();
    const content = 'a long message the TUI collapses instead of echoing verbatim';

    const delivered = injectPtyMessage(fake.child, 'agent-unit-placeholder', { content, echo: false });
    fake.emit('[Pasted text #1 +3 lines]');
    await vi.advanceTimersByTimeAsync(400);

    await expect(delivered).resolves.toBeUndefined();
    expect(fake.writes).toEqual([content, '\r']);
  });

  it('submits exactly one copy when the echo only appears after the purged retry', async () => {
    vi.useFakeTimers();
    const fake = createFakePty();
    const content = 'late echo';
    const purge = '\x7f'.repeat(content.length + 8);

    const delivered = injectPtyMessage(fake.child, 'agent-unit-late', { content, echo: false });
    await vi.advanceTimersByTimeAsync(2_800);
    expect(fake.writes).toEqual([content, purge, content]);
    fake.emit('late echo');
    await vi.advanceTimersByTimeAsync(400);

    await expect(delivered).resolves.toBeUndefined();
    expect(fake.writes).toEqual([content, purge, content, '\r']);
  });

  it('scales the echo-confirm window so a large payload confirms without purging', async () => {
    vi.useFakeTimers();
    const fake = createFakePty();
    // 36 KiB => echoConfirmTimeoutMs = 2500 + 36*100 = 6100ms.
    const content = 'x'.repeat(36 * 1024);
    const echoedPrefix = 'x'.repeat(40);

    const delivered = injectPtyMessage(fake.child, 'agent-unit-large', { content, echo: false });
    expect(fake.writes).toEqual([content]);

    // The old fixed 2.5s window would have purged by now; the scaled window must not.
    await vi.advanceTimersByTimeAsync(2_500);
    expect(fake.writes).toEqual([content]);

    // Echo arrives at t=6s, still inside the 6100ms window.
    fake.emit(echoedPrefix);
    await vi.advanceTimersByTimeAsync(3_500);

    await expect(delivered).resolves.toBeUndefined();
    expect(fake.writes).toEqual([content, '\r']);
  });

  it('keeps the small-message echo timeout near the previous fixed floor', async () => {
    vi.useFakeTimers();
    const fake = createFakePty();
    const content = 'x'.repeat(512);
    const purge = '\x7f'.repeat(content.length + 8);

    const delivered = injectPtyMessage(fake.child, 'agent-unit-small', { content, echo: false });
    const rejected = expect(delivered).rejects.toThrow(/input echo confirmation failed/);
    expect(fake.writes).toEqual([content]);

    // 512 bytes => echoConfirmTimeoutMs = 2500 + 1*100 = 2600ms.
    await vi.advanceTimersByTimeAsync(2_800);
    expect(fake.writes).toEqual([content, purge, content]);
    await vi.advanceTimersByTimeAsync(2_800);

    await rejected;
    expect(fake.writes).toEqual([content, purge, content, purge]);
  });

  it('warns with the computed echo-confirm timeout value', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = createFakePty();
    // 2 KiB => echoConfirmTimeoutMs = 2500 + 2*100 = 2700ms.
    const content = 'x'.repeat(2 * 1024);
    const echoTimeout = echoConfirmTimeoutMs(content.length);
    const settle = purgeSettleMs(content.length + 8);

    const delivered = injectPtyMessage(fake.child, 'agent-unit-warn', { content, echo: false });
    await vi.advanceTimersByTimeAsync(echoTimeout);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`after ${echoTimeout}ms`),
    );

    // Second attempt echo timeout + both purge settles + margin.
    await vi.advanceTimersByTimeAsync(echoTimeout + 2 * settle + 100);
    await expect(delivered).rejects.toThrow(/input echo confirmation failed/);
    warnSpy.mockRestore();
  });

  it('purges the full 30,000-char written length, not the old 8,192-char cap', async () => {
    vi.useFakeTimers();
    const fake = createFakePty();
    const content = 'x'.repeat(30_000);
    const purge = '\x7f'.repeat(30_008);
    const echoTimeout = echoConfirmTimeoutMs(content.length);
    const settle = purgeSettleMs(content.length + 8);

    const delivered = injectPtyMessage(fake.child, 'agent-unit-purge-full', { content, echo: false });
    const rejected = expect(delivered).rejects.toThrow(/input echo confirmation failed/);

    await vi.advanceTimersByTimeAsync(echoTimeout);
    expect(fake.writes).toEqual([content, purge]);

    // Second attempt echo timeout + both purge settles + margin.
    await vi.advanceTimersByTimeAsync(echoTimeout + 2 * settle + 100);
    await rejected;
  });

  it('scales the post-purge settle with the erased length', async () => {
    vi.useFakeTimers();
    const fake = createFakePty();
    const content = 'x'.repeat(30_000);
    const purge = '\x7f'.repeat(30_008);
    const echoTimeout = echoConfirmTimeoutMs(content.length);
    const settle = purgeSettleMs(content.length + 8);

    const delivered = injectPtyMessage(fake.child, 'agent-unit-purge-settle', { content, echo: false });

    await vi.advanceTimersByTimeAsync(echoTimeout + settle - 100);
    expect(fake.writes).toEqual([content, purge]);

    await vi.advanceTimersByTimeAsync(100);
    expect(fake.writes).toEqual([content, purge, content]);

    await vi.runAllTimersAsync();
    await expect(delivered).rejects.toThrow(/input echo confirmation failed/);
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
      const purge = '\x7f'.repeat('never echoed'.length + 8);
      const posted = postToUnixSocket(socketPath, token, { content: 'never echoed', echo: false });
      await vi.waitFor(() => expect(fake.writes).toEqual(['never echoed']));
      await vi.advanceTimersByTimeAsync(6_000);
      await expect(posted).resolves.toMatchObject({ status: 502 });
      expect(fake.writes).toEqual(['never echoed', purge, 'never echoed', purge]);
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
    await vi.waitFor(() => {
      expect(readFileSync(logPath, 'utf8')).toContain('"kind":"socket_write"');
    });
  });

  it('returns non-2xx after one retry when child PTY output never reflects the input', async () => {
    const content = `swallowed-${'x'.repeat(32)}`;
    // Two content writes plus two purge bursts (content length + 8 DELs each).
    const byteCount = Buffer.byteLength(content, 'utf8') * 4 + 16;
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
    expect(Date.now() - started).toBeLessThan(9_000);
    await waitForProcessOutput(() => stdout.includes('READ_TWO'), 'child did not consume both supervisor write attempts and purges');
    expect(stdout).not.toContain(content);
    const logPath = join(tmpHome, 'logs', 'pty-supervisor-agent-no-echo.log');
    expect(readFileSync(logPath, 'utf8')).toContain('"kind":"echo_confirm_failed"');
  }, 15_000);

  it('rejects socket posts whose content exceeds INPUT_PURGE_MAX_CHARS', async () => {
    const agentId = 'agent-server-too-long';
    const token = await writePtyToken(agentId);
    const fake = createFakePty();
    const server = createPtySupervisorServer(agentId, fake.child);
    const socketPath = join(tmpHome, 'sockets', `pty-${agentId}.sock`);
    mkdirSync(join(tmpHome, 'sockets'), { recursive: true, mode: 0o700 });
    await new Promise<void>((resolve) => server.listen(socketPath, () => resolve()));

    try {
      const result = await postToUnixSocket(socketPath, token, {
        content: 'x'.repeat(INPUT_PURGE_MAX_CHARS + 1),
        echo: false,
      });
      expect(result.status).toBe(400);
      expect(fake.writes).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('creates the supervisor socket at mode 0600', async () => {
    const { socketPath } = await readySupervisor('agent-mode');

    expect(statSync(socketPath).mode & 0o777).toBe(0o600);
  });

  it('deduplicates a repeated dedupKey without a second PTY write (PAN-2997)', async () => {
    const agentId = 'agent-dedup-key';
    const content = 'dedup-wake-content';
    const { token, socketPath } = await readySupervisor(agentId, 'cat');

    const first = await postToUnixSocket(socketPath, token, { content, echo: false, dedupKey: 'wake-seq-1' });
    expect(first.status).toBe(200);
    await waitForProcessOutput(() => stdout.includes(content), 'supervisor did not echo posted content');
    // Plain cat echoes both the tty input and its output, so let the first
    // delivery's output fully settle, then require the replay adds nothing.
    await new Promise(r => setTimeout(r, 500));
    const occurrencesAfterFirst = stdout.match(new RegExp(content, 'g'))?.length ?? 0;
    expect(occurrencesAfterFirst).toBeGreaterThan(0);

    // The dashboard-crash replay: same key, same content. The supervisor
    // survived the "crash", so it answers with a dedup, not a second write.
    const second = await postToUnixSocket(socketPath, token, { content, echo: false, dedupKey: 'wake-seq-1' });
    expect(second.status).toBe(200);
    expect(second.body).toContain('deduplicated');
    await new Promise(r => setTimeout(r, 300));
    expect(stdout.match(new RegExp(content, 'g'))).toHaveLength(occurrencesAfterFirst);
  });

  it('coalesces two CONCURRENT same-key injections into a single PTY write (PAN-2997 cycle 7)', async () => {
    const agentId = 'agent-dedup-race';
    const content = 'dedup-race-content';
    // The child echoes its input only after a delay, so the first injection is
    // still awaiting echo confirmation when the second request arrives — the
    // exact interleaving that used to let both pass the dedup check.
    const { token, socketPath } = await readySupervisor(agentId, 'bash', [
      '-lc',
      'stty raw -echo; printf READY; sleep 1; cat',
    ]);
    await waitForProcessOutput(() => stdout.includes('READY'), 'child did not start');
    stdout = '';

    const [first, second] = await Promise.all([
      postToUnixSocket(socketPath, token, { content, echo: false, dedupKey: 'wake-race-1' }),
      postToUnixSocket(socketPath, token, { content, echo: false, dedupKey: 'wake-race-1' }),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // Exactly one request injected; the other coalesced onto it and answered dedup.
    const dedupAnswers = [first.body, second.body].filter(body => body.includes('deduplicated'));
    expect(dedupAnswers).toHaveLength(1);

    // With tty echo disabled and supervisor stdout echo off, ONE injection
    // produces exactly one occurrence of the content (cat's output); a racing
    // second injection would add another.
    await waitForProcessOutput(() => stdout.includes(content), 'injected content did not echo through cat');
    await new Promise(r => setTimeout(r, 300));
    expect(stdout.match(new RegExp(content, 'g'))).toHaveLength(1);
  }, 15_000);

  it('releases the key reservation when the injection fails so a retry can succeed (PAN-2997 cycle 7)', async () => {
    const agentId = 'agent-dedup-release';
    const content = `release-${'y'.repeat(32)}`;
    // The child never echoes — echo confirmation fails after the retry budget
    // and the supervisor answers 502. The reservation must be released: a
    // later same-key request is a fresh attempt, not a false dedup.
    const byteCount = Buffer.byteLength(content, 'utf8') * 4 + 16;
    const { token, socketPath } = await readySupervisor(agentId, 'bash', [
      '-lc',
      `stty raw -echo; printf READY; dd bs=1 count=${byteCount} of=/dev/null 2>/dev/null; sleep 30`,
    ]);
    await waitForProcessOutput(() => stdout.includes('READY'), 'child did not enter raw no-echo mode');

    const first = await postToUnixSocket(socketPath, token, { content, echo: true, dedupKey: 'wake-release-1' });
    expect(first.status).toBe(502);

    const retry = await postToUnixSocket(socketPath, token, { content, echo: true, dedupKey: 'wake-release-1' });
    expect(retry.status).toBe(502);
    expect(retry.body).not.toContain('deduplicated');
  }, 30_000);
});
