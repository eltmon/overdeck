#!/usr/bin/env node
// directory-smoke.mjs — two dashboards find each other through a loopback overdeck.ai directory,
// link by two-screen approval and talk over a `direct` WebRTC route (PAN-2356 WI-21).
//
// Requires `npm run build` first (it runs dist/dashboard/server.js and dist/cli/index.js), and the
// services/connect workspace installed (its wrangler bundles the Worker, its miniflare runs it).
//
// What it does, in order (each step is named in the output; a failure prints
// "FAILED at step <name>: <why>" and exits 1):
//   1. connect   bundle services/connect with `wrangler deploy --dry-run` and run it in Miniflare on a
//                free loopback port, beside an inline AccountRpc stub: two device tokens are one
//                `tester` account (machines A and B), four more are one `free` account. No TURN
//                secrets, so a relay request answers `turn_unavailable` (the PRD's 503 TURN stub
//                gives the same refusal). Durable Object storage is on disk under .tmp.
//   2. start     two dashboards, OVERDECK_HOME=<repo>/.tmp/directory-a (port 3051) and
//                .tmp/directory-b (port 3052), each with account.json and
//                `anywhere: { directory_url: http://127.0.0.1:<port> }`, Deacon disabled, the link
//                supervisor opted in, and OVERDECK_ANYWHERE_NO_ADVERTISE=1 so neither advertises a
//                LAN address: only the `direct` route can link them.
//   3. register  both list each other online in `pan machines directory --json` within 15 s.
//   4. approve   `pan machines join --to <A> --json` on B; `pan machines approve <id> --yes` on A;
//                both print the same code; `pan machines accept <id>` on B; then each side lists the
//                other online in `pan machines list --json` with a current route starting rtc://
//                within 60 s.
//   5. limit     three raw directory sockets for the free account register; a fourth gets
//                "The free account includes 3 machines" and close 4009.
//   6. inbox     on B, `pan triggers add --project smoke --inbox`; stop B; repoint the trigger at a
//                conversation that does not exist (so delivery starts nothing); POST a body carrying a
//                marker to the inbox URL (202); scan every Durable Object storage file for the marker
//                (absent); restart B and wait for `[triggers] <id> target gone 410` in B's log and the
//                directory's `inbox-ack` (the held event was opened and run through the trigger core).
//   7. logs      the Worker's console output contains no body marker and no SDP text.
//   8. stop      everything started here is stopped. Nothing outside .tmp/directory-* is touched.
//
// Usage: npm run build && node scripts/anywhere/directory-smoke.mjs
// Not in CI: it binds two LAN-visible ports and runs for about two minutes.
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = resolve(repo, 'dist', 'dashboard', 'server.js');
const CLI = resolve(repo, 'dist', 'cli', 'index.js');
const CONNECT_DIR = resolve(repo, 'services', 'connect');
const PORT_A = 3051;
const PORT_B = 3052;
const HOMES = { a: resolve(repo, '.tmp', 'directory-a'), b: resolve(repo, '.tmp', 'directory-b') };
const SMOKE_DIR = resolve(repo, '.tmp', 'directory-smoke');
const PROJECT_DIR = resolve(repo, '.tmp', 'directory-smoke-project');
const MARKER = `PLAINTEXT-MARKER-2356-${randomBytes(4).toString('hex')}`;

const TOKENS = {
  a: `odd_${'a'.repeat(63)}1`,
  b: `odd_${'a'.repeat(63)}2`,
  free: [1, 2, 3, 4].map((n) => `odd_${'f'.repeat(63)}${n}`),
};

const started = Date.now();
const log = (line) => console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(6)} s] ${line}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Live processes and sockets, closed on exit whatever happens. */
const running = { servers: new Map(), miniflare: null, sockets: new Set(), workerLogs: [] };

class StepError extends Error {
  constructor(step, message) {
    super(message);
    this.step = step;
  }
}

async function step(name, fn) {
  log(`step ${name}`);
  try {
    return await fn();
  } catch (error) {
    throw error instanceof StepError ? error : new StepError(name, error.message);
  }
}

function freshDir(path) {
  // Only ever the smoke's own directories; refuse anything else so a bad edit cannot widen this.
  if (!/\/\.tmp\/directory-(a|b|smoke|smoke-project)$/.test(path)) throw new Error(`refusing to reset ${path}`);
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

function freePort() {
  return new Promise((done, fail) => {
    const server = createServer();
    server.on('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

const ACCOUNT_STUB = `
import { WorkerEntrypoint } from 'cloudflare:workers';
const TESTER = ${JSON.stringify([TOKENS.a, TOKENS.b])};
const FREE = ${JSON.stringify(TOKENS.free)};
export class AccountRpc extends WorkerEntrypoint {
  async verifyDevice(token) {
    if (TESTER.includes(token)) {
      return { ok: true, userId: 'u-smoke', githubId: 1, deviceId: 'd-' + token.slice(-1), entitlement: { plan: 'tester', maxDevices: null } };
    }
    if (FREE.includes(token)) {
      return { ok: true, userId: 'u-free', githubId: 2, deviceId: 'f-' + token.slice(-1), entitlement: { plan: 'free', maxDevices: 3 } };
    }
    return { ok: false, error: 'invalid_token' };
  }
}
export default { fetch() { return new Response('account stub'); } };
`;

async function startDirectory() {
  const bundleDir = join(SMOKE_DIR, 'bundle');
  mkdirSync(bundleDir, { recursive: true });
  const wrangler = join(CONNECT_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (!existsSync(wrangler)) throw new Error(`missing ${wrangler}; run bun install`);
  await execFileAsync(process.execPath, [wrangler, 'deploy', '--dry-run', '--outdir', bundleDir], {
    cwd: CONNECT_DIR,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
  const bundle = readFileSync(join(bundleDir, 'index.js'), 'utf8');
  const { Miniflare } = createRequire(join(CONNECT_DIR, 'package.json'))('miniflare');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const mf = new Miniflare({
    host: '127.0.0.1',
    port,
    resourcePersistencePath: join(SMOKE_DIR, 'state'),
    handleStructuredLogs: (entry) => running.workerLogs.push(entry.message),
    workers: [
      {
        config: {
          name: 'overdeck-connect',
          compatibilityDate: '2026-09-01',
          manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: bundle } } },
          env: {
            DIRECTORY: { type: 'durable-object', worker: 'overdeck-connect', exportName: 'AccountDirectory' },
            ACCOUNT: { type: 'worker', worker: 'account-stub', exportName: 'AccountRpc' },
            PUBLIC_BASE_URL: { type: 'text', value: base },
            STUN_URLS: { type: 'text', value: '' },
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
  running.miniflare = mf;
  const health = await (await fetch(`${base}/healthz`)).json();
  if (!health.ok) throw new Error(`the directory /healthz answered ${JSON.stringify(health)}`);
  return { port, base };
}

function prepareHome(name, directoryUrl) {
  const home = HOMES[name];
  freshDir(home);
  writeFileSync(join(home, 'account.json'), JSON.stringify({
    v: 1,
    baseUrl: 'https://overdeck.ai',
    accessToken: TOKENS[name],
    deviceId: `d-${name}`,
    label: `smoke-${name}`,
    githubLogin: 'smoke',
    githubId: 1,
    signedInAt: new Date().toISOString(),
  }), { mode: 0o600 });
  writeFileSync(join(home, 'config.yaml'), `anywhere:\n  directory_url: ${directoryUrl}\n`);
  if (name === 'b') writeFileSync(join(home, 'projects.yaml'), `projects:\n  smoke:\n    name: smoke\n    path: ${PROJECT_DIR}\n`);
}

function serverEnv(home, port) {
  const env = { ...process.env };
  // Inherited values that would point the smoke servers or CLIs at the operator's dashboard.
  for (const key of ['OVERDECK_INTERNAL_TOKEN', 'OVERDECK_AGENT_ID', 'OVERDECK_DASHBOARD_SPAWNED_BY', 'DASHBOARD_URL', 'HOST']) delete env[key];
  return {
    ...env,
    OVERDECK_HOME: home,
    API_PORT: String(port),
    PORT: String(port),
    OVERDECK_DASHBOARD_URL: `http://127.0.0.1:${port}`,
    DASHBOARD_URL: `http://127.0.0.1:${port}`,
    OVERDECK_DISABLE_DEACON: '1',
    OVERDECK_ANYWHERE_SUPERVISOR: '1',
    OVERDECK_NO_RESUME: '1',
    // Only the `direct` route can link the two dashboards.
    OVERDECK_ANYWHERE_NO_ADVERTISE: '1',
  };
}

function portOf(name) {
  return name === 'a' ? PORT_A : PORT_B;
}

function startServer(name) {
  const home = HOMES[name];
  const logFd = openSync(resolve(home, 'server.log'), 'a');
  const child = spawn(process.execPath, [SERVER], { env: serverEnv(home, portOf(name)), stdio: ['ignore', logFd, logFd] });
  running.servers.set(name, child);
  child.on('exit', (code, signal) => {
    if (running.servers.get(name) === child) running.servers.delete(name);
    log(`server ${name} exited (code ${code}, signal ${signal})`);
  });
  return child;
}

async function waitListening(name, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!running.servers.has(name)) throw new Error(`server ${name} exited before listening; see ${HOMES[name]}/server.log`);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1000);
      const response = await fetch(`http://127.0.0.1:${portOf(name)}/api/environment`, { signal: controller.signal }).finally(() => clearTimeout(timer));
      if (response.status < 500) return;
    } catch {
      // not yet
    }
    await sleep(250);
  }
  throw new Error(`server ${name} did not answer within ${timeoutMs} ms; see ${HOMES[name]}/server.log`);
}

async function stopServer(name) {
  const child = running.servers.get(name);
  if (!child) return;
  running.servers.delete(name);
  const exited = new Promise((done) => child.once('exit', done));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timer);
}

async function cliText(name, args, timeout = 60_000) {
  const { stdout } = await execFileAsync(process.execPath, [CLI, ...args], {
    env: serverEnv(HOMES[name], portOf(name)),
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

function lastJson(stdout, args) {
  const line = stdout.trim().split('\n').filter((candidate) => candidate.startsWith('{')).pop();
  if (!line) throw new Error(`pan ${args.join(' ')} printed no JSON:\n${stdout}`);
  return JSON.parse(line);
}

async function cli(name, args, timeout) {
  return lastJson(await cliText(name, args, timeout), args);
}

async function pollUntil(description, timeoutMs, probe) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await probe();
    } catch (error) {
      last = { ok: false, detail: error.message };
    }
    if (last.ok) return last.value;
    await sleep(1000);
  }
  throw new Error(`${description} not reached within ${timeoutMs / 1000} s (last: ${last?.detail ?? 'no answer'})`);
}

/** Every byte of every file the Durable Object wrote. */
function storageFiles() {
  const root = join(SMOKE_DIR, 'state');
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/** One raw directory socket that sends `hello` and resolves with the first frame and the close code. */
function rawHello(base, token) {
  const { WebSocket } = createRequire(resolve(repo, 'package.json'))('ws');
  return new Promise((done, fail) => {
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/v1/directory`, { headers: { Authorization: `Bearer ${token}` } });
    running.sockets.add(ws);
    let first = null;
    const timer = setTimeout(() => fail(new Error('a raw directory socket got no answer within 10 s')), 10_000);
    ws.on('open', () => ws.send(JSON.stringify({
      type: 'hello',
      protocol: 1,
      environmentId: randomUUID(),
      label: 'smoke-raw',
      publicKeyHex: randomBytes(32).toString('hex'),
      serverVersion: 'smoke',
      linkProtocol: 1,
      endpoints: [],
    })));
    ws.on('message', (data) => {
      first ??= JSON.parse(String(data));
      if (first.type === 'welcome') {
        clearTimeout(timer);
        done({ ws, first, code: null });
      }
    });
    ws.on('close', (code) => {
      clearTimeout(timer);
      done({ ws, first, code });
    });
    ws.on('error', () => undefined);
  });
}

async function cleanup() {
  for (const ws of running.sockets) {
    try {
      ws.terminate();
    } catch {
      // closed
    }
  }
  running.sockets.clear();
  await Promise.all([...running.servers.keys()].map((name) => stopServer(name)));
  if (running.miniflare) await running.miniflare.dispose().catch(() => undefined);
  running.miniflare = null;
}

async function main() {
  if (!existsSync(SERVER) || !existsSync(CLI)) {
    throw new StepError('preflight', `missing ${SERVER} or ${CLI}; run npm run build first`);
  }

  const directory = await step('connect', async () => {
    freshDir(SMOKE_DIR);
    freshDir(PROJECT_DIR);
    const started = await startDirectory();
    log(`directory at ${started.base}`);
    return started;
  });

  await step('start', async () => {
    prepareHome('a', directory.base);
    prepareHome('b', directory.base);
    startServer('a');
    startServer('b');
    await Promise.all([waitListening('a', 90_000), waitListening('b', 90_000)]);
    log(`A on :${PORT_A} (home ${HOMES.a}), B on :${PORT_B} (home ${HOMES.b})`);
  });

  const [selfA, selfB] = await Promise.all([cli('a', ['machines', 'list', '--json']), cli('b', ['machines', 'list', '--json'])])
    .then(([a, b]) => [a.self, b.self]);

  await step('register', () => pollUntil('both machines in the directory', 15_000, async () => {
    const view = await cli('a', ['machines', 'directory', '--json']);
    const online = new Set(view.machines.filter((m) => m.online).map((m) => m.environmentId));
    const detail = `state ${view.state}, online ${[...online].join(', ') || 'none'}${view.refusal ? `, refusal ${view.refusal}` : ''}`;
    if (online.has(selfA.environmentId) && online.has(selfB.environmentId)) {
      log(detail);
      return { ok: true, value: view };
    }
    return { ok: false, detail };
  }));

  await step('approve', async () => {
    const joinArgs = ['machines', 'join', '--to', selfA.environmentId, '--json'];
    const joining = cliText('b', joinArgs, 120_000);
    const requestId = await pollUntil('the approval request on A', 15_000, async () => {
      const view = await cli('a', ['machines', 'directory', '--json']);
      const approval = view.approvals[0];
      return approval ? { ok: true, value: approval.requestId } : { ok: false, detail: 'no approval yet' };
    });
    log(`A sees approval request ${requestId}`);
    const approved = await cliText('a', ['machines', 'approve', requestId, '--yes'], 60_000);
    const approverCode = /Code: (\d{3} \d{3})/.exec(approved)?.[1];
    if (!approverCode) throw new Error(`pan machines approve printed no code:\n${approved}`);
    const joined = lastJson(await joining, joinArgs);
    log(`codes: approver ${approverCode}, requester ${joined.sas}`);
    if (joined.sas !== approverCode) throw new Error(`the two screens show different codes (${approverCode} vs ${joined.sas})`);
    await cliText('b', ['machines', 'accept', requestId]);
    await pollUntil('both links online over rtc://', 60_000, async () => {
      const [listA, listB] = await Promise.all([cli('a', ['machines', 'list', '--json']), cli('b', ['machines', 'list', '--json'])]);
      const aToB = listA.links.find((link) => link.environmentId === selfB.environmentId);
      const bToA = listB.links.find((link) => link.environmentId === selfA.environmentId);
      const detail = `A->B ${aToB?.state ?? 'missing'} via ${aToB?.currentRoute ?? '-'}; B->A ${bToA?.state ?? 'missing'} via ${bToA?.currentRoute ?? '-'}`;
      const direct = (link) => link?.state === 'online' && link.currentRoute?.startsWith('rtc://');
      if (direct(aToB) && direct(bToA)) {
        log(detail);
        return { ok: true, value: detail };
      }
      return { ok: false, detail };
    });
  });

  await step('limit', async () => {
    for (const token of TOKENS.free.slice(0, 3)) {
      const { first } = await rawHello(directory.base, token);
      if (first?.type !== 'welcome') throw new Error(`a free machine was not welcomed: ${JSON.stringify(first)}`);
    }
    const fourth = await rawHello(directory.base, TOKENS.free[3]);
    if (fourth.first?.message !== 'The free account includes 3 machines' || fourth.code !== 4009) {
      throw new Error(`the fourth free machine got ${JSON.stringify(fourth.first)} and close ${fourth.code}`);
    }
    log(`fourth free machine refused: "${fourth.first.message}", close ${fourth.code}`);
  });

  await step('inbox', async () => {
    const addArgs = ['triggers', 'add', 'smoke-inbox', '--project', 'smoke', '--prompt', 'smoke event', '--inbox', '--json'];
    const created = await cli('b', addArgs);
    if (!created.inboxUrl?.startsWith(`${directory.base}/h/`)) throw new Error(`no inbox URL in ${JSON.stringify(created)}`);
    const triggerId = created.trigger.id;
    log(`trigger ${triggerId} holds events at ${created.inboxUrl.replace(/\.[0-9a-f]{32}$/, '.<secret>')}`);

    await stopServer('b');
    await pollUntil('B offline in the directory', 15_000, async () => {
      const view = await cli('a', ['machines', 'directory', '--json']);
      const b = view.machines.find((m) => m.environmentId === selfB.environmentId);
      return b && !b.online ? { ok: true, value: true } : { ok: false, detail: `B online=${b?.online}` };
    });
    // Point the trigger at a conversation that does not exist, so delivery runs every step and starts nothing.
    const triggersPath = join(HOMES.b, 'triggers.json');
    const store = JSON.parse(readFileSync(triggersPath, 'utf8'));
    store.triggers = store.triggers.map((t) => (t.id === triggerId ? { ...t, target: { kind: 'conversation', conversation: 'smoke-gone' }, template: null } : t));
    writeFileSync(triggersPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });

    const response = await fetch(created.inboxUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'push' },
      body: JSON.stringify({ marker: MARKER }),
    });
    if (response.status !== 202) throw new Error(`the inbox answered ${response.status}: ${await response.text()}`);
    const files = storageFiles();
    for (const file of files) {
      if (readFileSync(file).includes(Buffer.from(MARKER))) throw new Error(`the marker is in Durable Object storage: ${file}`);
    }
    log(`event held; marker absent from ${files.length} storage files`);

    startServer('b');
    await waitListening('b', 90_000);
    await pollUntil('B delivers the held event', 60_000, async () => {
      const serverLog = readFileSync(join(HOMES.b, 'server.log'), 'utf8');
      const delivered = serverLog.includes(`[triggers] ${triggerId} target gone 410`);
      const acked = running.workerLogs.some((line) => line.includes('"frame":"inbox-ack"'));
      if (delivered && acked) {
        log(`B ran the held event through the trigger core ([triggers] ${triggerId} target gone 410) and acknowledged it`);
        return { ok: true, value: true };
      }
      return { ok: false, detail: `delivered=${delivered} acked=${acked}` };
    });
  });

  await step('logs', () => {
    const all = running.workerLogs.join('\n');
    if (all.includes(MARKER)) throw new Error('the Worker logged the body marker');
    if (/a=ice-ufrag|a=fingerprint|v=0\b/.test(all)) throw new Error('the Worker logged SDP text');
    log(`${running.workerLogs.length} Worker log lines carry no body and no SDP`);
  });

  await step('stop', cleanup);
  log('OK: two dashboards found each other through the directory, linked by approval over rtc://, the free limit held, and the inbox held only a sealed event');
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  exitCode = 1;
  const failedStep = error instanceof StepError ? error.step : 'unknown';
  console.error(`FAILED at step ${failedStep}: ${error.message}`);
  console.error(`server logs: ${HOMES.a}/server.log and ${HOMES.b}/server.log`);
} finally {
  await cleanup().catch(() => undefined);
}
process.exit(exitCode);
