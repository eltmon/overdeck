/**
 * Deterministic supersession link checks for `pan memory lint` (PAN-5360 W7, D20).
 * Pure: takes the parsed facts of one store and returns findings; never reads or
 * writes a file. Not imported by the launch path (render.ts, store.ts, operator-sync*).
 */
import { isActiveFact, type MemoryFact } from './store.js';

export type LinkFindingKind =
  | 'dangling-supersedes'
  | 'dangling-superseded-by'
  | 'one-way-link'
  | 'status-without-link'
  | 'link-without-status'
  | 'cycle'
  | 'description-says-superseded';

export interface LinkFinding {
  readonly kind: LinkFindingKind;
  readonly id: string;
  readonly other?: string;
  readonly message: string;
}

const DESCRIPTION_SAYS_SUPERSEDED = /\bsupersed/i;

/** Every supersession link problem in one store's facts, sorted by id, then kind. */
export function findLinkProblems(facts: readonly MemoryFact[]): LinkFinding[] {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const findings: LinkFinding[] = [];

  for (const fact of facts) {
    for (const oldId of fact.supersedes) {
      const old = byId.get(oldId);
      if (!old) {
        findings.push({
          kind: 'dangling-supersedes',
          id: fact.id,
          other: oldId,
          message: `"${fact.id}" supersedes "${oldId}", but no fact "${oldId}" exists in this store`,
        });
      } else if (old.supersededBy !== fact.id) {
        findings.push({
          kind: 'one-way-link',
          id: fact.id,
          other: oldId,
          message: `"${fact.id}" supersedes "${oldId}", but "${oldId}" does not name "${fact.id}" in superseded_by`,
        });
      }
    }

    if (fact.supersededBy !== null) {
      const newer = byId.get(fact.supersededBy);
      if (!newer) {
        findings.push({
          kind: 'dangling-superseded-by',
          id: fact.id,
          other: fact.supersededBy,
          message: `"${fact.id}" is superseded by "${fact.supersededBy}", but no fact "${fact.supersededBy}" exists in this store`,
        });
      } else if (!newer.supersedes.includes(fact.id)) {
        findings.push({
          kind: 'one-way-link',
          id: fact.id,
          other: newer.id,
          message: `"${fact.id}" is superseded by "${newer.id}", but "${newer.id}" does not list "${fact.id}" in supersedes`,
        });
      }
      if (fact.status === 'active') {
        findings.push({
          kind: 'link-without-status',
          id: fact.id,
          other: fact.supersededBy,
          message: `"${fact.id}" has superseded_by "${fact.supersededBy}" but no status: superseded; it is already left out of the index`,
        });
      }
    } else if (fact.status === 'superseded') {
      findings.push({
        kind: 'status-without-link',
        id: fact.id,
        message: `"${fact.id}" has status superseded but no superseded_by naming the fact that replaces it`,
      });
    }

    if (isActiveFact(fact) && DESCRIPTION_SAYS_SUPERSEDED.test(fact.description)) {
      findings.push({
        kind: 'description-says-superseded',
        id: fact.id,
        message: `"${fact.id}" is active but its description says it is superseded; `
          + `if a newer fact replaces it, run pan memory edit <new-id> --supersedes ${fact.id}`,
      });
    }
  }

  findings.push(...findCycles(byId));
  return findings.sort((a, b) => a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind));
}

/** Follow superseded_by from every fact; report each cycle once, under its smallest id. */
function findCycles(byId: ReadonlyMap<string, MemoryFact>): LinkFinding[] {
  const findings: LinkFinding[] = [];
  const reported = new Set<string>();
  for (const start of byId.keys()) {
    const path: string[] = [];
    const onPath = new Set<string>();
    let current: string | null = start;
    while (current !== null && byId.has(current) && !onPath.has(current)) {
      path.push(current);
      onPath.add(current);
      current = byId.get(current)?.supersededBy ?? null;
    }
    if (current === null || !onPath.has(current)) continue;

    const members = path.slice(path.indexOf(current));
    const smallest = [...members].sort((a, b) => a.localeCompare(b))[0];
    if (reported.has(smallest)) continue;
    reported.add(smallest);

    // Rotate so the cycle prints from its smallest id.
    const at = members.indexOf(smallest);
    const ordered = [...members.slice(at), ...members.slice(0, at)];
    findings.push({
      kind: 'cycle',
      id: smallest,
      other: ordered[1 % ordered.length],
      message: `supersession cycle: ${[...ordered, smallest].join(' -> ')}`,
    });
  }
  return findings;
}
