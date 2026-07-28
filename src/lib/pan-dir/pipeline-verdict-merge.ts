/**
 * PAN-3092: verdict-aware pipeline merge.
 *
 * `pipeline.updatedAt` is stamped on EVERY status write (projectPipeline,
 * records.ts), verdict or not, so a plain newer-wins comparison conflates
 * write-recency with verdict-truth: a verdict-free write that lands a second
 * after a reviewer's `passed` makes the passed verdict look like the older
 * truth and silently drops it (observed on MIN-902, where the review verdict
 * ended up in no persisted plane at all).
 *
 * The rule here keeps PAN-2587's newer-wins default for every non-verdict
 * field while refusing to regress a gate that already reached a terminal
 * verdict inside the same review cycle. A strictly newer `reviewSpawnedAt`
 * (a genuinely new review cycle) and a newer terminal verdict both still win.
 */

import type { PanIssuePipelineRecord } from './record.js';

/**
 * Terminal verdict values per gate. Everything else — pending, reviewing,
 * testing, merging, queued, dispatch_failed, undefined — is a non-verdict
 * state that must never overwrite a terminal one inside the same cycle.
 */
export const TERMINAL_GATE_VALUES = {
  reviewStatus: ['passed', 'blocked', 'failed', 'skipped'],
  testStatus: ['passed', 'failed'],
  uatStatus: ['passed', 'failed'],
  verificationStatus: ['passed', 'failed', 'skipped'],
  inspectStatus: ['passed', 'blocked', 'failed'],
  mergeStatus: ['merged', 'failed'],
} as const satisfies Record<string, readonly string[]>;

/** Fields that carry a gate's evidence and must move with its status as one unit. */
export const GATE_COMPANIONS = {
  reviewStatus: ['reviewNotes', 'reviewedAtCommit', 'reviewerVerdicts'],
  testStatus: ['testNotes'],
  uatStatus: ['uatNotes'],
  verificationStatus: ['verificationNotes', 'lastVerifiedCommit'],
  inspectStatus: ['inspectNotes'],
  mergeStatus: ['mergeNotes', 'mergeStep'],
} as const satisfies Record<keyof typeof TERMINAL_GATE_VALUES, readonly string[]>;

type GateName = keyof typeof TERMINAL_GATE_VALUES;

const GATE_NAMES = Object.keys(TERMINAL_GATE_VALUES) as GateName[];

/**
 * Field-level view of a pipeline block. The two callers pass different declared
 * shapes (the record's `PanIssuePipelineRecord`, the fallback's
 * `Partial<ReviewStatus>` subset) and neither declares every gate, so gate
 * access goes through one loose view rather than six casts.
 */
type PipelineFields = Record<string, unknown>;

function fields(pipeline: unknown): PipelineFields {
  return pipeline as PipelineFields;
}

function isTerminal(gate: GateName, value: unknown): boolean {
  return typeof value === 'string' && (TERMINAL_GATE_VALUES[gate] as readonly string[]).includes(value);
}

/** Milliseconds for an ISO/epoch cycle marker, or undefined when it does not parse. */
function cycleMs(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Merge a freshly-read on-disk pipeline over a rebuilt one without losing a
 * terminal verdict the rebuild carries.
 *
 * Order of rules:
 *   1. Either side lacks `updatedAt` → the rebuilt block wins (PAN-2587 guard).
 *   2. The rebuilt block is at least as new → it wins outright (PAN-2587).
 *   3. Otherwise `fresh` is the base — newer-wins for every non-verdict field.
 *   4. `fresh` belongs to a strictly newer review cycle → it wins wholesale;
 *      a new cycle legitimately resets the previous cycle's verdicts.
 *   5. Any gate where `rebuilt` holds a terminal verdict and the base does not
 *      keeps the rebuilt status plus its companion fields.
 */
export function mergePipelineVerdictAware(
  rebuilt: PanIssuePipelineRecord,
  fresh: PanIssuePipelineRecord | undefined,
): PanIssuePipelineRecord {
  if (!fresh?.updatedAt || !rebuilt?.updatedAt) return rebuilt;
  if (!(rebuilt.updatedAt < fresh.updatedAt)) return rebuilt;

  const rebuiltCycle = cycleMs(rebuilt.reviewSpawnedAt);
  const freshCycle = cycleMs(fresh.reviewSpawnedAt);
  if (rebuiltCycle !== undefined && freshCycle !== undefined && freshCycle > rebuiltCycle) {
    return fresh;
  }

  // Cloned lazily: when no gate needs preserving the caller gets the identical
  // `fresh` object back, which is exactly PAN-2587's behavior.
  let merged: PanIssuePipelineRecord | undefined;
  for (const gate of GATE_NAMES) {
    if (!isTerminal(gate, fields(rebuilt)[gate]) || isTerminal(gate, fields(fresh)[gate])) continue;
    merged ??= structuredClone(fresh);
    const target = fields(merged);
    const source = fields(rebuilt);
    for (const field of [gate, ...GATE_COMPANIONS[gate]]) {
      if (source[field] === undefined) delete target[field];
      else target[field] = source[field];
    }
  }
  return merged ?? fresh;
}

/**
 * Does this status update drive some gate to a terminal verdict it was not
 * already at? That is the write an agent cannot cheaply retry — losing it
 * strands the verdict in the agent's pane — so the journal writer waits out lock
 * contention for it instead of dropping to the workspace fallback on the first
 * collision (PAN-3092). Bookkeeping writes stay single-shot; retrying those
 * would only add lock pressure.
 */
export function carriesNewTerminalVerdict(
  previous: PipelineFields,
  update: PipelineFields,
): boolean {
  return GATE_NAMES.some((gate) => {
    const next = update[gate];
    return next !== undefined && next !== previous[gate] && isTerminal(gate, next);
  });
}

/**
 * Has the journal settled every gate the workspace fallback holds a terminal
 * verdict for? The drain asks this before deleting a fallback as superseded: a
 * newer-but-verdict-free journal write must not consume a verdict that never
 * landed anywhere (PAN-3092; MIN-902 lost its review verdict exactly this way).
 *
 * Coverage is per-gate VALUE equality, not merely "the journal reached some
 * terminal value". `pipeline.updatedAt` is restamped by unrelated bookkeeping —
 * the root defect this issue exists for — so a later whole-pipeline timestamp is
 * no evidence that a journal's differing terminal value is the newer one; it may
 * be an older verdict carried forward while the newer specialist result waits in
 * the fallback. When the values differ the fallback is folded instead, and
 * `mergePipelineVerdictAware` decides the winner from per-gate evidence.
 */
export function pipelineCoversFallbackVerdicts(
  journal: PanIssuePipelineRecord,
  fallback: { updatedAt: string; pipeline: PipelineFields },
): boolean {
  const journalCycle = cycleMs(journal.reviewSpawnedAt);
  const fallbackWrittenMs = cycleMs(fallback.updatedAt);
  if (journalCycle !== undefined && fallbackWrittenMs !== undefined && journalCycle > fallbackWrittenMs) {
    return true;
  }

  const journalFields = fields(journal);
  const fallbackFields = fields(fallback.pipeline);
  for (const gate of GATE_NAMES) {
    const held = fallbackFields[gate];
    if (!isTerminal(gate, held)) continue;
    if (journalFields[gate] !== held) return false;
  }
  return true;
}

/** One gate holding two different written terminal verdicts. */
export interface VerdictConflict {
  gate: string;
  journalValue: string;
  fallbackValue: string;
}

/**
 * Which gates hold DIFFERENT terminal verdicts in the journal and the fallback,
 * within the same review cycle?
 *
 * This is the one case the drain cannot resolve: two written terminal verdicts
 * for one gate, and no per-gate timestamp to order them by. The whole-pipeline
 * `updatedAt` is restamped by unrelated bookkeeping, so "the journal's is newer"
 * is exactly the inference PAN-3092 exists to stop making. Callers preserve the
 * fallback and let the stranded-fallback sweep put the conflict in front of an
 * operator rather than picking a winner.
 */
export function findFallbackVerdictConflicts(
  journal: PanIssuePipelineRecord,
  fallback: { updatedAt: string; pipeline: PipelineFields },
): VerdictConflict[] {
  const journalCycle = cycleMs(journal.reviewSpawnedAt);
  const fallbackWrittenMs = cycleMs(fallback.updatedAt);
  // A newer review cycle legitimately resets the previous cycle's verdicts.
  if (journalCycle !== undefined && fallbackWrittenMs !== undefined && journalCycle > fallbackWrittenMs) {
    return [];
  }

  const journalFields = fields(journal);
  const fallbackFields = fields(fallback.pipeline);
  const conflicts: VerdictConflict[] = [];
  for (const gate of GATE_NAMES) {
    const held = fallbackFields[gate];
    if (!isTerminal(gate, held)) continue;
    const settled = journalFields[gate];
    if (!isTerminal(gate, settled) || settled === held) continue;
    conflicts.push({ gate, journalValue: String(settled), fallbackValue: String(held) });
  }
  return conflicts;
}

/** Boolean form of {@link findFallbackVerdictConflicts} for the drain's withhold decision. */
export function pipelineConflictsWithFallbackVerdicts(
  journal: PanIssuePipelineRecord,
  fallback: { updatedAt: string; pipeline: PipelineFields },
): boolean {
  return findFallbackVerdictConflicts(journal, fallback).length > 0;
}
