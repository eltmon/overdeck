/**
 * Deft's review cycle as a view model (PAN-4849 WI-20, FR-18, FR-19).
 *
 * Deft's `deft-directive-review-cycle` skill keeps no per-round state: it
 * waits for Greptile, fixes findings in batch commits, and exits when its
 * five-field predicate holds. Greptile edits one rolling summary comment in
 * place, so only its inline comments and the fix-batch commits carry
 * history. `deriveDeftReviewCycle` rebuilds rounds from those (BD-4, labeled
 * reconstructed) and evaluates the exit predicate on one snapshot, using
 * Deft's own verdict names (BD-7). It is pure: the route loads the inputs.
 */
import type {
  DeftExitField,
  DeftIssueState,
  DeftReviewCycle,
  DeftReviewRound,
  DeftSeverityCounts,
} from '@overdeck/contracts';

export interface DeftReviewDiscussion {
  source: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface DeftReviewCycleInput {
  issueId: string;
  prNumber: number | null;
  headSha: string | null;
  discussions: DeftReviewDiscussion[];
  checkRuns: Array<{ name: string; status: string; conclusion: string | null }>;
  /** Fix-batch commits on the branch, oldest first. */
  fixCommits: Array<{ sha: string; subject: string; committedAt: string }>;
  state: Pick<DeftIssueState, 'policy' | 'reviewerConfigPresent' | 'heartbeats' | 'cleanRecords'>;
}

const GREPTILE_AUTHOR = /^greptile-apps(\[bot\])?$/i;
const GREPTILE_CHECK = /greptile/i;
const UNSUPPORTED_CHECK = /slizard|coderabbit/i;
const FENCED_CODE = /```[\s\S]*?```/g;
const BADGE = /<img\s+alt="P([012])"/g;
const TIER2 = /^[\s\-*]*\*\*P([01])\b([^*]*)\*\*/gm;
const TIER2_P2 = /^[\s\-*]*\*\*P2\b[^*]*\*\*/gm;
const TIER25 = /^#{1,6}\s+P([01])\s*[·‧•-]\s/gm;
/** A bold label that reports none, e.g. `**P0: none**` or `**P1 - 0 findings**`. */
const NEGATED_LABEL = /^[\s:·‧•-]*(no|zero|none|0)\b/i;
const CONFIDENCE = /Confidence Score:\s*(\d+)\s*\/\s*5/;
const LAST_REVIEWED = /Last reviewed commit:\s*\[.*?\]\(https?:\/\/github\.com\/[^/]+\/[^/]+\/commit\/([0-9a-f]{7,40})/;
const LEASE_START = '<!-- deft:review-owner';
const LEASE_FIELD = /^(kind|owner|monitor_agent_id|agent_id|pass_kind|ceiling|head_sha|started_at|expires_at|platform_primitive|ended_at):\s*(.*)$/;

const isGreptile = (author: string): boolean => GREPTILE_AUTHOR.test(author);
const time = (iso: string): number => Date.parse(iso);

/** P0/P1/P2 findings in one Greptile body, after stripping fenced code. */
export function countSeverities(body: string): DeftSeverityCounts {
  const text = body.replace(FENCED_CODE, '');
  const counts: DeftSeverityCounts = { p0: 0, p1: 0, p2: 0 };
  const bump = (level: string): void => {
    if (level === '0') counts.p0++;
    else if (level === '1') counts.p1++;
    else counts.p2++;
  };
  for (const match of text.matchAll(BADGE)) bump(match[1]!);
  for (const match of text.matchAll(TIER2)) if (!NEGATED_LABEL.test(match[2]!)) bump(match[1]!);
  for (const match of text.matchAll(TIER25)) bump(match[1]!);
  counts.p2 += [...text.matchAll(TIER2_P2)].length;
  return counts;
}

const addCounts = (a: DeftSeverityCounts, b: DeftSeverityCounts): DeftSeverityCounts => ({ p0: a.p0 + b.p0, p1: a.p1 + b.p1, p2: a.p2 + b.p2 });
const ZERO: DeftSeverityCounts = { p0: 0, p1: 0, p2: 0 };

/** Equal when the shorter sha (at least 7 chars) prefixes the longer. */
function sameSha(a: string, b: string): boolean {
  const n = Math.min(a.length, b.length);
  return n >= 7 && a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase();
}

function reviewerOf(input: DeftReviewCycleInput, greptileItems: DeftReviewDiscussion[]): DeftReviewCycle['reviewer'] {
  const unsupported = input.checkRuns.filter(run => UNSUPPORTED_CHECK.test(run.name)).map(run => run.name);
  const present = (source: DeftReviewCycle['reviewer']['source']): DeftReviewCycle['reviewer'] =>
    ({ present: true, name: 'greptile', source, unsupported });
  const reviewers = input.state.policy.reviewers;
  if (reviewers !== null) {
    return reviewers.some(name => name.toLowerCase() === 'greptile')
      ? present('policy')
      : { present: false, name: null, source: 'policy', unsupported };
  }
  if (greptileItems.length > 0) return present('comment');
  if (input.checkRuns.some(run => GREPTILE_CHECK.test(run.name))) return present('check_run');
  if (input.state.reviewerConfigPresent) return present('config');
  return { present: false, name: null, source: 'none', unsupported };
}

function leaseOf(discussions: DeftReviewDiscussion[], headSha: string | null, now: number): DeftReviewCycle['lease'] {
  const item = [...discussions]
    .filter(entry => entry.body.includes(LEASE_START))
    .sort((a, b) => time(a.createdAt) - time(b.createdAt))
    .at(-1);
  if (!item) return null;
  const block = item.body.slice(item.body.indexOf(LEASE_START) + LEASE_START.length);
  const end = block.indexOf('-->');
  const fields: Record<string, string> = {};
  for (const line of (end >= 0 ? block.slice(0, end) : block).split(/\r?\n/)) {
    const match = LEASE_FIELD.exec(line.trim());
    if (match) fields[match[1]!] = match[2]!.trim();
  }
  const leaseHead = fields.head_sha || null;
  const endedAt = fields.ended_at || null;
  const expiresAt = fields.expires_at ?? '';
  const headMatches = !leaseHead || !headSha || headSha.startsWith(leaseHead) || leaseHead.startsWith(headSha);
  return {
    owner: fields.owner ?? '',
    monitorAgentId: fields.monitor_agent_id ?? '',
    headSha: leaseHead,
    startedAt: fields.started_at ?? '',
    expiresAt,
    endedAt,
    active: !endedAt && now < time(expiresAt) && headMatches,
  };
}

function roundsOf(
  inline: DeftReviewDiscussion[],
  fixCommits: DeftReviewCycleInput['fixCommits'],
  summaryCounts: DeftSeverityCounts | null,
): DeftReviewRound[] {
  const sorted = [...inline].sort((a, b) => time(a.createdAt) - time(b.createdAt));
  const rounds: DeftReviewRound[] = [];
  let rest = sorted;
  const round = (index: number, items: DeftReviewDiscussion[], fixCommit: DeftReviewRound['fixCommit'], findings?: DeftSeverityCounts): DeftReviewRound => ({
    index,
    findings: findings ?? items.reduce((sum, item) => addCounts(sum, countSeverities(item.body)), ZERO),
    commentCount: items.length,
    fixCommit,
    startedAt: items[0]?.createdAt ?? null,
  });
  fixCommits.forEach((fix, i) => {
    const cutoff = time(fix.committedAt);
    const items = rest.filter(item => time(item.createdAt) <= cutoff);
    rest = rest.filter(item => time(item.createdAt) > cutoff);
    rounds.push(round(i + 1, items, fix));
  });
  if (rest.length > 0 || summaryCounts) rounds.push(round(fixCommits.length + 1, rest, null, summaryCounts ?? undefined));
  return rounds;
}

export function deriveDeftReviewCycle(input: DeftReviewCycleInput, now: number = Date.now()): DeftReviewCycle {
  const greptileItems = input.discussions.filter(item => isGreptile(item.author));
  const summary = greptileItems
    .filter(item => item.source === 'github-pr-conversation' && (item.body.includes('Confidence Score:') || item.body.includes('Last reviewed commit:')))
    .sort((a, b) => time(a.createdAt) - time(b.createdAt))
    .at(-1);
  const inline = greptileItems.filter(item => item.source === 'github-pr-review-comment' || item.source === 'github-pr-review');
  const reviewer = reviewerOf(input, greptileItems);
  const summaryCounts = summary ? countSeverities(summary.body) : null;

  const check = input.checkRuns.find(run => GREPTILE_CHECK.test(run.name));
  const checkRun: DeftExitField = !check || check.status !== 'completed'
    ? 'unknown'
    : check.conclusion === 'success' || check.conclusion === 'neutral' ? 'met' : 'unmet';
  const lastReviewedSha = summary ? (LAST_REVIEWED.exec(summary.body)?.[1] ?? null) : null;
  const lastReviewedCommit: DeftExitField = !lastReviewedSha || !input.headSha
    ? 'unknown'
    : sameSha(lastReviewedSha, input.headSha) ? 'met' : 'unmet';
  const scoreText = summary ? CONFIDENCE.exec(summary.body)?.[1] : undefined;
  const confidenceScore = scoreText === undefined ? null : Number(scoreText);
  const minConfidence = input.state.policy.minGreptileConfidence;
  const confidence: DeftExitField = confidenceScore === null ? 'unknown' : confidenceScore >= minConfidence ? 'met' : 'unmet';
  const p0p1Remaining = summaryCounts ? summaryCounts.p0 + summaryCounts.p1 : null;
  const noBlocking: DeftExitField = p0p1Remaining === null ? 'unknown' : p0p1Remaining === 0 ? 'met' : 'unmet';
  const headShaField: DeftExitField = input.headSha ? 'met' : 'unknown';

  const allMet = [checkRun, headShaField, lastReviewedCommit, confidence, noBlocking].every(field => field === 'met');
  const verdict = !reviewer.present
    ? 'NO_REVIEWER_INSTALLED'
    : allMet ? 'CLEAN' : lastReviewedCommit === 'met' && noBlocking === 'unmet' ? 'NEW_P0_P1' : 'PENDING';

  return {
    issueId: input.issueId,
    prNumber: input.prNumber,
    headSha: input.headSha,
    reviewer,
    verdict,
    exit: { checkRun, headSha: headShaField, lastReviewedCommit, confidence, noBlocking, confidenceScore, minConfidence, lastReviewedSha, p0p1Remaining },
    rounds: reviewer.present ? roundsOf(inline, input.fixCommits, summaryCounts) : [],
    roundsReconstructed: true,
    lease: leaseOf(input.discussions, input.headSha, now),
    heartbeats: input.state.heartbeats.filter(beat => beat.agentId.startsWith('pr-watch-') || beat.phase === 'polling' || beat.phase === 'fixing'),
    cleanRecords: input.state.cleanRecords.filter(record => record.prNumber === input.prNumber),
    errors: [],
  };
}
