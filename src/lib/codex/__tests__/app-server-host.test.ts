import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexAppServerHost, codexNotificationCost } from '../app-server-host.js';
import type { CodexAppServerState, CodexAppServerTransportInfo, ThreadOptions, TurnOptions } from '../app-server-manager.js';
import { readSessionIndexSync } from '../../session-history.js';

const FAKE_ROLLOUT_PATH = '/fake/rollout/for-thread-started.jsonl';

// Bounded background capture in attachManagerEvents() polls the real
// filesystem for the rollout file; a fake resolved promise stands in for
// that poll instead of a real 120s wait (per the fake-timers-over-real-I/O
// rule — the poll itself is real fs, not a delay a fake clock can drive).
vi.mock('../../runtimes/codex.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../runtimes/codex.js')>();
  return { ...actual, waitForCodexRollout: vi.fn(async () => FAKE_ROLLOUT_PATH) };
});

class FakeManager extends EventEmitter {
  readonly startThreadCalls: ThreadOptions[] = [];
  readonly resumeThreadCalls: Array<{ threadId: string; options: ThreadOptions; strict?: boolean }> = [];
  readonly startTurnCalls: Array<{ text: string; options?: TurnOptions }> = [];
  readonly approvals: Array<{ id: string | number; decision: string }> = [];
  readonly userInputs: Array<{ id: string | number; answers: Record<string, string[]> }> = [];
  interruptCalls = 0;
  stopCalls = 0;
  private state: CodexAppServerState = { state: 'ready' };

  async start(): Promise<void> {}

  stop(): void {
    this.stopCalls += 1;
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

  async resumeThread(threadId: string, options: ThreadOptions, resumeOptions?: { strict?: boolean }): Promise<void> {
    this.resumeThreadCalls.push({ threadId, options, ...(resumeOptions?.strict ? { strict: true } : {}) });
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

  setState(state: CodexAppServerState): void {
    this.state = state;
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
let startedHosts: CodexAppServerHost[] = [];

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

async function postHost(agentId: string, token: string | undefined, body: unknown): Promise<{ status: number; body: string }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        socketPath: join(overdeckHome, 'sockets', `appserver-${agentId}.sock`),
        path: '/',
        method: 'POST',
        agent: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(token ? { 'x-overdeck-bridge-token': token } : {}),
        },
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf-8');
        res.on('data', chunk => { responseBody += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: responseBody }));
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('CodexAppServerHost', () => {
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'pan-appserver-host-'));
    overdeckHome = join(tmpHome, '.overdeck');
    mkdirSync(join(overdeckHome, 'agents', 'agent-host-test'), { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    startedHosts = [];
  });

  afterEach(async () => {
    await Promise.all(startedHosts.map(host => host.stop()));
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

  it('returns 403 for missing or wrong socket tokens without executing an op', async () => {
    const manager = new FakeManager();
    const host = makeHost(manager);
    startedHosts.push(host);
    await host.start();

    expect(await postHost('agent-host-test', undefined, { op: 'interrupt' })).toMatchObject({ status: 403 });
    expect(await postHost('agent-host-test', 'wrong-token', { op: 'interrupt' })).toMatchObject({ status: 403 });
    expect(manager.interruptCalls).toBe(0);
  });

  it('status op reflects manager state and pending requests', async () => {
    const manager = new FakeManager();
    manager.setState({ state: 'running', threadId: 'thread-1', activeTurnId: 'turn-1' });
    const host = makeHost(manager);
    manager.emit('request', { id: 71, method: 'item/commandExecution/requestApproval', params: { command: 'git status' } });

    expect(host.status()).toMatchObject({
      state: 'awaiting-approval',
      managerState: 'running',
      threadId: 'thread-1',
      activeTurnId: 'turn-1',
      pendingRequests: [{ id: 71, method: 'item/commandExecution/requestApproval', params: { command: 'git status' } }],
    });
    await vi.waitFor(() => {
      expect(readEventLog()).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'request', id: 71, method: 'item/commandExecution/requestApproval' }),
      ]));
    });
  });

  it('uses High by default and applies acknowledged effort changes to subsequent turns', async () => {
    const manager = new FakeManager();
    const host = makeHost(manager);
    await host.handleOp({ op: 'message', content: 'first', model: 'gpt-6-astra' });
    expect(manager.startTurnCalls.at(-1)?.options?.effort).toBe('high');
    expect((await host.handleOp({ op: 'set-effort', effort: 'low' })).status).toBe(200);
    manager.setState({ state: 'idle', threadId: 'thread-started' });
    await host.handleOp({ op: 'message', content: 'second' });
    expect(manager.startTurnCalls.at(-1)?.options?.effort).toBe('low');
    expect((await host.handleOp({ op: 'set-effort', effort: 'invalid' })).status).toBe(400);
    manager.setState({ state: 'idle', threadId: 'thread-started' });
    await host.handleOp({ op: 'message', content: 'third' });
    expect(manager.startTurnCalls.at(-1)?.options?.effort).toBe('low');
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
    await vi.waitFor(() => {
      expect(readSessionIndexSync('agent-host-test')).toEqual(expect.arrayContaining([
        expect.objectContaining({
          sessionId: 'thread-started',
          source: 'app-server',
          harness: 'codex',
          path: FAKE_ROLLOUT_PATH,
        }),
      ]));
    });
  });

  it('projects app-server notifications into agent activity without tmux', async () => {
    const manager = new FakeManager();
    const recordActivity = vi.fn(() => true);
    makeHost(manager, { model: 'gpt-5.6-sol', recordActivity });

    manager.emit('notification', {
      method: 'thread/tokenUsage/updated',
      params: { tokenUsage: { total: { inputTokens: 2_000, cachedInputTokens: 1_000, outputTokens: 100 } } },
    });

    expect(recordActivity).toHaveBeenCalledWith('agent-host-test', expect.objectContaining({
      at: expect.any(String),
      costSoFar: codexNotificationCost({
        method: 'thread/tokenUsage/updated',
        params: { tokenUsage: { total: { inputTokens: 2_000, cachedInputTokens: 1_000, outputTokens: 100 } } },
      }, 'gpt-5.6-sol'),
    }));
  });

  it('passes per-turn model changes through natively on turn/start', async () => {
    const manager = new FakeManager();
    const host = makeHost(manager);

    await host.handleOp({ op: 'message', content: 'first', model: 'gpt-5.6-sol' });
    await host.handleOp({ op: 'message', content: 'second', model: 'gpt-5.6-codex' });

    expect(manager.startThreadCalls).toHaveLength(1);
    expect(manager.startTurnCalls.at(-1)).toEqual({ text: 'second', options: { model: 'gpt-5.6-codex', effort: 'high' } });
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

  it('rejects approval responses for requests that are no longer pending', async () => {
    const manager = new FakeManager();
    const host = makeHost(manager);
    manager.emit('request', { id: 72, method: 'item/commandExecution/requestApproval', params: { command: 'git status' } });

    expect(await host.handleOp({ op: 'approval', requestId: 71, decision: 'accept' })).toEqual({
      status: 409,
      body: { error: 'approval request 71 is not pending' },
    });
    expect(manager.approvals).toEqual([]);
    expect(host.status().pendingRequests).toHaveLength(1);
  });

  it('forwards interrupt ops to the manager', async () => {
    const manager = new FakeManager();
    const host = makeHost(manager);

    expect(await host.handleOp({ op: 'interrupt' })).toEqual({ status: 200, body: { ok: true, state: { state: 'ready' } } });
    expect(manager.interruptCalls).toBe(1);
  });

  it('interrupts a running turn before stopping on SIGTERM using fake timers', async () => {
    vi.useFakeTimers();
    const manager = new FakeManager();
    manager.setState({ state: 'running', threadId: 'thread-1', activeTurnId: 'turn-1' });
    const host = makeHost(manager);

    const shutdown = host.shutdownForSignal('SIGTERM');
    await vi.waitFor(() => expect(manager.interruptCalls).toBe(1));
    await vi.runAllTimersAsync();
    await shutdown;

    expect(manager.interruptCalls).toBe(1);
    expect(manager.stopCalls).toBe(1);
    expect(readEventLog().map(entry => entry.type)).toEqual([
      'lifecycle/signal',
      'op/interrupt',
      'lifecycle/child-sigterm',
    ]);
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

    await vi.waitFor(() => expect(manager.startTurnCalls.at(-1)).toEqual({ text: 'typed turn', options: { effort: 'high' } }));
  });

  it('renders a stdin turn failure into the pane instead of crashing the host', async () => {
    const manager = new FakeManager();
    manager.startTurn = async () => {
      throw new Error('Cannot start a turn before a thread is active.');
    };
    const stdin = new PassThrough();
    const { stdout, lines } = captureStdout();
    const host = makeHost(manager, { stdin, stdout, model: 'gpt-5.6-sol' });
    host.startPaneInput();

    stdin.write('typed turn\n');

    await vi.waitFor(() => expect(lines).toContain('[error] Cannot start a turn before a thread is active.'));
    expect(readEventLog()).toContainEqual(expect.objectContaining({ type: 'stdin/error' }));
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

  describe('native terminal attachment (PAN-3835)', () => {
    const agentDir = () => join(overdeckHome, 'agents', 'agent-host-test');
    const socketPath = () => join(agentDir(), 'codex-native', 'app.sock');

    /** A manager connected through the native endpoint whose thread/start reports a rollout path. */
    class NativeFakeManager extends FakeManager {
      transport: CodexAppServerTransportInfo = { kind: 'unix', endpoint: `unix://${socketPath()}`, cliVersion: '0.153.4' };

      async start(): Promise<void> {
        writeFileSync(socketPath(), '', { mode: 0o666 });
      }

      getTransportInfo(): CodexAppServerTransportInfo {
        return this.transport;
      }
    }

    /** NativeFakeManager whose thread/start response carries the rollout path, like codex does. */
    function withRollout(manager: NativeFakeManager, rolloutPath: string): NativeFakeManager {
      const start = manager.startThread.bind(manager);
      (manager as unknown as { startThread: (options: ThreadOptions) => Promise<unknown> }).startThread = async (options) => {
        await start(options);
        return { thread: { id: 'thread-started', path: rolloutPath } };
      };
      return manager;
    }

    it('records a private endpoint and reports live capability', async () => {
      const manager = new NativeFakeManager();
      const host = makeHost(manager, { nativeEndpoint: true });
      startedHosts.push(host);
      await host.start();

      expect(readFileSync(join(agentDir(), 'codex-native-endpoint'), 'utf8')).toBe(`unix://${socketPath()}\n`);
      expect(statSync(join(agentDir(), 'codex-native')).mode & 0o777).toBe(0o700);
      expect(statSync(socketPath()).mode & 0o777).toBe(0o600);
      expect(host.status()).toMatchObject({
        generation: expect.stringMatching(/^[0-9a-f-]{36}$/),
        nativeEndpoint: { available: true, endpoint: `unix://${socketPath()}`, cliVersion: '0.153.4' },
        navigationEpoch: 0,
      });

      await host.stop();
      expect(existsSync(join(agentDir(), 'codex-native-endpoint'))).toBe(false);
    });

    it('reports why a stdio host cannot attach and leaves no endpoint record', async () => {
      const manager = new NativeFakeManager();
      manager.transport = { kind: 'stdio', unavailableReason: 'cli-unsupported', cliVersion: '0.150.0' };
      manager.start = async () => undefined;
      const host = makeHost(manager, { nativeEndpoint: true });
      startedHosts.push(host);
      await host.start();

      expect(existsSync(join(agentDir(), 'codex-native-endpoint'))).toBe(false);
      expect(await host.handleOp({ op: 'prepare-terminal' })).toMatchObject({
        status: 422,
        body: { code: 'native-unavailable', reason: 'cli-unsupported', cliVersion: '0.150.0' },
      });
    });

    it('prepare_terminal_never_starts_turn: no thread yet means no attach', async () => {
      const manager = new NativeFakeManager();
      const host = makeHost(manager, { model: 'gpt-5.6-luna' });

      expect(await host.handleOp({ op: 'prepare-terminal' })).toMatchObject({ status: 409, body: { code: 'no-thread' } });
      expect(manager.startThreadCalls).toHaveLength(0);
      expect(manager.startTurnCalls).toHaveLength(0);
    });

    it('strictly resumes a saved thread for the terminal and hands out the exact thread', async () => {
      const manager = new NativeFakeManager();
      const host = makeHost(manager, { model: 'gpt-5.6-luna', resumeThreadId: '01a0cf2b-92d3-7260-9919-e020c0c91104' });

      const result = await host.handleOp({ op: 'prepare-terminal' });

      expect(manager.resumeThreadCalls).toEqual([
        expect.objectContaining({ threadId: '01a0cf2b-92d3-7260-9919-e020c0c91104', strict: true }),
      ]);
      expect(manager.startTurnCalls).toHaveLength(0);
      expect(result).toMatchObject({
        status: 200,
        body: { ok: true, threadId: '01a0cf2b-92d3-7260-9919-e020c0c91104', endpoint: `unix://${socketPath()}`, navigationEpoch: 0 },
      });
    });

    it('missing_resume_target_never_starts_fresh', async () => {
      const manager = new NativeFakeManager();
      manager.resumeThread = async () => { throw new Error('thread/resume failed: no rollout found for thread id x'); };
      const host = makeHost(manager, { model: 'gpt-5.6-luna', resumeThreadId: 'x' });

      expect(await host.handleOp({ op: 'prepare-terminal' })).toMatchObject({ status: 409, body: { code: 'resume-failed' } });
      expect(manager.startThreadCalls).toHaveLength(0);
    });

    it('waits for the first turn to write the rollout before attaching a fresh thread', async () => {
      const rolloutPath = join(tmpHome, 'rollout-thread-started.jsonl');
      const manager = withRollout(new NativeFakeManager(), rolloutPath);
      const host = makeHost(manager);
      await host.handleOp({ op: 'message', content: 'hello', model: 'gpt-5.6-luna' });

      expect(await host.handleOp({ op: 'prepare-terminal' })).toMatchObject({ status: 409, body: { code: 'no-thread' } });
      writeFileSync(rolloutPath, '{}\n');
      expect(await host.handleOp({ op: 'prepare-terminal' })).toMatchObject({ status: 200, body: { threadId: 'thread-started' } });
    });

    it('concurrent_first_message_and_attach_create_one_thread', async () => {
      const manager = new NativeFakeManager();
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const resume = manager.resumeThread.bind(manager);
      manager.resumeThread = async (threadId, options, resumeOptions) => {
        await gate;
        return resume(threadId, options, resumeOptions);
      };
      const host = makeHost(manager, { model: 'gpt-5.6-luna', resumeThreadId: 'saved-thread' });

      const attach = host.handleOp({ op: 'prepare-terminal' });
      const message = host.handleOp({ op: 'message', content: 'hi' });
      release();
      await Promise.all([attach, message]);

      expect(manager.resumeThreadCalls).toHaveLength(1);
      expect(manager.startThreadCalls).toHaveLength(0);
      expect(manager.startTurnCalls).toHaveLength(1);
    });

    it('external_reply_clears_pending_request', async () => {
      const manager = new NativeFakeManager();
      const host = makeHost(manager);
      manager.emit('request', { id: 0, method: 'item/commandExecution/requestApproval', params: { threadId: 't', command: 'touch x' } });
      expect(host.status().pendingRequests).toHaveLength(1);

      // The TUI answered: codex tells every client the request is resolved.
      manager.emit('notification', { method: 'serverRequest/resolved', params: { threadId: 't', requestId: 0 } });

      expect(host.status().pendingRequests).toHaveLength(0);
      expect(await host.handleOp({ op: 'approval', requestId: 0, decision: 'accept' })).toMatchObject({ status: 409 });
      expect(manager.approvals).toEqual([]);
    });

    it('duplicate_input_reply_is_rejected', async () => {
      const manager = new NativeFakeManager();
      const host = makeHost(manager);

      expect(await host.handleOp({ op: 'user-input', requestId: 'q-1', answers: { choice: ['a'] } })).toEqual({
        status: 409,
        body: { error: 'user-input request q-1 is not pending' },
      });
      expect(manager.userInputs).toEqual([]);
    });

    it('terminal_settings_survive_next_dashboard_turn', async () => {
      const manager = new NativeFakeManager();
      const host = makeHost(manager, { effort: 'high' });
      await host.handleOp({ op: 'message', content: 'first', model: 'gpt-5.6-luna' });

      // The operator picked medium effort with /model in the attached TUI.
      manager.emit('notification', {
        method: 'thread/settings/updated',
        params: { threadId: 'thread-started', threadSettings: { model: 'gpt-5.6-luna', effort: 'medium' } },
      });
      await host.handleOp({ op: 'message', content: 'second' });
      expect(manager.startTurnCalls.at(-1)?.options?.effort).toBe('medium');

      // The dashboard effort picker still applies when used afterwards.
      await host.handleOp({ op: 'set-effort', effort: 'low' });
      await host.handleOp({ op: 'message', content: 'third' });
      expect(manager.startTurnCalls.at(-1)?.options?.effort).toBe('low');
    });

    it('native navigation bumps the epoch; foreign threads never rewrite the thread pointer', async () => {
      const manager = new NativeFakeManager();
      const host = makeHost(manager);
      await host.handleOp({ op: 'message', content: 'first', model: 'gpt-5.6-luna' });
      const threadIdFile = join(agentDir(), 'codex-thread-id');
      expect(readFileSync(threadIdFile, 'utf8')).toBe('thread-started');

      manager.emit('foreign-thread', { method: 'thread/started', params: { thread: { id: 'title', ephemeral: true } } });
      manager.emit('foreign-thread', { method: 'thread/status/changed', params: { threadId: 'title', status: { type: 'active' } } });
      manager.emit('foreign-thread', { method: 'thread/started', params: { thread: { id: 'child', parentThreadId: 'thread-started' } } });
      expect(host.status().navigationEpoch).toBe(0);

      manager.emit('foreign-thread', { method: 'thread/started', params: { thread: { id: 'new-thread', ephemeral: false } } });
      manager.emit('foreign-thread', { method: 'thread/status/changed', params: { threadId: 'new-thread', status: { type: 'active' } } });
      expect(host.status().navigationEpoch).toBe(1);
      expect(readFileSync(threadIdFile, 'utf8')).toBe('thread-started');
    });
  });
});
