import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKnowledgeViewerService } from '../../../../../src/dashboard/server/services/knowledge-viewer.js';

function response(ok: boolean): Response {
  return { ok } as Response;
}

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.defineProperty(child, 'exitCode', { value: null, writable: true });
  child.kill = vi.fn(() => true);
  return child;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('knowledge viewer service', () => {
  it('spawns the viewer and returns its URL after the health check passes', async () => {
    const child = fakeChild();
    const health = [false, true];
    const fetchImpl = vi.fn(async () => response(health.shift() ?? true));
    const start = vi.fn(async () => ({
      process: child,
      port: 39847,
      apiPort: 8789,
      url: 'http://127.0.0.1:39847',
    }));
    const service = createKnowledgeViewerService({
      resolveBundle: async () => '/repo/knowledge',
      ensure: async () => ({ status: 'already-installed', command: 'ok' }),
      start,
      stop: async () => {},
      fetchImpl,
      retryDelayMs: 100,
      maxHealthAttempts: 2,
    });

    const resultPromise = service.getOrStartViewer('overdeck');
    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;

    expect(result).toEqual({
      projectKey: 'overdeck',
      bundleConfigured: true,
      installed: true,
      starting: false,
      running: true,
      bundlePath: '/repo/knowledge',
      port: 39847,
      apiPort: 8789,
      url: 'http://127.0.0.1:39847',
    });
    expect(start).toHaveBeenCalledOnce();
  });

  it('reuses one healthy process for concurrent and subsequent starts', async () => {
    const child = fakeChild();
    const start = vi.fn(async () => ({
      process: child,
      port: 39847,
      apiPort: 8789,
      url: 'http://127.0.0.1:39847',
    }));
    const service = createKnowledgeViewerService({
      resolveBundle: async () => '/repo/knowledge',
      ensure: async () => ({ status: 'already-installed', command: 'ok' }),
      start,
      stop: async () => {},
      fetchImpl: vi.fn(async () => response(true)),
    });

    const [first, concurrent] = await Promise.all([
      service.getOrStartViewer('overdeck'),
      service.getOrStartViewer('overdeck'),
    ]);
    const subsequent = await service.getOrStartViewer('overdeck');

    expect(first.url).toBe('http://127.0.0.1:39847');
    expect(concurrent.url).toBe(first.url);
    expect(subsequent.url).toBe(first.url);
    expect(start).toHaveBeenCalledOnce();
  });

  it('returns typed unavailable states for a missing bundle or binary', async () => {
    const noBundle = createKnowledgeViewerService({
      resolveBundle: async () => null,
    });
    const noBinary = createKnowledgeViewerService({
      resolveBundle: async () => '/repo/knowledge',
      ensure: async () => {
        throw new Error('install with npm install -g @inkeep/open-knowledge');
      },
    });

    await expect(noBundle.getOrStartViewer('overdeck')).resolves.toMatchObject({
      bundleConfigured: false,
      installed: false,
      running: false,
      message: expect.stringContaining('/okf init'),
    });
    await expect(noBinary.getOrStartViewer('overdeck')).resolves.toMatchObject({
      bundleConfigured: true,
      installed: false,
      running: false,
      message: expect.stringContaining('npm install -g'),
    });
  });

  it('rejects a health timeout and stops the failed process', async () => {
    const child = fakeChild();
    const stop = vi.fn(async () => {});
    const service = createKnowledgeViewerService({
      resolveBundle: async () => '/repo/knowledge',
      ensure: async () => ({ status: 'already-installed', command: 'ok' }),
      start: async () => ({
        process: child,
        port: 39847,
        apiPort: 8789,
        url: 'http://127.0.0.1:39847',
      }),
      stop,
      fetchImpl: vi.fn(async () => response(false)),
      retryDelayMs: 100,
      maxHealthAttempts: 2,
    });

    const resultPromise = service.getOrStartViewer('overdeck');
    const rejection = expect(resultPromise).rejects.toThrow(
      'open-knowledge viewer did not become healthy at http://127.0.0.1:39847',
    );
    await vi.advanceTimersByTimeAsync(100);
    await rejection;

    expect(stop).toHaveBeenCalledWith('/repo/knowledge');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('stops all tracked viewers during shutdown', async () => {
    const child = fakeChild();
    const stop = vi.fn(async () => {});
    const service = createKnowledgeViewerService({
      resolveBundle: async () => '/repo/knowledge',
      ensure: async () => ({ status: 'already-installed', command: 'ok' }),
      start: async () => ({
        process: child,
        port: 39847,
        apiPort: 8789,
        url: 'http://127.0.0.1:39847',
      }),
      stop,
      fetchImpl: vi.fn(async () => response(true)),
    });

    await service.getOrStartViewer('overdeck');
    await service.stopAll();

    expect(stop).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledWith('/repo/knowledge');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('is registered in the dashboard graceful-shutdown path', async () => {
    const mainPath = fileURLToPath(new URL('../../../../../src/dashboard/server/main.ts', import.meta.url));
    const source = await readFile(mainPath, 'utf8');

    expect(source).toContain("import { stopAllKnowledgeViewers } from './services/knowledge-viewer.js';");
    expect(source).toContain('await stopAllKnowledgeViewers().catch');
  });
});
