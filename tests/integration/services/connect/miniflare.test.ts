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

const ACCOUNT_STUB = `
import { WorkerEntrypoint } from 'cloudflare:workers';
export class AccountRpc extends WorkerEntrypoint {
  async verifyDevice(token) {
    return { ok: false, error: 'invalid_token' };
  }
}
export default { fetch() { return new Response('account stub'); } };
`;

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
});
