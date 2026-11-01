/**
 * PAN-4645 WI-14: `pan machines link|list|unlink` against a mocked dashboard.
 * PAN-4654 WI-8: `pan machines versions|update` and their formatters.
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

const {
  fleetVersionsTable,
  formatAgo,
  formatFleetUpdateCell,
  formatLinkState,
  runMachinesApprove,
  runMachinesDirectory,
  runMachinesForget,
  runMachinesJoin,
  runMachinesLink,
  runMachinesList,
  runMachinesUnlink,
  runMachinesUpdate,
  runMachinesVersions,
} = await import('../../../src/cli/commands/machines.js');

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
    expect(out).toMatch(/LABEL\s+STATE\s+ROUTE\s+ACCESS\s+SSH\s+FINGERPRINT/);
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

describe('pan machines directory verbs (PAN-2356 WI-16)', () => {
  const REQUEST_ID = 'ab'.repeat(16);
  const directory = (joins: unknown[] = []) => ({
    signedIn: true, state: 'online', url: 'https://connect.overdeck.ai', plan: 'tester', refusal: null,
    machines: [{ environmentId: 'env-vps', label: 'vps', publicKeyHex: 'b'.repeat(64), fingerprint: 'bbbb-bbbb-bbbb-bbbb-bbbb', online: true, lastSeenAt: '2026-11-01T11:59:00.000Z', serverVersion: '0.73.0', endpoints: [], linked: false }],
    approvals: [], joins, relay: null,
  });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const routes = (handler: (path: string, method: string) => Response) => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => handler(new URL(url).pathname, init.method ?? 'GET'));
  };
  const deps = { isTTY: () => false, ask: async () => true, sleep: async () => undefined, now: () => NOW };

  it('join off a TTY prints the code and the accept hint, and exits 0', async () => {
    let polls = 0;
    routes((path, method) => {
      if (path === '/api/machines') return json(200, { self: { environmentId: 'env-self', label: 'desk', fingerprint: FINGERPRINT }, links: [], inbound: [] });
      if (path === '/api/directory/join' && method === 'POST') return json(200, { requestId: REQUEST_ID });
      if (path === '/api/directory') {
        polls += 1;
        const open = polls > 1;
        return json(200, directory([{ requestId: REQUEST_ID, to: null, expiresAt: NOW + 600_000, sas: open ? '123 456' : null, fingerprint: open ? 'bbbb-bbbb-bbbb-bbbb-bbbb' : null, state: open ? 'open' : 'waiting' }]));
      }
      return json(404, { error: 'not found' });
    });
    await runMachinesJoin({}, deps);
    expect(stdout).toEqual([
      `Requested approval (request ${REQUEST_ID}). This machine's fingerprint: ${FINGERPRINT}`,
      'Code: 123 456 · approver vps bbbb-bbbb-bbbb-bbbb-bbbb',
      `Confirm with: pan machines accept ${REQUEST_ID}`,
    ]);
  });

  it('approve --yes calls open then approve, in that order', async () => {
    const calls: string[] = [];
    routes((path, method) => {
      calls.push(`${method} ${path}`);
      if (path.endsWith('/open')) return json(200, { sas: '123 456', fingerprint: 'bbbb-bbbb-bbbb-bbbb-bbbb' });
      return json(202, { approving: true });
    });
    await runMachinesApprove(REQUEST_ID, { yes: true }, deps);
    expect(calls).toEqual([`POST /api/directory/approvals/${REQUEST_ID}/open`, `POST /api/directory/approvals/${REQUEST_ID}/approve`]);
    expect(stdout[0]).toBe('Code: 123 456 · fingerprint bbbb-bbbb-bbbb-bbbb-bbbb');
  });

  it('directory --json prints the response unchanged', async () => {
    const body = directory();
    routes(() => json(200, body));
    await runMachinesDirectory({ json: true });
    expect(JSON.parse(stdout[0] ?? '')).toEqual(body);
  });

  it('forget with a label the directory does not list exits 1 with the dashboard error text', async () => {
    routes(() => json(404, { error: 'unknown', message: 'The directory does not list a machine "ghost"' }));
    await expect(runMachinesForget('ghost')).rejects.toThrow('exit 1');
    expect(stderr.join('\n')).toContain('The directory does not list a machine "ghost"');
  });
});

function fleetJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1', mode: 'when-idle', phase: 'waiting', requestedBy: 'operator', startedAt: '2026-11-01T11:59:00.000Z',
    waitingTurns: 2, waitingSince: '2026-11-01T11:59:00.000Z', finishedAt: null, components: [], ...overrides,
  };
}

function fleetRow(label: string, overrides: Record<string, unknown> = {}, job: unknown = null) {
  return {
    environmentId: `env-${label}`, label, self: false, state: 'online', stateDetail: null, peerVersion: '0.73.0',
    report: {
      environmentId: `env-${label}`, label,
      overdeck: { version: '0.73.0', installMode: 'npm-global', linkProtocol: 1 },
      harnesses: [
        { binary: 'codex', label: 'Codex CLI', harnesses: ['codex'], version: '0.159.0', updatable: true, command: 'codex update', reason: null },
        { binary: 'claude', label: 'Claude Code', harnesses: ['claude-code'], version: '2.1.5', updatable: true, command: 'claude update', reason: null },
      ],
      job,
    },
    updateSupported: true, install: null, error: null, ...overrides,
  };
}

describe('pan machines versions|update (PAN-4654 WI-8)', () => {
  it('formatFleetUpdateCell covers every phase, including the 30-minute text', () => {
    expect(formatFleetUpdateCell(null, NOW)).toBe('-');
    expect(formatFleetUpdateCell(fleetJob() as never, NOW)).toBe('waiting (2 turns)');
    expect(formatFleetUpdateCell(fleetJob({ waitingTurns: 1 }) as never, NOW)).toBe('waiting (1 turn)');
    expect(formatFleetUpdateCell(fleetJob({ waitingSince: '2026-11-01T11:29:00.000Z' }) as never, NOW)).toBe('waiting (2 turns, 31 min: use --now)');
    for (const phase of ['updating', 'restarting', 'done', 'cancelled']) {
      expect(formatFleetUpdateCell(fleetJob({ phase }) as never, NOW)).toBe(phase);
    }
    const components = [
      { name: 'claude', label: 'Claude Code', before: '2.1.0', after: '2.1.0', status: 'failed', detail: 'boom' },
      { name: 'codex', label: 'Codex CLI', before: '0.150.0', after: '0.159.0', status: 'updated', detail: null },
    ];
    expect(formatFleetUpdateCell(fleetJob({ phase: 'failed', components }) as never, NOW)).toBe('failed: claude');
    expect(formatFleetUpdateCell(fleetJob({ phase: 'failed' }) as never, NOW)).toBe('failed');
  });

  it('the versions table orders binaries per D-16 and shows 2.1.0 → 2.1.5 for an updated claude component', () => {
    const job = fleetJob({
      phase: 'done',
      components: [
        { name: 'claude', label: 'Claude Code', before: '2.1.0', after: '2.1.5', status: 'updated', detail: null },
        { name: 'codex', label: 'Codex CLI', before: '0.159.0', after: '0.159.0', status: 'current', detail: null },
        { name: 'overdeck', label: 'Overdeck', before: '0.73.0', after: null, status: 'skipped', detail: 'development install' },
      ],
    });
    const { header, rows } = fleetVersionsTable([
      fleetRow('desk', { self: true, state: 'self' }, job),
      fleetRow('lab', { state: 'offline', report: null, peerVersion: '0.72.0', updateSupported: false }),
    ] as never, NOW);
    expect(header).toEqual(['MACHINE', 'STATE', 'OVERDECK', 'CLAUDE', 'CODEX', 'UPDATE']);
    expect(rows).toEqual([
      ['desk', 'this machine', '0.73.0', '2.1.0 → 2.1.5', '0.159.0', 'done'],
      ['lab', 'offline', '0.72.0', '-', '-', '-'],
    ]);
  });

  it('versions prints the table, then one install line per install row', async () => {
    answer(200, { rows: [
      fleetRow('desk', { self: true, state: 'self' }),
      fleetRow('lab', { state: 'unsupported', report: null, updateSupported: false, install: { version: '0.73.0', on: 'peer', command: 'npm install -g @overdeck/core@0.73.0' } }),
    ] });
    await runMachinesVersions({});
    expect(stdout[0]).toMatch(/^MACHINE\s+STATE\s+OVERDECK\s+CLAUDE\s+CODEX\s+UPDATE/);
    expect(stdout.at(-1)).toBe('lab: install Overdeck 0.73.0 on lab: npm install -g @overdeck/core@0.73.0');
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('http://localhost:3011/api/machines/versions');
  });

  it('update posts when-idle by default and prints what started and what was skipped', async () => {
    answer(200, {
      started: [{ environmentId: 'env-desk', label: 'desk', job: fleetJob() }],
      skipped: [{ environmentId: 'env-lab', label: 'lab', reason: 'lab is offline' }],
    });
    await runMachinesUpdate({});
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3011/api/machines/update');
    expect(JSON.parse(init.body as string)).toEqual({ mode: 'when-idle' });
    expect(stdout).toEqual(['Started on desk (when-idle)', 'Skipped lab: lab is offline', 'Run `pan machines versions` to follow the update.']);
  });

  it('update --now --machine resolves labels to environment ids; an unknown label exits 1', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ rows: [fleetRow('desk', { self: true, state: 'self' }), fleetRow('lab')] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ started: [], skipped: [] }), { status: 200 }));
    await runMachinesUpdate({ now: true, machine: ['lab'] });
    expect(JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string)).toEqual({ mode: 'now', environmentIds: ['env-lab'] });

    answer(200, { rows: [fleetRow('desk', { self: true, state: 'self' })] });
    await expect(runMachinesUpdate({ machine: ['attic'] })).rejects.toThrow('exit 1');
    expect(stderr.at(-1)).toContain('No machine named attic');
  });

  it('update --cancel sends cancel and prints what was cancelled', async () => {
    answer(200, { started: [{ environmentId: 'env-desk', label: 'desk', job: fleetJob({ phase: 'cancelled' }) }], skipped: [] });
    await runMachinesUpdate({ cancel: true });
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({ cancel: true });
    expect(stdout[0]).toBe('Cancelled on desk');
  });
});
