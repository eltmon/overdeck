/**
 * `pan worker run | wait | report | list` (PAN-3920 W14, FR-10, FR-11, D17).
 *
 * `run` starts a registered worker (a native agent with role `worker`) for an
 * issue and blocks until it reports, dies, idles out, or hits the deadline.
 * The report body goes to stdout; every status line goes to stderr. Exit codes:
 *
 *   0  report with status `done`
 *   4  report with status `blocked` or `failed` (body still printed)
 *   2  the worker exited, or sat idle, without a report
 *   3  timeout (the worker is still running)
 *   1  usage or spawn error
 */
import { access, readFile } from 'node:fs/promises';

import type { Command } from 'commander';
import { Effect } from 'effect';

import { exitCli } from '../exit.js';
import { resolveIssueIdSync } from '../../lib/issue-id.js';
import type { RuntimeName } from '../../lib/runtimes/types.js';
import { isAlive as livenessIsAlive, isConfirmedDead, type LivenessVerdict } from '../../lib/agents/liveness.js';
import {
  PARENT_ID_RE,
  WORKER_ID_RE,
  isWorkerReportStatus,
  listWorkers,
  startWorker,
  waitForWorkerReport,
  workerDir,
  writeWorkerReport,
  type StartWorkerOptions,
  type StartedWorker,
  type WaitOptions,
  type WaitOutcome,
  type WorkerListing,
  type WorkerReportStatus,
} from '../../lib/agents/worker/index.js';

export const WORKER_EXIT = { done: 0, usage: 1, noReport: 2, timeout: 3, blocked: 4 } as const;

const HARNESSES: readonly RuntimeName[] = ['claude-code', 'codex', 'acp', 'kimi-code', 'opencode', 'muse'];

export interface WorkerCliDeps {
  startWorker: (options: StartWorkerOptions) => Promise<StartedWorker>;
  waitForWorkerReport: (id: string, options: WaitOptions) => Promise<WaitOutcome>;
  writeWorkerReport: (id: string, report: { body: string; status?: WorkerReportStatus }) => Promise<number>;
  listWorkers: (filter: { issueId?: string; parentId?: string }) => Promise<WorkerListing[]>;
  isAlive: (id: string) => Promise<LivenessVerdict>;
  stopWorker: (id: string) => Promise<void>;
  workerExists: (id: string) => Promise<boolean>;
  readFile: (path: string) => Promise<string>;
  readStdin: () => Promise<string>;
  stdinIsTTY: () => boolean;
  env: NodeJS.ProcessEnv;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
}

export function defaultWorkerCliDeps(): WorkerCliDeps {
  return {
    startWorker: (options) => startWorker(options),
    waitForWorkerReport: (id, options) => waitForWorkerReport(id, options),
    writeWorkerReport: (id, report) => writeWorkerReport(id, report),
    listWorkers: (filter) => listWorkers(filter),
    isAlive: (id) => livenessIsAlive(id),
    stopWorker: async (id) => {
      const { stopAgent } = await import('../../lib/agents/termination.js');
      await Effect.runPromise(stopAgent(id, 'operator'));
    },
    workerExists: (id) => access(workerDir(id)).then(() => true, () => false),
    readFile: (path) => readFile(path, 'utf8'),
    readStdin: readAllStdin,
    stdinIsTTY: () => Boolean(process.stdin.isTTY),
    env: process.env,
    stdout: (text) => { process.stdout.write(text.endsWith('\n') ? text : `${text}\n`); },
    stderr: (text) => { process.stderr.write(text.endsWith('\n') ? text : `${text}\n`); },
  };
}

function parseSeconds(raw: string | undefined, flag: string, deps: WorkerCliDeps): number | null | 'invalid' {
  if (raw === undefined) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    deps.stderr(`${flag} must be a positive number of seconds; got ${raw}.`);
    return 'invalid';
  }
  return seconds * 1000;
}

/**
 * Parent resolution (Q3): `--parent`, then `OVERDECK_AGENT_ID`, then
 * `OVERDECK_CONVERSATION`. With none, an agent (non-TTY stdin) is refused;
 * an interactive operator shell may run a parentless worker.
 */
export function resolveWorkerParent(
  explicit: string | undefined,
  env: NodeJS.ProcessEnv,
): string | null {
  const candidate = explicit ?? env.OVERDECK_AGENT_ID ?? env.OVERDECK_CONVERSATION;
  return candidate?.trim() ? candidate.trim() : null;
}

export const MISSING_PARENT_MESSAGE =
  'Cannot tell which conversation or agent is spawning this worker. Pass --parent <conversation-or-agent-id>.';

/** Print a wait outcome per D17 and return the exit code. */
export function reportOutcome(id: string, outcome: WaitOutcome, deps: Pick<WorkerCliDeps, 'stdout' | 'stderr'>): number {
  switch (outcome.kind) {
    case 'report': {
      deps.stdout(outcome.report.body);
      deps.stderr(`worker ${id} report ${outcome.report.seq}: ${outcome.report.status}`);
      return outcome.report.status === 'done' ? WORKER_EXIT.done : WORKER_EXIT.blocked;
    }
    case 'exited-without-report':
    case 'idle-without-report': {
      if (outcome.lastAssistantMessage !== null) {
        deps.stdout(`[no report — last assistant message]\n${outcome.lastAssistantMessage}`);
      } else {
        deps.stdout(`[no report — transcript: ${outcome.transcriptPath ?? 'not found'}]`);
      }
      deps.stderr(outcome.kind === 'exited-without-report'
        ? `worker ${id} exited without a report`
        : `worker ${id} is idle without a report and is still running; follow up with pan tell ${id} "<message>", then pan worker wait ${id}`);
      return WORKER_EXIT.noReport;
    }
    case 'timeout':
      deps.stderr(`worker ${id} is still running; run: pan worker wait ${id}`);
      return WORKER_EXIT.timeout;
  }
}

export interface WorkerRunOptions {
  issue?: string;
  prompt?: string;
  brief?: string;
  model?: string;
  harness?: string;
  readOnly?: boolean;
  cwd?: string;
  parent?: string;
  name?: string;
  detach?: boolean;
  timeout?: string;
  stopAfterReport?: boolean;
}

export async function workerRunCommand(options: WorkerRunOptions, deps: WorkerCliDeps): Promise<number> {
  if (!options.issue) {
    deps.stderr('--issue is required: a worker belongs to an issue.');
    return WORKER_EXIT.usage;
  }
  if (Boolean(options.prompt) === Boolean(options.brief)) {
    deps.stderr('Pass exactly one of --prompt <text> or --brief <file>.');
    return WORKER_EXIT.usage;
  }
  if (options.harness && !HARNESSES.includes(options.harness as RuntimeName)) {
    deps.stderr(`Unknown --harness ${options.harness}; expected one of ${HARNESSES.join(', ')}.`);
    return WORKER_EXIT.usage;
  }
  const timeoutMs = parseSeconds(options.timeout, '--timeout', deps);
  if (timeoutMs === 'invalid') return WORKER_EXIT.usage;

  const parentId = resolveWorkerParent(options.parent, deps.env);
  if (!parentId && !deps.stdinIsTTY()) {
    deps.stderr(MISSING_PARENT_MESSAGE);
    return WORKER_EXIT.usage;
  }
  if (parentId && !PARENT_ID_RE.test(parentId)) {
    deps.stderr(`Invalid parent id ${JSON.stringify(parentId)}.`);
    return WORKER_EXIT.usage;
  }

  let prompt = options.prompt ?? '';
  if (options.brief) {
    try {
      prompt = await deps.readFile(options.brief);
    } catch (error) {
      deps.stderr(`Cannot read --brief ${options.brief}: ${error instanceof Error ? error.message : String(error)}`);
      return WORKER_EXIT.usage;
    }
  }

  let started: StartedWorker;
  try {
    started = await deps.startWorker({
      issueId: resolveIssueIdSync(options.issue),
      prompt,
      parentId,
      model: options.model,
      harness: options.harness as RuntimeName | undefined,
      readOnly: options.readOnly === true,
      cwd: options.cwd,
      name: options.name,
    });
  } catch (error) {
    const workerId = (error as { workerId?: string }).workerId;
    deps.stderr(`Could not start the worker: ${error instanceof Error ? error.message : String(error)}`);
    if (workerId && await deps.workerExists(workerId)) {
      deps.stderr(`Its pane may exist: stop it with pan kill ${workerId}`);
    }
    return WORKER_EXIT.usage;
  }

  if (options.detach) {
    deps.stdout(started.id);
    return WORKER_EXIT.done;
  }

  deps.stderr(`worker ${started.id} started (cwd ${started.cwd})`);
  const outcome = await deps.waitForWorkerReport(started.id, { afterSeq: 0, timeoutMs });
  const code = reportOutcome(started.id, outcome, deps);
  if (options.stopAfterReport && outcome.kind === 'report') {
    await deps.stopWorker(started.id).catch((error: unknown) => {
      deps.stderr(`Could not stop ${started.id}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  return code;
}

async function requireWorker(id: string, deps: WorkerCliDeps): Promise<boolean> {
  if (!WORKER_ID_RE.test(id)) {
    deps.stderr(`${id} is not a worker id (expected agent-<issue>-worker-<n>).`);
    return false;
  }
  if (!(await deps.workerExists(id))) {
    deps.stderr(`No worker ${id} under ~/.overdeck/agents/.`);
    return false;
  }
  return true;
}

export async function workerWaitCommand(
  id: string,
  options: { after?: string; timeout?: string },
  deps: WorkerCliDeps,
): Promise<number> {
  if (!(await requireWorker(id, deps))) return WORKER_EXIT.usage;
  const timeoutMs = parseSeconds(options.timeout, '--timeout', deps);
  if (timeoutMs === 'invalid') return WORKER_EXIT.usage;
  let afterSeq: number | undefined;
  if (options.after !== undefined) {
    afterSeq = Number(options.after);
    if (!Number.isInteger(afterSeq) || afterSeq < 0) {
      deps.stderr(`--after must be a report sequence number; got ${options.after}.`);
      return WORKER_EXIT.usage;
    }
  }
  const outcome = await deps.waitForWorkerReport(id, { afterSeq, timeoutMs });
  return reportOutcome(id, outcome, deps);
}

export async function workerReportCommand(
  id: string,
  options: { file?: string; stdin?: boolean; status?: string },
  deps: WorkerCliDeps,
): Promise<number> {
  if (!(await requireWorker(id, deps))) return WORKER_EXIT.usage;
  if (Boolean(options.file) === Boolean(options.stdin)) {
    deps.stderr('Pass exactly one of --file <path> or --stdin.');
    return WORKER_EXIT.usage;
  }
  const status = options.status ?? 'done';
  if (!isWorkerReportStatus(status)) {
    deps.stderr(`--status must be done, blocked or failed; got ${status}.`);
    return WORKER_EXIT.usage;
  }
  let body: string;
  try {
    body = options.file ? await deps.readFile(options.file) : await deps.readStdin();
  } catch (error) {
    deps.stderr(`Cannot read the report: ${error instanceof Error ? error.message : String(error)}`);
    return WORKER_EXIT.usage;
  }
  if (!body.trim()) {
    deps.stderr('The report is empty.');
    return WORKER_EXIT.usage;
  }
  try {
    const seq = await deps.writeWorkerReport(id, { body, status });
    deps.stderr(`report ${seq} recorded`);
    return WORKER_EXIT.done;
  } catch (error) {
    deps.stderr(`Could not record the report: ${error instanceof Error ? error.message : String(error)}`);
    return WORKER_EXIT.usage;
  }
}

function livenessLabel(verdict: LivenessVerdict): string {
  if (verdict.alive) return 'running';
  return isConfirmedDead(verdict) ? 'stopped' : 'unknown';
}

export async function workerListCommand(
  options: { issue?: string; parent?: string; json?: boolean },
  deps: WorkerCliDeps,
): Promise<number> {
  const listings = await deps.listWorkers({
    ...(options.issue ? { issueId: resolveIssueIdSync(options.issue) } : {}),
    ...(options.parent ? { parentId: options.parent } : {}),
  });
  const rows = await Promise.all(listings.map(async (listing) => ({
    id: listing.id,
    issue: listing.facts?.issueId ?? null,
    parent: listing.facts?.parentId ?? null,
    name: listing.facts?.name ?? null,
    readOnly: listing.facts?.readOnly ?? null,
    state: livenessLabel(await deps.isAlive(listing.id).catch(() => ({ alive: false, reason: 'runtime-indeterminate' }) as const)),
    latestReport: listing.latestReport ? { seq: listing.latestReport.seq, status: listing.latestReport.status, at: listing.latestReport.at } : null,
  })));

  if (options.json) {
    deps.stdout(JSON.stringify(rows, null, 2));
    return WORKER_EXIT.done;
  }
  if (rows.length === 0) {
    deps.stderr('No workers.');
    return WORKER_EXIT.done;
  }
  const table = [
    ['ID', 'ISSUE', 'PARENT', 'STATE', 'REPORT'],
    ...rows.map((row) => [
      row.id,
      row.issue ?? '-',
      row.parent ?? '-',
      row.state,
      row.latestReport ? `#${row.latestReport.seq} ${row.latestReport.status}` : '-',
    ]),
  ];
  const widths = table[0]!.map((_, column) => Math.max(...table.map((cells) => cells[column]!.length)));
  for (const cells of table) deps.stdout(cells.map((cell, column) => cell.padEnd(widths[column]!)).join('  ').trimEnd());
  return WORKER_EXIT.done;
}

export function registerWorkerCommands(program: Command, deps: () => WorkerCliDeps = defaultWorkerCliDeps): void {
  const worker = program
    .command('worker')
    .description('Registered workers: spawn an issue-linked agent and get its report back');

  worker
    .command('run')
    .description('Start a worker for an issue and wait for its report (exit 0 done, 4 blocked/failed, 2 no report, 3 timeout, 1 error)')
    .option('--issue <id>', 'Issue the worker belongs to (required)')
    .option('--prompt <text>', 'The brief, inline')
    .option('--brief <file>', 'The brief, from a file')
    .option('--model <model>', 'Model override (default: roles.worker.model)')
    .option('--harness <harness>', 'Harness override (default: routed from the model)')
    .option('--read-only', 'Run in the issue workspace with git writes blocked')
    .option('--cwd <path>', 'Working directory inside the issue workspace')
    .option('--parent <id>', 'Spawning agent or conversation (default: $OVERDECK_AGENT_ID, then $OVERDECK_CONVERSATION)')
    .option('--name <label>', 'Label shown in the Agents Directory')
    .option('--detach', 'Print the worker id and return without waiting')
    .option('--timeout <seconds>', 'Stop waiting after this many seconds (exit 3; the worker keeps running)')
    .option('--stop-after-report', 'Stop the worker after its first report')
    .action(async (options: WorkerRunOptions) => exitCli(await workerRunCommand(options, deps())));

  worker
    .command('wait <worker-id>')
    .description('Wait for a worker\'s next report (same exit codes as run)')
    .option('--after <seq>', 'Return only a report newer than this sequence number (default: the newest present now)')
    .option('--timeout <seconds>', 'Stop waiting after this many seconds (exit 3)')
    .action(async (id: string, options: { after?: string; timeout?: string }) =>
      exitCli(await workerWaitCommand(id, options, deps())));

  worker
    .command('report <worker-id>')
    .description('Record a worker\'s report (run by the worker itself)')
    .option('--file <path>', 'Read the Markdown report from a file')
    .option('--stdin', 'Read the Markdown report from stdin')
    .option('--status <status>', 'done | blocked | failed (default: done)')
    .action(async (id: string, options: { file?: string; stdin?: boolean; status?: string }) =>
      exitCli(await workerReportCommand(id, options, deps())));

  worker
    .command('list')
    .description('List workers with their parent, live state and newest report')
    .option('--issue <id>', 'Only this issue\'s workers')
    .option('--parent <id>', 'Only workers of this parent')
    .option('--json', 'Print JSON')
    .action(async (options: { issue?: string; parent?: string; json?: boolean }) =>
      exitCli(await workerListCommand(options, deps())));
}
