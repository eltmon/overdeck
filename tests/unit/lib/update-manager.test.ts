import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { packageRoot } from '../../../src/lib/paths.js';
import { isVersionNewer, UpdateManager, updateChannelForVersion, type UpdateInstallDeps } from '../../../src/lib/update-manager.js';

function availableFetchImpl(): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('registry.npmjs.org')) return new Response(JSON.stringify({ latest: '1.2.4' }));
    return new Response(JSON.stringify([]));
  }) as typeof fetch;
}

describe('update manager', () => {
  it('compares stable and canary versions correctly', () => {
    expect(isVersionNewer('1.3.0', '1.2.9')).toBe(true);
    expect(isVersionNewer('1.2.3', '1.2.3')).toBe(false);
    expect(isVersionNewer('1.2.3', '1.2.3-canary.9')).toBe(true);
    expect(isVersionNewer('1.2.3-canary.10', '1.2.3-canary.9')).toBe(true);
    expect(updateChannelForVersion('1.2.3-canary.9')).toBe('canary');
  });

  it('joins npm dist-tags to the exact GitHub release changelog', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('registry.npmjs.org')) return new Response(JSON.stringify({ latest: '1.2.4', canary: '1.3.0-canary.1' }));
      return new Response(JSON.stringify([{
        tag_name: 'v1.2.4', name: 'Overdeck 1.2.4', body: '## Fixed\n\n- Updater', html_url: 'https://example.test/release', published_at: '2026-07-13T00:00:00Z',
      }]));
    }) as typeof fetch;
    const manager = new UpdateManager({ currentVersion: '1.2.3', installMode: 'npm-global', fetchImpl });
    const snapshot = await manager.check();
    expect(snapshot).toMatchObject({
      phase: 'available', targetVersion: '1.2.4', releaseName: 'Overdeck 1.2.4', releaseNotes: '## Fixed\n\n- Updater',
    });
  });

  it('reports current when the installed version matches the channel tag', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => String(input).includes('registry.npmjs.org')
      ? new Response(JSON.stringify({ latest: '1.2.3' }))
      : new Response(JSON.stringify([]))) as typeof fetch;
    const manager = new UpdateManager({ currentVersion: '1.2.3', installMode: 'development', fetchImpl });
    expect((await manager.check()).phase).toBe('current');
  });
});

describe('install', () => {
  it('installs into the pan connect runtime when runtimeHome is set', async () => {
    const ensureDurableRuntime = vi.fn(async () => ({ root: '/h/.overdeck/runtime/node_modules/@overdeck/core', installed: true }));
    const execFile = vi.fn(async () => undefined);
    const installDeps: Partial<UpdateInstallDeps> = { execFile, ensureDurableRuntime };
    const manager = new UpdateManager({
      currentVersion: '1.2.3', installMode: 'npm-global', fetchImpl: availableFetchImpl(), runtimeHome: '/h/.overdeck', installDeps,
    });
    await manager.check();

    manager.install();
    await vi.waitFor(() => expect(manager.getSnapshot().phase).not.toBe('installing'));

    expect(ensureDurableRuntime).toHaveBeenCalledWith('/h/.overdeck', '1.2.4');
    for (const call of execFile.mock.calls) expect(call.join(' ')).not.toContain('--global');
  });

  it('installs globally when no runtime home is set', async () => {
    const ensureDurableRuntime = vi.fn(async () => ({ root: '/usr/lib/node_modules/@overdeck/core', installed: true }));
    const execFile = vi.fn(async () => undefined);
    const installDeps: Partial<UpdateInstallDeps> = { execFile, ensureDurableRuntime };
    const manager = new UpdateManager({
      currentVersion: '1.2.3', installMode: 'npm-global', fetchImpl: availableFetchImpl(), installDeps,
    });
    await manager.check();

    manager.install();
    await vi.waitFor(() => expect(manager.getSnapshot().phase).not.toBe('installing'));

    expect(execFile).toHaveBeenCalledWith('npm', ['install', '--global', '@overdeck/core@1.2.4']);
    expect(ensureDurableRuntime).not.toHaveBeenCalled();
  });

  it('reports the runtime install failure as an error', async () => {
    const ensureDurableRuntime = vi.fn(async () => { throw new Error('Could not install @overdeck/core@1.2.4 into /h/.overdeck/runtime'); });
    const installDeps: Partial<UpdateInstallDeps> = { ensureDurableRuntime };
    const manager = new UpdateManager({
      currentVersion: '1.2.3', installMode: 'npm-global', fetchImpl: availableFetchImpl(), runtimeHome: '/h/.overdeck', installDeps,
    });
    await manager.check();

    manager.install();
    await vi.waitFor(() => expect(manager.getSnapshot().phase).not.toBe('installing'));

    const snapshot = manager.getSnapshot();
    expect(snapshot.phase).toBe('error');
    expect(snapshot.error).toContain('Could not install');
  });

  it('runs pan sync through the bundled CLI, not PATH', async () => {
    const execFile = vi.fn(async () => undefined);
    const installDeps: Partial<UpdateInstallDeps> = { execFile, ensureDurableRuntime: vi.fn(async () => ({ root: '/h/.overdeck/runtime/node_modules/@overdeck/core', installed: true })) };
    const manager = new UpdateManager({
      currentVersion: '1.2.3', installMode: 'npm-global', fetchImpl: availableFetchImpl(), runtimeHome: '/h/.overdeck', installDeps,
    });
    await manager.check();

    manager.install();
    await vi.waitFor(() => expect(manager.getSnapshot().phase).not.toBe('installing'));

    expect(execFile).toHaveBeenCalledWith(process.execPath, [join(packageRoot, 'dist', 'cli', 'index.js'), 'sync']);
    for (const call of execFile.mock.calls) expect(call[0]).not.toBe('pan');
    const snapshot = manager.getSnapshot();
    expect(snapshot.phase).toBe('ready');
    expect(snapshot.error).toBeNull();
  });

  it('is ready with a warning when pan sync fails after a good install', async () => {
    const execFile = vi.fn(async (file: string, args: readonly string[]) => {
      if (args.includes('sync')) throw new Error('ENOENT');
    });
    const installDeps: Partial<UpdateInstallDeps> = { execFile };
    const manager = new UpdateManager({ currentVersion: '1.2.3', installMode: 'npm-global', fetchImpl: availableFetchImpl(), installDeps });
    await manager.check();

    manager.install();
    await vi.waitFor(() => expect(manager.getSnapshot().phase).not.toBe('installing'));

    const snapshot = manager.getSnapshot();
    expect(snapshot.phase).toBe('ready');
    expect(snapshot.error).toMatch(/^Installed 1\.2\.4, but pan sync failed:/);
  });
});
