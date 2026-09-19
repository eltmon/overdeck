import { exec, type ExecOptions } from 'node:child_process';
import { promisify } from 'node:util';
import { emitActivityEntrySync } from '../activity-logger.js';
import { messageAgent } from '../agents/messaging.js';
import { spawnRun } from '../agents/spawn.js';
import { getPrFacts, type PrFacts } from './pr-facts.js';

const execAsync = promisify(exec);
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 4 * 1024 * 1024;
/** Forge merge states that mean the branch cannot land as it stands. */
const CONFLICTING_MERGE_STATES = new Set(['dirty', 'blocked', 'behind']);
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

export type ResolverDispatchState = 'dispatched' | 'already_running' | 'throttled';

export interface ConflictGateResult {
  gated: boolean;
  reason?: string;
  clearedStaleBlocker?: boolean;
  resolverDispatchState?: ResolverDispatchState;
}

export interface DispatchResolverInput {
  issueId: string;
  workspacePath: string;
  targetBranch: string;
  /** What the forge says blocks the merge, for the resolver prompt. */
  blockerSummary: string;
  reason: string;
}

export interface ResolveConflictGateDeps {
  /** The forge's view of the issue's PR. PAN-3917: no stored blocker rows. */
  getFacts: (issueId: string) => PrFacts | Promise<PrFacts>;
  probeMergeability?: (workspacePath: string, targetBranch: string) => BranchMergeability | Promise<BranchMergeability>;
  dispatchResolver: (input: DispatchResolverInput) => ResolverDispatchState | void | Promise<ResolverDispatchState | void>;
  now?: () => Date;
  log?: (message: string) => void;
}

interface RealConflictGateDepsOverrides {
  spawnRun?: typeof spawnRun;
  messageAgent?: typeof messageAgent;
  getFacts?: (issueId: string) => PrFacts | Promise<PrFacts>;
  emitActivityEntry?: typeof emitActivityEntrySync;
  now?: () => Date;
  log?: (message: string) => void;
}

const PROBE_CACHE_MAX_ENTRIES = 256;

const probeCache = new Map<string, { checkedAtMs: number; result: BranchMergeability }>();
const probeInFlight = new Map<string, Promise<BranchMergeability>>();

export interface BranchConflictProbeResult {
  mergeability: BranchMergeability;
  paths: string[];
}

/**
 * Non-destructively checks whether HEAD can merge with origin/<targetBranch>,
 * returning the conflicting paths (if any). Uses git merge-tree only — never
 * git merge — so HEAD, the index, and the working tree are left untouched.
 */
export async function probeBranchConflictPaths(
  workspacePath: string,
  targetBranch: string,
  deps: CheckBranchMergeabilityDeps = {},
): Promise<BranchConflictProbeResult> {
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
    return { mergeability: 'unknown', paths: [] };
  }

  try {
    const result = await run(
      `git merge-tree --write-tree --name-only HEAD ${shellQuote(`origin/${targetBranch}`)}`,
      options,
    );
    if (outputHasConflictMarker(result.stdout, result.stderr)) {
      return { mergeability: 'conflicts', paths: parseMergeTreeNameOnly(toText(result.stdout)) };
    }
    return { mergeability: 'clean', paths: [] };
  } catch (err) {
    if (mergeTreeFailureIndicatesConflict(err)) {
      const maybe = err as { stdout?: unknown };
      return { mergeability: 'conflicts', paths: parseMergeTreeNameOnly(toText(maybe.stdout)) };
    }
    return { mergeability: 'unknown', paths: [] };
  }
}

/**
 * Non-destructively checks whether HEAD can merge with origin/<targetBranch>.
 * Thin wrapper over probeBranchConflictPaths — kept for callers that only
 * need the tri-state result.
 */
export async function checkBranchMergeability(
  workspacePath: string,
  targetBranch: string,
  deps: CheckBranchMergeabilityDeps = {},
): Promise<BranchMergeability> {
  return (await probeBranchConflictPaths(workspacePath, targetBranch, deps)).mergeability;
}

/**
 * Parses `git merge-tree --write-tree --name-only` stdout. Line 1 is the
 * tree OID; subsequent lines up to (not including) the first blank line are
 * the conflicting paths.
 */
export function parseMergeTreeNameOnly(stdout: string): string[] {
  const lines = stdout.split('\n');
  const paths: string[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === '') break;
    paths.push(line);
  }
  return paths;
}

export function buildRealConflictGateDeps(overrides: RealConflictGateDepsOverrides = {}): ResolveConflictGateDeps {
  const runSpawn = overrides.spawnRun ?? spawnRun;
  const deliverMessage = overrides.messageAgent ?? messageAgent;
  const emitActivity = overrides.emitActivityEntry ?? emitActivityEntrySync;
  const now = overrides.now ?? (() => new Date());

  return {
    getFacts: overrides.getFacts ?? getPrFacts,
    probeMergeability: checkBranchMergeability,
    now,
    log: overrides.log,
    dispatchResolver: async (input) => {
      const prompt = buildConflictResolverPrompt(input);
      let dispatchState: ResolverDispatchState = 'dispatched';
      try {
        await runSpawn(input.issueId, 'work', { prompt, startedBy: 'conflict-gate' });
      } catch (err) {
        if (isAlreadyRunningError(err)) {
          await deliverMessage(`agent-${input.issueId.toLowerCase()}`, prompt, 'conflict-gate');
          dispatchState = 'already_running';
          overrides.log?.(`[conflict-gate] ${input.issueId}: conflict resolver already running; delivered resolver prompt`);
        } else {
          throw err;
        }
      }

      lastResolverDispatchMs.set(input.issueId.toUpperCase(), now().getTime());
      emitActivity({
        source: 'review',
        level: 'info',
        issueId: input.issueId,
        message: dispatchState === 'already_running'
          ? `Review deferred — conflict resolver already running for ${input.issueId}; delivered resolver prompt`
          : `Review deferred — conflict resolver dispatched for ${input.issueId}`,
        details: input.reason,
      });
      return dispatchState;
    },
  };
}

export async function resolveConflictGate(
  issueId: string,
  workspacePath: string,
  targetBranch: string,
  deps: ResolveConflictGateDeps,
): Promise<ConflictGateResult> {
  const facts = await deps.getFacts(issueId);
  const blockerSummary = describeMergeBlock(facts);
  if (!blockerSummary) return { gated: false };

  const now = deps.now ?? (() => new Date());
  const checkedAtMs = now().getTime();
  const mergeability = await getCachedMergeability(issueId, checkedAtMs, workspacePath, targetBranch, deps);

  if (mergeability === 'clean') {
    // The forge's mergeability is computed against a snapshot and goes stale;
    // a clean local probe is the newer answer, so review proceeds.
    deps.log?.(`[conflict-gate] ${issueId}: forge reports a merge block the branch no longer has; review can proceed`);
    return { gated: false, clearedStaleBlocker: true };
  }

  const reason = mergeability === 'conflicts'
    ? `merge conflict with ${targetBranch} must be resolved before review dispatch`
    : `mergeability against ${targetBranch} could not be verified; deferring review conservatively`;

  let resolverDispatchState: ResolverDispatchState;
  if (!isResolverDispatchThrottled(issueId, checkedAtMs)) {
    resolverDispatchState = await deps.dispatchResolver({
      issueId,
      workspacePath,
      targetBranch,
      blockerSummary,
      reason,
    }) ?? 'dispatched';
  } else {
    resolverDispatchState = 'throttled';
    deps.log?.(`[conflict-gate] ${issueId}: conflict resolver dispatch is throttled`);
  }

  return {
    gated: true,
    reason: `${reason}; ${formatResolverDispatchState(resolverDispatchState)}`,
    resolverDispatchState,
  };
}

export function __resetConflictGateProbeCacheForTests(): void {
  probeCache.clear();
  probeInFlight.clear();
  lastResolverDispatchMs.clear();
}

/**
 * Synchronous, non-blocking read of the conflict-gate probe cache.
 * Returns the cached mergeability result only when a fresh value is available;
 * returns undefined when the cache is absent or stale. This function performs
 * NO I/O and NO status writes so it is safe on HTTP request hot paths.
 */
export function getCachedConflictGateMergeability(
  issueId: string,
): BranchMergeability | undefined {
  const nowMs = Date.now();
  sweepExpiredProbeCache(nowMs);
  const key = issueId.toUpperCase();
  const cached = probeCache.get(key);
  if (cached && nowMs - cached.checkedAtMs < PROBE_CACHE_MS) return cached.result;
  return undefined;
}

async function getCachedMergeability(
  issueId: string,
  nowMs: number,
  workspacePath: string,
  targetBranch: string,
  deps: ResolveConflictGateDeps,
): Promise<BranchMergeability> {
  const key = issueId.toUpperCase();
  sweepExpiredProbeCache(nowMs);
  const cached = probeCache.get(key);
  if (cached && nowMs - cached.checkedAtMs < PROBE_CACHE_MS) return cached.result;

  const existing = probeInFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const result = await (deps.probeMergeability ?? checkBranchMergeability)(workspacePath, targetBranch);
      // Move to end for LRU ordering, then enforce size cap.
      probeCache.delete(key);
      probeCache.set(key, { checkedAtMs: nowMs, result });
      enforceProbeCacheSizeLimit();
      return result;
    } finally {
      probeInFlight.delete(key);
    }
  })();

  probeInFlight.set(key, promise);
  return promise;
}

/**
 * PAN-3917: the dispatch timestamp used to live on the review_status row. It is
 * bookkeeping for this process's own dispatches, not pipeline state, so it
 * lives here. A restart re-arms the gate, which costs one extra resolver
 * dispatch — the resolver itself is idempotent.
 */
const lastResolverDispatchMs = new Map<string, number>();

function isResolverDispatchThrottled(issueId: string, nowMs: number): boolean {
  const dispatchedAtMs = lastResolverDispatchMs.get(issueId.toUpperCase());
  if (dispatchedAtMs === undefined) return false;
  return nowMs - dispatchedAtMs < DISPATCH_THROTTLE_MS;
}

function formatResolverDispatchState(state: ResolverDispatchState): string {
  switch (state) {
    case 'already_running':
      return 'conflict resolver already running; resolver prompt delivered';
    case 'throttled':
      return 'conflict resolver dispatch throttled';
    case 'dispatched':
      return 'conflict resolver dispatched';
  }
}

function sweepExpiredProbeCache(nowMs: number): void {
  for (const [key, cached] of probeCache.entries()) {
    if (nowMs - cached.checkedAtMs >= PROBE_CACHE_MS) probeCache.delete(key);
  }
}

function enforceProbeCacheSizeLimit(): void {
  while (probeCache.size > PROBE_CACHE_MAX_ENTRIES) {
    const first = probeCache.keys().next().value;
    if (first) probeCache.delete(first);
  }
}

/** One line describing why the forge says the PR cannot merge, or null. */
function describeMergeBlock(facts: PrFacts): string | null {
  if (!facts.open) return null;
  if (facts.mergeable === false) {
    return `forge reports the pull request is not mergeable${facts.mergeableState ? ` (state=${facts.mergeableState})` : ''}`;
  }
  const state = (facts.mergeableState ?? '').toLowerCase();
  if (state && CONFLICTING_MERGE_STATES.has(state)) {
    return `forge reports merge state \`${state}\``;
  }
  return null;
}

function buildConflictResolverPrompt(input: DispatchResolverInput): string {
  const blockerSummary = `- ${input.blockerSummary}`;

  return [
    `Review for ${input.issueId} was deferred because the feature branch has a standing merge conflict with origin/${input.targetBranch}.`,
    '',
    'Resolve the conflict WITHOUT degrading either side of the change:',
    `1. Read what origin/${input.targetBranch} changed and what ${input.issueId} intended before editing.`,
    `2. Run pan sync-main ${input.issueId} to merge origin/${input.targetBranch} through the repository-approved sync path, then resolve every conflict so BOTH intents are preserved.`,
    '3. Build, run the relevant tests, and commit the resolved state.',
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
