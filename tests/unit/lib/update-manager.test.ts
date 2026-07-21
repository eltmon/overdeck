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
