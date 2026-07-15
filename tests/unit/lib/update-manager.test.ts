import { describe, expect, it, vi } from 'vitest';

import { isVersionNewer, UpdateManager, updateChannelForVersion } from '../../../src/lib/update-manager.js';

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
      if (url.includes('manifest.test')) return new Response('overdeckDashboardProtocol: 1\noverdeckAgentProtocol: 1\n');
      return new Response(JSON.stringify([{
        tag_name: 'v1.2.4', name: 'Overdeck 1.2.4', body: '## Fixed\n\n- Updater', html_url: 'https://example.test/release', published_at: '2026-07-13T00:00:00Z',
        assets: [{ name: 'latest-linux.yml', browser_download_url: 'https://manifest.test/latest-linux.yml' }],
      }]));
    }) as typeof fetch;
    const manager = new UpdateManager({ currentVersion: '1.2.3', installMode: 'npm', fetchImpl });
    const snapshot = await manager.check();
    expect(snapshot).toMatchObject({
      phase: 'available', targetVersion: '1.2.4', releaseNotes: '## Fixed\n\n- Updater', compatibility: { status: 'compatible' },
    });
  });

  it('uses the canary dist-tag and bypasses the successful cache for manual checks', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => String(input).includes('registry.npmjs.org')
      ? new Response(JSON.stringify({ canary: '1.3.0-canary.2' }))
      : new Response(JSON.stringify([{ tag_name: 'v1.3.0-canary.2', prerelease: true }]))) as typeof fetch;
    const manager = new UpdateManager({ currentVersion: '1.3.0-canary.1', installMode: 'npm', fetchImpl });
    await manager.check();
    await manager.check();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await manager.check({ forceRefresh: true });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('installs the exact checked version and syncs through argv-only async calls', async () => {
    const execFileImpl = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => String(input).includes('registry.npmjs.org')
      ? new Response(JSON.stringify({ latest: '1.2.4' }))
      : new Response(JSON.stringify([{ tag_name: 'v1.2.4' }]))) as typeof fetch;
    const manager = new UpdateManager({ currentVersion: '1.2.3', installMode: 'npm', fetchImpl, execFileImpl });
    await manager.check(); manager.install(); await manager.waitForInstall();
    expect(execFileImpl.mock.calls).toEqual([
      ['npm', ['install', '--global', '@overdeck/core@1.2.4']],
      ['pan', ['sync']],
    ]);
  });

  it('never spawns an installer for a development checkout', async () => {
    const execFileImpl = vi.fn(async () => undefined);
    const manager = new UpdateManager({ currentVersion: '1.2.3', installMode: 'development', execFileImpl });
    expect(manager.install().error?.code).toBe('DEVELOPMENT_CHECK_ONLY');
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('reports current when the installed version matches the channel tag', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => String(input).includes('registry.npmjs.org')
      ? new Response(JSON.stringify({ latest: '1.2.3' }))
      : new Response(JSON.stringify([]))) as typeof fetch;
    const manager = new UpdateManager({ currentVersion: '1.2.3', installMode: 'development', fetchImpl });
    expect((await manager.check()).phase).toBe('current');
  });
});
