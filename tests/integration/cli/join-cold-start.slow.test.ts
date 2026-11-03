/**
 * Zero-install `pan join` cold start (PRD PAN-4480 WI-6, FR-11).
 *
 * Runs the built CLI's `join` the way `npx @overdeck/core join <code>` would on a machine that never
 * installed Overdeck: a temp HOME and OVERDECK_HOME holding only config.yaml, `tmux`, `herdr` and
 * `pan` shadowed on PATH by stubs that exit 127, and no dashboard running. The CLI must sign in
 * through a fake account service, auto-start the bundled dashboard on a free port and leave the
 * join in `lobby` on a real share Worker (Miniflare).
 *
 * The Worker bundle, Miniflare construction and account stub are copied from
 * `tests/integration/services/share/join-manager.test.ts` (not imported: that file owns its own
 * lifecycle). Run with `VITEST_INCLUDE_SLOW=1` after `npm run build`. It never touches port 3011 or
 * the operator's `~/.overdeck`.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { formatShareCode } from '../../../src/lib/sharing/share-code.js';
import { createRoom } from '../../../src/lib/sharing/share-service.js';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../../..');
const SERVICE_DIR = join(ROOT, 'services/share');
const CLI = join(ROOT, 'dist/cli/index.js');
const SERVER = join(ROOT, 'dist/dashboard/server.js');

// miniflare and wrangler are devDependencies of the services/share workspace, not of the root.
const serviceRequire = createRequire(join(SERVICE_DIR, 'package.json'));
type MiniflareModule = typeof import('../../../services/share/node_modules/miniflare');
const { Miniflare } = serviceRequire('miniflare') as MiniflareModule;
type Miniflare = InstanceType<MiniflareModule['Miniflare']>;

const BASE = 'https://share.test';
const OWNER = { id: 1, login: 'owner' };
const VIEWER = { id: 100, login: 'alice' };
const tokenFor = (githubId: number) => 'odd_' + githubId.toString(16).padStart(64, '0');

/** Device tokens the account stub accepts, mapped to the identity it returns. */
const ACCOUNT_STUB = `
import { WorkerEntrypoint } from 'cloudflare:workers';
const USERS = ${JSON.stringify(
  Object.fromEntries([OWNER, VIEWER].map((u) => [tokenFor(u.id), { githubId: u.id, githubLogin: u.login }])),
)};
export class AccountRpc extends WorkerEntrypoint {
  async verifyDevice(token) {
    const user = USERS[token];
    if (!user) return { ok: false, error: 'invalid_token' };
    return { ok: true, userId: 'u' + user.githubId, githubId: user.githubId, githubLogin: user.githubLogin, deviceId: 'd' + user.githubId };
  }
}
export default { fetch() { return new Response('account stub'); } };
`;

/** The overdeck.ai account service endpoints `loginCommand` calls, answering for `alice`. */
function startFakeAccountService(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    req.resume();
    req.on('end', () => {
      const { pathname } = new URL(req.url ?? '/', 'http://127.0.0.1');
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      if (req.method === 'POST' && pathname === '/oauth/device/code') {
        return send(200, {
          device_code: 'dc',
          user_code: 'ABCD-EFGH',
          verification_uri: `${base}/activate`,
          verification_uri_complete: `${base}/activate?user_code=ABCD-EFGH`,
          expires_in: 900,
          interval: 1,
        });
      }
      if (req.method === 'POST' && pathname === '/oauth/token') {
        return send(200, { access_token: tokenFor(VIEWER.id), device_id: 'd100', label: 'alice' });
      }
      if (req.method === 'GET' && pathname === '/v1/me') {
        return send(200, {
          userId: 'u100',
          githubId: VIEWER.id,
          githubLogin: VIEWER.login,
          deviceId: 'd100',
          access: { status: 'active', expiresAt: null },
        });
      }
      return send(404, { error: 'not_found' });
    });
  });
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => {
      resolveServer({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` });
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolvePort(port));
    });
  });
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

let tmp = '';
let home = '';
let mf: Miniflare | undefined;
let account: { server: Server; url: string } | undefined;
let serverPid: number | null = null;
let port = 0;

beforeAll(async () => {
  expect(process.versions.bun, 'the cold-start test runs under Node 22 only').toBeUndefined();
  if (!existsSync(CLI) || !existsSync(SERVER)) throw new Error('dist/ is missing: run npm run build first');

  tmp = await mkdtemp(join(tmpdir(), 'overdeck-join-cold-mf-'));
  home = await mkdtemp(join(tmpdir(), 'overdeck-join-cold-home-'));
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
          name: 'overdeck-share',
          compatibilityDate: '2026-09-01',
          manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: bundle } } },
          env: {
            ROOMS: { type: 'durable-object', worker: 'overdeck-share', exportName: 'ShareRoom' },
            ACCOUNT: { type: 'worker', worker: 'account-stub', exportName: 'AccountRpc' },
            PUBLIC_BASE_URL: { type: 'text', value: BASE },
          },
          exports: { ShareRoom: { type: 'durable-object', storage: 'sqlite' } },
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
  account = await startFakeAccountService();
  port = await freePort();
}, 180_000);

afterAll(async () => {
  if (serverPid !== null) {
    try {
      process.kill(serverPid, 'SIGTERM');
    } catch {
      // Already gone.
    }
    // The port closes before shutdown finishes; wait for the PID too, so the server does not write
    // into the temp home after it is removed.
    const pid = serverPid;
    await vi.waitFor(
      async () => {
        if (await answers(`http://127.0.0.1:${port}/api/health`)) throw new Error('dashboard still answering');
        if (processAlive(pid)) throw new Error('dashboard still running');
      },
      { timeout: 30_000, interval: 250 },
    );
  }
  await mf?.dispose();
  await new Promise<void>((done) => (account ? account.server.close(() => done()) : done()));
  if (tmp) await rm(tmp, { recursive: true, force: true });
  if (home) await rm(home, { recursive: true, force: true });
}, 60_000);

describe('pan join cold start (zero-install)', () => {
  it('signs in, auto-starts the bundled dashboard and leaves the join in the lobby', async () => {
    const shareUrl = String(await mf!.ready).replace(/\/$/, '');
    const room = await createRoom(shareUrl, tokenFor(OWNER.id), { kind: 'conversation', conversationId: 'cold-start' });
    if (!room.ok) throw new Error(`createRoom failed: ${JSON.stringify(room)}`);
    const code = room.room.shortCode;

    const overdeckHome = join(home, '.overdeck');
    const cwd = join(home, 'cwd');
    const shims = join(home, 'shims');
    await mkdir(overdeckHome, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(shims, { recursive: true });
    await writeFile(
      join(overdeckHome, 'config.yaml'),
      `anywhere:\n  share_url: ${shareUrl}\n  directory_url: http://127.0.0.1:9\n`,
    );
    for (const tool of ['tmux', 'herdr', 'pan']) {
      await writeFile(join(shims, tool), '#!/bin/sh\nexit 127\n');
      await chmod(join(shims, tool), 0o755);
    }

    const apiUrl = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, [CLI, 'join', formatShareCode(code), '--no-open'], {
      cwd,
      env: {
        ...process.env,
        HOME: home,
        OVERDECK_HOME: overdeckHome,
        OVERDECK_ACCOUNT_URL: account!.url,
        OVERDECK_DASHBOARD_URL: apiUrl,
        PATH: `${shims}:${process.env.PATH ?? ''}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const exitCode = await new Promise<number | null>((done) => child.once('exit', (codeOrNull) => done(codeOrNull)));

    // Record the auto-started server's PID first, so afterAll stops it even when an assertion fails.
    const health = await fetch(`${apiUrl}/api/health`).catch(() => null);
    const healthBody = health ? ((await health.json()) as { pid?: number }) : null;
    serverPid = typeof healthBody?.pid === 'number' ? healthBody.pid : null;

    expect(exitCode, `stdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0);
    expect(stdout).toContain('To sign in, open:');
    expect(stdout).toContain(`Started Overdeck at ${apiUrl}`);
    expect(stdout).toContain('Waiting for the host to let you in');

    const accountFile = join(overdeckHome, 'account.json');
    expect(existsSync(accountFile)).toBe(true);
    expect(statSync(accountFile).mode & 0o777).toBe(0o600);

    const internalToken = (await readFile(join(overdeckHome, 'internal-token'), 'utf8')).trim();
    const join_ = await fetch(`${apiUrl}/api/joins/${code}`, { headers: { 'x-overdeck-internal-token': internalToken } });
    expect(join_.status).toBe(200);
    const view = (await join_.json()) as { state: string; login: string | null };
    expect(view.state).toBe('lobby');
    expect(view.login).toBe('alice');

    expect(health?.status).toBe(200);
    expect(serverPid).not.toBeNull();
    expect(serverPid).not.toBe(child.pid);
  }, 240_000);
});
