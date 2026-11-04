/**
 * PAN-1254: `pan tailscale status` and `pan tailscale setup`. The Tailscale
 * lib modules are mocked; nothing spawns a process or reaches a network.
 */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupDeps } from '../../../src/cli/commands/tailscale.js';
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
const spawn = vi.fn((_cmd: string, _args: string[], _opts: unknown) => {
  const child = new EventEmitter();
  queueMicrotask(() => child.emit('exit', 0));
  return child;
});
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: (cmd: string, args: string[], opts: unknown) => spawn(cmd, args, opts),
}));
vi.mock('../../../src/cli/exit.js', () => ({
  exitCli: async (code: number) => { throw new Error(`exit ${code}`); },
}));

const { runTailscaleSetup, runTailscaleStatus } = await import('../../../src/cli/commands/tailscale.js');

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
let stderr: string[];

beforeEach(() => {
  stdout = [];
  stderr = [];
  spawn.mockClear();
  readTailscaleState.mockReset();
  discoverTailnetPeers.mockReset();
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { stdout.push(args.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { stderr.push(args.join(' ')); });
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

const INSTALLER = 'curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale set --operator=op';
const OPERATOR = 'sudo tailscale set --operator=op';

/** Setup deps over a fixed sequence of states; the last state repeats. */
function setupDeps(steps: Array<Partial<TailscaleState>>, overrides: Partial<SetupDeps> = {}) {
  const queue = steps.map((step) => tailscaleState(step));
  const readState = vi.fn(async () => (queue.length > 1 ? queue.shift()! : queue[0]!));
  const deps: Partial<SetupDeps> = {
    readState,
    resolvePlan: vi.fn(async () => ({ kind: 'pane' as const, command: INSTALLER })),
    userspaceAvailable: false,
    operatorCommand: () => OPERATOR,
    installUserspace: vi.fn(async () => ({ ok: true as const })),
    restartUserspace: vi.fn(async () => ({ ok: true as const })),
    startLogin: vi.fn(async () => ({ authUrl: 'https://login.tailscale.com/a/abc' })),
    postServe: vi.fn(async () => ({ kind: 'response' as const, status: 200, body: { ok: true } })),
    overdeckPeers: vi.fn(async () => [LAPTOP]),
    platform: 'linux',
    sleep: async () => undefined,
    now: () => 0,
    ...overrides,
  };
  return { deps, readState };
}

const NOT_INSTALLED_STATE: Partial<TailscaleState> = { installed: false, cli: null, mode: null, nextStep: 'install' };

describe('pan tailscale setup', () => {
  it('walks install, operator, login and serve to ready', async () => {
    const { deps } = setupDeps([
      NOT_INSTALLED_STATE,
      { operator: 'other', backendState: 'NeedsLogin', nextStep: 'operator' },
      { backendState: 'NeedsLogin', nextStep: 'login' },
      { nextStep: 'login', backendState: 'Running' }, // the sign-in poll
      { serve: { proxiesDashboard: false, otherHandlerOn443: false, funnelOn443: false }, nextStep: 'serve' },
      {},
    ]);
    await runTailscaleSetup({}, deps);
    expect(spawn.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['sh', ['-c', INSTALLER], { stdio: 'inherit' }],
      ['sh', ['-c', OPERATOR], { stdio: 'inherit' }],
    ]);
    const out = stdout.join('\n');
    expect(out).toContain('Open this link to sign in: ');
    expect(out).toContain('https://login.tailscale.com/a/abc');
    expect(deps.postServe).toHaveBeenCalledTimes(1);
    expect(out).toContain(`https://${NAME}`);
    expect(out).toContain('https://laptop.tailnet.ts.net');
  });

  it('stops with the pan up hint when the dashboard is not running', async () => {
    const { deps } = setupDeps([{ nextStep: 'serve' }], { postServe: vi.fn(async () => ({ kind: 'unreachable' as const })) });
    await expect(runTailscaleSetup({}, deps)).rejects.toThrow('exit 1');
    expect(stderr.join('\n')).toContain('Overdeck dashboard is not running; start it with `pan up`.');
  });

  it('points to the admin DNS page and exits 1 when HTTPS certificates are off', async () => {
    const { deps } = setupDeps([{ httpsEnabled: false, nextStep: 'enable-https' }]);
    await expect(runTailscaleSetup({}, deps)).rejects.toThrow('exit 1');
    expect(stdout.join('\n')).toContain('https://login.tailscale.com/admin/dns');
  });

  it('exits 1 after one retry when a step does not move setup on', async () => {
    const { deps, readState } = setupDeps([{ operator: 'other', nextStep: 'operator' }]);
    await expect(runTailscaleSetup({}, deps)).rejects.toThrow('exit 1');
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(readState).toHaveBeenCalledTimes(3);
    expect(stderr.join('\n')).toContain('Setup is still at "operator"');
  });

  it('installs in userspace mode without spawning sudo when the plan says userspace', async () => {
    const { deps } = setupDeps([NOT_INSTALLED_STATE, {}], {
      userspaceAvailable: true,
      resolvePlan: vi.fn(async () => ({ kind: 'userspace' as const })),
    });
    await runTailscaleSetup({ userspace: true }, deps);
    expect(deps.resolvePlan).toHaveBeenCalledWith(true);
    expect(deps.installUserspace).toHaveBeenCalledTimes(1);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses --userspace without spawning anything while userspace mode is off', async () => {
    const { deps } = setupDeps([NOT_INSTALLED_STATE]);
    await expect(runTailscaleSetup({ userspace: true }, deps)).rejects.toThrow('exit 1');
    expect(spawn).not.toHaveBeenCalled();
    expect(deps.installUserspace).not.toHaveBeenCalled();
  });

  it('protects the dashboard with one POST and exits 0', async () => {
    const { deps } = setupDeps([{ requireTokenMint: false, nextStep: 'protect' }, {}]);
    await runTailscaleSetup({}, deps);
    expect(deps.postServe).toHaveBeenCalledTimes(1);
  });

  it('runs the operator command and retries sign-in once after access denied', async () => {
    const startLogin = vi.fn()
      .mockResolvedValueOnce({ error: 'access-denied', message: 'Access denied: prefs write access denied' })
      .mockResolvedValueOnce({ authUrl: null });
    const { deps } = setupDeps([
      { operator: 'unknown', backendState: 'NeedsLogin', nextStep: 'login' },
      { operator: 'self', backendState: 'NeedsLogin', nextStep: 'login' },
      {},
    ], { startLogin });
    await runTailscaleSetup({}, deps);
    expect(spawn.mock.calls.map((call) => call[1])).toEqual([['-c', OPERATOR]]);
    expect(startLogin).toHaveBeenCalledTimes(2);
  });

  it('prints the manual plan and exits 1', async () => {
    const { deps } = setupDeps([NOT_INSTALLED_STATE], {
      resolvePlan: vi.fn(async () => ({ kind: 'manual' as const, message: 'Install Tailscale for Windows.', url: 'https://tailscale.com/download/windows', command: 'winget install tailscale.tailscale' })),
    });
    await expect(runTailscaleSetup({}, deps)).rejects.toThrow('exit 1');
    expect(stdout.join('\n')).toContain('winget install tailscale.tailscale');
    expect(spawn).not.toHaveBeenCalled();
  });
});
