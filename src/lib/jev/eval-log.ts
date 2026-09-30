/**
 * Shadow eval log for the Jev acceptance-criteria review (PAN-4372 FR-9).
 *
 * Appends one JSON line per reviewed AC recording the keyword rule's verdict next to Jev's
 * Nouls, for offline threshold tuning. Never records AC title text. Nothing reads this log back
 * as authority, and a write failure never surfaces to the caller: `appendAcceptanceCriteriaEvalLog`
 * swallows every error.
 */
import { mkdir, appendFile } from 'fs/promises';
import { dirname, join } from 'path';
import { getOverdeckHome } from '../paths.js';

export interface AcceptanceCriteriaEvalRow {
  timestamp: string;
  planId: string;
  acId: string;
  questionSetVersion: number;
  model: string;
  keywordVerdict: 'observable' | 'not-observable';
  jevNoul: { observable: number | null; compound: number | null };
}

/** `<home>/jev/eval-log/acceptance-criteria/<UTC YYYY-MM-DD>.jsonl`. */
export function resolveAcceptanceCriteriaEvalLogPath(home: string, date: Date): string {
  const day = date.toISOString().slice(0, 10);
  return join(home, 'jev', 'eval-log', 'acceptance-criteria', `${day}.jsonl`);
}

/** Appends one line per row. Never throws: a write failure is swallowed. */
export async function appendAcceptanceCriteriaEvalLog(
  rows: readonly AcceptanceCriteriaEvalRow[],
  opts: { home?: string; now?: () => Date } = {},
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const home = opts.home ?? getOverdeckHome();
    const now = opts.now ?? (() => new Date());
    const filePath = resolveAcceptanceCriteriaEvalLogPath(home, now());
    await mkdir(dirname(filePath), { recursive: true });
    const lines = rows.map(row => `${JSON.stringify(row)}\n`).join('');
    await appendFile(filePath, lines, 'utf8');
  } catch {
    // Advisory logging only; a write failure must never affect the review result.
  }
}
