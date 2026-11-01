import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TailscaleCli, TailscaleRunResult } from '../../../../src/lib/tailscale/cli.js';
import {
  computeNextStep,
  invalidateTailscaleStateCache,
  parseServeStatus,
  parseTailscaleStatus,
  readTailscaleState,
  type NextStepInput,
  type ReadTailscaleStateDeps,
} from '../../../../src/lib/tailscale/state.js';

const NAME = 'desk.tailnet-1234.ts.net';
const PORT = 3011;

const RUNNING_STATUS = {
  BackendState: 'Running',
  AuthURL: '',
  Self: {
    DNSName: `${NAME}.`,
    HostName: 'desk',
    TailscaleIPs: ['100.101.102.103', 'fd7a:115c:a1e0::1'],
    UserID: 42,
  },
  User: { '42': { LoginName: 'op@example.com' } },
  CurrentTailnet: { Name: 'op@example.com', MagicDNSSuffix: 'tailnet-1234.ts.net', MagicDNSEnabled: true },
  CertDomains: [NAME],
  Peer: {
    'nodekey:a': { HostName: 'laptop', DNSName: 'laptop.tailnet-1234.ts.net.', TailscaleIPs: ['100.64.0.2'], OS: 'macOS', Online: true },
    'nodekey:b': { HostName: 'phone', DNSName: 'phone.tailnet-1234.ts.net.', TailscaleIPs: ['100.64.0.3'], OS: 'iOS', Online: false },
  },
};

const DASHBOARD_SERVE = {
  TCP: { '443': { HTTPS: true } },
  Web: { [`${NAME}:443`]: { Handlers: { '/': { Proxy: `http://127.0.0.1:${PORT}` } } } },
};

function nextStepInput(overrides: Partial<NextStepInput> = {}): NextStepInput {
  return {
    installed: true,
    daemonRunning: true,
    platform: 'linux',
    mode: 'system',
    uid: 1000,
    operator: 'self',
    backendState: 'Running',
    magicDnsEnabled: true,
    httpsEnabled: true,
    proxiesDashboard: true,
    requireTokenMint: true,
    ...overrides,
  };
}

describe('computeNextStep (D-8)', () => {
  it.each([
    ['install', { installed: false }],
    ['start-daemon', { daemonRunning: false }],
    ['operator', { operator: 'other' }],
    ['login', { backendState: 'NeedsLogin' }],
    ['login', { backendState: 'NeedsMachineAuth' }],
    ['login', { backendState: 'NoState' }],
    ['login', { backendState: 'Stopped' }],
    ['enable-https', { magicDnsEnabled: false }],
    ['enable-https', { httpsEnabled: false }],
    ['serve', { proxiesDashboard: false }],
    ['protect', { requireTokenMint: false }],
    ['ready', {}],
  ] as const)('returns %s for %j', (expected, overrides) => {
    expect(computeNextStep(nextStepInput(overrides as Partial<NextStepInput>))).toBe(expected);
  });

  it('returns login, not operator, when the operator is unknown', () => {
    expect(computeNextStep(nextStepInput({ operator: 'unknown', backendState: 'NeedsLogin' }))).toBe('login');
  });

  it('never routes root, userspace or non-Linux to the operator step', () => {
    expect(computeNextStep(nextStepInput({ operator: 'other', uid: 0 }))).toBe('ready');
    expect(computeNextStep(nextStepInput({ operator: 'other', mode: 'userspace' }))).toBe('ready');
    expect(computeNextStep(nextStepInput({ operator: 'other', platform: 'darwin', mode: 'app' }))).toBe('ready');
  });

  it('keeps a Starting backend on the login step instead of reporting ready', () => {
    expect(computeNextStep(nextStepInput({ backendState: 'Starting' }))).toBe('login');
  });
});

describe('parseTailscaleStatus', () => {
  it('maps the status fields', () => {
    expect(parseTailscaleStatus(RUNNING_STATUS)).toEqual({
      backendState: 'Running',
      authUrl: null,
      magicDnsName: NAME,
      hostName: 'desk',
      ipv4: ['100.101.102.103'],
      loginName: 'op@example.com',
      magicDnsEnabled: true,
      magicDnsSuffix: 'tailnet-1234.ts.net',
      tailnetName: 'op@example.com',
      httpsEnabled: true,
      peers: [
        { hostName: 'laptop', dnsName: 'laptop.tailnet-1234.ts.net', ipv4: ['100.64.0.2'], os: 'macOS', online: true },
        { hostName: 'phone', dnsName: 'phone.tailnet-1234.ts.net', ipv4: ['100.64.0.3'], os: 'iOS', online: false },
      ],
    });
  });

  it('never throws on missing or malformed fields', () => {
    expect(parseTailscaleStatus(null)).toBeNull();
    expect(parseTailscaleStatus([])).toBeNull();
    expect(parseTailscaleStatus({ BackendState: 'NeedsLogin', AuthURL: 'https://login.tailscale.com/a/x', Self: 7, Peer: { x: null } })).toMatchObject({
      backendState: 'NeedsLogin',
      authUrl: 'https://login.tailscale.com/a/x',
      magicDnsName: null,
      loginName: null,
      ipv4: [],
      magicDnsEnabled: false,
      httpsEnabled: false,
      peers: [],
    });
  });
});

describe('parseServeStatus', () => {
  it('recognises the dashboard proxy on <name>:443', () => {
    expect(parseServeStatus(DASHBOARD_SERVE, NAME, PORT)).toEqual({ proxiesDashboard: true, otherHandlerOn443: false, funnelOn443: false });
    const localhost = { Web: { [`${NAME}:443`]: { Handlers: { '/': { Proxy: `http://localhost:${PORT}/` } } } } };
    expect(parseServeStatus(localhost, `${NAME}.`, PORT).proxiesDashboard).toBe(true);
  });

  it('treats an empty or absent config as free', () => {
    expect(parseServeStatus({}, NAME, PORT)).toEqual({ proxiesDashboard: false, otherHandlerOn443: false, funnelOn443: false });
    expect(parseServeStatus(null, NAME, PORT)).toEqual({ proxiesDashboard: false, otherHandlerOn443: false, funnelOn443: false });
  });

  it('flags a proxy to another port', () => {
    const other = { Web: { [`${NAME}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:8080' } } } } };
    expect(parseServeStatus(other, NAME, PORT)).toEqual({ proxiesDashboard: false, otherHandlerOn443: true, funnelOn443: false });
  });

  it('flags a TCP forward on 443', () => {
    const forward = { TCP: { '443': { TCPForward: '127.0.0.1:8443', TerminateTLS: NAME } } };
    expect(parseServeStatus(forward, NAME, PORT)).toEqual({ proxiesDashboard: false, otherHandlerOn443: true, funnelOn443: false });
  });

  it('flags an extra web mount besides /', () => {
    const extra = {
      TCP: { '443': { HTTPS: true } },
      Web: { [`${NAME}:443`]: { Handlers: { '/': { Proxy: `http://127.0.0.1:${PORT}` }, '/grafana': { Proxy: 'http://127.0.0.1:3000' } } } },
    };
    expect(parseServeStatus(extra, NAME, PORT)).toEqual({ proxiesDashboard: true, otherHandlerOn443: true, funnelOn443: false });
  });

  it('flags Funnel on <name>:443', () => {
    const funnel = { ...DASHBOARD_SERVE, AllowFunnel: { [`${NAME}:443`]: true } };
    expect(parseServeStatus(funnel, NAME, PORT)).toEqual({ proxiesDashboard: true, otherHandlerOn443: false, funnelOn443: true });
    const otherPort = { ...DASHBOARD_SERVE, AllowFunnel: { [`${NAME}:8443`]: true } };
    expect(parseServeStatus(otherPort, NAME, PORT).funnelOn443).toBe(false);
  });

  it('ignores handlers on other ports', () => {
    const otherPort = { Web: { [`${NAME}:8443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:9000' } } } } };
    expect(parseServeStatus(otherPort, NAME, PORT)).toEqual({ proxiesDashboard: false, otherHandlerOn443: false, funnelOn443: false });
  });
});

const SYSTEM_CLI: TailscaleCli = { bin: '/usr/bin/tailscale', mode: 'system', baseArgs: [] };

function ok(stdout: string): TailscaleRunResult {
  return { ok: true, code: 0, stdout, stderr: '', timedOut: false };
}

function fail(stderr: string, extra: Partial<TailscaleRunResult> = {}): TailscaleRunResult {
  return { ok: false, code: 1, stdout: '', stderr, timedOut: false, ...extra };
}

function stateDeps(responses: Record<string, TailscaleRunResult>, overrides: Partial<ReadTailscaleStateDeps> = {}) {
  const run = vi.fn(async (_cli: TailscaleCli, args: string[]) => responses[args.join(' ')] ?? fail('unexpected'));
  const deps: ReadTailscaleStateDeps = {
    resolveCli: async () => SYSTEM_CLI,
    run,
    platform: 'linux',
    uid: 1000,
    username: 'op',
    port: PORT,
    requireTokenMint: true,
    ...overrides,
  };
  return { deps, run };
}

const READY_RESPONSES = {
  version: ok('1.104.4\n  tailscale commit: abc\n'),
  'status --json': ok(JSON.stringify(RUNNING_STATUS)),
  'serve status --json': ok(JSON.stringify(DASHBOARD_SERVE)),
  'debug prefs': ok(JSON.stringify({ OperatorUser: 'op' })),
};

describe('readTailscaleState', () => {
  beforeEach(() => {
    invalidateTailscaleStateCache();
  });

  it('resolves installed false with nextStep install when no binary exists', async () => {
    const run = vi.fn();
    const state = await readTailscaleState({ resolveCli: async () => null, run, port: PORT, requireTokenMint: true });
    expect(state).toMatchObject({ installed: false, cli: null, nextStep: 'install' });
    expect(run).not.toHaveBeenCalled();
  });

  it('resolves rather than rejects when resolution itself fails', async () => {
    const state = await readTailscaleState({ resolveCli: async () => { throw new Error('boom'); }, port: PORT, requireTokenMint: true });
    expect(state).toMatchObject({ installed: false, nextStep: 'install' });
  });

  it('reports a fully set-up machine as ready', async () => {
    const { deps } = stateDeps(READY_RESPONSES);
    const state = await readTailscaleState(deps);
    expect(state).toMatchObject({
      installed: true,
      mode: 'system',
      version: '1.104.4',
      daemonRunning: true,
      backendState: 'Running',
      magicDnsName: NAME,
      serveUrl: `https://${NAME}`,
      ipv4: ['100.101.102.103'],
      loginName: 'op@example.com',
      operator: 'self',
      serve: { proxiesDashboard: true, otherHandlerOn443: false, funnelOn443: false },
      port: PORT,
      nextStep: 'ready',
    });
    expect(state.peers.map((peer) => peer.hostName)).toEqual(['laptop']);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('routes an unreachable daemon to start-daemon', async () => {
    const { deps } = stateDeps({ ...READY_RESPONSES, 'status --json': fail('failed to connect to local tailscaled; it doesn\'t appear to be running') });
    const state = await readTailscaleState(deps);
    expect(state).toMatchObject({ daemonRunning: false, nextStep: 'start-daemon' });
    expect(state.statusError).toMatch(/failed to connect/);
  });

  it('routes a timed-out status to start-daemon instead of ready', async () => {
    const { deps } = stateDeps({ ...READY_RESPONSES, 'status --json': fail('', { timedOut: true, code: null }) });
    const state = await readTailscaleState(deps);
    expect(state).toMatchObject({ daemonRunning: false, statusError: 'tailscale status timed out', nextStep: 'start-daemon' });
  });

  it('uses the parsed backend state even when status exits non-zero', async () => {
    const { deps } = stateDeps({ ...READY_RESPONSES, 'status --json': fail('', { stdout: JSON.stringify({ BackendState: 'NeedsLogin', AuthURL: 'https://login.tailscale.com/a/x' }) }) });
    const state = await readTailscaleState(deps);
    expect(state).toMatchObject({ daemonRunning: true, authUrl: 'https://login.tailscale.com/a/x', nextStep: 'login' });
  });

  it('skips daemon calls in userspace mode when the socket is missing', async () => {
    const userspace: TailscaleCli = { bin: '/h/tailscale/bin/tailscale', mode: 'userspace', baseArgs: ['--socket=/h/tailscale/tailscaled.sock'] };
    const { deps, run } = stateDeps(READY_RESPONSES, { resolveCli: async () => userspace, socketExists: async () => false });
    const state = await readTailscaleState(deps);
    expect(state).toMatchObject({ mode: 'userspace', daemonRunning: false, nextStep: 'start-daemon' });
    expect(run.mock.calls.map(([, args]) => args.join(' '))).toEqual(['version']);
  });

  it('routes a different operator to the operator step', async () => {
    const { deps } = stateDeps({ ...READY_RESPONSES, 'debug prefs': ok(JSON.stringify({ OperatorUser: '' })) });
    expect(await readTailscaleState(deps)).toMatchObject({ operator: 'other', nextStep: 'operator' });
  });

  it('treats failed debug prefs as unknown and proceeds to login', async () => {
    const { deps } = stateDeps({
      ...READY_RESPONSES,
      'status --json': ok(JSON.stringify({ BackendState: 'NeedsLogin' })),
      'debug prefs': fail('access denied'),
    });
    expect(await readTailscaleState(deps)).toMatchObject({ operator: 'unknown', nextStep: 'login' });
  });

  it('does not read prefs as root', async () => {
    const { deps, run } = stateDeps(READY_RESPONSES, { uid: 0 });
    expect(await readTailscaleState(deps)).toMatchObject({ operator: 'self', nextStep: 'ready' });
    expect(run.mock.calls.map(([, args]) => args.join(' '))).not.toContain('debug prefs');
  });

  it('treats unparseable serve output as no serve config', async () => {
    const { deps } = stateDeps({ ...READY_RESPONSES, 'serve status --json': ok('No serve config\n') });
    expect(await readTailscaleState(deps)).toMatchObject({ serve: { proxiesDashboard: false, otherHandlerOn443: false, funnelOn443: false }, nextStep: 'serve' });
  });

  it('asks to protect the dashboard when serve is on and token mint is off', async () => {
    const { deps } = stateDeps(READY_RESPONSES, { requireTokenMint: false });
    expect(await readTailscaleState(deps)).toMatchObject({ requireTokenMint: false, nextStep: 'protect' });
  });

  it('memoizes for 3 s and shares one set of calls across concurrent readers', async () => {
    let now = 1_000;
    const { deps, run } = stateDeps(READY_RESPONSES, { now: () => now });
    const [a, b] = await Promise.all([readTailscaleState(deps), readTailscaleState(deps)]);
    expect(a).toBe(b);
    expect(run).toHaveBeenCalledTimes(4);
    now += 2_999;
    await readTailscaleState(deps);
    expect(run).toHaveBeenCalledTimes(4);
    now += 1;
    await readTailscaleState(deps);
    expect(run).toHaveBeenCalledTimes(8);
    invalidateTailscaleStateCache();
    await readTailscaleState(deps);
    expect(run).toHaveBeenCalledTimes(12);
  });
});
