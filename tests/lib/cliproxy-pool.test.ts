import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readManagementKey = vi.fn<() => Promise<string | null>>();
vi.mock('../../src/lib/cliproxy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/cliproxy.js')>();
  return { ...actual, readManagementKey: () => readManagementKey() };
});

const { readPool, listPoolAccounts, setAccountPriority, POOL_REQUEST_TIMEOUT_MS } =
  await import('../../src/lib/cliproxy-pool.js');

// Built at runtime so no secret-shaped literal is committed.
const MANAGEMENT_KEY = ['mgmt', 'fixture', 'key', '7f3a'].join('-');
const ACCESS_TOKEN = ['access', 'fixture', 'token', '91bc'].join('-');

const CODEX_USAGE = {
  plan_type: 'pro',
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: {
      used_percent: 9,
      limit_window_seconds: 604800,
      reset_after_seconds: 538625,
      reset_at: 1795217367,
    },
    secondary_window: null,
  },
  rate_limit_reset_credits: 'opaque',
  credits: 'opaque',
  additional_rate_limits: 'opaque',
};

const CLAUDE_USAGE = {
  five_hour: { utilization: 40, resets_at: '2026-11-14T22:00:00.000Z' },
  seven_day: { utilization: 70, resets_at: '2026-11-18T09:00:00.000Z' },
};

interface ApiCallBody {
  auth_index: string;
  method: string;
  url: string;
  header: Record<string, string>;
}

type UsageAnswer = { status_code: number; body: string } | 'hang';

function authFile(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: overrides.name,
    provider: 'codex',
    email: 'pool@example.test',
    disabled: false,
    access_token: ACCESS_TOKEN,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A fetch stub that answers the management API by URL and api-call body. */
function stubFetch(files: Record<string, unknown>[], usage: Record<string, UsageAnswer>) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/v0/management/auth-files')) return jsonResponse({ files });
    if (url.endsWith('/v0/management/api-call')) {
      const body = JSON.parse(String(init?.body)) as ApiCallBody;
      const answer = usage[body.auth_index];
      if (answer === 'hang') {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      if (!answer) return jsonResponse({ error: 'unknown' }, 404);
      return jsonResponse(answer);
    }
    if (url.endsWith('/v0/management/auth-files/fields')) return jsonResponse({ status: 'ok' });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function apiCallBodies(fetchMock: ReturnType<typeof stubFetch>): ApiCallBody[] {
  return fetchMock.mock.calls
    .filter(([input]) => String(input).endsWith('/api-call'))
    .map(([, init]) => JSON.parse(String(init?.body)) as ApiCallBody);
}

beforeEach(() => {
  readManagementKey.mockResolvedValue(MANAGEMENT_KEY);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  readManagementKey.mockReset();
});

describe('readPool', () => {
  it('returns managementAvailable false when the management key is missing', async () => {
    readManagementKey.mockResolvedValue(null);
    const fetchMock = stubFetch([], {});

    const snapshot = await readPool();

    expect(snapshot.managementAvailable).toBe(false);
    expect(snapshot.accounts).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns managementAvailable false when auth-files answers non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'unauthorized' }, 401)));

    const snapshot = await readPool();

    expect(snapshot).toMatchObject({ managementAvailable: false, accounts: [] });
  });

  it('reads a codex account: weekly window, plan, exhausted false', async () => {
    const fetchMock = stubFetch(
      [authFile({ name: 'codex-primary.json', auth_index: 'a1', priority: 20, id_token: { chatgpt_account_id: 'acct-1' } })],
      { a1: { status_code: 200, body: JSON.stringify(CODEX_USAGE) } },
    );

    const snapshot = await readPool();

    expect(snapshot.managementAvailable).toBe(true);
    const [account] = snapshot.accounts;
    expect(account).toMatchObject({
      name: 'codex-primary.json',
      authIndex: 'a1',
      provider: 'codex',
      plan: 'pro',
      priority: 20,
      exhausted: false,
      error: null,
      usageRead: true,
      weeklyResetsAt: new Date(1795217367 * 1000).toISOString(),
    });
    expect(account.windows).toEqual([{
      label: 'weekly',
      usedPercent: 9,
      resetsAt: new Date(1795217367 * 1000).toISOString(),
      windowSeconds: 604800,
    }]);

    const [call] = apiCallBodies(fetchMock);
    expect(call).toMatchObject({
      auth_index: 'a1',
      method: 'GET',
      url: 'https://chatgpt.com/backend-api/wham/usage',
    });
    expect(call.header).toEqual({
      Authorization: 'Bearer $TOKEN$',
      'OpenAI-Beta': 'codex-1',
      Originator: 'Codex Desktop',
      'Chatgpt-Account-Id': 'acct-1',
    });
  });

  it('labels a short codex window 5-hour and picks the longest window as weekly', async () => {
    const usage = {
      rate_limit: {
        primary_window: { used_percent: 50, limit_window_seconds: 18000, reset_at: 1795000000 },
        secondary_window: { used_percent: 20, limit_window_seconds: 604800, reset_at: 1795500000 },
      },
    };
    stubFetch(
      [authFile({ name: 'codex-a.json', auth_index: 'a1' })],
      { a1: { status_code: 200, body: JSON.stringify(usage) } },
    );

    const [account] = (await readPool()).accounts;

    expect(account.windows.map((window) => window.label)).toEqual(['5-hour', 'weekly']);
    expect(account.weeklyResetsAt).toBe(new Date(1795500000 * 1000).toISOString());
  });

  it('marks codex exhausted when limit_reached is true', async () => {
    const usage = {
      ...CODEX_USAGE,
      rate_limit: { ...CODEX_USAGE.rate_limit, limit_reached: true },
    };
    stubFetch(
      [authFile({ name: 'codex-a.json', auth_index: 'a1' })],
      { a1: { status_code: 200, body: JSON.stringify(usage) } },
    );

    const [account] = (await readPool()).accounts;

    expect(account.exhausted).toBe(true);
  });

  it('marks codex exhausted when a window is at 100 percent', async () => {
    const usage = {
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: { used_percent: 100, limit_window_seconds: 604800, reset_at: 1795217367 },
      },
    };
    stubFetch(
      [authFile({ name: 'codex-a.json', auth_index: 'a1' })],
      { a1: { status_code: 200, body: JSON.stringify(usage) } },
    );

    expect((await readPool()).accounts[0].exhausted).toBe(true);
  });

  it('reads a claude account with five_hour and seven_day windows', async () => {
    const fetchMock = stubFetch(
      [authFile({ name: 'claude-a.json', auth_index: 'c1', provider: 'claude' })],
      { c1: { status_code: 200, body: JSON.stringify(CLAUDE_USAGE) } },
    );

    const [account] = (await readPool()).accounts;

    expect(account).toMatchObject({
      provider: 'claude',
      plan: 'Claude subscription',
      exhausted: false,
      weeklyResetsAt: '2026-11-18T09:00:00.000Z',
    });
    expect(account.windows).toEqual([
      { label: '5-hour', usedPercent: 40, resetsAt: '2026-11-14T22:00:00.000Z', windowSeconds: 18000 },
      { label: 'weekly', usedPercent: 70, resetsAt: '2026-11-18T09:00:00.000Z', windowSeconds: 604800 },
    ]);
    const [call] = apiCallBodies(fetchMock);
    expect(call.url).toBe('https://api.anthropic.com/api/oauth/usage');
    expect(call.header).toEqual({
      Authorization: 'Bearer $TOKEN$',
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'claude-code/2.1.273',
    });
  });

  it('skips usage reads for disabled and gemini accounts', async () => {
    const fetchMock = stubFetch(
      [
        authFile({ name: 'codex-off.json', auth_index: 'd1', disabled: true }),
        authFile({ name: 'gemini-primary.json', auth_index: 'g1', provider: 'gemini' }),
      ],
      {},
    );

    const snapshot = await readPool();

    expect(apiCallBodies(fetchMock)).toEqual([]);
    expect(snapshot.accounts.map((account) => [account.name, account.usageRead, account.disabled]))
      .toEqual([['codex-off.json', false, true], ['gemini-primary.json', false, false]]);
  });

  it('a provider 429 marks only that account with an error', async () => {
    stubFetch(
      [
        authFile({ name: 'codex-a.json', auth_index: 'a1' }),
        authFile({ name: 'codex-b.json', auth_index: 'b1' }),
      ],
      {
        a1: { status_code: 429, body: '{"detail":"slow down","secret":"upstream text"}' },
        b1: { status_code: 200, body: JSON.stringify(CODEX_USAGE) },
      },
    );

    const snapshot = await readPool();

    const [a, b] = snapshot.accounts;
    expect(a.error).toBe('HTTP 429 from provider');
    expect(a.windows).toEqual([]);
    expect(b.error).toBeNull();
    expect(b.windows).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain('upstream text');
  });

  it('reports an unreadable usage body without its text', async () => {
    stubFetch(
      [authFile({ name: 'codex-a.json', auth_index: 'a1' })],
      { a1: { status_code: 200, body: '<html>not json</html>' } },
    );

    const snapshot = await readPool();

    expect(snapshot.accounts[0].error).toBe('unreadable usage response');
    expect(JSON.stringify(snapshot)).not.toContain('not json');
  });

  it('the management key never appears in returned data', async () => {
    stubFetch(
      [
        authFile({ name: 'codex-a.json', auth_index: 'a1', id_token: { chatgpt_account_id: 'acct-1' } }),
        authFile({ name: 'claude-a.json', auth_index: 'c1', provider: 'claude' }),
      ],
      {
        a1: { status_code: 200, body: JSON.stringify(CODEX_USAGE) },
        c1: { status_code: 200, body: JSON.stringify(CLAUDE_USAGE) },
      },
    );

    const serialized = JSON.stringify(await readPool());

    expect(serialized).not.toContain(MANAGEMENT_KEY);
    expect(serialized).not.toContain(ACCESS_TOKEN);
  });

  it('times out a hung api-call after 15 seconds', async () => {
    vi.useFakeTimers();
    stubFetch(
      [
        authFile({ name: 'codex-a.json', auth_index: 'a1' }),
        authFile({ name: 'codex-b.json', auth_index: 'b1' }),
      ],
      {
        a1: 'hang',
        b1: { status_code: 200, body: JSON.stringify(CODEX_USAGE) },
      },
    );

    const pending = readPool();
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(POOL_REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const snapshot = await pending;

    expect(snapshot.accounts[0].error).toBe('usage request failed or timed out');
    expect(snapshot.accounts[1].error).toBeNull();
  });
});

describe('listPoolAccounts', () => {
  it('lists accounts without any upstream usage read', async () => {
    const fetchMock = stubFetch(
      [authFile({ name: 'codex-a.json', auth_index: 'a1', priority: 10 })],
      {},
    );

    const list = await listPoolAccounts();

    expect(list.managementAvailable).toBe(true);
    expect(list.accounts).toMatchObject([{ name: 'codex-a.json', priority: 10, usageRead: false }]);
    expect(apiCallBodies(fetchMock)).toEqual([]);
  });
});

describe('setAccountPriority', () => {
  it('sends PATCH auth-files/fields with name and priority', async () => {
    const fetchMock = stubFetch([], {});

    await setAccountPriority('codex-a.json', 20);

    const [input, init] = fetchMock.mock.calls[0];
    expect(String(input)).toMatch(/\/v0\/management\/auth-files\/fields$/);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'codex-a.json', priority: 20 });
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${MANAGEMENT_KEY}`);
  });

  it('throws a CliproxyError without the key on a non-2xx answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'nope' }, 500)));

    const error = await setAccountPriority('codex-a.json', 20).catch((err: unknown) => err);

    expect(error).toMatchObject({ _tag: 'CliproxyError', operation: 'set-priority' });
    expect(String((error as Error).message)).toContain('HTTP 500');
    expect(JSON.stringify(error)).not.toContain(MANAGEMENT_KEY);
  });
});
