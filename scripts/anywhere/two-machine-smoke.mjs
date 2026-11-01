#!/usr/bin/env node
// two-machine-smoke.mjs — two dashboards on one host link over a secure channel (PAN-4645 WI-21, D-4645-22).
//
// Requires `npm run build` first (it runs dist/dashboard/server.js and dist/cli/index.js).
//
// What it does, in order (each step is named in the output; a failure prints
// "FAILED at step <name>: <why>" and exits 1):
//   1. start       two servers, OVERDECK_HOME=<repo>/.tmp/anywhere-a (port 3041) and
//                  .tmp/anywhere-b (port 3042), fresh homes, Deacon disabled, the link
//                  supervisor opted in (OVERDECK_ANYWHERE_SUPERVISOR=1).
//   2. proxy       a byte-logging TCP proxy on a free loopback port in front of B.
//   3. pair+link   `pan pair --url http://127.0.0.1:<proxy> --json` on B, then
//                  `pan machines link <url> --allow-loopback --json` on A, so A's pairing
//                  route (lan, source pairing, which outranks B's advertised lan routes)
//                  and its heartbeat cross the proxy. B's reverse link reaches A directly
//                  over A's advertised LAN address.
//   4. online      both `pan machines list --json` show the other machine online within 15 s.
//   5. kill B      A shows the link offline within 30 s.
//   6. restart B   A shows it online again within 60 s.
//   7. no-http     the proxy capture contains no "HTTP/1.1": everything that crossed
//                  the pairing route was the secure channel.
//   8. stop        both servers are stopped. Nothing outside .tmp/anywhere-a|b is touched.
//
// Usage:
//   node scripts/anywhere/two-machine-smoke.mjs
//   node scripts/anywhere/two-machine-smoke.mjs --inject-plain-http   # sends one plain HTTP
//        request through the proxy so step no-http must fail (checks the detector; exit 1).
//
// Not in CI (D-4645-22): it binds two LAN-visible ports for about two minutes.
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = resolve(repo, 'dist', 'dashboard', 'server.js');
const CLI = resolve(repo, 'dist', 'cli', 'index.js');
const PORT_A = 3041;
const PORT_B = 3042;
const HOMES = { a: resolve(repo, '.tmp', 'anywhere-a'), b: resolve(repo, '.tmp', 'anywhere-b') };
const INJECT_PLAIN_HTTP = process.argv.includes('--inject-plain-http');

const started = Date.now();
const log = (line) => console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(6)} s] ${line}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Live processes and sockets, closed on exit whatever happens. */
const running = { servers: new Map(), proxy: null, proxySockets: new Set() };

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

function freshHome(path) {
  // Only ever the two smoke homes; refuse anything else so a bad edit cannot widen this.
  if (!/\/\.tmp\/anywhere-[ab]$/.test(path)) throw new Error(`refusing to reset ${path}`);
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
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
    // A peer-mode dashboard: no Deacon, no tracker polling, no proxy watchdog; the
    // link supervisor is opted back in so the two machines link (PAN-4645 D-4645-21).
    OVERDECK_DISABLE_DEACON: '1',
    OVERDECK_ANYWHERE_SUPERVISOR: '1',
    OVERDECK_NO_RESUME: '1',
  };
}

function startServer(name, home, port) {
  const logFd = openSync(resolve(home, 'server.log'), 'a');
  const child = spawn(process.execPath, [SERVER], { env: serverEnv(home, port), stdio: ['ignore', logFd, logFd] });
  running.servers.set(name, child);
  child.on('exit', (code, signal) => {
    if (running.servers.get(name) === child) running.servers.delete(name);
    log(`server ${name} exited (code ${code}, signal ${signal})`);
  });
  return child;
}

async function waitListening(name, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!running.servers.has(name)) throw new Error(`server ${name} exited before listening; see ${HOMES[name]}/server.log`);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1000);
      const response = await fetch(`http://127.0.0.1:${port}/api/environment`, { signal: controller.signal }).finally(() => clearTimeout(timer));
      if (response.status < 500) return;
    } catch {
      // not yet
    }
    await sleep(250);
  }
  throw new Error(`server ${name} did not answer on :${port} within ${timeoutMs} ms; see ${HOMES[name]}/server.log`);
}

async function stopServer(name) {
  const child = running.servers.get(name);
  if (!child) return;
  running.servers.delete(name);
  const exited = new Promise((done) => child.once('exit', done));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  await exited;
  clearTimeout(timer);
}

async function cli(name, args) {
  const home = HOMES[name];
  const port = name === 'a' ? PORT_A : PORT_B;
  const { stdout } = await execFileAsync(process.execPath, [CLI, ...args], { env: serverEnv(home, port), timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  const line = stdout.trim().split('\n').filter((candidate) => candidate.startsWith('{')).pop();
  if (!line) throw new Error(`pan ${args.join(' ')} printed no JSON:\n${stdout}`);
  return JSON.parse(line);
}

/** Byte-logging TCP proxy in front of B: both directions land in `capture`. */
function startProxy(capture) {
  return new Promise((done, fail) => {
    const server = createServer((client) => {
      running.proxySockets.add(client);
      const upstream = connect({ host: '127.0.0.1', port: PORT_B });
      running.proxySockets.add(upstream);
      const drop = () => {
        client.destroy();
        upstream.destroy();
        running.proxySockets.delete(client);
        running.proxySockets.delete(upstream);
      };
      client.on('data', (chunk) => { capture.push(chunk); upstream.write(chunk); });
      upstream.on('data', (chunk) => { capture.push(chunk); client.write(chunk); });
      client.on('error', drop).on('close', drop);
      upstream.on('error', drop).on('close', drop);
    });
    server.on('error', fail);
    server.listen(0, '127.0.0.1', () => {
      running.proxy = server;
      done(server.address().port);
    });
  });
}

async function pollUntil(description, timeoutMs, probe) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await probe();
    if (last.ok) return last.value;
    await sleep(1000);
  }
  throw new Error(`${description} not reached within ${timeoutMs / 1000} s (last: ${last?.detail ?? 'no answer'})`);
}

function linkTo(machines, environmentId) {
  return machines.links.find((link) => link.environmentId === environmentId) ?? null;
}

async function cleanup() {
  for (const socket of running.proxySockets) socket.destroy();
  running.proxySockets.clear();
  if (running.proxy) await new Promise((done) => running.proxy.close(() => done()));
  running.proxy = null;
  await Promise.all([...running.servers.keys()].map((name) => stopServer(name)));
}

async function main() {
  if (!existsSync(SERVER) || !existsSync(CLI)) {
    throw new StepError('preflight', `missing ${SERVER} or ${CLI}; run npm run build first`);
  }
  const capture = [];

  await step('start', async () => {
    freshHome(HOMES.a);
    freshHome(HOMES.b);
    startServer('a', HOMES.a, PORT_A);
    startServer('b', HOMES.b, PORT_B);
    await Promise.all([waitListening('a', PORT_A, 90_000), waitListening('b', PORT_B, 90_000)]);
    log(`A listening on :${PORT_A} (home ${HOMES.a}), B on :${PORT_B} (home ${HOMES.b})`);
  });

  const proxyPort = await step('proxy', () => startProxy(capture));
  log(`proxy 127.0.0.1:${proxyPort} -> 127.0.0.1:${PORT_B}`);

  const { selfA, selfB } = await step('pair+link', async () => {
    const pairing = await cli('b', ['pair', '--url', `http://127.0.0.1:${proxyPort}`, '--json']);
    log(`B issued a pairing link expiring ${pairing.expiresAt}`);
    const view = await cli('a', ['machines', 'link', pairing.url, '--allow-loopback', '--json']);
    log(`A linked ${view.label} (${view.fingerprint}) over ${view.routes.map((route) => `${route.source}:${route.url}`).join(', ')}`);
    const listA = await cli('a', ['machines', 'list', '--json']);
    const listB = await cli('b', ['machines', 'list', '--json']);
    if (!linkTo(listB, listA.self.environmentId)) throw new Error('B holds no reverse link to A after a both-ways link');
    return { selfA: listA.self, selfB: listB.self };
  });

  await step('online', () => pollUntil('both machines online', 15_000, async () => {
    const [listA, listB] = await Promise.all([cli('a', ['machines', 'list', '--json']), cli('b', ['machines', 'list', '--json'])]);
    const aToB = linkTo(listA, selfB.environmentId);
    const bToA = linkTo(listB, selfA.environmentId);
    const detail = `A->B ${aToB?.state ?? 'missing'} via ${aToB?.currentRoute ?? '-'}; B->A ${bToA?.state ?? 'missing'} via ${bToA?.currentRoute ?? '-'}`;
    if (aToB?.state === 'online' && bToA?.state === 'online') {
      log(detail);
      if (!aToB.currentRoute?.endsWith(`:${proxyPort}`)) throw new Error(`A reached B over ${aToB.currentRoute}, not the proxy route`);
      return { ok: true, value: detail };
    }
    return { ok: false, detail };
  }));

  await step('kill B', async () => {
    const child = running.servers.get('b');
    running.servers.delete('b');
    const exited = new Promise((done) => child.once('exit', done));
    child.kill('SIGKILL');
    await exited;
    const killedAt = Date.now();
    await pollUntil('A shows B offline', 30_000, async () => {
      const link = linkTo(await cli('a', ['machines', 'list', '--json']), selfB.environmentId);
      const detail = `A->B ${link?.state ?? 'missing'}${link?.stateDetail ? ` (${link.stateDetail})` : ''}`;
      if (link?.state === 'offline') {
        log(`${detail} after ${((Date.now() - killedAt) / 1000).toFixed(1)} s`);
        return { ok: true, value: detail };
      }
      return { ok: false, detail };
    });
  });

  await step('restart B', async () => {
    startServer('b', HOMES.b, PORT_B);
    await waitListening('b', PORT_B, 90_000);
    const upAt = Date.now();
    await pollUntil('A shows B online again', 60_000, async () => {
      const link = linkTo(await cli('a', ['machines', 'list', '--json']), selfB.environmentId);
      const detail = `A->B ${link?.state ?? 'missing'} via ${link?.currentRoute ?? '-'}${link?.incident ? ` incident ${link.incident.kind} ${link.incident.durationMs} ms` : ''}`;
      if (link?.state === 'online') {
        log(`${detail} after ${((Date.now() - upAt) / 1000).toFixed(1)} s`);
        return { ok: true, value: detail };
      }
      return { ok: false, detail };
    });
  });

  if (INJECT_PLAIN_HTTP) {
    await step('inject plain http', async () => {
      await fetch(`http://127.0.0.1:${proxyPort}/api/environment`).catch(() => undefined);
    });
  }

  await step('no-http', () => {
    const bytes = Buffer.concat(capture);
    const text = bytes.toString('latin1');
    const at = text.indexOf('HTTP/1.1');
    log(`proxy carried ${bytes.length} bytes across the pairing route`);
    if (at >= 0) throw new Error(`plain HTTP crossed the pairing route at byte ${at}: ${JSON.stringify(text.slice(Math.max(0, at - 40), at + 40))}`);
    if (bytes.length === 0) throw new Error('nothing crossed the proxy; the pairing route was not used');
    if (bytes[0] !== 0x00) throw new Error(`the first byte on the pairing route was 0x${bytes[0].toString(16)}, not the channel preamble 0x00`);
  });

  await step('stop', cleanup);
  log('OK: two dashboards linked, survived a restart, and spoke only the secure channel on the pairing route');
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  exitCode = 1;
  const step = error instanceof StepError ? error.step : 'unknown';
  console.error(`FAILED at step ${step}: ${error.message}`);
  console.error(`server logs: ${HOMES.a}/server.log and ${HOMES.b}/server.log`);
} finally {
  await cleanup().catch(() => undefined);
}
process.exit(exitCode);
