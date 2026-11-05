import { existsSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runConnectorLogin, runConnectorStatus, type ConnectorIo } from '../../../../../src/lib/mcp/connector/account.js';
import { ensureLocalToken, readAccount, readIdentity, writeAccount, writePairing } from '../../../../../src/lib/mcp/connector/home.js';

const DEVICE_TOKEN = `odd_${'1'.repeat(64)}`;

interface Recorded {
  url: string;
  body: string | undefined;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function accountFetch(tokenAnswer: () => Response, calls: Recorded[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.endsWith('/oauth/device/code')) {
      return json(200, {
        device_code: 'dc',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://account.example/device',
        verification_uri_complete: 'https://account.example/device?code=ABCD-EFGH',
        expires_in: 600,
        interval: 1,
      });
    }
    if (url.endsWith('/oauth/token')) return tokenAnswer();
    if (url.endsWith('/v1/me')) {
      return json(200, { userId: 'u', githubId: 7, githubLogin: 'octo', deviceId: 'dev-1', access: { status: 'active', expiresAt: null } });
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
}

/** Real fs work runs before the poll timer exists, so step the fake clock until the promise settles. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  void promise.finally(() => {
    done = true;
  });
  while (!done) {
    await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(1_000);
  }
  return promise;
}

function recordingIo(): ConnectorIo & { lines: string[] } {
  const lines: string[] = [];
  return { lines, out: (line) => lines.push(line), err: (line) => lines.push(line) };
}

let root: string;
let home: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'connector-account-'));
  home = join(root, 'home');
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

describe('runConnectorLogin', () => {
  it('runs the device flow with the clientId and stores both URLs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const calls: Recorded[] = [];
    const io = recordingIo();
    const fetchImpl = accountFetch(() => json(200, { access_token: DEVICE_TOKEN, device_id: 'dev-1', label: 'brave-otter' }), calls);
    const done = runConnectorLogin(
      { home, env: { OVERDECK_ACCOUNT_URL: 'https://account.example', OVERDECK_CONNECTOR_DIRECTORY_URL: 'https://connect.example' } },
      io,
      { fetch: fetchImpl },
    );
    expect(await settle(done)).toBe(0);

    const identity = await readIdentity(home);
    const deviceCall = calls.find((call) => call.url.endsWith('/oauth/device/code'));
    const form = new URLSearchParams(deviceCall?.body);
    expect(form.get('environment_id')).toBe(identity?.clientId);
    expect(form.get('platform')).toMatch(/^(linux|darwin|win32)-(x64|arm64)$/);

    const account = await readAccount(home);
    expect(account).toMatchObject({
      baseUrl: 'https://account.example',
      directoryUrl: 'https://connect.example',
      accessToken: DEVICE_TOKEN,
      deviceId: 'dev-1',
      githubLogin: 'octo',
    });
    expect((await stat(join(home, 'account.json'))).mode & 0o777).toBe(0o600);
    expect(io.lines).toContain('Signed in to https://account.example as octo (device brave-otter).');
    expect(io.lines.join('\n')).not.toContain('odd_');
  });

  it('signs in after one transient device-code network failure (PAN-5068)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const calls: Recorded[] = [];
    const io = recordingIo();
    const baseFetch = accountFetch(() => json(200, { access_token: DEVICE_TOKEN, device_id: 'dev-1', label: 'brave-otter' }), calls);
    let deviceCodeFailed = false;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/oauth/device/code') && !deviceCodeFailed) {
        deviceCodeFailed = true;
        calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
        throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET', message: 'socket hang up' } });
      }
      return baseFetch(input, init);
    }) as typeof fetch;
    const done = runConnectorLogin(
      { home, env: { OVERDECK_ACCOUNT_URL: 'https://account.example', OVERDECK_CONNECTOR_DIRECTORY_URL: 'https://connect.example' } },
      io,
      { fetch: fetchImpl },
    );
    expect(await settle(done)).toBe(0);

    const deviceCodeCalls = calls.filter((call) => call.url.endsWith('/oauth/device/code'));
    expect(deviceCodeCalls).toHaveLength(2);
    const account = await readAccount(home);
    expect(account?.accessToken).toBe(DEVICE_TOKEN);
    expect(io.lines.some((line) => line.startsWith('Cannot reach'))).toBe(false);
  });

  it('refuses an http directory URL before any request', async () => {
    const calls: Recorded[] = [];
    const io = recordingIo();
    const code = await runConnectorLogin({ home, directoryUrl: 'http://example.com', env: {} }, io, {
      fetch: accountFetch(() => json(500, {}), calls),
    });
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(existsSync(join(home, 'account.json'))).toBe(false);
  });

  it('returns 1 and writes no account on access_denied', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const io = recordingIo();
    const done = runConnectorLogin({ home, env: { OVERDECK_ACCOUNT_URL: 'https://account.example' } }, io, {
      fetch: accountFetch(() => json(400, { error: 'access_denied' }), []),
    });
    expect(await settle(done)).toBe(1);
    expect(existsSync(join(home, 'account.json'))).toBe(false);
    expect(io.lines.join('\n')).toContain('pan mcp connector login');
  });
});

describe('runConnectorStatus', () => {
  async function seed(): Promise<void> {
    await writeAccount(home, {
      v: 1,
      baseUrl: 'https://account.example',
      directoryUrl: 'https://connect.example',
      accessToken: DEVICE_TOKEN,
      deviceId: 'dev-1',
      label: 'brave-otter',
      githubLogin: 'octo',
      signedInAt: '2026-11-04T00:00:00.000Z',
    });
    await writePairing(home, {
      v: 1,
      environmentId: 'env-1',
      machineKeyHex: 'a'.repeat(64),
      machineLabel: 'studio',
      token: `odk_${'2'.repeat(64)}`,
      tokenId: 'tok-1',
      scopes: ['read:state', 'operate'],
      pairedAt: '2026-11-04T00:00:00.000Z',
    });
    await ensureLocalToken(home);
  }

  it('prints not serving when healthz does not answer', async () => {
    await seed();
    const io = recordingIo();
    const refused = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    expect(await runConnectorStatus({ home, port: 7466 }, io, { fetch: refused })).toBe(0);
    expect(io.lines).toEqual([
      'account: octo (https://account.example)',
      'machine: studio (env-1)',
      'scopes: read:state, operate',
      'route: not serving',
    ]);
    expect(io.lines.join('\n')).not.toMatch(/od[kdl]_/);
  });

  it('prints the route a running serve reports', async () => {
    await seed();
    const io = recordingIo();
    const urls: string[] = [];
    const healthz = (async (input: string | URL | Request) => {
      urls.push(String(input));
      return json(200, { ok: true, machine: 'studio', route: 'relay' });
    }) as typeof fetch;
    expect(await runConnectorStatus({ home, port: 7500 }, io, { fetch: healthz })).toBe(0);
    expect(urls).toEqual(['http://127.0.0.1:7500/healthz']);
    expect(io.lines).toContain('route: relay');
    expect(io.lines.join('\n')).not.toMatch(/od[kdl]_/);
  });

  it('reports an empty home', async () => {
    const io = recordingIo();
    const refused = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await runConnectorStatus({ home, port: 7466 }, io, { fetch: refused });
    expect(io.lines).toEqual(['account: not signed in', 'machine: not paired', 'route: not serving']);
  });
});
