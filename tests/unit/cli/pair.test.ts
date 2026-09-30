/**
 * PAN-3762 W2.6: `pan pair` prints a #pair= fragment URL (never a query
 * string), warns on loopback bases, supports --json, and exits 1 with the
 * `pan up` hint when the dashboard is unreachable. The dashboard is a mocked
 * fetch; nothing live is called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let apiUrl = 'http://localhost:3011';
vi.mock('../../../src/lib/config.js', () => ({ getDashboardApiUrl: () => apiUrl }));
vi.mock('../../../src/lib/internal-token.js', () => ({
  ensureInternalToken: () => 'test-internal-token',
  INTERNAL_TOKEN_HEADER: 'x-overdeck-internal-token',
}));
vi.mock('../../../src/cli/exit.js', () => ({
  exitCli: async (code: number) => { throw new Error(`exit ${code}`); },
}));

const { runPair } = await import('../../../src/cli/commands/pair.js');

const CREDENTIAL = `odp_${'a'.repeat(64)}`;
const EXPIRES_AT = '2026-09-29T12:10:00.000Z';
let stdout: string[];
let stderr: string[];
const fetchMock = vi.fn();

function answer(status: number, body: unknown): void {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

beforeEach(() => {
  apiUrl = 'http://localhost:3011';
  stdout = [];
  stderr = [];
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { stdout.push(args.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { stderr.push(args.join(' ')); });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pan pair (PAN-3762)', () => {
  it('prints the credential in the URL fragment and never in a query string', async () => {
    answer(200, { credential: CREDENTIAL, expiresAt: EXPIRES_AT, pairingPath: `/#pair=${CREDENTIAL}` });
    await runPair({ url: 'https://desk.tailnet.ts.net' });

    const out = stdout.join('\n');
    expect(out).toContain(`https://desk.tailnet.ts.net/#pair=${CREDENTIAL}`);
    expect(out).not.toMatch(/\?[^#\s]*pair=/);
    expect(out).toContain(EXPIRES_AT);
    expect(out).not.toContain('only works on this machine');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3011/api/pairing/credentials');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-overdeck-internal-token']).toBe('test-internal-token');
  });

  it('warns that a loopback base only works on this machine', async () => {
    answer(200, { credential: CREDENTIAL, expiresAt: EXPIRES_AT });
    await runPair({});
    expect(stdout.join('\n')).toContain(`http://localhost:3011/#pair=${CREDENTIAL}`);
    expect(stdout.join('\n')).toContain('This URL only works on this machine.');
  });

  it('prints { url, credential, expiresAt } as JSON with --json', async () => {
    answer(200, { credential: CREDENTIAL, expiresAt: EXPIRES_AT });
    await runPair({ json: true, url: 'https://desk.example' });
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0]!)).toEqual({ url: `https://desk.example/#pair=${CREDENTIAL}`, credential: CREDENTIAL, expiresAt: EXPIRES_AT });
  });

  it('exits 1 with the pan up hint when the dashboard is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(runPair({})).rejects.toThrow('exit 1');
    expect(stderr.join('\n')).toContain('Overdeck dashboard is not running; start it with `pan up`.');
  });

  it('explains pan up on a 401', async () => {
    answer(401, { error: 'unauthorized' });
    await expect(runPair({})).rejects.toThrow('exit 1');
    expect(stderr.join('\n')).toContain('`pan pair` needs a dashboard started by `pan up`');
  });
});
