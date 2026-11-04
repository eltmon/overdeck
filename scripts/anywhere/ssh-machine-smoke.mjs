#!/usr/bin/env node
// ssh-machine-smoke.mjs — add, use and remove an SSH machine end to end (PAN-4404 WI-13).
//
// Requires `npm run build` first (it runs dist/dashboard/server.js and dist/cli/index.js).
// It never touches the operator's dashboard, sshd or Docker: `ssh` is
// scripts/anywhere/fake-ssh.mjs, installed as .tmp/ssh-smoke/bin/ssh and put first on
// dashboard A's PATH, and the "remote" is dashboard B with its own home.
//
// What it does, in order (each step is named in the output; a failure prints
// "FAILED at step <name>: <why>" and exits 1):
//   1. start       B = the "remote": OVERDECK_HOME=<repo>/.tmp/ssh-smoke/remote, port 3062,
//                  Deacon disabled, the link supervisor opted in; writes remote/bin/pan,
//                  a wrapper for `node dist/cli/index.js`. Once B listens, the smoke writes
//                  remote/config.toml with dashboard.api_port = 3062, so the helper finds B.
//                  (Written after boot: a peer dashboard from a workspace checkout refuses
//                  to bind the port its own config.toml names as the host dashboard port.
//                  A real host runs a primary dashboard and has no such guard.)
//   2. start A     A = the linking machine: OVERDECK_HOME=.tmp/ssh-smoke/local, port 3061,
//                  the supervisor opted in, PATH=.tmp/ssh-smoke/bin:$PATH.
//   3. add-ssh     `pan machines add-ssh fake-remote --pan-path <abs>/remote/bin/pan --json`
//                  against A: the view has ssh.launch "external" (B was already running)
//                  and a route of kind ssh.
//   4. online      `pan machines list --json` on A shows the link online within 15 s.
//   5. unlink      `pan machines unlink <link id> --json` on A: ssh.reason is "external",
//                  and B still answers /api/health. (By link id: A and B run on one host,
//                  so both carry the hostname as their label.)
//   6. stop        A and B are stopped. Nothing outside .tmp/ssh-smoke is touched.
//
// The managed path (`pan up` on the remote) is not exercised: `pan up` starts shared
// sidecars (supervisor port 3012, CLIProxy) that would collide with the live machine.
// The WI-4 unit tests cover it.
//
// Usage:
//   node scripts/anywhere/ssh-machine-smoke.mjs
//   node scripts/anywhere/ssh-machine-smoke.mjs --serve   # stop after step 2, print A's URL and
//        keep A and B running until Ctrl-C, for a browser check (Add an SSH machine, host
//        fake-remote, Advanced: the printed pan path).
import { execFile, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = resolve(repo, 'dist', 'dashboard', 'server.js');
const CLI = resolve(repo, 'dist', 'cli', 'index.js');
const FAKE_SSH = resolve(repo, 'scripts', 'anywhere', 'fake-ssh.mjs');
const ROOT = resolve(repo, '.tmp', 'ssh-smoke');
const BIN = resolve(ROOT, 'bin');
const HOMES = { a: resolve(ROOT, 'local'), b: resolve(ROOT, 'remote') };
const PORTS = { a: 3061, b: 3062 };
const REMOTE_PAN = resolve(HOMES.b, 'bin', 'pan');
const SERVE = process.argv.includes('--serve');

const started = Date.now();
const log = (line) => console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(6)} s] ${line}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Live servers, stopped on exit whatever happens. */
const running = new Map();

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

function freshRoot() {
  // Only ever the smoke directory; refuse anything else so a bad edit cannot widen this.
  if (!/\/\.tmp\/ssh-smoke$/.test(ROOT)) throw new Error(`refusing to reset ${ROOT}`);
  rmSync(ROOT, { recursive: true, force: true });
  for (const dir of [BIN, HOMES.a, resolve(HOMES.b, 'bin')]) mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(BIN, 'ssh'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_SSH}" "$@"\n`);
  chmodSync(resolve(BIN, 'ssh'), 0o755);
  writeFileSync(REMOTE_PAN, `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
  chmodSync(REMOTE_PAN, 0o755);
}

function serverEnv(name) {
  const env = { ...process.env };
  // Inherited values that would point the smoke servers or CLIs at the operator's dashboard.
  for (const key of ['OVERDECK_INTERNAL_TOKEN', 'OVERDECK_AGENT_ID', 'OVERDECK_DASHBOARD_SPAWNED_BY', 'DASHBOARD_URL', 'HOST']) delete env[key];
  const port = PORTS[name];
  return {
    ...env,
    ...(name === 'a' ? { PATH: `${BIN}:${env.PATH ?? ''}`, FAKE_SSH_REMOTE_HOME: HOMES.b } : {}),
    OVERDECK_HOME: HOMES[name],
    API_PORT: String(port),
    PORT: String(port),
    OVERDECK_DASHBOARD_URL: `http://127.0.0.1:${port}`,
    DASHBOARD_URL: `http://127.0.0.1:${port}`,
    // Peer-mode dashboards with the link supervisor opted back in (PAN-4645 D-4645-21);
    // on A that also starts the SSH forward supervisor.
    OVERDECK_DISABLE_DEACON: '1',
    OVERDECK_ANYWHERE_SUPERVISOR: '1',
    OVERDECK_NO_RESUME: '1',
  };
}

function startServer(name) {
  const logFd = openSync(resolve(HOMES[name], 'server.log'), 'a');
  const child = spawn(process.execPath, [SERVER], { env: serverEnv(name), stdio: ['ignore', logFd, logFd] });
  running.set(name, child);
  child.on('exit', (code, signal) => {
    if (running.get(name) === child) running.delete(name);
    log(`server ${name} exited (code ${code}, signal ${signal})`);
  });
}

async function health(port) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: controller.signal }).finally(() => clearTimeout(timer));
    return response.status;
  } catch {
    return null;
  }
}

async function waitListening(name, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!running.has(name)) throw new Error(`server ${name} exited before listening; see ${HOMES[name]}/server.log`);
    const status = await health(PORTS[name]);
    if (status !== null && status < 500) return;
    await sleep(250);
  }
  throw new Error(`server ${name} did not answer on :${PORTS[name]} within ${timeoutMs} ms; see ${HOMES[name]}/server.log`);
}

async function stopServer(name) {
  const child = running.get(name);
  if (!child) return;
  running.delete(name);
  const exited = new Promise((done) => child.once('exit', done));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timer);
}

async function cli(name, args, timeoutMs = 30_000) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [CLI, ...args], { env: serverEnv(name), timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }));
  } catch (error) {
    throw new Error(`pan ${args.join(' ')} failed: ${(error.stderr || error.stdout || error.message).trim()}`);
  }
  const line = stdout.trim().split('\n').filter((candidate) => candidate.startsWith('{')).pop();
  if (!line) throw new Error(`pan ${args.join(' ')} printed no JSON:\n${stdout}`);
  return JSON.parse(line);
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

async function cleanup() {
  await Promise.all([...running.keys()].map((name) => stopServer(name)));
}

async function main() {
  if (!existsSync(SERVER) || !existsSync(CLI)) {
    throw new StepError('preflight', `missing ${SERVER} or ${CLI}; run npm run build first`);
  }

  await step('start', async () => {
    freshRoot();
    startServer('b');
    await waitListening('b', 90_000);
    writeFileSync(resolve(HOMES.b, 'config.toml'), `[dashboard]\napi_port = ${PORTS.b}\n`);
    log(`B (the remote) listening on :${PORTS.b} (home ${HOMES.b}); pan on it: ${REMOTE_PAN}`);
  });

  await step('start A', async () => {
    startServer('a');
    await waitListening('a', 90_000);
    log(`A listening on :${PORTS.a} (home ${HOMES.a}); ssh = ${resolve(BIN, 'ssh')}`);
  });

  if (SERVE) {
    log(`serving: open http://127.0.0.1:${PORTS.a}/ → Settings → Anywhere → Machines → Add an SSH machine`);
    log(`host: fake-remote; Advanced → Path to pan on the host: ${REMOTE_PAN}. Ctrl-C stops A and B.`);
    await new Promise((done) => {
      process.once('SIGINT', done);
      process.once('SIGTERM', done);
    });
    await step('stop', cleanup);
    return;
  }

  const view = await step('add-ssh', async () => {
    const added = await cli('a', ['machines', 'add-ssh', 'fake-remote', '--pan-path', REMOTE_PAN, '--json'], 220_000);
    log(`A linked ${added.label} (${added.fingerprint}): ${JSON.stringify(added.ssh)}; routes ${added.routes.map((r) => `${r.kind}:${r.url}`).join(', ')}`);
    if (added.ssh?.launch !== 'external') throw new Error(`expected ssh.launch external, got ${JSON.stringify(added.ssh)}`);
    if (!added.routes.some((route) => route.kind === 'ssh' && route.url === `tcp://127.0.0.1:${added.ssh.localPort}`)) {
      throw new Error(`no ssh route on tcp://127.0.0.1:${added.ssh.localPort}`);
    }
    return added;
  });

  await step('online', () => pollUntil('the SSH link online', 15_000, async () => {
    const list = await cli('a', ['machines', 'list', '--json']);
    const link = list.links.find((entry) => entry.id === view.id);
    const detail = `${link?.state ?? 'missing'} via ${link?.currentRoute ?? '-'}; forward ${link?.ssh?.forward ?? '-'}`;
    if (link?.state === 'online') {
      log(detail);
      return { ok: true, value: detail };
    }
    return { ok: false, detail };
  }));

  await step('unlink', async () => {
    const result = await cli('a', ['machines', 'unlink', view.id, '--json'], 90_000);
    log(`unlink answered ${JSON.stringify(result)}`);
    if (result.ssh?.reason !== 'external') throw new Error(`expected ssh.reason external, got ${JSON.stringify(result.ssh)}`);
    const status = await health(PORTS.b);
    if (status !== 200) throw new Error(`B stopped answering /api/health (status ${status}) after the unlink`);
    log('B still answers /api/health');
  });

  await step('stop', cleanup);
  log('OK: an SSH machine was added over a forwarded ssh route, came online, and was removed without stopping its server');
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
