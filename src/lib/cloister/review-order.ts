/**
 * PAN-4702: the order of one reviewer's GitHub verdicts, for the merge gate's
 * approval-at-head proof (`forgeApprovalAtHead` in `pr-facts.ts`).
 *
 * A review's `submittedAt` is not posting order: GitHub has reported verdicts
 * on older commits with timestamps half an hour in the future, and `gh` lists
 * reviews sorted by that timestamp. The review's numeric id is assigned when it
 * is posted, so it is the order this module ranks by.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** The fields of a review that rank it against the same reviewer's others. */
export interface OrderedReview {
  /** GitHub's numeric review id (REST `id`, GraphQL `databaseId`). */
  databaseId?: number | null;
  submittedAt?: string | null;
  commit?: { oid?: string } | null;
}

/**
 * Whether review `a` replaces review `b` as the same reviewer's standing
 * verdict. A verdict on the head outranks one on any other commit: a review of
 * an older commit cannot judge the head, and git ancestry is not read here.
 * Then the higher review id wins. `submittedAt` and the list index decide only
 * when either id is missing.
 */
export function verdictOutranks(
  a: { review: OrderedReview; index: number },
  b: { review: OrderedReview; index: number },
  head: string,
): boolean {
  const aOnHead = a.review.commit?.oid?.toLowerCase() === head;
  if (aOnHead !== (b.review.commit?.oid?.toLowerCase() === head)) return aOnHead;
  const aId = a.review.databaseId;
  const bId = b.review.databaseId;
  if (aId != null && bId != null && aId !== bId) return aId > bId;
  const aAt = submittedAt(a.review);
  const bAt = submittedAt(b.review);
  return aAt > bAt || (aAt === bAt && a.index > b.index);
}

function submittedAt(review: OrderedReview): number {
  const parsed = Date.parse(review.submittedAt ?? '');
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Each review's numeric id keyed by its GraphQL node id, from the REST list
 * (`gh pr view --json reviews` reports only the node id). A failed read throws,
 * so the approval stays unproven rather than ranked by wall-clock.
 */
export async function readReviewDatabaseIds(repo: string, number: number): Promise<Map<string, number>> {
  const { stdout } = await execFileAsync(
    'gh',
    ['api', `repos/${repo}/pulls/${number}/reviews`, '--paginate', '--jq', '.[] | [.node_id, .id] | @tsv'],
    { encoding: 'utf-8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  );
  const ids = new Map<string, number>();
  for (const line of stdout.split('\n')) {
    const [nodeId, id] = line.trim().split('\t');
    if (nodeId && id && Number.isSafeInteger(Number(id))) ids.set(nodeId, Number(id));
  }
  return ids;
}
