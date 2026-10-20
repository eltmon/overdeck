/**
 * Protocol fixture recorder (PAN-4563). Dev script, never imported by
 * production code.
 *
 *   node --import tsx src/lib/protocol-capture/record.ts \
 *     --harness <codex|acp> --scenario <name> --out <path> [--model <id>] [--effort <level>] [--note <text>]
 *
 * It drives the real host classes through one named scenario with capture on,
 * against a live `codex app-server` or `kimi acp` session, and writes one
 * `overdeck-protocol-capture/1` fixture. After the scenario's terminal event
 * it keeps capturing until no frame has moved in either direction for 2 s, so
 * frames that arrive after the turn boundary stay in the fixture.
 * See docs/PROTOCOL-REPLAY-TESTS.md.
 */
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

import * as NodeServices from '@effect/platform-node/NodeServices';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Scope from 'effect/Scope';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';

import { AcpHost } from '../acp/host.js';
import { resolveAcpProviderSupport } from '../acp/providers.js';
import { CodexAppServerHost } from '../codex/app-server-host.js';
import { CodexAppServerManager, type AppServerMessage } from '../codex/app-server-manager.js';
import { initCodexHome } from '../runtimes/codex.js';
import { acpCaptureProtocolLogging } from './acp-logging.js';
import { createProtocolCaptureSink, type ProtocolCaptureSink } from './capture.js';
import { defaultScrubContext } from './scrub.js';

const execFileAsync = promisify(execFile);

export const RECORD_TIMEOUT_MS = 300_000;
export const QUIET_GAP_MS = 2_000;
const EXIT_WAIT_MS = 5_000;
const EXIT_LOG_GRACE_MS = 500;

type Harness = 'codex' | 'acp';

interface Scenario {
  harness: Harness;
  name: string;
  prompt: string;
  actions: string;
}

const COUNT_PROMPT = 'Count from 1 to 400, one number per line, with no other text.';
/** Outside the workspace and outside /tmp, so the workspace-write sandbox asks before writing it. */
const APPROVAL_PROBE = join(homedir(), `.overdeck-approval-probe-${process.pid}.txt`);

export const SCENARIOS: readonly Scenario[] = [
  { harness: 'codex', name: 'turn-idle', prompt: 'Reply with exactly OK.', actions: 'none' },
  {
    harness: 'codex',
    name: 'interrupt',
    prompt: COUNT_PROMPT,
    actions: 'interrupt on the first owner item/* notification after the owner turn/started',
  },
  {
    harness: 'codex',
    name: 'subagent',
    prompt: 'Use your spawn_agent tool to start exactly one sub-agent with the task "Reply with exactly PONG.", wait for it to finish, then reply with exactly DONE.',
    actions: 'none (accept any approval)',
  },
  {
    harness: 'codex',
    name: 'approval',
    // A blocked-network curl fails in the sandbox without asking (codex 0.159.0),
    // and /tmp is writable there; a write under $HOME asks for approval.
    prompt: `Run this exact shell command and nothing else: printf hi > ${APPROVAL_PROBE}`,
    actions: 'accept each */requestApproval request (deletes the probe file afterwards)',
  },
  {
    harness: 'codex',
    name: 'user-input',
    prompt: 'Before doing anything else, use your request_user_input tool to ask me one question: which color do I prefer, with the options red and blue. Then reply with exactly the color I chose.',
    actions: "answer item/tool/requestUserInput with each question's first option",
  },
  { harness: 'acp', name: 'turn-completion', prompt: 'Reply with exactly OK.', actions: 'none' },
  { harness: 'acp', name: 'interrupt', prompt: COUNT_PROMPT, actions: 'interrupt on the first [assistant] pane line' },
];

const DEFAULTS: Record<Harness, { model: string; effort: string }> = {
  codex: { model: 'gpt-5.6-luna', effort: 'low' },
  // K3 refuses to launch without an effort level (resolveKimiNativeEffort).
  acp: { model: 'k3', effort: 'low' },
};

export function scenarioTable(): string {
  const rows = SCENARIOS.map(scenario => `  ${scenario.harness.padEnd(6)} ${scenario.name.padEnd(16)} ${scenario.actions}`);
  return [
    'Usage: node --import tsx src/lib/protocol-capture/record.ts --harness <codex|acp> --scenario <name> --out <path> [--model <id>] [--effort <level>] [--note <text>]',
    '',
    'Scenarios:',
    `  ${'HARNESS'.padEnd(6)} ${'SCENARIO'.padEnd(16)} SCRIPTED ACTIONS`,
    ...rows,
    '',
    `Defaults: codex ${DEFAULTS.codex.model} effort ${DEFAULTS.codex.effort}; acp (kimi) ${DEFAULTS.acp.model} effort ${DEFAULTS.acp.effort}.`,
  ].join('\n');
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** A sink that remembers when the last frame moved, for the quiet-gap end. */
function trackActivity(sink: ProtocolCaptureSink): { sink: ProtocolCaptureSink; lastFrameAt: () => number } {
  let last = Date.now();
  const touch = () => {
    last = Date.now();
  };
  return {
    lastFrameAt: () => last,
    sink: {
      path: sink.path,
      setHeader: fields => sink.setHeader(fields),
      recordMessage: (dir, message) => {
        touch();
        sink.recordMessage(dir, message);
      },
      recordText: (dir, line) => {
        touch();
        sink.recordText(dir, line);
      },
      recordChunk: (dir, chunk) => {
        touch();
        sink.recordChunk(dir, chunk);
      },
      close: () => sink.close(),
    },
  };
}

async function waitForQuietGap(lastFrameAt: () => number): Promise<void> {
  for (;;) {
    const idle = Date.now() - lastFrameAt();
    if (idle >= QUIET_GAP_MS) return;
    await new Promise(resolveWait => setTimeout(resolveWait, QUIET_GAP_MS - idle));
  }
}

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${RECORD_TIMEOUT_MS / 1000} s`)), RECORD_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

interface RecordInput {
  scenario: Scenario;
  out: string;
  model: string;
  effort: string;
  /** Provenance written to the fixture header, e.g. a non-default model backend. */
  note: string | undefined;
  cwd: string;
  overdeckHome: string;
}

async function recordCodex(input: RecordInput, tempDirs: string[]): Promise<void> {
  const { scenario, model, effort, cwd, overdeckHome } = input;
  const codexHome = await mkdtemp(join(tmpdir(), 'pan-capture-codex-'));
  tempDirs.push(codexHome);
  initCodexHome(codexHome, { effort, trustedDir: cwd });
  if (scenario.name === 'user-input') {
    await appendFile(join(codexHome, 'config.toml'), '\n[features]\ndefault_mode_request_user_input = true\n');
  }

  const tracked = trackActivity(createProtocolCaptureSink({
    path: input.out,
    harness: 'codex-app-server',
    scrub: defaultScrubContext({ cwd, codexHome, overdeckHome, home: homedir() }),
  }));
  tracked.sink.setHeader({
    scenario: scenario.name,
    hostOptions: { model, effort, prompt: scenario.prompt },
    ...(input.note ? { note: input.note } : {}),
  });

  const manager = new CodexAppServerManager({ cwd, codexHome, protocolCapture: tracked.sink });
  const host = new CodexAppServerHost({
    agentId: 'agent-capture',
    cwd,
    overdeckHome,
    manager,
    model,
    effort,
    stdout: process.stdout,
    recordActivity: () => true,
  });

  const isOwner = (message: AppServerMessage) => {
    const params = asRecord(message.params);
    const threadId = typeof params.threadId === 'string' ? params.threadId : asRecord(params.thread).id;
    return threadId === undefined || threadId === manager.getState().threadId;
  };
  let ownerTurnStarted = false;
  let interrupted = false;
  const turnDone = new Promise<void>((resolveTurn, rejectTurn) => {
    manager.on('notification', (message: AppServerMessage) => {
      if (!isOwner(message)) return;
      if (message.method === 'turn/started') ownerTurnStarted = true;
      if (scenario.name === 'interrupt' && ownerTurnStarted && !interrupted && message.method?.startsWith('item/')) {
        interrupted = true;
        void host.handleOp({ op: 'interrupt' });
      }
      if (message.method === 'turn/completed') resolveTurn();
    });
    manager.on('exit', () => rejectTurn(new Error('codex app-server exited before the owner turn completed')));
  });
  manager.on('request', (request: AppServerMessage) => {
    // Let the host record the pending request before it is answered.
    setImmediate(() => {
      const method = request.method ?? '';
      if (/requestApproval/.test(method)) {
        void host.handleOp({ op: 'approval', requestId: request.id, decision: 'accept' });
      } else if (method === 'item/tool/requestUserInput') {
        const questions = Array.isArray(asRecord(request.params).questions) ? asRecord(request.params).questions as unknown[] : [];
        const answers = Object.fromEntries(questions.map((question) => {
          const record = asRecord(question);
          const first = Array.isArray(record.options) ? asRecord(record.options[0]).label : undefined;
          return [String(record.id), typeof first === 'string' ? [first] : []];
        }));
        void host.handleOp({ op: 'user-input', requestId: request.id, answers });
      }
    });
  });

  const exited = once(manager, 'exit');
  try {
    await manager.start();
    const sent = await host.handleOp({ op: 'message', content: scenario.prompt });
    if (sent.status !== 200) throw new Error(`message op failed: ${JSON.stringify(sent.body)}`);
    await withTimeout(turnDone, `codex scenario ${scenario.name}`);
    await waitForQuietGap(tracked.lastFrameAt);
  } finally {
    await host.stop();
    await tracked.sink.close();
    // The host logs the app-server exit into the temp Overdeck home; let that
    // write land before the temp dirs are removed, or it recreates them.
    await Promise.race([exited, new Promise(resolveWait => setTimeout(resolveWait, EXIT_WAIT_MS))]);
    await new Promise(resolveWait => setTimeout(resolveWait, EXIT_LOG_GRACE_MS));
  }
}

async function kimiVersion(): Promise<string | null> {
  const { stdout } = await execFileAsync('kimi', ['--version'], { timeout: 10_000 });
  return stdout.match(/\d+\.\d+\.\d+\S*/)?.[0] ?? (stdout.trim() || null);
}

async function recordAcp(input: RecordInput): Promise<void> {
  const { scenario, model, effort, cwd, overdeckHome } = input;
  const tracked = trackActivity(createProtocolCaptureSink({
    path: input.out,
    harness: 'acp',
    scrub: defaultScrubContext({ cwd, overdeckHome, home: homedir() }),
  }));
  tracked.sink.setHeader({
    provider: 'kimi',
    cliVersion: await kimiVersion(),
    scenario: scenario.name,
    hostOptions: { model, effort, prompt: scenario.prompt },
    ...(input.note ? { note: input.note } : {}),
  });

  const scope = await Effect.runPromise(Scope.make());
  let scopeClosed = false;
  const closeScope = async () => {
    if (scopeClosed) return;
    scopeClosed = true;
    await Effect.runPromise(Scope.close(scope, Exit.void));
  };
  let host: AcpHost | undefined;
  try {
    const runtime = await Effect.runPromise(
      Effect.gen(function* () {
        const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        return yield* resolveAcpProviderSupport('kimi').makeRuntime({
          childProcessSpawner,
          cwd,
          kimiSettings: { binaryPath: 'kimi' },
          binaryPath: 'kimi',
          clientInfo: { name: 'overdeck', version: 'capture' },
          environment: process.env,
          protocolLogging: acpCaptureProtocolLogging(tracked.sink),
        });
      }).pipe(Effect.provideService(Scope.Scope, scope), Effect.provide(NodeServices.layer)),
    );

    let interrupted = false;
    let buffer = '';
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        process.stdout.write(chunk);
        buffer += String(chunk);
        for (;;) {
          const newline = buffer.indexOf('\n');
          if (newline < 0) break;
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (scenario.name === 'interrupt' && !interrupted && line.startsWith('[assistant]')) {
            interrupted = true;
            void host?.handleOp({ op: 'interrupt' });
          }
        }
        callback();
      },
    });
    host = new AcpHost({
      agentId: 'agent-capture',
      provider: 'kimi',
      workspace: cwd,
      model,
      effort,
      overdeckHome,
      runtime,
      stdout,
      disposeRuntime: closeScope,
    });
    await host.start();
    const sent = await host.handleOp({ op: 'message', content: scenario.prompt });
    if (sent.status !== 202) throw new Error(`message op failed: ${JSON.stringify(sent.body)}`);
    await withTimeout(host.waitForIdle(), `acp scenario ${scenario.name}`);
    await waitForQuietGap(tracked.lastFrameAt);
  } finally {
    if (host) await host.stop();
    await closeScope();
    await tracked.sink.close();
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        harness: { type: 'string' },
        scenario: { type: 'string' },
        out: { type: 'string' },
        model: { type: 'string' },
        effort: { type: 'string' },
        note: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${scenarioTable()}\n`);
    return 2;
  }
  if (values.help) {
    process.stdout.write(`${scenarioTable()}\n`);
    return 0;
  }
  const scenario = SCENARIOS.find(entry => entry.harness === values.harness && entry.name === values.scenario);
  if (!scenario) {
    process.stderr.write(`Unknown harness/scenario: ${String(values.harness)} ${String(values.scenario)}\n\n${scenarioTable()}\n`);
    return 2;
  }
  if (typeof values.out !== 'string' || !values.out) {
    process.stderr.write(`--out <path> is required\n\n${scenarioTable()}\n`);
    return 2;
  }

  const harness = scenario.harness;
  const tempDirs: string[] = [];
  const out = resolve(values.out);
  try {
    const cwd = await mkdtemp(join(tmpdir(), 'pan-capture-cwd-'));
    tempDirs.push(cwd);
    const overdeckHome = await mkdtemp(join(tmpdir(), 'pan-capture-home-'));
    tempDirs.push(overdeckHome);
    const input: RecordInput = {
      scenario,
      out,
      model: typeof values.model === 'string' ? values.model : DEFAULTS[harness].model,
      effort: typeof values.effort === 'string' ? values.effort : DEFAULTS[harness].effort,
      note: typeof values.note === 'string' && values.note ? values.note : undefined,
      cwd,
      overdeckHome,
    };
    const recorders: Record<Harness, () => Promise<void>> = {
      codex: () => recordCodex(input, tempDirs),
      acp: () => recordAcp(input),
    };
    await recorders[harness]();
    process.stderr.write(`[record] wrote ${input.out}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`[record] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    // A failed run leaves a partial fixture; never let it be committed by accident.
    await rm(out, { force: true });
    return 1;
  } finally {
    // The provider child gets SIGTERM without a wait and may still be writing
    // into its temp home; rm retries ENOTEMPTY/EBUSY.
    for (const dir of tempDirs) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    if (scenario.name === 'approval') await rm(APPROVAL_PROBE, { force: true });
  }
}

if (basename(fileURLToPath(import.meta.url)) === basename(process.argv[1] ?? '')) {
  main().then(
    code => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
