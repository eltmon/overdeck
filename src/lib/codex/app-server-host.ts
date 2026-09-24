import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { access, appendFile, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import {
  CodexAppServerManager,
  messageThreadId,
  type AppServerMessage,
  type CodexAppServerState,
  type CodexAppServerTransportInfo,
  type ThreadOptions,
  type ThreadScope,
  type TurnOptions,
} from './app-server-manager.js';
import { CODEX_NATIVE_ENDPOINT_FILE, codexNativeSocketPath } from './native-endpoint.js';
import { SubAgentSpawns } from './sub-agent-spawns.js';
import { BRIDGE_TOKEN_HEADER } from '../bridge-token.js';
import { waitForCodexRollout } from '../runtimes/codex.js';
import { codexHome } from '../runtimes/storage/codex.js';
import { calculateCostSync, getPricingSync } from '../cost.js';
import { recordAgentActivitySync } from '../agents/agent-state.js';
import { appendSessionIdToHistory } from '../session-history.js';

type JsonRecord = Record<string, unknown>;

export interface PendingAppServerRequest {
  id: string | number;
  method: string;
  params?: unknown;
}

interface AppServerHostManager extends EventEmitter {
  start(): Promise<void>;
  stop(): void;
  getState(): Readonly<CodexAppServerState>;
  /** Optional so hosts built on older managers (and test fakes) still type-check. */
  getTransportInfo?(): Readonly<CodexAppServerTransportInfo>;
  threadScope?(threadId: string): ThreadScope;
  killChildSync?(): void;
  startThread(options: ThreadOptions): Promise<unknown>;
  resumeThread(threadId: string, options: ThreadOptions, resumeOptions?: { strict?: boolean }): Promise<unknown>;
  startTurn(text: string, options?: TurnOptions): Promise<unknown>;
  interruptTurn(): Promise<unknown>;
  answerApproval(id: string | number, decision: string): void;
  answerUserInput(id: string | number, answers: Record<string, string[]>): void;
}

export interface CodexAppServerHostOptions {
  agentId: string;
  cwd: string;
  model?: string;
  effort?: string;
  resumeThreadId?: string;
  developerInstructions?: string;
  overdeckHome?: string;
  codexHome?: string;
  /**
   * PAN-3835: expose a private native endpoint so the Codex TUI can attach to
   * this conversation's app-server. Conversation launches only.
   */
  nativeEndpoint?: boolean;
  /** Close this conversation's native CLI companion (test seam; defaults to the companion lifecycle). */
  closeCompanion?: (ownerSession: string) => Promise<void>;
  manager?: AppServerHostManager;
  stdin?: Readable;
  stdout?: Writable;
  recordActivity?: (agentId: string, activity: { at?: string; costSoFar?: number }) => boolean;
}

interface HostOpResult {
  status: number;
  body: JsonRecord;
}

export class CodexAppServerHost {
  private readonly overdeckHome: string;
  private readonly manager: AppServerHostManager;
  private readonly pendingRequests = new Map<string, PendingAppServerRequest>();
  private server: Server | undefined;
  private input: Interface | undefined;
  private token: string | undefined;
  private threadModel: string | undefined;
  private effort: string;
  private state: 'starting' | 'ready' | 'closed' = 'starting';
  private lastActivityPersistedAt = 0;
  /** One host process lifetime; a restart is a new generation (PAN-3835). */
  private readonly generation = randomUUID();
  /** Serializes thread start/resume between dashboard messages and terminal attach. */
  private threadReady: Promise<void> | undefined;
  /** Rollout path Codex reported for the owner thread. */
  private ownerRolloutPath: string | undefined;
  /** Foreign threads that are not native navigation (Codex title threads). */
  private readonly incidentalThreads = new Set<string>();
  /** Native navigation seen so far; it only ever grows (PAN-4031). */
  private readonly navigatedThreads = new Set<string>();
  /** Threads whose events arrived before anything classified them. */
  private readonly unclassifiedThreads = new Set<string>();
  /** Latest running cost total per owner/sub-agent thread. */
  private readonly threadCosts = new Map<string, number>();
  /** Open spawn calls and each sub-agent's model (PAN-4031). */
  private readonly spawns = new SubAgentSpawns(threadId => this.scopeOf(threadId), () => this.threadModel);
  /** True once the host itself is stopping the app-server. */
  private stopping = false;
  private exitHandling: Promise<void> = Promise.resolve();

  constructor(private readonly options: CodexAppServerHostOptions) {
    this.overdeckHome = options.overdeckHome ?? process.env.OVERDECK_HOME ?? join(homedir(), '.overdeck');
    this.manager = options.manager ?? new CodexAppServerManager({
      cwd: options.cwd,
      codexHome: options.codexHome ?? codexHome(),
      ...(options.nativeEndpoint ? { nativeSocketPath: codexNativeSocketPath(this.agentDir()) } : {}),
    });
    this.threadModel = options.model;
    this.effort = options.effort ?? 'high';
    this.attachManagerEvents();
  }

  async start(): Promise<void> {
    await mkdir(this.agentDir(), { recursive: true });
    await mkdir(this.socketDir(), { recursive: true });
    await rm(this.nativeEndpointFilePath(), { force: true });
    if (this.options.nativeEndpoint) {
      const nativeDir = dirname(codexNativeSocketPath(this.agentDir()));
      await mkdir(nativeDir, { recursive: true, mode: 0o700 });
      await chmod(nativeDir, 0o700);
    }
    this.token = randomUUID();
    await writeFile(this.tokenPath(), `${this.token}\n`, { mode: 0o600 });
    await this.manager.start();
    await this.publishNativeEndpoint();
    await this.listen();
    this.startPaneInput();
    this.state = 'ready';
  }

  /** Last resort on process exit: the app-server child must never outlive its host. */
  killRuntimeSync(): void {
    this.stopping = true;
    this.manager.killChildSync?.();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.state = 'closed';
    this.input?.close();
    this.input = undefined;
    this.manager.stop();
    await rm(this.nativeEndpointFilePath(), { force: true }).catch(() => undefined);
    await this.closeServer();
  }

  /**
   * Record the native endpoint for the companion adapter once the manager is
   * connected through it. The socket is owner-only regardless of the umask
   * the app-server ran under.
   */
  private async publishNativeEndpoint(): Promise<void> {
    const info = this.transportInfo();
    if (info.kind !== 'unix' || !info.endpoint) {
      if (this.options.nativeEndpoint) {
        this.writePaneLine(`[terminal] native Codex terminal unavailable: ${info.unavailableReason ?? 'unknown'}`);
        await this.appendEvent('native-endpoint/unavailable', { reason: info.unavailableReason, cliVersion: info.cliVersion });
      }
      return;
    }
    await chmod(codexNativeSocketPath(this.agentDir()), 0o600);
    await writeFile(this.nativeEndpointFilePath(), `${info.endpoint}\n`, { mode: 0o600 });
    await this.appendEvent('native-endpoint/ready', { endpoint: info.endpoint, cliVersion: info.cliVersion });
  }

  private transportInfo(): Readonly<CodexAppServerTransportInfo> {
    return this.manager.getTransportInfo?.() ?? { kind: 'stdio', unavailableReason: 'not-requested' };
  }

  async shutdownForSignal(signal: 'SIGTERM' | 'SIGINT' | 'SIGHUP', graceMs = 5_000): Promise<void> {
    this.stopping = true;
    await this.appendEvent('lifecycle/signal', { signal });
    const state = this.manager.getState();
    if (state.threadId && state.activeTurnId) {
      await this.appendEvent('op/interrupt', { reason: signal });
      // A failed interrupt must never skip stopping the child below.
      await this.manager.interruptTurn().catch(() => undefined);
    }
    await this.appendEvent('lifecycle/child-sigterm', { signal });
    this.manager.stop();
    await rm(this.nativeEndpointFilePath(), { force: true }).catch(() => undefined);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, graceMs);
      timer.unref?.();
    });
    await this.closeServer();
    this.state = 'closed';
  }

  private async closeServer(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  status(): JsonRecord {
    const managerState = this.manager.getState();
    return {
      state: this.publicState(managerState),
      managerState: managerState.state,
      threadId: managerState.threadId,
      activeTurnId: managerState.activeTurnId,
      pendingRequests: [...this.pendingRequests.values()],
      generation: this.generation,
      nativeEndpoint: this.nativeEndpointStatus(),
      navigationEpoch: this.navigationEpoch(),
    };
  }

  private nativeEndpointStatus(): JsonRecord {
    const info = this.transportInfo();
    if (info.kind === 'unix' && info.endpoint) return { available: true, endpoint: info.endpoint, cliVersion: info.cliVersion };
    return { available: false, reason: info.unavailableReason ?? 'not-requested', cliVersion: info.cliVersion };
  }

  async handleOp(op: unknown): Promise<HostOpResult> {
    const body = asRecord(op);
    const name = typeof body.op === 'string' ? body.op : '';
    try {
      if (name === 'status') return { status: 200, body: this.status() };
      if (name === 'set-effort') {
        if (typeof body.effort !== 'string' || !['low', 'medium', 'high', 'xhigh', 'max'].includes(body.effort)) {
          return { status: 400, body: { error: 'Invalid reasoning effort' } };
        }
        this.effort = body.effort;
        return { status: 200, body: { ok: true, effort: this.effort } };
      }
      if (name === 'message') return await this.handleMessageOp(body);
      if (name === 'prepare-terminal') return await this.handlePrepareTerminalOp();
      if (name === 'interrupt') return await this.handleInterruptOp();
      if (name === 'approval') return this.handleApprovalOp(body);
      if (name === 'user-input') return this.handleUserInputOp(body);
      return { status: 400, body: { error: `unsupported app-server op: ${name || '<missing>'}` } };
    } catch (error) {
      return {
        status: 500,
        body: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  private async handleMessageOp(op: JsonRecord): Promise<HostOpResult> {
    const content = typeof op.content === 'string' ? op.content : '';
    if (!content) return { status: 400, body: { error: 'message content is required' } };
    const requestedModel = typeof op.model === 'string' ? op.model : undefined;
    const requestedEffort = typeof op.effort === 'string' ? op.effort : this.effort;
    const model = requestedModel ?? this.threadModel;
    if (!model) {
      return {
        status: 400,
        body: { error: 'model is required before starting a Codex app-server turn' },
      };
    }

    const state = this.manager.getState();
    await this.ensureThread(model, { strict: false });

    await this.appendEvent('op/message', {
      contentLength: content.length,
      model: requestedModel,
      effort: requestedEffort,
      hasExistingThread: Boolean(state.threadId),
    });
    this.writePaneLine(`[user] ${content}`);
    await this.manager.startTurn(content, {
      ...(requestedModel ? { model: requestedModel } : {}),
      ...(requestedEffort ? { effort: requestedEffort } : {}),
    });
    return { status: 200, body: { ok: true, state: this.manager.getState() as JsonRecord } };
  }

  private threadOptions(model: string): ThreadOptions {
    return {
      model,
      cwd: this.options.cwd,
      runtimeMode: 'default',
      ...(this.options.developerInstructions
        ? { developerInstructions: this.options.developerInstructions }
        : {}),
    };
  }

  /**
   * Start or resume the owner thread once. Dashboard messages and terminal
   * attach share this lock, so racing callers never create two threads.
   * `strict` (terminal attach) never substitutes a fresh thread for a
   * resume target Codex cannot open.
   */
  private async ensureThread(model: string, options: { strict: boolean }): Promise<void> {
    let attempted = false;
    for (;;) {
      if (this.manager.getState().threadId) return;
      if (this.threadReady) {
        // Another caller is opening the thread; its failure is its own to report.
        await this.threadReady.catch(() => undefined);
        continue;
      }
      if (attempted) return;
      attempted = true;
      const attempt = this.openOwnerThread(model, options);
      this.threadReady = attempt;
      try {
        await attempt;
      } finally {
        if (this.threadReady === attempt) this.threadReady = undefined;
      }
    }
  }

  private async openOwnerThread(model: string, options: { strict: boolean }): Promise<void> {
    const resumeThreadId = this.options.resumeThreadId;
    const result = resumeThreadId
      ? await this.manager.resumeThread(resumeThreadId, this.threadOptions(model), { strict: options.strict })
      : await this.manager.startThread(this.threadOptions(model));
    this.threadModel = model;
    const threadId = this.manager.getState().threadId;
    if (!threadId) return;
    const thread = asRecord(asRecord(result).thread);
    if (typeof thread.path === 'string') this.ownerRolloutPath = thread.path;
    // The conversation's thread pointer comes only from this host's own
    // start/resume (PAN-3835): a native client's `/new` must never rewrite it.
    if (threadId !== resumeThreadId) await this.recordOwnerThread(threadId);
  }

  private async recordOwnerThread(threadId: string): Promise<void> {
    try {
      // The host's own agent dir, so an isolated OVERDECK_HOME is honoured.
      await writeFile(join(this.agentDir(), 'codex-thread-id'), threadId, { mode: 0o600 });
    } catch (error) {
      // The thread exists either way; never fail the turn over the pointer.
      const message = error instanceof Error ? error.message : String(error);
      this.writePaneLine(`[warning] could not record thread ${threadId}: ${message}`);
      await this.appendEvent('thread-id/write-failed', { threadId, message });
    }
    const agentId = this.options.agentId;
    const rolloutPath = this.ownerRolloutPath;
    const rollout = rolloutPath
      ? waitForPath(rolloutPath, 120_000).then(found => (found ? rolloutPath : null))
      : waitForCodexRollout(this.options.codexHome ?? codexHome(), 120_000);
    void rollout
      .then(path => path && appendSessionIdToHistory(agentId, threadId, 'app-server', { harness: 'codex', path }))
      .catch(() => {});
  }

  /**
   * Make the owner thread attachable by the native TUI (PAN-3835). Resumes a
   * saved thread strictly when the host has not loaded it yet; never creates
   * a thread and never starts a turn. `codex resume --remote` needs the
   * thread's rollout on disk, which Codex writes with the first turn.
   */
  private async handlePrepareTerminalOp(): Promise<HostOpResult> {
    const native = this.nativeEndpointStatus();
    if (native.available !== true) {
      return { status: 422, body: { code: 'native-unavailable', reason: native.reason, cliVersion: native.cliVersion, error: 'native endpoint unavailable' } };
    }
    if (!this.manager.getState().threadId) {
      if (!this.options.resumeThreadId) {
        return { status: 409, body: { code: 'no-thread', error: 'the conversation has no Codex thread yet' } };
      }
      const model = this.threadModel;
      if (!model) return { status: 409, body: { code: 'no-thread', error: 'no model is known for resuming the thread' } };
      try {
        await this.ensureThread(model, { strict: true });
      } catch (error) {
        return { status: 409, body: { code: 'resume-failed', error: error instanceof Error ? error.message : String(error) } };
      }
    }
    const threadId = this.manager.getState().threadId;
    if (!threadId) return { status: 409, body: { code: 'no-thread', error: 'the conversation has no Codex thread yet' } };
    const materialized = this.ownerRolloutPath
      ? await access(this.ownerRolloutPath).then(() => true, () => false)
      : threadId === this.options.resumeThreadId;
    if (!materialized) {
      return { status: 409, body: { code: 'no-thread', error: 'the thread has no saved turn yet' } };
    }
    return {
      status: 200,
      body: {
        ok: true,
        threadId,
        endpoint: native.endpoint,
        generation: this.generation,
        navigationEpoch: this.navigationEpoch(),
      },
    };
  }

  private async handleInterruptOp(): Promise<HostOpResult> {
    await this.appendEvent('op/interrupt', {});
    await this.manager.interruptTurn();
    return { status: 200, body: { ok: true, state: this.manager.getState() as JsonRecord } };
  }

  private handleApprovalOp(op: JsonRecord): HostOpResult {
    const requestId = parseRequestId(op.requestId);
    const decision = typeof op.decision === 'string' ? op.decision : '';
    if (requestId === undefined || !decision) {
      return { status: 400, body: { error: 'approval requires requestId and decision' } };
    }
    if (!this.pendingRequests.has(String(requestId))) {
      return { status: 409, body: { error: `approval request ${String(requestId)} is not pending` } };
    }
    this.manager.answerApproval(requestId, decision);
    this.pendingRequests.delete(String(requestId));
    this.writePaneLine(`[approval #${requestId}] ${decision}`);
    void this.appendEvent('op/approval', { requestId, decision });
    return { status: 200, body: { ok: true } };
  }

  private handleUserInputOp(op: JsonRecord): HostOpResult {
    const requestId = parseRequestId(op.requestId);
    const answers = parseAnswers(op.answers);
    if (requestId === undefined || !answers) {
      return { status: 400, body: { error: 'user-input requires requestId and answers' } };
    }
    // The native TUI may have answered it already (PAN-3835); never answer twice.
    if (!this.pendingRequests.has(String(requestId))) {
      return { status: 409, body: { error: `user-input request ${String(requestId)} is not pending` } };
    }
    this.manager.answerUserInput(requestId, answers);
    this.pendingRequests.delete(String(requestId));
    this.writePaneLine(`[input #${requestId}] answered`);
    void this.appendEvent('op/user-input', { requestId });
    return { status: 200, body: { ok: true } };
  }

  private attachManagerEvents(): void {
    this.manager.on('notification', (message: AppServerMessage) => {
      // The manager delivers the owner thread, its sub-agent threads, and
      // threads it cannot classify; foreign threads arrive as foreign-thread.
      // Thread-id recording happens only in openOwnerThread.
      this.applyOwnerNotification(message);
      this.trackUnknownThread(message);
      this.spawns.observe(message);
      this.renderNotification(message);
      this.recordObservedActivity(message);
      void this.appendEvent('notification', message as JsonRecord);
    });
    this.manager.on('request', (message: AppServerMessage) => {
      if (message.id === undefined || !message.method) return;
      // Fail open: a request from any thread the manager did not positively
      // classify as foreign is pending until answered. Dropping one would hang
      // the turn (a sub-agent's approval, PAN-3835 review).
      this.pendingRequests.set(String(message.id), { id: message.id, method: message.method, params: message.params });
      const threadId = messageThreadId(message);
      if (threadId && this.scopeOf(threadId) === 'unknown') {
        this.writePaneLine(`[request #${message.id}] from unrecognized thread ${threadId}; showing it anyway`);
      }
      this.renderRequest(message);
      void this.appendEvent('request', message as JsonRecord);
    });
    this.manager.on('foreign-thread', (message: AppServerMessage) => this.trackForeignThread(message));
    this.manager.on('warning', (warning: unknown) => {
      this.writePaneLine(`[warning] ${String(warning)}`);
      void this.appendEvent('warning', { message: String(warning) });
    });
    this.manager.on('stderr', (stderr: unknown) => {
      this.writePaneLine(`[stderr] ${String(stderr)}`);
      void this.appendEvent('stderr', { message: String(stderr) });
    });
    this.manager.on('exit', (exit: unknown) => {
      const unexpected = !this.stopping;
      this.state = 'closed';
      this.writePaneLine('[exit] codex app-server stopped');
      void this.appendEvent('exit', asRecord(exit));
      void this.closeServer();
      this.exitHandling = this.retireNativeEndpoint(unexpected).catch(() => undefined);
    });
  }

  /** Resolves once the work started by an app-server exit is done. */
  async exitHandled(): Promise<void> {
    await this.exitHandling;
  }

  /**
   * The app-server behind the native endpoint is gone (PAN-3835 review). The
   * host keeps its pane (and so the owner session) alive, so no owner-teardown
   * hook fires: remove the endpoint record and close the attached native CLI,
   * which would otherwise loop on "Reconnecting to app-server…" forever.
   */
  private async retireNativeEndpoint(unexpected: boolean): Promise<void> {
    if (!this.options.nativeEndpoint) return;
    await rm(this.nativeEndpointFilePath(), { force: true }).catch(() => undefined);
    if (!unexpected) return; // A deliberate stop runs the owner-teardown hooks.
    this.writePaneLine('[terminal] native Codex CLI closed: the app-server exited. Restart the conversation to use Terminal again.');
    try {
      await (this.options.closeCompanion ?? closeCompanionForOwner)(this.options.agentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.writePaneLine(`[warning] could not close the native Codex CLI: ${message}`);
    }
    await this.appendEvent('native-endpoint/retired', {});
  }

  /**
   * Keep host bookkeeping in step with the other client (PAN-3835):
   * - `serverRequest/resolved`: a request the native TUI answered leaves the
   *   dashboard's pending list, so no stale card can answer it twice.
   * - `thread/settings/updated`: a model/effort chosen in the TUI becomes the
   *   host's current setting, so the next dashboard turn does not revert it.
   *   The dashboard effort picker still wins when it is used afterwards.
   */
  private applyOwnerNotification(message: AppServerMessage): void {
    const params = asRecord(message.params);
    if (message.method === 'serverRequest/resolved') {
      const requestId = parseRequestId(params.requestId);
      if (requestId !== undefined && this.pendingRequests.delete(String(requestId))) {
        this.writePaneLine(`[request #${requestId}] resolved`);
      }
      return;
    }
    const threadId = messageThreadId(message);
    if (message.method === 'thread/settings/updated' && (!threadId || this.scopeOf(threadId) === 'owner')) {
      const settings = asRecord(params.threadSettings);
      if (typeof settings.effort === 'string' && settings.effort) this.effort = settings.effort;
      if (typeof settings.model === 'string' && settings.model) this.threadModel = settings.model;
    }
  }

  private scopeOf(threadId: string): ThreadScope {
    return this.manager.threadScope?.(threadId)
      ?? (threadId === this.manager.getState().threadId ? 'owner' : 'unknown');
  }

  /**
   * A thread outside this conversation's tree, positively identified by its
   * `thread/started` (PAN-3835). Ephemeral ones are Codex title threads, and
   * one with a parent is some thread's sub-agent (PAN-4031); anything else is
   * native navigation (`/new`, `/fork` in the attached TUI). Counting navigated
   * threads lets the companion adapter replace a TUI that left the owner
   * thread instead of reusing it.
   */
  private trackForeignThread(message: AppServerMessage): void {
    const threadId = messageThreadId(message);
    if (!threadId) return;
    if (message.id !== undefined) {
      // The client driving that thread answers it; say so once, never silently.
      this.writePaneLine(`[request #${message.id}] for thread ${threadId} outside this conversation; left to the client that opened it`);
      void this.appendEvent('foreign-thread/request', { threadId, id: message.id, method: message.method });
      return;
    }
    if (message.method !== 'thread/started') return;
    const thread = asRecord(asRecord(message.params).thread);
    const parentThreadId = typeof thread.parentThreadId === 'string' && thread.parentThreadId ? thread.parentThreadId : undefined;
    if (thread.ephemeral === true || parentThreadId) {
      this.incidentalThreads.add(threadId);
      return;
    }
    this.noteNavigation(threadId, message.method);
  }

  /**
   * A thread the manager has not classified. Its events still flow, fail open.
   * Codex 0.153.4 announces a TUI `/resume` of an existing thread with no
   * `thread/started` or other resume notification; the only trace is that
   * thread's `thread/status/changed`, which is broadcast to every client. A
   * sub-agent's first status looks the same until its spawn item adopts it.
   */
  private trackUnknownThread(message: AppServerMessage): void {
    const threadId = messageThreadId(message);
    if (threadId && this.scopeOf(threadId) === 'unknown') this.unclassifiedThreads.add(threadId);
  }

  /**
   * Part of the companion Terminal fingerprint (PAN-4031). It only ever goes
   * up, so the fingerprint never changes back and forth. It counts native
   * `/new` and `/fork` (see trackForeignThread) and, when it is read, every
   * thread that is still unclassified: a TUI `/resume` of another thread. A
   * sub-agent is adopted by its spawn item, which completes before the
   * spawning turn goes on, so unclassified threads are not counted while an
   * in-tree `spawnAgent` call is open; they are counted on a later read if no
   * spawn item adopts them. A sub-agent status that arrived before its spawn
   * call started, read in that instant, would bump the epoch once and replace
   * an attached CLI once. That is the safer failure: missing a `/resume`
   * would leave every later Terminal open on the wrong thread.
   */
  private navigationEpoch(): number {
    for (const threadId of this.unclassifiedThreads) {
      if (this.scopeOf(threadId) !== 'unknown') {
        this.unclassifiedThreads.delete(threadId);
      } else if (!this.spawns.hasOpenSpawn()) {
        this.unclassifiedThreads.delete(threadId);
        this.noteNavigation(threadId, 'thread/status/changed');
      }
    }
    return this.navigatedThreads.size;
  }

  private noteNavigation(threadId: string, method: string): void {
    if (this.navigatedThreads.has(threadId) || this.incidentalThreads.has(threadId)) return;
    this.navigatedThreads.add(threadId);
    void this.appendEvent('foreign-thread', { threadId, method });
  }

  /**
   * Activity from the owner and its sub-agent threads keeps the conversation
   * alive for liveness; live cost is the sum of each thread's own running
   * total, each priced at its own model. Threads outside the tree are not
   * this conversation's cost.
   */
  private recordObservedActivity(message: AppServerMessage): void {
    const threadId = messageThreadId(message);
    const scope = threadId ? this.scopeOf(threadId) : 'owner';
    const subAgentModel = threadId && scope === 'descendant' ? this.spawns.modelOf(threadId) : undefined;
    // A sub-agent with no recorded model, or one with no pricing entry, falls
    // back to the owner's current price.
    const threadCost = (subAgentModel ? codexNotificationCost(message, subAgentModel) : undefined)
      ?? codexNotificationCost(message, this.threadModel);
    if (threadCost !== undefined && (scope === 'owner' || scope === 'descendant')) {
      this.threadCosts.set(threadId ?? '', threadCost);
    }

    const now = Date.now();
    const force = message.method === 'turn/completed';
    if (!force && now - this.lastActivityPersistedAt < 5_000) return;

    const costSoFar = this.threadCosts.size > 0
      ? [...this.threadCosts.values()].reduce((sum, cost) => sum + cost, 0)
      : undefined;
    const record = this.options.recordActivity ?? recordAgentActivitySync;
    if (record(this.options.agentId, {
      at: new Date(now).toISOString(),
      ...(costSoFar === undefined ? {} : { costSoFar }),
    })) {
      this.lastActivityPersistedAt = now;
    }
  }

  startPaneInput(): void {
    if (!this.options.stdin || this.input) return;
    this.input = createInterface({ input: this.options.stdin, crlfDelay: Infinity });
    this.input.on('line', (line) => {
      // An unhandled rejection here kills the whole host process, ending the
      // conversation session — render the failure into the pane instead.
      void this.handlePaneLine(line).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.writePaneLine(`[error] ${message}`);
        void this.appendEvent('stdin/error', { message });
      });
    });
  }

  private async handlePaneLine(line: string): Promise<void> {
    const trimmed = line.trim();
    const approval = this.firstPendingApproval();
    if (approval && isApprovalShortcut(trimmed)) {
      const decision = approvalDecision(trimmed);
      this.manager.answerApproval(approval.id, decision);
      this.pendingRequests.delete(String(approval.id));
      this.writePaneLine(`[approval #${approval.id}] ${decision}`);
      await this.appendEvent('stdin/approval', { requestId: approval.id, decision });
      return;
    }
    if (!trimmed) return;
    const result = await this.handleMessageOp({ op: 'message', content: line });
    if (result.status >= 400) this.writePaneLine(`[error] ${String(result.body.error ?? 'message failed')}`);
  }

  private firstPendingApproval(): PendingAppServerRequest | undefined {
    return [...this.pendingRequests.values()].find(request => /requestApproval/i.test(request.method));
  }

  private renderNotification(message: AppServerMessage): void {
    const params = asRecord(message.params);
    const label = this.threadLabel(message);
    if (message.method === 'turn/started') {
      this.writePaneLine(`[turn${label}] started`);
      return;
    }
    if (message.method === 'turn/completed') {
      this.writePaneLine(`[turn${label}] completed`);
      return;
    }
    if (message.method === 'error') {
      this.writePaneLine(`[error${label}] ${formatPaneValue(params.error ?? params.message ?? message.params)}`);
      return;
    }
    const text = typeof params.text === 'string' ? params.text : undefined;
    if (text) this.writePaneLine(`[assistant${label}] ${text}`);
  }

  /**
   * ` sub:<id>` for a sub-agent line, ` thread:<id>` for an unclassified
   * thread, empty for the owner (PAN-4031). The id is the thread id's last
   * 8 characters: Codex thread ids are UUIDv7, whose leading characters are a
   * timestamp shared by threads started together.
   */
  private threadLabel(message: AppServerMessage): string {
    const threadId = messageThreadId(message);
    if (!threadId) return '';
    const scope = this.scopeOf(threadId);
    if (scope === 'owner') return '';
    return ` ${scope === 'descendant' ? 'sub' : 'thread'}:${threadId.slice(-8)}`;
  }

  private renderRequest(message: AppServerMessage): void {
    if (!message.method || message.id === undefined) return;
    const params = asRecord(message.params);
    if (/requestApproval/i.test(message.method)) {
      const command = formatPaneValue(params.command ?? params.path ?? params);
      this.writePaneLine(`[approval #${message.id}] command: ${command} - reply via dashboard or type y/n`);
      return;
    }
    if (/requestUserInput|elicitation/i.test(message.method)) {
      this.writePaneLine(`[input #${message.id}] reply via dashboard`);
    }
  }

  private writePaneLine(line: string): void {
    this.options.stdout?.write(`${stripControl(line)}\n`);
  }

  private async listen(): Promise<void> {
    const socketPath = this.socketPath();
    if (existsSync(socketPath)) await rm(socketPath, { force: true });
    this.server = createServer(async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
      }
      if (req.headers[BRIDGE_TOKEN_HEADER] !== this.token) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', async () => {
        let payload: unknown;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        } catch {
          sendJson(res, 400, { error: 'invalid JSON body' });
          return;
        }
        const result = await this.handleOp(payload);
        sendJson(res, result.status, result.body);
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(socketPath, () => {
        this.server!.off('error', reject);
        resolve();
      });
    });
    await chmod(socketPath, 0o600);
  }

  private async appendEvent(type: string, data: JsonRecord): Promise<void> {
    const line = JSON.stringify({ ts: new Date().toISOString(), type, ...data });
    try {
      await mkdir(this.agentDir(), { recursive: true });
      await appendFile(join(this.agentDir(), 'appserver-events.jsonl'), `${line}\n`, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private agentDir(): string {
    return join(this.overdeckHome, 'agents', this.options.agentId);
  }

  private socketDir(): string {
    return join(this.overdeckHome, 'sockets');
  }

  private socketPath(): string {
    return join(this.socketDir(), `appserver-${this.options.agentId}.sock`);
  }

  private tokenPath(): string {
    return join(this.agentDir(), 'appserver-token');
  }

  private nativeEndpointFilePath(): string {
    return join(this.agentDir(), CODEX_NATIVE_ENDPOINT_FILE);
  }

  private publicState(managerState: Readonly<CodexAppServerState>): string {
    if (this.state === 'closed') return 'closed';
    if (this.pendingRequests.size > 0) return 'awaiting-approval';
    if (managerState.activeTurnId || managerState.state === 'running') return 'running';
    if (managerState.state === 'error') return 'error';
    if (this.state === 'starting') return 'starting';
    return 'ready';
  }
}

export function codexNotificationCost(message: AppServerMessage, model?: string): number | undefined {
  if (message.method !== 'thread/tokenUsage/updated' || !model) return undefined;
  const params = asRecord(message.params);
  const tokenUsage = asRecord(params.tokenUsage);
  const total = asRecord(tokenUsage.total);
  const inputTokens = numberValue(total.inputTokens);
  const cachedInputTokens = numberValue(total.cachedInputTokens);
  const outputTokens = numberValue(total.outputTokens);
  const pricing = getPricingSync('openai', model);
  if (!pricing || (inputTokens === 0 && cachedInputTokens === 0 && outputTokens === 0)) return undefined;
  return calculateCostSync({
    inputTokens: Math.max(0, inputTokens - cachedInputTokens),
    cacheReadTokens: cachedInputTokens,
    outputTokens,
  }, pricing);
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function sendJson(res: ServerResponse, status: number, body: JsonRecord): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function parseRequestId(value: unknown): string | number | undefined {
  if (typeof value === 'string' || typeof value === 'number') return value;
  return undefined;
}

function parseAnswers(value: unknown): Record<string, string[]> | undefined {
  const record = asRecord(value);
  const answers: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (!Array.isArray(raw) || !raw.every(item => typeof item === 'string')) return undefined;
    answers[key] = raw;
  }
  return answers;
}

/** Poll for a file Codex writes asynchronously (the rollout of a new thread). */
async function waitForPath(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await access(path).then(() => true, () => false)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

interface HostArgs {
  resumeThreadId?: string;
  model?: string;
  effort?: string;
  developerInstructionFiles: string[];
  nativeEndpoint: boolean;
}

export function parseArgs(argv: string[]): HostArgs {
  const parsed: HostArgs = {
    developerInstructionFiles: [],
    nativeEndpoint: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--native-endpoint') parsed.nativeEndpoint = true;
    else if (arg === '--resume') parsed.resumeThreadId = argv[++index];
    else if (arg === '--model') parsed.model = argv[++index];
    else if (arg === '--developer-instructions-file') {
      const file = argv[++index];
      if (file) parsed.developerInstructionFiles.push(file);
    }
    else if (arg === '--effort') parsed.effort = argv[++index];
  }
  return parsed;
}

/** Default companion close for an app-server that died under a live pane (loaded lazily). */
async function closeCompanionForOwner(ownerSession: string): Promise<void> {
  const { closeCompanionTerminalForOwner } = await import('../overdeck/companion-terminal/index.js');
  await closeCompanionTerminalForOwner(ownerSession);
}

type ExitSignal = 'SIGTERM' | 'SIGINT' | 'SIGHUP';

/**
 * The app-server child must die with its host on every exit path (PAN-3835
 * review): in `--listen unix://` mode codex does not exit when its stdin
 * closes, so an orphan would keep the thread loaded. SIGHUP is what tmux sends
 * when the pane's session is killed; its default action would skip every
 * handler. `exit` covers uncaught errors and plain returns. SIGKILL cannot be
 * handled; the manager's `app.pid` check reaps that orphan on the next start.
 */
export function installHostExitHandlers(
  host: Pick<CodexAppServerHost, 'shutdownForSignal' | 'killRuntimeSync'>,
  proc: Pick<NodeJS.Process, 'once' | 'on' | 'exit'> = process,
): void {
  const exitCodes: Record<ExitSignal, number> = { SIGTERM: 0, SIGINT: 130, SIGHUP: 129 };
  for (const signal of Object.keys(exitCodes) as ExitSignal[]) {
    proc.once(signal, () => {
      void host.shutdownForSignal(signal, signal === 'SIGTERM' ? 5_000 : 0).finally(() => proc.exit(exitCodes[signal]));
    });
  }
  proc.on('exit', () => host.killRuntimeSync());
}

async function main(): Promise<void> {
  const agentId = process.env.OVERDECK_AGENT_ID;
  if (!agentId) throw new Error('OVERDECK_AGENT_ID is required for codex app-server host.');
  const args = parseArgs(process.argv.slice(2));
  const developerInstructions = (
    await Promise.all(args.developerInstructionFiles.map((file) => readFile(file, 'utf-8')))
  ).filter((content) => content.trim()).join('\n\n---\n\n');
  const host = new CodexAppServerHost({
    agentId,
    cwd: process.cwd(),
    model: args.model,
    effort: args.effort,
    resumeThreadId: args.resumeThreadId,
    developerInstructions: developerInstructions || undefined,
    codexHome: process.env.CODEX_HOME,
    nativeEndpoint: args.nativeEndpoint,
    stdin: process.stdin,
    stdout: process.stdout,
  });
  installHostExitHandlers(host);
  await host.start();
}

function formatPaneValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stripControl(value: string): string {
  return value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function isApprovalShortcut(value: string): boolean {
  return /^(?:y|yes|1|n|no|0)$/i.test(value);
}

function approvalDecision(value: string): string {
  return /^(?:y|yes|1)$/i.test(value) ? 'accept' : 'reject';
}

if (basename(fileURLToPath(import.meta.url)) === basename(process.argv[1] ?? '')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
