/**
 * Claim check (PAN-4339): the pure refusal logic behind `pan task claim`, plus
 * the async orchestrator that reads the continue file, probes holder
 * liveness, and either records the claim or throws.
 *
 * `pan task claim` overwrote `claimedBy` unconditionally — docs/XBRIEF.md's
 * "exactly one claim succeeds" was false, and nothing stopped two workers
 * claiming items whose `files_scope` overlapped. `checkClaim` is the missing
 * check: pure, synchronous, and driven entirely by its `ClaimCheckInput` (no
 * disk or process access), so the refusal rules can be unit tested without a
 * git checkout. `claimItemChecked` is the thin async shell around it that
 * production callers use; the caller (task.ts) is responsible for holding the
 * task-state lock across the whole call.
 *
 * No lease, TTL, heartbeat, or stored liveness: liveness is always derived at
 * claim time from `isAlive` and never written to the continue file.
 */

import { isAlive, isConfirmedDead, type LivenessVerdict } from '../agents/liveness.js';
import { hasFileOverlap } from './dag.js';
import { claimItem, readContinueState, type ContinueItemsMap, type ContinueItemState } from './continue-state.js';
import type { XBriefItem } from './types.js';

export type HolderLiveness = 'alive' | 'dead' | 'indeterminate';

export type ClaimRefusal =
  | { kind: 'held'; holder: string; liveness: 'alive' | 'indeterminate' }
  | {
      kind: 'overlap';
      holder: string;
      liveness: 'alive' | 'indeterminate';
      conflictingItemId: string;
      sharedPaths: string[];
      lowConfidence: boolean;
    };

export type ClaimCheckResult =
  | { ok: true; overridden: ClaimRefusal[] }
  | { ok: false; refusal: ClaimRefusal };

export interface ClaimCheckInput {
  items: readonly XBriefItem[];
  claims: ContinueItemsMap;
  itemId: string;
  claimant: string;
  /** Liveness of every holder other than the claimant. A missing holder is 'indeterminate'. */
  liveness: ReadonlyMap<string, HolderLiveness>;
  steal?: boolean;
}

/** A continue-file entry is an active claim (D1) when it has a holder and isn't terminal. */
function isActiveClaim(claim: ContinueItemState | undefined): claim is ContinueItemState & { claimedBy: string } {
  if (!claim?.claimedBy) return false;
  return claim.status !== 'completed' && claim.status !== 'cancelled';
}

/**
 * Every path from either item's `files_scope` that actually participates in
 * the overlap between the two, checked one path at a time so the result
 * names only the files in conflict rather than each item's whole scope.
 */
function sharedPathsBetween(a: XBriefItem, b: XBriefItem): string[] {
  const paths = new Set<string>();
  for (const path of a.metadata?.files_scope ?? []) {
    if (hasFileOverlap([b], { ...a, metadata: { ...a.metadata, files_scope: [path] } })) {
      paths.add(path);
    }
  }
  for (const path of b.metadata?.files_scope ?? []) {
    if (hasFileOverlap([a], { ...b, metadata: { ...b.metadata, files_scope: [path] } })) {
      paths.add(path);
    }
  }
  return [...paths].sort();
}

/**
 * FR-1..FR-5, FR-9. Pure: no disk, process, or network access.
 *
 * Order: (1) the target item itself is actively held by someone other than
 * the claimant, with liveness alive/indeterminate — `held`. (2) the target
 * item's `files_scope` overlaps another actively-claimed item's scope (or
 * either side has a low-confidence scope) — `overlap`, checked over every
 * other active claim in sorted item-id order. `steal: true` collects every
 * refusal either step would have raised and returns ok with them in
 * `overridden`; otherwise the first refusal found wins.
 */
export function checkClaim(input: ClaimCheckInput): ClaimCheckResult {
  const { items, claims, itemId, claimant, liveness, steal = false } = input;
  const refusals: ClaimRefusal[] = [];

  const targetClaim = claims[itemId];
  if (targetClaim && isActiveClaim(targetClaim) && targetClaim.claimedBy !== claimant) {
    const holder = targetClaim.claimedBy;
    const holderLiveness = liveness.get(holder) ?? 'indeterminate';
    if (holderLiveness !== 'dead') {
      refusals.push({ kind: 'held', holder, liveness: holderLiveness });
    }
  }

  const targetItem = items.find(item => item.id === itemId);
  if (targetItem) {
    const otherItemIds = Object.keys(claims)
      .filter(key => key !== itemId)
      .sort();
    for (const conflictingItemId of otherItemIds) {
      const claim = claims[conflictingItemId];
      if (!isActiveClaim(claim)) continue;
      const holder = claim.claimedBy;
      const holderLiveness = holder === claimant ? 'alive' : (liveness.get(holder) ?? 'indeterminate');
      if (holderLiveness === 'dead') continue;

      const other = items.find(item => item.id === conflictingItemId);
      if (!other) continue;

      const lowConfidence =
        targetItem.metadata?.files_scope_confidence === 'low' ||
        other.metadata?.files_scope_confidence === 'low';

      if (lowConfidence) {
        refusals.push({
          kind: 'overlap',
          holder,
          liveness: holderLiveness,
          conflictingItemId,
          sharedPaths: [],
          lowConfidence: true,
        });
        continue;
      }

      if (hasFileOverlap([other], targetItem)) {
        refusals.push({
          kind: 'overlap',
          holder,
          liveness: holderLiveness,
          conflictingItemId,
          sharedPaths: sharedPathsBetween(targetItem, other),
          lowConfidence: false,
        });
      }
    }
  }

  if (steal) return { ok: true, overridden: refusals };
  const [first] = refusals;
  return first ? { ok: false, refusal: first } : { ok: true, overridden: [] };
}

/** FR-6: the claimant id, first non-empty of `OVERDECK_CLAIM_ID`, `OVERDECK_AGENT_ID`, `cli-<pid>`. */
export function resolveClaimantId(env: NodeJS.ProcessEnv = process.env, pid: number = process.pid): string {
  return env.OVERDECK_CLAIM_ID || env.OVERDECK_AGENT_ID || `cli-${pid}`;
}

/** Holders of active claims (D1) other than the claimant — the ids to probe. Sorted, unique. */
export function holdersToProbe(claims: ContinueItemsMap, claimant: string): string[] {
  const holders = new Set<string>();
  for (const claim of Object.values(claims)) {
    if (isActiveClaim(claim) && claim.claimedBy !== claimant) {
      holders.add(claim.claimedBy);
    }
  }
  return [...holders].sort();
}

/**
 * FR-8 + liveness classification. A `cli-*` holder is a CLI process that has
 * already exited (a `pan task claim` invocation, not a long-lived agent), so
 * it's classified dead without probing — `isAliveFn` is never called for it.
 */
export async function probeHolder(
  holder: string,
  isAliveFn: (agentId: string) => Promise<LivenessVerdict> = isAlive,
): Promise<HolderLiveness> {
  if (holder.startsWith('cli-')) return 'dead';
  const verdict = await isAliveFn(holder);
  if (verdict.alive) return 'alive';
  return isConfirmedDead(verdict) ? 'dead' : 'indeterminate';
}

function runningClause(liveness: 'alive' | 'indeterminate', holder: string): string {
  return liveness === 'alive'
    ? 'still running'
    : `and Overdeck could not tell whether ${holder} is still running (the terminal backend did not answer)`;
}

/** One sentence-complete message per refusal (NFR-6): names the holder, says nothing was written, names both exits. */
export function formatClaimRefusal(itemId: string, refusal: ClaimRefusal): string {
  if (refusal.kind === 'held') {
    const { holder, liveness } = refusal;
    if (liveness === 'alive') {
      return (
        `${itemId} is claimed by ${holder}, which is still running. Nothing was written. ` +
        `Run "pan task next" to pick another item, or pass --steal if ${holder} is stuck.`
      );
    }
    return (
      `${itemId} is claimed by ${holder}, and Overdeck could not tell whether ${holder} is still running ` +
      `(the terminal backend did not answer). Nothing was written. ` +
      `Run "pan task next" to pick another item, or pass --steal if you know ${holder} is gone.`
    );
  }

  const { conflictingItemId, holder, liveness, sharedPaths, lowConfidence } = refusal;
  const exits =
    `Wait for ${conflictingItemId} to finish, run "pan task next" to pick another item, ` +
    `or pass --steal to claim it anyway.`;

  if (lowConfidence) {
    const clause = liveness === 'alive' ? 'still running' : runningClause(liveness, holder);
    return (
      `${itemId} cannot run beside ${conflictingItemId} (claimed by ${holder}, ${clause}): ` +
      `one of them has a low-confidence files_scope, so Overdeck cannot prove they touch different files. ` +
      `Nothing was written. ${exits}`
    );
  }

  return (
    `${itemId} shares files with ${conflictingItemId}, which ${holder} has claimed and is ` +
    `${runningClause(liveness, holder)}: ${sharedPaths.join(', ')}. ` +
    `Two workers editing the same files overwrite each other, so nothing was written. ${exits}`
  );
}

export class ClaimRefused extends Error {
  constructor(
    readonly itemId: string,
    readonly refusal: ClaimRefusal,
  ) {
    super(formatClaimRefusal(itemId, refusal));
    this.name = 'ClaimRefused';
  }
}

/**
 * Read → probe holders (parallel) → check → claimItem. Throws `ClaimRefused`
 * when the check refuses. The caller holds the task-state lock across this
 * whole call (and its own `commitContinue`), so the read and the eventual
 * write are not racing another `pan task` process.
 */
export async function claimItemChecked(
  planHome: string,
  issueId: string,
  itemId: string,
  claimant: string,
  options: {
    items: readonly XBriefItem[];
    probe?: (holder: string) => Promise<HolderLiveness>;
    steal?: boolean;
  },
): Promise<{ state: ContinueItemState; overridden: ClaimRefusal[] }> {
  const probe = options.probe ?? probeHolder;
  const claims = readContinueState(planHome, issueId)?.items ?? {};
  const holders = holdersToProbe(claims, claimant);
  const entries = await Promise.all(
    holders.map(async (holder): Promise<[string, HolderLiveness]> => {
      try {
        return [holder, await probe(holder)];
      } catch {
        return [holder, 'indeterminate'];
      }
    }),
  );
  const liveness = new Map(entries);

  const result = checkClaim({
    items: options.items,
    claims,
    itemId,
    claimant,
    liveness,
    steal: options.steal,
  });

  if (!result.ok) throw new ClaimRefused(itemId, result.refusal);

  const state = claimItem(planHome, issueId, itemId, claimant);
  return { state, overridden: result.overridden };
}
