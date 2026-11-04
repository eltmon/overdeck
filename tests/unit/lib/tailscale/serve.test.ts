import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TailscaleCli, TailscaleRunResult } from '../../../../src/lib/tailscale/cli.js';
import {
  SERVE_SELF_CHECK_TIMEOUT_MS,
  TAILSCALE_ADMIN_DNS_URL,
  enableTailscaleServe,
  isOldServeVersion,
  type ServeDeps,
} from '../../../../src/lib/tailscale/serve.js';
import type { TailscaleState } from '../../../../src/lib/tailscale/state.js';

const NAME = 'desk.tailnet.ts.net';
const SELF_ID = 'env-self';
const CLI: TailscaleCli = { bin: '/usr/bin/tailscale', mode: 'system', baseArgs: [] };

function runningState(overrides: Partial<TailscaleState> = {}): TailscaleState {
  return {
    installed: true,
    cli: CLI,
    mode: 'system',
    version: '1.104.4',
    daemonRunning: true,
    statusError: null,
    backendState: 'Running',
    authUrl: null,
    magicDnsName: NAME,
    serveUrl: `https://${NAME}`,
    hostName: 'desk',
    ipv4: ['100.64.0.1'],
    loginName: 'op@example.com',
    magicDnsEnabled: true,
    httpsEnabled: true,
    tailnetName: 'example.com',
    operator: 'self',
    serve: { proxiesDashboard: false, otherHandlerOn443: false, funnelOn443: false },
    peers: [],
    port: 3011,
    requireTokenMint: false,
    nextStep: 'serve',
    ...overrides,
  };
}

const okRun: TailscaleRunResult = { ok: true, code: 0, stdout: '', stderr: '', timedOut: false };

function harness(state: TailscaleState, overrides: Partial<ServeDeps> = {}) {
  const calls: string[] = [];
  const deps: ServeDeps = {
    alreadyTrusted: [],
    readState: async () => state,
    saveRequireTokenMint: vi.fn(async () => { calls.push('token-mint'); }),
    addTrustedOrigin: vi.fn(async (origin: string) => {
      calls.push(`origin ${origin}`);
      return { ok: true as const, origin, added: true };
    }),
    run: vi.fn(async (_cli: TailscaleCli, args: string[]) => {
      calls.push(args.join(' '));
      return okRun;
    }),
    fetch: vi.fn(async () => {
      calls.push('self-check');
      return new Response(JSON.stringify({ environmentId: SELF_ID }));
    }) as unknown as typeof fetch,
    selfEnvironmentId: async () => SELF_ID,
    ...overrides,
  };
  return { deps, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('enableTailscaleServe', () => {
  it('turns on token mint and trusts the origin before running serve, then self-checks', async () => {
    const { deps, calls } = harness(runningState());
    expect(await enableTailscaleServe(deps)).toEqual({ ok: true, url: `https://${NAME}`, selfCheck: 'passed', changed: true });
    expect(calls).toEqual([
      'token-mint',
      `origin https://${NAME}`,
      'serve --bg --https=443 http://127.0.0.1:3011',
      'self-check',
    ]);
    expect(deps.fetch).toHaveBeenCalledWith(`https://${NAME}/api/environment`, expect.anything());
  });

  it('leaves token mint on when the serve command fails', async () => {
    const { deps, calls } = harness(runningState(), {
      run: vi.fn(async () => ({ ok: false, code: 1, stdout: '', stderr: 'error: something broke', timedOut: false })),
    });
    expect(await enableTailscaleServe(deps)).toEqual({ ok: false, reason: 'serve-failed', message: 'tailscale serve failed: error: something broke' });
    expect(calls[0]).toBe('token-mint');
    expect(deps.saveRequireTokenMint).toHaveBeenCalledTimes(1);
  });

  it('refuses a foreign handler on 443 without running serve or writing config', async () => {
    const { deps } = harness(runningState({ serve: { proxiesDashboard: false, otherHandlerOn443: true, funnelOn443: false } }));
    expect(await enableTailscaleServe(deps)).toMatchObject({ ok: false, reason: 'foreign-handler' });
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.saveRequireTokenMint).not.toHaveBeenCalled();
  });

  it('refuses when Funnel publishes 443', async () => {
    const { deps } = harness(runningState({ serve: { proxiesDashboard: true, otherHandlerOn443: false, funnelOn443: true } }));
    expect(await enableTailscaleServe(deps)).toMatchObject({ ok: false, reason: 'foreign-handler', message: expect.stringContaining('Funnel') });
    expect(deps.saveRequireTokenMint).not.toHaveBeenCalled();
  });

  it('is idempotent once Serve proxies the dashboard', async () => {
    const { deps, calls } = harness(runningState({ serve: { proxiesDashboard: true, otherHandlerOn443: false, funnelOn443: false } }));
    expect(await enableTailscaleServe(deps)).toEqual({ ok: true, url: `https://${NAME}`, selfCheck: 'passed', changed: false });
    expect(deps.run).not.toHaveBeenCalled();
    expect(calls).toEqual(['token-mint', `origin https://${NAME}`, 'self-check']);
  });

  it('protects a dashboard that also has another mount on 443 without touching Serve', async () => {
    const { deps } = harness(runningState({ serve: { proxiesDashboard: true, otherHandlerOn443: true, funnelOn443: false } }));
    expect(await enableTailscaleServe(deps)).toMatchObject({ ok: true, changed: false });
    expect(deps.run).not.toHaveBeenCalled();
  });

  it('links the admin DNS page when HTTPS certificates are off and writes no config', async () => {
    const { deps } = harness(runningState({ httpsEnabled: false }));
    expect(await enableTailscaleServe(deps)).toMatchObject({ ok: false, reason: 'https-disabled', adminUrl: TAILSCALE_ADMIN_DNS_URL });
    expect(deps.saveRequireTokenMint).not.toHaveBeenCalled();
    expect(deps.addTrustedOrigin).not.toHaveBeenCalled();
  });

  it('refuses when Tailscale is not running', async () => {
    const { deps } = harness(runningState({ backendState: 'NeedsLogin' }));
    expect(await enableTailscaleServe(deps)).toMatchObject({ ok: false, reason: 'not-running' });
  });

  it('refuses a CLI older than 1.52', async () => {
    const { deps } = harness(runningState({ version: '1.50.1' }));
    expect(await enableTailscaleServe(deps)).toMatchObject({ ok: false, reason: 'old-version' });
    expect(deps.saveRequireTokenMint).not.toHaveBeenCalled();
  });

  it('maps access-denied output from serve', async () => {
    const { deps } = harness(runningState(), {
      run: vi.fn(async () => ({ ok: false, code: 1, stdout: '', stderr: 'Access denied: serve config denied', timedOut: false })),
    });
    expect(await enableTailscaleServe(deps)).toMatchObject({ ok: false, reason: 'access-denied' });
  });

  it('returns the enable-Serve link a tailnet without Serve prints', async () => {
    const link = 'https://login.tailscale.com/f/serve?node=abc';
    const { deps } = harness(runningState(), {
      run: vi.fn(async () => ({ ok: false, code: null, stdout: `Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         ${link}\n`, stderr: '', timedOut: true })),
    });
    expect(await enableTailscaleServe(deps)).toMatchObject({ ok: false, reason: 'https-disabled', adminUrl: link });
  });

  it('skips the self-check in userspace mode', async () => {
    const { deps } = harness(runningState({ cli: { ...CLI, mode: 'userspace' }, mode: 'userspace' }));
    expect(await enableTailscaleServe(deps)).toEqual({ ok: true, url: `https://${NAME}`, selfCheck: 'skipped-userspace', changed: true });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('fails the self-check when another machine answers', async () => {
    const { deps } = harness(runningState(), {
      fetch: vi.fn(async () => new Response(JSON.stringify({ environmentId: 'someone-else' }))) as unknown as typeof fetch,
    });
    expect(await enableTailscaleServe(deps)).toMatchObject({ ok: false, reason: 'self-check-failed' });
  });

  it('fails the self-check after 15 s with no answer', async () => {
    vi.useFakeTimers();
    const hanging = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
    const { deps } = harness(runningState(), { fetch: hanging });
    const pending = enableTailscaleServe(deps);
    await vi.advanceTimersByTimeAsync(SERVE_SELF_CHECK_TIMEOUT_MS);
    expect(await pending).toMatchObject({ ok: false, reason: 'self-check-failed', message: expect.stringContaining('15 s') });
  });
});

describe('isOldServeVersion', () => {
  it('compares major and minor against 1.52', () => {
    expect(isOldServeVersion('1.50.1')).toBe(true);
    expect(isOldServeVersion('1.52.0')).toBe(false);
    expect(isOldServeVersion('1.104.4')).toBe(false);
    expect(isOldServeVersion('2.0.0')).toBe(false);
    expect(isOldServeVersion(null)).toBe(false);
  });
});
