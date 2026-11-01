/**
 * PAN-4404 WI-10: `pan machines add-ssh|test-ssh`, `unlink --keep-server` and
 * the SSH column of `list`, against a mocked dashboard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/config.js', () => ({ getDashboardApiUrl: () => 'http://localhost:3011' }));
vi.mock('../../../src/lib/internal-token.js', () => ({
  ensureInternalToken: () => 'test-internal-token',
  INTERNAL_TOKEN_HEADER: 'x-overdeck-internal-token',
}));
vi.mock('../../../src/cli/exit.js', () => ({
  exitCli: async (code: number) => { throw new Error(`exit ${code}`); },
}));

const { runMachinesAddSsh, runMachinesTestSsh } = await import('../../../src/cli/commands/machines-ssh.js');
const { runMachinesList, runMachinesUnlink } = await import('../../../src/cli/commands/machines.js');

const FINGERPRINT = '1a2b-3c4d-5e6f-7a8b-9c0d';
const SSH = { destination: 'me@desk', launch: 'managed', forward: 'up', forwardDetail: null, localPort: 41234, remotePort: 3011 };

function view(overrides: Record<string, unknown> = {}) {
  return {
    id: 'link-1', environmentId: 'env-desk', label: 'desk', fingerprint: FINGERPRINT, access: 'operator',
    state: 'online', stateDetail: null, currentRoute: 'tcp://127.0.0.1:41234',
    routes: [{ url: 'tcp://127.0.0.1:41234', kind: 'ssh', source: 'pairing', status: 'current' }],
    lastHeartbeatAt: null, incident: null, peerVersion: '0.72.0', createdAt: '2026-11-01T11:00:00.000Z',
    ...overrides,
  };
}

let stdout: string[];
let stderr: string[];
const fetchMock = vi.fn();

function answer(status: number, body: unknown): void {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

function request(): { url: string; method: string; body: unknown } {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined };
}

beforeEach(() => {
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

describe('pan machines add-ssh / test-ssh (PAN-4404 WI-10)', () => {
  it('add-ssh desk --json posts host, bothWays and operator access', async () => {
    answer(200, view({ ssh: SSH }));
    await runMachinesAddSsh('desk', { json: true });
    expect(request()).toEqual({ url: 'http://localhost:3011/api/machines/ssh', method: 'POST', body: { host: 'desk', bothWays: true, access: 'operator' } });
    expect(JSON.parse(stdout[0]!)).toMatchObject({ ssh: SSH });
  });

  it('--one-way --pan-path posts bothWays false and panPath', async () => {
    answer(200, view({ ssh: { ...SSH, launch: 'external' } }));
    await runMachinesAddSsh('desk', { oneWay: true, panPath: '/opt/pan/bin/pan', agentFenced: true });
    expect(request().body).toEqual({ host: 'desk', bothWays: false, access: 'agent-fenced', panPath: '/opt/pan/bin/pan' });
    expect(stdout[0]).toBe(`Linked desk (${FINGERPRINT}) over ssh me@desk; Overdeck was already running there`);
  });

  it('prints "started there" for a managed launch', async () => {
    answer(200, view({ ssh: SSH }));
    await runMachinesAddSsh('desk', {});
    expect(stdout[0]).toBe(`Linked desk (${FINGERPRINT}) over ssh me@desk; Overdeck started there`);
  });

  it('a 409 version-mismatch prints its message and exits 1', async () => {
    answer(409, { error: 'version-mismatch', message: 'desk has pan 0.71.0 and this machine has 0.72.0. Install the same version there with: npm install -g @overdeck/core@0.72.0' });
    await expect(runMachinesAddSsh('desk', {})).rejects.toThrow('exit 1');
    expect(stderr.join('\n')).toContain('npm install -g @overdeck/core@0.72.0');
  });

  it('test-ssh prints the matching version, or the error message and exits 1', async () => {
    answer(200, { reachable: true, panVersion: '0.72.0', localVersion: '0.72.0', versionMatches: true, error: null, message: null });
    await runMachinesTestSsh('desk', { panPath: '/opt/pan' });
    expect(request().body).toEqual({ host: 'desk', panPath: '/opt/pan' });
    expect(stdout[0]).toBe('Reached desk: pan 0.72.0 (matches this machine)');

    fetchMock.mockReset();
    answer(200, { reachable: false, panVersion: null, localVersion: '0.72.0', versionMatches: false, error: 'auth-failed', message: 'SSH refused the login to desk.' });
    await expect(runMachinesTestSsh('desk', {})).rejects.toThrow('exit 1');
    expect(stderr.join('\n')).toContain('SSH refused the login to desk.');
  });
});

describe('pan machines unlink --keep-server and list (PAN-4404 WI-10)', () => {
  it('unlink desk --keep-server calls DELETE /api/machines/desk?keepServer=1 and says the server was left running', async () => {
    answer(200, { ok: true, peerNotified: true, ssh: { stopped: false, reason: 'kept' } });
    await runMachinesUnlink('desk', { keepServer: true });
    expect(request()).toMatchObject({ url: 'http://localhost:3011/api/machines/desk?keepServer=1', method: 'DELETE' });
    expect(stdout.at(-1)).toBe('Left the Overdeck server on desk running (kept).');
  });

  it('unlink without --keep-server reports a stopped server', async () => {
    answer(200, { ok: true, peerNotified: true, ssh: { stopped: true, reason: 'stopped' } });
    await runMachinesUnlink('desk', {});
    expect(request().url).toBe('http://localhost:3011/api/machines/desk');
    expect(stdout.at(-1)).toBe('Stopped the Overdeck server on desk.');
  });

  it('list prints the SSH column', async () => {
    answer(200, {
      self: { environmentId: 'env-me', label: 'laptop', fingerprint: FINGERPRINT },
      links: [view({ ssh: SSH }), view({ id: 'link-2', label: 'lab', ssh: undefined })],
      inbound: [],
    });
    await runMachinesList({});
    const header = stdout.find((line) => line.includes('LABEL'))!;
    expect(header).toMatch(/ACCESS\s+SSH\s+FINGERPRINT/);
    expect(stdout.find((line) => line.startsWith('desk'))).toContain('me@desk (up, managed)');
    expect(stdout.find((line) => line.startsWith('lab'))).toMatch(/operator\s+-\s+1a2b/);
  });
});
