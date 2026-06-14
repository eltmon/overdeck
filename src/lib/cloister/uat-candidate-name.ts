/**
 * UAT candidate branch naming (PAN-1691) — codename + short date.
 *
 * Several candidates may be assembled per day, so the date alone collides.
 * Format: `uat/<label>-<codename>-<MMDD>`, e.g. `uat/pan-otter-0609`. Codenames
 * are short, memorable words you can say out loud ("ship the otter candidate").
 *
 * The core is pure and fully injectable (wordlist / index pick / collision
 * check / date) so it's deterministically testable; a thin default wrapper
 * starts at index 0 (deterministic, ordered per day) + a git branch-exists check.
 */

export const UAT_CODENAMES: readonly string[] = [
  'otter', 'falcon', 'cedar', 'quartz', 'ember', 'marlin', 'willow', 'cobalt',
  'sable', 'heron', 'onyx', 'larch', 'perch', 'flint', 'dune', 'reef', 'vale',
  'crow', 'moss', 'thorn', 'birch', 'koi', 'slate', 'wren',
];

function mmdd(dateIso: string): string {
  const [, month, day] = dateIso.slice(0, 10).split('-');
  return `${month ?? '00'}${day ?? '00'}`;
}

export interface UatNameDeps {
  /** Project label, e.g. 'pan'. */
  label: string;
  /** ISO date string; only the YYYY-MM-DD prefix is used (→ MMDD). */
  dateIso: string;
  /** Injectable wordlist (default UAT_CODENAMES). */
  codenames?: readonly string[];
  /** Returns a start index in [0, n) (default 0). */
  pick?: (n: number) => number;
  /** True if the branch already exists (default: never taken). */
  isTaken?: (branch: string) => boolean;
}

/**
 * Build a unique `uat/<label>-<codename>-<MMDD>` branch name, walking the
 * wordlist from index 0 until an untaken name is found; if every codename for
 * the day is taken, appends a numeric suffix. Pure.
 */
export function makeUatCandidateName(deps: UatNameDeps): string {
  const day = mmdd(deps.dateIso);
  const words = deps.codenames ?? UAT_CODENAMES;
  const pick = deps.pick ?? (() => 0);
  const isTaken = deps.isTaken ?? (() => false);

  const start = words.length > 0 ? pick(words.length) % words.length : 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[(start + i) % words.length]!;
    const branch = `uat/${deps.label}-${word}-${day}`;
    if (!isTaken(branch)) return branch;
  }

  // Every codename is taken for this label+day — disambiguate with a counter.
  const base = words[start] ?? 'candidate';
  for (let n = 2; ; n++) {
    const branch = `uat/${deps.label}-${base}-${day}-${n}`;
    if (!isTaken(branch)) return branch;
  }
}
