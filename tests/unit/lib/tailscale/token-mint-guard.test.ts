import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiSettingsConfig } from '../../../../src/lib/settings-api.js';
import { keepTokenMintWhileServing } from '../../../../src/lib/tailscale/token-mint-guard.js';

function serving(proxiesDashboard: boolean) {
  return vi.fn(async () => ({ serve: { proxiesDashboard, otherHandlerOn443: false, funnelOn443: false } }));
}

function settings(dashboard: ApiSettingsConfig['dashboard']): ApiSettingsConfig {
  return { swarm: { enabled: false }, dashboard } as unknown as ApiSettingsConfig;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('keepTokenMintWhileServing (PAN-1254 W-18)', () => {
  it('keeps token sign-in on when a stale save turns it off while Serve forwards here', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const incoming = settings({ require_token_mint: false });
    const result = await keepTokenMintWhileServing(incoming, { readState: serving(true) });
    expect(result.dashboard).toEqual({ require_token_mint: true });
    expect(result).not.toBe(incoming);
    expect(incoming.dashboard).toEqual({ require_token_mint: false });
    expect(warn).toHaveBeenCalledWith('[tailscale] kept dashboard.require_token_mint on: Tailscale Serve forwards to this dashboard');
  });

  it('lets token sign-in turn off when Serve is off', async () => {
    const incoming = settings({ require_token_mint: false });
    const result = await keepTokenMintWhileServing(incoming, { readState: serving(false) });
    expect(result).toBe(incoming);
    expect(result.dashboard).toEqual({ require_token_mint: false });
  });

  it('returns the same object without reading Tailscale when the save does not turn token sign-in off', async () => {
    for (const dashboard of [{ require_token_mint: true }, {}, undefined]) {
      const readState = serving(true);
      const incoming = settings(dashboard);
      expect(await keepTokenMintWhileServing(incoming, { readState })).toBe(incoming);
      expect(readState).not.toHaveBeenCalled();
    }
  });
});
