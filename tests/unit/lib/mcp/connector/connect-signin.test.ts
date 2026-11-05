import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectorIo } from '../../../../../src/lib/mcp/connector/account.js';
import { ensureSignedIn, type SignInOptions } from '../../../../../src/lib/mcp/connector/connect-signin.js';
import {
  type ConnectorPendingSignIn,
  readAccount,
  readPendingSignIn,
  writeAccount,
  writePendingSignIn,
} from '../../../../../src/lib/mcp/connector/home.js';

const BASE_URL = 'https://account.example';
const DEVICE_TOKEN = `odd_${'1'.repeat(64)}`;
const NOW = Date.parse('2026-11-05T12:00:00.000Z');

let root: string;
let home: string;
let calls: Array<{ url: string; body: URLSearchParams }>;
let tokenAnswer: () => Response;
let codesIssued: number;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const accountFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, body: new URLSearchParams(typeof init?.body === 'string' ? init.body : '') });
  if (url.endsWith('/oauth/device/code')) {
    codesIssued += 1;
    return json(200, {
      device_code: `oddc_${codesIssued}`,
      user_code: `CODE000${codesIssued}`,
      verification_uri: `${BASE_URL}/activate`,
      verification_uri_complete: `${BASE_URL}/activate?user_code=CODE000${codesIssued}`,
      expires_in: 900,
      interval: 5,
    });
  }
  if (url.endsWith('/oauth/token')) return tokenAnswer();
  if (url.endsWith('/v1/me')) {
    return json(200, { userId: 'u', githubId: 7, githubLogin: 'octo', deviceId: 'dev-1', access: { status: 'active', expiresAt: null } });
  }
  throw new Error(`unexpected ${url}`);
}) as typeof fetch;

function recordingIo(): ConnectorIo & { lines: string[] } {
  const lines: string[] = [];
  return { lines, out: (line) => lines.push(line), err: (line) => lines.push(line) };
}

function options(overrides: Partial<SignInOptions> = {}): SignInOptions {
  return { home, env: {}, accountUrl: BASE_URL, waitSeconds: 120, clientName: 'grok-bot', targetName: 'studio', ...overrides };
}

const signIn = (io: ConnectorIo, overrides: Partial<SignInOptions> = {}) => ensureSignedIn(options(overrides), io, { fetch: accountFetch });

function pending(overrides: Partial<ConnectorPendingSignIn> = {}): ConnectorPendingSignIn {
  return {
    v: 1,
    baseUrl: BASE_URL,
    directoryUrl: 'https://connect.overdeck.ai',
    deviceCode: 'oddc_old',
    userCode: 'OLDCODE1',
    verificationUriComplete: `${BASE_URL}/activate?user_code=OLDCODE1`,
    interval: 5,
    expiresAt: new Date(NOW + 600_000).toISOString(),
    ...overrides,
  };
}

/** Let the real fs reads before the first poll finish, until pollForToken has scheduled its wait. */
async function untilPolling(): Promise<void> {
  while (vi.getTimerCount() === 0) await new Promise((resolve) => setImmediate(resolve));
}

/** Start the poll, then advance fake time by `ms`. */
async function advanceAfterPolling(ms: number): Promise<void> {
  await untilPolling();
  await vi.advanceTimersByTimeAsync(ms);
}

const tokenCalls = () => calls.filter((call) => call.url.endsWith('/oauth/token'));
const deviceCodeCalls = () => calls.filter((call) => call.url.endsWith('/oauth/device/code'));

beforeEach(async () => {
  // setImmediate stays real so untilPolling can let the real fs reads finish.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(NOW);
  root = await mkdtemp(join(tmpdir(), 'connector-signin-'));
  home = join(root, 'home');
  calls = [];
  codesIssued = 0;
  tokenAnswer = () => json(400, { error: 'authorization_pending' });
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

describe('ensureSignedIn (PAN-5069 FR-3)', () => {
  it('returns the stored account without any request', async () => {
    await writeAccount(home, {
      v: 1, baseUrl: BASE_URL, directoryUrl: 'https://connect.overdeck.ai', accessToken: DEVICE_TOKEN,
      deviceId: 'dev-1', label: 'bot', githubLogin: 'octo', signedInAt: '2026-11-05T00:00:00.000Z',
    });
    const result = await signIn(recordingIo());
    expect(result.ok).toBe(true);
    expect(calls).toEqual([]);
  });

  it('starts a sign-in on an empty home: saves it, never polls, and returns authorize at once', async () => {
    const io = recordingIo();
    const result = await signIn(io);
    expect(result).toEqual({
      ok: false,
      status: {
        v: 1,
        status: 'authorize',
        url: `${BASE_URL}/activate?user_code=CODE0001`,
        expiresAt: new Date(NOW + 900_000).toISOString(),
        next: expect.stringContaining('click Authorize') as unknown as string,
      },
    });
    expect(tokenCalls()).toEqual([]);
    expect(await readPendingSignIn(home)).toMatchObject({ deviceCode: 'oddc_1', baseUrl: BASE_URL, interval: 5 });
    expect(io.lines).toEqual([`Open this link and click Authorize: ${BASE_URL}/activate?user_code=CODE0001`]);
    expect(io.lines.join('\n')).not.toContain('oddc_');
  });

  it('sends the bot and machine names with the device-code request (FR-9)', async () => {
    await signIn(recordingIo());
    const form = deviceCodeCalls()[0]!.body;
    expect(form.get('client_name')).toBe('grok-bot');
    expect(form.get('target_name')).toBe('studio');
  });

  it('finishes an approved pending sign-in: writes account.json and removes the pending file', async () => {
    await writePendingSignIn(home, pending());
    tokenAnswer = () => json(200, { access_token: DEVICE_TOKEN, token_type: 'Bearer', device_id: 'dev-9', label: 'bot box' });
    const io = recordingIo();
    const result = signIn(io);
    await advanceAfterPolling(5_000);
    expect((await result).ok).toBe(true);
    expect(await readAccount(home)).toMatchObject({ baseUrl: BASE_URL, accessToken: DEVICE_TOKEN, deviceId: 'dev-9', githubLogin: 'octo' });
    expect(existsSync(join(home, 'pending-signin.json'))).toBe(false);
    expect(tokenCalls()[0]!.body.get('device_code')).toBe('oddc_old');
    expect(deviceCodeCalls()).toEqual([]);
    expect(io.lines.join('\n')).not.toContain(DEVICE_TOKEN);
  });

  it('waits waitSeconds on a still-pending sign-in, then returns authorize with the same link and keeps the file', async () => {
    await writePendingSignIn(home, pending());
    const result = signIn(recordingIo(), { waitSeconds: 10 });
    await advanceAfterPolling(10_000);
    expect(await result).toMatchObject({ ok: false, status: { status: 'authorize', url: `${BASE_URL}/activate?user_code=OLDCODE1` } });
    expect(tokenCalls().length).toBeGreaterThan(0);
    expect(deviceCodeCalls()).toEqual([]);
    expect(await readPendingSignIn(home)).toEqual(pending());
  });

  it('with waitSeconds 0 returns the same link without polling', async () => {
    await writePendingSignIn(home, pending());
    expect(await signIn(recordingIo(), { waitSeconds: 0 })).toMatchObject({ ok: false, status: { url: `${BASE_URL}/activate?user_code=OLDCODE1` } });
    expect(calls).toEqual([]);
  });

  it('requests a new code when the pending sign-in has expired', async () => {
    await writePendingSignIn(home, pending({ expiresAt: new Date(NOW - 1).toISOString() }));
    const result = await signIn(recordingIo());
    expect(result).toMatchObject({ ok: false, status: { status: 'authorize', url: `${BASE_URL}/activate?user_code=CODE0001` } });
    expect(tokenCalls()).toEqual([]);
    expect(await readPendingSignIn(home)).toMatchObject({ deviceCode: 'oddc_1' });
  });

  it('requests a new code when the server says the grant expired before the local expiry', async () => {
    await writePendingSignIn(home, pending());
    tokenAnswer = () => json(400, { error: 'expired_token' });
    const result = signIn(recordingIo());
    await advanceAfterPolling(5_000);
    expect(await result).toMatchObject({ ok: false, status: { status: 'authorize', url: `${BASE_URL}/activate?user_code=CODE0001` } });
    expect(await readPendingSignIn(home)).toMatchObject({ deviceCode: 'oddc_1' });
  });

  it('reports signin-denied and removes the pending file on access_denied', async () => {
    await writePendingSignIn(home, pending());
    tokenAnswer = () => json(400, { error: 'access_denied' });
    const result = signIn(recordingIo());
    await advanceAfterPolling(5_000);
    expect(await result).toMatchObject({ ok: false, status: { status: 'error', code: 'signin-denied' } });
    expect(existsSync(join(home, 'pending-signin.json'))).toBe(false);
  });

  it('asks for a retry when overdeck.ai cannot be reached for a new code', async () => {
    const failing = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const result = await ensureSignedIn(options(), recordingIo(), { fetch: failing });
    expect(result).toMatchObject({ ok: false, status: { status: 'retry', code: 'network' } });
  });
});
