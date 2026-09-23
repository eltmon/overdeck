/**
 * Substrate stats on read (PAN-3964 FR-4, D2).
 *
 * A substrate bug is a tracker issue labelled `substrate-improvement`. The
 * stats are computed from the tracker and the forge every time they are asked
 * for — there is no observation file and no telemetry table:
 *
 *   c1  discovery rate = substrate bugs filed in the window / PRs merged in it
 *   c2  P0 count       = substrate bugs filed in the window labelled P0
 *
 * `trend` compares the window with the preceding window of equal length. The
 * default issue reader shells `gh issue list` once for both windows (execFile,
 * 20 s timeout) and caches the answer for 60 s per project. The merged-PR
 * reader wraps `listRepoPullRequests`, which is capped at 200 PRs — a 90-day
 * window on a busy repo undercounts the denominator.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type {
  FlywheelStats,
  FlywheelStatsCriterionStatus,
  FlywheelStatsTrend,
  FlywheelSubstrateSeverity,
} from '@overdeck/contracts';

const execFileAsync = promisify(execFile);

export const SUBSTRATE_LABEL = 'substrate-improvement';
export const DEFAULT_STATS_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISSUE_CACHE_TTL_MS = 60_000;
/** Below this many merged PRs the rate is noise. */
const MIN_DENOMINATOR = 5;

export interface SubstrateIssue {
  number: number;
  title: string;
  createdAt: string;
  closedAt: string | null;
  labels: readonly string[];
}

export interface MergedPr {
  number: number;
  mergedAt: string;
}

export interface ComputeSubstrateStatsInput {
  projectPath: string;
  windowDays?: number;
  now?: () => Date;
  /** Issues created at or after `since`. */
  listSubstrateIssues?: (projectPath: string, since: Date) => Promise<readonly SubstrateIssue[]>;
  /** PRs merged at or after `since`. */
  listMergedPrs?: (projectPath: string, since: Date) => Promise<readonly MergedPr[]>;
}

export function severityOf(labels: readonly string[]): FlywheelSubstrateSeverity {
  const upper = new Set(labels.map((label) => label.trim().toUpperCase()));
  for (const severity of ['P0', 'P1', 'P2'] as const) {
    if (upper.has(severity)) return severity;
  }
  return 'unknown';
}

export function bugRateStatus(value: number): FlywheelStatsCriterionStatus {
  if (value < 0.1) return 'green';
  if (value < 0.3) return 'yellow';
  return 'red';
}

export function p0Status(count: number): FlywheelStatsCriterionStatus {
  if (count === 0) return 'green';
  if (count <= 2) return 'yellow';
  return 'red';
}

/** `flat` when the difference is under 10 % of the larger value. */
export function trendOf(current: number, previous: number): FlywheelStatsTrend {
  const larger = Math.max(Math.abs(current), Math.abs(previous));
  if (larger === 0 || Math.abs(current - previous) < larger * 0.1) return 'flat';
  return current > previous ? 'up' : 'down';
}

function within(iso: string | null | undefined, from: number, to: number): boolean {
  if (!iso) return false;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms >= from && ms < to;
}

// ─── default readers ─────────────────────────────────────────────────────────

const issueCache = new Map<string, { at: number; since: number; rows: readonly SubstrateIssue[] }>();

/** Test seam: drop the 60 s issue cache. */
export function clearSubstrateIssueCache(): void {
  issueCache.clear();
}

interface GhIssueRow {
  number?: number;
  title?: string;
  createdAt?: string;
  closedAt?: string | null;
  labels?: Array<{ name?: string }>;
}

export async function listSubstrateIssuesWithGh(projectPath: string, since: Date): Promise<readonly SubstrateIssue[]> {
  const cached = issueCache.get(projectPath);
  if (cached && Date.now() - cached.at < ISSUE_CACHE_TTL_MS && cached.since <= since.getTime()) return cached.rows;
  const { stdout } = await execFileAsync('gh', [
    'issue', 'list',
    '--label', SUBSTRATE_LABEL,
    '--state', 'all',
    '--search', `created:>=${since.toISOString().slice(0, 10)}`,
    '--json', 'number,title,createdAt,closedAt,labels',
    '--limit', '500',
  ], { cwd: projectPath, encoding: 'utf-8', timeout: 20_000 });
  const rows = (JSON.parse(stdout || '[]') as GhIssueRow[]).flatMap((row): SubstrateIssue[] => (
    typeof row.number === 'number' && typeof row.createdAt === 'string'
      ? [{
          number: row.number,
          title: row.title ?? '',
          createdAt: row.createdAt,
          closedAt: row.closedAt ?? null,
          labels: (row.labels ?? []).flatMap((label) => (label.name ? [label.name] : [])),
        }]
      : []
  ));
  issueCache.set(projectPath, { at: Date.now(), since: since.getTime(), rows });
  return rows;
}

export async function listMergedPrsFromForge(projectPath: string, since: Date): Promise<readonly MergedPr[]> {
  const { listRepoPullRequests } = await import('../overdeck/derived-issue-state.js');
  const rows = await listRepoPullRequests(projectPath);
  return rows.flatMap((row): MergedPr[] => (
    typeof row.number === 'number' && row.mergedAt && Date.parse(row.mergedAt) >= since.getTime()
      ? [{ number: row.number, mergedAt: row.mergedAt }]
      : []
  ));
}

// ─── the computation ─────────────────────────────────────────────────────────

export async function computeSubstrateStats(input: ComputeSubstrateStatsInput): Promise<FlywheelStats> {
  const windowDays = input.windowDays && input.windowDays > 0 ? Math.floor(input.windowDays) : DEFAULT_STATS_WINDOW_DAYS;
  const until = (input.now ?? (() => new Date()))();
  const untilMs = until.getTime();
  const sinceMs = untilMs - windowDays * DAY_MS;
  const previousSinceMs = sinceMs - windowDays * DAY_MS;
  const previousSince = new Date(previousSinceMs);

  const [issues, prs] = await Promise.all([
    (input.listSubstrateIssues ?? listSubstrateIssuesWithGh)(input.projectPath, previousSince),
    (input.listMergedPrs ?? listMergedPrsFromForge)(input.projectPath, previousSince),
  ]);

  const current = issues.filter((issue) => within(issue.createdAt, sinceMs, untilMs));
  const previous = issues.filter((issue) => within(issue.createdAt, previousSinceMs, sinceMs));
  const mergedNow = prs.filter((pr) => within(pr.mergedAt, sinceMs, untilMs)).length;
  const mergedBefore = prs.filter((pr) => within(pr.mergedAt, previousSinceMs, sinceMs)).length;

  const rate = mergedNow > 0 ? current.length / mergedNow : null;
  const previousRate = mergedBefore > 0 ? previous.length / mergedBefore : null;
  const p0Now = current.filter((issue) => severityOf(issue.labels) === 'P0').length;
  const p0Before = previous.filter((issue) => severityOf(issue.labels) === 'P0').length;
  const dataSufficient = mergedNow >= MIN_DENOMINATOR;

  return {
    window: { days: windowDays, since: new Date(sinceMs).toISOString(), until: until.toISOString() },
    generatedAt: until.toISOString(),
    criteria: {
      c1_bugRate: {
        value: rate,
        count: current.length,
        denominator: mergedNow,
        status: rate === null ? 'insufficient_data' : bugRateStatus(rate),
        trend: rate === null || previousRate === null ? 'flat' : trendOf(rate, previousRate),
        dataSufficient,
      },
      c2_p0Bugs: {
        value: p0Now,
        status: p0Status(p0Now),
        trend: trendOf(p0Now, p0Before),
        dataSufficient,
      },
    },
    bugs: current
      .slice()
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        createdAt: issue.createdAt,
        closedAt: issue.closedAt,
        severity: severityOf(issue.labels),
      })),
  };
}
