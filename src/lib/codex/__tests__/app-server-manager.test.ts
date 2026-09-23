import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexAppServerManager } from '../app-server-manager.js';
import { createFakeAppServer, createFakeNativeTransport, type FakeNativeTransport } from './fake-app-server.js';

afterEach(() => vi.useRealTimers());

describe('CodexAppServerManager', () => {
  it('performs initialize then initialized', async () => {
    const fake = createFakeAppServer((message, server) => {
      if (message.method === 'initialize') server.send({ id: message.id, result: {} });
    });
    const manager = new CodexAppServerManager({ cwd: '/tmp', readVersion: async () => 'codex-cli 0.144.1', spawnProcess: () => fake.child });
    await manager.start();
    expect(fake.messages.map(message => message.method)).toEqual(['initialize', 'initialized']);
    manager.stop();
  });

  it.each(['start', 'resume'] as const)('supplies developer instructions on thread %s', async (operation) => {
    const fake = createFakeAppServer((message, server) => {
      if (message.method === 'initialize') server.send({ id: message.id, result: {} });
      if (message.method === `thread/${operation}`) server.send({ id: message.id, result: { thread: { id: 'thread-context' } } });
    });
    const manager = new CodexAppServerManager({ cwd: '/tmp', readVersion: async () => '0.144.1', spawnProcess: () => fake.child });
    await manager.start();
    const options = { model: 'caller-model', developerInstructions: 'GLOBAL\nPROJECT\nWORKSPACE' };
    if (operation === 'start') await manager.startThread(options);
    else await manager.resumeThread('thread-context', options);
    const request = fake.messages.find(message => message.method === `thread/${operation}`);
    expect(request?.params).toMatchObject({ developerInstructions: options.developerInstructions });
    manager.stop();
  });

  it('times out unanswered requests with fake timers', async () => {
    vi.useFakeTimers();
    const fake = createFakeAppServer();
    const manager = new CodexAppServerManager({ cwd: '/tmp', readVersion: async () => '0.144.1', spawnProcess: () => fake.child });
    const started = manager.start();
    const rejection = expect(started).rejects.toThrow('Timed out waiting for initialize');
    await vi.advanceTimersByTimeAsync(20_000);
    await rejection;
    manager.stop();
  });

  it('warns on invalid JSON and continues with valid responses', async () => {
    const fake = createFakeAppServer((message, server) => {
      if (message.method === 'initialize') {
        server.child.stdout.write('not-json\n');
        server.send({ id: message.id, result: { ready: true } });
      }
    });
    const manager = new CodexAppServerManager({ cwd: '/tmp', readVersion: async () => '0.144.1', spawnProcess: () => fake.child });
    const warnings: string[] = [];
    manager.on('warning', warning => warnings.push(String(warning)));
    await manager.start();
    expect(warnings).toHaveLength(1);
    expect(fake.messages.at(-1)?.method).toBe('initialized');
    manager.stop();
  });

  it('rejects unsupported Codex versions before spawning', async () => {
    const spawnProcess = vi.fn(() => createFakeAppServer().child);
    const manager = new CodexAppServerManager({ cwd: '/tmp', readVersion: async () => 'codex-cli 0.143.9', spawnProcess });
    await expect(manager.start()).rejects.toThrow('Codex CLI 0.143.9 is unsupported; upgrade to 0.144.0');
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('emits stripped ERROR stderr and drops benign rollout messages', async () => {
    const fake = createFakeAppServer((message, server) => {
      if (message.method === 'initialize') server.send({ id: message.id, result: {} });
    });
    const manager = new CodexAppServerManager({ cwd: '/tmp', readVersion: async () => '0.144.1', spawnProcess: () => fake.child });
    const errors: string[] = [];
    manager.on('stderr', error => errors.push(String(error)));
    await manager.start();
    fake.child.stderr.write('\u001b[31mERROR failed\u001b[0m\n');
    fake.child.stderr.write('ERROR state db missing rollout path for thread abc\n');
    fake.child.stderr.write('informational message\n');
    expect(errors).toEqual(['ERROR failed']);
    manager.stop();
  });

  it('sends a 1MB turn as one request and tracks thread and turn state', async () => {
    const fake = createFakeAppServer((message, server) => {
      if (message.method === 'initialize') server.send({ id: message.id, result: {} });
      if (message.method === 'thread/start') {
        server.send({ id: message.id, result: {} });
        server.send({ method: 'thread/started', params: { thread: { id: 'thread-1' } } });
      }
      if (message.method === 'turn/start') {
        server.send({ id: message.id, result: {} });
        server.send({ method: 'turn/started', params: { turn: { id: 'turn-1' } } });
      }
    });
    const manager = new CodexAppServerManager({ cwd: '/tmp', readVersion: async () => '0.144.1', spawnProcess: () => fake.child });
    await manager.start();
    await manager.startThread({ model: 'caller-model' });
    const text = 'x'.repeat(1024 * 1024);
    await manager.startTurn(text, { effort: 'high' });
    expect(manager.getState()).toEqual({ state: 'running', threadId: 'thread-1', activeTurnId: 'turn-1' });
    const turns = fake.messages.filter(message => message.method === 'turn/start');
    expect(turns).toHaveLength(1);
    expect(((turns[0]?.params as { input: Array<{ text: string }> }).input[0]?.text)).toHaveLength(text.length);
    fake.send({ method: 'turn/completed', params: { turn: { id: 'turn-1' } } });
    expect(manager.getState()).toEqual({ state: 'idle', threadId: 'thread-1', activeTurnId: undefined });
    manager.stop();
  });

  it('adopts the threadId from a thread/resume response with no thread/started notification', async () => {
    // codex app-server emits thread/started only for fresh threads; a resumed
    // thread is announced solely through the thread/resume response.
    const fake = createFakeAppServer((message, server) => {
      if (message.method === 'initialize') server.send({ id: message.id, result: {} });
      if (message.method === 'thread/resume') server.send({ id: message.id, result: { thread: { id: 'thread-resumed' } } });
      if (message.method === 'turn/start') server.send({ id: message.id, result: {} });
    });
    const manager = new CodexAppServerManager({ cwd: '/tmp', readVersion: async () => '0.144.1', spawnProcess: () => fake.child });
    await manager.start();
    await manager.resumeThread('thread-resumed', { model: 'caller-model' });
    expect(manager.getState().threadId).toBe('thread-resumed');
    await manager.startTurn('after resume');
    expect(fake.messages).toContainEqual(expect.objectContaining({ method: 'turn/start', params: expect.objectContaining({ threadId: 'thread-resumed' }) }));
    manager.stop();
  });

  it('adopts the threadId from a thread/start response before any notification', async () => {
    const fake = createFakeAppServer((message, server) => {
      if (message.method === 'initialize') server.send({ id: message.id, result: {} });
      if (message.method === 'thread/start') server.send({ id: message.id, result: { thread: { id: 'thread-from-response' } } });
    });
    const manager = new CodexAppServerManager({ cwd: '/tmp', readVersion: async () => '0.144.1', spawnProcess: () => fake.child });
    await manager.start();
    await manager.startThread({ model: 'caller-model' });
    expect(manager.getState().threadId).toBe('thread-from-response');
    manager.stop();
  });

  it('starts a fresh thread when codex refuses the resume because the thread has an active writer', async () => {
    // A live host re-prompted for the next review cycle: codex keeps its own
    // round-one thread open and answers the resume with a thread-store
    // conflict. The prompt must not be dropped (PAN-3705).
    const warnings: string[] = [];
    const fake = createFakeAppServer((message, server) => {
      if (message.method === 'initialize') server.send({ id: message.id, result: {} });
      if (message.method === 'thread/resume') {
        server.send({ id: message.id, error: { message: 'thread-store conflict: thread t1 already has an active writer' } });
      }
      if (message.method === 'thread/start') server.send({ id: message.id, result: { thread: { id: 't2' } } });
    });
    const manager = new CodexAppServerManager({ cwd: '/tmp', readVersion: async () => '0.144.1', spawnProcess: () => fake.child });
    manager.on('warning', warning => warnings.push(String(warning)));
    await manager.start();
    await manager.resumeThread('t1', { model: 'caller-model' });
    expect(fake.messages.map(message => message.method)).toContain('thread/start');
    expect(manager.getState().threadId).toBe('t2');
    expect(warnings[0]).toContain('active writer');
    manager.stop();
  });

  it('falls back only for missing-thread resume errors', async () => {
    const warnings: string[] = [];
    const fake = createFakeAppServer((message, server) => {
      if (message.method === 'initialize') server.send({ id: message.id, result: {} });
      if (message.method === 'thread/resume') server.send({ id: message.id, error: { message: 'thread/resume: thread not found' } });
      if (message.method === 'thread/start') server.send({ id: message.id, result: {} });
    });
    const manager = new CodexAppServerManager({ cwd: '/tmp', readVersion: async () => '0.144.1', spawnProcess: () => fake.child });
    manager.on('warning', warning => warnings.push(String(warning)));
    await manager.start();
    await manager.resumeThread('missing', { model: 'caller-model' });
    expect(fake.messages.map(message => message.method)).toContain('thread/start');
    expect(warnings[0]).toContain('starting a fresh thread');
    manager.stop();

    const rejected = createFakeAppServer((message, server) => {
      if (message.method === 'initialize') server.send({ id: message.id, result: {} });
      if (message.method === 'thread/resume') server.send({ id: message.id, error: { message: 'permission denied' } });
    });
    const strict = new CodexAppServerManager({ cwd: '/tmp', readVersion: async () => '0.144.1', spawnProcess: () => rejected.child });
    await strict.start();
    await expect(strict.resumeThread('denied', { model: 'caller-model' })).rejects.toThrow('permission denied');
    expect(rejected.messages.some(message => message.method === 'thread/start')).toBe(false);
    strict.stop();
  });

  it('round-trips approval request ids and interrupts the active turn', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fake = createFakeAppServer((message, server) => {
      if (message.method === 'initialize') server.send({ id: message.id, result: {} });
      if (message.method === 'thread/start') {
        server.send({ id: message.id, result: {} });
        server.send({ method: 'thread/started', params: { thread: { id: 'thread-2' } } });
      }
      if (message.method === 'turn/start') {
        server.send({ id: message.id, result: {} });
        server.send({ method: 'turn/started', params: { turn: { id: 'turn-2' } } });
        server.send({ id: 71, method: 'item/commandExecution/requestApproval', params: { command: 'git status' } });
      }
      if (message.method === 'turn/interrupt') server.send({ id: message.id, result: {} });
    });
    const manager = new CodexAppServerManager({ cwd: '/tmp', readVersion: async () => '0.144.1', spawnProcess: () => fake.child });
    manager.on('request', request => requests.push(request as Record<string, unknown>));
    await manager.start();
    await manager.startThread({ model: 'caller-model' });
    await manager.startTurn('work');
    expect(requests[0]?.id).toBe(71);
    manager.answerApproval(71, 'accept');
    await manager.interruptTurn();
    expect(fake.messages).toContainEqual({ id: 71, result: { decision: 'accept' } });
    expect(fake.messages).toContainEqual(expect.objectContaining({ method: 'turn/interrupt', params: { threadId: 'thread-2', turnId: 'turn-2' } }));
    fake.send({ method: 'turn/completed', params: { turn: { id: 'turn-2' } } });
    expect(manager.getState().state).toBe('idle');
    manager.stop();
  });

  describe('native endpoint (PAN-3835)', () => {
    const SOCKET = '/home/op/.overdeck/agents/conv-1/codex-native/app.sock';

    function nativeServer(onMessage?: (message: Record<string, unknown>, fake: FakeNativeTransport) => void): FakeNativeTransport {
      return createFakeNativeTransport((message, fake) => {
        if (message.method === 'initialize') fake.send({ id: message.id, result: {} });
        if (message.method === 'thread/start') fake.send({ id: message.id, result: { thread: { id: 'owner-thread', path: '/rollouts/owner.jsonl' } } });
        onMessage?.(message, fake);
      });
    }

    function killableChild() {
      const fake = createFakeAppServer();
      const child = fake.child as unknown as { kill: (signal?: string) => boolean; emit: (event: string, ...args: unknown[]) => boolean };
      child.kill = () => { queueMicrotask(() => child.emit('exit', null, 'SIGTERM')); return true; };
      return fake;
    }

    it('uses_unix_websocket_only_when_requested', async () => {
      const native = nativeServer();
      const spawned: Array<readonly string[]> = [];
      const manager = new CodexAppServerManager({
        cwd: '/tmp',
        readVersion: async () => 'codex-cli 0.153.4',
        nativeSocketPath: SOCKET,
        spawnProcess: (args) => { spawned.push(args); return killableChild().child; },
        connectNative: async () => native.transport,
      });
      await manager.start();
      expect(spawned).toEqual([['app-server', '--listen', `unix://${SOCKET}`]]);
      expect(manager.getTransportInfo()).toEqual({ kind: 'unix', endpoint: `unix://${SOCKET}`, cliVersion: '0.153.4' });
      expect(native.messages.map(message => message.method)).toEqual(['initialize', 'initialized']);
      manager.stop();
      expect(native.closedByClient).toBe(true);
    });

    it.each([
      ['an older CLI', '0.153.3', SOCKET, 'cli-unsupported'],
      ['a socket path over 100 bytes', '0.153.4', `/${'x'.repeat(120)}/app.sock`, 'socket-path-too-long'],
    ])('retains_stdio_for %s with a visible reason', async (_label, version, socketPath, reason) => {
      const fake = createFakeAppServer((message, server) => {
        if (message.method === 'initialize') server.send({ id: message.id, result: {} });
      });
      const spawned: Array<readonly string[]> = [];
      const connectNative = vi.fn();
      const manager = new CodexAppServerManager({
        cwd: '/tmp',
        readVersion: async () => version,
        nativeSocketPath: socketPath,
        spawnProcess: (args) => { spawned.push(args); return fake.child; },
        connectNative,
      });
      await manager.start();
      expect(spawned).toEqual([['app-server']]);
      expect(connectNative).not.toHaveBeenCalled();
      expect(manager.getTransportInfo()).toMatchObject({ kind: 'stdio', unavailableReason: reason });
      manager.stop();
    });

    it('keeps stdio for work agents that never request the endpoint', async () => {
      const fake = createFakeAppServer((message, server) => {
        if (message.method === 'initialize') server.send({ id: message.id, result: {} });
      });
      const manager = new CodexAppServerManager({ cwd: '/tmp', readVersion: async () => '0.153.4', spawnProcess: () => fake.child });
      await manager.start();
      expect(manager.getTransportInfo()).toMatchObject({ kind: 'stdio', unavailableReason: 'not-requested' });
      manager.stop();
    });

    it('cleans_failed_startup_without_second_child: stops the native child before the stdio fallback', async () => {
      const nativeChild = killableChild();
      const stdio = createFakeAppServer((message, server) => {
        if (message.method === 'initialize') server.send({ id: message.id, result: {} });
      });
      const events: string[] = [];
      const manager = new CodexAppServerManager({
        cwd: '/tmp',
        readVersion: async () => '0.153.4',
        nativeSocketPath: SOCKET,
        spawnProcess: (args) => {
          events.push(`spawn ${args.join(' ')}`);
          if (args.includes('--listen')) {
            nativeChild.child.once('exit', () => events.push('native exited'));
            return nativeChild.child;
          }
          return stdio.child;
        },
        connectNative: async () => { throw new Error('ECONNREFUSED'); },
      });
      const exits: unknown[] = [];
      manager.on('exit', exit => exits.push(exit));
      await manager.start();
      expect(events).toEqual([`spawn app-server --listen unix://${SOCKET}`, 'native exited', 'spawn app-server']);
      expect(manager.getTransportInfo()).toMatchObject({ kind: 'stdio', unavailableReason: 'connect-failed' });
      // The torn-down native child is not reported as the runtime exiting.
      expect(exits).toEqual([]);
      manager.stop();
    });

    it('stops the runtime once when the native connection drops (rejects_pending_rpc_on_disconnect)', async () => {
      const native = nativeServer();
      const child = killableChild();
      const manager = new CodexAppServerManager({
        cwd: '/tmp',
        readVersion: async () => '0.153.4',
        nativeSocketPath: SOCKET,
        spawnProcess: () => child.child,
        connectNative: async () => native.transport,
      });
      const exits: unknown[] = [];
      manager.on('exit', exit => exits.push(exit));
      manager.on('warning', () => undefined);
      await manager.start();
      const pending = manager.request('thread/read', {});
      native.close();
      // The close handler stops the runtime and reports the exit synchronously.
      expect(exits).toHaveLength(1);
      await expect(pending).rejects.toThrow('codex app-server stopped.');
      expect(manager.getState().state).toBe('closed');
      // A dead endpoint is never reported as attachable again.
      expect(manager.getTransportInfo()).toEqual({ kind: 'stdio', unavailableReason: 'exited', cliVersion: '0.153.4' });
      // The child's own exit event afterwards is not a second runtime exit.
      await Promise.resolve();
      expect(exits).toHaveLength(1);
    });

    it('foreign_thread_events_do_not_rebind_owner', async () => {
      const native = nativeServer();
      const manager = new CodexAppServerManager({
        cwd: '/tmp',
        readVersion: async () => '0.153.4',
        nativeSocketPath: SOCKET,
        spawnProcess: () => killableChild().child,
        connectNative: async () => native.transport,
      });
      const notifications: string[] = [];
      const requests: unknown[] = [];
      const foreign: string[] = [];
      manager.on('notification', (message: { method: string }) => notifications.push(message.method));
      manager.on('request', request => requests.push(request));
      manager.on('foreign-thread', (message: { method: string }) => foreign.push(message.method));
      await manager.start();
      await manager.startThread({ model: 'gpt-5.6-luna' });

      // What the attached TUI caused on the shared server, recorded in the
      // PAN-3835 experiment: a system title thread and a native /new.
      native.send({ method: 'thread/started', params: { thread: { id: 'title-thread', ephemeral: true } } });
      native.send({ method: 'thread/started', params: { thread: { id: 'new-thread', ephemeral: false } } });
      native.send({ method: 'turn/started', params: { threadId: 'new-thread', turn: { id: 't-foreign' } } });
      native.send({ id: 5, method: 'item/commandExecution/requestApproval', params: { threadId: 'new-thread' } });

      expect(manager.getState()).toEqual({ state: 'idle', threadId: 'owner-thread' });
      expect(requests).toEqual([]);
      expect(foreign).toEqual(['thread/started', 'thread/started', 'turn/started', 'item/commandExecution/requestApproval']);

      // Owner-thread events still flow, whichever client started the turn.
      native.send({ method: 'turn/started', params: { threadId: 'owner-thread', turn: { id: 't-owner' } } });
      expect(manager.getState()).toEqual({ state: 'running', threadId: 'owner-thread', activeTurnId: 't-owner' });
      expect(notifications).toEqual(['turn/started']);
      expect(manager.threadScope('title-thread')).toBe('foreign');
      expect(manager.threadScope('new-thread')).toBe('foreign');
      manager.stop();
    });

    it('accepts the owner thread tree: sub-agent requests and events flow without moving the owner turn', async () => {
      const native = nativeServer();
      const manager = new CodexAppServerManager({
        cwd: '/tmp',
        readVersion: async () => '0.153.4',
        nativeSocketPath: SOCKET,
        spawnProcess: () => killableChild().child,
        connectNative: async () => native.transport,
      });
      const notifications: string[] = [];
      const requests: Array<{ id?: unknown }> = [];
      const foreign: unknown[] = [];
      manager.on('notification', (message: { method: string }) => notifications.push(message.method));
      manager.on('request', (request: { id?: unknown }) => requests.push(request));
      manager.on('foreign-thread', message => foreign.push(message));
      await manager.start();
      await manager.startThread({ model: 'gpt-5.6-luna' });

      native.send({ method: 'thread/started', params: { thread: { id: 'sub', parentThreadId: 'owner-thread' } } });
      native.send({ method: 'thread/started', params: { thread: { id: 'sub-sub', parentThreadId: 'sub' } } });
      native.send({ method: 'turn/started', params: { threadId: 'sub-sub', turn: { id: 't-sub' } } });
      native.send({ id: 7, method: 'item/commandExecution/requestApproval', params: { threadId: 'sub-sub' } });
      // Never announced to this client: fail open.
      native.send({ id: 8, method: 'item/commandExecution/requestApproval', params: { threadId: 'unannounced' } });

      expect(manager.threadScope('sub')).toBe('descendant');
      expect(manager.threadScope('sub-sub')).toBe('descendant');
      expect(manager.threadScope('unannounced')).toBe('unknown');
      expect(requests.map(request => request.id)).toEqual([7, 8]);
      expect(notifications).toEqual(['thread/started', 'thread/started', 'turn/started']);
      expect(foreign).toEqual([]);
      expect(manager.getState()).toEqual({ state: 'idle', threadId: 'owner-thread' });
      manager.stop();
    });

    it('adopts a sub-agent announced only by its spawnAgent item, as codex-cli 0.153.4 does', async () => {
      const native = nativeServer();
      const manager = new CodexAppServerManager({
        cwd: '/tmp',
        readVersion: async () => '0.153.4',
        nativeSocketPath: SOCKET,
        spawnProcess: () => killableChild().child,
        connectNative: async () => native.transport,
      });
      const requests: Array<{ id?: unknown }> = [];
      manager.on('request', (request: { id?: unknown }) => requests.push(request));
      await manager.start();
      await manager.startThread({ model: 'gpt-5.6-luna' });

      // Shapes recorded live: no thread/started for the sub-agent thread.
      native.send({
        method: 'item/completed',
        params: {
          threadId: 'owner-thread',
          item: { type: 'collabAgentToolCall', tool: 'spawnAgent', senderThreadId: 'owner-thread', receiverThreadIds: ['sub-thread'] },
        },
      });
      native.send({ method: 'turn/started', params: { threadId: 'sub-thread', turn: { id: 'sub-turn' } } });
      native.send({ id: 0, method: 'item/commandExecution/requestApproval', params: { threadId: 'sub-thread', command: 'touch x' } });

      expect(manager.threadScope('sub-thread')).toBe('descendant');
      expect(requests.map(request => request.id)).toEqual([0]);
      expect(manager.getState()).toEqual({ state: 'idle', threadId: 'owner-thread' });

      // A spawn made from a foreign thread does not join the tree.
      native.send({ method: 'thread/started', params: { thread: { id: 'tui-new' } } });
      native.send({
        method: 'item/completed',
        params: { threadId: 'tui-new', item: { type: 'collabAgentToolCall', receiverThreadIds: ['tui-sub'] } },
      });
      expect(manager.threadScope('tui-sub')).toBe('unknown');
      manager.stop();
    });

    it('lets a spawn item from the owner tree override a foreign classification (PAN-4031)', async () => {
      const native = nativeServer();
      const manager = new CodexAppServerManager({
        cwd: '/tmp',
        readVersion: async () => '0.153.4',
        nativeSocketPath: SOCKET,
        spawnProcess: () => killableChild().child,
        connectNative: async () => native.transport,
      });
      const requests: Array<{ id?: unknown }> = [];
      const foreign: Array<{ id?: unknown; method?: string }> = [];
      manager.on('request', (request: { id?: unknown }) => requests.push(request));
      manager.on('foreign-thread', (message: { id?: unknown; method?: string }) => foreign.push(message));
      await manager.start();
      await manager.startThread({ model: 'gpt-5.6-luna' });

      // A sub-agent announced before its parent joined the tree is foreign.
      native.send({ method: 'thread/started', params: { thread: { id: 'grandchild', parentThreadId: 'sub-thread', ephemeral: false } } });
      expect(manager.threadScope('grandchild')).toBe('foreign');

      // The parent joins through the owner's spawn item, then spawns the grandchild.
      native.send({
        method: 'item/completed',
        params: {
          threadId: 'owner-thread',
          item: { type: 'collabAgentToolCall', tool: 'spawnAgent', senderThreadId: 'owner-thread', receiverThreadIds: ['sub-thread'] },
        },
      });
      native.send({
        method: 'item/completed',
        params: {
          threadId: 'sub-thread',
          item: { type: 'collabAgentToolCall', tool: 'spawnAgent', senderThreadId: 'sub-thread', receiverThreadIds: ['grandchild'] },
        },
      });
      native.send({ id: 5, method: 'item/commandExecution/requestApproval', params: { threadId: 'grandchild', command: 'ls' } });

      expect(manager.threadScope('grandchild')).toBe('descendant');
      expect(requests.map(request => request.id)).toEqual([5]);
      expect(foreign.map(message => message.method)).toEqual(['thread/started']);

      // The owner thread is never reclassified by a spawn item naming it.
      native.send({
        method: 'item/completed',
        params: {
          threadId: 'sub-thread',
          item: { type: 'collabAgentToolCall', tool: 'wait', senderThreadId: 'sub-thread', receiverThreadIds: ['owner-thread'] },
        },
      });
      expect(manager.threadScope('owner-thread')).toBe('owner');
      manager.stop();
    });

    it('stops an orphaned app-server recorded in app.pid before reusing its socket', async () => {
      const native = nativeServer();
      const alive = new Set([4242]);
      const events: string[] = [];
      const files = new Map([[SOCKET.replace(/app\.sock$/, 'app.pid'), '4242\n']]);
      const processOps = {
        readText: async (path: string) => files.get(path),
        writeText: async (path: string, text: string) => { files.set(path, text); events.push(`write ${text.trim()}`); },
        isAlive: (pid: number) => alive.has(pid),
        readCmdline: async (pid: number) => (pid === 4242 ? `node /usr/bin/codex app-server --listen unix://${SOCKET}` : undefined),
        kill: (pid: number, signal: NodeJS.Signals) => { events.push(`kill ${pid} ${signal}`); },
        // The orphan exits during the grace period.
        sleep: async () => { events.push('sleep'); alive.delete(4242); },
      };
      const child = killableChild();
      Object.assign(child.child, { pid: 5151 });
      const manager = new CodexAppServerManager({
        cwd: '/tmp',
        readVersion: async () => '0.153.4',
        nativeSocketPath: SOCKET,
        spawnProcess: (args) => { events.push(`spawn ${args.join(' ')}`); return child.child; },
        connectNative: async () => native.transport,
        processOps,
      });
      manager.on('warning', () => undefined);
      await manager.start();

      expect(events).toEqual([
        'kill 4242 SIGTERM',
        'sleep',
        `spawn app-server --listen unix://${SOCKET}`,
        'write 5151',
      ]);
      manager.stop();
    });

    it.each([
      ['a dead pid', false, `codex app-server --listen unix://${SOCKET}`],
      ['a reused pid running something else', true, 'vim notes.txt'],
      ['a codex app-server on another socket', true, 'codex app-server --listen unix:///elsewhere/app.sock'],
    ])('leaves %s alone', async (_label, isAlive, cmdline) => {
      const kill = vi.fn();
      const manager = new CodexAppServerManager({
        cwd: '/tmp',
        readVersion: async () => '0.153.4',
        nativeSocketPath: SOCKET,
        spawnProcess: () => killableChild().child,
        connectNative: async () => nativeServer().transport,
        processOps: {
          readText: async () => '4242',
          writeText: async () => undefined,
          isAlive: () => isAlive,
          readCmdline: async () => cmdline,
          kill,
          sleep: async () => undefined,
        },
      });
      await manager.start();
      expect(kill).not.toHaveBeenCalled();
      manager.stop();
    });

    it('SIGKILLs an orphan that ignores SIGTERM through the whole grace period', async () => {
      let clock = 0;
      const kill = vi.fn();
      const manager = new CodexAppServerManager({
        cwd: '/tmp',
        readVersion: async () => '0.153.4',
        nativeSocketPath: SOCKET,
        spawnProcess: () => killableChild().child,
        connectNative: async () => nativeServer().transport,
        processOps: {
          readText: async () => '4242',
          writeText: async () => undefined,
          isAlive: () => !kill.mock.calls.some(([, signal]) => signal === 'SIGKILL'),
          readCmdline: async () => `codex app-server --listen unix://${SOCKET}`,
          kill,
          sleep: async (ms: number) => { clock += ms; },
        },
      });
      manager.on('warning', () => undefined);
      await manager.start();
      expect(kill.mock.calls).toEqual([[4242, 'SIGTERM'], [4242, 'SIGKILL']]);
      // 5 s of SIGTERM grace, then one poll after SIGKILL.
      expect(clock).toBe(5_100);
      manager.stop();
    });

    it('resumes strictly without substituting a fresh thread', async () => {
      const native = nativeServer((message, fake) => {
        if (message.method === 'thread/resume') fake.send({ id: message.id, error: { message: 'thread/resume: thread not found' } });
      });
      const manager = new CodexAppServerManager({
        cwd: '/tmp',
        readVersion: async () => '0.153.4',
        nativeSocketPath: SOCKET,
        spawnProcess: () => killableChild().child,
        connectNative: async () => native.transport,
      });
      await manager.start();
      await expect(manager.resumeThread('gone', { model: 'm' }, { strict: true })).rejects.toThrow('not found');
      expect(native.messages.some(message => message.method === 'thread/start')).toBe(false);
      expect(manager.getState().threadId).toBeUndefined();
      manager.stop();
    });
  });
});
