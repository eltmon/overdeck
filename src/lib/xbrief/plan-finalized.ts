/**
 * `Plan-Finalized` trailer protocol (PAN-1728).
 *
 * Planning finalize writes `Plan-Finalized: <sha256>` on the commit that
 * holds the finalized spec; the verification gate's `plan-integrity` check
 * reads it back to find the reference spec a work agent must not change.
 * Both sides import the key and hash from here so they cannot drift.
 */
import { createHash } from 'node:crypto';

/** Git trailer key planning finalize writes on the commit holding the finalized spec (PAN-1728). */
export const PLAN_FINALIZED_TRAILER = 'Plan-Finalized';

/** SHA-256 hex over the spec file's exact bytes. */
export function planFinalizedHash(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** `Plan-Finalized: <hash>` — the last paragraph of a commit message. */
export function formatPlanFinalizedTrailer(hash: string): string {
  return `${PLAN_FINALIZED_TRAILER}: ${hash}`;
}

/** Legacy finalize subject, written before the trailer existed. */
export function isLegacyFinalizeSubject(subject: string, issueId: string): boolean {
  return subject.trim().toLowerCase() === `chore(plan): complete planning for ${issueId.toLowerCase()}`;
}
