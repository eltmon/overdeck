import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DirectoryWebClient } from '@overdeck/anywhere-channel/web';
import { buildConnectorPairLink, type DirectoryMachine } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelSocket } from '../../../../../src/lib/anywhere/channel/channel-socket.js';
import { ChannelOpenError, type OpenChannelOptions, setRtcDialer, type TransportUrl } from '../../../../../src/lib/anywhere/channel/open.js';
import type { ConnectorIo } from '../../../../../src/lib/mcp/connector/account.js';
import { type ConnectDeps, runConnectorConnect } from '../../../../../src/lib/mcp/connector/connect.js';
import { CONNECT_STATUS_PREFIX, type ConnectStatus } from '../../../../../src/lib/mcp/connector/connect-output.js';
import type { ConnectorRtc } from '../../../../../src/lib/mcp/connector/dial.js';
import { type ConnectorPairing, ensureIdentity, writeAccount, writePairing } from '../../../../../src/lib/mcp/connector/home.js';
import type { PairOutcome } from '../../../../../src/lib/mcp/connector/pair.js';

const ENV = '0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9';
const MACHINE_KEY = 'ab'.repeat(32);
const CODE = `odp_${'c'.repeat(64)}`;
const DEVICE_TOKEN = `odd_${'1'.repeat(64)}`;
const PAIRING_STRING = buildConnectorPairLink({ environmentId: ENV, machineKeyHex: MACHINE_KEY, code: CODE, machineLabel: 'studio' });

const MACHINE: DirectoryMachine = {
  environmentId: ENV,
  label: 'studio',
  publicKeyHex: MACHINE_KEY,
  fingerprint: 'abab-abab-abab-abab-abab',
  online: true,
  lastSeenAt: '2026-11-04T00:00:00.000Z',
  serverVersion: '0.74.0',
  endpoints: [],
};

const PAIRING: ConnectorPairing = {
  v: 1,
  environmentId: ENV,
  machineKeyHex: MACHINE_KEY,
  machineLabel: 'studio',
  token: `odk_${'d'.repeat(64)}`,
  tokenId: 'tok-1',
  scopes: ['read:state', 'tell'],
  pairedAt: '2026-11-04T00:00:00.000Z',
};

const SELF = { id: 'tok-1', name: 'grok-bot', scopes: ['read:state', 'tell'], clientId: null, machine: { environmentId: ENV, label: 'studio' } };

let root: string;
let home: string;
let io: ConnectorIo & { lines: string[] };

beforeEach(async () => {
  // setImmediate stays real so untilTimer can let the real fs reads finish.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  root = await mkdtemp(join(tmpdir(), 'connector-connect-'));
  home = join(root, 'home');
  const lines: string[] = [];
  io = { lines, out: (line) => lines.push(line), err: (line) => lines.push(line) };
});

afterEach(async () => {
  // NFR-1: no test may print a token or the device code.
  for (const line of io.lines) {
    expect(line).not.toMatch(/od[kl]_|oddc_/);
    expect(line).not.toContain(DEVICE_TOKEN);
  }
  vi.useRealTimers();
  setRtcDialer(null);
  await rm(root, { recursive: true, force: true });
});

async function signIn(): Promise<void> {
  await writeAccount(home, {
    v: 1,
    baseUrl: 'https://account.example',
    directoryUrl: 'https://connect.example',
    accessToken: DEVICE_TOKEN,
    deviceId: 'dev-1',
    label: 'bot box',
    githubLogin: 'octo',
    signedInAt: '2026-11-04T00:00:00.000Z',
  });
  await ensureIdentity(home);
}

const fakeSocket = (): ChannelSocket => ({ destroy: vi.fn() }) as unknown as ChannelSocket;

interface Harness {
  deps: ConnectDeps;
  opens: Array<{ url: TransportUrl; mode: OpenChannelOptions['mode'] }>;
  pair: ReturnType<typeof vi.fn>;
}

function harness(opts: {
  probe?: (url: TransportUrl) => Promise<ChannelSocket>;
  self?: Array<{ status: number; json: unknown }>;
  pairOutcome?: PairOutcome;
  relayRefusal?: string | null;
  fetch?: typeof fetch;
} = {}): Harness {
  const opens: Harness['opens'] = [];
  const selfAnswers = [...(opts.self ?? [{ status: 200, json: SELF }])];
  const pair = vi.fn(async () => {
    const outcome = opts.pairOutcome ?? { ok: true, machineLabel: 'studio', environmentId: ENV, scopes: ['read:state', 'tell'] };
    if (outcome.ok) await writePairing(home, PAIRING);
    return outcome;
  });
  const deps: ConnectDeps = {
    createDirectory: () =>
      ({
        state: 'off',
        refusal: null,
        machines: [MACHINE],
        relayAllowed: true,
        async start(this: { state: string }) {
          this.state = 'online';
        },
        stop: vi.fn(),
        onStateChange: () => () => undefined,
      }) as unknown as DirectoryWebClient,
    createRtc: () =>
      ({ dialer: vi.fn(), relayRefusal: () => opts.relayRefusal ?? null, stop: vi.fn(), transport: { close: vi.fn() } }) as unknown as ConnectorRtc,
    openPairingChannel: async (url, channelOpts) => {
      opens.push({ url, mode: channelOpts.mode });
      return (opts.probe ?? (async () => fakeSocket()))(url);
    },
    now: () => new Date('2026-11-05T12:00:00.000Z'),
    linkFetch: async () => selfAnswers.shift() ?? { status: 200, json: SELF },
    pairWithMachine: pair as unknown as ConnectDeps['pairWithMachine'],
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  };
  return { deps, opens, pair };
}

const run = (deps: ConnectDeps, overrides: { pairingString?: string; env?: NodeJS.ProcessEnv } = {}) =>
  runConnectorConnect(
    {
      pairingString: overrides.pairingString ?? PAIRING_STRING,
      name: 'grok-bot',
      platform: 'grok-bot',
      waitSeconds: 120,
      accountUrl: 'https://account.example',
      home,
      env: overrides.env ?? {},
      appVersion: '0.75.0',
    },
    io,
    deps,
  );

function lastStatus(): ConnectStatus {
  const last = io.lines.at(-1) ?? '';
  expect(last.startsWith(CONNECT_STATUS_PREFIX)).toBe(true);
  return JSON.parse(last.slice(CONNECT_STATUS_PREFIX.length)) as ConnectStatus;
}

async function untilTimer(): Promise<void> {
  while (vi.getTimerCount() === 0) await new Promise((resolve) => setImmediate(resolve));
}

describe('runConnectorConnect (PAN-5069 FR-1 to FR-7)', () => {
  it('reports bad-pairing-string for garbage and exits 1', async () => {
    expect(await run(harness().deps, { pairingString: 'garbage' })).toBe(1);
    expect(lastStatus()).toMatchObject({ status: 'error', code: 'bad-pairing-string' });
  });

  it('starts the sign-in on an empty home and exits 3 with the activate link last', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        device_code: 'oddc_x', user_code: 'ABCDEFGH', verification_uri: 'https://account.example/activate',
        verification_uri_complete: 'https://account.example/activate?user_code=ABCDEFGH', expires_in: 900, interval: 5,
      }), { status: 200 }),
    );
    const h = harness({ fetch: fetchMock as unknown as typeof fetch });
    expect(await run(h.deps)).toBe(3);
    expect(lastStatus()).toMatchObject({ status: 'authorize', url: 'https://account.example/activate?user_code=ABCDEFGH' });
    const form = new URLSearchParams((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(form.get('client_name')).toBe('grok-bot');
    expect(form.get('target_name')).toBe('studio');
    expect(h.pair).not.toHaveBeenCalled();
  });

  it('pairs, verifies and prints ready with the route and the registration', async () => {
    await signIn();
    const h = harness();
    expect(await run(h.deps)).toBe(0);
    expect(h.pair).toHaveBeenCalledWith(
      { pairingString: PAIRING_STRING, label: 'grok-bot', home, appVersion: '0.75.0' },
      h.deps,
    );
    const status = lastStatus();
    expect(status).toMatchObject({ status: 'ready', machine: 'studio', environmentId: ENV, route: 'direct', scopes: ['read:state', 'tell'] });
    expect(status.status === 'ready' && status.registration.args).toEqual(['-y', '@overdeck/core@0.75.0', 'mcp', 'connector', 'serve', '--stdio']);
    expect(io.lines).toContain('Connected to studio over direct with read:state, tell.');
    expect(io.lines).toContain("Add this to the plugin's mcp.json:");
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reuses a pairing that still verifies and never opens a pairing-mode channel', async () => {
    await signIn();
    await writePairing(home, PAIRING);
    const h = harness();
    expect(await run(h.deps)).toBe(0);
    expect(h.pair).not.toHaveBeenCalled();
    expect(h.opens.every((open) => open.mode === 'link')).toBe(true);
    expect(lastStatus()).toMatchObject({ status: 'ready' });
  });

  it('pairs again with the code when the existing pairing verifies with 403', async () => {
    await signIn();
    await writePairing(home, PAIRING);
    const h = harness({ self: [{ status: 403, json: { error: 'this connector was removed', code: 'connector-removed' } }, { status: 200, json: SELF }] });
    expect(await run(h.deps)).toBe(0);
    expect(h.pair).toHaveBeenCalledTimes(1);
    expect(h.pair.mock.calls[0]![0]).toMatchObject({ pairingString: PAIRING_STRING });
    expect(lastStatus()).toMatchObject({ status: 'ready' });
  });

  it('pairs again with the code when the machine refuses the link key (unknown-peer)', async () => {
    await signIn();
    await writePairing(home, PAIRING);
    let removed = true;
    const h = harness({
      probe: async () => {
        if (removed) throw new ChannelOpenError('unknown-peer', 'unknown peer');
        return fakeSocket();
      },
    });
    h.pair.mockImplementationOnce(async () => {
      removed = false;
      await writePairing(home, PAIRING);
      return { ok: true, machineLabel: 'studio', environmentId: ENV, scopes: ['read:state', 'tell'] };
    });
    expect(await run(h.deps)).toBe(0);
    expect(h.pair).toHaveBeenCalledTimes(1);
    expect(lastStatus()).toMatchObject({ status: 'ready' });
  });

  it('does not pair twice when a fresh pairing is refused too', async () => {
    await signIn();
    const h = harness({ self: [{ status: 403, json: { error: 'nope' } }] });
    expect(await run(h.deps)).toBe(1);
    expect(h.pair).toHaveBeenCalledTimes(1);
    expect(lastStatus()).toMatchObject({ status: 'error', code: 'pairing-failed' });
  });

  it('exits 1 with pairing-code-refused when the machine refuses the code', async () => {
    await signIn();
    const h = harness({ pairOutcome: { ok: false, code: 'pairing-code-refused', message: 'refused' } });
    expect(await run(h.deps)).toBe(1);
    expect(lastStatus()).toMatchObject({ status: 'error', code: 'pairing-code-refused', detail: 'refused' });
  });

  it('exits 4 with verify-failed when the link does not come up within 30 s', async () => {
    await signIn();
    await writePairing(home, PAIRING);
    const h = harness({ probe: () => new Promise<ChannelSocket>(() => undefined) });
    const result = run(h.deps);
    await untilTimer();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toBe(4);
    expect(lastStatus()).toMatchObject({ status: 'retry', code: 'verify-failed' });
    expect(h.pair).not.toHaveBeenCalled();
  });

  it('reports relay-plan-needed when no direct path exists and the relay is refused', async () => {
    await signIn();
    await writePairing(home, PAIRING);
    const h = harness({
      relayRefusal: 'The relay needs the relay plan',
      probe: async () => {
        throw new ChannelOpenError('unreachable', 'ICE failed');
      },
    });
    expect(await run(h.deps)).toBe(1);
    expect(lastStatus()).toMatchObject({ status: 'error', code: 'relay-plan-needed' });
  });
});
