import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import {
  connectUnixWebSocketTransport,
  createStdioTransport,
  nativeEndpointUrl,
  NATIVE_SOCKET_PATH_MAX_BYTES,
  type AppServerTransport,
} from './app-server-transport.js';

const execFileAsync = promisify(execFile);
const MINIMUM_CODEX_VERSION = '0.144.0';
/**
 * Oldest CLI the native terminal attachment was verified against (PAN-3835):
 * `app-server --listen unix://` plus `resume --remote unix://`. Older CLIs keep
 * the ordinary stdio transport; only attachment is unavailable.
 */
export const MINIMUM_NATIVE_ENDPOINT_CODEX_VERSION = '0.153.4';
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const VERSION_TIMEOUT_MS = 4_000;

export interface AppServerMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: unknown };
}

export interface CodexAppServerManagerOptions {
  codexBinary?: string;
  cwd: string;
  codexHome?: string;
  requestTimeoutMs?: number;
  clientVersion?: string;
  spawnProcess?: (args: readonly string[]) => ChildProcessWithoutNullStreams;
  readVersion?: () => Promise<string>;
  /**
   * PAN-3835: listen on this private Unix socket (WebSocket framing) instead of
   * stdio, so the native Codex TUI can attach to the same app-server. Opt-in:
   * only conversation hosts pass it. Falls back to stdio, with a reason, when
   * the CLI is too old, the path is too long, or the socket never accepts.
   */
  nativeSocketPath?: string;
  /** Test seam for the native connection. */
  connectNative?: (socketPath: string) => Promise<AppServerTransport>;
}

export type NativeEndpointUnavailableReason =
  | 'not-requested'
  | 'cli-unsupported'
  | 'socket-path-too-long'
  | 'connect-failed';

export interface CodexAppServerTransportInfo {
  kind: 'stdio' | 'unix';
  /** `unix://<path>` when the native endpoint is live. */
  endpoint?: string;
  unavailableReason?: NativeEndpointUnavailableReason;
  cliVersion?: string;
}

export type CodexRuntimeMode = 'full-access' | 'read-only' | 'default';

export interface ThreadOptions {
  model: string;
  cwd?: string;
  runtimeMode?: CodexRuntimeMode;
  developerInstructions?: string;
}

export interface TurnOptions {
  model?: string;
  effort?: string;
}

export interface CodexAppServerState {
  state: 'starting' | 'ready' | 'idle' | 'running' | 'error' | 'closed';
  threadId?: string;
  activeTurnId?: string;
}

interface PendingRequest {
  method: string;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class CodexAppServerManager extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | undefined;
  private transport: AppServerTransport | undefined;
  private nextRequestId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private sessionState: CodexAppServerState = { state: 'starting' };
  private transportInfo: CodexAppServerTransportInfo = { kind: 'stdio', unavailableReason: 'not-requested' };
  /** True while this manager's own thread/start is in flight and no thread is pinned yet. */
  private startingOwnThread = false;
  /** A native child being torn down for the stdio fallback; its exit is not the runtime's. */
  private nativeFallbackChild: ChildProcessWithoutNullStreams | undefined;
  private exitEmitted = false;

  constructor(private readonly options: CodexAppServerManagerOptions) {
    super();
  }

  async start(): Promise<void> {
    if (this.child) return;
    const installed = await this.assertSupportedVersion();
    const nativeSocketPath = this.options.nativeSocketPath;
    let fallbackReason: NativeEndpointUnavailableReason | undefined = nativeSocketPath ? undefined : 'not-requested';
    if (nativeSocketPath && compareVersions(installed, MINIMUM_NATIVE_ENDPOINT_CODEX_VERSION) < 0) {
      fallbackReason = 'cli-unsupported';
    } else if (nativeSocketPath && Buffer.byteLength(nativeSocketPath, 'utf-8') > NATIVE_SOCKET_PATH_MAX_BYTES) {
      fallbackReason = 'socket-path-too-long';
    }

    if (nativeSocketPath && !fallbackReason) {
      if (await this.startNative(nativeSocketPath)) {
        this.transportInfo = { kind: 'unix', endpoint: nativeEndpointUrl(nativeSocketPath), cliVersion: installed };
      } else {
        fallbackReason = 'connect-failed';
      }
    }
    if (!this.transport) {
      const child = this.spawnChild(['app-server']);
      this.useTransport(createStdioTransport(child.stdout, child.stdin), { stopOnClose: false });
      this.transportInfo = { kind: 'stdio', cliVersion: installed, ...(fallbackReason ? { unavailableReason: fallbackReason } : {}) };
    }

    await this.request('initialize', {
      clientInfo: {
        name: 'overdeck',
        title: 'Overdeck',
        version: this.options.clientVersion ?? '0.0.0',
      },
      capabilities: { experimentalApi: true },
    });
    this.notify('initialized');
    this.sessionState = { ...this.sessionState, state: 'ready' };
  }

  getState(): Readonly<CodexAppServerState> {
    return { ...this.sessionState };
  }

  getTransportInfo(): Readonly<CodexAppServerTransportInfo> {
    return { ...this.transportInfo };
  }

  async startThread(options: ThreadOptions): Promise<unknown> {
    this.startingOwnThread = !this.sessionState.threadId;
    try {
      const result = await this.request('thread/start', this.buildThreadParams(options));
      this.applyThreadResult(result);
      return result;
    } finally {
      this.startingOwnThread = false;
    }
  }

  /**
   * Resume `threadId`. `strict` never substitutes a fresh thread: the native
   * terminal must attach to the conversation's own thread or not at all.
   */
  async resumeThread(threadId: string, options: ThreadOptions, resumeOptions: { strict?: boolean } = {}): Promise<unknown> {
    try {
      const result = await this.request('thread/resume', { ...this.buildThreadParams(options), threadId });
      this.applyThreadResult(result);
      return result;
    } catch (error) {
      if (resumeOptions.strict) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (isActiveWriterResumeError(message)) {
        // The thread is still open in this same app-server (a live host being
        // re-prompted for the next review cycle). codex refuses a second
        // writer, and dropping the prompt here stranded the PAN-3705 reviewer
        // — a fresh thread loses the old context but keeps the message.
        this.emit('warning', `thread/resume refused for ${threadId} (active writer); starting a fresh thread.`);
        return this.startThread(options);
      }
      if (!isMissingThreadResumeError(message)) throw error;
      this.emit('warning', `thread/resume could not find ${threadId}; starting a fresh thread.`);
      return this.startThread(options);
    }
  }

  startTurn(text: string, options: TurnOptions = {}): Promise<unknown> {
    if (!this.sessionState.threadId) throw new Error('Cannot start a turn before a thread is active.');
    return this.request('turn/start', {
      threadId: this.sessionState.threadId,
      input: [{ type: 'text', text, text_elements: [] }],
      ...(options.model ? { model: options.model } : {}),
      ...(options.effort ? { effort: options.effort } : {}),
    });
  }

  interruptTurn(): Promise<unknown> {
    if (!this.sessionState.threadId || !this.sessionState.activeTurnId) {
      throw new Error('Cannot interrupt without an active turn.');
    }
    return this.request('turn/interrupt', {
      threadId: this.sessionState.threadId,
      turnId: this.sessionState.activeTurnId,
    });
  }

  readThread(threadId = this.sessionState.threadId): Promise<unknown> {
    if (!threadId) throw new Error('Cannot read a thread before a thread is active.');
    return this.request('thread/read', { threadId, includeTurns: true });
  }

  readAccount(): Promise<unknown> {
    return this.request('account/read', {});
  }

  answerApproval(id: number | string, decision: string): void {
    this.write({ id, result: { decision } });
  }

  answerUserInput(id: number | string, answers: Record<string, string[]>): void {
    this.write({ id, result: { answers } });
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`Timed out waiting for ${method}.`));
      }, timeoutMs);
      this.pending.set(String(id), { method, timeout, resolve: value => resolve(value as T), reject });
      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(String(id));
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  stop(): void {
    const transport = this.transport;
    this.transport = undefined;
    transport?.close();
    this.child?.kill('SIGTERM');
    this.child = undefined;
    this.sessionState = { ...this.sessionState, state: 'closed', activeTurnId: undefined };
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('codex app-server stopped.'));
    }
    this.pending.clear();
  }

  private spawnChild(args: string[]): ChildProcessWithoutNullStreams {
    const binary = this.options.codexBinary ?? 'codex';
    const child = this.options.spawnProcess?.(args) ?? spawn(binary, args, {
      cwd: this.options.cwd,
      env: { ...process.env, ...(this.options.codexHome ? { CODEX_HOME: this.options.codexHome } : {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stderr.on('data', chunk => this.handleStderr(String(chunk)));
    child.once('exit', (code, signal) => this.handleExit(child, code, signal));
    return child;
  }

  /**
   * Spawn `app-server --listen unix://<path>` and connect to it. On a failed
   * connection the child is stopped and awaited before returning false, so the
   * stdio fallback never runs a second app-server beside the first.
   */
  private async startNative(socketPath: string): Promise<boolean> {
    // A socket file left by a crashed earlier run would make the listen fail.
    await rm(socketPath, { force: true });
    const child = this.spawnChild(['app-server', '--listen', nativeEndpointUrl(socketPath)]);
    this.nativeFallbackChild = child;
    // The native transport does not use the child's stdio; keep the pipe drained.
    child.stdout.resume();
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    try {
      const connect = this.options.connectNative ?? ((path: string) => connectUnixWebSocketTransport(path));
      this.useTransport(await connect(socketPath), { stopOnClose: true });
      this.nativeFallbackChild = undefined;
      return true;
    } catch (error) {
      this.emit('warning', `native app-server endpoint unavailable, using stdio: ${error instanceof Error ? error.message : String(error)}`);
      child.kill('SIGTERM');
      await exited;
      if (this.child === child) this.child = undefined;
      return false;
    }
  }

  private useTransport(transport: AppServerTransport, options: { stopOnClose: boolean }): void {
    this.transport = transport;
    transport.onMessage(line => this.handleLine(line));
    // stdio ends with the child, whose exit event reports it. A native socket
    // can close with the child still alive; it is the manager's only channel,
    // so stop the runtime rather than leave an unreachable app-server.
    if (!options.stopOnClose) return;
    transport.onClose((reason) => {
      if (this.transport !== transport) return;
      this.emit('warning', `codex app-server connection closed: ${reason}`);
      this.stop();
      this.emitExit({ code: null, signal: null });
    });
  }

  private emitExit(exit: { code: number | null; signal: NodeJS.Signals | null }): void {
    if (this.exitEmitted) return;
    this.exitEmitted = true;
    this.emit('exit', exit);
  }

  private async assertSupportedVersion(): Promise<string> {
    const raw = await (this.options.readVersion?.() ?? execFileAsync(this.options.codexBinary ?? 'codex', ['--version'], {
      cwd: this.options.cwd,
      timeout: VERSION_TIMEOUT_MS,
    }).then(result => result.stdout));
    const installed = raw.match(/\d+\.\d+\.\d+/)?.[0];
    if (!installed) throw new Error(`Could not parse Codex CLI version from: ${raw.trim()}`);
    if (compareVersions(installed, MINIMUM_CODEX_VERSION) < 0) {
      throw new Error(`Codex CLI ${installed} is unsupported; upgrade to ${MINIMUM_CODEX_VERSION} or newer.`);
    }
    return installed;
  }

  private handleLine(line: string): void {
    let message: AppServerMessage;
    try {
      message = JSON.parse(line) as AppServerMessage;
    } catch {
      this.emit('warning', `Ignoring invalid codex app-server JSON: ${line}`);
      return;
    }
    if (message.method && this.isForeignThreadMessage(message)) {
      // PAN-3835: another client of this app-server (the attached native TUI)
      // owns this thread. Its events and requests never touch the pinned
      // thread's state, pending requests, activity, or cost.
      this.emit('foreign-thread', message);
      return;
    }
    if (message.method && message.id !== undefined) {
      this.emit('request', message);
    } else if (message.method) {
      this.applyNotification(message);
      this.emit('notification', message);
    } else if (message.id !== undefined) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(String(message.id));
      if (message.error?.message) pending.reject(new Error(`${pending.method} failed: ${String(message.error.message)}`));
      else pending.resolve(message.result);
    }
  }

  // thread/start and thread/resume responses both carry the thread; the
  // thread/started notification fires only for fresh threads, so on resume the
  // response is the only source of the active threadId.
  private applyThreadResult(result: unknown): void {
    const thread = asRecord(asRecord(result).thread);
    if (typeof thread.id === 'string') {
      this.sessionState = { ...this.sessionState, state: 'idle', threadId: thread.id };
    }
  }

  /**
   * A message scoped to a thread other than the pinned one. The pinned thread
   * comes only from this manager's own start/resume (PAN-3835): a second
   * client's `thread/started` (a native `/new`, a system title thread) must
   * never rebind the conversation.
   */
  private isForeignThreadMessage(message: AppServerMessage): boolean {
    const threadId = messageThreadId(message);
    if (!threadId) return false;
    const pinned = this.sessionState.threadId;
    if (pinned) return threadId !== pinned;
    // Before a thread is pinned, only the announcement of our own in-flight
    // thread/start may pass; any other thread/started belongs to someone else.
    return message.method === 'thread/started' && (!this.startingOwnThread || asRecord(asRecord(message.params).thread).ephemeral === true);
  }

  private applyNotification(message: AppServerMessage): void {
    const params = asRecord(message.params);
    if (message.method === 'thread/started') {
      const threadId = messageThreadId(message);
      if (threadId && !this.sessionState.threadId && this.startingOwnThread) {
        this.sessionState = { ...this.sessionState, state: 'idle', threadId };
      }
      return;
    }
    if (message.method === 'turn/started') {
      const turn = asRecord(params.turn);
      const activeTurnId = typeof turn.id === 'string' ? turn.id : typeof params.turnId === 'string' ? params.turnId : undefined;
      this.sessionState = { ...this.sessionState, state: 'running', ...(activeTurnId ? { activeTurnId } : {}) };
      return;
    }
    if (message.method === 'turn/completed') {
      this.sessionState = { ...this.sessionState, state: 'idle', activeTurnId: undefined };
      return;
    }
    if (message.method === 'error' && params.willRetry !== true) {
      this.sessionState = { ...this.sessionState, state: 'error', activeTurnId: undefined };
    }
  }

  private buildThreadParams(options: ThreadOptions): Record<string, unknown> {
    const runtime = mapRuntimeMode(options.runtimeMode ?? 'default');
    return {
      model: options.model,
      cwd: options.cwd ?? this.options.cwd,
      ...(options.developerInstructions ? { developerInstructions: options.developerInstructions } : {}),
      ...runtime,
      experimentalRawEvents: false,
    };
  }

  private handleStderr(value: string): void {
    const clean = stripAnsi(value).trim();
    if (!clean || /state db missing rollout path for thread|find_thread_path_by_id_str_in_subdir/i.test(clean)) return;
    if (/\bERROR\b/i.test(clean)) this.emit('stderr', clean);
  }

  private handleExit(child: ChildProcessWithoutNullStreams, code: number | null, signal: NodeJS.Signals | null): void {
    if (child === this.nativeFallbackChild) {
      this.nativeFallbackChild = undefined;
      return;
    }
    if (this.child === child) this.child = undefined;
    this.emitExit({ code, signal });
  }

  private write(message: AppServerMessage): void {
    if (!this.transport) throw new Error('Cannot write to codex app-server: not connected.');
    this.transport.send(message);
  }
}

/** The thread a notification or server request is scoped to, if any. */
export function messageThreadId(message: AppServerMessage): string | undefined {
  const params = asRecord(message.params);
  if (typeof params.threadId === 'string') return params.threadId;
  const thread = asRecord(params.thread);
  return typeof thread.id === 'string' ? thread.id : undefined;
}

export function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

function stripAnsi(value: string): string {
  return value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B[@-_]/g, '');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isActiveWriterResumeError(message: string): boolean {
  return /thread\/resume/i.test(message) && /active writer|thread-store conflict/i.test(message);
}

function isMissingThreadResumeError(message: string): boolean {
  return /thread\/resume/i.test(message) && /not found|missing thread|no such thread|unknown thread|does not exist/i.test(message);
}

function mapRuntimeMode(mode: CodexRuntimeMode): { approvalPolicy: string; sandbox: string } {
  if (mode === 'full-access') return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
  if (mode === 'read-only') return { approvalPolicy: 'never', sandbox: 'read-only' };
  return { approvalPolicy: 'on-request', sandbox: 'workspace-write' };
}
