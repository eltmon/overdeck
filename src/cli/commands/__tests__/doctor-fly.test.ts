import { describe, expect, it, vi } from 'vitest';

import type { RemoteConfig } from '../../../lib/config.js';
import { FlyApiError } from '../../../lib/remote/fly-api.js';
import { checkFlyToken } from '../doctor-fly.js';

function enabledRemote(overrides: Partial<RemoteConfig> = {}): RemoteConfig {
  return { enabled: true, ...overrides };
}

describe('checkFlyToken', () => {
  it('is silent when remote is disabled and no Fly machine exists', async () => {
    const checks = await checkFlyToken({
      loadRemote: async () => ({ enabled: false }),
      hasRecords: async () => false,
      loadApi: vi.fn(),
    });
    expect(checks).toEqual([]);
  });

  it('reports ok with the env var name for an explicit token', async () => {
    const listMachines = vi.fn(async () => []);
    const checks = await checkFlyToken({
      loadRemote: async () => enabledRemote({ fly: { api_token_env: 'MY_FLY_TOKEN' } }),
      hasRecords: async () => false,
      loadApi: async () => ({ tokenOrigin: 'explicit', listMachines }),
    });
    expect(checks).toEqual([{ name: 'Fly token', status: 'ok', message: 'Accepted (MY_FLY_TOKEN)' }]);
    expect(listMachines).toHaveBeenCalledWith('pan-workspaces');
  });

  it('reports ok via flyctl for the stored token', async () => {
    const checks = await checkFlyToken({
      loadRemote: async () => enabledRemote(),
      hasRecords: async () => false,
      loadApi: async () => ({ tokenOrigin: 'flyctl', listMachines: async () => [] }),
    });
    expect(checks).toEqual([{ name: 'Fly token', status: 'ok', message: 'Accepted (~/.fly/config.yml via flyctl)' }]);
  });

  it('reports error with the fix for a 403', async () => {
    const checks = await checkFlyToken({
      loadRemote: async () => enabledRemote(),
      hasRecords: async () => false,
      loadApi: async () => ({
        tokenOrigin: 'flyctl',
        listMachines: async () => { throw new FlyApiError('Fly API error 403', 403, '{"error":"unauthorized"}'); },
      }),
    });
    expect(checks).toEqual([{
      name: 'Fly token',
      status: 'error',
      message: 'Rejected (403, ~/.fly/config.yml via flyctl)',
      fix: expect.stringContaining('fly auth login'),
    }]);
  });

  it('reports ok when the app does not exist yet (404)', async () => {
    const checks = await checkFlyToken({
      loadRemote: async () => enabledRemote({ fly: { app: 'my-app' } }),
      hasRecords: async () => false,
      loadApi: async () => ({
        tokenOrigin: 'flyctl',
        listMachines: async () => { throw new FlyApiError('Fly API error 404', 404, 'not found'); },
      }),
    });
    expect(checks).toEqual([{ name: 'Fly token', status: 'ok', message: 'Accepted (~/.fly/config.yml via flyctl); app my-app does not exist yet' }]);
  });

  it('is silent with remote disabled even when loadRemote omits enabled', async () => {
    const checks = await checkFlyToken({
      loadRemote: async () => undefined,
      hasRecords: async () => false,
      loadApi: vi.fn(),
    });
    expect(checks).toEqual([]);
  });

  it('reports no token found when loadApi throws', async () => {
    const checks = await checkFlyToken({
      loadRemote: async () => enabledRemote(),
      hasRecords: async () => false,
      loadApi: async () => { throw new Error('Fly API token not found. Run `fly auth login`, or set FLY_API_TOKEN.'); },
    });
    expect(checks).toEqual([{ name: 'Fly token', status: 'error', message: 'No Fly API token', fix: expect.stringContaining('fly auth login') }]);
  });

  it('warns without leaking error detail on a non-auth failure', async () => {
    const checks = await checkFlyToken({
      loadRemote: async () => enabledRemote(),
      hasRecords: async () => false,
      loadApi: async () => ({ tokenOrigin: 'flyctl', listMachines: async () => { throw new Error('network unreachable'); } }),
    });
    expect(checks).toEqual([{ name: 'Fly token', status: 'warn', message: 'Could not check: network unreachable' }]);
  });

  it('runs the probe when disabled but a Fly machine record exists', async () => {
    const listMachines = vi.fn(async () => []);
    const checks = await checkFlyToken({
      loadRemote: async () => ({ enabled: false }),
      hasRecords: async () => true,
      loadApi: async () => ({ tokenOrigin: 'explicit', listMachines }),
    });
    expect(checks).toEqual([{ name: 'Fly token', status: 'ok', message: 'Accepted (FLY_API_TOKEN)' }]);
  });
});
