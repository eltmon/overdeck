/**
 * PAN-4264: the GitHub quota ledger.
 *
 * Every metered GitHub call, and every `/rate_limit` sample, appends one JSON
 * line to `~/.overdeck/github-quota/ledger-<YYYYMMDDHH>.jsonl` (UTC hour). The
 * dashboard, the deacon child, CLI processes and the agent `gh` shim all write
 * the same format, so one directory answers "who spent this machine's GitHub
 * quota in the last hour".
 *
 * Writes are async `appendFile` calls: each line is well under 4 KB, so the
 * append is atomic under `O_APPEND` and concurrent writers never interleave.
 * Reads are bounded sync reads of at most two hour files (NFR-1); do not add
 * an async twin of `readLedgerWindow`. Metering never fails a caller: every
 * write swallows its errors (NFR-2).
 */

import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  GitHubQuotaBucket,
  GitHubQuotaCaller,
  GitHubQuotaPool,
} from '@overdeck/contracts';
import { getOverdeckHome } from '../paths.js';

const HOUR_MS = 3_600_000;
const LEDGER_FILE_PATTERN = /^ledger-(\d{4})(\d{2})(\d{2})(\d{2})\.jsonl$/;

/** Metered user-pool GraphQL points in the last hour below which this machine is "not the cause". */
export const OWN_USAGE_LOW_POINTS = 500;
/** A sample whose remaining is at least this fraction of its limit means the visible limit is not spent. */
export const OWN_USAGE_REMAINING_FRACTION = 0.1;
/** A sample older than this no longer describes the current window. */
export const SAMPLE_FRESH_MS = 10 * 60_000;

export type LedgerOutcome = 'ok' | 'error' | 'rate_limited' | 'secondary_limited' | 'unknown';

/**
 * One ledger line (FR-1). `unknown` outcomes come only from the agent shim,
 * which `exec`s the real `gh` and cannot see its exit status.
 */
export interface LedgerEntry {
  /** ISO timestamp. */
  ts: string;
  pid: number;
  kind: 'call' | 'sample';
  caller: GitHubQuotaCaller;
  pool: GitHubQuotaPool;
  bucket: GitHubQuotaBucket;
  cost: number;
  estimated: boolean;
  outcome: LedgerOutcome;
  remaining?: number;
  limit?: number;
  /** ISO time the bucket's hourly window resets. */
  resetAt?: string;
  /** Agent id, set by the agent `gh` shim. */
  agent?: string;
}

/** A ledger entry before `appendLedgerEntry` stamps `ts` and `pid`. */
export type LedgerEntryInput = Omit<LedgerEntry, 'ts' | 'pid'> & Partial<Pick<LedgerEntry, 'ts' | 'pid'>>;

/** Points spent and calls made in one bucket (a mutable accumulator). */
export interface LedgerUsage {
  points: number;
  calls: number;
}

/** The latest sample for one pool and bucket, as aggregated from the ledger. */
export interface LedgerSample {
  ts: string;
  remaining: number;
  limit: number;
  resetAt?: string;
}

export interface CallerAggregate {
  graphql: LedgerUsage;
  rest: LedgerUsage;
  estimated: boolean;
}

export interface LedgerAggregate {
  byCaller: Partial<Record<GitHubQuotaCaller, CallerAggregate>>;
  byPool: Record<GitHubQuotaPool, Record<GitHubQuotaBucket, LedgerUsage>>;
  samples: Partial<Record<GitHubQuotaPool, Partial<Record<GitHubQuotaBucket, LedgerSample>>>>;
  refusals: { primary: number; secondary: number };
}

/** `~/.overdeck/github-quota`, resolved on every call so tests can move OVERDECK_HOME. */
export function getGitHubQuotaDir(): string {
  return join(getOverdeckHome(), 'github-quota');
}

function hourKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}`;
}

/** The ledger file that holds entries written at `ms`. */
export function ledgerFilePath(ms: number): string {
  return join(getGitHubQuotaDir(), `ledger-${hourKey(ms)}.jsonl`);
}

let lastAppendHour: number | null = null;

/**
 * Append one entry to the current hour's ledger file. On the first append of
 * a new UTC hour in this process, prune expired hour files. Never throws.
 */
export async function appendLedgerEntry(input: LedgerEntryInput): Promise<void> {
  try {
    const nowMs = Date.now();
    const entry: LedgerEntry = { ...input, ts: input.ts ?? new Date(nowMs).toISOString(), pid: input.pid ?? process.pid };
    const entryMs = Date.parse(entry.ts);
    const fileMs = Number.isFinite(entryMs) ? entryMs : nowMs;
    // Resolve both paths before the first await, so a queued append lands in
    // the home that was current when the call was metered.
    const dir = getGitHubQuotaDir();
    const file = ledgerFilePath(fileMs);
    await mkdir(dir, { recursive: true });
    await appendFile(file, `${JSON.stringify(entry)}\n`);

    const hour = Math.floor(nowMs / HOUR_MS);
    if (lastAppendHour !== hour) {
      lastAppendHour = hour;
      await pruneLedger(nowMs, dir);
    }
  } catch {
    // NFR-2: metering never fails the caller.
  }
}

const pendingAppends = new Set<Promise<void>>();

/**
 * Append an entry without making the caller wait for the disk. Metered GitHub
 * calls use this on their normal path, so metering never delays the call it
 * measures. `flushLedgerWrites` awaits every queued append.
 */
export function queueLedgerEntry(input: LedgerEntryInput): void {
  const pending = appendLedgerEntry(input);
  pendingAppends.add(pending);
  void pending.finally(() => pendingAppends.delete(pending));
}

/** Resolve once every append queued by `queueLedgerEntry` so far has landed. */
export async function flushLedgerWrites(): Promise<void> {
  await Promise.all([...pendingAppends]);
}

function isLedgerEntry(value: unknown): value is LedgerEntry {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.ts === 'string'
    && (v.kind === 'call' || v.kind === 'sample')
    && typeof v.caller === 'string'
    && typeof v.pool === 'string'
    && (v.bucket === 'graphql' || v.bucket === 'rest')
    && typeof v.cost === 'number';
}

function readLedgerFile(path: string): LedgerEntry[] {
  if (!existsSync(path)) return [];
  const entries: LedgerEntry[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isLedgerEntry(parsed)) entries.push(parsed);
    } catch {
      // A torn or foreign line is skipped, never fatal.
    }
  }
  return entries;
}

/**
 * Entries with `nowMs - windowMs <= ts <= nowMs`, read from the current and
 * previous hour files (the window is at most one hour). Sync and bounded.
 */
export function readLedgerWindow(nowMs: number, windowMs = HOUR_MS): LedgerEntry[] {
  const boundedWindow = Math.min(Math.max(windowMs, 0), HOUR_MS);
  const startMs = nowMs - boundedWindow;
  try {
    const files = [ledgerFilePath(nowMs - HOUR_MS), ledgerFilePath(nowMs)];
    return files.flatMap(readLedgerFile).filter((entry) => {
      const ms = Date.parse(entry.ts);
      return Number.isFinite(ms) && ms >= startMs && ms <= nowMs;
    });
  } catch {
    return [];
  }
}

function emptyUsage(): LedgerUsage {
  return { points: 0, calls: 0 };
}

/**
 * Sum call entries per caller and per pool, keep the latest sample per pool
 * and bucket, and count refusals. Every `kind: 'call'` entry counts at its
 * recorded cost whatever its outcome — a refused or `unknown` (agent shim)
 * call still reached GitHub.
 */
export function aggregateLedger(entries: readonly LedgerEntry[]): LedgerAggregate {
  const aggregate: LedgerAggregate = {
    byCaller: {},
    byPool: {
      user: { graphql: emptyUsage(), rest: emptyUsage() },
      pat: { graphql: emptyUsage(), rest: emptyUsage() },
      app: { graphql: emptyUsage(), rest: emptyUsage() },
    },
    samples: {},
    refusals: { primary: 0, secondary: 0 },
  };

  for (const entry of entries) {
    if (entry.kind === 'sample') {
      if (typeof entry.remaining !== 'number' || typeof entry.limit !== 'number') continue;
      const poolSamples = (aggregate.samples[entry.pool] ??= {});
      const previous = poolSamples[entry.bucket];
      if (previous && Date.parse(previous.ts) > Date.parse(entry.ts)) continue;
      poolSamples[entry.bucket] = {
        ts: entry.ts,
        remaining: entry.remaining,
        limit: entry.limit,
        ...(entry.resetAt ? { resetAt: entry.resetAt } : {}),
      };
      continue;
    }

    const callerUsage = (aggregate.byCaller[entry.caller] ??= {
      graphql: emptyUsage(),
      rest: emptyUsage(),
      estimated: false,
    });
    callerUsage[entry.bucket].points += entry.cost;
    callerUsage[entry.bucket].calls += 1;
    if (entry.estimated) callerUsage.estimated = true;

    const poolUsage = aggregate.byPool[entry.pool]?.[entry.bucket];
    if (poolUsage) {
      poolUsage.points += entry.cost;
      poolUsage.calls += 1;
    }

    if (entry.outcome === 'rate_limited') aggregate.refusals.primary += 1;
    else if (entry.outcome === 'secondary_limited') aggregate.refusals.secondary += 1;
  }

  return aggregate;
}

function ledgerFileHourStartMs(name: string): number | null {
  const match = LEDGER_FILE_PATTERN.exec(name);
  if (!match) return null;
  const [, y, mo, d, h] = match;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h));
}

/**
 * Delete ledger files whose hour began more than three hours before the
 * current hour. The current and previous hour files (the read window) are
 * always kept. Never throws.
 */
export async function pruneLedger(nowMs: number, dir: string = getGitHubQuotaDir()): Promise<void> {
  try {
    const currentHourStart = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
    const oldestKept = currentHourStart - 2 * HOUR_MS;
    const names = await readdir(dir);
    await Promise.all(names.map(async (name) => {
      const hourStart = ledgerFileHourStartMs(name);
      if (hourStart === null || hourStart >= oldestKept) return;
      await unlink(join(dir, name)).catch(() => undefined);
    }));
  } catch {
    // NFR-2: pruning is best effort.
  }
}

/**
 * True when this machine's metered usage cannot explain a primary limit:
 * metered user-pool GraphQL points in the last hour are below
 * `OWN_USAGE_LOW_POINTS`, and either the latest user-pool GraphQL sample
 * still shows at least `OWN_USAGE_REMAINING_FRACTION` of its limit or no
 * sample is fresher than `SAMPLE_FRESH_MS`.
 */
export function computeOwnUsageLow(aggregate: LedgerAggregate, nowMs: number): boolean {
  if (aggregate.byPool.user.graphql.points >= OWN_USAGE_LOW_POINTS) return false;
  const sample = aggregate.samples.user?.graphql;
  if (!sample) return true;
  const sampleMs = Date.parse(sample.ts);
  if (!Number.isFinite(sampleMs) || nowMs - sampleMs > SAMPLE_FRESH_MS) return true;
  return sample.remaining >= OWN_USAGE_REMAINING_FRACTION * sample.limit;
}
