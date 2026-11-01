/**
 * The connect service on real workerd (PRD PAN-2356 WI-3).
 *
 * Bundles the Worker with wrangler's `--dry-run` deploy (no credentials, no upload) and runs it in
 * Miniflare beside an inline account stub that exports `AccountRpc`, bound by named entrypoint
 * exactly as production binds the account Worker. Copies the share service's recipe.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../../../..');
const SERVICE_DIR = join(ROOT, 'services/connect');

// miniflare and wrangler are devDependencies of the services/connect workspace, not of the root.
const serviceRequire = createRequire(join(SERVICE_DIR, 'package.json'));
type MiniflareModule = typeof import('../../../../services/connect/node_modules/miniflare');
const { Miniflare } = serviceRequire('miniflare') as MiniflareModule;
type Miniflare = InstanceType<MiniflareModule['Miniflare']>;

const BASE = 'https://connect.test';
const SLOW = 60_000;

/** Device tokens: `odd_` + 64 hex. Free-plan devices 1-9 share one account; 'e…' is a tester account. */
const freeToken = (n: number) => 'odd_' + n.toString(16).padStart(64, 'f');
const TESTER_TOKEN = 'odd_' + 'e'.repeat(64);

const ACCOUNT_STUB = `
import { WorkerEntrypoint } from 'cloudflare:workers';
export class AccountRpc extends WorkerEntrypoint {
  async verifyDevice(token) {
    if (token === ${JSON.stringify(TESTER_TOKEN)}) {
      return { ok: true, userId: 'u-tester', githubId: 2, deviceId: 'd-tester', entitlement: { plan: 'tester', maxDevices: null } };
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
  mf = new Miniflare({
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
          },
          exports: { AccountDirectory: { type: 'durable-object', storage: 'sqlite' } },
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

const isType = (type: string) => (f: Frame) => f['type'] === type;
const envId = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const hello = (n: number, label = `machine-${n}`): Frame => ({
  type: 'hello',
  protocol: 1,
  environmentId: envId(n),
  label,
  publicKeyHex: n.toString(16).padStart(2, '0').repeat(32),
  serverVersion: '0.72.0',
  linkProtocol: 1,
  endpoints: [],
});

/** Registers machine `n` on a fresh socket and waits for its welcome. */
async function register(token: string, n: number, label?: string): Promise<Peer> {
  const peer = await openSocket(token);
  peer.send(hello(n, label));
  await peer.waitFor(isType('welcome'));
  return peer;
}

describe('connect service on real workerd (PAN-2356 WI-3)', () => {
  it('GET /healthz reports configured: true and turn: false without TURN secrets', async () => {
    const res = await req('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, configured: true, turn: false });
  }, SLOW);

  it('answers 401 to a directory socket the account service rejects', async () => {
    const res = await req('/v1/directory', { headers: { Upgrade: 'websocket', Authorization: `Bearer odd_${'b'.repeat(64)}` } });
    expect(res.status).toBe(401);
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
