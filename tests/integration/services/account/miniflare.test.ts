/**
 * The operator's "test locally with wrangler/Miniflare" (PRD PAN-4293 §7.15, D-24b, NFR-9).
 *
 * Bundles the real Worker with wrangler's `--dry-run` deploy (no credentials, no upload), loads it into Miniflare
 * (real workerd) with a local D1 and the migrations applied, stubs GitHub through outboundService, and drives
 * the PKCE and device flows end to end.
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
const SERVICE_DIR = join(ROOT, 'services/account');

// miniflare and wrangler are devDependencies of the services/account workspace, not of the root,
// so resolve them from there (Bun installs workspace deps under the workspace's own node_modules).
const serviceRequire = createRequire(join(SERVICE_DIR, 'package.json'));
type MiniflareModule = typeof import('../../../../services/account/node_modules/miniflare');
const { Miniflare } = serviceRequire('miniflare') as MiniflareModule;
type Miniflare = InstanceType<MiniflareModule['Miniflare']>;
const BASE = 'https://account.test';
const STUB_TOKEN = 'gho_stubbed';
const OWNER_ID = 1;
const ENV_ID = '11111111-2222-4333-8444-555555555555';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const SLOW = 30_000;

let tmp = '';
let mf: Miniflare;
/** The identity the GitHub stub returns for GET /user; tests switch it. */
let githubIdentity: { id: number; login: string } = { id: OWNER_ID, login: 'owner' };
const unexpectedOutbound: string[] = [];

async function applyMigrations(): Promise<void> {
  const db = await mf.getD1Database('DB');
  const sql = await readFile(join(SERVICE_DIR, 'migrations/0001_init.sql'), 'utf8');
  const statements = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*\n/)
    .map((s) => s.replace(/--[^\n]*/g, '').trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) await db.prepare(statement).run();
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'overdeck-account-mf-'));
  const wrangler = join(SERVICE_DIR, 'node_modules/wrangler/bin/wrangler.js');
  await execFileAsync(wrangler, ['deploy', '--dry-run', '--outdir', tmp], {
    cwd: SERVICE_DIR,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
  // miniflare 5.x (the alpha wrangler 4.146 pins) takes `workers[].config` in the new Workers config shape
  // (manifest of module contents + env bindings) and `workers[].dev` for local-only knobs; the 3.x
  // single-worker shorthand (scriptPath, d1Databases, bindings, ...) is gone.
  const bundle = await readFile(join(tmp, 'index.js'), 'utf8');
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'overdeck-account',
          compatibilityDate: '2026-09-01',
          manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: bundle } } },
          env: {
            DB: { type: 'd1', name: 'overdeck-account' },
            PUBLIC_BASE_URL: { type: 'text', value: BASE },
            GITHUB_CLIENT_ID: { type: 'text', value: 'test-id' },
            GITHUB_CLIENT_SECRET: { type: 'text', value: 'test-secret' },
            OWNER_GITHUB_ID: { type: 'text', value: String(OWNER_ID) },
          },
        },
        dev: {
          // Keep the CF-Connecting-IP header the tests send; production Cloudflare sets it itself.
          stripCfConnectingIp: false,
          outboundService: {
            type: 'fetcher',
            handler: async (request: Request) => {
              const url = new URL(request.url);
              if (url.href === 'https://github.com/login/oauth/access_token' && request.method === 'POST') {
                return new Response(JSON.stringify({ access_token: STUB_TOKEN, token_type: 'bearer' }), { headers: { 'Content-Type': 'application/json' } });
              }
              if (url.href === 'https://api.github.com/user') {
                if (request.headers.get('Authorization') !== `Bearer ${STUB_TOKEN}`) return new Response('{}', { status: 401 });
                return new Response(JSON.stringify(githubIdentity), { headers: { 'Content-Type': 'application/json' } });
              }
              unexpectedOutbound.push(`${request.method} ${url.href}`);
              return new Response('unexpected outbound request', { status: 599 });
            },
          },
        },
      },
    ],
  });
  await mf.ready;
  await applyMigrations();
}, 180_000);

afterAll(async () => {
  await mf?.dispose();
  if (tmp) await rm(tmp, { recursive: true, force: true });
}, 60_000);

function req(path: string, init: RequestInit & { ip?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('CF-Connecting-IP', init.ip ?? '192.0.2.1');
  const { ip: _ip, ...rest } = init;
  return mf.dispatchFetch(`${BASE}${path}`, { ...rest, headers, redirect: 'manual' });
}

function formBody(fields: Record<string, string>): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() };
}

function stateFrom(res: Response): string {
  return /__Host-od_state=([0-9a-f]{64});/.exec(res.headers.get('Set-Cookie') ?? '')?.[1] ?? '';
}

async function githubCallback(state: string, ip?: string): Promise<Response> {
  return req(`/auth/github/callback?code=gh-code&state=${state}`, { headers: { Cookie: `__Host-od_state=${state}` }, ip });
}

async function pkceStart(ip?: string): Promise<Response> {
  const q = new URLSearchParams({
    redirect_uri: 'http://127.0.0.1:4567/cb',
    state: 'client-state',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    platform: 'linux-x64',
    environment_id: ENV_ID,
  });
  return req(`/auth/start?${q.toString()}`, { ip });
}

describe('account service on real workerd (PAN-4293 account-miniflare-integration)', () => {
  it('GET /healthz reports configured: true', async () => {
    const res = await req('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, configured: true });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  }, SLOW);

  it('the full PKCE flow for the owner ends in a token accepted by /v1/me', async () => {
    githubIdentity = { id: OWNER_ID, login: 'owner' };
    const start = await pkceStart();
    expect(start.status).toBe(302);
    expect(start.headers.get('Location')).toContain('https://github.com/login/oauth/authorize?');
    const state = stateFrom(start);
    expect(state).toHaveLength(64);

    const cb = await githubCallback(state);
    expect(cb.status).toBe(302);
    const back = new URL(cb.headers.get('Location') ?? '');
    expect(back.origin + back.pathname).toBe('http://127.0.0.1:4567/cb');
    expect(back.searchParams.get('state')).toBe('client-state');
    const code = back.searchParams.get('code') ?? '';
    expect(code).toMatch(/^odc_/);

    const token = await req('/oauth/token', formBody({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: 'http://127.0.0.1:4567/cb' }));
    expect(token.status).toBe(200);
    const body = (await token.json()) as { access_token: string; device_id: string; label: string };
    expect(body.access_token).toMatch(/^odd_[0-9a-f]{64}$/);
    expect(body.label).toBe('Linux device');

    const me = await req('/v1/me', { headers: { Authorization: `Bearer ${body.access_token}` } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ githubId: OWNER_ID, githubLogin: 'owner', deviceId: body.device_id, entitlement: { plan: 'tester', storageBytesCap: 5368709120 }, access: { status: 'active' } });
  }, SLOW);

  it('after the PKCE flow no table holds the stubbed GitHub token', async () => {
    const db = await mf.getD1Database('DB');
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all<{ name: string }>()).results;
    expect(tables.length).toBe(10);
    let dump = '';
    for (const { name } of tables) dump += JSON.stringify((await db.prepare(`SELECT * FROM "${name}"`).all()).results);
    expect(dump).toContain('"github_login":"owner"');
    expect(dump).not.toContain(STUB_TOKEN);
    expect(dump).not.toContain('gho_');
    expect(dump).not.toContain('odd_');
  }, SLOW);

  it('a non-allowlisted identity ends in the invite-only redirect and a pending attempt', async () => {
    githubIdentity = { id: 4242, login: 'stranger' };
    const state = stateFrom(await pkceStart());
    const cb = await githubCallback(state);
    expect(cb.status).toBe(302);
    const back = new URL(cb.headers.get('Location') ?? '');
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('error_description')).toBe('invite_only');
    expect(back.searchParams.get('code')).toBeNull();
    const db = await mf.getD1Database('DB');
    expect(await db.prepare('SELECT github_login FROM pending_attempts WHERE github_id = ?').bind(4242).first('github_login')).toBe('stranger');
  }, SLOW);

  it('the device flow approves in the browser and the poll returns a token', async () => {
    githubIdentity = { id: OWNER_ID, login: 'owner' };
    const issued = await req('/oauth/device/code', { ...formBody({ platform: 'darwin-arm64', environment_id: '66666666-7777-4888-9999-aaaaaaaaaaaa' }), ip: '192.0.2.77' });
    expect(issued.status).toBe(200);
    const code = (await issued.json()) as { device_code: string; user_code: string; verification_uri: string; interval: number };
    expect(code.verification_uri).toBe(`${BASE}/activate`);

    const submit = await req('/activate', { ...formBody({ user_code: code.user_code.toLowerCase() }), ip: '192.0.2.78' });
    expect(submit.status).toBe(200);
    expect(await submit.text()).toContain('macOS device');
    const confirm = await req('/activate/confirm', { ...formBody({ user_code: code.user_code }), ip: '192.0.2.78' });
    expect(confirm.status).toBe(302);
    const done = await githubCallback(stateFrom(confirm), '192.0.2.78');
    expect(done.status).toBe(200);
    expect(await done.text()).toContain('Device connected');

    // First poll after approval (the pending/slow_down states are covered by the unit tests on an injected clock;
    // polling earlier here would need a real 5-second wait).
    const token = await req('/oauth/token', { ...formBody({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: code.device_code }), ip: '192.0.2.77' });
    expect(token.status).toBe(200);
    const body = (await token.json()) as { access_token: string; label: string };
    expect(body.label).toBe('macOS device');
    const devices = await req('/v1/devices', { headers: { Authorization: `Bearer ${body.access_token}` } });
    expect(devices.status).toBe(200);
  }, SLOW);

  it('the 21st GET /auth/start from one CF-Connecting-IP is 429 with Retry-After', async () => {
    const ip = '203.0.113.200';
    for (let i = 0; i < 20; i++) expect((await pkceStart(ip)).status, `request ${i + 1}`).toBe(302);
    const limited = await pkceStart(ip);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(limited.headers.get('Content-Type')).toContain('text/html');
    expect((await pkceStart('203.0.113.201')).status).toBe(302);
  }, 60_000);

  it('OPTIONS is 405 and the stub saw no unexpected outbound request', async () => {
    const res = await req('/v1/me', { method: 'OPTIONS' });
    expect(res.status).toBe(405);
    expect(unexpectedOutbound).toEqual([]);
  }, SLOW);
});
