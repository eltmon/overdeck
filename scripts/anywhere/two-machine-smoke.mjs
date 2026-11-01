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
//   PAN-4650 (conversations across machines), all through the proxied pairing route:
//      seed        B gets one local conversation (row, >2 MiB Claude JSONL, an image
//                  attachment, a vault index entry); A gets a vault-style saved copy of it.
//      list        A's GET /api/conversations lists @<B>/<name> once, carrying the saved copy.
//      open-budget opening it through A moves at most 1 MiB + 64 KiB from B to A.
//      image       its attachment fetched through A matches B's bytes.
//      tell-once   `pan tell @<B>/<name> … --message-id smoke1` twice gets the same answer,
//                  and the same id with other text is refused by B's receipt store.
//      released-409 with released_to set on B, a message through A answers 409 conversation-released.
//      forward     `pan machines forward <B> <port>` reaches a tiny HTTP server; B's dashboard
//                  port answers port-refused.
//      --live-claude adds remote-reply and pull (real Claude sessions; see liveClaudeSteps).
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
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
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
const LIVE_CLAUDE = process.argv.includes('--live-claude');
/** NFR-3: an open moves at most 1 MiB + 64 KiB. */
const OPEN_BUDGET_BYTES = 1_114_112;
const SEED = { name: 'smoke-desk', sessionId: '6f1c4650-0000-4000-8000-000000000001', vaultId: '6f1c4650-0000-4000-8000-0000000000aa' };
const SEED_CWD = resolve(HOMES.b, 'project');
/**
 * --live-claude: a harness's PTY supervisor socket lives under OVERDECK_HOME, and the
 * smoke homes are too deep for the 107-byte Unix socket limit. Live servers use these
 * short symlinks to the same homes (created at start, removed at cleanup).
 */
const LIVE_HOME_LINKS = { a: '/tmp/pan4650-smoke-a', b: '/tmp/pan4650-smoke-b' };

const started = Date.now();
const log = (line) => console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(6)} s] ${line}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Bytes B sent through the proxy (to A), for the open budget. */
const fromB = { bytes: 0 };

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
    // A home of their own, so the seeded Claude transcript never lands in the operator's
    // ~/.claude. --live-claude keeps the real HOME: Claude Code needs its login there.
    ...(LIVE_CLAUDE ? {} : { HOME: resolve(home, 'home') }),
    // Live harnesses run on tmux: its socket name is derived from OVERDECK_HOME, so the
    // smoke's sessions never share the operator's server (each home would need its own
    // Herdr session server otherwise).
    ...(LIVE_CLAUDE ? { OVERDECK_TERMINAL_BACKEND: 'tmux' } : {}),
    OVERDECK_HOME: LIVE_CLAUDE ? LIVE_HOME_LINKS[home === HOMES.a ? 'a' : 'b'] : home,
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

/** `pan` with its exit code, stdout and stderr (never throws on a non-zero exit). */
async function cliRaw(name, args, timeout = 60_000) {
  const home = HOMES[name];
  const port = name === 'a' ? PORT_A : PORT_B;
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args], { env: serverEnv(home, port), timeout, maxBuffer: 4 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? String(error.message) };
  }
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
      upstream.on('data', (chunk) => { capture.push(chunk); fromB.bytes += chunk.length; client.write(chunk); });
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

// ─── PAN-4650: conversations across machines ───────────────────────────────

/** Claude Code's project directory for a cwd (every character but letters, digits and '-' becomes '-'). */
function claudeProjectDir(home, cwd) {
  return resolve(home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9-]/g, '-'));
}

/** Where B's seeded transcript lives; refuse anything but the smoke project's directory. */
function seedTranscriptPath() {
  const home = LIVE_CLAUDE ? process.env.HOME : resolve(HOMES.b, 'home');
  const dir = claudeProjectDir(home, SEED_CWD);
  if (!/-tmp-anywhere-b-project$/.test(dir)) throw new Error(`refusing transcript dir ${dir}`);
  return { dir, file: resolve(dir, `${SEED.sessionId}.jsonl`) };
}

/** A Claude JSONL of more than 2 MiB: 300 turns of 8 KiB text. */
function seedTranscript() {
  const lines = [];
  const filler = 'lorem ipsum dolor sit amet '.repeat(300);
  for (let turn = 0; turn < 300; turn++) {
    const at = new Date(Date.UTC(2026, 10, 1, 10, 0, turn)).toISOString();
    lines.push(JSON.stringify({ type: 'user', uuid: randomUUID(), sessionId: SEED.sessionId, cwd: SEED_CWD, timestamp: at, message: { role: 'user', content: `turn ${turn}: ${filler}` } }));
    lines.push(JSON.stringify({ type: 'assistant', uuid: randomUUID(), sessionId: SEED.sessionId, cwd: SEED_CWD, timestamp: at, message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: `answer ${turn}: ${filler}` }] } }));
  }
  return `${lines.join('\n')}\n`;
}

function openDb(name) {
  const db = new DatabaseSync(resolve(HOMES[name], 'overdeck.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

function insertConversation(db, row) {
  db.prepare(`INSERT INTO conversations (id, name, cwd, harness, title, created_at, tmux_session, status, origin, vault_owner_label, environment_id, ended_at)
    VALUES (?, ?, ?, 'claude-code', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), row.name, row.cwd, row.title, Date.now(), `conv-${row.name}`, row.status, row.origin, row.ownerLabel ?? null, row.environmentId, row.status === 'ended' ? Date.now() : null);
}

async function seedConversations(selfB) {
  mkdirSync(SEED_CWD, { recursive: true });
  const transcript = seedTranscriptPath();
  mkdirSync(transcript.dir, { recursive: true });
  writeFileSync(transcript.file, seedTranscript());
  // A 1x1 PNG in B's attachments folder for the conversation.
  const attachmentDir = resolve(HOMES.b, 'conversation-attachments', SEED.name);
  mkdirSync(attachmentDir, { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  writeFileSync(resolve(attachmentDir, 'shot.png'), png);
  // B settles this transcript into vault record SEED.vaultId, so its shared row names it.
  mkdirSync(resolve(HOMES.b, 'vault'), { recursive: true });
  writeFileSync(resolve(HOMES.b, 'vault', 'index.json'), JSON.stringify({
    v: 1, owned: { [transcript.file]: { vaultId: SEED.vaultId, harness: 'claude-code', tail: { lineCount: 0, byteOffset: 0, lastHashes: [] } } }, listCache: [],
  }));
  const b = openDb('b');
  insertConversation(b, { name: SEED.name, cwd: SEED_CWD, title: 'Smoke: desk conversation', status: 'active', origin: 'local', environmentId: selfB.environmentId });
  const id = b.prepare('SELECT id FROM conversations WHERE name = ?').get(SEED.name).id;
  b.prepare("INSERT INTO conversation_files (conversation_id, harness, locator, created_at) VALUES (?, 'claude-code', ?, ?)").run(id, SEED.sessionId, Date.now());
  b.close();
  // A holds a Session Vault saved copy of the same record (FR-2: listed once).
  const a = openDb('a');
  insertConversation(a, { name: `vault-${SEED.vaultId}`, cwd: SEED_CWD, title: 'Smoke: desk conversation', status: 'ended', origin: 'vault', ownerLabel: 'b', environmentId: selfB.environmentId });
  a.close();
  return { png, transcriptBytes: Buffer.byteLength(seedTranscript()) };
}

async function getA(path) {
  const response = await fetch(`http://127.0.0.1:${PORT_A}${path}`);
  return { status: response.status, body: Buffer.from(await response.arrayBuffer()), type: response.headers.get('content-type') };
}

async function postA(path, body) {
  const response = await fetch(`http://127.0.0.1:${PORT_A}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${PORT_A}` }, body: JSON.stringify(body) });
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function conversationSteps(selfB) {
  const linkedName = `@${selfB.environmentId}/${SEED.name}`;
  const linkedPath = `/api/conversations/${encodeURIComponent(linkedName)}`;
  const seeded = await step('seed', () => seedConversations(selfB));
  log(`B transcript ${seeded.transcriptBytes} bytes; A holds saved copy vault-${SEED.vaultId}`);

  await step('list', () => pollUntil(`A lists ${linkedName}`, 45_000, async () => {
    const rows = JSON.parse((await getA('/api/conversations')).body.toString());
    const linked = rows.filter((row) => row.name === linkedName);
    const copies = rows.filter((row) => row.name === `vault-${SEED.vaultId}`);
    const detail = `${linked.length} linked row(s), ${copies.length} saved-copy row(s)`;
    if (linked.length !== 1) return { ok: false, detail };
    if (copies.length !== 0 || linked[0].savedCopyName !== `vault-${SEED.vaultId}`) throw new Error(`not one row per conversation: ${detail}, savedCopyName ${linked[0].savedCopyName}`);
    log(`${linkedName} listed once (machine ${linked[0].machineLabel}, ${linked[0].machineState}, saved copy ${linked[0].savedCopyName})`);
    return { ok: true, value: linked[0] };
  }));

  await step('open-budget', async () => {
    const before = fromB.bytes;
    const opened = await getA(`${linkedPath}/messages`);
    const moved = fromB.bytes - before;
    if (opened.status !== 200) throw new Error(`open answered ${opened.status}: ${opened.body.toString().slice(0, 200)}`);
    log(`open moved ${moved} bytes B->A (budget ${OPEN_BUDGET_BYTES}; transcript ${seeded.transcriptBytes})`);
    if (moved > OPEN_BUDGET_BYTES) throw new Error(`open moved ${moved} bytes, over the ${OPEN_BUDGET_BYTES}-byte budget`);
    if (moved === 0) throw new Error('nothing crossed the proxy; the open did not use the pairing route');
  });

  await step('image', async () => {
    const image = await getA(`${linkedPath}/attachments/shot.png`);
    if (image.status !== 200 || !image.body.equals(seeded.png)) throw new Error(`attachment answered ${image.status} with ${image.body.length} bytes (${image.type})`);
    log(`attachment matched B's ${seeded.png.length} bytes (${image.type})`);
  });

  await step('tell-once', async () => {
    const target = linkedName;
    const first = await cliRaw('a', ['tell', target, 'smoke hello', '--message-id', 'smoke1']);
    const second = await cliRaw('a', ['tell', target, 'smoke hello', '--message-id', 'smoke1']);
    if (first.code !== second.code || first.stdout !== second.stdout || first.stderr !== second.stderr) {
      throw new Error(`a repeated id got a different answer: ${JSON.stringify([first, second])}`);
    }
    const other = await cliRaw('a', ['tell', target, 'different text', '--message-id', 'smoke1']);
    if (!/belongs to a different send/.test(other.stderr)) throw new Error(`B's receipt store did not hold smoke1: ${other.stderr || other.stdout}`);
    log(`repeat answered the same (exit ${first.code}: ${(first.stdout || first.stderr).trim().split('\n')[0]}); other text refused by the receipt`);
  });

  await step('released-409', async () => {
    const b = openDb('b');
    b.prepare('UPDATE conversations SET released_to = ? WHERE name = ?').run('env-elsewhere', SEED.name);
    b.close();
    const answer = await postA(`${linkedPath}/message`, { message: 'after release', clientMessageId: 'smoke-released' });
    if (answer.status !== 409 || answer.json?.code !== 'conversation-released') throw new Error(`answered ${answer.status} ${JSON.stringify(answer.json)}`);
    const b2 = openDb('b');
    b2.prepare('UPDATE conversations SET released_to = NULL WHERE name = ?').run(SEED.name);
    b2.close();
    log(`409 conversation-released: ${answer.json.error}`);
  });

  await step('forward', async () => {
    const dev = createHttpServer((_request, response) => response.end('hello from b'));
    await new Promise((done) => dev.listen(0, '127.0.0.1', done));
    running.dev = dev;
    const devPort = dev.address().port;
    const forward = await cli('a', ['machines', 'forward', selfB.environmentId, String(devPort), '--json']);
    const body = await (await fetch(forward.url)).text();
    if (body !== 'hello from b') throw new Error(`forward ${forward.url} answered ${JSON.stringify(body)}`);
    log(`forward b:${devPort} -> ${forward.url} relayed the page`);
    await cliRaw('a', ['machines', 'forward', '--stop', forward.id]);
    const refused = await cliRaw('a', ['machines', 'forward', selfB.environmentId, String(PORT_B)]);
    if (refused.code === 0 || !/cannot be forwarded|port-refused/.test(refused.stderr)) throw new Error(`a forward to B's dashboard port was not refused: ${refused.stderr || refused.stdout}`);
    log(`a forward to B's dashboard port :${PORT_B} was refused`);
  });

  if (LIVE_CLAUDE) await liveClaudeSteps(selfB);
}

/**
 * --live-claude: a real Claude Code conversation on B. `remote-reply` sends from A and
 * waits for the assistant's answer on A; `pull` makes an uncommitted change in its
 * checkout, pulls it to A with `pan conv pull`, and checks B now refuses messages.
 * Costs real model usage and starts a real harness session.
 */
async function liveClaudeSteps(selfB) {
  const liveCwd = resolve(HOMES.b, 'live-project');
  const git = (...args) => execFileAsync('git', args, { cwd: liveCwd });
  let linkedName = '';
  let ownerName = '';

  await step('remote-reply', async () => {
    mkdirSync(liveCwd, { recursive: true });
    writeFileSync(resolve(liveCwd, 'README.md'), 'smoke\n');
    await git('init', '-q');
    await git('-c', 'user.email=smoke@overdeck.invalid', '-c', 'user.name=smoke', 'commit', '-q', '--allow-empty', '-m', 'init');
    await git('add', 'README.md');
    await git('-c', 'user.email=smoke@overdeck.invalid', '-c', 'user.name=smoke', 'commit', '-q', '-m', 'readme');
    // A conversation with a cwd needs a registered project on B.
    writeFileSync(resolve(HOMES.b, 'projects.yaml'), `projects:\n  smoke:\n    name: smoke\n    path: ${liveCwd}\n`);
    const created = await fetch(`http://127.0.0.1:${PORT_B}/api/conversations`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${PORT_B}` },
      body: JSON.stringify({ message: 'Answer with one short line: hello.', cwd: liveCwd, projectKey: 'smoke' }),
    });
    const conv = await created.json();
    if (!created.ok || !conv?.name) throw new Error(`B could not start a conversation: ${created.status} ${JSON.stringify(conv)}`);
    ownerName = conv.name;
    linkedName = `@${selfB.environmentId}/${ownerName}`;
    await pollUntil(`A lists ${linkedName}`, 90_000, async () => {
      const rows = JSON.parse((await getA('/api/conversations')).body.toString());
      return rows.some((row) => row.name === linkedName) ? { ok: true, value: true } : { ok: false, detail: 'not listed yet' };
    });
    // The answer (9300) never appears in the question, so finding it proves the reply came back.
    const sent = await postA(`/api/conversations/${encodeURIComponent(linkedName)}/message`, { message: 'What is 4650 doubled? Answer with the number only.', clientMessageId: 'smoke-live-1' });
    if (sent.status >= 400) throw new Error(`send through A answered ${sent.status} ${JSON.stringify(sent.json)}`);
    await pollUntil('the reply on A', 240_000, async () => {
      const page = await getA(`/api/conversations/${encodeURIComponent(linkedName)}/messages`);
      return page.body.toString().includes('9300') ? { ok: true, value: true } : { ok: false, detail: `status ${page.status}` };
    });
    log(`${linkedName} answered through A`);
  });

  await step('pull', async () => {
    writeFileSync(resolve(liveCwd, 'uncommitted.txt'), 'pulled with the conversation\n');
    const pulled = await cliRaw('a', ['conv', 'pull', linkedName, '--stop-turn', '--json'], 35 * 60_000);
    const job = JSON.parse(pulled.stdout.trim().split('\n').filter((line) => line.startsWith('{')).pop() ?? '{}');
    if (pulled.code !== 0 || job.state !== 'done') throw new Error(`pan conv pull failed: ${pulled.stderr || pulled.stdout}`);
    const a = openDb('a');
    const row = a.prepare('SELECT cwd FROM conversations WHERE name = ?').get(job.conversation.name);
    a.close();
    if (!row || readFileSync(resolve(row.cwd, 'uncommitted.txt'), 'utf8') !== 'pulled with the conversation\n') {
      throw new Error(`the uncommitted change is not in A's checkout ${row?.cwd}`);
    }
    const refused = await fetch(`http://127.0.0.1:${PORT_B}/api/conversations/${encodeURIComponent(ownerName)}/message`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${PORT_B}` }, body: JSON.stringify({ message: 'still there?' }),
    });
    const body = await refused.json().catch(() => null);
    if (refused.status !== 409 || body?.code !== 'conversation-released') throw new Error(`B answered ${refused.status} ${JSON.stringify(body)} after the pull`);
    log(`pulled to A as ${job.conversation.name} (cwd ${row.cwd}); B answers 409 conversation-released`);
    // Leave no Claude session running behind the smoke.
    await fetch(`http://127.0.0.1:${PORT_A}/api/conversations/${encodeURIComponent(job.conversation.name)}/stop`, { method: 'POST', headers: { origin: `http://127.0.0.1:${PORT_A}` } }).catch(() => undefined);
  });
}

async function cleanup() {
  for (const socket of running.proxySockets) socket.destroy();
  running.proxySockets.clear();
  if (running.proxy) await new Promise((done) => running.proxy.close(() => done()));
  running.proxy = null;
  if (running.dev) await new Promise((done) => running.dev.close(() => done()));
  running.dev = null;
  await Promise.all([...running.servers.keys()].map((name) => stopServer(name)));
  // After the servers stop, so neither recreates a home under a removed link.
  // --live-claude seeds into the real ~/.claude; remove only the smoke project's directory.
  if (LIVE_CLAUDE) {
    rmSync('/tmp/pan4650-smoke-a', { force: true });
    rmSync('/tmp/pan4650-smoke-b', { force: true });
    const { dir } = seedTranscriptPath();
    if (/-tmp-anywhere-b-project$/.test(dir)) rmSync(dir, { recursive: true, force: true });
    // The live conversation's own transcripts (B's run, and A's after the pull).
    const liveDir = claudeProjectDir(process.env.HOME, resolve(HOMES.b, 'live-project'));
    if (/-tmp-anywhere-b-live-project$/.test(liveDir)) rmSync(liveDir, { recursive: true, force: true });
  }
}

async function main() {
  if (!existsSync(SERVER) || !existsSync(CLI)) {
    throw new StepError('preflight', `missing ${SERVER} or ${CLI}; run npm run build first`);
  }
  const capture = [];

  await step('start', async () => {
    freshHome(HOMES.a);
    freshHome(HOMES.b);
    // A live harness's PTY supervisor puts its socket here; a fresh home has none yet.
    if (LIVE_CLAUDE) {
      for (const name of ['a', 'b']) {
        mkdirSync(resolve(HOMES[name], 'sockets'), { recursive: true });
        rmSync(LIVE_HOME_LINKS[name], { force: true });
        symlinkSync(HOMES[name], LIVE_HOME_LINKS[name]);
      }
    }
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

  await conversationSteps(selfB);

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
