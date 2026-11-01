/**
 * PAN-1254: `pan tailscale status` and `pan tailscale setup`. The Tailscale
 * lib modules are mocked; nothing spawns a process or reaches a network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TailnetPeer } from '../../../src/lib/tailscale/peers.js';
import type { TailscaleState } from '../../../src/lib/tailscale/state.js';

const readTailscaleState = vi.fn<() => Promise<TailscaleState>>();
const discoverTailnetPeers = vi.fn<(...args: unknown[]) => Promise<TailnetPeer[]>>();

vi.mock('../../../src/lib/tailscale/state.js', () => ({
  readTailscaleState: () => readTailscaleState(),
  invalidateTailscaleStateCache: () => undefined,
}));
vi.mock('../../../src/lib/tailscale/peers.js', () => ({
  discoverTailnetPeers: (...args: unknown[]) => discoverTailnetPeers(...args),
}));
vi.mock('../../../src/lib/environment-identity.js', () => ({
  readEnvironmentIdentity: async () => ({ v: 1, environmentId: 'env-self', label: 'desk', createdAt: '2026-11-01T00:00:00.000Z' }),
}));
vi.mock('../../../src/cli/exit.js', () => ({
  exitCli: async (code: number) => { throw new Error(`exit ${code}`); },
}));

const { runTailscaleStatus } = await import('../../../src/cli/commands/tailscale.js');

const NAME = 'desk.tailnet.ts.net';

function tailscaleState(overrides: Partial<TailscaleState> = {}): TailscaleState {
  return {
    installed: true,
    cli: { bin: '/usr/bin/tailscale', mode: 'system', baseArgs: [] },
    mode: 'system',
    version: '1.104.4',
    daemonRunning: true,
    statusError: null,
    backendState: 'Running',
    authUrl: null,
    magicDnsName: NAME,
    serveUrl: `https://${NAME}`,
    hostName: 'desk',
    ipv4: ['100.64.0.1'],
    loginName: 'op@example.com',
    magicDnsEnabled: true,
    httpsEnabled: true,
    tailnetName: 'example.com',
    operator: 'self',
    serve: { proxiesDashboard: true, otherHandlerOn443: false, funnelOn443: false },
    peers: [],
    port: 3011,
    requireTokenMint: true,
    nextStep: 'ready',
    ...overrides,
  };
}

const LAPTOP: TailnetPeer = {
  hostName: 'laptop',
  dnsName: 'laptop.tailnet.ts.net',
  os: 'macOS',
  online: true,
  overdeck: { environmentId: 'env-laptop', label: 'laptop', serverVersion: '0.72.0', url: 'https://laptop.tailnet.ts.net' },
};

let stdout: string[];

beforeEach(() => {
  stdout = [];
  readTailscaleState.mockReset();
  discoverTailnetPeers.mockReset();
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { stdout.push(args.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pan tailscale status', () => {
  it('says how to install when Tailscale is missing and returns normally', async () => {
    readTailscaleState.mockResolvedValue(tailscaleState({ installed: false, cli: null, mode: null, nextStep: 'install' }));
    await runTailscaleStatus({});
    expect(stdout).toEqual(['Tailscale is not installed. Run `pan tailscale setup`.']);
    expect(discoverTailnetPeers).not.toHaveBeenCalled();
  });

  it('prints { state, peers } as JSON with only Overdeck peers', async () => {
    readTailscaleState.mockResolvedValue(tailscaleState());
    discoverTailnetPeers.mockResolvedValue([LAPTOP, { ...LAPTOP, hostName: 'printer', overdeck: null }]);
    await runTailscaleStatus({ json: true });
    const parsed = JSON.parse(stdout.join('\n')) as { state: TailscaleState; peers: TailnetPeer[] };
    expect(parsed.state.nextStep).toBe('ready');
    expect(parsed.peers).toHaveLength(1);
    expect(parsed.peers[0].hostName).toBe('laptop');
    expect(discoverTailnetPeers).toHaveBeenCalledWith(expect.anything(), { port: 3011, selfEnvironmentId: 'env-self' });
  });

  it('prints the fields, the next step and the peer table', async () => {
    readTailscaleState.mockResolvedValue(tailscaleState());
    discoverTailnetPeers.mockResolvedValue([LAPTOP]);
    await runTailscaleStatus({});
    const out = stdout.join('\n');
    expect(out).toContain('1.104.4');
    expect(out).toContain(NAME);
    expect(out).toContain(`https://${NAME}`);
    expect(out).toContain(`pan pair --url https://${NAME}`);
    expect(out).toContain('https://laptop.tailnet.ts.net');
  });

  it('prints the sign-in link when one is pending and skips peer discovery', async () => {
    readTailscaleState.mockResolvedValue(tailscaleState({ backendState: 'NeedsLogin', authUrl: 'https://login.tailscale.com/a/x', nextStep: 'login' }));
    await runTailscaleStatus({});
    expect(stdout.join('\n')).toContain('Open this link to sign in: https://login.tailscale.com/a/x');
    expect(discoverTailnetPeers).not.toHaveBeenCalled();
  });
});
