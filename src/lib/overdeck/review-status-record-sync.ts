import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ReviewStatus } from '../review-status.js';
import { updateIssueRecordForIssue, type PanIssuePipelineRecord } from '../pan-dir/records.js';
import { readIssueRecordSync } from '../pan-dir/record.js';
import { resolveProjectFromIssueSync, getProjectSync } from '../projects.js';

// PAN-2689: fire-and-forget journal writes die with the process in a short-lived
// CLI (pan admin specialists done exits in <1s; the record write + fallback chain
// takes seconds). Track every in-flight write so CLI entry points can drain them
// before process.exit — the long-lived server never needs to await these.
const pendingJournalWrites = new Set<Promise<void>>();

export function updateIssueRecordForReviewStatusSync(issueId: string, status: ReviewStatus): void {
  // PAN-2583: the state-dir journal is the durable home, but a sandboxed reviewer
  // (codex workspace-write) cannot write ${OVERDECK_HOME}/state — and swallowing that
  // failure here is how blocked review verdicts silently vanished for hours. When the
  // journal write does not land, drop the durable verdict into the workspace runtime
  // dir (the one place a sandboxed agent can always write); readJournalStatusSync
  // overlays it on the next host-side read.
  const write = Promise.resolve(updateIssueRecordForIssue(issueId, status))
    .then((landed) => {
      // Only an explicit `false` means the durable write failed — undefined
      // (e.g. a test double) is "unknown", not "failed".
      if (landed === false) {
        writeWorkspaceVerdictFallbackSync(issueId, status);
        scheduleVerdictFallbackDrain(issueId);
      } else if (landed === true) {
        // PAN-2989: a landed journal write is the earliest safe moment to fold any
        // pending workspace fallback back into the canonical record.
        trackVerdictFallbackDrain(issueId);
      }
    })
    .catch(() => {
      writeWorkspaceVerdictFallbackSync(issueId, status);
      scheduleVerdictFallbackDrain(issueId);
    });
  pendingJournalWrites.add(write);
  void write.finally(() => pendingJournalWrites.delete(write));
}

/**
 * PAN-2689: await every in-flight journal write. A short-lived CLI process MUST
 * call this before process.exit or the verdict written by setReviewStatusSync is
 * silently lost (the DB write already fails readonly in a sandbox, so the dying
 * journal write was the only durable copy).
 */
export async function flushReviewStatusJournalWrites(): Promise<void> {
  while (pendingJournalWrites.size > 0) {
    await Promise.allSettled([...pendingJournalWrites]);
  }
}

/** Resolve and read the per-issue journal record's pipeline block, or null. Best-effort. */
function readPipelineSync(issueId: string): PanIssuePipelineRecord | null {
  try {
    const resolved = resolveProjectFromIssueSync(issueId);
    if (!resolved) return null;
    const project = getProjectSync(resolved.projectKey);
    if (!project) return null;
    const record = readIssueRecordSync(project, issueId);
    return record?.pipeline ?? null;
  } catch {
    return null;
  }
}

/**
 * PAN-1988: feedback TEXT (review / test / merge / inspect / verification notes) is durable
 * JOURNAL state, not DB-cache state. The SQLite row holds only the queryable status flags;
 * the human-readable notes live in the per-issue git record (`<workspace>/.pan/records/<issue>.json`,
 * PAN-1908). This overlays those notes onto a DB-sourced status so every reader (deacon
 * CI-failure detection, dashboard panels) stays transparent while the DB stops storing them.
 */
export function enrichReviewNotesFromRecordSync(issueId: string, status: ReviewStatus): ReviewStatus {
  const pipeline = readPipelineSync(issueId);
  if (!pipeline) return status;
  return {
    ...status,
    reviewNotes: pipeline.reviewNotes ?? status.reviewNotes,
    testNotes: pipeline.testNotes ?? status.testNotes,
    mergeNotes: pipeline.mergeNotes ?? status.mergeNotes,
    inspectNotes: pipeline.inspectNotes ?? status.inspectNotes,
    verificationNotes: pipeline.verificationNotes ?? status.verificationNotes,
    scopeDrift: pipeline.scopeDrift ?? status.scopeDrift,
    // PAN-1988 auto-heal: the durable review-request intent is journal-only — overlay it on every
    // read so the merge base preserves it through partial updates and the dispatch reconcile sees it.
    reviewRequestedAt: pipeline.reviewRequestedAt ?? status.reviewRequestedAt,
  };
}

type DurableStatusFields = Partial<ReviewStatus> & { closedOut?: boolean; closedOutAt?: string };

const FALLBACK_CLEARABLE_FIELDS = [
  'strikeTransportRetryCount',
  'strikeNextAttemptAt',
] as const;
type FallbackClearableField = typeof FALLBACK_CLEARABLE_FIELDS[number];

/**
 * The durable field subset shared by the journal record's pipeline block and the
 * workspace verdict fallback (PAN-2583). Derived/live columns (readyForMerge,
 * blockerReasons) are intentionally omitted — the reader recomputes them.
 */
function durableSubset(p: PanIssuePipelineRecord): DurableStatusFields {
  return {
    reviewStatus: p.reviewStatus as ReviewStatus['reviewStatus'],
    testStatus: p.testStatus as ReviewStatus['testStatus'],
    mergeStatus: (p.mergeStatus as ReviewStatus['mergeStatus']) ?? undefined,
    inspectStatus: (p.inspectStatus as ReviewStatus['inspectStatus']) ?? undefined,
    verificationStatus: (p.verificationStatus as ReviewStatus['verificationStatus']) ?? undefined,
    reviewNotes: p.reviewNotes,
    testNotes: p.testNotes,
    mergeNotes: p.mergeNotes,
    inspectNotes: p.inspectNotes,
    verificationNotes: p.verificationNotes,
    scopeDrift: p.scopeDrift,
    prUrl: p.prUrl,
    prNumber: p.prNumber,
    prHeadSha: p.prHeadSha,
    reviewedAtCommit: p.reviewedAtCommit,
    lastVerifiedCommit: p.lastVerifiedCommit,
    reviewRequestedAt: p.reviewRequestedAt,
    reviewSpawnedAt: p.reviewSpawnedAt,
    reviewerVerdicts: p.reviewerVerdicts as ReviewStatus['reviewerVerdicts'],
    autoMerge: p.autoMerge,
    deaconIgnored: p.deaconIgnored,
    deaconIgnoredAt: p.deaconIgnoredAt,
    deaconIgnoredReason: p.deaconIgnoredReason,
    strikeReadyHead: p.strikeReadyHead,
    strikeReadyAt: p.strikeReadyAt,
    strikeLandingState: p.strikeLandingState,
    strikeRecoveryCount: p.strikeRecoveryCount,
    strikeTransportRetryCount: p.strikeTransportRetryCount,
    strikeNextAttemptAt: p.strikeNextAttemptAt,
    strikeLandingAttempts: p.strikeLandingAttempts,
    closedOut: p.closedOut,
    closedOutAt: p.closedOutAt,
  };
}

/**
 * PAN-2583: sandbox-writable emergency drop for a verdict whose state-dir journal
 * write failed. Lives in the workspace runtime dir (gitignored), swept by
 * readJournalStatusSync on the next host-side read.
 */
interface WorkspaceVerdictFallback {
  issueId: string;
  updatedAt: string;
  pipeline: DurableStatusFields;
  clearedFields?: FallbackClearableField[];
}

export function workspaceVerdictFallbackPath(issueId: string): string | null {
  try {
    const resolved = resolveProjectFromIssueSync(issueId);
    if (!resolved) return null;
    return join(
      resolved.projectPath,
      'workspaces',
      `feature-${issueId.toLowerCase()}`,
      '.overdeck',
      'pipeline-verdict.json',
    );
  } catch {
    return null;
  }
}

function writeWorkspaceVerdictFallbackSync(issueId: string, status: ReviewStatus): void {
  try {
    const path = workspaceVerdictFallbackPath(issueId);
    if (!path) {
      console.error(
        `[review-status] PAN-2583: journal write failed for ${issueId} and no workspace could be resolved — the verdict is NOT durable`,
      );
      return;
    }
    mkdirSync(dirname(path), { recursive: true });
    const clearedFields = FALLBACK_CLEARABLE_FIELDS.filter(
      (field) => status[field] === undefined,
    );
    const payload: WorkspaceVerdictFallback = {
      issueId: issueId.toUpperCase(),
      updatedAt: status.updatedAt ?? new Date().toISOString(),
      pipeline: durableSubset(status as unknown as PanIssuePipelineRecord),
      ...(clearedFields.length > 0 ? { clearedFields } : {}),
    };
    // Atomic replace: a drain may claim the live path by rename at any moment,
    // and a plain writeFileSync could be renamed aside mid-write and fold a
    // torn payload into the canonical record.
    const tmpPath = `${path}.tmp-${process.pid}`;
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
    renameSync(tmpPath, path);
    console.warn(
      `[review-status] journal write failed for ${issueId} — durable verdict written to workspace fallback ${path}; the host sweeps it on the next status read (PAN-2583)`,
    );
  } catch (err) {
    console.error(
      `[review-status] PAN-2583: could not persist verdict for ${issueId} anywhere durable: ${(err as Error).message}`,
    );
  }
}

function parseWorkspaceVerdictFallback(path: string): WorkspaceVerdictFallback | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as WorkspaceVerdictFallback;
    if (!parsed?.updatedAt || !parsed.pipeline) return null;
    const clearedFields = Array.isArray(parsed.clearedFields)
      ? parsed.clearedFields.filter((field): field is FallbackClearableField =>
          typeof field === 'string' && (FALLBACK_CLEARABLE_FIELDS as readonly string[]).includes(field))
      : [];
    return { ...parsed, clearedFields };
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function drainClaimPid(entry: string, prefix: string): number | null {
  const pid = Number(entry.slice(prefix.length).split('-')[0]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/**
 * A process that crashed mid-drain leaves its claimed generation beside the
 * live path (`<fallback>.drain-<pid>-<n>`). A claim owned by a dead pid belongs
 * to nobody — recover it. When the live path is free the claim is handed back
 * wholesale; when a live generation already exists the two are compared on
 * ISO `updatedAt` and only the newer payload survives. Recovery must never
 * rename over an existing live path blindly: POSIX rename replaces the
 * destination, so an older stranded claim would silently delete a newer
 * verdict written after the crash.
 */
function recoverStrandedDrainClaimsSync(livePath: string): void {
  try {
    const prefix = `${basename(livePath)}.drain-`;
    for (const entry of readdirSync(dirname(livePath))) {
      if (!entry.startsWith(prefix)) continue;
      const pid = drainClaimPid(entry, prefix);
      if (pid !== null && isPidAlive(pid)) continue; // an in-flight drain owns it
      const claimPath = join(dirname(livePath), entry);
      if (!existsSync(livePath)) {
        try {
          renameSync(claimPath, livePath);
        } catch {
          // Raced another recovery or a fresh write; the generation still exists.
        }
        continue;
      }
      const claim = parseWorkspaceVerdictFallback(claimPath);
      const live = parseWorkspaceVerdictFallback(livePath);
      if (claim && (!live || live.updatedAt < claim.updatedAt)) {
        // The stranded claim is strictly newer: swap it in. The claim is a
        // complete file (claims are created by renaming a complete write), so
        // replacing the older live payload loses nothing.
        try {
          renameSync(claimPath, livePath);
        } catch {
          // Raced a concurrent writer; keep the claim for a later pass.
        }
      } else {
        // The live generation is newer (or the claim is unreadable): the claim
        // carries nothing the live path does not supersede.
        rmSync(claimPath, { force: true });
      }
    }
  } catch {
    // Best effort — a stranded claim is recovered on a later pass.
  }
}

let drainClaimCounter = 0;

/**
 * Claim the live fallback generation by renaming it aside (atomic same-dir
 * rename), so a concurrent verdict write creates a NEW generation at the live
 * path instead of being check-then-deleted mid-fold. Review finding: a drain
 * that deletes the shared path after awaiting the record write can remove a
 * newer fallback written while it was suspended.
 */
function claimWorkspaceVerdictFallbackSync(
  issueId: string,
): { claimPath: string; fallback: WorkspaceVerdictFallback } | null {
  const path = workspaceVerdictFallbackPath(issueId);
  if (!path) return null;
  recoverStrandedDrainClaimsSync(path);
  if (!existsSync(path)) return null;
  drainClaimCounter += 1;
  const claimPath = `${path}.drain-${process.pid}-${drainClaimCounter}`;
  try {
    renameSync(path, claimPath);
  } catch {
    return null; // another drain claimed it first; that drain owns the generation
  }
  const fallback = parseWorkspaceVerdictFallback(claimPath);
  if (!fallback) {
    rmSync(claimPath, { force: true });
    return null;
  }
  return { claimPath, fallback };
}

function readWorkspaceVerdictFallbackSync(issueId: string): WorkspaceVerdictFallback | null {
  try {
    const path = workspaceVerdictFallbackPath(issueId);
    if (!path) return null;
    recoverStrandedDrainClaimsSync(path);
    // Read-only newest-wins overlay across the live path AND any in-flight
    // drain claims: a drain holds its generation at a claim path for the full
    // duration of the record write, and the verdict must stay visible to
    // readers throughout — otherwise status reads fall back to the older
    // journal for up to the entire durability budget. Reads never mutate.
    let newest: WorkspaceVerdictFallback | null = null;
    const consider = (candidate: WorkspaceVerdictFallback | null): void => {
      if (candidate && (!newest || newest.updatedAt < candidate.updatedAt)) newest = candidate;
    };
    if (existsSync(path)) consider(parseWorkspaceVerdictFallback(path));
    const prefix = `${basename(path)}.drain-`;
    for (const entry of readdirSync(dirname(path))) {
      if (!entry.startsWith(prefix)) continue;
      consider(parseWorkspaceVerdictFallback(join(dirname(path), entry)));
    }
    return newest;
  } catch {
    return null;
  }
}

// PAN-2989: proactive drain of the workspace verdict fallback. Before this, nothing
// ever folded a fallback back into the canonical record — observed 2026-07-21 on
// PAN-806: the canonical journal lagged the truth for ~an hour after a stalled lock
// forced verdict writes to the fallback. The drain runs after every landed journal
// write for the issue, and on unref'd scheduled retries after a fallback write.
const DRAIN_RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const;
const drainTimers = new Map<string, NodeJS.Timeout>();

/**
 * Fold a pending workspace verdict fallback into the canonical record and delete
 * it, without waiting for the next status read. Newer-wins on ISO `updatedAt` —
 * the same rule readJournalStatusSync uses — so a journal that already moved past
 * the fallback just cleans up the file. Returns true when no fallback remains
 * pending (drained, superseded, or never written).
 *
 * Generation-aware: the drain claims exactly the generation it read via an
 * atomic rename and deletes only that claim. A newer fallback written while the
 * record write was in flight stays at the live path for its own drain schedule.
 */
export async function drainWorkspaceVerdictFallback(issueId: string): Promise<boolean> {
  const claimed = claimWorkspaceVerdictFallbackSync(issueId);
  if (!claimed) return true;
  const { claimPath, fallback } = claimed;
  const journal = readPipelineSync(issueId);
  if (journal?.updatedAt && !(journal.updatedAt < fallback.updatedAt)) {
    rmSync(claimPath, { force: true });
    return true;
  }
  // projectPipeline projects only from the ReviewStatus, so fields the fallback
  // cleared (clearedFields) stay absent and do not resurrect from the record.
  const status = {
    issueId: fallback.issueId,
    ...fallback.pipeline,
    updatedAt: fallback.updatedAt,
    readyForMerge: false, // derived on read; the stored value is never consulted
  } as ReviewStatus;
  const landed = await updateIssueRecordForIssue(issueId, status);
  if (landed) {
    rmSync(claimPath, { force: true });
    return true;
  }
  // The fold failed: hand the claimed generation back to the live path unless a
  // newer generation replaced it there while we awaited — the newer one carries
  // the newer verdict and its own drain schedule is already armed.
  const livePath = workspaceVerdictFallbackPath(issueId);
  if (livePath && !existsSync(livePath)) {
    try {
      renameSync(claimPath, livePath);
      return false;
    } catch {
      // Raced a concurrent write; fall through to dropping the older claim.
    }
  }
  rmSync(claimPath, { force: true });
  return false;
}

/** Track a fire-and-forget drain so short-lived CLIs await it before exit. */
function trackVerdictFallbackDrain(issueId: string): void {
  const drain = drainWorkspaceVerdictFallback(issueId)
    .then(() => undefined)
    .catch(() => undefined);
  pendingJournalWrites.add(drain);
  void drain.finally(() => pendingJournalWrites.delete(drain));
}

/**
 * Schedule unref'd drain retries after a fallback write. One timer per issue —
 * a new fallback write resets the schedule. Retries stop on success, on
 * exhaustion, or when the fallback file is gone.
 */
function scheduleVerdictFallbackDrain(issueId: string): void {
  const key = issueId.toUpperCase();
  const existing = drainTimers.get(key);
  if (existing) clearTimeout(existing);

  const attempt = (index: number): void => {
    const delay = DRAIN_RETRY_DELAYS_MS[index];
    if (delay === undefined) {
      drainTimers.delete(key);
      return;
    }
    const timer = setTimeout(() => {
      drainTimers.delete(key);
      void drainWorkspaceVerdictFallback(key)
        .catch(() => false)
        .then((drained) => {
          if (!drained) attempt(index + 1);
        });
    }, delay);
    timer.unref?.();
    drainTimers.set(key, timer);
  };
  attempt(0);
}

/**
 * PAN-1988: read the journal record's durable verdict for an issue — the SOURCE OF TRUTH.
 * Returns the record `updatedAt` (used to decide whether the journal is newer than the DB
 * cache) plus the durable status fields (flags + feedback notes). Derived/live columns
 * (readyForMerge, blockerReasons) are intentionally omitted — the reader recomputes them.
 *
 * This is what makes verdict writes host-owned: a sandboxed agent can always write the journal
 * (workspace-local) even when it cannot write `~/.overdeck/overdeck.db`. The host reconciles
 * the cache from this on read, so no agent has to escalate out of its sandbox to record a verdict.
 *
 * PAN-2583: since the records migration (PAN-2541) the journal itself lives in
 * ${OVERDECK_HOME}/state, which a sandboxed reviewer cannot write either. When such a
 * writer dropped its verdict into the workspace fallback instead, overlay it here —
 * a strictly newer fallback wins over the record, and the host's own next journal
 * write folds it back into the canonical record.
 */
export function readJournalStatusSync(
  issueId: string,
): { updatedAt: string; durable: DurableStatusFields; clearedFields?: FallbackClearableField[] } | null {
  const p = readPipelineSync(issueId);
  const fallback = readWorkspaceVerdictFallbackSync(issueId);
  const fallbackNewer = !!fallback && (!p || (p.updatedAt ?? '') < fallback.updatedAt);
  if (fallback && fallbackNewer) {
    const base = p ? durableSubset(p) : {};
    const overlay = Object.fromEntries(
      Object.entries(fallback.pipeline).filter(([, value]) => value !== undefined),
    ) as DurableStatusFields;
    const durable = { ...base, ...overlay };
    for (const field of fallback.clearedFields ?? []) delete durable[field];
    return {
      updatedAt: fallback.updatedAt,
      durable,
      ...(fallback.clearedFields?.length ? { clearedFields: fallback.clearedFields } : {}),
    };
  }
  if (!p) return null;
  return { updatedAt: p.updatedAt, durable: durableSubset(p) };
}
