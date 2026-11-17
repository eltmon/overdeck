/**
 * Pure board derivations for the Flywheel lane board (PAN-5283 WI-4).
 *
 * Every function here takes facts the deriver already read (the row's derived
 * state, the journal tail, live panes, the issue's handoff conversations, the
 * gate queue, the merge rows) and answers one question about a card: which
 * lane it sits in, since when, who owns it, which agent drives it, and the one
 * plain-language sentence that says why it is not moving. There is no I/O in
 * this file, so each decision rule (D1–D11 in `.pan/drafts/PAN-5283.md`) has a
 * unit test of its own.
 */

import type {
  BackendPane,
  DerivedPrOutsidePipeline,
  DerivedPrState,
  DerivedWorkStart,
  FlywheelActivity,
  FlywheelBlocker,
  FlywheelCardAgent,
  FlywheelOwner,
  FlywheelStage,
  IssueAttention,
  IssueState,
} from '@overdeck/contracts';

import { isFlywheelStartedBy } from '../agents/provenance.js';
import type { PipelineJournalEntry, PipelineJournalEntryType } from '../cloister/pipeline-journal.js';
import type { QualityGateQueueEntry, QualityGateQueueSnapshot } from '../cloister/quality-gate-admission.js';

// ─── journal labels ──────────────────────────────────────────────────────────

/** Plain-language label for every journal type (FR-5): lower case, no dots. */
export const JOURNAL_ACTIVITY_LABELS: Record<PipelineJournalEntryType, string> = {
  'verification.started': 'checks started',
  'verification.passed': 'checks passed',
  'verification.failed': 'checks failed',
  'review.requested': 'review requested',
  'review.dispatched': 'review started',
  'review.redispatched': 'review restarted',
  'review.halted': 'review halted',
  'review.verdict': 'review verdict posted',
  'review.verdict-refused': 'review verdict refused',
  'review.aborted': 'review aborted',
  'review.synthesis-gave-up': 'review summary gave up',
  'review.verdict-deferred': 'review verdict deferred',
  'review.verdict-replay-gave-up': 'review verdict replay gave up',
  'review.stalled': 'review stalled',
  'review.stall-escalated': 'review stall escalated',
  'review.dispatch-failed': 'review could not start',
  'review.resume-declined': 'review resume declined',
  'review.approval-carried': 'approval carried to new commits',
  'review.stale-approval-rerequested': 'stale approval re-requested',
  'uat.verdict': 'acceptance check verdict posted',
  'feedback.delivered': 'feedback delivered to agent',
  'feedback.skipped': 'feedback skipped',
  'feedback.undelivered': 'feedback not delivered',
  'feedback.followup_filed': 'follow-up issue filed',
  'feedback.followup_failed': 'follow-up issue could not be filed',
  'merge.attempted': 'merge attempted',
  'merge.completed': 'merged',
  'merge.failed': 'merge failed',
  'strike.landed': 'strike landed',
  'conflict.repair-requested': 'conflict repair requested',
  'conflict.repair-escalated': 'conflict repair escalated',
  'blocked.declared': 'agent declared a blocker',
  'blocked.woken': 'blocker cleared, agent woken',
  'handoff.requested': 'handoff requested',
  'handoff.deferred': 'handoff deferred',
  'handoff.retried': 'handoff retried',
  'handoff.started': 'handoff started',
  'handoff.abandoned': 'handoff abandoned',
  'workspace.adopted': 'workspace adopted',
  'workspace.adoption-failed': 'workspace adoption failed',
  'workspace.synced-to-pr-head': 'workspace synced to the PR head',
  'operator.decision-requested': 'asked you a question',
  'operator.decision-answered': 'your answer received',
  'operator.decision-withdrawn': 'question withdrawn',
};

/** The journal entry as a plain-text activity; an unknown type is de-dotted, never shown raw. */
export function activityFrom(entry: Pick<PipelineJournalEntry, 'at' | 'type'> | null | undefined): FlywheelActivity | null {
  if (!entry) return null;
  const label = (JOURNAL_ACTIVITY_LABELS as Record<string, string | undefined>)[entry.type]
    ?? entry.type.replace(/[._-]+/g, ' ').trim();
  return { at: entry.at, label };
}

// ─── formatting ──────────────────────────────────────────────────────────────

/** `HH:MM`, server-local 24 h time; empty for an unparseable time. */
export function formatClock(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** `<1 min`, `<m> min`, or `<h> h <m> min` (D9). */
export function formatWaitAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return '<1 min';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const GIB = 1024 ** 3;

function gb(bytes: number): string {
  return (bytes / GIB).toFixed(1);
}

// ─── gate queue (D9, D10) ────────────────────────────────────────────────────

/** `vitest` → `tests`; `tsc:tsconfig.json` → `typecheck`; `gate:<name>:…` → `<name>`. */
export function gateLabel(gateName: string): string {
  if (gateName === 'vitest') return 'tests';
  if (gateName === 'tsc:tsconfig.json') return 'typecheck';
  if (gateName.startsWith('tsc:')) return `typecheck (${gateName.slice(4)})`;
  const gate = /^gate:([^:]+)/.exec(gateName);
  if (gate?.[1]) return gate[1];
  return gateName;
}

export interface GateMemoryFacts {
  memAvailableBytes: number;
  softReserveBytes: number;
}

/** Why a queued gate waits, recomputed at read time (D9): no reason is stored. */
export function describeGateWait(
  entry: QualityGateQueueEntry,
  snapshot: QualityGateQueueSnapshot,
  memory: GateMemoryFacts | null,
  nowMs: number,
): string {
  const gate = gateLabel(entry.gateName);
  const age = formatWaitAge(nowMs - entry.createdAt);
  if (snapshot.owners.length >= snapshot.slots) {
    return `${gate} queued: ${snapshot.owners.length}/${snapshot.slots} gate slots busy (${age})`;
  }
  if (entry.footprintBytes && memory) {
    const reserved = snapshot.owners.reduce((sum, owner) => sum + (owner.footprintBytes ?? 0), 0);
    const free = memory.memAvailableBytes - reserved;
    if (free - entry.footprintBytes < memory.softReserveBytes) {
      return `${gate} queued: ${gb(free)} GB free, needs ${gb(entry.footprintBytes)} GB, gates keep ${gb(memory.softReserveBytes)} GB (${age})`;
    }
  }
  const ahead = snapshot.waiters.filter((other) => other.createdAt < entry.createdAt).length;
  if (ahead > 0) return `${gate} queued behind ${ahead} other gate${ahead === 1 ? '' : 's'} (${age})`;
  return `${gate} queued: waiting for CPU to settle (${age})`;
}

export interface GateIssueCandidate {
  issueId: string;
  /** The issue's workspace path and the cwd of each of its active handoff conversations. */
  paths: readonly string[];
}

const WORKTREE_ISSUE_RE = /(?:feature|hoff)-([a-z]+-\d+)(?:-strike)?(?:\/|$)/i;

function isSameOrParent(parent: string, child: string): boolean {
  const base = parent.replace(/\/+$/, '');
  return child === base || child.startsWith(`${base}/`);
}

/**
 * The issue a gate ticket belongs to (D10): its own `issueId`, else the
 * longest candidate path that contains the ticket's workspace, else the
 * issue id in a `feature-<id>` / `hoff-<id>` path segment.
 */
export function mapWaiterToIssue(
  entry: Pick<QualityGateQueueEntry, 'issueId' | 'workspacePath'>,
  candidates: readonly GateIssueCandidate[],
): string | null {
  if (entry.issueId) return entry.issueId.toUpperCase();
  let best: { issueId: string; length: number } | null = null;
  for (const candidate of candidates) {
    for (const path of candidate.paths) {
      if (!path || !isSameOrParent(path, entry.workspacePath)) continue;
      if (!best || path.length > best.length) best = { issueId: candidate.issueId.toUpperCase(), length: path.length };
    }
  }
  if (best) return best.issueId;
  const match = WORKTREE_ISSUE_RE.exec(entry.workspacePath);
  return match?.[1] ? match[1].toUpperCase() : null;
}

// ─── facts ───────────────────────────────────────────────────────────────────

/** One handoff conversation tied to the issue, newest first in `BoardFacts`. */
export interface BoardConversation {
  name: string;
  title: string | null;
  model: string | null;
  harness: string | null;
  cwd: string;
  status: 'active' | 'ended';
  tmuxSession?: string;
  /** The conversation's live pane state, when the inventory has its pane. */
  paneState?: BackendPane['state'];
}

export interface BoardAutoMerge {
  status: 'pending' | 'merging' | 'blocked' | 'failed';
  scheduledMergeAt: string;
  scheduledAt: string;
  failureReason?: string;
}

export interface BoardGeneration {
  name: string;
  createdAt: string;
  memberCount: number;
}

export interface BoardFacts {
  issueId: string;
  state: IssueState;
  attention?: IssueAttention;
  pr?: DerivedPrState;
  workStart?: DerivedWorkStart;
  prOutsidePipeline?: DerivedPrOutsidePipeline;
  /** The pipeline journal tail, oldest entry first. */
  journal: readonly PipelineJournalEntry[];
  /** The issue's live panes. */
  panes: readonly BackendPane[];
  /** The issue's unarchived handoff conversations, newest first. */
  conversations: readonly BoardConversation[];
  /** This issue's queued gates, oldest first. */
  gateWaiters: readonly QualityGateQueueEntry[];
  /** This issue's running gates. */
  gateOwners: readonly QualityGateQueueEntry[];
  /** The whole machine queue, for the wait reason. */
  gateQueue: QualityGateQueueSnapshot | null;
  gateMemory: GateMemoryFacts | null;
  autoMerge: BoardAutoMerge | null;
  generation: BoardGeneration | null;
  batchingPausedUntil: string | null;
  inTick: boolean;
  startedBy: string | null;
  nowMs: number;
}

function newest(journal: readonly PipelineJournalEntry[], types: readonly string[]): PipelineJournalEntry | null {
  for (let index = journal.length - 1; index >= 0; index -= 1) {
    const entry = journal[index]!;
    if (types.includes(entry.type)) return entry;
  }
  return null;
}

function newestIso(...values: readonly (string | null | undefined)[]): string | null {
  let best: { iso: string; ms: number } | null = null;
  for (const iso of values) {
    if (!iso) continue;
    const ms = Date.parse(iso);
    if (Number.isFinite(ms) && (!best || ms > best.ms)) best = { iso, ms };
  }
  return best?.iso ?? null;
}

function verificationInFlight(journal: readonly PipelineJournalEntry[]): PipelineJournalEntry | null {
  const latest = newest(journal, ['verification.started', 'verification.passed', 'verification.failed']);
  return latest?.type === 'verification.started' ? latest : null;
}

// ─── stage (D1, D2) ──────────────────────────────────────────────────────────

/** The card's lane (D1), first match wins. */
export function deriveStage(facts: BoardFacts): FlywheelStage {
  if (facts.autoMerge || facts.generation) return 'merge';
  if (facts.state === 'ready') return 'merge';
  if (verificationInFlight(facts.journal) || facts.gateWaiters.length > 0 || facts.gateOwners.length > 0) return 'checks';
  if (facts.state === 'in-review') return 'review';
  if (facts.state === 'working' || facts.state === 'changes-requested') return 'build';
  return 'plan';
}

/** When the card entered its lane (D2); null renders no time. */
export function deriveStageSince(facts: BoardFacts, stage: FlywheelStage = deriveStage(facts)): string | null {
  const { journal } = facts;
  switch (stage) {
    case 'checks': {
      const tickets = [...facts.gateWaiters, ...facts.gateOwners];
      const oldestTicket = tickets.length
        ? new Date(Math.min(...tickets.map((ticket) => ticket.createdAt))).toISOString()
        : null;
      return newestIso(verificationInFlight(journal)?.at, oldestTicket);
    }
    case 'build':
      return newest(journal, ['verification.failed', 'feedback.delivered', 'handoff.started', 'workspace.adopted', 'review.verdict'])?.at ?? null;
    case 'review':
      return newest(journal, ['verification.passed', 'review.requested', 'review.dispatched', 'review.redispatched'])?.at ?? null;
    case 'merge':
      return facts.autoMerge?.scheduledAt ?? facts.generation?.createdAt ?? newest(journal, ['merge.attempted'])?.at ?? null;
    case 'plan': {
      const since = facts.panes.find((pane) => pane.role === 'plan')?.stateSince;
      return typeof since === 'number' && Number.isFinite(since) ? new Date(since).toISOString() : null;
    }
  }
}

// ─── owner (D3) ──────────────────────────────────────────────────────────────

export function deriveOwner(facts: BoardFacts): FlywheelOwner {
  if (facts.inTick || isFlywheelStartedBy(facts.startedBy)) return { kind: 'flywheel' };
  const conversation = facts.conversations[0];
  if (conversation) return { kind: 'conversation', name: conversation.name, title: conversation.title };
  return { kind: 'operator' };
}

// ─── agent (D4) ──────────────────────────────────────────────────────────────

const PANE_ROLE_ORDER: readonly BackendPane['role'][] = ['work', 'worker', 'review', 'test', 'uat', 'strike', 'plan', 'conversation'];

function cardState(state: BackendPane['state'] | undefined): FlywheelCardAgent['state'] {
  switch (state) {
    case 'working': return 'working';
    case 'blocked': return 'blocked';
    case 'idle':
    case 'done': return 'idle';
    default: return 'unknown';
  }
}

function conversationForPane(pane: BackendPane, conversations: readonly BoardConversation[]): string {
  const key = pane.agentId ?? pane.terminalId ?? pane.id;
  const match = conversations.find((conv) => conv.tmuxSession === key || `conv-${conv.name}` === key || conv.name === key);
  return match?.name ?? key.replace(/^conv-/, '');
}

/**
 * The agent a card shows (D4), or null when nothing drives the issue. With no
 * pane and no handoff conversation, a queued gate shows as role `gate`.
 */
export function deriveCardAgent(facts: BoardFacts): FlywheelCardAgent | null {
  const waiting = facts.gateWaiters.length > 0;
  const pane = [...facts.panes]
    .filter((candidate) => candidate.state !== 'exited')
    .sort((a, b) => PANE_ROLE_ORDER.indexOf(a.role) - PANE_ROLE_ORDER.indexOf(b.role))[0];
  if (pane) {
    const handoff = pane.role === 'conversation';
    return {
      role: handoff ? 'handoff' : pane.role,
      model: pane.model || null,
      harness: pane.harness || null,
      state: waiting ? 'waiting' : cardState(pane.state),
      ...(pane.agentId ? { agentId: pane.agentId } : {}),
      ...(handoff ? { conversationName: conversationForPane(pane, facts.conversations) } : {}),
    };
  }
  const conversation = facts.conversations.find((conv) => conv.status === 'active');
  // A queued gate is the work in progress, so it never reads as "no agent" (FR-4).
  if (!conversation) return waiting ? { role: 'gate', model: null, harness: null, state: 'waiting' } : null;
  return {
    role: 'handoff',
    model: conversation.model,
    harness: conversation.harness,
    state: waiting ? 'waiting' : cardState(conversation.paneState),
    conversationName: conversation.name,
  };
}

// ─── blocker (D11) ───────────────────────────────────────────────────────────

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^(.+?[.!?])(?:\s|$)/s.exec(trimmed);
  return (match?.[1] ?? trimmed).trim();
}

function dataString(entry: PipelineJournalEntry, key: string): string | null {
  const value = entry.data?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : null;
}

function failedVerification(journal: readonly PipelineJournalEntry[]): PipelineJournalEntry | null {
  const latest = newest(journal, ['verification.started', 'verification.passed', 'verification.failed']);
  return latest?.type === 'verification.failed' ? latest : null;
}

/** The one sentence on why the card is not moving (D11), first match wins; null when nothing holds it. */
export function deriveBlocker(facts: BoardFacts): FlywheelBlocker | null {
  const stage = deriveStage(facts);
  const agent = deriveCardAgent(facts);
  const agentLive = agent !== null && agent.role !== 'gate';
  const suffix = agentLive ? ', agent fixing' : ', no agent running';
  const latest = facts.journal[facts.journal.length - 1] ?? null;

  // 1. A queued quality gate.
  const oldestWaiter = facts.gateWaiters[0];
  if (oldestWaiter && facts.gateQueue) {
    const more = facts.gateWaiters.length - 1;
    const text = describeGateWait(oldestWaiter, facts.gateQueue, facts.gateMemory, facts.nowMs)
      + (more > 0 ? ` +${more} more` : '');
    return { kind: 'gate-queue', severity: 'waiting', text };
  }
  // 2–6. Attention the derived state already raised.
  switch (facts.attention) {
    case 'needs-you':
      return { kind: 'agent-question', severity: 'needs-you', text: 'agent is waiting for your answer', action: 'answer-agent' };
    case 'api-error':
      return { kind: 'agent-error', severity: 'stuck', text: 'agent hit a provider error (rate limit or outage)' };
    case 'work-not-started': {
      const retry = facts.workStart?.nextRetryAt ? `, retrying at ${formatClock(facts.workStart.nextRetryAt)}` : '';
      return {
        kind: 'start-failed',
        severity: 'needs-you',
        text: `auto-start failed: ${facts.workStart?.error ?? 'no work agent came up'}${retry}`,
        action: 'start-issue',
      };
    }
    case 'pr-outside-pipeline':
      if (facts.prOutsidePipeline) {
        return { kind: 'pr-outside-pipeline', severity: 'needs-you', text: firstSentence(facts.prOutsidePipeline.fix) };
      }
      break;
    case 'stuck':
      return { kind: 'agent-stuck', severity: 'stuck', text: 'agent idle with unpushed commits' };
    default:
      break;
  }
  // 7. A failed verification nothing has superseded.
  const failed = failedVerification(facts.journal);
  if (failed) {
    const failedCheck = dataString(failed, 'failedCheck');
    if (failedCheck === 'test-skip') {
      return { kind: 'test-removal-waiver', severity: 'needs-you', text: 'test-skip gate failed: needs your test-removal waiver', action: 'waive-test-removal' };
    }
    if (dataString(failed, 'via') === 'ci') {
      const pr = dataString(failed, 'prNumber');
      return { kind: 'ci-failed', severity: 'stuck', text: `CI tests failed${pr ? ` on PR #${pr}` : ''}${suffix}` };
    }
    const round = dataString(failed, 'cycleCount');
    return {
      kind: 'verification-failed',
      severity: 'stuck',
      text: `${failedCheck ?? 'a'} check failed${round ? ` (round ${round})` : ''}${suffix}`,
    };
  }
  // 8–9. The newest journal entry says delivery or merge failed.
  if (latest?.type === 'feedback.undelivered') {
    const source = `${dataString(latest, 'kind') ?? ''} ${dataString(latest, 'reason') ?? ''}`;
    return {
      kind: 'feedback-undelivered',
      severity: 'stuck',
      text: /coderabbit/i.test(source) ? 'CodeRabbit feedback not delivered' : 'review feedback not delivered',
    };
  }
  if (latest?.type === 'merge.failed') {
    const reason = dataString(latest, 'reason');
    return { kind: 'merge-failed', severity: 'stuck', text: reason ? `merge failed: ${reason}` : 'merge failed' };
  }
  // 10. A pending auto-merge row.
  if (facts.autoMerge) {
    switch (facts.autoMerge.status) {
      case 'pending':
        return { kind: 'auto-merge-scheduled', severity: 'waiting', text: `auto-merge at ${formatClock(facts.autoMerge.scheduledMergeAt)}` };
      case 'merging':
        return { kind: 'auto-merge-scheduled', severity: 'waiting', text: 'merging now' };
      default: {
        const reason = facts.autoMerge.failureReason?.trim().slice(0, 120);
        return { kind: 'auto-merge-blocked', severity: 'stuck', text: reason ? `auto-merge blocked: ${reason}` : 'auto-merge blocked' };
      }
    }
  }
  // 11. The merge train.
  if (facts.generation) {
    const name = facts.generation.name.replace(/^uat\//, '');
    const count = facts.generation.memberCount;
    return {
      kind: 'train-batch',
      severity: 'waiting',
      text: `in train batch ${name} (${count} PR${count === 1 ? '' : 's'}), waiting for batch CI`,
    };
  }
  if (facts.batchingPausedUntil && facts.state === 'ready') {
    return {
      kind: 'train-paused',
      severity: 'waiting',
      text: `train batching paused until ${formatClock(facts.batchingPausedUntil)}; merges one at a time`,
    };
  }
  // 12–13. The PR itself.
  if (facts.pr?.checks === 'red') {
    return { kind: 'ci-red', severity: 'stuck', text: `CI red on PR #${facts.pr.number}${suffix}` };
  }
  if (facts.pr?.mergeable === false) return { kind: 'merge-conflict', severity: 'stuck', text: 'merge conflict with main' };
  // 14–15. The newest journal entry says the work is held.
  if (latest?.type === 'blocked.declared') {
    const blockers = Array.isArray(latest.data?.blockers)
      ? (latest.data.blockers as unknown[]).filter((value): value is string => typeof value === 'string')
      : [];
    return { kind: 'declared-blocked', severity: 'stuck', text: blockers.length ? `blocked: waits on ${blockers.join(', ')}` : 'blocked' };
  }
  if (latest?.type === 'review.stalled' || latest?.type === 'review.stall-escalated') {
    return { kind: 'review-stalled', severity: 'stuck', text: 'review stalled' };
  }
  // 16. Work in flight with nobody driving it.
  if ((stage === 'build' || stage === 'checks' || stage === 'review') && !agentLive) {
    return { kind: 'no-agent', severity: 'stuck', text: 'no agent running' };
  }
  return null;
}
