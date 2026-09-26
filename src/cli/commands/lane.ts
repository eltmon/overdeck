/**
 * `pan lane start | list | wait | report | stop | reap` (.pan/drafts/pan-4223.md
 * WI-8, FR-2, FR-11 to FR-15, FR-23, FR-24, D12, D13, D17).
 *
 * The CLI is a thin client: `start`, `list`, `stop` and `reap` go through the
 * dashboard API (one creation path, FR-2); `report` and `wait` run the lane
 * cores locally, as `pan worker` does. `wait` and `report` use the
 * `pan worker` exit codes:
 *
 *   0  report with status `done`
 *   4  report with status `blocked` or `failed`
 *   2  the lane exited, or sat idle, without a report
 *   3  timeout (the lane is still running)
 *   1  usage or request error
 *
 * Messaging a lane is `pan tell conv-<name>` (D12); there is no lane verb for it.
 */
import { readFile } from 'node:fs/promises';

import type { Command } from 'commander';

import { exitCli } from '../exit.js';
import { getDashboardApiUrl } from '../../lib/config.js';
import type { WaitOptions, WaitOutcome } from '../../lib/agents/worker/wait.js';
import type { LaneReportInput } from '../../lib/lanes/report.js';
import type { LaneView } from '../../lib/lanes/views.js';
import type { LaneSetFilter, LaneSetOptions, LaneSetOutcome } from '../../lib/lanes/wait.js';
import { WORKER_EXIT } from './worker.js';

const START_POLL_MS = 2_000;
const START_WAIT_MS = 180_000;
export const MISSING_LANE_PARENT_MESSAGE = 'pan lane start must run inside a conversation or name --parent';

/** A lane conversation as the CLI needs it. */
export interface LaneRef {
  id: number;
  name: string;
  run: string | null;
  key: string | null;
  spawnError: string | null;
}

export interface LaneCliDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  apiUrl: () => string;
  env: NodeJS.ProcessEnv;
  readFile: (path: string) => Promise<string>;
  readStdin: () => Promise<string>;
  resolveLane: (ref: string) => Promise<LaneRef | null>;
  waitForLane: (name: string, options: WaitOptions) => Promise<WaitOutcome>;
  waitForLaneSet: (filter: LaneSetFilter, options: LaneSetOptions) => Promise<LaneSetOutcome>;
  reportLane: (input: LaneReportInput, env: NodeJS.ProcessEnv) => Promise<string>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
}

async function resolveLaneLocally(ref: string): Promise<LaneRef | null> {
  const { getConversationById, getConversationByName } = await import('../../lib/overdeck/conversations.js');
  const trimmed = ref.trim();
  const row = /^\d+$/.test(trimmed)
    ? getConversationById(Number(trimmed))
    : getConversationByName(trimmed.startsWith('conv-') ? trimmed.slice('conv-'.length) : trimmed);
  return row ? { id: row.id, name: row.name, run: row.gauntletRun, key: row.laneKey, spawnError: row.spawnError } : null;
}

export function defaultLaneCliDeps(): LaneCliDeps {
  return {
    fetch: (url, init) => fetch(url, init),
    apiUrl: getDashboardApiUrl,
    env: process.env,
    readFile: (path) => readFile(path, 'utf8'),
    readStdin: readAllStdin,
    resolveLane: resolveLaneLocally,
    waitForLane: async (name, options) => (await import('../../lib/lanes/wait.js')).waitForLane(name, options),
    waitForLaneSet: async (filter, options) => (await import('../../lib/lanes/wait.js')).waitForLaneSet(filter, options),
    reportLane: async (input, env) => (await import('../../lib/lanes/report.js')).reportLane(input, env),
    now: Date.now,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    stdout: (text) => { process.stdout.write(text.endsWith('\n') ? text : `${text}\n`); },
    stderr: (text) => { process.stderr.write(text.endsWith('\n') ? text : `${text}\n`); },
  };
}

interface ApiAnswer {
  status: number;
  body: Record<string, unknown> | null;
}

async function api(deps: LaneCliDeps, method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiAnswer> {
  const response = await deps.fetch(`${deps.apiUrl()}${path}`, {
    method,
    // POSTs need a trusted Origin (routes/origin-validation.ts), as plan-finalize sends.
    headers: method === 'POST' ? { 'Content-Type': 'application/json', Origin: deps.apiUrl() } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    parsed = { error: text };
  }
  return { status: response.status, body: parsed };
}

function errorOf(answer: ApiAnswer): string {
  return typeof answer.body?.error === 'string' ? answer.body.error : `dashboard answered ${answer.status}`;
}

function parseSeconds(raw: string | undefined, deps: LaneCliDeps): number | null | 'invalid' {
  if (raw === undefined) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    deps.stderr(`--timeout must be a positive number of seconds; got ${raw}.`);
    return 'invalid';
  }
  return seconds * 1000;
}

export interface LaneStartOptions {
  key?: string;
  /** Critic (required) and verifier (optional): the builder lane key judged. */
  for?: string;
  role?: string;
  brief?: string;
  prompt?: string;
  run?: string;
  parent?: string;
  project?: string;
  model?: string;
  harness?: string;
  effort?: string;
  title?: string;
  branch?: string;
  from?: string;
  at?: string;
  reuse?: boolean;
  replace?: boolean;
  wait?: boolean;
  json?: boolean;
}

/** D5: --parent, else $OVERDECK_CONVERSATION without its conv- prefix. */
export function resolveLaneParent(explicit: string | undefined, env: NodeJS.ProcessEnv): string | null {
  const candidate = explicit?.trim() || env.OVERDECK_CONVERSATION?.trim();
  if (!candidate) return null;
  return candidate.startsWith('conv-') ? candidate.slice('conv-'.length) : candidate;
}

export async function laneStartCommand(options: LaneStartOptions, deps: LaneCliDeps): Promise<number> {
  const parent = resolveLaneParent(options.parent, deps.env);
  if (!parent) {
    deps.stderr(MISSING_LANE_PARENT_MESSAGE);
    return WORKER_EXIT.usage;
  }
  if (!options.role || (!options.key && !options.for)) {
    deps.stderr('--role and --key are required (a critic or verifier may pass --for instead of --key).');
    return WORKER_EXIT.usage;
  }
  if (Boolean(options.brief) === Boolean(options.prompt)) {
    deps.stderr('Pass exactly one of --brief <file> or --prompt <text>.');
    return WORKER_EXIT.usage;
  }
  let brief = options.prompt ?? '';
  if (options.brief) {
    try {
      brief = await deps.readFile(options.brief);
    } catch (error) {
      deps.stderr(`Cannot read --brief ${options.brief}: ${error instanceof Error ? error.message : String(error)}`);
      return WORKER_EXIT.usage;
    }
  }

  const request = {
    parent,
    ...(options.key ? { key: options.key } : {}),
    ...(options.for ? { for: options.for } : {}),
    role: options.role,
    brief,
    ...(options.brief ? { briefSource: options.brief } : {}),
    ...(options.run ? { run: options.run } : {}),
    ...(options.project ? { project: options.project } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.harness ? { harness: options.harness } : {}),
    ...(options.effort ? { effort: options.effort } : {}),
    ...(options.title ? { title: options.title } : {}),
    ...(options.branch ? { branch: options.branch } : {}),
    ...(options.from ? { from: options.from } : {}),
    ...(options.at ? { at: options.at } : {}),
    ...(options.reuse ? { reuse: true } : {}),
    ...(options.replace ? { replace: true } : {}),
  };
  let answer: ApiAnswer;
  try {
    answer = await api(deps, 'POST', '/api/lanes', request);
  } catch (error) {
    deps.stderr(`Could not reach the dashboard: ${error instanceof Error ? error.message : String(error)}`);
    return WORKER_EXIT.usage;
  }
  if (answer.status !== 201 || !answer.body) {
    deps.stderr(errorOf(answer));
    return WORKER_EXIT.usage;
  }
  const result = answer.body as { conversation: { id: number; name: string; gauntletRun: string; laneKey: string; laneRole: string }; cwd: string; iteration: number; warnings?: string[] };
  for (const warning of result.warnings ?? []) deps.stderr(`warning: ${warning}`);
  const { conversation } = result;

  if (options.wait !== false) {
    const deadline = deps.now() + START_WAIT_MS;
    for (;;) {
      const view = await api(deps, 'GET', `/api/lanes/${encodeURIComponent(conversation.name)}`).catch(() => null);
      const activity = view?.body?.activity;
      if (activity === 'failed-to-start') {
        const row = await deps.resolveLane(conversation.name);
        deps.stderr(`Lane conv ${conversation.id} (${conversation.name}) failed to start: ${row?.spawnError ?? 'no spawn error recorded'}`);
        return WORKER_EXIT.usage;
      }
      if (activity !== undefined && activity !== 'starting') break;
      if (deps.now() >= deadline) {
        deps.stderr(`Lane conv ${conversation.id} (${conversation.name}) is still starting after ${START_WAIT_MS / 1000} s.`);
        break;
      }
      await deps.sleep(START_POLL_MS);
    }
  }

  if (options.json) deps.stdout(JSON.stringify(result, null, 2));
  else deps.stdout(`Lane ${conversation.gauntletRun}/${conversation.laneKey} ${conversation.laneRole} i${result.iteration}: conv ${conversation.id} (${conversation.name}) in ${result.cwd}`);
  return WORKER_EXIT.done;
}

function verdictCell(verdict: { verdict?: string; value?: string; defects: number | null } | null | undefined): string {
  if (!verdict) return '';
  const value = verdict.value ?? verdict.verdict ?? '';
  return verdict.defects != null ? `${value} ${verdict.defects}` : value;
}

function laneTable(lanes: LaneView[]): string[] {
  const rows = [
    ['ID', 'RUN/KEY', 'ROLE', 'ITER', 'ACTIVITY', 'REPORT', 'FOR', 'VERDICT', 'BRANCH@SHA', 'AHEAD', 'DIRTY', 'MODEL', 'COST'],
    ...lanes.map((lane) => [
      String(lane.id),
      `${lane.run}/${lane.key}`,
      lane.role,
      String(lane.iteration),
      lane.archived ? 'archived' : lane.activity,
      lane.report ? `#${lane.report.seq} ${lane.report.status}` : '-',
      lane.criticOf ? `${lane.criticOf.key} i${lane.criticOf.iteration}` : '',
      lane.role === 'builder' ? verdictCell(lane.latestVerdict) : verdictCell(lane.verdict),
      lane.git ? `${lane.git.branch ?? 'detached'}@${(lane.git.head ?? '').slice(0, 7)}` : '-',
      lane.git?.ahead != null ? String(lane.git.ahead) : '-',
      lane.git ? (lane.git.dirty ? 'yes' : 'no') : '-',
      lane.model ?? '-',
      lane.costUsd != null ? `$${lane.costUsd.toFixed(2)}` : '-',
    ]),
  ];
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((cells) => cells[column]!.length)));
  return rows.map((cells) => cells.map((cell, column) => cell.padEnd(widths[column]!)).join('  ').trimEnd());
}

export async function laneListCommand(options: { run?: string; parent?: string; json?: boolean }, deps: LaneCliDeps): Promise<number> {
  const params = new URLSearchParams();
  if (options.run) params.set('run', options.run);
  if (options.parent) params.set('parent', options.parent);
  let answer: ApiAnswer;
  try {
    answer = await api(deps, 'GET', `/api/lanes${params.size > 0 ? `?${params.toString()}` : ''}`);
  } catch (error) {
    deps.stderr(`Could not reach the dashboard: ${error instanceof Error ? error.message : String(error)}`);
    return WORKER_EXIT.usage;
  }
  if (answer.status !== 200) {
    deps.stderr(errorOf(answer));
    return WORKER_EXIT.usage;
  }
  const lanes = (answer.body?.lanes ?? []) as LaneView[];
  if (options.json) {
    deps.stdout(JSON.stringify(lanes, null, 2));
    return WORKER_EXIT.done;
  }
  if (lanes.length === 0) {
    deps.stderr('No lanes.');
    return WORKER_EXIT.done;
  }
  for (const line of laneTable(lanes)) deps.stdout(line);
  return WORKER_EXIT.done;
}

function laneWaitOutcome(name: string, outcome: WaitOutcome, deps: LaneCliDeps, afterSeq?: number): number {
  switch (outcome.kind) {
    case 'report':
      deps.stdout(outcome.report.body);
      deps.stderr(`lane ${name} report ${outcome.report.seq}: ${outcome.report.status}; next: pan lane wait ${name} --after ${outcome.report.seq}`);
      return outcome.report.status === 'done' ? WORKER_EXIT.done : WORKER_EXIT.blocked;
    case 'exited-without-report':
    case 'idle-without-report':
      deps.stdout(outcome.lastAssistantMessage !== null
        ? `[no report — last assistant message]\n${outcome.lastAssistantMessage}`
        : `[no report — transcript: ${outcome.transcriptPath ?? 'not found'}]`);
      deps.stderr(outcome.kind === 'exited-without-report'
        ? `lane ${name} exited without a report`
        : `lane ${name} is idle without a report and is still running; follow up with pan tell conv-${name} "<message>", then pan lane wait ${name}`);
      return WORKER_EXIT.noReport;
    case 'timeout':
      deps.stderr(`lane ${name} is still running; run: pan lane wait ${name}${afterSeq !== undefined ? ` --after ${afterSeq}` : ''}`);
      return WORKER_EXIT.timeout;
  }
}

export async function laneWaitCommand(
  lane: string | undefined,
  options: { run?: string; parent?: string; after?: string; timeout?: string },
  deps: LaneCliDeps,
): Promise<number> {
  const timeoutMs = parseSeconds(options.timeout, deps);
  if (timeoutMs === 'invalid') return WORKER_EXIT.usage;
  const sets = [lane, options.run, options.parent].filter(Boolean).length;
  if (sets !== 1) {
    deps.stderr('Pass exactly one of <lane>, --run <key> or --parent <conv>.');
    return WORKER_EXIT.usage;
  }

  if (lane) {
    const ref = await deps.resolveLane(lane);
    if (!ref?.key) {
      deps.stderr(`${lane} is not a lane.`);
      return WORKER_EXIT.usage;
    }
    let afterSeq: number | undefined;
    if (options.after !== undefined) {
      afterSeq = Number(options.after);
      if (!Number.isInteger(afterSeq) || afterSeq < 0) {
        deps.stderr(`--after must be a report sequence number; got ${options.after}.`);
        return WORKER_EXIT.usage;
      }
    }
    try {
      return laneWaitOutcome(ref.name, await deps.waitForLane(ref.name, { afterSeq, timeoutMs }), deps, afterSeq);
    } catch (error) {
      deps.stderr(`Could not wait on lane ${ref.name}: ${error instanceof Error ? error.message : String(error)}`);
      return WORKER_EXIT.usage;
    }
  }

  const scope = options.run ? `--run ${options.run}` : `--parent ${options.parent}`;
  let outcome: LaneSetOutcome;
  try {
    outcome = await deps.waitForLaneSet(
      options.run ? { run: options.run } : { parent: options.parent },
      { after: options.after, timeoutMs },
    );
  } catch (error) {
    deps.stderr(error instanceof Error ? error.message : String(error));
    return WORKER_EXIT.usage;
  }
  if (outcome.kind === 'timeout') {
    deps.stderr(`no new lane report; next: pan lane wait ${scope}${outcome.cursor ? ` --after ${outcome.cursor}` : ''}`);
    return WORKER_EXIT.timeout;
  }
  deps.stdout(outcome.report.body);
  deps.stderr(`lane ${outcome.lane.run}/${outcome.lane.key} (${outcome.lane.name}) report ${outcome.report.seq}: ${outcome.report.status}; next: pan lane wait ${scope} --after ${outcome.cursor}`);
  return outcome.report.status === 'done' ? WORKER_EXIT.done : WORKER_EXIT.blocked;
}

export interface LaneReportOptions {
  file?: string;
  stdin?: boolean;
  status?: string;
  allowUnpushed?: boolean;
  verdict?: string;
  defects?: string;
  verdictFile?: string;
}

export async function laneReportCommand(options: LaneReportOptions, deps: LaneCliDeps): Promise<number> {
  if (Boolean(options.file) === Boolean(options.stdin)) {
    deps.stderr('Pass exactly one of --file <path> or --stdin.');
    return WORKER_EXIT.usage;
  }
  const status = options.status ?? 'done';
  if (status !== 'done' && status !== 'blocked' && status !== 'failed') {
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
  let defects: number | undefined;
  if (options.defects !== undefined) {
    defects = Number(options.defects);
    if (!Number.isInteger(defects) || defects < 0) {
      deps.stderr(`--defects must be a non-negative integer; got ${options.defects}.`);
      return WORKER_EXIT.usage;
    }
  }
  try {
    deps.stderr(await deps.reportLane({
      body,
      status,
      allowUnpushed: options.allowUnpushed === true,
      ...(options.verdict !== undefined ? { verdict: options.verdict } : {}),
      ...(defects !== undefined ? { defects } : {}),
      ...(options.verdictFile !== undefined ? { verdictFile: options.verdictFile } : {}),
    }, deps.env));
    return WORKER_EXIT.done;
  } catch (error) {
    deps.stderr(error instanceof Error ? error.message : String(error));
    return WORKER_EXIT.usage;
  }
}

async function requireLane(ref: string, deps: LaneCliDeps): Promise<LaneRef | null> {
  const lane = await deps.resolveLane(ref);
  if (!lane?.key) {
    deps.stderr(`${ref} is not a lane.`);
    return null;
  }
  return lane;
}

export async function laneStopCommand(ref: string, deps: LaneCliDeps): Promise<number> {
  const lane = await requireLane(ref, deps);
  if (!lane) return WORKER_EXIT.usage;
  try {
    const answer = await api(deps, 'POST', `/api/conversations/${encodeURIComponent(lane.name)}/stop`, {});
    if (answer.status !== 200) {
      deps.stderr(errorOf(answer));
      return WORKER_EXIT.usage;
    }
  } catch (error) {
    deps.stderr(`Could not reach the dashboard: ${error instanceof Error ? error.message : String(error)}`);
    return WORKER_EXIT.usage;
  }
  deps.stdout(`Stopped lane ${lane.run}/${lane.key} (conv ${lane.id})`);
  return WORKER_EXIT.done;
}

export async function laneReapCommand(ref: string, options: { park?: boolean; keep?: boolean }, deps: LaneCliDeps): Promise<number> {
  const lane = await requireLane(ref, deps);
  if (!lane) return WORKER_EXIT.usage;
  const keep = options.keep === true;
  let answer: ApiAnswer;
  try {
    answer = await api(deps, 'POST', `/api/lanes/${encodeURIComponent(lane.name)}/reap`, { park: options.park === true, keep });
  } catch (error) {
    deps.stderr(`Could not reach the dashboard: ${error instanceof Error ? error.message : String(error)}`);
    return WORKER_EXIT.usage;
  }
  if (answer.status !== 200 || !answer.body) {
    deps.stderr(errorOf(answer));
    return WORKER_EXIT.usage;
  }
  const result = answer.body as { archived?: boolean; parkedPatch?: string | null; warnings?: string[] };
  const conversation = keep ? 'conversation kept' : result.archived ? 'conversation archived' : 'conversation not archived';
  deps.stdout(`Reaped lane ${lane.run}/${lane.key} (conv ${lane.id}): directory removed, ${conversation}`);
  if (result.parkedPatch) deps.stdout(`Parked uncommitted work in ${result.parkedPatch}`);
  const warnings = result.warnings ?? [];
  if (!keep && !result.archived && !warnings.some((warning) => warning.includes('archiving failed'))) {
    warnings.push(`reaped, but archiving failed; archive conv ${lane.id} from the Command Deck`);
  }
  for (const warning of warnings) deps.stderr(`warning: ${warning}`);
  return WORKER_EXIT.done;
}

export function registerLaneCommands(program: Command, deps: () => LaneCliDeps = defaultLaneCliDeps): void {
  const lane = program
    .command('lane')
    .description('Gauntlet lanes: launch, list, wait on, report from, stop and reap lane conversations');

  lane
    .command('start')
    .description('Launch a lane conversation under the calling conversation (any harness)')
    .option('--key <key>', 'Lane key inside the run (required unless --for)')
    .option('--for <builder-key>', 'Critic (required) or verifier: the builder lane judged; --key defaults to it')
    .option('--role <role>', 'builder | critic | verifier | play | orchestrator (required)')
    .option('--brief <file>', 'The brief, from a file')
    .option('--prompt <text>', 'The brief, inline')
    .option('--run <key>', 'Run key (required from a root; inherited inside an orchestrator lane)')
    .option('--parent <conv>', 'Launching conversation (default: $OVERDECK_CONVERSATION)')
    .option('--project <key>', 'Project (default: the parent\'s project)')
    .option('--model <model>', 'Model (default: projects.<key>.gauntlet.roles.<role>.model)')
    .option('--harness <harness>', 'Harness (default: role config, else routed from the model)')
    .option('--effort <effort>', 'low | medium | high')
    .option('--title <title>', 'Conversation title (default: <run> <key> · <role>)')
    .option('--branch <branch>', 'Builder branch (default: <run>/<key>, <run>/<key>-i<n> after)')
    .option('--from <ref>', 'Base ref for a new builder branch')
    .option('--at <ref>', 'Commit a critic or verifier judges (default with --for: the builder\'s newest done head)')
    .option('--reuse', 'Continue in the directory of the latest earlier lane with the same run, key and role')
    .option('--replace', 'Stop the live lane with the same run, key and role first')
    .option('--no-wait', 'Return without waiting for the lane to start')
    .option('--json', 'Print the launch result as JSON')
    .action(async (options: LaneStartOptions) => exitCli(await laneStartCommand(options, deps())));

  lane
    .command('list')
    .description('List lanes with their activity, newest report, git facts and cost')
    .option('--run <key>', 'Only this run\'s lanes')
    .option('--parent <conv>', 'Only lanes launched by this conversation')
    .option('--json', 'Print JSON')
    .action(async (options: { run?: string; parent?: string; json?: boolean }) => exitCli(await laneListCommand(options, deps())));

  lane
    .command('wait [lane]')
    .description('Wait for a lane report (exit 0 done, 4 blocked/failed, 2 no report, 3 timeout, 1 error)')
    .option('--run <key>', 'Wait for the next report of any lane in this run')
    .option('--parent <conv>', 'Wait for the next report of any lane launched by this conversation')
    .option('--after <seq-or-cursor>', 'Report seq for one lane; cursor <atMs>.<name>.<seq> for a run or parent')
    .option('--timeout <seconds>', 'Stop waiting after this many seconds (exit 3)')
    .action(async (ref: string | undefined, options: { run?: string; parent?: string; after?: string; timeout?: string }) =>
      exitCli(await laneWaitCommand(ref, options, deps())));

  lane
    .command('report')
    .description('Record this lane\'s report (run inside the lane)')
    .option('--file <path>', 'Read the Markdown report from a file')
    .option('--stdin', 'Read the Markdown report from stdin')
    .option('--status <status>', 'done | blocked | failed (default: done)')
    .option('--allow-unpushed', 'Let a builder report done with commits not on its upstream')
    .option('--verdict <value>', 'Critic or verifier done report: WOWED | IMPRESSED | NOT_YET | PASS | DEFECTS')
    .option('--defects <n>', 'Defect count (default: the verdict file\'s defects array length)')
    .option('--verdict-file <path>', 'The verdict JSON the lane wrote')
    .action(async (options: LaneReportOptions) =>
      exitCli(await laneReportCommand(options, deps())));

  lane
    .command('stop <lane>')
    .description('Stop a lane through the conversation stop door')
    .action(async (ref: string) => exitCli(await laneStopCommand(ref, deps())));

  lane
    .command('reap <lane>')
    .description('Remove a lane\'s directory and archive its conversation (never kills, never discards work)')
    .option('--park', 'Save uncommitted work to a verified patch before removing a dirty worktree')
    .option('--keep', 'Keep the conversation listed instead of archiving it')
    .action(async (ref: string, options: { park?: boolean; keep?: boolean }) => exitCli(await laneReapCommand(ref, options, deps())));
}
