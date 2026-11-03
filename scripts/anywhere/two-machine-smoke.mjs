#!/usr/bin/env node
// two-machine-smoke.mjs — two dashboards on one host link over a secure channel (PAN-4645 WI-21, D-4645-22)
// and run Update all across both (PAN-4654 WI-10).
//
// Requires `npm run build` first (it runs dist/dashboard/server.js and dist/cli/index.js).
//
// What it does, in order (each step is named in the output; a failure prints
// "FAILED at step <name>: <why>" and exits 1):
//   1. fake-clis   fresh homes <repo>/.tmp/anywhere-a and .tmp/anywhere-b, each with a
//                  fake HOME (<home>/fakehome) and a fake npm prefix (<home>/npm) holding
//                  fake `claude` (2.1.0) and `codex` (0.150.0) and a fake `npm` that
//                  "installs" 2.1.5 and 0.159.0. The servers and CLIs run with that HOME,
//                  PATH=<home>/npm/bin:/usr/local/bin:/usr/bin:/bin and no SHELL, so the
//                  harness-binary fallbacks cannot find the operator's real CLIs. The
//                  servers run on a hard link to this Node at .tmp/anywhere-node/bin/node:
//                  the dashboard puts its Node's directory first on PATH (path-env.ts),
//                  and an nvm or npm-global bin directory also holds the real CLIs.
//   2. start       two servers, OVERDECK_HOME=.tmp/anywhere-a (port 3041) and
//                  .tmp/anywhere-b (port 3042), Deacon disabled, the link supervisor
//                  opted in (OVERDECK_ANYWHERE_SUPERVISOR=1).
//   3. proxy       a byte-logging TCP proxy on a free loopback port in front of B.
//   4. pair+link   `pan pair --url http://127.0.0.1:<proxy> --json` on B, then
//                  `pan machines link <url> --allow-loopback --json` on A, so A's pairing
//                  route (lan, source pairing, which outranks B's advertised lan routes)
//                  and its heartbeat cross the proxy. B's reverse link reaches A directly
//                  over A's advertised LAN address.
//   5. online      both `pan machines list --json` show the other machine online within 15 s.
//   6. versions    `pan machines versions --json` on A shows two rows, each with claude
//                  2.1.0 and codex 0.150.0. Guard: unless each row lists exactly claude and
//                  codex and both update commands point into .tmp/anywhere-, the script
//                  stops here and never runs Update all.
//   7. update-all  `pan machines update --json` on A; within 60 s both rows are `done` with
//                  claude 2.1.0 → 2.1.5 and codex 0.150.0 → 0.159.0. Overdeck is skipped
//                  (a development install), so no dashboard restarts.
//   PAN-4650 (conversations across machines), all through the proxied pairing route:
//      seed        B gets one local conversation (row, >2 MiB Claude JSONL, an image
//                  attachment, a vault index entry); A gets a vault-style saved copy of it.
//      list        A's GET /api/conversations lists @<B>/<name> once, carrying the saved copy.
//      open-budget opening it through A moves at most 1 MiB + 64 KiB from B to A.
//      image       its attachment fetched through A matches B's bytes.
//      tell-once   `pan tell @<B>/<name> … --message-id smoke1` twice gets the same answer
//                  (the seeded conversation has no live pane, so that answer is a failed delivery;
//                  remote-reply proves delivery),
//                  and the same id with other text is refused by B's receipt store.
//      released-409 with released_to set on B, a message through A answers 409 conversation-released.
//      forward     `pan machines forward <B> <port>` reaches a tiny HTTP server; B's dashboard
//                  port answers port-refused.
//      --live-claude adds remote-reply and pull (real Claude sessions; see liveClaudeSteps),
//                  runs with the real HOME and PATH, and skips versions and update-all.
//   PAN-4651 (work across machines), after the PAN-4650 steps:
//      load        A's `pan machines list --json` shows B's load sample and its tags
//                  (B's config.yaml sets anywhere.machine.tags: [smoke-tag]) within 20 s.
//      projects    B registers a project with github_repo smoke/repo (projects.yaml);
//                  A's GET /api/fleet/projects lists it under github.com/smoke/repo.
//      needs       POST /api/fleet/placement on A with needs [smoke-tag] picks B.
//      needs-docker B's fake `docker` exits 1, so B has no docker tag: placement with
//                  needs [docker] picks A, and `pan lane start --machine auto --needs docker`
//                  launches the lane on A; it is then stopped and reaped. Skipped (logged)
//                  when this host's own `docker info` fails (PAN-4774 WI-6).
//      compare     A's and B's resources.quality_gate_slots differ (2 vs 4): Compare
//                  settings lists that key with a copy line, and B's api_keys entry only
//                  as "set" (its value never reaches A).
//      usage       A's GET /api/fleet/usage lists both machines and All machines equals
//                  the sum of the rows.
//      mcp         an odk_ token minted on A lists B through list_machines, sees B's
//                  conversation in list_conversations, reaches it with send_message, and
//                  gets 403 on PUT /api/settings.
//      remote-worker `pan worker run --machine <B> --detach` on A (tmux backend, the fake
//                  claude) starts a worker on B through a stand-in; a report written on B
//                  is printed by `pan worker wait <localId>` on A.
//      worker-offline B is SIGSTOPped for 25 s during a wait; the wait keeps waiting and
//                  prints B's next report after SIGCONT.
//   PAN-4638 (gauntlet lanes across machines), after the PAN-4651 steps:
//      lane-remote `pan lane start --role play --machine <B> --json` on A, under a root
//                  conversation on A; the JSON names B. (B's projects.yaml puts the smoke
//                  project's lanes root under B's fake HOME, as the lane door requires.)
//      lane-report `pan lane report --status done` on B inside the lane; `pan lane wait <name>`
//                  on A exits 0 with the body within 20 s, and `pan lane list --json` on A
//                  lists the lane on B.
//      lane-nest   A's GET /api/conversations lists @<B>/<name> under A's root conversation
//                  (parentConversationId) with gauntletRun smoke.
//      lane-reap   `pan lane stop <name>`, then `pan lane reap <name>` on A exit 0; B's row
//                  is archived. The fake harness may or may not start on B; no step needs it.
//   8. kill B      A shows the link offline within 30 s.
//   9. restart B   A shows it online again within 60 s. B restarts with
//                  OVERDECK_TEST_FORCE_CPU_SATURATED=1 (the smoke hook machine-load.ts reads).
//      auto        once A sees B saturated, POST /api/fleet/placement on A picks A and its
//                  reason names A.
//  10. no-http     the proxy capture contains no "HTTP/1.1": everything that crossed
//                  the pairing route was the secure channel.
//  11. stop        both servers are stopped. Nothing outside .tmp/anywhere-a|b is touched.
//
// Usage:
//   node scripts/anywhere/two-machine-smoke.mjs
//   node scripts/anywhere/two-machine-smoke.mjs --inject-plain-http   # sends one plain HTTP
//        request through the proxy so step no-http must fail (checks the detector; exit 1).
//   node scripts/anywhere/two-machine-smoke.mjs --hold   # after no-http, keeps both servers
//        and B's dev server running (B restarted if it is down), prints
//        `HOLD a=<url> b=<url> dev=<port> conversation=@<B>/smoke-desk` for browser checks,
//        and cleans up on SIGINT or SIGTERM (exit 0). Servers start through
//        .tmp/anywhere-node/serve.js, a symlink to dist/dashboard/server.js, so the host's
//        orphan reaper (it matches dist/dashboard/server.js) leaves a held server alone.
//
// Not in CI (D-4645-22): it binds two LAN-visible ports for about two minutes.
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
const NODE_ROOT = resolve(repo, '.tmp', 'anywhere-node');
const NODE = resolve(NODE_ROOT, 'bin', 'node');
/**
 * --hold (PAN-4774 WI-7): the servers start through this symlink to SERVER, because the
 * host's orphan reaper matches `dist/dashboard/server.js` in a command line and would
 * kill a held server after 120 s.
 */
const SERVE = resolve(NODE_ROOT, 'serve.js');
const HOLD = process.argv.includes('--hold');
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

/** The fake CLIs of one smoke home (PAN-4654 WI-10): npm-installed claude and codex under <home>/npm. */
const FAKE_PACKAGES = [
  { pkg: '@anthropic-ai/claude-code', bin: 'claude', entry: 'bin/claude', banner: '$(cat "$dir/../VERSION") (Claude Code)', from: '2.1.0', to: '2.1.5' },
  { pkg: '@openai/codex', bin: 'codex', entry: 'bin/codex.js', banner: 'codex-cli $(cat "$dir/../VERSION")', from: '0.150.0', to: '0.159.0' },
];

function fakeClis(home) {
  const prefix = resolve(home, 'npm');
  mkdirSync(resolve(home, 'fakehome'), { recursive: true });
  mkdirSync(resolve(prefix, 'bin'), { recursive: true });
  const installCases = [];
  for (const fake of FAKE_PACKAGES) {
    const dir = resolve(prefix, 'lib', 'node_modules', fake.pkg);
    const entry = resolve(dir, fake.entry);
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(resolve(dir, 'VERSION'), `${fake.from}\n`);
    // A version probe prints the banner. Anything else (a worker pane, PAN-4651) runs a copy of
    // `sleep` named after the harness for 5 minutes, so the liveness oracle (which matches the
    // process name) sees a live harness.
    const runtime = resolve(dir, 'runtime', fake.bin);
    mkdirSync(dirname(runtime), { recursive: true });
    copyFileSync(['/usr/bin/sleep', '/bin/sleep'].find((path) => existsSync(path)), runtime);
    chmodSync(runtime, 0o755);
    writeFileSync(entry, `#!/bin/sh\ndir=$(dirname "$(readlink -f "$0")")\ncase "$1" in --version|-v|version) echo "${fake.banner}" ;; *) exec "$dir/../runtime/${fake.bin}" 300 ;; esac\n`, { mode: 0o755 });
    symlinkSync(entry, resolve(prefix, 'bin', fake.bin));
    installCases.push(`    ${fake.pkg}@latest) echo ${fake.to} > "$4/lib/node_modules/${fake.pkg}/VERSION" ;;`);
  }
  writeFileSync(resolve(prefix, 'bin', 'npm'), [
    '#!/bin/sh',
    `if [ "$1" = prefix ] && [ "$2" = -g ]; then echo "${prefix}"; exit 0; fi`,
    'if [ "$1" = install ] && [ "$2" = -g ] && [ "$3" = --prefix ]; then',
    '  case "$5" in',
    ...installCases,
    '    *) echo "fake npm: unknown package $5" >&2; exit 1 ;;',
    '  esac',
    '  exit 0',
    'fi',
    'echo "fake npm: unsupported $*" >&2',
    'exit 1',
    '',
  ].join('\n'), { mode: 0o755 });
  // PAN-4774 WI-6: B's `docker info` fails, so B carries no docker tag and needs-docker must pick A.
  if (home === HOMES.b && !LIVE_CLAUDE) writeFileSync(resolve(prefix, 'bin', 'docker'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
}

/**
 * The dashboard prepends dirname(process.execPath) to PATH (src/dashboard/server/path-env.ts).
 * When Node comes from an nvm or npm-global bin directory, that directory also holds the
 * operator's real claude, codex and others, which would outrank the fakes. A link to the
 * Node binary in an otherwise empty directory keeps them out of reach.
 */
function isolatedNode() {
  rmSync(NODE_ROOT, { recursive: true, force: true });
  mkdirSync(dirname(NODE), { recursive: true });
  try {
    linkSync(process.execPath, NODE);
  } catch {
    copyFileSync(process.execPath, NODE);
    chmodSync(NODE, 0o755);
  }
  symlinkSync(SERVER, SERVE);
}

function smokeTmuxSocket(home) {
  return home === HOMES.a ? 'pan-smoke-a' : 'pan-smoke-b';
}

/** Kill the smoke-only tmux servers (they hold worker panes); absent servers are fine. */
async function killSmokeTmux() {
  // --live-claude: the servers' tmux sockets are named from OVERDECK_HOME, so match the
  // config file under the smoke's short home links instead of a socket name.
  if (LIVE_CLAUDE) {
    await execFileAsync('pkill', ['-f', '/tmp/pan4650-smoke-[ab]/tmux/overdeck.tmux.conf']).catch(() => undefined);
    return;
  }
  await Promise.all(['pan-smoke-a', 'pan-smoke-b'].map((socket) => execFileAsync('tmux', ['-L', socket, 'kill-server']).catch(() => undefined)));
}

function serverEnv(home, port, extra = {}) {
  const env = { ...process.env };
  // Inherited values that would point the smoke servers or CLIs at the operator's dashboard.
  for (const key of ['OVERDECK_INTERNAL_TOKEN', 'OVERDECK_AGENT_ID', 'OVERDECK_DASHBOARD_SPAWNED_BY', 'DASHBOARD_URL', 'HOST']) delete env[key];
  // No SHELL: the harness-binary resolver's last fallback is `$SHELL -lc 'command -v <binary>'`,
  // which would find the operator's real CLIs, and Update all would then update them.
  delete env.SHELL;
  return {
    ...env,
    // A fake HOME and PATH (PAN-4654), so Update all only ever sees the smoke's fake CLIs and
    // the seeded Claude transcript never lands in the operator's ~/.claude. --live-claude keeps
    // the real HOME and PATH: Claude Code needs its login and binary (and skips Update all).
    ...(LIVE_CLAUDE ? {} : { HOME: resolve(home, 'fakehome'), PATH: `${resolve(home, 'npm', 'bin')}:/usr/local/bin:/usr/bin:/bin` }),
    // Live harnesses run on tmux: its socket name is derived from OVERDECK_HOME, so the
    // smoke's sessions never share the operator's server (each home would need its own
    // Herdr session server otherwise).
    // PAN-4651: the remote-worker step launches a worker pane on B too, on a smoke-only
    // tmux server (killed at start and in cleanup, so no pane outlives a run).
    OVERDECK_TERMINAL_BACKEND: 'tmux',
    ...(LIVE_CLAUDE ? {} : { OVERDECK_TMUX_SOCKET_NAME: smokeTmuxSocket(home) }),
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
    ...extra,
  };
}

function startServer(name, home, port, extra = {}) {
  const logFd = openSync(resolve(home, 'server.log'), 'a');
  const child = spawn(NODE, [SERVE], { env: serverEnv(home, port, extra), stdio: ['ignore', logFd, logFd] });
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
async function cliRaw(name, args, timeout = 60_000, extraEnv = {}) {
  const home = HOMES[name];
  const port = name === 'a' ? PORT_A : PORT_B;
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args], { env: { ...serverEnv(home, port), ...extraEnv }, timeout, maxBuffer: 4 * 1024 * 1024 });
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
  const home = LIVE_CLAUDE ? process.env.HOME : resolve(HOMES.b, 'fakehome');
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
    // The seeded conversation has no live pane, so the first answer is usually a failed delivery;
    // this step checks the replay, and --live-claude's remote-reply checks delivery.
    log(`repeat replayed the first answer (exit ${first.code}: ${(first.stdout || first.stderr).trim().split('\n')[0]}); other text refused by the receipt`);
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
    const devPort = await startDevServer();
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

/** The tiny dev server on B that `forward` (and a held pair's Open preview) reaches; started once. */
async function startDevServer() {
  if (!running.dev) {
    const dev = createHttpServer((_request, response) => response.end('hello from b'));
    await new Promise((done) => dev.listen(0, '127.0.0.1', done));
    running.dev = dev;
  }
  return running.dev.address().port;
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

// ─── PAN-4651: work across machines ────────────────────────────────────────

const SMOKE_ISSUE = 'SMK-1';
const SMOKE_ORIGIN = 'github.com/smoke/repo';

/** config.yaml for each machine: different gate slots (compare), B's tag and a secret (compare, needs). */
function machineConfigs() {
  writeFileSync(resolve(HOMES.a, 'config.yaml'), 'resources:\n  quality_gate_slots: 2\n');
  writeFileSync(resolve(HOMES.b, 'config.yaml'), [
    'resources:', '  quality_gate_slots: 4',
    'api_keys:', '  quantumllama: smoke-not-a-real-key',
    'anywhere:', '  machine:', '    tags: [smoke-tag]', '',
  ].join('\n'));
  // A holds the same repository, so a worker for SMK-1 resolves its git origin here.
  const projectA = resolve(HOMES.a, 'project');
  mkdirSync(projectA, { recursive: true });
  // A's lanes root sits under A's fake HOME, as the lane door requires (needs-docker runs a lane on A).
  writeFileSync(resolve(HOMES.a, 'projects.yaml'), projectsYaml(projectA, resolve(HOMES.a, 'fakehome', 'lanes')));
}

function projectsYaml(path, lanesRoot = null) {
  return [
    'projects:', '  smoke:', '    name: Smoke', `    path: ${path}`, '    github_repo: smoke/repo', '    issue_prefix: SMK',
    // PAN-4638: a lane directory must live under $HOME, which is the fake home here.
    ...(lanesRoot ? ['    gauntlet:', `      lanes_root: ${lanesRoot}`] : []),
    '',
  ].join('\n');
}

function internalToken(name) {
  return readFileSync(resolve(HOMES[name], 'internal-token'), 'utf8').trim();
}

/** A dashboard call on A with its internal token (fleet routes need a credential). */
async function apiA(method, path, body) {
  const response = await fetch(`http://127.0.0.1:${PORT_A}${path}`, {
    method,
    headers: { 'x-overdeck-internal-token': internalToken('a'), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

let mcpId = 0;
async function mcpTool(token, name, args = {}) {
  mcpId += 1;
  const response = await fetch(`http://127.0.0.1:${PORT_A}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: mcpId, method: 'tools/call', params: { name, arguments: args } }),
  });
  const json = await response.json();
  const result = json.result ?? {};
  return { isError: result.isError === true, text: result.content?.[0]?.text ?? JSON.stringify(json) };
}

async function fleetWorkSteps(selfA, selfB) {
  await step('load', () => pollUntil('A sees B\'s load and tags', 20_000, async () => {
    const link = linkTo(await cli('a', ['machines', 'list', '--json']), selfB.environmentId);
    const detail = `load ${JSON.stringify(link?.load ?? null)}, tags ${JSON.stringify(link?.tags ?? [])}`;
    if (link?.load && link.tags?.includes('smoke-tag')) {
      log(`A sees B: ${detail}`);
      return { ok: true, value: detail };
    }
    return { ok: false, detail };
  }));

  await step('projects', async () => {
    const projectB = SEED_CWD;
    mkdirSync(resolve(projectB, 'workspaces', `feature-${SMOKE_ISSUE.toLowerCase()}`), { recursive: true });
    writeFileSync(resolve(HOMES.b, 'projects.yaml'), projectsYaml(projectB, resolve(HOMES.b, 'fakehome', 'lanes')));
    await pollUntil(`A lists B under ${SMOKE_ORIGIN}`, 45_000, async () => {
      const { json } = await apiA('GET', '/api/fleet/projects');
      const row = json?.projects?.find((project) => project.gitOrigin?.toLowerCase() === SMOKE_ORIGIN);
      const onB = row?.machines?.some((machine) => machine.environmentId === selfB.environmentId);
      if (onB) log(`${SMOKE_ORIGIN}: local ${row.local?.key ?? 'none'}, machines ${row.machines.map((machine) => machine.label).join(', ')}`);
      return onB ? { ok: true, value: row } : { ok: false, detail: JSON.stringify(json?.projects ?? json) };
    });
  });

  await step('needs', async () => {
    const { status, json } = await apiA('POST', '/api/fleet/placement', { gitOrigin: null, needs: ['smoke-tag'] });
    if (status !== 200 || !json?.ok || json.environmentId !== selfB.environmentId) throw new Error(`placement answered ${status}: ${JSON.stringify(json)}`);
    log(`needs smoke-tag -> ${json.label}: ${json.reason}`);
  });

  await step('needs-docker', async () => {
    const hostDocker = await execFileAsync('docker', ['info'], { timeout: 10_000 }).then(() => true, () => false);
    if (!hostDocker) {
      log('needs-docker skipped: `docker info` fails on this host, so A has no docker tag either');
      return;
    }
    const bTags = linkTo(await cli('a', ['machines', 'list', '--json']), selfB.environmentId)?.tags ?? [];
    if (bTags.includes('docker')) throw new Error(`B carries a docker tag although its docker is the failing fake: ${JSON.stringify(bTags)}`);
    const { status, json } = await apiA('POST', '/api/fleet/placement', { gitOrigin: null, needs: ['docker'] });
    if (status !== 200 || !json?.ok || json.environmentId !== selfA.environmentId) throw new Error(`placement answered ${status}: ${JSON.stringify(json)}`);
    log(`needs docker -> ${json.label}: ${json.reason}`);
    const a = openDb('a');
    insertConversation(a, { name: DOCKER_LANE_ROOT, cwd: resolve(HOMES.a, 'project'), title: 'Smoke: docker orchestrator', status: 'active', origin: 'local', environmentId: null });
    a.close();
    const start = await cliRaw('a', ['lane', 'start', '--role', 'play', '--run', 'smoke-docker', '--key', 'docker', '--prompt', 'hi', '--parent', DOCKER_LANE_ROOT,
      '--project', 'smoke', '--model', 'claude-opus-5-5', '--harness', 'claude-code', '--machine', 'auto', '--needs', 'docker', '--no-wait', '--json'], 90_000);
    if (start.code !== 0) throw new Error(`pan lane start --machine auto --needs docker failed (${start.code}): ${start.stderr || start.stdout}`);
    const result = JSON.parse(start.stdout);
    // Auto that picks this machine launches a local lane: no machine in the answer, a cwd under A's lanes root.
    if (result.machine !== null || !String(result.cwd).startsWith(resolve(HOMES.a, 'fakehome', 'lanes'))) {
      throw new Error(`the docker lane did not run on A: ${start.stdout}`);
    }
    const lane = result.conversation.name;
    log(`lane ${lane} on A (machine auto, needs docker) in ${result.cwd}`);
    const stopped = await cliRaw('a', ['lane', 'stop', lane], 60_000);
    if (stopped.code !== 0) throw new Error(`pan lane stop ${lane} failed (${stopped.code}): ${stopped.stderr}`);
    await pollUntil(`pan lane reap ${lane} succeeds`, 30_000, async () => {
      const answer = await cliRaw('a', ['lane', 'reap', lane], 60_000);
      return answer.code === 0 ? { ok: true, value: answer } : { ok: false, detail: answer.stderr.trim() };
    });
    log(`stopped and reaped ${lane}`);
  });

  await step('compare', async () => {
    const { status, json } = await apiA('GET', `/api/fleet/settings-compare/${encodeURIComponent(selfB.environmentId)}`);
    if (status !== 200) throw new Error(`compare answered ${status}: ${JSON.stringify(json)}`);
    const relevant = json.differences.filter((row) => row.key.startsWith('resources.') || row.key.startsWith('api_keys.'));
    const slots = relevant.find((row) => row.key === 'resources.quality_gate_slots');
    if (relevant.filter((row) => !row.key.startsWith('api_keys.')).length !== 1 || slots?.copyLine !== 'pan admin config set resources.quality_gate_slots 2') {
      throw new Error(`expected one quality_gate_slots difference with its copy line, got ${JSON.stringify(relevant)}`);
    }
    const secret = relevant.find((row) => row.key === 'api_keys.quantumllama');
    if (!secret || JSON.stringify(secret.there) !== JSON.stringify({ secret: true, set: true }) || secret.copyLine !== null) throw new Error(`secret row wrong: ${JSON.stringify(secret)}`);
    if (JSON.stringify(json).includes('smoke-not-a-real-key')) throw new Error('a secret value reached A');
    log(`compare: ${json.differences.length} difference(s); ${slots.copyLine}`);
  });

  await step('usage', async () => {
    const { status, json } = await apiA('GET', '/api/fleet/usage');
    if (status !== 200 || json.machines.length !== 2) throw new Error(`usage answered ${status}: ${JSON.stringify(json)}`);
    for (const window of ['today', 'week', 'month']) {
      const sum = json.machines.reduce((total, row) => total + (row[window]?.totalCost ?? 0), 0);
      if (Math.abs(sum - json.allMachines[window].totalCost) > 1e-9) throw new Error(`${window}: All machines ${json.allMachines[window].totalCost} != sum ${sum}`);
    }
    log(`usage rows: ${json.machines.map((row) => `${row.label}${row.cached ? ' (cached)' : ''} $${row.month?.totalCost ?? 'n/a'}`).join(', ')}`);
  });

  await step('mcp', async () => {
    const { token } = await cli('a', ['token', 'create', 'smoke-mcp', '--scopes', 'read:state,read:conversations,tell', '--json']);
    // The dashboard reads the token registry every 5 s (ACCESS_TOKEN_REFRESH_MS).
    const listed = await pollUntil('A accepts the new token', 15_000, async () => {
      const answer = await mcpTool(token, 'list_machines');
      return answer.isError || !answer.text.startsWith('[') ? { ok: false, detail: answer.text.slice(0, 200) } : { ok: true, value: answer };
    });
    const machines = JSON.parse(listed.text);
    if (!Array.isArray(machines)) throw new Error(`list_machines answered ${listed.text}`);
    if (!machines.some((machine) => machine.environmentId === selfB.environmentId)) throw new Error(`list_machines missed B: ${listed.text}`);
    const linkedName = `@${selfB.environmentId}/${SEED.name}`;
    const rows = JSON.parse((await mcpTool(token, 'list_conversations', { limit: 200 })).text);
    if (!rows.some((row) => row.name === linkedName)) throw new Error(`list_conversations missed ${linkedName}`);
    const sent = await mcpTool(token, 'send_message', { conversation: linkedName, message: 'smoke via mcp' });
    if (/insufficient_scope|no-chained-hops|no-link/.test(sent.text)) throw new Error(`send_message did not reach B: ${sent.text}`);
    const settings = await fetch(`http://127.0.0.1:${PORT_A}/api/settings`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
    if (settings.status !== 403) throw new Error(`PUT /api/settings answered ${settings.status}, not 403`);
    log(`mcp: B listed, ${linkedName} reached (${sent.isError ? 'owner answered an error' : 'delivered'}: ${sent.text.slice(0, 80)}), settings 403`);
  });

  const worker = await step('remote-worker', async () => {
    // By environment id: both smoke dashboards run on one host, so they share its label.
    const run = await cliRaw('a', ['worker', 'run', '--machine', selfB.environmentId, '--issue', SMOKE_ISSUE, '--prompt', 'smoke brief', '--read-only',
      '--parent', 'conv-smoke', '--harness', 'claude-code', '--model', 'claude-opus-5-5', '--ignore-unpushed', '--detach'], 120_000);
    if (run.code !== 0) throw new Error(`pan worker run --machine failed (${run.code}): ${run.stderr || run.stdout}`);
    const localId = run.stdout.trim().split('\n').pop();
    const standIn = JSON.parse(readFileSync(resolve(HOMES.a, 'agents', localId, 'remote.json'), 'utf8'));
    log(`stand-in ${localId} for ${standIn.remoteId} on ${standIn.label}`);
    await reportOnB(standIn.remoteId, 'smoke report one');
    const wait = await cliRaw('a', ['worker', 'wait', localId, '--timeout', '60'], 90_000);
    if (wait.code !== 0 || !wait.stdout.includes('smoke report one')) throw new Error(`wait on the stand-in answered ${wait.code}: ${wait.stdout} ${wait.stderr}`);
    log(`A printed B's report: ${wait.stdout.trim()}`);
    return { localId, remoteId: standIn.remoteId };
  });

  await step('worker-offline', async () => {
    const waiting = cliRaw('a', ['worker', 'wait', worker.localId, '--after', '1', '--timeout', '150'], 180_000);
    const b = running.servers.get('b');
    await sleep(2_000);
    b.kill('SIGSTOP');
    log('B stopped (SIGSTOP) for 25 s');
    await sleep(25_000);
    b.kill('SIGCONT');
    log('B continued (SIGCONT)');
    await reportOnB(worker.remoteId, 'smoke report two');
    const wait = await waiting;
    if (wait.code !== 0 || !wait.stdout.includes('smoke report two')) throw new Error(`the wait across B's pause answered ${wait.code}: ${wait.stdout} ${wait.stderr}`);
    log('the wait survived B\'s pause and printed report two');
    // Stop B's worker through the fleet route (the stand-in's owner), so no pane outlives the smoke.
    const stopped = await apiA('POST', `/api/fleet/workers/${encodeURIComponent(worker.localId)}/stop`, {});
    if (stopped.status !== 200) throw new Error(`stopping the remote worker answered ${stopped.status}: ${JSON.stringify(stopped.json)}`);
    log(`stopped ${worker.remoteId} on B through the fleet route`);
  });
}

async function reportOnB(remoteId, body) {
  const file = resolve(HOMES.b, `${remoteId}-report.md`);
  writeFileSync(file, `${body}\n`);
  const report = await cliRaw('b', ['worker', 'report', remoteId, '--file', file]);
  if (report.code !== 0) throw new Error(`pan worker report on B failed: ${report.stderr}`);
}

// ─── PAN-4638: gauntlet lanes across machines ──────────────────────────────

const LANE_ROOT = 'smoke-orch';
const DOCKER_LANE_ROOT = 'smoke-orch-docker';

async function laneSteps(selfB) {
  const lane = await step('lane-remote', async () => {
    const a = openDb('a');
    insertConversation(a, { name: LANE_ROOT, cwd: resolve(HOMES.a, 'project'), title: 'Smoke: orchestrator', status: 'active', origin: 'local', environmentId: null });
    a.close();
    // By environment id: both smoke dashboards run on one host, so they share its label.
    const start = await cliRaw('a', ['lane', 'start', '--role', 'play', '--run', 'smoke', '--key', 'smoke', '--prompt', 'hi', '--parent', LANE_ROOT,
      '--project', 'smoke', '--model', 'claude-opus-5-5', '--harness', 'claude-code', '--machine', selfB.environmentId, '--no-wait', '--json'], 90_000);
    if (start.code !== 0) throw new Error(`pan lane start --machine failed (${start.code}): ${start.stderr || start.stdout}`);
    const result = JSON.parse(start.stdout);
    if (result.machine?.environmentId !== selfB.environmentId || result.machine?.label !== selfB.label || result.conversation?.id !== null) {
      throw new Error(`the launch did not name B: ${start.stdout}`);
    }
    log(`lane ${result.conversation.name} on ${result.machine.label} in ${result.cwd}`);
    return result.conversation.name;
  });

  await step('lane-report', async () => {
    const file = resolve(HOMES.b, `${lane}-report.md`);
    writeFileSync(file, 'smoke lane report\n');
    const report = await cliRaw('b', ['lane', 'report', '--file', file, '--status', 'done'], 60_000, { OVERDECK_CONVERSATION: `conv-${lane}` });
    if (report.code !== 0) throw new Error(`pan lane report on B failed (${report.code}): ${report.stderr}`);
    const wait = await cliRaw('a', ['lane', 'wait', lane, '--timeout', '20'], 40_000);
    if (wait.code !== 0 || !wait.stdout.includes('smoke lane report')) throw new Error(`pan lane wait on A answered ${wait.code}: ${wait.stdout} ${wait.stderr}`);
    const listed = JSON.parse((await cliRaw('a', ['lane', 'list', '--run', 'smoke', '--json'])).stdout);
    const row = listed.find((entry) => entry.name === lane);
    if (row?.machine?.environmentId !== selfB.environmentId) throw new Error(`pan lane list on A does not list ${lane} on B: ${JSON.stringify(listed)}`);
    log(`A printed B's lane report; pan lane list shows ${lane} on ${row.machine.label} (${row.activity})`);
  });

  await step('lane-nest', () => pollUntil(`A nests @${selfB.environmentId}/${lane} under ${LANE_ROOT}`, 45_000, async () => {
    const rows = JSON.parse((await getA('/api/conversations?limit=200')).body.toString('utf8'));
    const list = Array.isArray(rows) ? rows : (rows.conversations ?? []);
    const root = list.find((row) => row.name === LANE_ROOT);
    const linked = list.find((row) => row.name === `@${selfB.environmentId}/${lane}`);
    const detail = `root ${root?.id ?? 'missing'}, linked parent ${linked?.parentConversationId ?? 'missing'}, run ${linked?.gauntletRun ?? 'missing'}`;
    if (root && linked?.parentConversationId === root.id && linked.gauntletRun === 'smoke') {
      log(detail);
      return { ok: true, value: detail };
    }
    return { ok: false, detail };
  }));

  await step('lane-reap', async () => {
    const stopped = await cliRaw('a', ['lane', 'stop', lane], 60_000);
    if (stopped.code !== 0) throw new Error(`pan lane stop on A failed (${stopped.code}): ${stopped.stderr}`);
    // The fake harness may still be exiting in the lane directory; reap refuses while a process runs there.
    const reaped = await pollUntil(`pan lane reap ${lane} succeeds`, 30_000, async () => {
      const answer = await cliRaw('a', ['lane', 'reap', lane], 60_000);
      return answer.code === 0 ? { ok: true, value: answer } : { ok: false, detail: answer.stderr.trim() };
    });
    const b = openDb('b');
    const archived = b.prepare('SELECT archived_at FROM conversations WHERE name = ?').get(lane)?.archived_at ?? null;
    b.close();
    if (archived === null) throw new Error(`B's row for ${lane} is not archived after the reap`);
    if (!existsSync(resolve(HOMES.a, 'remote-lanes', lane, 'archived.json'))) throw new Error(`A did not archive the stand-in of ${lane}`);
    log(`${reaped.stdout.trim()}; B archived the row, A archived the stand-in`);
  });
}

async function autoStep(selfA, selfB) {
  await step('auto', async () => {
    await pollUntil('A sees B saturated', 40_000, async () => {
      const link = linkTo(await cli('a', ['machines', 'list', '--json']), selfB.environmentId);
      return link?.load?.cpuSaturated ? { ok: true, value: link.load } : { ok: false, detail: JSON.stringify(link?.load ?? null) };
    });
    const { status, json } = await apiA('POST', '/api/fleet/placement', { gitOrigin: null, needs: [] });
    if (status !== 200 || !json?.ok || json.environmentId !== selfA.environmentId || !json.reason.includes(selfA.label)) {
      throw new Error(`Auto did not pick A: ${status} ${JSON.stringify(json)}`);
    }
    log(`${json.reason}; rejected ${json.rejections.map((rejection) => `${rejection.label}: ${rejection.reason}`).join('; ')}`);
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
  await killSmokeTmux();
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

  await step('fake-clis', async () => {
    await killSmokeTmux();
    isolatedNode();
    for (const home of [HOMES.a, HOMES.b]) {
      freshHome(home);
      fakeClis(home);
    }
    machineConfigs();
  });

  await step('start', async () => {
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

  // --live-claude runs with the real CLIs on PATH, so the Update all guard would refuse.
  if (!LIVE_CLAUDE) await step('versions', async () => {
    const { rows } = await cli('a', ['machines', 'versions', '--json']);
    if (rows.length !== 2) throw new Error(`expected two rows, got ${rows.length}`);
    for (const row of rows) {
      const clis = row.report?.harnesses ?? [];
      // Guard: Update all runs only against the fake CLIs inside the smoke homes.
      const binaries = clis.map((entry) => entry.binary).join(',');
      if (binaries !== 'claude,codex') throw new Error(`${row.label} lists ${binaries || 'no CLIs'}, not exactly claude,codex; refusing to run Update all`);
      const outside = clis.find((entry) => !entry.command.includes('.tmp/anywhere-'));
      if (outside) throw new Error(`${row.label}'s ${outside.binary} would run "${outside.command}", outside the smoke homes; refusing to run Update all`);
      const versions = clis.map((entry) => `${entry.binary} ${entry.version}`).join(', ');
      if (versions !== 'claude 2.1.0, codex 0.150.0') throw new Error(`${row.label} reports ${versions}`);
      log(`${row.label}: Overdeck ${row.report.overdeck.version} (${row.report.overdeck.installMode}), ${versions}`);
    }
  });

  if (!LIVE_CLAUDE) await step('update-all', async () => {
    const result = await cli('a', ['machines', 'update', '--json']);
    log(`started on ${result.started.map((entry) => entry.label).join(', ') || 'none'}; skipped ${result.skipped.map((entry) => `${entry.label} (${entry.reason})`).join(', ') || 'none'}`);
    if (result.started.length !== 2) throw new Error(`Update all started on ${result.started.length} machines, not 2`);
    const changed = (job, name) => {
      const component = job?.components.find((entry) => entry.name === name);
      return component ? `${component.before} → ${component.after} (${component.status})` : 'missing';
    };
    await pollUntil('both machines updated', 60_000, async () => {
      const { rows } = await cli('a', ['machines', 'versions', '--json']);
      const states = rows.map((row) => {
        const job = row.report?.job ?? null;
        return { label: row.label, phase: job?.phase ?? 'none', claude: changed(job, 'claude'), codex: changed(job, 'codex'), overdeck: job?.components.find((entry) => entry.name === 'overdeck')?.status ?? 'missing' };
      });
      const detail = states.map((state) => `${state.label} ${state.phase}: claude ${state.claude}, codex ${state.codex}, overdeck ${state.overdeck}`).join('; ');
      const ok = states.length === 2 && states.every((state) => state.phase === 'done'
        && state.claude === '2.1.0 → 2.1.5 (updated)' && state.codex === '0.150.0 → 0.159.0 (updated)' && state.overdeck === 'skipped');
      if (ok) log(detail);
      return ok ? { ok: true, value: detail } : { ok: false, detail };
    });
  });

  await conversationSteps(selfB);
  if (!LIVE_CLAUDE) await fleetWorkSteps(selfA, selfB);
  if (!LIVE_CLAUDE) await laneSteps(selfB);

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
    // PAN-4651: B comes back reporting a saturated CPU, so Auto must avoid it (step auto).
    startServer('b', HOMES.b, PORT_B, LIVE_CLAUDE ? {} : { OVERDECK_TEST_FORCE_CPU_SATURATED: '1' });
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

  if (!LIVE_CLAUDE) await autoStep(selfA, selfB);

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

  if (HOLD) {
    await step('hold', async () => {
      if (!running.servers.has('b')) {
        startServer('b', HOMES.b, PORT_B);
        await waitListening('b', PORT_B, 90_000);
      }
      const devPort = await startDevServer();
      console.log(`HOLD a=http://127.0.0.1:${PORT_A} b=http://127.0.0.1:${PORT_B} dev=${devPort} conversation=@${selfB.environmentId}/${SEED.name}`);
      await new Promise((done) => {
        process.once('SIGINT', done);
        process.once('SIGTERM', done);
      });
      log('hold released by a signal');
    });
  }

  await step('stop', cleanup);
  const updated = LIVE_CLAUDE ? 'shared and pulled a live conversation' : 'updated both machines\' CLIs with Update all';
  log(`OK: two dashboards linked, ${updated}, survived a restart, and spoke only the secure channel on the pairing route`);
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
