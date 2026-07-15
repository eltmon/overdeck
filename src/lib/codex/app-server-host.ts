import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import {
  CodexAppServerManager,
  type AppServerMessage,
  type CodexAppServerState,
  type ThreadOptions,
  type TurnOptions,
} from './app-server-manager.js';
import { BRIDGE_TOKEN_HEADER } from '../bridge-token.js';
import { codexHome, writeThreadId } from '../runtimes/codex.js';

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
  startThread(options: ThreadOptions): Promise<unknown>;
  resumeThread(threadId: string, options: ThreadOptions): Promise<unknown>;
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
  overdeckHome?: string;
  codexHome?: string;
  manager?: AppServerHostManager;
  stdin?: Readable;
  stdout?: Writable;
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
  private state: 'starting' | 'ready' | 'closed' = 'starting';

  constructor(private readonly options: CodexAppServerHostOptions) {
    this.overdeckHome = options.overdeckHome ?? process.env.OVERDECK_HOME ?? join(homedir(), '.overdeck');
    this.manager = options.manager ?? new CodexAppServerManager({
      cwd: options.cwd,
      codexHome: options.codexHome ?? codexHome(),
    });
    this.threadModel = options.model;
    this.attachManagerEvents();
  }

  async start(): Promise<void> {
    await mkdir(this.agentDir(), { recursive: true });
    await mkdir(this.socketDir(), { recursive: true });
    this.token = randomUUID();
    await writeFile(this.tokenPath(), `${this.token}\n`, { mode: 0o600 });
    await this.manager.start();
    await this.listen();
    this.startPaneInput();
    this.state = 'ready';
  }

  async stop(): Promise<void> {
    this.state = 'closed';
    this.input?.close();
    this.input = undefined;
    this.manager.stop();
    await this.closeServer();
  }

  async shutdownForSignal(signal: 'SIGTERM' | 'SIGINT', graceMs = 5_000): Promise<void> {
    await this.appendEvent('lifecycle/signal', { signal });
    const state = this.manager.getState();
    if (state.threadId && state.activeTurnId) {
      await this.appendEvent('op/interrupt', { reason: signal });
      await this.manager.interruptTurn();
    }
    await this.appendEvent('lifecycle/child-sigterm', { signal });
    this.manager.stop();
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
    };
  }

  async handleOp(op: unknown): Promise<HostOpResult> {
    const body = asRecord(op);
    const name = typeof body.op === 'string' ? body.op : '';
    try {
      if (name === 'status') return { status: 200, body: this.status() };
      if (name === 'message') return await this.handleMessageOp(body);
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
    const requestedEffort = typeof op.effort === 'string' ? op.effort : this.options.effort;
    const model = requestedModel ?? this.threadModel;
    if (!model) {
      return {
        status: 400,
        body: { error: 'model is required before starting a Codex app-server turn' },
      };
    }

    const state = this.manager.getState();
    if (!state.threadId) {
      const threadOptions: ThreadOptions = { model, cwd: this.options.cwd, runtimeMode: 'default' };
      if (this.options.resumeThreadId) await this.manager.resumeThread(this.options.resumeThreadId, threadOptions);
      else await this.manager.startThread(threadOptions);
      this.threadModel = model;
    }

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
    this.manager.answerUserInput(requestId, answers);
    this.pendingRequests.delete(String(requestId));
    this.writePaneLine(`[input #${requestId}] answered`);
    void this.appendEvent('op/user-input', { requestId });
    return { status: 200, body: { ok: true } };
  }

  private attachManagerEvents(): void {
    this.manager.on('notification', (message: AppServerMessage) => {
      const threadId = extractThreadId(message);
      if (message.method === 'thread/started' && threadId) writeThreadId(this.options.agentId, threadId);
      this.renderNotification(message);
      void this.appendEvent('notification', message as JsonRecord);
    });
    this.manager.on('request', (message: AppServerMessage) => {
      if (message.id === undefined || !message.method) return;
      this.pendingRequests.set(String(message.id), { id: message.id, method: message.method, params: message.params });
      this.renderRequest(message);
      void this.appendEvent('request', message as JsonRecord);
    });
    this.manager.on('warning', (warning: unknown) => {
      this.writePaneLine(`[warning] ${String(warning)}`);
      void this.appendEvent('warning', { message: String(warning) });
    });
    this.manager.on('stderr', (stderr: unknown) => {
      this.writePaneLine(`[stderr] ${String(stderr)}`);
      void this.appendEvent('stderr', { message: String(stderr) });
    });
    this.manager.on('exit', (exit: unknown) => {
      this.state = 'closed';
      this.writePaneLine('[exit] codex app-server stopped');
      void this.appendEvent('exit', asRecord(exit));
      void this.closeServer();
    });
  }

  startPaneInput(): void {
    if (!this.options.stdin || this.input) return;
    this.input = createInterface({ input: this.options.stdin, crlfDelay: Infinity });
    this.input.on('line', (line) => {
      void this.handlePaneLine(line);
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
    if (message.method === 'turn/started') {
      this.writePaneLine('[turn] started');
      return;
    }
    if (message.method === 'turn/completed') {
      this.writePaneLine('[turn] completed');
      return;
    }
    if (message.method === 'error') {
      this.writePaneLine(`[error] ${formatPaneValue(params.error ?? params.message ?? message.params)}`);
      return;
    }
    const text = typeof params.text === 'string' ? params.text : undefined;
    if (text) this.writePaneLine(`[assistant] ${text}`);
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

  private publicState(managerState: Readonly<CodexAppServerState>): string {
    if (this.state === 'closed') return 'closed';
    if (this.pendingRequests.size > 0) return 'awaiting-approval';
    if (managerState.activeTurnId || managerState.state === 'running') return 'running';
    if (managerState.state === 'error') return 'error';
    if (this.state === 'starting') return 'starting';
    return 'ready';
  }
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

function extractThreadId(message: AppServerMessage): string | undefined {
  const params = asRecord(message.params);
  const thread = asRecord(params.thread);
  return typeof thread.id === 'string' ? thread.id : typeof params.threadId === 'string' ? params.threadId : undefined;
}

function parseArgs(argv: string[]): { resumeThreadId?: string; model?: string } {
  const parsed: { resumeThreadId?: string; model?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--resume') parsed.resumeThreadId = argv[++index];
    else if (arg === '--model') parsed.model = argv[++index];
  }
  return parsed;
}

async function main(): Promise<void> {
  const agentId = process.env.OVERDECK_AGENT_ID;
  if (!agentId) throw new Error('OVERDECK_AGENT_ID is required for codex app-server host.');
  const args = parseArgs(process.argv.slice(2));
  const host = new CodexAppServerHost({
    agentId,
    cwd: process.cwd(),
    model: args.model,
    resumeThreadId: args.resumeThreadId,
    codexHome: process.env.CODEX_HOME,
    stdin: process.stdin,
    stdout: process.stdout,
  });
  process.once('SIGTERM', () => void host.shutdownForSignal('SIGTERM').finally(() => process.exit(0)));
  process.once('SIGINT', () => void host.shutdownForSignal('SIGINT', 0).finally(() => process.exit(130)));
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
