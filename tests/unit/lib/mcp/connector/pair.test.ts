import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { duplexPair } from 'node:stream';

import type { DirectoryWebClient } from '@overdeck/anywhere-channel/web';
import type { DirectoryMachine } from '@overdeck/contracts';
import { buildConnectorPairLink } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelSocket } from '../../../../../src/lib/anywhere/channel/channel-socket.js';
import { ChannelOpenError, setRtcDialer, type TransportUrl } from '../../../../../src/lib/anywhere/channel/open.js';
import type { ConnectorIo } from '../../../../../src/lib/mcp/connector/account.js';
import type { ConnectorRtc } from '../../../../../src/lib/mcp/connector/dial.js';
import { ensureIdentity, readIdentity, readPairing, writeAccount } from '../../../../../src/lib/mcp/connector/home.js';
import { type ConnectorDeps, runConnectorPair } from '../../../../../src/lib/mcp/connector/pair.js';

const ENV = '0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9';
const MACHINE_KEY = 'ab'.repeat(32);
const CODE = `odp_${'c'.repeat(64)}`;
const CONNECTOR_TOKEN = `odk_${'d'.repeat(64)}`;

const MACHINE: DirectoryMachine = {
  environmentId: ENV,
  label: 'studio',
  publicKeyHex: MACHINE_KEY,
  fingerprint: 'abab-abab-abab-abab-abab',
  online: true,
  lastSeenAt: '2026-11-04T00:00:00.000Z',
  serverVersion: '0.73.1',
  endpoints: [],
};

let root: string;
let home: string;
let pairingString: string;
let server: http.Server;
let received: Array<{ method?: string; url?: string; body: unknown }>;
let answer: { status: number; body: unknown };

function recordingIo(): ConnectorIo & { out_: string[]; err_: string[] } {
  const out_: string[] = [];
  const err_: string[] = [];
  return { out_, err_, out: (line) => out_.push(line), err: (line) => err_.push(line) };
}

/** A ChannelSocket stand-in: one end of a duplex pair whose other end the test http.Server reads. */
function fakeChannel(remoteKeyHex = MACHINE_KEY): ChannelSocket {
  const [a, b] = duplexPair();
  a.once('close', () => b.destroy());
  b.once('close', () => a.destroy());
  server.emit('connection', a);
  // The socket shims a real ChannelSocket has, which Node's keep-alive agent calls.
  const shims = { setKeepAlive: () => b, setNoDelay: () => b, setTimeout: () => b, ref: () => b, unref: () => b };
  return Object.assign(b, shims, { channel: { mode: 'pairing', remoteKeyHex, pairingId: 'pid' } }) as unknown as ChannelSocket;
}

function fakeDirectory(opts: { relayAllowed?: boolean; machines?: DirectoryMachine[] } = {}) {
  return {
    state: 'off' as string,
    refusal: null,
    machines: opts.machines ?? [MACHINE],
    relayAllowed: opts.relayAllowed ?? true,
    start: vi.fn(async function (this: { state: string }) {
      this.state = 'online';
    }),
    stop: vi.fn(),
    onStateChange: () => () => undefined,
  };
}

function deps(
  opts: { relayRefusal?: string | null; open?: (url: TransportUrl) => Promise<ChannelSocket>; machines?: DirectoryMachine[] } = {},
): ConnectorDeps & { urls: TransportUrl[]; rtcStop: ReturnType<typeof vi.fn> } {
  const urls: TransportUrl[] = [];
  const rtcStop = vi.fn();
  return {
    urls,
    rtcStop,
    createDirectory: () => fakeDirectory({ machines: opts.machines }) as unknown as DirectoryWebClient,
    createRtc: () =>
      ({ dialer: vi.fn(), relayRefusal: () => opts.relayRefusal ?? null, stop: rtcStop, transport: {} }) as unknown as ConnectorRtc,
    openPairingChannel: async (url) => {
      urls.push(url);
      return (opts.open ?? (async () => fakeChannel()))(url);
    },
    now: () => new Date('2026-11-04T12:00:00.000Z'),
  };
}

async function signIn(): Promise<void> {
  await writeAccount(home, {
    v: 1,
    baseUrl: 'https://account.example',
    directoryUrl: 'https://connect.example',
    accessToken: `odd_${'1'.repeat(64)}`,
    deviceId: 'dev-1',
    label: 'brave-otter',
    githubLogin: 'octo',
    signedInAt: '2026-11-04T00:00:00.000Z',
  });
}

const run = (d: ConnectorDeps, io: ConnectorIo, label = 'bot box') =>
  runConnectorPair({ pairingString, label, home, appVersion: '0.74.0' }, io, d);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'connector-pair-'));
  home = join(root, 'home');
  pairingString = buildConnectorPairLink({ environmentId: ENV, machineKeyHex: MACHINE_KEY, code: CODE });
  received = [];
  answer = {
    status: 200,
    body: { v: 1, token: CONNECTOR_TOKEN, tokenId: 'tok-1', scopes: ['read:state', 'operate'], descriptor: { label: 'studio', machineKey: MACHINE_KEY } },
  };
  server = http.createServer((req, res) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      text += chunk;
    });
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, body: text ? (JSON.parse(text) as unknown) : null });
      res.statusCode = answer.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(answer.body));
    });
  });
});

afterEach(async () => {
  setRtcDialer(null);
  server?.close();
  await rm(root, { recursive: true, force: true });
});

describe('runConnectorPair', () => {
  it('refuses a malformed pairing string and touches no file', async () => {
    const io = recordingIo();
    pairingString = 'overdeck-connector:/pair#v=1&e=nope';
    expect(await run(deps(), io)).toBe(1);
    expect(io.err_.join('\n')).toContain('copy it again from Connect a bot');
    expect(existsSync(home)).toBe(false);
  });

  it('asks for a sign-in first', async () => {
    const io = recordingIo();
    expect(await run(deps(), io)).toBe(1);
    expect(io.err_).toEqual(['Sign in first: pan mcp connector login']);
  });

  it('pairs, writes the records and prints no token', async () => {
    await signIn();
    const before = await ensureIdentity(home);
    const io = recordingIo();
    const d = deps();
    expect(await run(d, io)).toBe(0);

    expect(d.urls).toEqual([`rtc://${ENV}`]);
    expect(received).toEqual([{ method: 'POST', url: '/api/connectors/exchange', body: { v: 1, clientId: before.clientId, label: 'bot box' } }]);
    expect(await readPairing(home)).toEqual({
      v: 1,
      environmentId: ENV,
      machineKeyHex: MACHINE_KEY,
      machineLabel: 'studio',
      token: CONNECTOR_TOKEN,
      tokenId: 'tok-1',
      scopes: ['read:state', 'operate'],
      pairedAt: '2026-11-04T12:00:00.000Z',
    });
    const after = await readIdentity(home);
    expect(after?.clientId).toBe(before.clientId);
    expect(after?.linkPublicKey).not.toBe(before.linkPublicKey);
    expect(after?.installPublicKey).toBe(before.installPublicKey);
    for (const name of ['pairing.json', 'local-token', 'identity.json']) {
      expect((await stat(join(home, name))).mode & 0o777).toBe(0o600);
    }
    const out = io.out_.join('\n');
    expect(out).toContain(`Paired with studio (${ENV}) with scopes read:state, operate.`);
    expect(out).toContain('npx -y @overdeck/core@0.74.0 mcp connector serve');
    expect(out).toContain(join(home, 'local-token'));
    expect(out).not.toMatch(/od[kl]_/);
    expect(d.rtcStop).toHaveBeenCalled();
  });

  it('keeps an existing valid local token', async () => {
    await signIn();
    const existing = `odl_${'e'.repeat(64)}`;
    await writeFile(join(home, 'local-token'), existing, { mode: 0o600 });
    expect(await run(deps(), recordingIo())).toBe(0);
    expect(await readFile(join(home, 'local-token'), 'utf8')).toBe(existing);
  });

  it('refuses a machine whose proven key differs from the string', async () => {
    await signIn();
    const before = await ensureIdentity(home);
    const io = recordingIo();
    expect(await run(deps({ open: async () => fakeChannel('ef'.repeat(32)) }), io)).toBe(1);
    expect(io.err_.join('\n')).toContain('does not match the pairing string');
    expect(received).toEqual([]);
    expect(await readPairing(home)).toBeNull();
    expect((await readIdentity(home))?.linkPublicKey).toBe(before.linkPublicKey);
  });

  it('refuses a descriptor without a machine key', async () => {
    await signIn();
    const before = await ensureIdentity(home);
    answer.body = { ...(answer.body as object), descriptor: { label: 'studio' } };
    const io = recordingIo();
    expect(await run(deps(), io)).toBe(1);
    expect(io.err_.join('\n')).toContain('does not match the pairing string');
    expect(await readPairing(home)).toBeNull();
    expect((await readIdentity(home))?.linkPublicKey).toBe(before.linkPublicKey);
  });

  it('explains a code that was not issued for a connector', async () => {
    await signIn();
    answer = { status: 403, body: { error: 'nope', code: 'not-a-connector-code' } };
    const io = recordingIo();
    expect(await run(deps(), io)).toBe(1);
    expect(io.err_.join('\n')).toContain('not issued for a connector');
    expect(await readPairing(home)).toBeNull();
  });

  it('retries on the relay when the direct dial fails and the relay is allowed', async () => {
    await signIn();
    const d = deps({
      open: async (url) => {
        if (url.startsWith('rtc://')) throw new ChannelOpenError('unreachable', 'ICE failed');
        return fakeChannel();
      },
    });
    expect(await run(d, recordingIo())).toBe(0);
    expect(d.urls).toEqual([`rtc://${ENV}`, `rtc+turn://${ENV}`]);
  });

  it('prints the no-direct-path sentence when the relay is refused', async () => {
    await signIn();
    const io = recordingIo();
    const d = deps({
      relayRefusal: 'The relay needs the relay plan',
      open: async () => {
        throw new ChannelOpenError('unreachable', 'ICE failed');
      },
    });
    expect(await run(d, io)).toBe(1);
    expect(d.urls).toEqual([`rtc://${ENV}`]);
    expect(io.err_).toEqual(['No direct path to studio. Use the relay plan, or the Tailscale route in the README.']);
  });

  it('refuses a machine outside the signed-in account', async () => {
    await signIn();
    const io = recordingIo();
    expect(await run(deps({ machines: [] }), io)).toBe(1);
    expect(io.err_.join('\n')).toContain('does not include machine');
  });
});
