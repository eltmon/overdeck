/**
 * `pan lane report` core (.pan/drafts/pan-4223.md WI-6 step 3, FR-11, FR-12, D11).
 *
 * A lane reports through the worker report store keyed `conv-<name>`. The
 * lane is found from `$OVERDECK_CONVERSATION` (exported for every harness),
 * never from `$OVERDECK_AGENT_ID`. Git-backed lanes record the HEAD sha and
 * branch at report time. A builder's `done` report needs a clean tree whose
 * branch has an upstream holding every commit; `allowUnpushed` waives only
 * the upstream check, never the clean-tree check.
 *
 * A critic or verifier lane files exactly one verdict with its done report
 * (WI-17, FR-33, D24): the value, a defect count, and the absolute path of its
 * verdict file. Every refusal happens before anything is written.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  isLaneVerdict,
  isWorkerReportStatus,
  listWorkerReports,
  writeWorkerReport,
  type WorkerReportGit,
  type WorkerReportStatus,
  type WorkerReportVerdict,
} from '../agents/worker/report.js';
import { getConversationByName, type LaneRole } from '../overdeck/conversations.js';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 10_000;
const GIT_BACKED_ROLES: ReadonlySet<LaneRole> = new Set(['builder', 'critic', 'verifier', 'orchestrator']);

export interface LaneReportInput {
  body: string;
  status?: WorkerReportStatus;
  allowUnpushed?: boolean;
  /** Critic and verifier done reports: WOWED, IMPRESSED, NOT_YET, PASS or DEFECTS. */
  verdict?: string;
  /** Overrides the defect count read from the verdict file. */
  defects?: number;
  /** The verdict JSON the lane wrote; stored as an absolute path. */
  verdictFile?: string;
}

const MISSING_VERDICT = "a critic's done report needs --verdict (WOWED, IMPRESSED, NOT_YET, PASS or DEFECTS)";

/** WI-17: the verdict a critic or verifier's done report carries, after every check. */
async function critiqueVerdict(name: string, input: LaneReportInput): Promise<WorkerReportVerdict> {
  if (!isLaneVerdict(input.verdict)) throw new Error(MISSING_VERDICT);
  if ((await listWorkerReports(`conv-${name}`)).some((report) => report.status === 'done')) {
    throw new Error('one verdict per critic; launch a fresh critic');
  }
  let file: string | null = null;
  let fileText: string | null = null;
  if (input.verdictFile) {
    file = resolve(input.verdictFile);
    fileText = await readFile(file, 'utf8').catch(() => null);
    if (fileText === null) throw new Error(`verdict file ${file} not found`);
  }
  let defects: number | null = null;
  if (input.defects !== undefined) {
    if (!Number.isInteger(input.defects) || input.defects < 0) throw new Error(`--defects must be a non-negative integer; got ${input.defects}`);
    defects = input.defects;
  } else if (fileText !== null) {
    try {
      const parsed = JSON.parse(fileText) as { defects?: unknown };
      if (Array.isArray(parsed.defects)) defects = parsed.defects.length;
    } catch {
      // Not JSON: the count stays unknown.
    }
  }
  return { value: input.verdict, defects, file };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: GIT_TIMEOUT_MS });
  return stdout.trim();
}

async function readGit(cwd: string): Promise<WorkerReportGit | null> {
  try {
    const head = await git(cwd, ['rev-parse', 'HEAD']);
    const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return { head, branch: branch === 'HEAD' ? null : branch };
  } catch {
    return null;
  }
}

/** FR-12: the reason a builder may not report done, or null when it may. */
async function builderDoneRefusal(cwd: string, allowUnpushed: boolean): Promise<string | null> {
  const status = await git(cwd, ['status', '--porcelain']);
  if (status) return `the working tree in ${cwd} is dirty (git status --porcelain is not empty); commit or discard first`;
  if (allowUnpushed) return null;
  let ahead: string;
  try {
    ahead = await git(cwd, ['rev-list', '--count', '@{u}..HEAD']);
  } catch {
    return 'the branch has no upstream; push it with git push -u origin HEAD, or pass --allow-unpushed';
  }
  if (Number(ahead) > 0) return `the branch has ${ahead} commit(s) not on its upstream; push first, or pass --allow-unpushed`;
  return null;
}

/** Writes the calling lane's report and returns the confirmation line. */
export async function reportLane(input: LaneReportInput, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const own = env.OVERDECK_CONVERSATION?.trim();
  const name = own?.startsWith('conv-') ? own.slice('conv-'.length) : own;
  const lane = name ? getConversationByName(name) : null;
  if (!lane?.laneKey || !lane.laneRole || !lane.gauntletRun) {
    throw new Error('not inside a lane: pan lane report must run inside a conversation launched by pan lane start');
  }
  const status = input.status ?? 'done';
  if (!isWorkerReportStatus(status)) throw new Error(`unknown report status ${String(status)}: expected done, blocked or failed`);
  const judge = lane.laneRole === 'critic' || lane.laneRole === 'verifier';
  if (input.verdict !== undefined && !judge) throw new Error('--verdict is for critic and verifier lanes');
  if (input.verdict !== undefined && status !== 'done') throw new Error('--verdict needs --status done');
  const verdict = judge && status === 'done' ? await critiqueVerdict(lane.name, input) : null;

  let gitFacts: WorkerReportGit | null = null;
  if (GIT_BACKED_ROLES.has(lane.laneRole)) {
    gitFacts = await readGit(lane.cwd);
    if (lane.laneRole === 'builder' && status === 'done') {
      if (!gitFacts) throw new Error(`cannot read the git state of ${lane.cwd}; a builder done report needs a clean, pushed tree`);
      const refusal = await builderDoneRefusal(lane.cwd, input.allowUnpushed === true);
      if (refusal) throw new Error(`done report refused: ${refusal}`);
    }
  }

  const seq = await writeWorkerReport(`conv-${lane.name}`, {
    body: input.body,
    status,
    ...(gitFacts ? { git: gitFacts } : {}),
    ...(verdict ? { verdict } : {}),
  });
  return `lane ${lane.gauntletRun}/${lane.laneKey} report ${seq}: ${status}${verdict ? `, verdict ${verdict.value}` : ''}`;
}
