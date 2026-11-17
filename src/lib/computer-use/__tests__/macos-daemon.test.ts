import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isComputerUseError } from '../errors.js';
import {
  closeDaemonConnection,
  connectOrLaunch,
  DaemonConnection,
  ensureToken,
  mapHelperError,
  request,
  socketPath,
  type MacosDaemonDeps,
} from '../macos-daemon.js';

type Received = { id: number; method: string; params: Record<string, unknown>; token: string };

/** A fake NDJSON daemon: records every request and answers with `reply`. */
async function startServer(path: string, reply: (request: Received) => Record<string, unknown> | null) {
  const received: Received[] = [];
  let connections = 0;
  const server: Server = createServer((socket) => {
    connections += 1;
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const parsed = JSON.parse(buffer.slice(0, newline)) as Received;
        buffer = buffer.slice(newline + 1);
        received.push(parsed);
        const answer = reply(parsed);
        if (answer) socket.write(`${JSON.stringify({ id: parsed.id, ...answer })}\n`);
        newline = buffer.indexOf('\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return { server, received, connections: () => connections };
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

const TOKEN = { token: 'tok-123', path: '/home/tester/.overdeck/computer-use/macos/agent.token' };

describe('macos-daemon over a real socket (PAN-5463)', () => {
  let dir: string;
  let sock: string;
  let server: Server | null = null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cu-daemon-'));
    sock = join(dir, 'agent.sock');
  });

  afterEach(async () => {
    await closeDaemonConnection();
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
    await rm(dir, { recursive: true, force: true });
  });

  const deps = (): MacosDaemonDeps => ({ socketPath: async () => sock, ensureToken: async () => TOKEN });

  it('sends the token with incrementing ids on one connection and resolves the result (ac1)', async () => {
    const fake = await startServer(sock, (req) => ({ ok: true, result: { method: req.method } }));
    server = fake.server;

    await expect(request('handshake', {}, {}, deps())).resolves.toEqual({ method: 'handshake' });
    await expect(request('listApps', { session: 'h' }, {}, deps())).resolves.toEqual({ method: 'listApps' });

    expect(fake.received).toEqual([
      { id: 1, method: 'handshake', params: {}, token: 'tok-123' },
      { id: 2, method: 'listApps', params: { session: 'h' }, token: 'tok-123' },
    ]);
    expect(fake.connections()).toBe(1);
  });

  it('maps ok:false permission_denied, and other helper codes to helper_error with the code prefix (ac4)', async () => {
    const fake = await startServer(sock, (req) =>
      req.method === 'getAppState'
        ? { ok: false, error: { code: 'permission_denied', message: 'Accessibility permission is required.' } }
        : { ok: false, error: { code: 'app_not_found', message: "no app named 'Nope'" } },
    );
    server = fake.server;
    const connection = await connectOrLaunch(deps());

    const denied = await connection.request('getAppState', {}, 1000).catch((e: unknown) => e);
    expect(isComputerUseError(denied) && denied.code).toBe('permission_denied');
    expect((denied as Error).message).toBe('Accessibility permission is required. Finish setup in Settings → Computer Use.');

    const missing = await connection.request('listWindows', {}, 1000).catch((e: unknown) => e);
    expect(isComputerUseError(missing) && missing.code).toBe('helper_error');
    expect((missing as Error).message).toBe("app_not_found: no app named 'Nope'");
    connection.close();
  });
});

describe('connectOrLaunch launch path (PAN-5463)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A socket stand-in for DaemonConnection; no real I/O. */
  function fakeSocket(): Socket {
    const emitter = new EventEmitter() as EventEmitter & Record<string, unknown>;
    emitter.setEncoding = vi.fn();
    emitter.unref = vi.fn();
    emitter.write = vi.fn();
    emitter.destroy = vi.fn(() => emitter.emit('close'));
    return emitter as unknown as Socket;
  }

  it('unlinks a stale socket on ECONNREFUSED, launches with open -n -g -a, and retries until connected (ac2)', async () => {
    const socket = fakeSocket();
    const connect = vi
      .fn<(path: string) => Promise<Socket>>()
      .mockRejectedValueOnce(errno('ECONNREFUSED'))
      .mockRejectedValueOnce(errno('ENOENT'))
      .mockResolvedValueOnce(socket);
    const lstat = vi.fn(async () => ({ uid: 501, isDirectory: () => false, isSocket: () => true }));
    const unlink = vi.fn(async () => {});
    const execFile = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const sleep = vi.fn(async () => {});

    const connection = await connectOrLaunch({
      socketPath: async () => '/tmp/overdeck-cu-501/agent.sock',
      ensureToken: async () => TOKEN,
      helperAppPath: () => '/home/tester/.overdeck/computer-use/macos/Overdeck Computer Use.app',
      connect,
      lstat,
      unlink,
      execFile,
      sleep,
      now: () => 0,
    });

    expect(unlink).toHaveBeenCalledWith('/tmp/overdeck-cu-501/agent.sock');
    expect(execFile).toHaveBeenCalledWith(
      '/usr/bin/open',
      [
        '-n',
        '-g',
        '-a',
        '/home/tester/.overdeck/computer-use/macos/Overdeck Computer Use.app',
        '--args',
        '--agent',
        '/tmp/overdeck-cu-501/agent.sock',
        '--token-file',
        TOKEN.path,
      ],
      expect.any(Object),
    );
    expect(connect).toHaveBeenCalledTimes(3);
    expect(connection.isClosed).toBe(false);
  });

  it('does not unlink a non-socket file on ECONNREFUSED', async () => {
    const unlink = vi.fn(async () => {});
    await connectOrLaunch({
      socketPath: async () => '/tmp/overdeck-cu-501/agent.sock',
      ensureToken: async () => TOKEN,
      helperAppPath: () => '/app',
      connect: vi.fn<(path: string) => Promise<Socket>>().mockRejectedValueOnce(errno('ECONNREFUSED')).mockResolvedValueOnce(fakeSocket()),
      lstat: async () => ({ uid: 501, isDirectory: () => false, isSocket: () => false }),
      unlink,
      execFile: async () => ({ stdout: '', stderr: '' }),
      sleep: async () => {},
      now: () => 0,
    });
    expect(unlink).not.toHaveBeenCalled();
  });

  it('throws helper_timeout when nothing listens within 10 s (ac3)', async () => {
    vi.useFakeTimers();
    const connect = vi.fn<(path: string) => Promise<Socket>>().mockRejectedValue(errno('ENOENT'));

    const attempt = connectOrLaunch({
      socketPath: async () => '/tmp/overdeck-cu-501/agent.sock',
      ensureToken: async () => TOKEN,
      helperAppPath: () => '/app',
      connect,
      execFile: async () => ({ stdout: '', stderr: '' }),
    }).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(10_200);
    const error = await attempt;

    expect(isComputerUseError(error) && error.code).toBe('helper_timeout');
    expect(connect.mock.calls.length).toBeGreaterThan(90);
  });

  it('fails pending requests when the daemon closes the connection', async () => {
    const socket = fakeSocket();
    const onClose = vi.fn();
    const connection = new DaemonConnection(socket, 'tok', onClose);

    const pending = connection.request('handshake', {}, 5000).catch((e: unknown) => e);
    socket.emit('close');

    const error = await pending;
    expect(isComputerUseError(error) && error.code).toBe('helper_error');
    expect(connection.isClosed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('rejects a request with helper_timeout after its timeout (fake timers)', async () => {
    vi.useFakeTimers();
    const connection = new DaemonConnection(fakeSocket(), 'tok');

    const pending = connection.request('getAppState', {}, 60_000).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);

    const error = await pending;
    expect(isComputerUseError(error) && error.code).toBe('helper_timeout');
  });

  it('refuses a socket dir owned by another user and connects nothing (ac5)', async () => {
    const connect = vi.fn();
    const deps: MacosDaemonDeps = {
      getuid: () => 501,
      mkdir: vi.fn().mockRejectedValue(errno('EEXIST')),
      lstat: async () => ({ uid: 0, isDirectory: () => true, isSocket: () => false }),
      connect,
      ensureToken: async () => TOKEN,
    };

    const direct = await socketPath(deps).catch((e: unknown) => e);
    expect(isComputerUseError(direct) && direct.code).toBe('helper_error');
    expect((direct as Error).message).toBe('refusing /tmp/overdeck-cu-501: owned by another user');

    await expect(connectOrLaunch(deps)).rejects.toThrow('owned by another user');
    expect(connect).not.toHaveBeenCalled();
  });

  it('creates the socket dir 0700 and returns agent.sock inside it', async () => {
    const mkdir = vi.fn(async () => undefined);
    const path = await socketPath({
      getuid: () => 501,
      mkdir,
      lstat: async () => ({ uid: 501, isDirectory: () => true, isSocket: () => false }),
    });
    expect(mkdir).toHaveBeenCalledWith('/tmp/overdeck-cu-501', { mode: 0o700 });
    expect(path).toBe('/tmp/overdeck-cu-501/agent.sock');
  });
});

describe('ensureToken (PAN-5463 D-5)', () => {
  const previousHome = process.env.OVERDECK_HOME;
  beforeEach(() => {
    process.env.OVERDECK_HOME = '/home/tester/.overdeck';
  });
  afterEach(() => {
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
  });

  it('creates a 64-hex-char token with mode 0600 once, then reuses it', async () => {
    const files = new Map<string, string>();
    const deps: MacosDaemonDeps = {
      readFile: async (path) => {
        const value = files.get(path);
        if (value === undefined) throw errno('ENOENT');
        return value;
      },
      writeFile: vi.fn(async (path: string, data: string) => {
        files.set(path, data);
      }),
      mkdir: vi.fn(async () => undefined),
      randomBytes: (size) => Buffer.alloc(size, 0xab),
    };

    const first = await ensureToken(deps);
    const second = await ensureToken(deps);

    expect(first).toEqual({ token: 'ab'.repeat(32), path: '/home/tester/.overdeck/computer-use/macos/agent.token' });
    expect(second).toEqual(first);
    expect(deps.writeFile).toHaveBeenCalledTimes(1);
    expect(deps.writeFile).toHaveBeenCalledWith(first.path, `${'ab'.repeat(32)}\n`, { mode: 0o600, flag: 'wx' });
  });
});

describe('mapHelperError (PAN-5463 D-16)', () => {
  it.each([
    ['invalid_argument', 'invalid_argument', 'bad'],
    ['element_not_found', 'element_not_found', 'bad'],
    ['window_stale', 'helper_error', 'window_stale: bad'],
    ['accessibility_error', 'helper_error', 'accessibility_error: bad'],
  ])('maps %s to %s', (helperCode, code, message) => {
    const error = mapHelperError(helperCode, 'bad');
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
  });
});
