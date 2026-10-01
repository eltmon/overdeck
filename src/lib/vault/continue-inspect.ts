/**
 * Session Vault continue inspection (PAN-4437).
 *
 * The write-free half of "Continue here": what would happen if this machine
 * continued a record in `targetCwd`. It reports the record's latest WIP entry,
 * where a captured snapshot would go (in place on a clean checkout, a new
 * workspace on a dirty one, nowhere outside git) and the drift fields.
 *
 * Nothing here writes: it never calls `isWipPresent` or `buildWipCommit`,
 * which create git objects, and runs only the read-only `readCwdState`.
 *
 * `driftNote` lives here (moved from `pan vault resume`) so the dashboard can
 * send the same first turn without importing a CLI module.
 *
 * Imports only sibling vault modules (NFR-3).
 */
import { compareCwdState, readCwdState, type CwdState, type CwdStateField } from './cwd-state.js';
import type { SessionRecord } from './format.js';
import { findLatestWip, type CapturedWip } from './wip-apply.js';

export type ContinueWip =
  | { kind: 'none' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'captured'; wip: CapturedWip; at: string; bytes: number; branch: string | null; base: string };

export type CodePlacement = 'in-place' | 'new-workspace' | 'none';

export interface ContinueInspection {
  wip: ContinueWip;
  isGit: boolean;
  dirty: boolean;
  codePlacement: CodePlacement;
  drift: CwdStateField[];
}

export function driftNote(fields: readonly CwdStateField[]): string {
  return `[Session Vault] This conversation was resumed in a working directory whose ${fields.join(', ')} differ${fields.length === 1 ? 's' : ''} from where it was saved. Check the current state before relying on earlier assumptions.`;
}

function continueWip(record: SessionRecord): ContinueWip {
  const wip = findLatestWip(record);
  if (wip === null) return { kind: 'none' };
  if ('objects' in wip) return { kind: 'captured', wip, at: wip.at, bytes: wip.bytes, branch: wip.branch, base: wip.base };
  return { kind: 'skipped', reason: `${wip.skipped}${wip.reason ? `, ${wip.reason}` : ''}` };
}

/**
 * Fields that differ between the last settlement's `cwdState` and `current`.
 * Empty when code is placed (an applied snapshot reproduces the saved state),
 * when the settlement has no `cwdState`, or when `current` is not a git checkout.
 */
export function driftFields(record: SessionRecord, current: CwdState | null, codePlaced: boolean): CwdStateField[] {
  if (codePlaced || current === null) return [];
  const saved = record.settlements[record.settlements.length - 1]?.cwdState ?? null;
  return saved === null ? [] : compareCwdState(saved, current);
}

export async function inspectContinue(record: SessionRecord, targetCwd: string): Promise<ContinueInspection> {
  const wip = continueWip(record);
  const state = await readCwdState(targetCwd);
  const codePlacement: CodePlacement = wip.kind !== 'captured' || state === null
    ? 'none'
    : state.dirty ? 'new-workspace' : 'in-place';
  return {
    wip,
    isGit: state !== null,
    dirty: state?.dirty ?? false,
    codePlacement,
    drift: driftFields(record, state, codePlacement !== 'none'),
  };
}
