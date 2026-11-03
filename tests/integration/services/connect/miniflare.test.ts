/**
 * The connect service on real workerd (PRD PAN-2356 WI-3).
 *
 * Bundles the Worker with wrangler's `--dry-run` deploy (no credentials, no upload) and runs it in
 * Miniflare beside an inline account stub that exports `AccountRpc`, bound by named entrypoint
 * exactly as production binds the account Worker. Copies the share service's recipe.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLIENT_LIMIT_MESSAGE } from '../../../../packages/contracts/src/connect.ts';
import { openSealed } from '../../../../src/lib/anywhere/sealed-box.ts';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../../../..');
const SERVICE_DIR = join(ROOT, 'services/connect');

// miniflare and wrangler are devDependencies of the services/connect workspace, not of the root.
const serviceRequire = createRequire(join(SERVICE_DIR, 'package.json'));
type MiniflareModule = typeof import('../../../../services/connect/node_modules/miniflare');
const { Miniflare } = serviceRequire('miniflare') as MiniflareModule;
type Miniflare = InstanceType<MiniflareModule['Miniflare']>;

const BASE = 'https://connect.test';

interface Sodium {
  crypto_box_seed_keypair(pk: Buffer, sk: Buffer, seed: Buffer): void;
}
const sodium = createRequire(import.meta.url)('sodium-native') as Sodium;
const SLOW = 60_000;

/** Device tokens: `odd_` + 64 hex. Free-plan devices 1-9 share one account; 'e…' is a tester account. */
const freeToken = (n: number) => 'odd_' + n.toString(16).padStart(64, 'f');
const TESTER_TOKEN = 'odd_' + 'e'.repeat(64);
const TESTER_TOKEN_2 = 'odd_' + 'e'.repeat(63) + 'd';
/** Phone tests (PAN-4829) use their own free account, 'u-phones', so earlier tests' machines do not matter. */
const phoneToken = (n: number) => 'odd_' + n.toString(16).padStart(64, '7');
/** Push tests (PAN-4830) use their own free account, 'u-push', so the 'u-phones' 5-phone cap is untouched. */
const pushToken = (n: number) => 'odd_' + n.toString(16).padStart(64, '6');
/** A second tester account whose relay allowance the cap test spends. */
const RELAY_TOKEN = 'odd_' + 'c'.repeat(64);
/** A tester account whose Directory DO the account-view test reads through the DO stub (PAN-4959). */
const VIEW_TOKEN = 'odd_' + 'a'.repeat(64);
/** A free account the remove-machine test fills and frees (PAN-4959), so 'u-free' stays full. */
const removeToken = (n: number) => 'odd_' + n.toString(16).padStart(64, '9');

const ACCOUNT_STUB = `
import { WorkerEntrypoint } from 'cloudflare:workers';
export class AccountRpc extends WorkerEntrypoint {
  async verifyDevice(token) {
    if (token === ${JSON.stringify(TESTER_TOKEN)} || token === ${JSON.stringify(TESTER_TOKEN_2)}) {
      return { ok: true, userId: 'u-tester', githubId: 2, deviceId: 'd-tester', entitlement: { plan: 'tester', maxDevices: null } };
    }
    if (token === ${JSON.stringify(RELAY_TOKEN)}) {
      return { ok: true, userId: 'u-relay', githubId: 3, deviceId: 'd-relay', entitlement: { plan: 'tester', maxDevices: null } };
    }
    if (token === ${JSON.stringify(VIEW_TOKEN)}) {
      return { ok: true, userId: 'u-view', githubId: 6, deviceId: 'd-view', entitlement: { plan: 'tester', maxDevices: null } };
    }
    if (/^odd_9+[0-9a-f]$/.test(token)) {
      return { ok: true, userId: 'u-remove', githubId: 7, deviceId: 'd-r' + token.slice(-1), entitlement: { plan: 'free', maxDevices: 3 } };
    }
    if (/^odd_6+[0-9a-f]$/.test(token)) {
      return { ok: true, userId: 'u-push', githubId: 5, deviceId: 'd-u' + token.slice(-1), entitlement: { plan: 'free', maxDevices: 3 } };
    }
    if (/^odd_7+[0-9a-f]$/.test(token)) {
      return { ok: true, userId: 'u-phones', githubId: 4, deviceId: 'd-p' + token.slice(-1), entitlement: { plan: 'free', maxDevices: 3 } };
    }
    if (/^odd_f+[0-9a-f]$/.test(token)) {
      return { ok: true, userId: 'u-free', githubId: 1, deviceId: 'd-' + token.slice(-1), entitlement: { plan: 'free', maxDevices: 3 } };
    }
    return { ok: false, error: 'invalid_token' };
  }
}
export default { fetch() { return new Response('account stub'); } };
`;

/** Every line the Worker logged, from workerd's structured log stream. */
const logs: string[] = [];

const TURN_KEY_ID = 'turn-key-test';
const STUB_ICE_SERVERS = [{ urls: ['turns:turn.cloudflare.com:443?transport=tcp'], username: 'stub-user', credential: 'stub-cred' }];
/** Bodies of requests that reached the stubbed Cloudflare TURN credential API. */
const turnBodies: string[] = [];
const unexpectedOutbound: string[] = [];
/** Requests that reached the stubbed APNs, Google OAuth and FCM endpoints (PAN-4830). */
const pushRequests: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
const FCM_SEND_URL = 'https://fcm.googleapis.com/v1/projects/overdeck-test/messages:send';
const FCM_ACCESS_TOKEN = 'ya29.test';
/** APNs answers 410 Unregistered for a device token starting with this. */
const DEAD_TOKEN_PREFIX = 'dead';
/** The APNs key's public half, generated per run, to verify the provider token. */
let apnsPublicKey: CryptoKey;

function pkcs8Pem(der: ArrayBuffer): string {
  const lines = Buffer.from(der).toString('base64').match(/.{1,64}/g) ?? [];
  return ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----'].join('\n');
}

/** Stubs APNs, the Google token endpoint and FCM; null for any other URL. */
async function pushProvider(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const apns = (url.host === 'api.push.apple.com' || url.host === 'api.sandbox.push.apple.com') && url.pathname.startsWith('/3/device/');
  if (request.method !== 'POST' || !(apns || url.href === 'https://oauth2.googleapis.com/token' || url.href === FCM_SEND_URL)) return null;
  pushRequests.push({ url: url.href, headers: Object.fromEntries(request.headers), body: await request.text() });
  if (apns) {
    return url.pathname.startsWith(`/3/device/${DEAD_TOKEN_PREFIX}`)
      ? Response.json({ reason: 'Unregistered' }, { status: 410 })
      : new Response(null, { status: 200 });
  }
  if (url.href === FCM_SEND_URL) return Response.json({ name: 'projects/overdeck-test/messages/1' });
  return Response.json({ access_token: FCM_ACCESS_TOKEN, expires_in: 3600 });
}

/** The relay allowance in this test (RELAY_CAP_BYTES), so the cap is reachable in a few reports. */
const RELAY_CAP = 1_000;

let tmp = '';
let mf: Miniflare;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'overdeck-connect-mf-'));
  const wrangler = join(SERVICE_DIR, 'node_modules/wrangler/bin/wrangler.js');
  await execFileAsync(wrangler, ['deploy', '--dry-run', '--outdir', tmp], {
    cwd: SERVICE_DIR,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
  const bundle = await readFile(join(tmp, 'index.js'), 'utf8');
  // Generated per run, never committed (PAN-4830 NFR-7).
  const ec = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const rsa = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign'],
  );
  apnsPublicKey = ec.publicKey;
  const apnsKeyP8 = pkcs8Pem(await crypto.subtle.exportKey('pkcs8', ec.privateKey));
  const fcmAccount = JSON.stringify({
    client_email: 'push@test.iam.gserviceaccount.com',
    private_key: pkcs8Pem(await crypto.subtle.exportKey('pkcs8', rsa.privateKey)),
  });
  mf = new Miniflare({
    // On disk, so the inbox test can scan every byte the Durable Object stored.
    resourcePersistencePath: join(tmp, 'state'),
    handleStructuredLogs: (log) => logs.push(log.message),
    workers: [
      {
        config: {
          name: 'overdeck-connect',
          compatibilityDate: '2026-09-01',
          manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: bundle } } },
          env: {
            DIRECTORY: { type: 'durable-object', worker: 'overdeck-connect', exportName: 'AccountDirectory' },
            ACCOUNT: { type: 'worker', worker: 'account-stub', exportName: 'AccountRpc' },
            PUBLIC_BASE_URL: { type: 'text', value: BASE },
            STUN_URLS: { type: 'text', value: 'stun:stun.cloudflare.com:3478' },
            TURN_KEY_ID: { type: 'text', value: TURN_KEY_ID },
            TURN_KEY_API_TOKEN: { type: 'text', value: 'turn-api-token-test' }, // a Worker secret in production
            RELAY_CAP_BYTES: { type: 'text', value: String(RELAY_CAP) },
            // Worker secrets in production (PAN-4830).
            APNS_KEY_P8: { type: 'text', value: apnsKeyP8 },
            APNS_KEY_ID: { type: 'text', value: 'KEYID12345' },
            APNS_TEAM_ID: { type: 'text', value: 'TEAMID1234' },
            FCM_SERVICE_ACCOUNT_JSON: { type: 'text', value: fcmAccount },
            FCM_PROJECT_ID: { type: 'text', value: 'overdeck-test' },
          },
          exports: { AccountDirectory: { type: 'durable-object', storage: 'sqlite' } },
        },
        dev: {
          outboundService: {
            type: 'fetcher',
            handler: async (request: Request) => {
              const url = new URL(request.url);
              if (
                request.method === 'POST' &&
                url.href === `https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_KEY_ID}/credentials/generate-ice-servers`
              ) {
                turnBodies.push(await request.text());
                return new Response(JSON.stringify({ iceServers: STUB_ICE_SERVERS }), { status: 201, headers: { 'Content-Type': 'application/json' } });
              }
              const pushAnswer = await pushProvider(request);
              if (pushAnswer) return pushAnswer;
              unexpectedOutbound.push(`${request.method} ${request.url}`);
              return new Response('unexpected outbound request', { status: 599 });
            },
          },
        },
      },
      {
        config: {
          name: 'account-stub',
          compatibilityDate: '2026-09-01',
          manifest: { mainModule: 'stub.js', modules: { 'stub.js': { type: 'esm', contents: ACCOUNT_STUB } } },
        },
      },
    ],
  });
  await mf.ready;
}, 180_000);

afterAll(async () => {
  await mf?.dispose();
  if (tmp) await rm(tmp, { recursive: true, force: true });
}, 60_000);

function req(path: string, init: RequestInit = {}): Promise<Response> {
  return mf.dispatchFetch(`${BASE}${path}`, init as never) as unknown as Promise<Response>;
}

type Frame = Record<string, unknown>;

/** One client socket: records every frame and the close, and resolves waits on events only. */
class Peer {
  readonly frames: Frame[] = [];
  closed: { code: number; reason: string } | null = null;
  private wake: Array<() => void> = [];

  constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      this.frames.push(JSON.parse(String(event.data)) as Frame);
      this.notify();
    });
    ws.addEventListener('close', (event) => {
      this.closed = { code: event.code, reason: event.reason };
      this.notify();
    });
    ws.accept();
  }

  private notify(): void {
    const waiting = this.wake;
    this.wake = [];
    for (const resolve of waiting) resolve();
  }

  private async until(done: () => boolean): Promise<void> {
    while (!done()) await new Promise<void>((resolve) => this.wake.push(resolve));
  }

  send(frame: Frame): void {
    this.ws.send(JSON.stringify(frame));
  }

  close(): void {
    this.ws.close(1000, 'done');
  }

  /** Waits for the first frame from index `from` matching `match`, and returns it. */
  async waitFor(match: (frame: Frame) => boolean, from = 0): Promise<Frame> {
    let found: Frame | undefined;
    await this.until(() => {
      found = this.frames.slice(from).find(match);
      return found !== undefined || this.closed !== null;
    });
    if (!found) throw new Error(`socket closed (${JSON.stringify(this.closed)}) before a matching frame; got ${JSON.stringify(this.frames)}`);
    return found;
  }

  async waitClose(): Promise<{ code: number; reason: string }> {
    await this.until(() => this.closed !== null);
    return this.closed as { code: number; reason: string };
  }
}

async function openSocket(token: string): Promise<Peer> {
  const res = (await req('/v1/directory', { headers: { Upgrade: 'websocket', Authorization: `Bearer ${token}` } })) as Response & {
    webSocket: WebSocket | null;
  };
  expect(res.status).toBe(101);
  return new Peer(res.webSocket as WebSocket);
}

/** A phone's socket (PAN-4829): the token rides the bearer subprotocol, which the 101 must echo. */
async function openClientSocket(token: string): Promise<Peer> {
  const protocol = `overdeck.bearer.${token}`;
  const res = (await req('/v1/directory', { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': protocol } })) as Response & {
    webSocket: WebSocket | null;
  };
  expect(res.status).toBe(101);
  expect(res.headers.get('Sec-WebSocket-Protocol')).toBe(protocol);
  return new Peer(res.webSocket as WebSocket);
}

const isType = (type: string) => (f: Frame) => f['type'] === type;
const envId = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const hello = (n: number, label = `machine-${n}`, publicKeyHex = n.toString(16).padStart(2, '0').repeat(32)): Frame => ({
  type: 'hello',
  protocol: 1,
  environmentId: envId(n),
  label,
  publicKeyHex,
  serverVersion: '0.72.0',
  linkProtocol: 1,
  endpoints: [],
});

/** Registers machine `n` on a fresh socket and waits for its welcome. */
async function register(token: string, n: number, label?: string, publicKeyHex?: string): Promise<Peer> {
  const peer = await openSocket(token);
  peer.send(hello(n, label, publicKeyHex));
  await peer.waitFor(isType('welcome'));
  return peer;
}

describe('connect service on real workerd (PAN-2356 WI-3)', () => {
  it('GET /healthz reports configured, turn, apns and fcm all true', async () => {
    const res = await req('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, configured: true, turn: true, apns: true, fcm: true });
  }, SLOW);

  it('answers 401 to a directory socket the account service rejects', async () => {
    const res = await req('/v1/directory', { headers: { Upgrade: 'websocket', Authorization: `Bearer odd_${'b'.repeat(64)}` } });
    expect(res.status).toBe(401);
  }, SLOW);

  it('echoes the bearer subprotocol on the 101 and leaves header-auth machines without one (PAN-4829 WI-1)', async () => {
    const phone = await openClientSocket(TESTER_TOKEN);
    phone.close();

    const res = (await req('/v1/directory', { headers: { Upgrade: 'websocket', Authorization: `Bearer ${TESTER_TOKEN}` } })) as Response & {
      webSocket: WebSocket | null;
    };
    expect(res.status).toBe(101);
    expect(res.headers.get('Sec-WebSocket-Protocol')).toBeNull();
    new Peer(res.webSocket as WebSocket).close();
  }, SLOW);

  it('refuses a fourth free-plan machine with the exact message and close 4009 (WI-5)', async () => {
    const peers = [await register(freeToken(1), 1), await register(freeToken(2), 2), await register(freeToken(3), 3)];
    const welcome = peers[2]?.frames.find(isType('welcome')) as { plan: string; maxMachines: number; machines: Array<{ online: boolean }> };
    expect(welcome.plan).toBe('free');
    expect(welcome.maxMachines).toBe(3);
    expect(welcome.machines.filter((m) => m.online)).toHaveLength(3);

    const fourth = await openSocket(freeToken(4));
    fourth.send(hello(4));
    const error = await fourth.waitFor(isType('error'));
    expect(error).toEqual({ type: 'error', code: 'machine_limit', message: 'The free account includes 3 machines' });
    expect((await fourth.waitClose()).code).toBe(4009);

    // A second socket for machine 1 replaces the first with 4011.
    const replacement = await register(freeToken(1), 1);
    expect((await peers[0]!.waitClose()).code).toBe(4011);

    // forget frees a slot: the forgotten machine is closed with 4012 and the fourth machine fits.
    const before = peers[1]!.frames.length;
    replacement.send({ type: 'forget', environmentId: envId(3) });
    expect((await peers[2]!.waitClose()).code).toBe(4012);
    const directory = (await peers[1]!.waitFor(isType('directory'), before)) as { machines: Array<{ environmentId: string }> };
    expect(directory.machines.map((m) => m.environmentId)).toEqual([envId(1), envId(2)]);
    const late = await register(freeToken(4), 4);
    late.close();
    replacement.close();
    peers[1]!.close();
  }, SLOW);

  it('stamps from with the sender even when the frame claims another (WI-6)', async () => {
    const a = await register(TESTER_TOKEN, 11);
    const b = await register(TESTER_TOKEN_2, 12);
    const session = 'ab'.repeat(16);
    const data = { sdp: { type: 'offer', sdp: 'v=0' } };
    a.send({ type: 'signal', to: envId(12), from: envId(99), session, purpose: 'link', relay: false, data });
    const got = await b.waitFor(isType('signal'));
    expect(got).toEqual({ type: 'signal', from: envId(11), session, purpose: 'link', relay: false, data });

    b.close();
    await a.waitFor((f) => f['type'] === 'directory' && (f['machines'] as Array<{ environmentId: string; online: boolean }>).some((m) => m.environmentId === envId(12) && !m.online));
    const before = a.frames.length;
    a.send({ type: 'signal', to: envId(12), session, purpose: 'link', relay: false, data });
    const error = await a.waitFor(isType('error'), before);
    expect(error).toMatchObject({ code: 'peer_offline', session });

    a.send({ type: 'ice-servers', requestId: 'stun-1', relay: false });
    expect(await a.waitFor(isType('ice-servers'))).toEqual({
      type: 'ice-servers',
      requestId: 'stun-1',
      iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }],
    });
    a.close();
  }, SLOW);

  it('mints relay credentials for a tester, refuses a free plan, and stops the relay at the cap (WI-7)', async () => {
    const free = await register(freeToken(1), 1); // already registered: the free account is full
    free.send({ type: 'ice-servers', requestId: 'r-free', relay: true });
    expect(await free.waitFor(isType('error'))).toMatchObject({ code: 'relay_not_allowed', requestId: 'r-free' });
    free.close();

    const a = await register(RELAY_TOKEN, 21);
    const b = await register(RELAY_TOKEN, 22);
    expect(a.frames.find(isType('welcome'))).toMatchObject({ relayAllowed: true, relay: { bytesUsed: 0, capBytes: RELAY_CAP, stopped: false } });
    a.send({ type: 'ice-servers', requestId: 'r-1', relay: true });
    expect(await a.waitFor(isType('ice-servers'))).toEqual({ type: 'ice-servers', requestId: 'r-1', iceServers: STUB_ICE_SERVERS });
    expect(JSON.parse(turnBodies.at(-1) ?? '{}')).toEqual({ ttl: 600 });

    a.send({ type: 'relay-usage', bytes: 600 });
    a.send({ type: 'relay-usage', bytes: 500 });
    // Each report refreshes every machine's month total; the one that crosses the cap stops the relay.
    expect(await b.waitFor(isType('relay-status'))).toMatchObject({ bytesUsed: 600, capBytes: RELAY_CAP, stopped: false });
    const isStopped = (f: Frame) => f['type'] === 'relay-status' && f['stopped'] === true;
    const stopped = await b.waitFor(isStopped);
    expect(stopped).toMatchObject({ bytesUsed: 1_100, capBytes: RELAY_CAP, stopped: true });
    await a.waitFor(isStopped);
    const before = a.frames.length;
    a.send({ type: 'ice-servers', requestId: 'r-2', relay: true });
    expect(await a.waitFor(isType('error'), before)).toMatchObject({
      code: 'relay_cap_reached',
      message: 'Relay allowance used; install Tailscale or add 50 GB',
      requestId: 'r-2',
    });
    expect(unexpectedOutbound).toEqual([]);
    a.close();
    b.close();
  }, SLOW);

  it('answers GET /account-view on the account DO stub with both machines online (PAN-4959 WI-1)', async () => {
    const a = await register(VIEW_TOKEN, 31);
    const b = await register(VIEW_TOKEN, 32);
    const ns = await mf.getDurableObjectNamespace('DIRECTORY');
    const res = await ns.get(ns.idFromName('u-view')).fetch('https://directory/account-view');
    expect(res.status).toBe(200);
    const view = (await res.json()) as { machines: Frame[]; relay: Frame };
    expect(view.machines).toEqual([
      expect.objectContaining({ environmentId: envId(31), label: 'machine-31', online: true, serverVersion: '0.72.0', deviceId: 'd-view' }),
      expect.objectContaining({ environmentId: envId(32), label: 'machine-32', online: true, serverVersion: '0.72.0', deviceId: 'd-view' }),
    ]);
    for (const m of view.machines) expect(new Date(String(m['lastSeenAt'])).toISOString()).toBe(m['lastSeenAt']);
    expect(view.relay).toMatchObject({ bytesUsed: 0, capBytes: RELAY_CAP, stopped: false });
    a.close();
    b.close();
  }, SLOW);

  it('removes a machine on POST /remove-machine with no calling socket and frees its free-plan slot (PAN-4959 WI-2)', async () => {
    const ns = await mf.getDurableObjectNamespace('DIRECTORY');
    const stub = ns.get(ns.idFromName('u-remove'));
    const remove = (body: string) => stub.fetch('https://directory/remove-machine', { method: 'POST', body });
    const a = await register(removeToken(1), 41);
    const b = await register(removeToken(2), 42);
    const c = await register(removeToken(3), 43);

    expect((await remove('{}')).status).toBe(400);
    expect(await (await remove(JSON.stringify({ environmentId: 7 }))).json()).toEqual({ error: 'bad_request' });
    const unknown = await remove(JSON.stringify({ environmentId: envId(49) }));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'unknown_machine' });

    const from = b.frames.length;
    const removed = await remove(JSON.stringify({ environmentId: envId(41) }));
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ removed: true });
    expect(await a.waitClose()).toMatchObject({ code: 4012 });
    const directory = await b.waitFor(isType('directory'), from);
    expect((directory['machines'] as Frame[]).map((m) => m['environmentId'])).toEqual([envId(42), envId(43)]);

    const d = await register(removeToken(4), 44);
    expect(d.frames.find(isType('welcome'))).toMatchObject({ plan: 'free', maxMachines: 3 });
    b.close();
    c.close();
    d.close();
  }, SLOW);

  it('holds an event sealed while the machine is offline and delivers it on reconnect (WI-8)', async () => {
    const keys = { publicKey: Buffer.alloc(32), secretKey: Buffer.alloc(32) };
    sodium.crypto_box_seed_keypair(keys.publicKey, keys.secretKey, Buffer.alloc(32, 42));
    const keyHex = keys.publicKey.toString('hex');

    const machine = await register(TESTER_TOKEN, 31, 'inbox-machine', keyHex);
    machine.send({ type: 'inbox-create', requestId: 'ib-1' });
    const created = (await machine.waitFor(isType('inbox-created'))) as { inboxId: string; url: string };
    expect(created.url).toMatch(new RegExp(`^${BASE}/h/[0-9a-f]{64}\\.[0-9a-f]{32}$`));
    machine.close();
    await machine.waitClose();

    const marker = 'PLAINTEXT-MARKER-2356';
    const body = JSON.stringify({ action: 'opened', marker });
    const res = await mf.dispatchFetch(created.url, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'issues' },
    } as never);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ queued: true });

    // Every file the Durable Object wrote, read as raw bytes: the marker must not be in any of them.
    const files = (await readdir(join(tmp, 'state'), { recursive: true, withFileTypes: true })).filter((d) => d.isFile());
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const bytes = await readFile(join(file.parentPath, file.name));
      expect(bytes.includes(Buffer.from(marker)), file.name).toBe(false);
    }

    const back = await openSocket(TESTER_TOKEN);
    back.send(hello(31, 'inbox-machine', keyHex));
    const event = (await back.waitFor(isType('inbox-event'))) as { eventId: string; inboxId: string; sealed: string };
    expect(event.inboxId).toBe(created.inboxId);
    const opened = openSealed(Buffer.from(event.sealed, 'base64'), keys);
    const plain = JSON.parse(opened!.toString('utf8')) as { eventId: string; headers: Record<string, string>; body: string };
    expect(plain.eventId).toBe(event.eventId);
    expect(plain.headers['x-github-event']).toBe('issues');
    expect(Buffer.from(plain.body, 'base64').toString('utf8')).toBe(body);

    back.send({ type: 'inbox-ack', eventId: event.eventId });
    const wrong = await mf.dispatchFetch(created.url.replace(/\.[0-9a-f]{32}$/, '.' + '0'.repeat(32)), { method: 'POST', body: 'x' } as never);
    expect(wrong.status).toBe(404);
    back.close();
  }, SLOW);

  it('logs only frame types, ids and outcomes, never the label (WI-5)', async () => {
    const marker = 'LABEL-MARKER-2356';
    const from = logs.length;
    const peer = await register(TESTER_TOKEN, 9, marker);
    const mine = logs.slice(from).filter((line) => line.includes('"frame"'));
    expect(mine.some((line) => line.includes('"hello"') && line.includes(envId(9)))).toBe(true);
    expect(logs.join('\n')).not.toContain(marker);
    peer.close();
  }, SLOW);
});

const PHONE_LABEL_MARKER = 'PHONE-LABEL-MARKER-4829';
const clientId = (n: number) => `00000000-0000-4000-9000-${n.toString(16).padStart(12, '0')}`;
const helloClient = (n: number): Frame => ({
  type: 'hello-client',
  protocol: 1,
  clientId: clientId(n),
  label: `${PHONE_LABEL_MARKER} phone-${n}`,
  publicKeyHex: (0xa0 + n).toString(16).repeat(32),
  appVersion: '1.0.0',
  platform: 'ios',
});

/** Registers phone `n` on a fresh bearer-subprotocol socket and waits for its welcome-client. */
async function registerPhone(token: string, n: number): Promise<{ peer: Peer; welcome: Frame }> {
  const peer = await openClientSocket(token);
  peer.send(helloClient(n));
  const welcome = await peer.waitFor(isType('welcome-client'));
  return { peer, welcome };
}

/**
 * Epic AC-2 (PAN-4823) on workerd. The tests run in order and share the 'u-phones' account: three
 * machines stay online for the whole block, and phone rows persist between tests as they would in
 * production. Every phone socket is closed at the end of its test.
 */
describe('phone clients on real workerd (PAN-4829)', () => {
  const MACHINES = [41, 42, 43];
  let machines: Peer[] = [];
  const SESSION = '5'.repeat(32);

  beforeAll(async () => {
    machines = [];
    for (const [i, n] of MACHINES.entries()) machines.push(await register(phoneToken(i + 1), n));
  }, SLOW);

  afterAll(() => {
    for (const peer of machines) peer.close();
  });

  it('registers a phone beside 3 free machines without using a machine slot', async () => {
    const { peer: phone, welcome } = await registerPhone(phoneToken(4), 1);
    expect(welcome).toMatchObject({ type: 'welcome-client', protocol: 1, plan: 'free', relayAllowed: false });
    const listed = welcome['machines'] as Array<{ environmentId: string; online: boolean }>;
    expect(listed.map((m) => [m.environmentId, m.online])).toEqual(MACHINES.map((n) => [envId(n), true]));

    const fourth = await openSocket(phoneToken(5));
    fourth.send(hello(44));
    expect((await fourth.waitClose()).code).toBe(4009);
    phone.close();
  }, SLOW);

  it('caps an account at 5 phones with client_limit and 4013, and replaces a phone socket with 4011', async () => {
    const phones: Peer[] = [];
    for (let n = 2; n <= 5; n++) phones.push((await registerPhone(phoneToken(n + 3), n)).peer);

    const sixth = await openClientSocket(phoneToken(9));
    sixth.send(helloClient(6));
    expect(await sixth.waitFor(isType('error'))).toEqual({ type: 'error', code: 'client_limit', message: CLIENT_LIMIT_MESSAGE });
    expect((await sixth.waitClose()).code).toBe(4013);

    const first = (await registerPhone(phoneToken(4), 1)).peer;
    const second = (await registerPhone(phoneToken(4), 1)).peer;
    expect((await first.waitClose()).code).toBe(4011);

    second.close();
    for (const peer of phones) peer.close();
  }, SLOW);

  it('sends machine changes to phones and never lists a phone to machines', async () => {
    const phone1 = (await registerPhone(phoneToken(4), 1)).peer;
    const phone2 = (await registerPhone(phoneToken(5), 2)).peer;
    const marks = machines.map((m) => m.frames.length);
    const phoneMarks = [phone1.frames.length, phone2.frames.length];

    machines[0]?.send({ type: 'endpoints', endpoints: [{ kind: 'lan', url: 'tcp://10.0.0.41:3011' }] });
    const isChange = (f: Frame) => f['type'] === 'directory' && JSON.stringify(f).includes('10.0.0.41');
    const seenByMachine = await machines[1]?.waitFor(isChange, marks[1]);
    await machines[2]?.waitFor(isChange, marks[2]);
    expect(await phone1.waitFor(isChange, phoneMarks[0])).toEqual(seenByMachine);
    expect(await phone2.waitFor(isChange, phoneMarks[1])).toEqual(seenByMachine);

    const machineViews = machines.flatMap((m) => m.frames.filter((f) => f['type'] === 'welcome' || f['type'] === 'directory'));
    expect(machineViews.length).toBeGreaterThan(0);
    const text = JSON.stringify(machineViews);
    for (let n = 1; n <= 6; n++) expect(text).not.toContain(clientId(n));

    phone1.close();
    phone2.close();
  }, SLOW);

  it('routes link signals both ways with the sender stamped, and refuses phone to phone', async () => {
    const phone = (await registerPhone(phoneToken(4), 1)).peer;
    const machine = machines[0] as Peer;
    const offer = { sdp: { type: 'offer', sdp: 'v=0 offer' } };
    const answer = { sdp: { type: 'answer', sdp: 'v=0 answer' } };

    const mark = machine.frames.length;
    phone.send({ type: 'signal', to: envId(41), session: SESSION, purpose: 'link', relay: false, data: offer });
    expect(await machine.waitFor(isType('signal'), mark)).toEqual({
      type: 'signal', from: clientId(1), session: SESSION, purpose: 'link', relay: false, data: offer,
    });

    const phoneMark = phone.frames.length;
    machine.send({ type: 'signal', to: clientId(1), session: SESSION, purpose: 'link', relay: false, data: answer });
    expect(await phone.waitFor(isType('signal'), phoneMark)).toEqual({
      type: 'signal', from: envId(41), session: SESSION, purpose: 'link', relay: false, data: answer,
    });

    const errorMark = phone.frames.length;
    phone.send({ type: 'signal', to: clientId(2), session: SESSION, purpose: 'link', relay: false, data: offer });
    expect(await phone.waitFor(isType('error'), errorMark)).toMatchObject({ code: 'bad_frame', session: SESSION });
    phone.close();
  }, SLOW);

  it('forgets a phone with 4012 and frees its slot', async () => {
    const phone = (await registerPhone(phoneToken(5), 2)).peer;
    phone.send({ type: 'forget-client' });
    expect((await phone.waitClose()).code).toBe(4012);

    const replacement = (await registerPhone(phoneToken(9), 7)).peer;
    replacement.close();
  }, SLOW);

  it('never logs a phone label and logs hello-client with the client id', () => {
    expect(logs.join('\n')).not.toContain(PHONE_LABEL_MARKER);
    expect(logs.some((line) => line.includes('"hello-client"') && line.includes(clientId(1)))).toBe(true);
  });
});

/**
 * Epic AC-3 (PAN-4823) on workerd. One machine on the 'u-push' account pushes to three phones that
 * registered and then closed their app: iOS (sandbox), Android, and an iOS phone whose token APNs
 * reports dead. Every case waits for the push-result with its own requestId.
 */
describe('sealed push on real workerd (PAN-4830)', () => {
  const IOS = 11;
  const ANDROID = 12;
  const DEAD = 13;
  const IOS_TOKEN = 'a1'.repeat(32);
  const FCM_TOKEN = 'fcm-token:APA91b_push-test';
  const DEAD_TOKEN = DEAD_TOKEN_PREFIX + 'b'.repeat(60);
  const SEALED = Buffer.from('sealed push payload for PAN-4830').toString('base64');
  const COLLAPSE = '9'.repeat(32);
  let machine: Peer;
  let seq = 0;

  /** Registers phone `n` for push on its own socket, then closes it: the app is not running. */
  async function phoneWithPush(token: string, n: number, platform: 'ios' | 'android', register: Frame): Promise<void> {
    const peer = await openClientSocket(token);
    peer.send({ ...helloClient(n), platform });
    await peer.waitFor(isType('welcome-client'));
    peer.send(register);
    // Frames on one socket are handled in order, so this answer means the registration is stored.
    peer.send({ type: 'ice-servers', requestId: `sync-${n}`, relay: false });
    await peer.waitFor((f) => f['type'] === 'ice-servers' && f['requestId'] === `sync-${n}`);
    peer.close();
  }

  /** Sends a push from the machine and returns its push-result. */
  async function push(to: string): Promise<Frame> {
    seq += 1;
    const requestId = seq.toString(16).padStart(32, '0');
    const mark = machine.frames.length;
    machine.send({ type: 'push', requestId, to, sealed: SEALED, urgency: 'high', collapseId: COLLAPSE });
    return machine.waitFor((f) => f['type'] === 'push-result' && f['requestId'] === requestId, mark);
  }

  beforeAll(async () => {
    machine = await register(pushToken(1), 61);
    await phoneWithPush(pushToken(2), IOS, 'ios', { type: 'push-register', platform: 'ios', token: IOS_TOKEN, apsEnvironment: 'sandbox' });
    await phoneWithPush(pushToken(3), ANDROID, 'android', { type: 'push-register', platform: 'android', token: FCM_TOKEN });
    await phoneWithPush(pushToken(4), DEAD, 'ios', { type: 'push-register', platform: 'ios', token: DEAD_TOKEN });
  }, SLOW);

  afterAll(() => {
    machine?.close();
  });

  it('delivers an iOS push to the sandbox host with only the placeholder alert and the sealed blob', async () => {
    const mark = pushRequests.length;
    expect(await push(clientId(IOS))).toMatchObject({ type: 'push-result', ok: true });
    const sent = pushRequests.slice(mark);
    expect(sent.map((r) => r.url)).toEqual([`https://api.sandbox.push.apple.com/3/device/${IOS_TOKEN}`]);
    const [apns] = sent;
    expect(JSON.parse(apns.body)).toEqual({
      aps: { alert: { title: 'Overdeck', body: 'Something needs you' }, 'mutable-content': 1, sound: 'default', 'thread-id': COLLAPSE },
      s: SEALED,
    });
    expect(apns.headers).toMatchObject({ 'apns-push-type': 'alert', 'apns-topic': 'ai.overdeck.app', 'apns-priority': '10', 'apns-collapse-id': COLLAPSE });

    // CP-1: the provider token signed inside workerd verifies with the generated public key.
    const [scheme, jwt] = (apns.headers['authorization'] ?? '').split(' ');
    expect(scheme).toBe('bearer');
    const [header, claims, signature] = jwt.split('.');
    const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(decode(header)).toEqual({ alg: 'ES256', kid: 'KEYID12345' });
    expect(decode(claims)).toMatchObject({ iss: 'TEAMID1234' });
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      apnsPublicKey,
      Buffer.from(signature, 'base64url'),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);
  }, SLOW);

  it('delivers an Android push as a data-only FCM message after one token exchange', async () => {
    const mark = pushRequests.length;
    expect(await push(clientId(ANDROID))).toMatchObject({ type: 'push-result', ok: true });
    const sent = pushRequests.slice(mark);
    expect(sent.map((r) => r.url)).toEqual(['https://oauth2.googleapis.com/token', FCM_SEND_URL]);
    expect(new URLSearchParams(sent[0].body).get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(sent[1].headers['authorization']).toBe(`Bearer ${FCM_ACCESS_TOKEN}`);
    const body = JSON.parse(sent[1].body) as { message: Record<string, unknown> };
    expect(body).toEqual({
      message: { token: FCM_TOKEN, data: { s: SEALED }, android: { priority: 'HIGH', ttl: '3600s', collapse_key: COLLAPSE } },
    });
    expect(body.message).not.toHaveProperty('notification');
  }, SLOW);

  it('clears a token APNs reports dead, then answers no_registration without a request', async () => {
    const mark = pushRequests.length;
    expect(await push(clientId(DEAD))).toEqual({ type: 'push-result', requestId: expect.any(String), ok: false, error: 'no_registration' });
    expect(pushRequests.slice(mark).map((r) => r.url)).toEqual([`https://api.push.apple.com/3/device/${DEAD_TOKEN}`]);

    const again = pushRequests.length;
    expect(await push(clientId(DEAD))).toMatchObject({ ok: false, error: 'no_registration' });
    expect(pushRequests.length).toBe(again);
  }, SLOW);

  it('answers unknown_client for a phone the account does not have', async () => {
    const mark = pushRequests.length;
    expect(await push(clientId(99))).toMatchObject({ ok: false, error: 'unknown_client' });
    expect(pushRequests.length).toBe(mark);
  }, SLOW);

  it('never logs a push token, the sealed payload or a credential, and makes no other outbound request', () => {
    const text = logs.join('\n');
    expect(logs.some((line) => line.includes('"push"') && line.includes('"delivered"'))).toBe(true);
    for (const secret of [IOS_TOKEN, FCM_TOKEN, DEAD_TOKEN, SEALED, FCM_ACCESS_TOKEN, '-----BEGIN']) {
      expect(text).not.toContain(secret);
    }
    expect(unexpectedOutbound).toEqual([]);
  });
});
