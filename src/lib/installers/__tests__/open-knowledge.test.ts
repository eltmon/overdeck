import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureOpenKnowledge,
  OpenKnowledgeError,
  startOpenKnowledgeServer,
  type CommandResult,
} from '../open-knowledge.js';

const success = (stdout = ''): CommandResult => ({ stdout, stderr: '' });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ensureOpenKnowledge', () => {
  it('returns already-installed without invoking the installer when ok --version succeeds', async () => {
    const runCommand = vi.fn(async () => success('0.34.0\n'));
    const installOpenKnowledge = vi.fn(async () => {});

    const result = await ensureOpenKnowledge({ runCommand, installOpenKnowledge });

    expect(result).toEqual({ status: 'already-installed', command: 'ok' });
    expect(runCommand).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledWith('ok', ['--version']);
    expect(installOpenKnowledge).not.toHaveBeenCalled();
  });

  it('installs a missing binary and resolves after the health check succeeds', async () => {
    let healthChecks = 0;
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === 'ok' && args[0] === '--version') {
        healthChecks += 1;
        if (healthChecks < 3) throw new Error('missing');
        return success('0.34.0\n');
      }
      return success();
    });
    const installOpenKnowledge = vi.fn(async () => {});

    const resultPromise = ensureOpenKnowledge({
      autoInstall: true,
      retryDelayMs: 100,
      maxHealthAttempts: 3,
      runCommand,
      installOpenKnowledge,
    });

    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;

    expect(result).toEqual({ status: 'installed', command: 'ok' });
    expect(installOpenKnowledge).toHaveBeenCalledOnce();
    expect(healthChecks).toBe(3);
  });

  it('rejects with the manual install command when auto-install is disabled', async () => {
    const runCommand = vi.fn(async () => {
      throw new Error('missing');
    });

    await expect(ensureOpenKnowledge({ autoInstall: false, runCommand })).rejects.toThrow(
      'npm install -g @inkeep/open-knowledge',
    );
  });

  it('uses npm global install by default when auto-install is enabled', async () => {
    let installed = false;
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === 'npm') {
        installed = true;
        return success();
      }
      if (command === 'ok' && args[0] === '--version') {
        if (!installed) throw new Error('missing');
        return success('0.34.0\n');
      }
      return success();
    });

    const result = await ensureOpenKnowledge({ autoInstall: true, runCommand });

    expect(result.status).toBe('installed');
    expect(runCommand).toHaveBeenCalledWith('npm', ['install', '-g', '@inkeep/open-knowledge']);
  });

  it('reports the exact Node 24 diagnosis when installation fails under Node 22', async () => {
    const runCommand = vi.fn(async (command: string) => {
      if (command === 'node') return success('v22.22.0\n');
      throw new Error('missing');
    });
    const installOpenKnowledge = vi.fn(async () => {
      throw new Error('unsupported engine');
    });

    await expect(ensureOpenKnowledge({ autoInstall: true, runCommand, installOpenKnowledge })).rejects.toThrow(
      "open-knowledge requires Node 24+; found v22.22.0. Install Node 24+ or run '/okf open --no-install' after installing manually.",
    );
  });

  it('reports a health-check failure when install completes but ok never becomes available', async () => {
    const runCommand = vi.fn(async (command: string) => {
      if (command === 'node') return success('v24.17.0\n');
      throw new Error('missing');
    });
    const installOpenKnowledge = vi.fn(async () => {});

    const resultPromise = ensureOpenKnowledge({
      autoInstall: true,
      retryDelayMs: 100,
      maxHealthAttempts: 2,
      runCommand,
      installOpenKnowledge,
    });
    const rejection = expect(resultPromise).rejects.toBeInstanceOf(OpenKnowledgeError);

    await vi.advanceTimersByTimeAsync(100);
    await rejection;
  });
});

describe('startOpenKnowledgeServer', () => {
  it('initializes without MCP or skills and starts with distinct pinned API and UI ports', async () => {
    const runCommand = vi.fn(async () => success());
    const child = new EventEmitter() as ChildProcess;
    child.kill = vi.fn(() => true);
    const spawnProcess = vi.fn((_command, _args, _options) => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });

    const result = await startOpenKnowledgeServer('/tmp/knowledge', {
      runCommand,
      spawnProcess,
      isInitialized: async () => false,
      getAvailablePorts: async () => [8789, 39847],
    });

    expect(runCommand).toHaveBeenCalledWith('ok', [
      '--cwd',
      '/tmp/knowledge',
      'init',
      '--no-mcp',
      '--no-skills',
      '--local-only',
      '--content-dir',
      '.',
      '--json',
    ]);
    expect(spawnProcess).toHaveBeenCalledWith('ok', [
      '--cwd',
      '/tmp/knowledge',
      'start',
      '--port',
      '8789',
      '--ui-port',
      '39847',
      '--host',
      '127.0.0.1',
      '--mode',
      'browser',
    ], { stdio: 'ignore' });
    expect(result).toEqual({ process: child, port: 39847, apiPort: 8789, url: 'http://127.0.0.1:39847' });
  });

  it('adds --open only for an explicit browser-opening request', async () => {
    const child = new EventEmitter() as ChildProcess;
    child.kill = vi.fn(() => true);
    const spawnProcess = vi.fn((_command, _args, _options) => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });

    await startOpenKnowledgeServer('/tmp/knowledge', {
      apiPort: 8789,
      uiPort: 39847,
      openBrowser: true,
      spawnProcess,
      isInitialized: async () => true,
    });

    expect(spawnProcess.mock.calls[0]?.[1]).toContain('--open');
    expect(spawnProcess.mock.calls[0]?.[1]).not.toContain('--no-open');
  });
});
