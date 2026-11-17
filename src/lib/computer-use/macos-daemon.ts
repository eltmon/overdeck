/**
 * Client for the macOS computer-use helper daemon (PAN-5463, PRD WI-3,
 * D-3 to D-6, D-16, D-17).
 *
 * One helper daemon per user serves every `pan computer` process. It listens
 * on `/tmp/overdeck-cu-<uid>/agent.sock` and speaks newline-delimited JSON:
 * request `{id, method, params, token}`, response `{id, ok:true, result}` or
 * `{id, ok:false, error:{code, message}}`. The token lives in
 * `~/.overdeck/computer-use/macos/agent.token` (mode 0600) and is created
 * once; the helper reads it at launch.
 *
 * `connectOrLaunch` connects, or launches the installed helper through
 * LaunchServices (`open -n -g -a`) so macOS checks the helper's own
 * permissions, then retries for up to 10 s. Call it only while holding the
 * desktop lock (D-17), so two CLI processes never launch the helper at once.
 *
 * The socket is unref'd: a pending request's timer keeps the process alive,
 * an idle connection never does. Child processes run through async execFile
 * only (NFR-1).
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ComputerUseError } from './errors.js';
import { installedHelperDir, installedHelperPath, type MacosExecFileFn } from './macos-install.js';

const execFileAsync = promisify(execFile);

const OPEN = '/usr/bin/open';
export const LAUNCH_TIMEOUT_MS = 10_000;
const LAUNCH_RETRY_MS = 100;
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const SETUP_HINT = 'Finish setup in Settings → Computer Use.';

export interface DaemonToken {
  token: string;
  path: string;
}

interface PathStat {
  uid: number;
  isDirectory(): boolean;
  isSocket(): boolean;
}

export interface MacosDaemonDeps {
  getuid?: () => number;
  mkdir?: (path: string, options: { recursive?: boolean; mode: number }) => Promise<unknown>;
  lstat?: (path: string) => Promise<PathStat>;
  unlink?: (path: string) => Promise<void>;
  readFile?: (path: string, encoding: 'utf8') => Promise<string>;
  writeFile?: (path: string, data: string, options: { mode: number; flag: 'wx' }) => Promise<void>;
  randomBytes?: (size: number) => Buffer;
  execFile?: MacosExecFileFn;
  connect?: (path: string) => Promise<Socket>;
  /** Overrides the D-6 socket path (tests). */
  socketPath?: () => Promise<string>;
  /** Overrides the token file (tests). */
  ensureToken?: () => Promise<DaemonToken>;
  helperAppPath?: () => string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

function getuidOrThrow(): number {
  if (typeof process.getuid !== 'function') {
    throw new ComputerUseError('unsupported_platform', 'The macOS computer-use helper needs a POSIX user id.');
  }
  return process.getuid();
}

/**
 * `/tmp/overdeck-cu-<uid>/agent.sock` (D-6). `/tmp` instead of os.tmpdir():
 * TMPDIR differs between the dashboard and agent sessions, and long paths pass
 * the 104-byte Unix socket limit. The directory is created 0700; one that
 * exists but belongs to another user is refused.
 */
export async function socketPath(deps: MacosDaemonDeps = {}): Promise<string> {
  const uid = (deps.getuid ?? getuidOrThrow)();
  const dir = `/tmp/overdeck-cu-${uid}`;
  try {
    await (deps.mkdir ?? ((path, options) => mkdir(path, options)))(dir, { mode: 0o700 });
  } catch (error) {
    if (errnoCode(error) !== 'EEXIST') throw error;
  }
  const info = await (deps.lstat ?? lstat)(dir);
  if (!info.isDirectory() || info.uid !== uid) {
    throw new ComputerUseError('helper_error', `refusing ${dir}: owned by another user`);
  }
  return join(dir, 'agent.sock');
}

/** The agent token (32 random bytes, hex), created once with mode 0600 and reused (D-5). */
export async function ensureToken(deps: MacosDaemonDeps = {}): Promise<DaemonToken> {
  const path = join(installedHelperDir(), 'agent.token');
  const read = deps.readFile ?? ((p: string, encoding: 'utf8') => readFile(p, encoding));
  const readToken = async (): Promise<string | null> => {
    try {
      const token = (await read(path, 'utf8')).trim();
      return token.length > 0 ? token : null;
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') return null;
      throw error;
    }
  };

  const existing = await readToken();
  if (existing) return { token: existing, path };

  await (deps.mkdir ?? ((p, options) => mkdir(p, options)))(installedHelperDir(), { recursive: true, mode: 0o700 });
  const token = (deps.randomBytes ?? randomBytes)(32).toString('hex');
  try {
    await (deps.writeFile ?? ((p, data, options) => writeFile(p, data, options)))(path, `${token}\n`, { mode: 0o600, flag: 'wx' });
    return { token, path };
  } catch (error) {
    if (errnoCode(error) !== 'EEXIST') throw error;
    // Another process created it first; use theirs.
    const raced = await readToken();
    if (!raced) throw new ComputerUseError('helper_error', `${path} exists but is empty`);
    return { token: raced, path };
  }
}

function connectSocket(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    const onError = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.once('error', onError);
    socket.once('connect', () => {
      socket.off('error', onError);
      resolve(socket);
    });
  });
}

/** D-16: the helper's error codes, as pan computer error codes. */
export function mapHelperError(code: unknown, message: unknown): ComputerUseError {
  const text = typeof message === 'string' && message.length > 0 ? message : 'the macOS helper reported an error';
  if (code === 'permission_denied') return new ComputerUseError('permission_denied', `${text} ${SETUP_HINT}`);
  if (code === 'invalid_argument') return new ComputerUseError('invalid_argument', text);
  if (code === 'element_not_found') return new ComputerUseError('element_not_found', text);
  return new ComputerUseError('helper_error', `${typeof code === 'string' ? code : 'unknown'}: ${text}`);
}

interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** One NDJSON connection to the daemon. */
export class DaemonConnection {
  private nextId = 1;
  private buffer = '';
  private readonly pending = new Map<number, Pending>();
  private closed = false;

  constructor(
    private readonly socket: Socket,
    private readonly token: string,
    private readonly onClose: () => void = () => {},
  ) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.onData(chunk));
    socket.on('error', () => {
      // 'close' always follows and fails the pending requests.
    });
    socket.on('close', () => this.fail(new ComputerUseError('helper_error', 'the macOS helper closed the connection')));
    socket.unref();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new ComputerUseError('helper_error', 'the macOS helper connection is closed'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ComputerUseError('helper_timeout', `pan computer: the macOS helper did not answer ${method} within ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ id, method, params, token: this.token })}\n`);
    });
  }

  close(): void {
    this.socket.destroy();
    this.fail(new ComputerUseError('helper_error', 'the macOS helper connection is closed'));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > 0) this.onLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private onLine(line: string): void {
    let message: { id?: unknown; ok?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return;
    }
    const pending = typeof message.id === 'number' ? this.pending.get(message.id) : undefined;
    if (!pending) return;
    this.pending.delete(message.id as number);
    clearTimeout(pending.timer);
    if (message.ok === true) pending.resolve(message.result);
    else pending.reject(mapHelperError(message.error?.code, message.error?.message));
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.onClose();
  }
}

/** Connects to the daemon, launching the installed helper when nothing listens (D-4, D-17). */
export async function connectOrLaunch(deps: MacosDaemonDeps = {}, onClose?: () => void): Promise<DaemonConnection> {
  const path = await (deps.socketPath ?? (() => socketPath(deps)))();
  const { token, path: tokenPath } = await (deps.ensureToken ?? (() => ensureToken(deps)))();
  const connect = deps.connect ?? connectSocket;

  try {
    return new DaemonConnection(await connect(path), token, onClose);
  } catch (error) {
    const code = errnoCode(error);
    if (code === 'ECONNREFUSED') {
      // A crashed daemon left its socket file; the helper's bind would fail on it.
      const info = await (deps.lstat ?? lstat)(path).catch(() => null);
      if (info?.isSocket()) await (deps.unlink ?? unlink)(path);
    } else if (code !== 'ENOENT') {
      throw new ComputerUseError('helper_error', `cannot connect to the macOS helper at ${path}: ${(error as Error).message}`);
    }
  }

  const exec: MacosExecFileFn = deps.execFile ?? ((file, args, options) => execFileAsync(file, args, options ?? {}));
  const app = (deps.helperAppPath ?? installedHelperPath)();
  try {
    await exec(OPEN, ['-n', '-g', '-a', app, '--args', '--agent', path, '--token-file', tokenPath], { timeout: LAUNCH_TIMEOUT_MS });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    throw new ComputerUseError('helper_error', `could not launch ${app}: ${stderr.trim() || (error as Error).message}. ${SETUP_HINT}`);
  }

  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const deadline = now() + LAUNCH_TIMEOUT_MS;
  for (;;) {
    await sleep(LAUNCH_RETRY_MS);
    try {
      return new DaemonConnection(await connect(path), token, onClose);
    } catch {
      if (now() >= deadline) {
        throw new ComputerUseError('helper_timeout', `pan computer: the macOS helper did not start listening within ${LAUNCH_TIMEOUT_MS}ms. ${SETUP_HINT}`);
      }
    }
  }
}

let current: Promise<DaemonConnection> | null = null;

/**
 * Sends one request on this process's daemon connection, connecting or
 * launching first if needed. Rejects with the mapped ComputerUseError on
 * `ok:false` (D-16) and with helper_timeout after `timeoutMs`.
 */
export async function request(
  method: string,
  params: Record<string, unknown> = {},
  options: { timeoutMs?: number } = {},
  deps: MacosDaemonDeps = {},
): Promise<unknown> {
  if (!current) {
    const attempt = connectOrLaunch(deps, () => {
      if (current === attempt) current = null;
    });
    current = attempt;
    attempt.catch(() => {
      if (current === attempt) current = null;
    });
  }
  const connection = await current;
  return connection.request(method, params, options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
}

/** Closes this process's daemon connection (the daemon keeps running). */
export async function closeDaemonConnection(): Promise<void> {
  const pending = current;
  current = null;
  if (!pending) return;
  try {
    (await pending).close();
  } catch {
    // The connect attempt failed; nothing to close.
  }
}
