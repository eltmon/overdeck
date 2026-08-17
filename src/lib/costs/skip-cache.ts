import { getOverdeckDatabaseSync } from '../overdeck/infra.js';

export type SkipVerdict = 'imported' | 'no-usage' | 'unknown-model' | 'unpriced-model';

type SkipVerdictRow = {
  verdict: SkipVerdict;
};

export function lookupSkipVerdict(
  path: string,
  mtimeMs: number,
  size: number,
): SkipVerdict | null {
  const row = getOverdeckDatabaseSync()
    .prepare(`
      SELECT verdict
      FROM cost_reconcile_file_state
      WHERE path = ? AND mtime_ms = ? AND size = ?
    `)
    .get(path, mtimeMs, size) as SkipVerdictRow | undefined;

  return row?.verdict ?? null;
}

export function recordSkipVerdict(
  path: string,
  mtimeMs: number,
  size: number,
  verdict: SkipVerdict,
): void {
  getOverdeckDatabaseSync()
    .prepare(`
      INSERT INTO cost_reconcile_file_state (path, mtime_ms, size, verdict)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        mtime_ms = excluded.mtime_ms,
        size = excluded.size,
        verdict = excluded.verdict
    `)
    .run(path, mtimeMs, size, verdict);
}
