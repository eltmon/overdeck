/**
 * PAN-4645 WI-14: `pan machines link|list|unlink` against a mocked dashboard.
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

const { formatAgo, formatLinkState, runMachinesLink, runMachinesList, runMachinesUnlink } = await import('../../../src/cli/commands/machines.js');

const FINGERPRINT = '1a2b-3c4d-5e6f-7a8b-9c0d';
const NOW = new Date('2026-11-01T12:00:00.000Z').getTime();

function view(overrides: Record<string, unknown> = {}) {
  return {
    id: 'link-1', environmentId: 'env-desk', label: 'desk', fingerprint: FINGERPRINT, access: 'operator',
    state: 'connecting', stateDetail: null, currentRoute: null,
    routes: [{ url: 'tcp://100.101.1.2:3011', kind: 'tailnet', source: 'pairing', status: 'untried' }],
    lastHeartbeatAt: null, incident: null, peerVersion: '0.73.0', createdAt: '2026-11-01T11:00:00.000Z',
    ...overrides,
  };
}

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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pan machines (PAN-4645 WI-14)', () => {
  it('ac1: link prints "Linked <label> (<fingerprint>) over <kind> <url>, both ways, operator-level"', async () => {
    answer(200, view());
    await runMachinesLink('http://100.101.1.2:3011/#pair=odp_abc', {});
    expect(stdout[0]).toBe(`Linked desk (${FINGERPRINT}) over tailnet tcp://100.101.1.2:3011, both ways, operator-level`);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3011/api/machines/link');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ pairingUrl: 'http://100.101.1.2:3011/#pair=odp_abc', bothWays: true, access: 'operator', allowLoopback: false });
    expect((init.headers as Record<string, string>)['x-overdeck-internal-token']).toBe('test-internal-token');
  });

  it('link honours --one-way, --agent-fenced, --allow-loopback and --json, and surfaces the dashboard\'s refusal', async () => {
    answer(200, view({ access: 'agent-fenced', routes: [{ url: 'tcp://127.0.0.1:3042', kind: 'lan', source: 'pairing', status: 'untried' }] }));
    await runMachinesLink('http://127.0.0.1:3042/#pair=odp_x', { oneWay: true, agentFenced: true, allowLoopback: true });
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toMatchObject({ bothWays: false, access: 'agent-fenced', allowLoopback: true });
    expect(stdout[0]).toBe(`Linked desk (${FINGERPRINT}) over lan tcp://127.0.0.1:3042, one way, agent-fenced-level`);

    stdout = [];
    answer(200, view());
    await runMachinesLink('http://100.101.1.2:3011/#pair=odp_abc', { json: true });
    expect(JSON.parse(stdout[0]!)).toMatchObject({ id: 'link-1', label: 'desk' });

    answer(409, { error: 'unsupported', message: 'desk runs Overdeck 0.60.0, which does not support machine links at protocol 1; install a matching version there' });
    await expect(runMachinesLink('http://100.101.1.2:3011/#pair=odp_abc', {})).rejects.toThrow('exit 1');
    expect(stderr.join('\n')).toContain('install a matching version there');
  });

  it('ac2: list prints "online (froze 5.0 s, …)" for a link with a froze incident, then the inbound table', async () => {
    answer(200, {
      self: { environmentId: 'env-us', label: 'laptop', fingerprint: 'aaaa-bbbb-cccc-dddd-eeee' },
      links: [
        view({ state: 'online', currentRoute: 'tcp://100.101.1.2:3011', incident: { kind: 'froze', durationMs: 5000, at: new Date(NOW - 2 * 60_000).toISOString() } }),
        view({ id: 'link-2', label: 'lab', state: 'offline', stateDetail: 'no route answered', incident: { kind: 'network', durationMs: 12_000, at: new Date(NOW - 3_600_000).toISOString() } }),
      ],
      inbound: [{ tokenId: 'tok-1', environmentId: 'env-desk', label: 'desk', fingerprint: FINGERPRINT, access: 'operator', createdAt: '2026-11-01T11:00:00.000Z', lastUsedAt: new Date(NOW - 30_000).toISOString() }],
    });
    await runMachinesList({});
    const out = stdout.join('\n');
    expect(out).toContain('This machine: laptop (aaaa-bbbb-cccc-dddd-eeee)');
    expect(out).toMatch(/LABEL\s+STATE\s+ROUTE\s+ACCESS\s+FINGERPRINT/);
    expect(out).toContain('online (froze 5.0 s, 2 min ago)');
    expect(out).toContain('tcp://100.101.1.2:3011');
    expect(out).toContain('offline (network 12.0 s, 1 h ago): no route answered');
    expect(out).toContain('Inbound');
    expect(out).toMatch(/desk\s+operator\s+1a2b-3c4d-5e6f-7a8b-9c0d\s+just now\s+tok-1/);
    expect(formatLinkState(view({ state: 'connecting' }) as never, NOW)).toBe('connecting');
    expect(formatAgo(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe('2 d ago');
  });

  it('list with no links says how to link one; --json passes the body through', async () => {
    const body = { self: { environmentId: 'env-us', label: 'laptop', fingerprint: 'aaaa-bbbb-cccc-dddd-eeee' }, links: [], inbound: [] };
    answer(200, body);
    await runMachinesList({});
    expect(stdout.join('\n')).toContain('No linked machines. Link one with `pan machines link <pairing-url>`');
    expect(stdout.join('\n')).toContain('Inbound: no machine links to this one.');
    stdout = [];
    answer(200, body);
    await runMachinesList({ json: true });
    expect(JSON.parse(stdout[0]!)).toEqual(body);
  });

  it('ac3: unlink with an unknown label exits 1 and prints the label', async () => {
    answer(404, { error: 'no machine link matches nobody' });
    await expect(runMachinesUnlink('nobody', {})).rejects.toThrow('exit 1');
    expect(stderr.join('\n')).toContain('"nobody"');
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe('http://localhost:3011/api/machines/nobody');
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe('DELETE');

    answer(200, { ok: true, peerNotified: false });
    await runMachinesUnlink('desk', {});
    expect(stdout[0]).toContain('Unlinked "desk"');
    expect(stdout[0]).toContain('could not be reached');
    stdout = [];
    answer(200, { ok: true, peerNotified: true });
    await runMachinesUnlink('desk', {});
    expect(stdout[0]).toContain('the other machine was told');
  });

  it('ac4: with the dashboard unreachable every verb exits 1 and says to start the dashboard with pan up', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(runMachinesLink('http://100.101.1.2:3011/#pair=odp_abc', {})).rejects.toThrow('exit 1');
    await expect(runMachinesList({})).rejects.toThrow('exit 1');
    await expect(runMachinesUnlink('desk', {})).rejects.toThrow('exit 1');
    expect(stderr).toHaveLength(3);
    for (const line of stderr) expect(line).toContain('Start the dashboard with pan up');
  });
});
