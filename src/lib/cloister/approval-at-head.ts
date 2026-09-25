/**
 * The merge gate's approval rule and its per-head answers (#3983, #4066 review).
 *
 * `approvalProvenAtHead` is the approval half of `evaluateMergeReadiness`, the
 * one rule the merge gate and the board's derived `ready` share. The answers
 * the gate reaches are kept here per issue, keyed by the head they were judged
 * at, so the board agrees with the gate without a forge read of its own: every
 * gate evaluation records one (the auto-merge scheduler's each tick, the merge
 * doors', the merge-ready walk), and a PR-facts read whose trusted marker
 * names the head records a proof. A miss, an expired answer or an answer for
 * another head is unknown, which never derives `ready`.
 *
 * Process-local and short-lived, like the PR-facts cache: nothing here is
 * stored anywhere or answers anything a fresh gate evaluation would not. It has
 * no runtime imports, so the derived-state loader can read it without pulling
 * the forge readers into its module graph.
 */
/** The `PrFacts` fields the approval rule reads (declared here so this module imports nothing). */
export interface ApprovalFacts {
  forge: 'github' | 'gitlab' | null;
  approved: boolean;
  approvedAtHead?: boolean;
  changesRequested: boolean;
}

interface RecordedFacts extends ApprovalFacts {
  issueId: string;
  headSha: string | null;
  open: boolean;
  draft: boolean;
  exists: boolean;
  error?: string;
}

/**
 * Whether the approval for a merge is proven. On GitHub it must stand on the
 * exact head (`approvedAtHead`: a trusted marker naming it, or a trusted
 * reviewer's standing review of it); a GitLab MR needs a named approver
 * (`approved`). Owed rework never counts.
 */
export function approvalProvenAtHead(facts: ApprovalFacts): boolean {
  if (facts.changesRequested) return false;
  return facts.forge === 'github' ? facts.approvedAtHead === true : facts.approved === true;
}

/** A gate's answer outlives a few scheduler ticks, never much more. */
const GATE_ANSWER_TTL_MS = 5 * 60_000;
/** A read's marker proof lives as long as the PR-facts cache entry it came from. */
const READ_PROOF_TTL_MS = 60_000;

interface Answer { readonly head: string; readonly approved: boolean; readonly at: number }

const gateAnswers = new Map<string, Answer>();
const readProofs = new Map<string, Answer>();
const listeners = new Set<(issueId: string) => void>();

function sameCommit(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.length > 0 && y.length > 0 && (x.startsWith(y) || y.startsWith(x));
}

function answerFor(facts: RecordedFacts): { issueId: string; answer: Answer } | null {
  if (facts.error || !facts.exists || !facts.headSha) return null;
  return {
    issueId: facts.issueId.toUpperCase(),
    answer: {
      head: facts.headSha.toLowerCase(),
      approved: facts.open && !facts.draft && approvalProvenAtHead(facts),
      at: Date.now(),
    },
  };
}

/** Record the merge gate's answer for the facts' issue at their head. */
export function recordApprovalAtHead(facts: RecordedFacts): void {
  const recorded = answerFor(facts);
  if (!recorded) return;
  const previous = gateAnswers.get(recorded.issueId);
  gateAnswers.set(recorded.issueId, recorded.answer);
  if (previous && previous.head === recorded.answer.head && previous.approved === recorded.answer.approved) return;
  for (const listener of listeners) {
    try {
      listener(recorded.issueId);
    } catch {
      // A listener's failure never fails the gate that recorded the answer.
    }
  }
}

/** Record a PR-facts read that proves the approval at its head (a marker naming it). */
export function recordReadApprovalAtHead(facts: RecordedFacts): void {
  const recorded = answerFor(facts);
  if (recorded?.answer.approved) readProofs.set(recorded.issueId, recorded.answer);
}

/**
 * The approval answer for this issue at this head: the gate's answer when one
 * judged exactly this head recently, else `true` when a recent read proved it,
 * else `undefined` (unknown).
 */
export function cachedApprovalAtHead(issueId: string, headSha: string | null | undefined): boolean | undefined {
  if (!headSha) return undefined;
  const key = issueId.toUpperCase();
  const now = Date.now();
  const judged = gateAnswers.get(key);
  if (judged && now - judged.at < GATE_ANSWER_TTL_MS && sameCommit(judged.head, headSha)) return judged.approved;
  const read = readProofs.get(key);
  if (read && now - read.at < READ_PROOF_TTL_MS && sameCommit(read.head, headSha)) return true;
  return undefined;
}

/** Called with the issue whenever the gate's answer for it changes. Returns an unsubscribe. */
export function onApprovalAtHeadChanged(listener: (issueId: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Forget every answer. Exported for tests. */
export function resetApprovalAtHeadCache(): void {
  gateAnswers.clear();
  readProofs.clear();
}
