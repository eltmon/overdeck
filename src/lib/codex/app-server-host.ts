import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
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
    this.state = 'ready';
  }

  async stop(): Promise<void> {
    this.state = 'closed';
    this.manager.stop();
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  status(): JsonRecord {
    const managerState = this.manager.getState();
    return {
      state: this.state === 'ready' ? 'ready' : this.state,
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
    this.manager.answerApproval(requestId, decision);
    this.pendingRequests.delete(String(requestId));
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
    void this.appendEvent('op/user-input', { requestId });
    return { status: 200, body: { ok: true } };
  }

  private attachManagerEvents(): void {
    this.manager.on('notification', (message: AppServerMessage) => {
      const threadId = extractThreadId(message);
      if (message.method === 'thread/started' && threadId) writeThreadId(this.options.agentId, threadId);
      void this.appendEvent('notification', message as JsonRecord);
    });
    this.manager.on('request', (message: AppServerMessage) => {
      if (message.id === undefined || !message.method) return;
      this.pendingRequests.set(String(message.id), { id: message.id, method: message.method, params: message.params });
      void this.appendEvent('request', message as JsonRecord);
    });
    this.manager.on('warning', (warning: unknown) => {
      void this.appendEvent('warning', { message: String(warning) });
    });
    this.manager.on('stderr', (stderr: unknown) => {
      void this.appendEvent('stderr', { message: String(stderr) });
    });
    this.manager.on('exit', (exit: unknown) => {
      this.state = 'closed';
      void this.appendEvent('exit', asRecord(exit));
    });
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
        sendJson(res, 401, { error: 'unauthorized' });
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
    await appendFile(join(this.agentDir(), 'appserver-events.jsonl'), `${line}\n`, 'utf-8');
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
  });
  process.once('SIGTERM', () => void host.stop().finally(() => process.exit(0)));
  process.once('SIGINT', () => void host.stop().finally(() => process.exit(130)));
  await host.start();
}

if (basename(fileURLToPath(import.meta.url)) === basename(process.argv[1] ?? '')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
