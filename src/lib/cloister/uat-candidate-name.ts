/**
 * UAT candidate branch naming (PAN-1691) — codename + short date.
 *
 * One candidate branch is assembled per label/day and force-reset on rebuild.
 * Format: `uat/<label>-<codename>-<MMDD>`, e.g. `uat/pan-otter-0609`. Codenames
 * are short, memorable words you can say out loud ("ship the otter candidate").
 *
 * The core is pure and fully injectable (wordlist / index pick / collision
 * date) so it's deterministically testable. The default codename index is a
 * stable hash of label + day so rebuilds for the same day reuse the same branch.
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
  /** Returns an index in [0, n) (default: stable hash of label + MMDD). */
  pick?: (n: number) => number;
}

/**
 * Build the deterministic `uat/<label>-<codename>-<MMDD>` branch name. Pure.
 */
export function makeUatCandidateName(deps: UatNameDeps): string {
  const day = mmdd(deps.dateIso);
  const words = deps.codenames ?? UAT_CODENAMES;
  const pick = deps.pick ?? ((n: number) => stableIndex(`${deps.label}-${day}`, n));
  const index = words.length > 0 ? pick(words.length) % words.length : 0;
  const word = words[index] ?? 'candidate';
  return `uat/${deps.label}-${word}-${day}`;
}

function stableIndex(seed: string, modulo: number): number {
  if (modulo <= 0) return 0;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % modulo;
}
