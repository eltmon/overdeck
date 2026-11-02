/**
 * Two peer dashboards on one host for the AC-1 two-machine test (PAN-4774 WI-3).
 *
 * A TypeScript port of the two-machine smoke's server helpers
 * (`scripts/anywhere/two-machine-smoke.mjs`): each machine gets a short temp
 * home (`/tmp/odk-a-*`, `/tmp/odk-b-*`, so the PTY socket path stays under the
 * 107-byte Unix limit), a fake HOME and PATH holding the fake `claude`, its own
 * tmux server, and a free port. B is reached through a byte-logging TCP proxy so
 * the test can measure what crossed the link.
 *
 * Preconditions throw instead of skipping: a missing build or tmux is a broken
 * CI image, never a reason for the test to pass silently.
 */
import { execFile, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, rmSync } from 'node:fs';
import { connect, createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { installFakeClaude } from './fake-claude.js';

const execFileAsync = promisify(execFile);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const SERVER_PATH = join(REPO, 'dist', 'dashboard', 'server.js');
const CLI_PATH = join(REPO, 'dist', 'cli', 'index.js');

export type MachineName = 'a' | 'b';

export interface ServerEnvOptions {
  machine: MachineName;
  home: string;
  port: number;
  pid?: number;
}

/** Inherited keys that would point a test server or CLI at the operator's dashboard or real CLIs. */
const SCRUBBED_KEYS = ['OVERDECK_INTERNAL_TOKEN', 'OVERDECK_AGENT_ID', 'OVERDECK_DASHBOARD_SPAWNED_BY', 'DASHBOARD_URL', 'HOST', 'SHELL', 'NODE_ENV'];

/**
 * The environment of one test dashboard and of `pan` run against it. HOST stays
 * unset (0.0.0.0) so B's reverse link reaches A's advertised private address; no
 * SHELL, because the harness-binary resolver's last fallback is `$SHELL -lc` and
 * would find the operator's real CLIs.
 */
export function buildServerEnv(base: NodeJS.ProcessEnv, opts: ServerEnvOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of Object.keys(env)) {
    if (SCRUBBED_KEYS.includes(key) || key.startsWith('VITEST')) delete env[key];
  }
  const url = `http://127.0.0.1:${opts.port}`;
  return {
    ...env,
    HOME: join(opts.home, 'fakehome'),
    PATH: `${join(opts.home, 'bin')}:/usr/local/bin:/usr/bin:/bin`,
    OVERDECK_HOME: opts.home,
    API_PORT: String(opts.port),
    PORT: String(opts.port),
    OVERDECK_DASHBOARD_URL: url,
    DASHBOARD_URL: url,
    OVERDECK_TERMINAL_BACKEND: 'tmux',
    OVERDECK_TMUX_SOCKET_NAME: tmuxSocketName(opts.machine, opts.pid ?? process.pid),
    // A peer-mode dashboard: no Deacon, no resume; the link supervisor is opted back in.
    OVERDECK_DISABLE_DEACON: '1',
    OVERDECK_ANYWHERE_SUPERVISOR: '1',
    OVERDECK_NO_RESUME: '1',
    // On one host A's saved cwd for a pulled conversation always exists; adopt by git origin instead.
    ...(opts.machine === 'a' ? { OVERDECK_TEST_ADOPT_SKIP_SAVED_CWD: '1' } : {}),
  };
}

function tmuxSocketName(machine: MachineName, pid: number): string {
  return `odk-${machine}-${pid}`;
}

/** Where tmux puts a `-L` socket; kill-server can leave the file behind. */
function tmuxSocketPath(socket: string): string {
  return join(process.env['TMUX_TMPDIR'] || '/tmp', `tmux-${process.getuid?.() ?? 0}`, socket);
}

export function assertPreconditions(input: { serverPath: string; hasTmux: boolean }): void {
  if (!existsSync(input.serverPath)) throw new Error('dist/dashboard/server.js is missing; run npm run build');
  if (!input.hasTmux) throw new Error('tmux is not installed; install tmux');
}

/** Remove a test home; refuses anything that is not `<os.tmpdir()>/odk-*`. */
export function removeTestHome(path: string): void {
  const target = resolve(path);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('odk-')) {
    throw new Error(`refusing to remove ${path}: not an odk- test home directly under ${tmpdir()}`);
  }
  rmSync(target, { recursive: true, force: true });
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export async function pollUntil<T>(description: string, timeoutMs: number, probe: () => Promise<{ ok: true; value: T } | { ok: false; detail?: string }>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let detail = 'no answer';
  while (Date.now() < deadline) {
    const last = await probe();
    if (last.ok) return last.value;
    detail = last.detail ?? detail;
    await sleep(500);
  }
  throw new Error(`${description} not reached within ${timeoutMs / 1000} s (last: ${detail})`);
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.on('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => done(port));
    });
  });
}

/**
 * The dashboard prepends dirname(process.execPath) to PATH. When Node comes from
 * an nvm or npm-global bin directory, that directory also holds the operator's
 * real claude and codex, which would outrank the fake. A link to the Node binary
 * in an otherwise empty directory keeps them out of reach.
 */
function isolatedNode(): { root: string; node: string } {
  const root = mkdtempSync(join(tmpdir(), 'odk-node-'));
  const node = join(root, 'node');
  try {
    linkSync(process.execPath, node);
  } catch {
    copyFileSync(process.execPath, node);
    chmodSync(node, 0o755);
  }
  return { root, node };
}

export interface Machine {
  name: MachineName;
  home: string;
  fakeHome: string;
  port: number;
  url: string;
  env: NodeJS.ProcessEnv;
  inputLog: string;
  tmuxSocket: string;
  child: ChildProcess;
}

export interface Proxy {
  port: number;
  /** Bytes B sent back through the proxy. */
  fromB: { bytes: number };
  /** Every chunk in both directions, in order. */
  capture: Buffer[];
  close(): Promise<void>;
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ApiResult {
  status: number;
  json: unknown;
}

export interface Pair {
  a: Machine;
  b: Machine;
  proxy: Proxy;
  cli(name: MachineName, args: string[], timeoutMs?: number): Promise<CliResult>;
  cliJson<T = Record<string, unknown>>(name: MachineName, args: string[], timeoutMs?: number): Promise<T>;
  api(name: MachineName, method: string, path: string, body?: unknown): Promise<ApiResult>;
  stop(): Promise<void>;
}

/** A byte-logging TCP proxy in front of `targetPort`. */
export function startProxy(targetPort: number): Promise<Proxy> {
  const capture: Buffer[] = [];
  const fromB = { bytes: 0 };
  const sockets = new Set<Socket>();
  return new Promise((done, fail) => {
    const server: Server = createServer((client) => {
      const upstream = connect({ host: '127.0.0.1', port: targetPort });
      sockets.add(client);
      sockets.add(upstream);
      const drop = () => {
        client.destroy();
        upstream.destroy();
        sockets.delete(client);
        sockets.delete(upstream);
      };
      client.on('data', (chunk: Buffer) => {
        capture.push(chunk);
        upstream.write(chunk);
      });
      upstream.on('data', (chunk: Buffer) => {
        capture.push(chunk);
        fromB.bytes += chunk.length;
        client.write(chunk);
      });
      client.on('error', drop).on('close', drop);
      upstream.on('error', drop).on('close', drop);
    });
    server.on('error', fail);
    server.listen(0, '127.0.0.1', () => {
      done({
        port: (server.address() as AddressInfo).port,
        fromB,
        capture,
        close: () => new Promise<void>((closed) => {
          for (const socket of sockets) socket.destroy();
          sockets.clear();
          server.close(() => closed());
        }),
      });
    });
  });
}

function startServer(name: MachineName, home: string, port: number, node: string): Machine {
  const fakeHome = join(home, 'fakehome');
  mkdirSync(fakeHome, { recursive: true });
  const { inputLog } = installFakeClaude(home, node);
  const env = buildServerEnv(process.env, { machine: name, home, port });
  const logFd = openSync(join(home, 'server.log'), 'a');
  const child = spawn(node, [SERVER_PATH], { env, stdio: ['ignore', logFd, logFd] });
  closeSync(logFd);
  return { name, home, fakeHome, port, url: `http://127.0.0.1:${port}`, env, inputLog, tmuxSocket: tmuxSocketName(name, process.pid), child };
}

async function waitListening(machine: Machine, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (machine.child.exitCode !== null || machine.child.signalCode !== null) {
      throw new Error(`server ${machine.name} exited before listening; see ${machine.home}/server.log`);
    }
    try {
      const response = await fetch(`${machine.url}/api/environment`, { signal: AbortSignal.timeout(1000) });
      if (response.status < 500) return;
    } catch {
      // not listening yet
    }
    await sleep(250);
  }
  throw new Error(`server ${machine.name} did not answer on :${machine.port} within ${timeoutMs} ms; see ${machine.home}/server.log`);
}

async function stopServer(machine: Machine): Promise<void> {
  const { child } = machine;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((done) => child.once('exit', done));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  await exited;
  clearTimeout(timer);
}

/** Stop every conversation this machine owns through its stop route; a dead server is fine. */
async function stopLocalConversations(machine: Machine): Promise<void> {
  if (machine.child.exitCode !== null || machine.child.signalCode !== null) return;
  try {
    const listed = await fetch(`${machine.url}/api/conversations`, { signal: AbortSignal.timeout(5000) });
    const rows = (await listed.json()) as Array<{ name?: unknown }>;
    const names = rows.map((row) => row.name).filter((name): name is string => typeof name === 'string' && !name.startsWith('@'));
    await Promise.all(names.map((name) => fetch(`${machine.url}/api/conversations/${encodeURIComponent(name)}/stop`, {
      method: 'POST',
      headers: { origin: machine.url },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined)));
  } catch {
    // the pkill backstop in stop() still ends any harness left behind
  }
}

function hasTmux(): boolean {
  return spawnSync('tmux', ['-V'], { stdio: 'ignore' }).status === 0;
}

/** Start A and B, each on its own home, port and tmux server, with a proxy in front of B. */
export async function startPair(): Promise<Pair> {
  assertPreconditions({ serverPath: SERVER_PATH, hasTmux: hasTmux() });
  const nodeDir = isolatedNode();
  const homes = { a: mkdtempSync(join(tmpdir(), 'odk-a-')), b: mkdtempSync(join(tmpdir(), 'odk-b-')) };
  const [portA, portB] = [await freePort(), await freePort()];
  const machines = { a: startServer('a', homes.a, portA, nodeDir.node), b: startServer('b', homes.b, portB, nodeDir.node) };
  let proxy: Proxy | null = null;

  const stop = async () => {
    // A conversation's launcher runs in its own session, so killing tmux does not end it.
    await Promise.all([machines.a, machines.b].map(stopLocalConversations));
    await Promise.all([stopServer(machines.a), stopServer(machines.b)]);
    await Promise.all([machines.a, machines.b].map((m) => execFileAsync('tmux', ['-L', m.tmuxSocket, 'kill-server']).catch(() => undefined)));
    for (const m of [machines.a, machines.b]) rmSync(tmuxSocketPath(m.tmuxSocket), { force: true });
    // Backstop for a failed stop route: every harness process names its unique temp home.
    await Promise.all([homes.a, homes.b].map((home) => execFileAsync('pkill', ['-KILL', '-f', home]).catch(() => undefined)));
    await proxy?.close();
    for (const path of [homes.a, homes.b, nodeDir.root]) removeTestHome(path);
  };

  try {
    await Promise.all([waitListening(machines.a, 90_000), waitListening(machines.b, 90_000)]);
    proxy = await startProxy(portB);
  } catch (error) {
    await stop();
    throw error;
  }

  const cli = async (name: MachineName, args: string[], timeoutMs = 60_000): Promise<CliResult> => {
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, ...args], { env: machines[name].env, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
      return { code: 0, stdout, stderr };
    } catch (error) {
      const failed = error as { code?: number; stdout?: string; stderr?: string; message: string };
      return { code: typeof failed.code === 'number' ? failed.code : 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? failed.message };
    }
  };

  const cliJson = async <T,>(name: MachineName, args: string[], timeoutMs?: number): Promise<T> => {
    const result = await cli(name, args, timeoutMs);
    const line = result.stdout.trim().split('\n').filter((candidate) => candidate.startsWith('{') || candidate.startsWith('[')).pop();
    if (result.code !== 0 || !line) {
      throw new Error(`pan ${args.join(' ')} on ${name} exited ${result.code} without JSON:\n${result.stdout}\n${result.stderr}`);
    }
    return JSON.parse(line) as T;
  };

  const api = async (name: MachineName, method: string, path: string, body?: unknown): Promise<ApiResult> => {
    const machine = machines[name];
    const tokenFile = join(machine.home, 'internal-token');
    const headers: Record<string, string> = { origin: machine.url };
    if (existsSync(tokenFile)) headers['x-overdeck-internal-token'] = readFileSync(tokenFile, 'utf8').trim();
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${machine.url}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: response.status, json };
  };

  return { a: machines.a, b: machines.b, proxy: proxy, cli, cliJson, api, stop };
}
