/**
 * Prime Agent host (PAN-3668 WI-11): the process that runs inside a Prime agent's
 * terminal pane, built to `dist/prime-agent-host.js`.
 *
 * It spawns `prime-agent --mode rpc` as a stdio child, owns it and its private daemon
 * (D2, D3), and serves the same control-socket contract as the ACP host (D4): POST-only
 * HTTP on `$OVERDECK_HOME/sockets/prime-agent-<agentId>.sock`, authenticated by the
 * `x-overdeck-bridge-token` header, with the ops `status`, `message`, `interrupt` and
 * `set-effort`.
 *
 * Startup order matters because readiness (`waitForHostReady`) keys on the files:
 *   1. read the recorded session id (for resume), then clear the ready files;
 *   2. check `prime-agent --version` against compat.ts;
 *   3. reap any supervisor left on the agent's daemon socket;
 *   4. spawn the child with an argv array (D8, D9) in the workspace;
 *   5. wire stdout into the RPC client (dialogs are auto-cancelled, D10);
 *   6. write the token, listen, call get_state;
 *   7. on resume, verify sessionFile and sessionId (D7);
 *   8. write the session-file pointer, then the session id last.
 * Any failure before ready writes `prime-agent-launch-error`, stops the child, reaps
 * the daemon and exits 1. Logs carry event types, ids, paths and exit codes only.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { BRIDGE_TOKEN_HEADER } from '../bridge-token.js';
import { INPUT_PURGE_MAX_CHARS } from '../channels/injection-budget.js';
import { hostLaunchErrorFile, hostSessionIdFile, hostSocketPath, hostTokenFile } from '../runtimes/host-transport.js';
import {
  PRIME_AGENT_STATS_FILE,
  primeAgentDaemonSocketPath,
  primeAgentSessionDir,
  primeAgentSessionFilePointerPath,
} from '../runtimes/storage/prime-agent.js';
import { appendSessionIdToHistory } from '../session-history.js';
import { checkPrimeAgentVersion, readPrimeAgentVersionOutput } from './compat.js';
import { reapPrimeAgentDaemon } from './daemon.js';
import { PRIME_AGENT_MANAGED_POLICY } from './policy.js';
import { PrimeAgentRpcClient } from './rpc-client.js';

const FILE_MODE = 0o600;
const TRANSPORT = 'prime-agent';
/** Linux caps one argv string at 131,072 bytes; stay well below it (D8). */
export const PRIME_AGENT_APPEND_PROMPT_MAX_BYTES = 100_000;
export const PRIME_AGENT_STATS_DEBOUNCE_MS = 250;
export const PRIME_AGENT_ABORT_TIMEOUT_MS = 2_000;
export const PRIME_AGENT_CHILD_EXIT_GRACE_MS = 3_000;
const STARTUP_REQUEST_TIMEOUT_MS = 60_000;
const STDERR_TAIL_BYTES = 64 * 1024;
const LAUNCH_ERROR_STDERR_BYTES = 2_000;

export const PRIME_AGENT_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const DIALOG_METHODS = new Set(['select', 'confirm', 'input', 'editor']);

export interface PrimeAgentHostOptions {
  agentId: string;
  binaryPath: string;
  workspace: string;
  provider: string;
  model: string;
  contextFile?: string;
  thinking?: string;
  resumeSessionFile?: string;
  overdeckHome?: string;
}

/** The slice of a ChildProcess the host uses, so tests can drive a fake child. */
export interface PrimeAgentChild {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly exitCode: number | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
}

export interface PrimeAgentHostDeps {
  spawnChild?: (binary: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => PrimeAgentChild;
  readVersion?: (binary: string) => Promise<string>;
  reapDaemon?: (agentId: string, binary: string, home: string) => Promise<'none' | 'terminated' | 'killed'>;
  appendSessionHistory?: typeof appendSessionIdToHistory;
  /** Where pane lines go. Defaults to nothing (tests); `main` passes process.stdout. */
  pane?: { write(text: string): unknown };
}

export interface HostOpResult {
  status: number;
  body: Record<string, unknown>;
}

type HostState = 'starting' | 'ready' | 'closed';

/** Split context text into `--append-system-prompt` values, each ≤ maxBytes, on paragraph boundaries (D8). */
export function splitAppendSystemPrompt(text: string, maxBytes = PRIME_AGENT_APPEND_PROMPT_MAX_BYTES): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const chunks: string[] = [];
  let current = '';
  const push = () => {
    if (current) chunks.push(current);
    current = '';
  };
  for (const paragraph of trimmed.split(/\n{2,}/)) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (Buffer.byteLength(candidate) <= maxBytes) {
      current = candidate;
      continue;
    }
    push();
    if (Buffer.byteLength(paragraph) <= maxBytes) {
      current = paragraph;
      continue;
    }
    // One paragraph larger than the limit: split it on character boundaries.
    let piece = '';
    for (const char of paragraph) {
      if (Buffer.byteLength(piece + char) > maxBytes) {
        chunks.push(piece);
        piece = '';
      }
      piece += char;
    }
    current = piece;
  }
  push();
  return chunks;
}

/** The child argv (D8, D9). The managed policy is always the first system-prompt value. */
export function buildPrimeAgentChildArgs(input: {
  daemonSocket: string;
  provider: string;
  model: string;
  sessionDir: string;
  thinking?: string;
  resumeSessionFile?: string;
  context?: string;
}): string[] {
  const args = [
    '--mode', 'rpc',
    '--daemon-socket', input.daemonSocket,
    '--provider', input.provider,
    '--model', input.model,
    '--session-dir', input.sessionDir,
    '--no-extensions',
  ];
  if (input.thinking) args.push('--thinking', input.thinking);
  if (input.resumeSessionFile) args.push('--resume', input.resumeSessionFile);
  for (const value of [PRIME_AGENT_MANAGED_POLICY, ...splitAppendSystemPrompt(input.context ?? '')]) {
    args.push('--append-system-prompt', value);
  }
  return args;
}

function defaultSpawnChild(binary: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): PrimeAgentChild {
  return spawn(binary, args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(undefined), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolvePromise(value); },
      () => { clearTimeout(timer); resolvePromise(undefined); },
    );
  });
}

export class PrimeAgentHost {
  private readonly home: string;
  private readonly agentDir: string;
  private readonly deps: Required<Omit<PrimeAgentHostDeps, 'pane'>> & Pick<PrimeAgentHostDeps, 'pane'>;
  private state: HostState = 'starting';
  private child: PrimeAgentChild | undefined;
  private client: PrimeAgentRpcClient | undefined;
  private server: Server | undefined;
  private token = '';
  private sessionId = '';
  private sessionFile = '';
  private isStreaming = false;
  private lastEventAt = new Date().toISOString();
  private stats: unknown = null;
  private statsTimer: ReturnType<typeof setTimeout> | undefined;
  private statsRefreshPending = false;
  private statsWrite: Promise<void> = Promise.resolve();
  private stderrTail = '';
  private childExited = false;
  private childExit: Promise<void> = Promise.resolve();
  private stopping: Promise<void> | undefined;
  private resolveClosed!: (code: number) => void;
  /** Resolves with the exit code the host process should use once it has shut down. */
  readonly closed: Promise<number> = new Promise((resolvePromise) => { this.resolveClosed = resolvePromise; });

  constructor(private readonly options: PrimeAgentHostOptions, deps: PrimeAgentHostDeps = {}) {
    this.home = options.overdeckHome ?? process.env.OVERDECK_HOME ?? join(homedir(), '.overdeck');
    this.agentDir = join(this.home, 'agents', options.agentId);
    this.deps = {
      spawnChild: deps.spawnChild ?? defaultSpawnChild,
      readVersion: deps.readVersion ?? readPrimeAgentVersionOutput,
      reapDaemon: deps.reapDaemon ?? ((agentId, binary, home) => reapPrimeAgentDaemon(agentId, { binary, home })),
      appendSessionHistory: deps.appendSessionHistory ?? appendSessionIdToHistory,
      pane: deps.pane,
    };
  }

  get currentSessionId(): string {
    return this.sessionId;
  }

  get currentSessionFile(): string {
    return this.sessionFile;
  }

  async start(): Promise<void> {
    const previousSessionId = (await readFile(this.path(hostSessionIdFile(TRANSPORT)), 'utf8').catch(() => '')).trim();
    await mkdir(this.agentDir, { recursive: true, mode: 0o700 });
    await mkdir(join(this.home, 'sockets'), { recursive: true, mode: 0o700 });
    await Promise.all([
      rm(this.path(hostSessionIdFile(TRANSPORT)), { force: true }),
      rm(this.pointerPath(), { force: true }),
      rm(this.path(hostLaunchErrorFile(TRANSPORT)), { force: true }),
      rm(this.socketPath(), { force: true }),
    ]);

    try {
      const version = checkPrimeAgentVersion(await this.deps.readVersion(this.options.binaryPath));
      if (!version.ok) throw new Error(version.message);

      if (this.options.resumeSessionFile && !(await stat(this.options.resumeSessionFile).catch(() => null))?.isFile()) {
        throw new Error(`Prime Agent session file ${this.options.resumeSessionFile} is missing, so the session cannot be resumed. Start a new session instead.`);
      }

      const daemonSocket = primeAgentDaemonSocketPath(this.options.agentId, this.home);
      if (await this.deps.reapDaemon(this.options.agentId, this.options.binaryPath, this.home) === 'none') {
        await rm(daemonSocket, { force: true });
        await rm(`${daemonSocket}.lock`, { recursive: true, force: true });
      }

      const context = this.options.contextFile ? await readFile(this.options.contextFile, 'utf8') : '';
      const sessionDir = primeAgentSessionDir(this.options.agentId, join(this.home, 'agents'));
      await mkdir(sessionDir, { recursive: true, mode: 0o700 });
      this.spawnChild(buildPrimeAgentChildArgs({
        daemonSocket,
        provider: this.options.provider,
        model: this.options.model,
        sessionDir,
        thinking: this.options.thinking,
        resumeSessionFile: this.options.resumeSessionFile,
        context,
      }));

      this.token = randomUUID();
      await writeFile(this.path(hostTokenFile(TRANSPORT)), `${this.token}\n`, { mode: FILE_MODE });
      await chmod(this.path(hostTokenFile(TRANSPORT)), FILE_MODE);
      await this.listen();

      const state = asRecord((await this.rpc().request<Record<string, unknown>>({ type: 'get_state' })).data);
      const sessionFile = typeof state.sessionFile === 'string' ? state.sessionFile : '';
      const sessionId = typeof state.sessionId === 'string' ? state.sessionId : '';
      if (!sessionFile || !sessionId) throw new Error('Prime Agent get_state returned no sessionFile or sessionId.');
      this.isStreaming = state.isStreaming === true;

      if (this.options.resumeSessionFile) {
        if (resolve(sessionFile) !== resolve(this.options.resumeSessionFile)) {
          throw new Error(`Prime Agent resumed ${sessionFile}, not the requested session file ${this.options.resumeSessionFile}. The replacement session was stopped.`);
        }
        if (previousSessionId && sessionId !== previousSessionId) {
          throw new Error(`Prime Agent resumed session id ${sessionId}, but ${previousSessionId} was recorded for ${this.options.resumeSessionFile}. The replacement session was stopped.`);
        }
      }

      this.sessionFile = sessionFile;
      this.sessionId = sessionId;
      await writeFile(this.pointerPath(), `${sessionFile}\n`, { mode: FILE_MODE });
      await writeFile(this.path(hostSessionIdFile(TRANSPORT)), `${sessionId}\n`, { mode: FILE_MODE });
      this.state = 'ready';
      this.deps.appendSessionHistory(this.options.agentId, sessionId, 'prime-agent-host', {
        harness: 'prime-agent',
        model: this.options.model,
        path: sessionFile,
      });
      this.paneLine(`[prime-agent] ready session=${sessionId}`);
    } catch (error) {
      await this.failLaunch(errorMessage(error));
      throw error;
    }
  }

  /** Stop everything this host owns: the turn, the child, the daemon and the socket. Idempotent. */
  stop(exitCode = 0): Promise<void> {
    this.stopping ??= this.shutdown(exitCode);
    return this.stopping;
  }

  async handleOp(op: unknown): Promise<HostOpResult> {
    const body = asRecord(op);
    const name = typeof body.op === 'string' ? body.op : '';
    try {
      if (name === 'status') {
        return { status: 200, body: { state: this.state, sessionId: this.sessionId, sessionFile: this.sessionFile, isStreaming: this.isStreaming } };
      }
      if (name === 'message') return await this.handleMessage(body);
      if (name === 'interrupt') {
        if (this.state !== 'ready') return { status: 409, body: { error: 'Prime Agent session is not ready' } };
        await this.rpc().request({ type: 'abort' });
        return { status: 200, body: { ok: true } };
      }
      if (name === 'set-effort') return await this.handleSetEffort(body);
      return { status: 400, body: { error: `unsupported Prime Agent host op: ${name || '<missing>'}` } };
    } catch (error) {
      return { status: 500, body: { error: errorMessage(error) } };
    }
  }

  private async handleMessage(op: Record<string, unknown>): Promise<HostOpResult> {
    const content = typeof op.content === 'string' ? op.content : '';
    if (!content) return { status: 400, body: { error: 'message content is required' } };
    if (this.state !== 'ready') return { status: 409, body: { error: 'Prime Agent session is not ready' } };
    const state = asRecord((await this.rpc().request<Record<string, unknown>>({ type: 'get_state' })).data);
    this.isStreaming = state.isStreaming === true;
    // D4: steer while streaming, prompt when idle. The idle prompt still names
    // `streamingBehavior: 'steer'` so a turn that starts in between queues it
    // instead of rejecting it.
    const command = this.isStreaming ? 'steer' : 'prompt';
    await this.rpc().request(command === 'steer'
      ? { type: 'steer', message: content }
      : { type: 'prompt', message: content, streamingBehavior: 'steer' });
    this.paneLine(`[user] ${content}`);
    return { status: 202, body: { accepted: true, promptId: randomUUID(), command } };
  }

  private async handleSetEffort(op: Record<string, unknown>): Promise<HostOpResult> {
    if (this.state !== 'ready') return { status: 409, body: { error: 'Prime Agent session is not ready' } };
    const effort = typeof op.effort === 'string' ? op.effort.trim() : '';
    if (!(PRIME_AGENT_THINKING_LEVELS as readonly string[]).includes(effort)) {
      return { status: 400, body: { error: `effort must be one of ${PRIME_AGENT_THINKING_LEVELS.join(', ')}` } };
    }
    await this.rpc().request({ type: 'set_thinking_level', level: effort });
    return { status: 200, body: { ok: true, effort } };
  }

  private spawnChild(args: string[]): void {
    const child = this.deps.spawnChild(this.options.binaryPath, args, {
      cwd: this.options.workspace,
      // RPC startup never self-updates (checked on 0.8.0); this only skips the
      // release-notice fetch.
      env: { ...process.env, PI_SKIP_VERSION_CHECK: '1' },
    });
    this.child = child;
    this.client = new PrimeAgentRpcClient({
      stdin: child.stdin,
      requestTimeoutMs: STARTUP_REQUEST_TIMEOUT_MS,
      onEvent: (event) => this.onEvent(event),
      onRecordError: (error) => this.paneLine(`[prime-agent-host] ${error.message}`),
    });
    child.stdout.on('data', (chunk: Buffer) => this.client?.acceptStdout(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      this.deps.pane?.write(text);
      this.stderrTail = (this.stderrTail + text).slice(-STDERR_TAIL_BYTES);
    });
    this.childExit = new Promise((resolveExit) => {
      child.once('exit', (code, signal) => {
        this.childExited = true;
        const reason = `Prime Agent exited with ${code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`}`;
        this.client?.close(new Error(reason));
        resolveExit();
        void this.onChildExit(reason, code);
      });
    });
    child.once('error', (error) => {
      this.client?.close(new Error(`Prime Agent process failed to start: ${error.message}`));
    });
  }

  private async onChildExit(reason: string, code: number | null): Promise<void> {
    if (this.state === 'closed' || this.stopping) return;
    if (this.state === 'starting') return; // start() reports the failure through the pending get_state.
    this.paneLine(`[prime-agent] ${reason}`);
    await this.stop(code === 0 ? 0 : 1);
  }

  private onEvent(event: Record<string, unknown>): void {
    this.lastEventAt = new Date().toISOString();
    const type = typeof event.type === 'string' ? event.type : '';
    if (type === 'extension_ui_request' && typeof event.id === 'string' && DIALOG_METHODS.has(String(event.method))) {
      // D10: no UI can answer a dialog in a managed session, so cancel it at once.
      this.client?.notify({ type: 'extension_ui_response', id: event.id, cancelled: true });
      this.paneLine(`[prime-agent-host] cancelled extension dialog (${String(event.method)})`);
    } else if (type === 'agent_start') {
      this.isStreaming = true;
    } else if (type === 'agent_end') {
      this.isStreaming = false;
      this.statsRefreshPending = true;
    } else if (type === 'message_end') {
      this.renderMessage(asRecord(event.message));
    } else if (type === 'tool_execution_start' && typeof event.toolName === 'string') {
      this.paneLine(`[tool] ${event.toolName}`);
    }
    this.scheduleStatsWrite();
  }

  private renderMessage(message: Record<string, unknown>): void {
    if (message.role !== 'assistant') return;
    if ((message.stopReason === 'error' || message.stopReason === 'aborted') && typeof message.errorMessage === 'string') {
      this.paneLine(`[error] ${message.errorMessage}`);
      return;
    }
    if (!Array.isArray(message.content)) return;
    const text = message.content
      .map((block) => asRecord(block))
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('\n')
      .trim();
    if (text) this.paneLine(`[assistant] ${text}`);
  }

  private scheduleStatsWrite(): void {
    if (this.statsTimer || this.state === 'closed') return;
    this.statsTimer = setTimeout(() => {
      this.statsTimer = undefined;
      void this.writeStats();
    }, PRIME_AGENT_STATS_DEBOUNCE_MS);
  }

  private async writeStats(): Promise<void> {
    if (this.statsRefreshPending && this.state === 'ready') {
      this.statsRefreshPending = false;
      try {
        this.stats = (await this.rpc().request({ type: 'get_session_stats' })).data ?? null;
      } catch (error) {
        this.paneLine(`[prime-agent-host] get_session_stats failed: ${errorMessage(error)}`);
      }
    }
    const target = this.path(PRIME_AGENT_STATS_FILE);
    const snapshot = JSON.stringify({ lastEventAt: this.lastEventAt, stats: this.stats });
    this.statsWrite = this.statsWrite.then(async () => {
      const temp = `${target}.${process.pid}.tmp`;
      await writeFile(temp, snapshot, { mode: FILE_MODE });
      await rename(temp, target);
    }).catch(() => undefined);
    await this.statsWrite;
  }

  private async failLaunch(message: string): Promise<void> {
    const stderr = this.stderrTail.trim().slice(-LAUNCH_ERROR_STDERR_BYTES);
    const launchError = stderr && this.childExited ? `${message}\n${stderr}` : message;
    this.paneLine(`[error] ${launchError}`);
    await writeFile(this.path(hostLaunchErrorFile(TRANSPORT)), `${launchError}\n`, { mode: FILE_MODE }).catch(() => undefined);
    await this.stop(1);
    await rm(this.path(hostSessionIdFile(TRANSPORT)), { force: true });
  }

  private async shutdown(exitCode: number): Promise<void> {
    const wasReady = this.state === 'ready';
    this.state = 'closed';
    if (this.statsTimer) {
      clearTimeout(this.statsTimer);
      this.statsTimer = undefined;
    }
    const child = this.child;
    if (child && !this.childExited) {
      if (wasReady && this.client) await withTimeout(this.client.request({ type: 'abort' }), PRIME_AGENT_ABORT_TIMEOUT_MS);
      child.stdin.end();
      const exited = await withTimeout(this.childExit.then(() => true), PRIME_AGENT_CHILD_EXIT_GRACE_MS);
      if (!exited && !this.childExited) child.kill('SIGKILL');
    }
    this.client?.close(new Error('Prime Agent host stopped'));
    await this.deps.reapDaemon(this.options.agentId, this.options.binaryPath, this.home)
      .catch((error: unknown) => this.paneLine(`[prime-agent-host] daemon reap failed: ${errorMessage(error)}`));
    await this.closeServer();
    await this.statsWrite;
    this.resolveClosed(exitCode);
  }

  private async listen(): Promise<void> {
    const server = createHttpServer((request, response) => {
      void this.handleRequest(request, response).catch((error: unknown) => {
        if (!response.headersSent) sendJson(response, 500, { error: errorMessage(error) });
        else response.end();
      });
    });
    this.server = server;
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(this.socketPath(), () => {
        server.off('error', reject);
        resolveListen();
      });
    });
    await chmod(this.socketPath(), FILE_MODE);
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'method not allowed' });
      return;
    }
    if (request.headers[BRIDGE_TOKEN_HEADER] !== this.token) {
      sendJson(response, 401, { error: 'unauthorized' });
      return;
    }
    const body = await readBoundedBody(request, INPUT_PURGE_MAX_CHARS);
    if (!body) {
      sendJson(response, 413, { error: 'request body too large' });
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body.toString('utf-8'));
    } catch {
      sendJson(response, 400, { error: 'invalid JSON body' });
      return;
    }
    const result = await this.handleOp(payload);
    sendJson(response, result.status, result.body);
  }

  private async closeServer(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(this.socketPath(), { force: true });
  }

  private rpc(): PrimeAgentRpcClient {
    if (!this.client) throw new Error('Prime Agent RPC client is not running');
    return this.client;
  }

  private paneLine(line: string): void {
    this.deps.pane?.write(`${line}\n`);
  }

  private path(name: string): string {
    return join(this.agentDir, name);
  }

  private pointerPath(): string {
    return primeAgentSessionFilePointerPath(this.options.agentId, join(this.home, 'agents'));
  }

  private socketPath(): string {
    return hostSocketPath(this.options.agentId, TRANSPORT, this.home);
  }
}

function readBoundedBody(request: IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  return new Promise((resolveBody, reject) => {
    let chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    request.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        settled = true;
        chunks = [];
        resolveBody(null);
        return;
      }
      chunks.push(buffer);
    });
    request.once('end', () => {
      if (settled) return;
      settled = true;
      resolveBody(Buffer.concat(chunks));
    });
    request.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function sendJson(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

/** Start a Prime Agent host. Resolves once the session is ready; rejects after writing the launch error. */
export async function startPrimeAgentHost(options: PrimeAgentHostOptions, deps: PrimeAgentHostDeps = {}): Promise<PrimeAgentHost> {
  const host = new PrimeAgentHost(options, deps);
  await host.start();
  return host;
}

export function parsePrimeAgentHostArgs(argv: ReadonlyArray<string>): PrimeAgentHostOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith('--')) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    values.set(argument, value);
    index += 1;
  }
  const agentId = values.get('--agent');
  const binaryPath = values.get('--binary-path');
  const workspace = values.get('--workspace');
  const provider = values.get('--provider');
  const model = values.get('--model');
  if (!agentId || !binaryPath || !workspace || !provider || !model) {
    throw new Error('Prime Agent host requires --agent, --binary-path, --workspace, --provider, and --model');
  }
  return {
    agentId,
    binaryPath,
    workspace,
    provider,
    model,
    ...(values.get('--context-file') ? { contextFile: values.get('--context-file') } : {}),
    ...(values.get('--thinking') ? { thinking: values.get('--thinking') } : {}),
    ...(values.get('--resume') ? { resumeSessionFile: values.get('--resume') } : {}),
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const host = new PrimeAgentHost(parsePrimeAgentHostArgs(argv), { pane: process.stdout });
  const stop = () => {
    void host.stop();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  process.once('SIGHUP', stop);
  try {
    await host.start();
  } catch {
    process.exit(await host.closed);
  }
  process.exit(await host.closed);
}

if (basename(fileURLToPath(import.meta.url)) === basename(process.argv[1] ?? '')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
