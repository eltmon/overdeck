import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../../services/account/src/env.ts';
import type { GitHubIdentity } from '../../../../services/account/src/github.ts';
import { handle } from '../../../../services/account/src/routes.ts';
import { githubMock } from '../../services/account/helpers/github-mock.ts';
import { fakeCtx, makeDeps, makeEnv, TEST_BASE_URL, type TestDeps } from '../../services/account/helpers/harness.ts';
import { ACCESS_DENIED_MESSAGE, loginCommand } from '../../../../src/cli/commands/account/login.js';
import { accountPath, readAccount } from '../../../../src/lib/account/store.js';
import { captureIo, runCli, type CapturedIo } from '../vault/helpers.js';

const OWNER: GitHubIdentity = { githubId: 1, login: 'owner' };
const STRANGER: GitHubIdentity = { githubId: 999, login: 'stranger' };

const originalOverdeckHome = process.env.OVERDECK_HOME;
let testHome: string;
const allCapturedIos: CapturedIo[] = [];

function makeIo(): CapturedIo {
  const io = captureIo();
  allCapturedIos.push(io);
  return io;
}

/** Routes the CLI's injected fetch straight into the account service's own handle(), in-process. */
function serviceFetch(env: Env, deps: TestDeps): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    return handle(req, env, fakeCtx(), deps);
  }) as typeof fetch;
}

function extractUserCode(stdout: string[]): string {
  const line = stdout.find((l) => l.startsWith('and enter the code: '));
  if (!line) throw new Error(`no user code line in stdout: ${JSON.stringify(stdout)}`);
  return line.slice('and enter the code: '.length);
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

const realSetTimeout = globalThis.setTimeout;

/**
 * Real filesystem I/O (ensureEnvironmentIdentity, readAccount) resolves on its own regardless
 * of vi.useFakeTimers() — sinon's fake timers never touch Node's real I/O completion — but
 * observing that from the test needs a real wait between checks since a *faked* setTimeout
 * never fires by itself. This uses the real setTimeout captured above before any faking, so
 * the fake timers installed in beforeEach (and the fake Date pollForToken's wait accounting
 * shares with the service, per the D-5 clock rule) are never disturbed. A tick cap, not a
 * Date.now() deadline, because Date is one of the things vi.useFakeTimers() fakes.
 */
async function flushRealIo(predicate: () => boolean, maxTicks = 400): Promise<void> {
  for (let i = 0; i < maxTicks && !predicate(); i++) {
    await new Promise((resolve) => realSetTimeout(resolve, 5));
  }
}

/** Mirrors tests/unit/services/account/device-flow.test.ts's approveInBrowser, driven through the in-process fetch bridge. */
async function approveInBrowser(env: Env, deps: TestDeps, userCode: string): Promise<void> {
  const fetchImpl = serviceFetch(env, deps);
  const submit = await fetchImpl(`${TEST_BASE_URL}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: TEST_BASE_URL },
    body: form({ user_code: userCode }),
  });
  expect(submit.status).toBe(200);
  const confirm = await fetchImpl(`${TEST_BASE_URL}/activate/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: TEST_BASE_URL },
    body: form({ user_code: userCode }),
  });
  expect(confirm.status).toBe(302);
  const state = /__Host-od_state=([0-9a-f]{64});/.exec(confirm.headers.get('Set-Cookie') ?? '')?.[1] ?? '';
  await fetchImpl(`${TEST_BASE_URL}/auth/github/callback?code=gh&state=${state}`, { headers: { Cookie: `__Host-od_state=${state}` } });
}

function setup(identity: GitHubIdentity): { env: Env; deps: TestDeps } {
  const env = makeEnv();
  const deps = makeDeps({ fetch: githubMock({ identity }).fetch });
  // Fake timers mock Date, so the service and the client's poll-wait accounting share one clock (D-5 clock rule).
  deps.now = () => Date.now();
  return { env, deps };
}

describe('loginCommand (PAN-4330 W-4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    testHome = mkdtempSync(join(tmpdir(), 'overdeck-account-login-'));
    process.env.OVERDECK_HOME = testHome;
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(testHome, { recursive: true, force: true });
    if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalOverdeckHome;
  });

  it('stores a 0600 account.json with an odd_ token and githubLogin "owner", and prints a line with "as owner" (ac1)', async () => {
    const { env, deps } = setup(OWNER);
    const io = makeIo();
    const loginPromise = loginCommand({ baseUrl: TEST_BASE_URL }, io, { fetch: serviceFetch(env, deps) });

    await flushRealIo(() => io.stdout.length > 0);
    const userCode = extractUserCode(io.stdout);
    await approveInBrowser(env, deps, userCode);
    await vi.advanceTimersByTimeAsync(5000);
    await loginPromise;

    expect(io.stdout.some((line) => line.includes('as owner'))).toBe(true);
    const record = await readAccount();
    expect(record?.accessToken).toMatch(/^odd_[0-9a-f]{64}$/);
    expect(record?.githubLogin).toBe('owner');
    if (process.platform !== 'win32') {
      expect(statSync(accountPath()).mode & 0o777).toBe(0o600);
    }
  });

  it('exits 1 with the invite-list message and writes no account.json for a non-allowlisted identity (ac2)', async () => {
    const { env, deps } = setup(STRANGER);
    const io = makeIo();
    const runPromise = runCli(() => loginCommand({ baseUrl: TEST_BASE_URL }, io, { fetch: serviceFetch(env, deps) }));

    await flushRealIo(() => io.stdout.length > 0);
    const userCode = extractUserCode(io.stdout);
    await approveInBrowser(env, deps, userCode);
    await vi.advanceTimersByTimeAsync(5000);

    expect(await runPromise).toBe(1);
    expect(io.stderr).toContain(ACCESS_DENIED_MESSAGE);
    await expect(readAccount()).resolves.toBeNull();
  });

  it('exits 1 for an unsupported platform before any fetch call (ac3)', async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const archDescriptor = Object.getOwnPropertyDescriptor(process, 'arch')!;
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'freebsd' });
    Object.defineProperty(process, 'arch', { ...archDescriptor, value: 'x64' });
    try {
      const io = makeIo();
      const fetchMock = vi.fn();
      const exitCode = await runCli(() => loginCommand({ baseUrl: TEST_BASE_URL }, io, { fetch: fetchMock as unknown as typeof fetch }));
      expect(exitCode).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, 'platform', platformDescriptor);
      Object.defineProperty(process, 'arch', archDescriptor);
    }
  });

  it('never prints a line containing "odd_" across any case above (ac4)', () => {
    for (const io of allCapturedIos) {
      for (const line of [...io.stdout, ...io.stderr]) {
        expect(line).not.toContain('odd_');
      }
    }
  });
});
