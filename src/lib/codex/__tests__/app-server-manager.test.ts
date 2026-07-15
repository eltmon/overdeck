import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexAppServerManager } from '../app-server-manager.js';
import { createFakeAppServer } from './fake-app-server.js';

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
});
