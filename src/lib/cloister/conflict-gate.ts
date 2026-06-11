import { exec, type ExecOptions } from 'node:child_process';
import { promisify } from 'node:util';
import { emitActivityEntrySync } from '../activity-logger.js';
import { spawnRun } from '../agents.js';
import { getReviewStatusSync, setReviewStatusSync, type BlockerReason, type ReviewStatus } from '../review-status.js';

const execAsync = promisify(exec);
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 4 * 1024 * 1024;
const MERGE_BLOCKER_TYPES = new Set<BlockerReason['type']>(['merge_conflict', 'not_mergeable']);
const PROBE_CACHE_MS = 3 * 60 * 1000;
const DISPATCH_THROTTLE_MS = 30 * 60 * 1000;

export type BranchMergeability = 'clean' | 'conflicts' | 'unknown';

export interface ExecResult {
  stdout: string | Buffer;
  stderr: string | Buffer;
}

export type ExecRunner = (command: string, options: ExecOptions) => Promise<ExecResult>;

export interface CheckBranchMergeabilityDeps {
  exec?: ExecRunner;
}

export interface ConflictGateResult {
  gated: boolean;
  reason?: string;
  clearedStaleBlocker?: boolean;
}

export interface DispatchResolverInput {
  issueId: string;
  workspacePath: string;
  targetBranch: string;
  blockerReasons: BlockerReason[];
  reason: string;
}

export interface ResolveConflictGateDeps {
  getReviewStatus: (issueId: string) => ReviewStatus | null | Promise<ReviewStatus | null>;
  setReviewStatus: (
    issueId: string,
    update: Partial<ReviewStatus>,
    existing?: ReviewStatus,
  ) => ReviewStatus | Promise<ReviewStatus>;
  probeMergeability?: (workspacePath: string, targetBranch: string) => BranchMergeability | Promise<BranchMergeability>;
  dispatchResolver: (input: DispatchResolverInput) => void | Promise<void>;
  now?: () => Date;
  log?: (message: string) => void;
}

interface RealConflictGateDepsOverrides {
  spawnRun?: typeof spawnRun;
  getReviewStatus?: typeof getReviewStatusSync;
  setReviewStatus?: typeof setReviewStatusSync;
  emitActivityEntry?: typeof emitActivityEntrySync;
  now?: () => Date;
  log?: (message: string) => void;
}

const probeCache = new Map<string, { checkedAtMs: number; result: BranchMergeability }>();

/**
 * Non-destructively checks whether HEAD can merge with origin/<targetBranch>.
 * Uses git merge-tree only — never git merge — so HEAD, the index, and the
 * working tree are left untouched.
 */
export async function checkBranchMergeability(
  workspacePath: string,
  targetBranch: string,
  deps: CheckBranchMergeabilityDeps = {},
): Promise<BranchMergeability> {
  const run = deps.exec ?? execAsync;
  const options: ExecOptions = {
    cwd: workspacePath,
    encoding: 'utf-8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  };

  try {
    await run(`git fetch origin ${shellQuote(targetBranch)}`, options);
  } catch {
    return 'unknown';
  }

  try {
    const result = await run(
      `git merge-tree --write-tree --name-only HEAD ${shellQuote(`origin/${targetBranch}`)}`,
      options,
    );
    return outputHasConflictMarker(result.stdout, result.stderr) ? 'conflicts' : 'clean';
  } catch (err) {
    return mergeTreeFailureIndicatesConflict(err) ? 'conflicts' : 'unknown';
  }
}

export function buildRealConflictGateDeps(overrides: RealConflictGateDepsOverrides = {}): ResolveConflictGateDeps {
  const runSpawn = overrides.spawnRun ?? spawnRun;
  const readStatus = overrides.getReviewStatus ?? getReviewStatusSync;
  const writeStatus = overrides.setReviewStatus ?? setReviewStatusSync;
  const emitActivity = overrides.emitActivityEntry ?? emitActivityEntrySync;
  const now = overrides.now ?? (() => new Date());

  return {
    getReviewStatus: readStatus,
    setReviewStatus: writeStatus,
    probeMergeability: checkBranchMergeability,
    now,
    log: overrides.log,
    dispatchResolver: async (input) => {
      try {
        await runSpawn(input.issueId, 'work', { prompt: buildConflictResolverPrompt(input) });
      } catch (err) {
        if (isAlreadyRunningError(err)) {
          overrides.log?.(`[conflict-gate] ${input.issueId}: conflict resolver already running`);
          return;
        }
        throw err;
      }

      const dispatchedAt = now().toISOString();
      const existing = readStatus(input.issueId) ?? undefined;
      writeStatus(input.issueId, { conflictResolutionDispatchedAt: dispatchedAt }, existing);
      emitActivity({
        source: 'review',
        level: 'info',
        issueId: input.issueId,
        message: `Review deferred — conflict resolver dispatched for ${input.issueId}`,
        details: input.reason,
      });
    },
  };
}

export async function resolveConflictGate(
  issueId: string,
  workspacePath: string,
  targetBranch: string,
  deps: ResolveConflictGateDeps,
): Promise<ConflictGateResult> {
  const status = await deps.getReviewStatus(issueId);
  const mergeBlockers = (status?.blockerReasons ?? []).filter(isMergeBlocker);
  if (!status || mergeBlockers.length === 0) return { gated: false };

  const now = deps.now ?? (() => new Date());
  const checkedAtMs = now().getTime();
  const mergeability = await getCachedMergeability(issueId, checkedAtMs, workspacePath, targetBranch, deps);

  if (mergeability === 'clean') {
    const remainingBlockers = (status.blockerReasons ?? []).filter((blocker) => !isMergeBlocker(blocker));
    await deps.setReviewStatus(
      issueId,
      { blockerReasons: remainingBlockers.length > 0 ? remainingBlockers : undefined },
      status,
    );
    deps.log?.(`[conflict-gate] ${issueId}: cleared stale merge blocker; review can proceed`);
    return { gated: false, clearedStaleBlocker: true };
  }

  const reason = mergeability === 'conflicts'
    ? `merge conflict with ${targetBranch} must be resolved before review dispatch`
    : `mergeability against ${targetBranch} could not be verified; deferring review conservatively`;

  if (!isResolverDispatchThrottled(status, checkedAtMs)) {
    await deps.dispatchResolver({ issueId, workspacePath, targetBranch, blockerReasons: mergeBlockers, reason });
  } else {
    deps.log?.(`[conflict-gate] ${issueId}: conflict resolver dispatch is throttled`);
  }

  return { gated: true, reason };
}

export function __resetConflictGateProbeCacheForTests(): void {
  probeCache.clear();
}

async function getCachedMergeability(
  issueId: string,
  nowMs: number,
  workspacePath: string,
  targetBranch: string,
  deps: ResolveConflictGateDeps,
): Promise<BranchMergeability> {
  const key = issueId.toUpperCase();
  const cached = probeCache.get(key);
  if (cached && nowMs - cached.checkedAtMs < PROBE_CACHE_MS) return cached.result;

  const result = await (deps.probeMergeability ?? checkBranchMergeability)(workspacePath, targetBranch);
  probeCache.set(key, { checkedAtMs: nowMs, result });
  return result;
}

function isResolverDispatchThrottled(status: ReviewStatus, nowMs: number): boolean {
  if (!status.conflictResolutionDispatchedAt) return false;
  const dispatchedAtMs = Date.parse(status.conflictResolutionDispatchedAt);
  return Number.isFinite(dispatchedAtMs) && nowMs - dispatchedAtMs < DISPATCH_THROTTLE_MS;
}

function isMergeBlocker(blocker: BlockerReason): boolean {
  return MERGE_BLOCKER_TYPES.has(blocker.type);
}

function buildConflictResolverPrompt(input: DispatchResolverInput): string {
  const blockerSummary = input.blockerReasons
    .map((blocker) => `- ${blocker.type}: ${blocker.summary} (detected ${blocker.detectedAt})`)
    .join('\n');

  return [
    `Review for ${input.issueId} was deferred because the feature branch has a standing merge conflict with origin/${input.targetBranch}.`,
    '',
    'Resolve the conflict WITHOUT degrading either side of the change:',
    `1. Read what origin/${input.targetBranch} changed and what ${input.issueId} intended before editing.`,
    `2. Rebase this branch onto origin/${input.targetBranch} and resolve every conflict so BOTH intents are preserved.`,
    '3. Build, run the relevant tests, commit the resolved state, and push with --force-with-lease.',
    '4. Re-request review when the branch is clean (use pan done or pan review request as appropriate for this workspace).',
    '',
    'Do not blindly accept one side of a conflict — understand both changesets first.',
    '',
    'Current blocker details:',
    blockerSummary || '- mergeability blocker present',
  ].join('\n');
}

function isAlreadyRunningError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /already running/i.test(message);
}

function mergeTreeFailureIndicatesConflict(err: unknown): boolean {
  const maybe = err as { code?: unknown; stdout?: unknown; stderr?: unknown; message?: unknown };
  const output = [maybe.stdout, maybe.stderr, maybe.message].map(toText).join('\n');

  if (outputHasConflictMarker(output, '')) return true;

  // `git merge-tree --write-tree` exits 1 for merge conflicts. Treat fatal/git
  // usage failures as unknown so missing workspaces, old git, and bad refs do not
  // masquerade as real branch conflicts.
  return maybe.code === 1 && !/\b(fatal|usage:|unknown option|not a git repository)\b/i.test(output);
}

function outputHasConflictMarker(stdout: unknown, stderr: unknown): boolean {
  const output = `${toText(stdout)}\n${toText(stderr)}`;
  return /\bCONFLICT\b/i.test(output) || /contains conflicts/i.test(output);
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf-8');
  if (value instanceof Error) return value.message;
  return value == null ? '' : String(value);
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9._/@:-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
