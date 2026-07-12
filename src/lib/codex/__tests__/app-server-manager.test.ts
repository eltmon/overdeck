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
});
