/**
 * The bundled share Worker on real workerd, for share integration tests (PRD PAN-4482 WI-1).
 *
 * `startShareWorker` bundles `services/share` with `wrangler deploy --dry-run`, then runs it in
 * Miniflare beside an account stub that accepts `tokenFor(id)` for each configured user. It is the
 * bootstrap `tests/integration/services/share/join-manager.test.ts` repeats, in one place; those older
 * tests keep their own copies. TURN secrets bind with no outbound stub, so the Worker calls Cloudflare.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../../..');
const SERVICE_DIR = join(ROOT, 'services/share');
const BASE = 'https://share.test';

// miniflare and wrangler are devDependencies of the services/share workspace, not of the root.
const serviceRequire = createRequire(join(SERVICE_DIR, 'package.json'));
type MiniflareModule = typeof import('../../../services/share/node_modules/miniflare');
type Miniflare = InstanceType<MiniflareModule['Miniflare']>;

export interface ShareTestUser {
  readonly id: number;
  readonly login: string;
}

/** The device token the account stub maps to `githubId`. */
export const tokenFor = (githubId: number) => 'odd_' + githubId.toString(16).padStart(64, '0');

export interface StartShareWorkerOptions {
  readonly users: readonly ShareTestUser[];
  /** Binds TURN_KEY_ID / TURN_KEY_API_TOKEN as text bindings; no outbound stub, so the Worker calls Cloudflare. */
  readonly turn?: { readonly keyId: string; readonly apiToken: string };
  /** Binds ROOM_CREATE_LIMIT as `{ type: 'rate-limit', namespace, simple: { limit, period } }`. */
  readonly rateLimit?: { readonly namespace: string; readonly limit: number; readonly period: 10 | 60 };
}

export interface ShareWorker {
  readonly mf: Miniflare;
  /** `http://127.0.0.1:<port>` without a trailing slash; what `readShareUrl` returns. */
  readonly url: string;
  /** The `PUBLIC_BASE_URL` value, `https://share.test`, for `mf.dispatchFetch`. */
  readonly base: string;
  /** The temporary directory holding the Worker bundle; `dispose()` removes it. */
  readonly dir: string;
  dispose(): Promise<void>;
}

/** Account RPC stub: accepts `tokenFor(id)` for each user and answers with that identity. */
function accountStub(users: readonly ShareTestUser[]): string {
  const byToken = Object.fromEntries(users.map((u) => [tokenFor(u.id), { githubId: u.id, githubLogin: u.login }]));
  return `
import { WorkerEntrypoint } from 'cloudflare:workers';
const USERS = ${JSON.stringify(byToken)};
export class AccountRpc extends WorkerEntrypoint {
  async verifyDevice(token) {
    const user = USERS[token];
    if (!user) return { ok: false, error: 'invalid_token' };
    return { ok: true, userId: 'u' + user.githubId, githubId: user.githubId, githubLogin: user.githubLogin, deviceId: 'd' + user.githubId };
  }
}
export default { fetch() { return new Response('account stub'); } };
`;
}

export async function startShareWorker(options: StartShareWorkerOptions): Promise<ShareWorker> {
  const dir = await mkdtemp(join(tmpdir(), 'overdeck-share-worker-'));
  try {
    const wrangler = join(SERVICE_DIR, 'node_modules/wrangler/bin/wrangler.js');
    await execFileAsync(wrangler, ['deploy', '--dry-run', '--outdir', dir], {
      cwd: SERVICE_DIR,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
      maxBuffer: 16 * 1024 * 1024,
    });
    const bundle = await readFile(join(dir, 'index.js'), 'utf8');
    const { Miniflare } = serviceRequire('miniflare') as MiniflareModule;
    const { turn, rateLimit } = options;
    const mf = new Miniflare({
      workers: [
        {
          config: {
            name: 'overdeck-share',
            compatibilityDate: '2026-09-01',
            manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: bundle } } },
            env: {
              ROOMS: { type: 'durable-object', worker: 'overdeck-share', exportName: 'ShareRoom' },
              ACCOUNT: { type: 'worker', worker: 'account-stub', exportName: 'AccountRpc' },
              PUBLIC_BASE_URL: { type: 'text', value: BASE },
              // Worker secrets in production; this Miniflare refuses `value` on `type: 'secret'`, and a
              // text binding is the same string at runtime.
              ...(turn
                ? {
                    TURN_KEY_ID: { type: 'text', value: turn.keyId },
                    TURN_KEY_API_TOKEN: { type: 'text', value: turn.apiToken },
                  }
                : {}),
              ...(rateLimit
                ? {
                    ROOM_CREATE_LIMIT: {
                      type: 'rate-limit',
                      namespace: rateLimit.namespace,
                      simple: { limit: rateLimit.limit, period: rateLimit.period },
                    },
                  }
                : {}),
            },
            exports: { ShareRoom: { type: 'durable-object', storage: 'sqlite' } },
          },
        },
        {
          config: {
            name: 'account-stub',
            compatibilityDate: '2026-09-01',
            manifest: { mainModule: 'stub.js', modules: { 'stub.js': { type: 'esm', contents: accountStub(options.users) } } },
          },
        },
      ],
    });
    const url = String(await mf.ready).replace(/\/$/, '');
    return {
      mf,
      url,
      base: BASE,
      dir,
      async dispose() {
        try {
          await mf.dispose();
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
    };
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
}
