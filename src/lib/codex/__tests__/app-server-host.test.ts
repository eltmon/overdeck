import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexAppServerHost } from '../app-server-host.js';
import type { CodexAppServerState, ThreadOptions, TurnOptions } from '../app-server-manager.js';

class FakeManager extends EventEmitter {
  readonly startThreadCalls: ThreadOptions[] = [];
  readonly resumeThreadCalls: Array<{ threadId: string; options: ThreadOptions }> = [];
  readonly startTurnCalls: Array<{ text: string; options?: TurnOptions }> = [];
  readonly approvals: Array<{ id: string | number; decision: string }> = [];
  readonly userInputs: Array<{ id: string | number; answers: Record<string, string[]> }> = [];
  interruptCalls = 0;
  private state: CodexAppServerState = { state: 'ready' };

  async start(): Promise<void> {}

  stop(): void {
    this.state = { ...this.state, state: 'closed' };
  }

  getState(): Readonly<CodexAppServerState> {
    return { ...this.state };
  }

  async startThread(options: ThreadOptions): Promise<void> {
    this.startThreadCalls.push(options);
    this.state = { state: 'idle', threadId: 'thread-started' };
    this.emit('notification', { method: 'thread/started', params: { thread: { id: 'thread-started' } } });
  }

  async resumeThread(threadId: string, options: ThreadOptions): Promise<void> {
    this.resumeThreadCalls.push({ threadId, options });
    this.state = { state: 'idle', threadId };
    this.emit('notification', { method: 'thread/started', params: { thread: { id: threadId } } });
  }

  async startTurn(text: string, options?: TurnOptions): Promise<void> {
    this.startTurnCalls.push({ text, options });
    this.state = { ...this.state, state: 'running', activeTurnId: 'turn-1' };
    this.emit('notification', { method: 'turn/started', params: { turn: { id: 'turn-1' } } });
    this.emit('notification', { method: 'item/completed', params: { text: 'assistant delta' } });
  }

  async interruptTurn(): Promise<void> {
    this.interruptCalls += 1;
  }

  answerApproval(id: string | number, decision: string): void {
    this.approvals.push({ id, decision });
  }

  answerUserInput(id: string | number, answers: Record<string, string[]>): void {
    this.userInputs.push({ id, answers });
  }
}

let tmpHome: string;
let overdeckHome: string;
let originalHome: string | undefined;

function makeHost(manager: FakeManager, opts: Partial<ConstructorParameters<typeof CodexAppServerHost>[0]> = {}): CodexAppServerHost {
  return new CodexAppServerHost({
    agentId: 'agent-host-test',
    cwd: '/tmp/workspace',
    overdeckHome,
    manager,
    ...opts,
  });
}

function captureStdout(): { stdout: Writable; lines: string[] } {
  const lines: string[] = [];
  let buffer = '';
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      buffer += String(chunk);
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        lines.push(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      callback();
    },
  });
  return { stdout, lines };
}

function readEventLog(): Array<Record<string, unknown>> {
  return readFileSync(join(overdeckHome, 'agents', 'agent-host-test', 'appserver-events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('CodexAppServerHost', () => {
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'pan-appserver-host-'));
    overdeckHome = join(tmpHome, '.overdeck');
    mkdirSync(join(overdeckHome, 'agents', 'agent-host-test'), { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('rejects a first message without a model before starting a thread', async () => {
    const manager = new FakeManager();
    const host = makeHost(manager);

    const result = await host.handleOp({ op: 'message', content: 'hello' });

    expect(result).toEqual({
      status: 400,
      body: { error: 'model is required before starting a Codex app-server turn' },
    });
    expect(manager.startThreadCalls).toHaveLength(0);
    expect(manager.startTurnCalls).toHaveLength(0);
  });

  it('starts a thread, persists threadId, starts a turn, and logs manager notifications', async () => {
    const manager = new FakeManager();
    const host = makeHost(manager);

    const result = await host.handleOp({ op: 'message', content: 'build it', model: 'gpt-5.6-sol', effort: 'high' });

    expect(result.status).toBe(200);
    expect(manager.startThreadCalls).toEqual([{ model: 'gpt-5.6-sol', cwd: '/tmp/workspace', runtimeMode: 'default' }]);
    expect(manager.startTurnCalls).toEqual([{ text: 'build it', options: { model: 'gpt-5.6-sol', effort: 'high' } }]);
    expect(readFileSync(join(overdeckHome, 'agents', 'agent-host-test', 'codex-thread-id'), 'utf8')).toBe('thread-started');
    await vi.waitFor(() => {
      expect(readEventLog()).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'notification', method: 'item/completed' }),
      ]));
    });
    expect(readEventLog()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'notification', method: 'thread/started' }),
      expect.objectContaining({ type: 'notification', method: 'item/completed' }),
    ]));
  });

  it('passes per-turn model changes through natively on turn/start', async () => {
    const manager = new FakeManager();
    const host = makeHost(manager);

    await host.handleOp({ op: 'message', content: 'first', model: 'gpt-5.6-sol' });
    await host.handleOp({ op: 'message', content: 'second', model: 'gpt-5.6-codex' });

    expect(manager.startThreadCalls).toHaveLength(1);
    expect(manager.startTurnCalls.at(-1)).toEqual({ text: 'second', options: { model: 'gpt-5.6-codex' } });
  });

  it('resumes an existing thread on the first message when resumeThreadId is supplied', async () => {
    const manager = new FakeManager();
    const host = makeHost(manager, { resumeThreadId: 'thread-existing' });

    await host.handleOp({ op: 'message', content: 'resume work', model: 'gpt-5.6-sol' });

    expect(manager.resumeThreadCalls).toEqual([
      { threadId: 'thread-existing', options: { model: 'gpt-5.6-sol', cwd: '/tmp/workspace', runtimeMode: 'default' } },
    ]);
    expect(manager.startThreadCalls).toHaveLength(0);
  });

  it('resolves approval and user-input request ids through the manager', async () => {
    const manager = new FakeManager();
    const host = makeHost(manager);
    manager.emit('request', { id: 71, method: 'item/commandExecution/requestApproval', params: { command: 'git status' } });
    manager.emit('request', { id: 'prompt-1', method: 'user/input', params: { prompt: 'choose' } });

    expect(host.status().pendingRequests).toHaveLength(2);
    expect(await host.handleOp({ op: 'approval', requestId: 71, decision: 'accept' })).toEqual({ status: 200, body: { ok: true } });
    expect(await host.handleOp({ op: 'user-input', requestId: 'prompt-1', answers: { choice: ['a'] } })).toEqual({ status: 200, body: { ok: true } });

    expect(manager.approvals).toEqual([{ id: 71, decision: 'accept' }]);
    expect(manager.userInputs).toEqual([{ id: 'prompt-1', answers: { choice: ['a'] } }]);
    expect(host.status().pendingRequests).toHaveLength(0);
  });

  it('forwards interrupt ops to the manager', async () => {
    const manager = new FakeManager();
    const host = makeHost(manager);

    expect(await host.handleOp({ op: 'interrupt' })).toEqual({ status: 200, body: { ok: true, state: { state: 'ready' } } });
    expect(manager.interruptCalls).toBe(1);
  });

  it('renders user turns and assistant text to stdout as sanitized plain text lines', async () => {
    const manager = new FakeManager();
    const { stdout, lines } = captureStdout();
    const host = makeHost(manager, { stdout });

    await host.handleOp({ op: 'message', content: 'hello\u001b[31m', model: 'gpt-5.6-sol' });
    await vi.waitFor(() => expect(lines).toEqual(expect.arrayContaining([
      '[user] hello',
      '[assistant] assistant delta',
    ])));

    expect(lines.join('\n')).not.toMatch(/\x1B\[/);
  });

  it('renders approval prompts with the command and y/n affordance', () => {
    const manager = new FakeManager();
    const { stdout, lines } = captureStdout();
    makeHost(manager, { stdout });

    manager.emit('request', { id: 71, method: 'item/commandExecution/requestApproval', params: { command: 'git status' } });

    expect(lines).toContain('[approval #71] command: git status - reply via dashboard or type y/n');
  });

  it('starts a turn from a non-approval stdin line', async () => {
    const manager = new FakeManager();
    const stdin = new PassThrough();
    const host = makeHost(manager, { stdin, model: 'gpt-5.6-sol' });
    host.startPaneInput();

    stdin.write('typed turn\n');

    await vi.waitFor(() => expect(manager.startTurnCalls.at(-1)).toEqual({ text: 'typed turn', options: {} }));
  });

  it('resolves a pending approval from y on stdin without starting a turn', async () => {
    const manager = new FakeManager();
    const stdin = new PassThrough();
    const host = makeHost(manager, { stdin, model: 'gpt-5.6-sol' });
    manager.emit('request', { id: 71, method: 'item/commandExecution/requestApproval', params: { command: 'git status' } });
    host.startPaneInput();

    stdin.write('y\n');

    await vi.waitFor(() => expect(manager.approvals).toEqual([{ id: 71, decision: 'accept' }]));
    expect(manager.startTurnCalls).toHaveLength(0);
  });
});
