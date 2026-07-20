import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createKnowledgeViewerService } from '../../../../../src/dashboard/server/services/knowledge-viewer.js';

function response(ok: boolean, headers: Record<string, string> = {}): Response {
  return { ok, headers: new Headers(headers) } as Response;
}

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.defineProperty(child, 'exitCode', { value: null, writable: true });
  child.kill = vi.fn(() => true);
  return child;
}

function startResult(child: ChildProcess | null, overrides: Record<string, unknown> = {}) {
  return {
    process: child,
    owned: child !== null,
    reused: child === null,
    port: 39847,
    apiPort: 8789,
    url: 'http://127.0.0.1:39847',
    runtimeBundlePath: '/runtime/read-only-snapshot',
    ...overrides,
  };
}

describe('knowledge viewer service', () => {
  it('spawns the read-only viewer and returns its embeddable URL', async () => {
    const child = fakeChild();
    const start = vi.fn(async () => startResult(child));
    const service = createKnowledgeViewerService({
      resolveBundle: async () => '/repo/knowledge',
      ensure: async () => ({ status: 'already-installed', command: 'ok' }),
      start,
      stop: async () => {},
      fetchImpl: vi.fn(async () => response(true)),
    });

    const result = await service.getOrStartViewer('overdeck');

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
      embeddable: true,
    });
    expect(start).toHaveBeenCalledWith('/repo/knowledge', { openBrowser: false });
  });

  it('reuses one healthy process for concurrent and subsequent starts', async () => {
    const child = fakeChild();
    const start = vi.fn(async () => startResult(child));
    const ensure = vi.fn(async () => ({ status: 'already-installed' as const, command: 'ok' as const }));
    const service = createKnowledgeViewerService({
      resolveBundle: async () => '/repo/knowledge',
      ensure,
      start,
      stop: async () => {},
      fetchImpl: vi.fn(async () => response(true)),
    });

    const [first, concurrent] = await Promise.all([
      service.getOrStartViewer('overdeck'),
      service.getOrStartViewer('overdeck'),
    ]);
    const subsequent = await service.getOrStartViewer('overdeck');

    expect(concurrent.url).toBe(first.url);
    expect(subsequent.url).toBe(first.url);
    expect(start).toHaveBeenCalledOnce();
    expect(ensure).toHaveBeenCalledOnce();
  });

  it('returns typed unavailable states for a missing bundle or binary', async () => {
    const noBundle = createKnowledgeViewerService({ resolveBundle: async () => null });
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

  it('stops an owned process when its post-start health probe fails', async () => {
    const child = fakeChild();
    const stop = vi.fn(async () => {});
    const service = createKnowledgeViewerService({
      resolveBundle: async () => '/repo/knowledge',
      ensure: async () => ({ status: 'already-installed', command: 'ok' }),
      start: async () => startResult(child),
      stop,
      fetchImpl: vi.fn(async () => response(false)),
    });

    await expect(service.getOrStartViewer('overdeck')).rejects.toThrow(
      'open-knowledge viewer did not remain healthy at http://127.0.0.1:39847',
    );

    expect(stop).toHaveBeenCalledWith('/runtime/read-only-snapshot');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('stops only viewer processes owned by this dashboard', async () => {
    const ownedChild = fakeChild();
    const stopOwned = vi.fn(async () => {});
    const owned = createKnowledgeViewerService({
      resolveBundle: async () => '/repo/knowledge',
      ensure: async () => ({ status: 'already-installed', command: 'ok' }),
      start: async () => startResult(ownedChild),
      stop: stopOwned,
      fetchImpl: vi.fn(async () => response(true)),
    });
    await owned.getOrStartViewer('overdeck');
    await owned.stopAll();
    expect(stopOwned).toHaveBeenCalledWith('/runtime/read-only-snapshot');

    const stopReused = vi.fn(async () => {});
    const reused = createKnowledgeViewerService({
      resolveBundle: async () => '/repo/knowledge',
      ensure: async () => ({ status: 'already-installed', command: 'ok' }),
      start: async () => startResult(null),
      stop: stopReused,
      fetchImpl: vi.fn(async () => response(true)),
    });
    await reused.getOrStartViewer('overdeck');
    await reused.stopAll();
    expect(stopReused).not.toHaveBeenCalled();
  });

  it('caches a successful binary probe until explicitly invalidated', async () => {
    const ensure = vi.fn(async () => ({ status: 'already-installed' as const, command: 'ok' as const }));
    const service = createKnowledgeViewerService({
      resolveBundle: async () => '/repo/knowledge',
      ensure,
      fetchImpl: vi.fn(async () => response(true)),
    });

    await service.getStatus('overdeck');
    await service.getStatus('overdeck');
    expect(ensure).toHaveBeenCalledOnce();

    service.invalidateInstallationCache();
    await service.getStatus('overdeck');
    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it('reports framing headers as an embed-blocked status', async () => {
    const service = createKnowledgeViewerService({
      resolveBundle: async () => '/repo/knowledge',
      ensure: async () => ({ status: 'already-installed', command: 'ok' }),
      start: async () => startResult(null),
      fetchImpl: vi.fn(async () => response(true, { 'x-frame-options': 'SAMEORIGIN' })),
    });

    await expect(service.getOrStartViewer('overdeck')).resolves.toMatchObject({
      running: true,
      embeddable: false,
    });
  });

  it('is registered in the dashboard graceful-shutdown path', async () => {
    const mainPath = fileURLToPath(new URL('../../../../../src/dashboard/server/main.ts', import.meta.url));
    const source = await readFile(mainPath, 'utf8');

    expect(source).toContain("import { stopAllKnowledgeViewers } from './services/knowledge-viewer.js';");
    expect(source).toContain('await stopAllKnowledgeViewers().catch');
  });
});
