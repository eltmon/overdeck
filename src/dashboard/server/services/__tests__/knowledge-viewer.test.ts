import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createKnowledgeViewerService } from '../knowledge-viewer.js';

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.defineProperty(child, 'exitCode', { value: null, writable: true });
  child.kill = vi.fn(() => true);
  return child;
}

describe('createKnowledgeViewerService', () => {
  it('threads the resolved ok command through start and stop', async () => {
    const child = fakeChild();
    const ensure = vi.fn(async () => ({
      status: 'already-installed' as const,
      command: '/home/tester/.local/bin/ok',
    }));
    const start = vi.fn(async () => ({
      process: child,
      owned: true,
      reused: false,
      port: 39847,
      apiPort: 8789,
      url: 'http://127.0.0.1:39847',
      runtimeBundlePath: '/runtime/read-only-snapshot',
    }));
    const stop = vi.fn(async () => {});
    const service = createKnowledgeViewerService({
      resolveBundle: async () => '/repo/knowledge',
      ensure,
      start,
      stop,
      fetchImpl: vi.fn(async () => new Response('ok')),
    });

    const status = await service.getOrStartViewer('overdeck');

    expect(status.running).toBe(true);
    expect(status).not.toHaveProperty('setupPlan');
    expect(start).toHaveBeenCalledWith('/repo/knowledge', {
      openBrowser: false,
      okCommand: '/home/tester/.local/bin/ok',
    });

    await service.stopAll();

    expect(stop).toHaveBeenCalledWith('/runtime/read-only-snapshot', '/home/tester/.local/bin/ok');
  });

  it('includes setup steps when the viewer is not installed', async () => {
    const steps = ['Install Node 24 with Volta without changing your default Node.'];
    const service = createKnowledgeViewerService({
      resolveBundle: async () => '/repo/knowledge',
      ensure: vi.fn(async () => {
        throw new Error('open-knowledge is not installed');
      }),
      resolveSetupPlan: vi.fn(async () => ({
        kind: 'install-node-via-manager',
        manager: 'volta',
        installCommand: 'volta fetch node@24',
        steps,
      })),
    });

    const status = await service.getStatus('overdeck');

    expect(status).toMatchObject({
      installed: false,
      running: false,
      setupPlan: { kind: 'install-node-via-manager', steps },
    });
  });
});
