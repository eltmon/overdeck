/**
 * sessionOutcome — the one pure derivation an ended session's outcome label
 * comes from (PAN-4290).
 *
 * Every "Session ended" surface reads facts the dashboard store already
 * holds (derived issue state, agent snapshots, SessionNode fields) through
 * this module instead of hard-coding the fallback text. PR-derived outcomes
 * (Merged, review verdict, test result) rank above stop-cause outcomes, so
 * where sources disagree, the PR wins (FR-2). Only `ended-unexpectedly`
 * renders with `attention` tone (FR-4) — every other outcome, including the
 * fallback, is `quiet`.
 *
 * Pure module: no store reads, no React. See `useSessionOutcome.ts` for the
 * store-reading hooks that call this from a component.
 */

import type {
  AgentSnapshot,
  DerivedIssueState,
  IssueState,
  PrChecksState,
  PrReviewState,
  SessionNode,
} from '@overdeck/contracts';

/**
 * The minimal drawer-agent shape `outcomeFactsFromAgent` needs. Deliberately
 * not `SessionAgent` from `./agentConversation` — that module imports
 * `Conversation` from `ConversationList.tsx`, which sits upstream of
 * `AgentStepRow.tsx` in the ProjectTree render chain, so importing it back
 * here would close a circular dependency. A real `SessionAgent` satisfies
 * this structurally.
 */
export interface SessionOutcomeAgent {
  id: string;
  status: string;
  role?: string | null;
  issueId?: string | null;
  stoppedByUser?: boolean;
  paused?: boolean;
}

export type SessionOutcomeKind =
  | 'merged'
  | 'review-approved'
  | 'changes-requested'
  | 'tests-passed'
  | 'tests-failed'
  | 'plan-finalized'
  | 'stopped-by-operator'
  | 'stopped-by-close-out'
  | 'handed-to-review'
  | 'ended-unexpectedly'
  | 'ended';

export type SessionOutcomeTone = 'quiet' | 'attention';

export interface SessionOutcome {
  kind: SessionOutcomeKind;
  /** Visible text, e.g. 'Merged'. */
  label: string;
  /** One tooltip sentence, e.g. "The work agent's PR merged." */
  detail: string;
  tone: SessionOutcomeTone;
}

export type SessionOutcomeRole =
  | 'plan'
  | 'work'
  | 'strike'
  | 'review'
  | 'reviewer'
  | 'test'
  | 'worker'
  | 'other';

export interface SessionOutcomeFacts {
  role: SessionOutcomeRole;
  /** True when the row exists because of PR facts, not an agent (Review/Test specialist rows). */
  synthesized: boolean;
  planningComplete?: boolean;
  /** Per-session verdict (round artifact). */
  reviewerVerdict?: 'APPROVED' | 'CHANGES_REQUESTED';
  prReviewState?: PrReviewState;
  prChecks?: PrChecksState;
  prMerged?: boolean;
  /** undefined = derived state not loaded / unknown. */
  issueState?: IssueState;
  stoppedByUser?: boolean;
  /** A pause is recorded on the agent (operator or machine: memory shed, scheduler yield). */
  paused?: boolean;
  /** Recorded agent status, only from agent-backed facts (AgentSnapshot, or an agent-backed SessionNode). */
  recordedStatus?: string;
}

export const SESSION_ENDED_FALLBACK: SessionOutcome = {
  kind: 'ended',
  label: 'Session ended',
  tone: 'quiet',
  detail: 'This session ended; no outcome could be derived.',
};

const RECORDED_ERROR_STATUSES = new Set(['error', 'failed', 'dead']);
const RECORDED_LIVE_STATUSES = new Set(['running', 'starting']);
const PRIMARY_ROLES = new Set<SessionOutcomeRole>(['plan', 'work', 'strike']);
const HANDED_OFF_STATES = new Set<IssueState>(['in-review', 'changes-requested', 'ready']);

/**
 * Pick the outcome for an ended session (call only when the session has
 * ended). Precedence table (first match wins) — see PRD WI-2.
 */
export function deriveSessionOutcome(facts: SessionOutcomeFacts): SessionOutcome {
  // 1 — merged
  if (
    (facts.role === 'work' || facts.role === 'strike')
    && (facts.prMerged === true || facts.issueState === 'merged')
  ) {
    return {
      kind: 'merged',
      label: 'Merged',
      detail: "The work agent's PR merged.",
      tone: 'quiet',
    };
  }

  // 2/3 — reviewer verdict. D4: for role `reviewer`, the per-session round
  // verdict wins over the PR's aggregate reviewState; for role `review`
  // (the coordinator node and drawer review agents), the PR's reviewState
  // wins over the round verdict.
  if (facts.role === 'review' || facts.role === 'reviewer') {
    const prVerdict: 'APPROVED' | 'CHANGES_REQUESTED' | undefined = facts.prReviewState === 'approved'
      ? 'APPROVED'
      : facts.prReviewState === 'changes-requested'
        ? 'CHANGES_REQUESTED'
        : undefined;
    const verdict = facts.role === 'reviewer'
      ? (facts.reviewerVerdict ?? prVerdict)
      : (prVerdict ?? facts.reviewerVerdict);
    const approved = verdict === 'APPROVED';
    const changesRequested = verdict === 'CHANGES_REQUESTED';
    if (approved) {
      return {
        kind: 'review-approved',
        label: 'Review approved',
        detail: 'The reviewer exited after approving.',
        tone: 'quiet',
      };
    }
    if (changesRequested) {
      return {
        kind: 'changes-requested',
        label: 'Changes requested',
        detail: 'The reviewer exited after requesting changes.',
        tone: 'quiet',
      };
    }
  }

  // 4/5 — test result
  if (facts.role === 'test') {
    if (facts.prChecks === 'green') {
      return {
        kind: 'tests-passed',
        label: 'Tests passed',
        detail: 'The test run finished green.',
        tone: 'quiet',
      };
    }
    if (facts.prChecks === 'red') {
      return {
        kind: 'tests-failed',
        label: 'Tests failed',
        detail: 'The test run finished red.',
        tone: 'quiet',
      };
    }
  }

  // 6 — plan finalized
  if (facts.role === 'plan' && facts.planningComplete === true) {
    return {
      kind: 'plan-finalized',
      label: 'Plan finalized',
      detail: 'The planning agent finalized the plan.',
      tone: 'quiet',
    };
  }

  // 7 — operator stop
  if (facts.stoppedByUser === true) {
    return {
      kind: 'stopped-by-operator',
      label: 'Stopped by operator',
      detail: 'An operator stopped this session.',
      tone: 'quiet',
    };
  }

  // 8 — close-out
  if (facts.issueState === 'closed') {
    return {
      kind: 'stopped-by-close-out',
      label: 'Stopped by close-out',
      detail: 'Close-out stopped this session after the issue closed.',
      tone: 'quiet',
    };
  }

  // 9 — recorded error
  if (facts.recordedStatus !== undefined && RECORDED_ERROR_STATUSES.has(facts.recordedStatus)) {
    return {
      kind: 'ended-unexpectedly',
      label: 'Ended unexpectedly',
      detail: 'The session recorded an error before it ended.',
      tone: 'attention',
    };
  }

  // 10 — pane gone, no stop recorded
  if (facts.recordedStatus !== undefined && RECORDED_LIVE_STATUSES.has(facts.recordedStatus)) {
    return {
      kind: 'ended-unexpectedly',
      label: 'Ended unexpectedly',
      detail: 'The session ended without recording a stop.',
      tone: 'attention',
    };
  }

  // 11 — work/strike agent handed off: its PR is open for review, and no
  // earlier row (recorded error/live status) outranked it.
  if (
    (facts.role === 'work' || facts.role === 'strike')
    && !facts.synthesized
    && facts.issueState !== undefined
    && HANDED_OFF_STATES.has(facts.issueState)
  ) {
    return {
      kind: 'handed-to-review',
      label: 'Handed to review',
      detail: 'The work agent handed off; its PR is open for review.',
      tone: 'quiet',
    };
  }

  // 12 — primary agent ended cleanly with no outcome on a known open, unmerged issue
  if (
    PRIMARY_ROLES.has(facts.role)
    && !facts.synthesized
    && facts.paused !== true
    && facts.issueState !== undefined
    && facts.issueState !== 'merged'
  ) {
    return {
      kind: 'ended-unexpectedly',
      label: 'Ended unexpectedly',
      detail: 'The agent ended before its job finished.',
      tone: 'attention',
    };
  }

  // 13 — fallback
  return SESSION_ENDED_FALLBACK;
}

function roleFromSessionNodeType(type: SessionNode['type']): SessionOutcomeRole {
  switch (type) {
    case 'planning':
    case 'legacy':
      return 'plan';
    case 'work':
      return 'work';
    case 'strike':
      return 'strike';
    case 'review':
      return 'review';
    case 'reviewer':
      return 'reviewer';
    case 'test':
      return 'test';
    default:
      return 'other';
  }
}

/** Build outcome facts for a `SessionNode` (cockpit/rail/session panel). */
export function outcomeFactsFromSessionNode(
  node: SessionNode,
  derived: DerivedIssueState | undefined,
  agent: AgentSnapshot | undefined,
): SessionOutcomeFacts {
  // Worker sessions are pushed as `type: 'work'` nodes with no `role` by
  // `collectSessionTreeNodes` (routes/projects.ts), so `node.type` alone
  // would mislabel a finished worker.
  const role: SessionOutcomeRole = agent?.role === 'worker' ? 'worker' : roleFromSessionNodeType(node.type);
  const synthesized = node.type === 'review' || node.type === 'test' || node.type === 'legacy';

  const recordedStatus = agent
    ? agent.status
    : (!synthesized && node.type !== 'reviewer' && node.type !== 'lint')
      ? node.status
      : undefined;

  const latestReviewResult = node.roundMetadata?.latestReviewResult;
  const reviewerVerdict = latestReviewResult === 'APPROVED' || latestReviewResult === 'CHANGES_REQUESTED'
    ? latestReviewResult
    : undefined;

  return {
    role,
    synthesized,
    planningComplete: node.planningComplete,
    reviewerVerdict,
    prReviewState: derived?.pr?.reviewState,
    prChecks: derived?.pr?.checks,
    prMerged: derived?.pr?.merged,
    issueState: derived?.state,
    stoppedByUser: agent?.stoppedByUser,
    paused: agent?.paused,
    recordedStatus,
  };
}

/** Build outcome facts for a drawer agent (DrawerAgentSession). */
export function outcomeFactsFromAgent(
  agent: SessionOutcomeAgent,
  derived: DerivedIssueState | undefined,
): SessionOutcomeFacts {
  let role: SessionOutcomeRole;
  switch (agent.role) {
    case 'plan':
      role = 'plan';
      break;
    case 'work':
      role = 'work';
      break;
    case 'strike':
      role = 'strike';
      break;
    case 'test':
      role = 'test';
      break;
    case 'worker':
      role = 'worker';
      break;
    case 'review':
      role = /-review-[a-z]+$/i.test(agent.id) ? 'reviewer' : 'review';
      break;
    default:
      role = 'other';
  }

  // D6: the drawer has no `planningComplete`; planning is finalized when the
  // derived state implies the spec exists or work went past planning.
  // `closed` is excluded so a closed issue falls through to close-out.
  const planningComplete = derived?.state !== undefined
    && (['planned', 'working', 'in-review', 'changes-requested', 'ready', 'merged'] as IssueState[]).includes(derived.state)
    ? true
    : undefined;

  return {
    role,
    synthesized: false,
    planningComplete,
    prReviewState: derived?.pr?.reviewState,
    prChecks: derived?.pr?.checks,
    prMerged: derived?.pr?.merged,
    issueState: derived?.state,
    stoppedByUser: agent.stoppedByUser,
    paused: agent.paused,
    recordedStatus: agent.status,
  };
}
