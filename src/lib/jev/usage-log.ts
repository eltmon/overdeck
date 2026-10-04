/**
 * Jev usage log (PAN-4508): one JSONL line per real (non-memo) Jev request, so the settings
 * panel can show what Jev is actually doing per feature instead of nothing. Modeled on
 * `eval-log.ts`: a write failure never surfaces to the caller, and nothing here records the
 * API key, the request state, or an answer — only feature, outcome, model, and timing.
 */
import { mkdir, appendFile, readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { getOverdeckHome } from '../paths.js';
import type { JevFeature } from './config.js';
import type { JevFailureReason } from './failure-reason.js';

const USAGE_LOOKBACK_DAYS = 7;
const SUMMARY_WINDOW_HOURS = 24;

export interface JevUsageRow {
  ts: string;
  feature: JevFeature;
  outcome: 'answered' | 'failed';
  reason?: JevFailureReason;
  status?: number;
  model: string;
  durationMs: number;
}

export interface JevFeatureUsageSummary {
  calls24h: number;
  lastCallAt: string | null;
  lastError: { at: string; reason: JevFailureReason; status?: number } | null;
}

export interface JevUsageSummary {
  hours: typeof SUMMARY_WINDOW_HOURS;
  features: Record<JevFeature, JevFeatureUsageSummary>;
}

const JEV_FEATURE_KEYS: readonly JevFeature[] = [
  'jevTurnEndAssessment',
  'jevAcceptanceCriteriaReview',
  'jevMemoryRelevance',
];

/** `<home>/jev/usage/<UTC YYYY-MM-DD>.jsonl`. */
export function resolveJevUsageLogPath(home: string, date: Date): string {
  const day = date.toISOString().slice(0, 10);
  return join(home, 'jev', 'usage', `${day}.jsonl`);
}

/** Appends one usage row. Never throws: a write failure is swallowed. */
export async function appendJevUsage(row: JevUsageRow, opts: { home?: string } = {}): Promise<void> {
  try {
    const home = opts.home ?? getOverdeckHome();
    const filePath = resolveJevUsageLogPath(home, new Date(row.ts));
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(row)}\n`, 'utf8');
  } catch {
    // Advisory logging only; a write failure must never affect the caller.
  }
}

function isJevUsageRow(value: unknown): value is JevUsageRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.ts === 'string' &&
    typeof row.feature === 'string' &&
    (row.outcome === 'answered' || row.outcome === 'failed') &&
    typeof row.model === 'string' &&
    typeof row.durationMs === 'number'
  );
}

function emptyFeatureSummary(): JevFeatureUsageSummary {
  return { calls24h: 0, lastCallAt: null, lastError: null };
}

/**
 * Reads the last `USAGE_LOOKBACK_DAYS` UTC day files and summarizes calls per feature over
 * the trailing `SUMMARY_WINDOW_HOURS`. Missing day files and unparsable lines are skipped.
 * `lastCallAt`/`lastError` reflect the newest row seen across the whole lookback window, not
 * just the 24h window `calls24h` counts.
 */
export async function readJevUsageSummary(opts: { home?: string; now?: () => Date } = {}): Promise<JevUsageSummary> {
  const home = opts.home ?? getOverdeckHome();
  const now = (opts.now ?? (() => new Date()))();
  const cutoffMs = now.getTime() - SUMMARY_WINDOW_HOURS * 60 * 60 * 1000;

  const features = Object.fromEntries(JEV_FEATURE_KEYS.map((key) => [key, emptyFeatureSummary()])) as Record<
    JevFeature,
    JevFeatureUsageSummary
  >;

  for (let daysAgo = 0; daysAgo < USAGE_LOOKBACK_DAYS; daysAgo++) {
    const day = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    let text: string;
    try {
      text = await readFile(resolveJevUsageLogPath(home, day), 'utf8');
    } catch {
      continue;
    }

    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isJevUsageRow(parsed) || !(parsed.feature in features)) continue;

      const rowTimeMs = new Date(parsed.ts).getTime();
      if (!Number.isFinite(rowTimeMs)) continue;

      const summary = features[parsed.feature];
      if (rowTimeMs >= cutoffMs) summary.calls24h += 1;
      if (summary.lastCallAt === null || rowTimeMs > new Date(summary.lastCallAt).getTime()) {
        summary.lastCallAt = parsed.ts;
      }
      if (
        parsed.outcome === 'failed' &&
        parsed.reason !== undefined &&
        (summary.lastError === null || rowTimeMs > new Date(summary.lastError.at).getTime())
      ) {
        summary.lastError = {
          at: parsed.ts,
          reason: parsed.reason,
          ...(parsed.status !== undefined ? { status: parsed.status } : {}),
        };
      }
    }
  }

  return { hours: SUMMARY_WINDOW_HOURS, features };
}
