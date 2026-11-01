/** PAN-4651 WI-9 (FR-6, FR-7): `pan machines list` shows a self row first, then load and tags. */
import { formatMachineLoad, formatMachineProfile } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/config.js', () => ({ getDashboardApiUrl: () => 'http://localhost:3011' }));
vi.mock('../../../src/lib/internal-token.js', () => ({
  ensureInternalToken: () => 'test-internal-token',
  INTERNAL_TOKEN_HEADER: 'x-overdeck-internal-token',
}));
vi.mock('../../../src/cli/exit.js', () => ({ exitCli: async (code: number) => { throw new Error(`exit ${code}`); } }));

const { runMachinesList } = await import('../../../src/cli/commands/machines.js');

const GIB = 2 ** 30;
const load = (cpu: number | null, gib: number | null, agents: number) => ({
  cpuPsiSomeAvg10: cpu, cpuSaturated: false, memAvailableBytes: gib === null ? null : gib * GIB + 123, workingAgents: agents, sampledAt: '2026-11-01T12:00:00.000Z',
});

let stdout: string[];

beforeEach(() => {
  stdout = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { stdout.push(args.join(' ')); });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    self: { environmentId: 'env-us', label: 'laptop', fingerprint: 'aaaa-bbbb-cccc-dddd-eeee', shareConversations: true, load: load(3.2, 41, 2), tags: ['docker', 'linux'], placement: 'auto' },
    links: [
      {
        id: 'link-1', environmentId: 'env-desk', label: 'desk', fingerprint: '1a2b-3c4d-5e6f-7a8b-9c0d', access: 'operator', state: 'online', stateDetail: null,
        currentRoute: 'tcp://100.101.1.2:3011', routes: [], lastHeartbeatAt: null, incident: null, peerVersion: '0.73.0', createdAt: '2026-11-01T11:00:00.000Z',
        load: load(null, 64, 0), tags: ['gpu', 'linux'], placement: 'on-request',
      },
      {
        id: 'link-2', environmentId: 'env-old', label: 'old', fingerprint: '9c0d-1a2b-3c4d-5e6f-7a8b', access: 'operator', state: 'online', stateDetail: null,
        currentRoute: null, routes: [], lastHeartbeatAt: null, incident: null, peerVersion: '0.70.0', createdAt: '2026-11-01T11:00:00.000Z',
      },
    ],
    inbound: [],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('pan machines list load and tags (PAN-4651 WI-9)', () => {
  it('ac9: prints a self row first with CPU n% · X GB · K agents and tags, then each link', async () => {
    await runMachinesList({});
    const out = stdout.join('\n');
    expect(out).toMatch(/LABEL\s+STATE\s+ROUTE\s+ACCESS\s+SSH\s+FINGERPRINT\s+LOAD\s+TAGS/);
    const rows = stdout.filter((line) => /laptop \(this machine\)|^desk|^old/.test(line));
    expect(rows[0]).toMatch(/^laptop \(this machine\)\s+self.*CPU 3% · 41 GB · 2 agents\s+docker, linux$/);
    expect(rows[1]).toMatch(/^desk\s+online.*CPU n\/a · 64 GB · 0 agents\s+gpu, linux · reserved$/);
    expect(rows[2]).toMatch(/^old\s+online.*\s-\s+-$/);
  });

  it('formats a load sample and a profile, and nothing without them', () => {
    expect(formatMachineLoad(load(3.4, 41, 2))).toBe('CPU 3% · 41 GB · 2 agents');
    expect(formatMachineLoad(undefined)).toBeNull();
    expect(formatMachineProfile(['docker'], 'on-request')).toBe('tags: docker · reserved');
    expect(formatMachineProfile([], 'auto')).toBeNull();
  });
});
