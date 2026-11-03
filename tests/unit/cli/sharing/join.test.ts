import type { JoinState, JoinView } from '@overdeck/contracts';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { joinCommand, type JoinDeps } from '../../../../src/cli/commands/sharing/join.js';
import { LocalDashboardError } from '../../../../src/cli/commands/sharing/local-dashboard.js';
import { readAccount, writeAccount } from '../../../../src/lib/account/store.js';
import { captureIo, runCli, type CapturedIo } from '../vault/helpers.js';

const API_URL = 'http://localhost:4567';
const TOKEN = `odd_${'a'.repeat(64)}`;

const realSetTimeout = globalThis.setTimeout;

/** Real file I/O (readAccount, writeAccount) completes on its own under fake timers; wait for it with the real clock. */
async function flushRealIo(predicate: () => boolean, maxTicks = 400): Promise<void> {
  for (let i = 0; i < maxTicks && !predicate(); i++) {
    await new Promise((resolve) => realSetTimeout(resolve, 5));
  }
}

function view(state: JoinState, extra: Partial<JoinView> = {}): JoinView {
  return {
    shortCode: 'BCDFGHJK',
    joinUrl: 'https://share.overdeck.ai/s/BCDFGHJK',
    state,
    contributor: false,
    login: 'alice',
    closeCode: null,
    error: null,
    ...extra,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A dashboard whose POST answers `posted` and whose GETs answer `polled` in order (the last one repeats). */
function dashboard(posted: JoinView, polled: JoinView[] = []) {
  const gets: string[] = [];
  const callDashboard = vi.fn(async (path: string, init: { method: string; body?: unknown }) => {
    if (init.method === 'POST') return jsonResponse(posted, 201);
    gets.push(path);
    return jsonResponse(polled[Math.min(gets.length - 1, polled.length - 1)] ?? posted);
  });
  return { callDashboard, gets };
}

let home: string;
let savedHome: string | undefined;

async function signIn(): Promise<void> {
  await writeAccount({
    v: 1,
    baseUrl: 'https://overdeck.ai',
    accessToken: TOKEN,
    deviceId: 'dev-1',
    label: 'laptop',
    githubLogin: 'alice',
    githubId: 7,
    signedInAt: '2026-11-03T00:00:00.000Z',
  });
}

function baseDeps(overrides: Partial<JoinDeps>): JoinDeps & { openUrl: ReturnType<typeof vi.fn> } {
  const openUrl = vi.fn(() => Promise.resolve());
  return {
    ensureDashboard: () => Promise.resolve({ apiUrl: API_URL, started: false, pid: null }),
    openUrl,
    ...overrides,
  } as JoinDeps & { openUrl: ReturnType<typeof vi.fn> };
}

function expectNoTokens(io: CapturedIo, urls: string[] = []): void {
  for (const line of [...io.stdout, ...io.stderr, ...urls]) {
    expect(line).not.toContain('odd_');
    expect(line).not.toContain('odh_');
    expect(line).not.toContain('overdeck_token');
  }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pan-join-test-'));
  savedHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = home;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  if (savedHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
});

describe('joinCommand', () => {
  it('rejects a bad target before any network call or file write', async () => {
    const io = captureIo();
    const fetch = vi.fn();
    const ensureDashboard = vi.fn();
    const { callDashboard } = dashboard(view('lobby'));

    const code = await runCli(() =>
      joinCommand('nope', {}, io, baseDeps({ fetch: fetch as unknown as typeof globalThis.fetch, ensureDashboard, callDashboard })),
    );

    expect(code).toBe(1);
    expect(io.stderr[0]).toContain('Not a share link or join code: nope');
    expect(fetch).not.toHaveBeenCalled();
    expect(ensureDashboard).not.toHaveBeenCalled();
    expect(callDashboard).not.toHaveBeenCalled();
    expect(readdirSync(home)).toEqual([]);
  });

  it('settles out of connecting and opens the lobby page', async () => {
    await signIn();
    const io = captureIo();
    const { callDashboard } = dashboard(view('connecting'), [view('connecting'), view('lobby')]);
    const deps = baseDeps({ callDashboard });

    const run = runCli(() => joinCommand('BCDF-GHJK', {}, io, deps));
    await flushRealIo(() => callDashboard.mock.calls.length > 0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await run).toBe(0);
    expect(deps.openUrl).toHaveBeenCalledTimes(1);
    expect(deps.openUrl).toHaveBeenCalledWith(`${API_URL}/#/shared/BCDFGHJK`);
    expect(io.stdout.join('\n')).toContain('Waiting for the host');
    expect(io.exitCode).toBeNull();
    expectNoTokens(io, deps.openUrl.mock.calls.map((c) => String(c[0])));
  });

  it('posts the normalized code for a join link', async () => {
    await signIn();
    const io = captureIo();
    const { callDashboard } = dashboard(view('lobby'));

    await runCli(() => joinCommand('https://share.overdeck.ai/s/bcdf-ghjk', {}, io, baseDeps({ callDashboard })));

    expect(callDashboard).toHaveBeenCalledWith('/api/joins', { method: 'POST', body: { code: 'BCDFGHJK' } });
  });

  it('exits 1 without opening a browser when the share has ended', async () => {
    await signIn();
    const io = captureIo();
    const { callDashboard } = dashboard(view('ended'));
    const deps = baseDeps({ callDashboard });

    const code = await runCli(() => joinCommand('BCDFGHJK', {}, io, deps));

    expect(code).toBe(1);
    expect(io.stderr[0]).toContain('has ended');
    expect(deps.openUrl).not.toHaveBeenCalled();
  });

  it('opens the page after the settle window when the join stays connecting', async () => {
    await signIn();
    const io = captureIo();
    const { callDashboard, gets } = dashboard(view('connecting'), [view('connecting')]);
    const deps = baseDeps({ callDashboard });

    const run = runCli(() => joinCommand('BCDFGHJK', {}, io, deps));
    await flushRealIo(() => callDashboard.mock.calls.length > 0);
    await vi.advanceTimersByTimeAsync(15_000);

    expect(await run).toBe(0);
    expect(deps.openUrl).toHaveBeenCalledTimes(1);
    expect(io.stdout.join('\n')).toContain('Still connecting');
    expect(gets.length).toBeLessThanOrEqual(30);
  });

  it('prints the URL instead of opening a browser with --no-open', async () => {
    await signIn();
    const io = captureIo();
    const { callDashboard } = dashboard(view('lobby'));
    const deps = baseDeps({ callDashboard });

    expect(await runCli(() => joinCommand('BCDFGHJK', { open: false }, io, deps))).toBe(0);

    expect(deps.openUrl).not.toHaveBeenCalled();
    const out = io.stdout.join('\n');
    expect(out).toContain(`${API_URL}/#/shared/BCDFGHJK`);
    expect(out).toContain('rejoins automatically');
  });

  it('exits 1 with the dashboard helper message when no dashboard can run', async () => {
    await signIn();
    const io = captureIo();
    const message = `No Overdeck dashboard answers at https://overdeck.localhost. Start it with pan up.`;
    const deps = baseDeps({ ensureDashboard: () => Promise.reject(new LocalDashboardError(message)) });

    expect(await runCli(() => joinCommand('BCDFGHJK', {}, io, deps))).toBe(1);
    expect(io.stderr[0]).toBe(message);
  });

  describe('sign-in with slow_down (issue AC)', () => {
    function accountFetch(slowDownBody: Record<string, unknown>) {
      let tokenPolls = 0;
      const fetch = vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        if (path === '/oauth/device/code') {
          return jsonResponse({
            device_code: 'device-code',
            user_code: 'WXYZ-2345',
            verification_uri: 'https://overdeck.ai/activate',
            verification_uri_complete: 'https://overdeck.ai/activate?user_code=WXYZ-2345',
            expires_in: 900,
            interval: 5,
          });
        }
        if (path === '/oauth/token') {
          tokenPolls += 1;
          if (tokenPolls === 1) return jsonResponse(slowDownBody, 400);
          return jsonResponse({ access_token: TOKEN, device_id: 'dev-1', label: 'laptop' });
        }
        if (path === '/v1/me') {
          return jsonResponse({
            userId: 'u-1',
            githubId: 7,
            githubLogin: 'alice',
            deviceId: 'dev-1',
            access: { status: 'active', expiresAt: null },
          });
        }
        return jsonResponse({ error: 'not_found' }, 404);
      });
      return { fetch: fetch as unknown as typeof globalThis.fetch, polls: () => tokenPolls };
    }

    for (const [label, body] of [
      ['the server interval', { error: 'slow_down', interval: 10 }],
      ['interval + 5 when the server sends none', { error: 'slow_down' }],
    ] as const) {
      it(`waits ${label} before the next token poll, then joins`, async () => {
        const io = captureIo();
        const account = accountFetch(body);
        const { callDashboard } = dashboard(view('lobby'));
        const deps = baseDeps({ fetch: account.fetch, callDashboard });

        const run = runCli(() => joinCommand('BCDFGHJK', {}, io, deps));
        await flushRealIo(() => io.stdout.includes('Waiting for approval…'));

        await vi.advanceTimersByTimeAsync(5_000);
        expect(account.polls()).toBe(1);
        await vi.advanceTimersByTimeAsync(9_999);
        expect(account.polls()).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(account.polls()).toBe(2);

        await flushRealIo(() => callDashboard.mock.calls.length > 0);
        expect(await run).toBe(0);
        expect(io.stdout[0]).toBe('Sign in to overdeck.ai to join this conversation.');
        expect(existsSync(join(home, 'account.json'))).toBe(true);
        expect((await readAccount())?.accessToken).toBe(TOKEN);
        expectNoTokens(io);
      });
    }
  });
});
