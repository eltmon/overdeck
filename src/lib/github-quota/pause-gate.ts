/**
 * PAN-4264: the cross-process GitHub pause gate.
 *
 * Any process that sees GitHub refuse a call for a rate limit records it here
 * with `recordGitHubRefusal`. That writes `~/.overdeck/github-quota/pause.json`
 * (atomic tmp + rename) with a pause for the refused pool and bucket, sized by
 * the FR-5 rules. Every process checks the file with `assertGitHubCallAllowed`
 * before a metered call: non-essential read-model pollers skip GitHub until
 * the pause ends, while essential callers (merge, verdicts, tracker writes,
 * agents) are never paused. A pause blocks only its exact `(pool, bucket)`.
 *
 * The secondary-limit back-off counter lives in the same file, because the
 * next refusal may be observed by a different process (dashboard, deacon
 * child, CLI). Concurrent writers race last-writer-wins; both writers are
 * recording a refusal, so either result pauses the bucket.
 *
 * This module never imports telemetry (NFR-8). Telemetry subscribes with
 * `onGitHubRefusal`.
 */

import { readFileSync, statSync } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  NON_ESSENTIAL_GITHUB_CALLERS,
  type GitHubQuotaBucket,
  type GitHubQuotaCaller,
  type GitHubQuotaPause,
  type GitHubQuotaPool,
  type GitHubRateLimitKind,
} from '@overdeck/contracts';
import type { GitHubRefusal } from './classify.js';
import {
  aggregateLedger,
  appendLedgerEntry,
  computeOwnUsageLow,
  getGitHubQuotaDir,
  readLedgerWindow,
  type LedgerEntryInput,
} from './ledger.js';

/** A pause as stored in `pause.json` and published in the quota snapshot. */
export type PauseRecord = GitHubQuotaPause;

/** Shortest pause for a primary limit paused from an `x-ratelimit-reset` header. */
export const PRIMARY_PAUSE_FLOOR_MS = 60_000;
/** Pause for a primary limit whose cause this token cannot see. */
export const HIDDEN_PRIMARY_PAUSE_MS = 10 * 60_000;
/** First secondary pause without `retry-after`; doubles per consecutive refusal. */
export const SECONDARY_BASE_PAUSE_MS = 60_000;
/** Cap on the doubled secondary pause. */
export const SECONDARY_MAX_PAUSE_MS = 15 * 60_000;
/** Secondary refusals further apart than this restart the doubling. */
export const SECONDARY_STREAK_WINDOW_MS = 30 * 60_000;

interface SecondaryBackoff {
  consecutive: number;
  lastAt: string;
}

interface PauseFile {
  pauses: Record<string, PauseRecord>;
  secondaryBackoff: Record<string, SecondaryBackoff>;
}

export interface GitHubRefusalEvent {
  caller: GitHubQuotaCaller;
  pool: GitHubQuotaPool;
  bucket: GitHubQuotaBucket;
  kind: GitHubRateLimitKind;
  ownUsageLow: boolean;
}

type GitHubRefusalListener = (event: GitHubRefusalEvent) => void;

function formatLocalTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function pauseMessage(bucket: GitHubQuotaBucket, untilMs: number, kind: GitHubRateLimitKind): string {
  const cause = kind === 'secondary' ? 'secondary rate limit' : 'rate limit';
  return `GitHub ${bucket} calls paused until ${formatLocalTime(untilMs)} (${cause})`;
}

/** GitHub refused a call for a rate limit. Never read it as "no data". */
export class GitHubRateLimitedError extends Error {
  readonly pool: GitHubQuotaPool;
  readonly bucket: GitHubQuotaBucket;
  readonly kind: GitHubRateLimitKind;
  /** ISO time the resulting pause ends. */
  readonly until: string;

  constructor(pause: PauseRecord, options?: { cause?: unknown }) {
    super(pauseMessage(pause.bucket, Date.parse(pause.until), pause.kind), options);
    this.name = 'GitHubRateLimitedError';
    this.pool = pause.pool;
    this.bucket = pause.bucket;
    this.kind = pause.kind;
    this.until = pause.until;
  }
}

/** A non-essential call was skipped because its pool and bucket are paused. */
export class GitHubQuotaPausedError extends Error {
  readonly pool: GitHubQuotaPool;
  readonly bucket: GitHubQuotaBucket;
  readonly kind: GitHubRateLimitKind;
  /** ISO time the pause ends. */
  readonly until: string;

  constructor(pause: PauseRecord) {
    super(pauseMessage(pause.bucket, Date.parse(pause.until), pause.kind));
    this.name = 'GitHubQuotaPausedError';
    this.pool = pause.pool;
    this.bucket = pause.bucket;
    this.kind = pause.kind;
    this.until = pause.until;
  }
}

function pauseKey(pool: GitHubQuotaPool, bucket: GitHubQuotaBucket): string {
  return `${pool}:${bucket}`;
}

function pauseFilePath(): string {
  return join(getGitHubQuotaDir(), 'pause.json');
}

function emptyPauseFile(): PauseFile {
  return { pauses: {}, secondaryBackoff: {} };
}

function isPauseRecord(value: unknown): value is PauseRecord {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.pool === 'string'
    && typeof v.bucket === 'string'
    && (v.kind === 'primary' || v.kind === 'secondary')
    && typeof v.caller === 'string'
    && typeof v.since === 'string'
    && typeof v.until === 'string'
    && Number.isFinite(Date.parse(v.until));
}

function parsePauseFile(raw: string): PauseFile {
  const parsed: unknown = JSON.parse(raw);
  const file = emptyPauseFile();
  if (parsed === null || typeof parsed !== 'object') return file;
  const { pauses, secondaryBackoff } = parsed as Record<string, unknown>;
  if (pauses && typeof pauses === 'object') {
    for (const [key, value] of Object.entries(pauses)) {
      if (isPauseRecord(value)) file.pauses[key] = value;
    }
  }
  if (secondaryBackoff && typeof secondaryBackoff === 'object') {
    for (const [key, value] of Object.entries(secondaryBackoff)) {
      const v = value as Partial<SecondaryBackoff> | null;
      if (v && typeof v.consecutive === 'number' && typeof v.lastAt === 'string') {
        file.secondaryBackoff[key] = { consecutive: v.consecutive, lastAt: v.lastAt };
      }
    }
  }
  return file;
}

let cache: { key: string; file: PauseFile } | null = null;

function cacheKey(path: string, mtimeMs: number, size: number): string {
  return `${path}:${mtimeMs}:${size}`;
}

/** Sync, bounded read of `pause.json`, cached on path + mtime + size. */
function readPauseFile(): PauseFile {
  const path = pauseFilePath();
  try {
    const stats = statSync(path);
    const key = cacheKey(path, stats.mtimeMs, stats.size);
    if (cache?.key === key) return cache.file;
    const file = parsePauseFile(readFileSync(path, 'utf8'));
    cache = { key, file };
    return file;
  } catch {
    return emptyPauseFile();
  }
}

async function writePauseFile(file: PauseFile): Promise<void> {
  const path = pauseFilePath();
  await mkdir(getGitHubQuotaDir(), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`);
  await rename(tmp, path);
  // Refresh the cache from what this process just wrote, so a second write
  // inside the same mtime tick is never shadowed by a stale cached read.
  const stats = await stat(path);
  cache = { key: cacheKey(path, stats.mtimeMs, stats.size), file };
}

/** Active (unexpired) pauses, read from `pause.json`. */
export function readActivePause(nowMs: number = Date.now()): PauseRecord[] {
  return Object.values(readPauseFile().pauses).filter((pause) => Date.parse(pause.until) > nowMs);
}

/** The active pause on exactly `(pool, bucket)`, if any. */
export function activeGitHubPause(
  pool: GitHubQuotaPool,
  bucket: GitHubQuotaBucket,
  nowMs: number = Date.now(),
): PauseRecord | undefined {
  return readActivePause(nowMs).find((p) => p.pool === pool && p.bucket === bucket);
}

/**
 * Throw `GitHubQuotaPausedError` when `caller` is non-essential and a pause is
 * active on exactly `(pool, bucket)`. Essential callers always pass.
 */
export function assertGitHubCallAllowed(
  caller: GitHubQuotaCaller,
  pool: GitHubQuotaPool,
  bucket: GitHubQuotaBucket,
  nowMs: number = Date.now(),
): void {
  if (!NON_ESSENTIAL_GITHUB_CALLERS.has(caller)) return;
  const pause = activeGitHubPause(pool, bucket, nowMs);
  if (pause) throw new GitHubQuotaPausedError(pause);
}

const listeners = new Set<GitHubRefusalListener>();

/** Subscribe to recorded refusals. Returns the unsubscribe function. */
export function onGitHubRefusal(listener: GitHubRefusalListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface RecordGitHubRefusalInput {
  pool: GitHubQuotaPool;
  bucket: GitHubQuotaBucket;
  caller: GitHubQuotaCaller;
  refusal: GitHubRefusal;
  nowMs?: number;
  /** Extra fields for the refused call's ledger line (defaults: cost 1, estimated). */
  ledger?: Partial<Pick<LedgerEntryInput, 'cost' | 'estimated' | 'remaining' | 'limit' | 'resetAt'>>;
}

function primaryPauseUntil(input: RecordGitHubRefusalInput, nowMs: number): number {
  const floor = nowMs + PRIMARY_PAUSE_FLOOR_MS;
  if (input.refusal.resetAtSec !== undefined) {
    return Math.max(input.refusal.resetAtSec * 1000, floor);
  }

  const sample = aggregateLedger(readLedgerWindow(nowMs)).samples[input.pool]?.[input.bucket];
  const resetMs = sample?.resetAt ? Date.parse(sample.resetAt) : Number.NaN;

  if (Number.isFinite(resetMs) && resetMs > nowMs) {
    return sample!.remaining === 0 ? resetMs : Math.min(nowMs + HIDDEN_PRIMARY_PAUSE_MS, resetMs);
  }

  return nowMs + HIDDEN_PRIMARY_PAUSE_MS;
}

function secondaryPauseUntil(
  input: RecordGitHubRefusalInput,
  nowMs: number,
  file: PauseFile,
): number {
  const key = pauseKey(input.pool, input.bucket);
  const previous = file.secondaryBackoff[key];
  const previousMs = previous ? Date.parse(previous.lastAt) : Number.NaN;
  const inStreak = Number.isFinite(previousMs) && nowMs - previousMs <= SECONDARY_STREAK_WINDOW_MS;
  const consecutive = inStreak && previous ? previous.consecutive + 1 : 1;
  file.secondaryBackoff[key] = { consecutive, lastAt: new Date(nowMs).toISOString() };

  if (input.refusal.retryAfterSec !== undefined) {
    return nowMs + input.refusal.retryAfterSec * 1000;
  }
  const doubled = SECONDARY_BASE_PAUSE_MS * 2 ** (consecutive - 1);
  return nowMs + Math.min(doubled, SECONDARY_MAX_PAUSE_MS);
}

/**
 * Record a rate-limit refusal: write the pause for its pool and bucket, append
 * the refused call's ledger line, and notify `onGitHubRefusal` listeners.
 * An existing pause on the same bucket that ends later is kept. A secondary
 * refusal ignores `resetAtSec`, which describes the hourly window, not the
 * burst limit.
 */
export async function recordGitHubRefusal(input: RecordGitHubRefusalInput): Promise<PauseRecord> {
  const nowMs = input.nowMs ?? Date.now();
  const { pool, bucket, caller, refusal } = input;
  const file = readPauseFile();
  const next: PauseFile = {
    pauses: { ...file.pauses },
    secondaryBackoff: { ...file.secondaryBackoff },
  };

  const computedUntil = refusal.kind === 'secondary'
    ? secondaryPauseUntil(input, nowMs, next)
    : primaryPauseUntil(input, nowMs);

  const key = pauseKey(pool, bucket);
  const existing = next.pauses[key];
  const existingUntil = existing ? Date.parse(existing.until) : Number.NaN;
  const keepExisting = existing !== undefined && existingUntil > computedUntil;
  const pause: PauseRecord = keepExisting
    ? existing
    : {
        pool,
        bucket,
        kind: refusal.kind,
        caller,
        since: new Date(nowMs).toISOString(),
        until: new Date(computedUntil).toISOString(),
      };
  next.pauses[key] = pause;
  for (const [k, p] of Object.entries(next.pauses)) {
    if (Date.parse(p.until) <= nowMs) delete next.pauses[k];
  }

  try {
    await writePauseFile(next);
  } catch {
    // NFR-2: the caller still gets its typed error even if the pause is not persisted.
  }

  await appendLedgerEntry({
    ts: new Date(nowMs).toISOString(),
    kind: 'call',
    caller,
    pool,
    bucket,
    cost: 1,
    estimated: true,
    ...input.ledger,
    outcome: refusal.kind === 'secondary' ? 'secondary_limited' : 'rate_limited',
  });

  let ownUsageLow = false;
  try {
    ownUsageLow = computeOwnUsageLow(aggregateLedger(readLedgerWindow(nowMs)), nowMs);
  } catch {
    // Best effort: listeners still hear about the refusal.
  }
  const event: GitHubRefusalEvent = { caller, pool, bucket, kind: refusal.kind, ownUsageLow };
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A listener failure never fails the caller.
    }
  }

  return pause;
}

/**
 * Reconcile the active primary pause on `(sample.pool, sample.bucket)` against
 * a fresh sample: a sample showing headroom (`remaining > 0`) lifts the pause,
 * and a still-exhausted sample (`remaining === 0`) with a future `resetAt`
 * moves the pause to match the current window's actual reset. Secondary
 * pauses and every other key are untouched. Never throws (NFR-2).
 */
export async function reconcileGitHubPauseWithSample(
  sample: { pool: GitHubQuotaPool; bucket: GitHubQuotaBucket; remaining: number; resetAt?: string },
  nowMs: number = Date.now(),
): Promise<void> {
  try {
    const file = readPauseFile();
    const key = pauseKey(sample.pool, sample.bucket);
    const existing = file.pauses[key];
    if (!existing || existing.kind !== 'primary' || Date.parse(existing.until) <= nowMs) return;

    if (sample.remaining > 0) {
      const next: PauseFile = { pauses: { ...file.pauses }, secondaryBackoff: file.secondaryBackoff };
      delete next.pauses[key];
      await writePauseFile(next);
      return;
    }

    const resetMs = sample.resetAt ? Date.parse(sample.resetAt) : Number.NaN;
    if (!Number.isFinite(resetMs) || resetMs <= nowMs) return;

    const next: PauseFile = { pauses: { ...file.pauses }, secondaryBackoff: file.secondaryBackoff };
    next.pauses[key] = { ...existing, until: new Date(resetMs).toISOString() };
    await writePauseFile(next);
  } catch {
    // NFR-2: reconciliation never fails the sampler.
  }
}
