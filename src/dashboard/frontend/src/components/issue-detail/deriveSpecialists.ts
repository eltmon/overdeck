/**
 * PAN-2908 · C-DETAIL — assemble specialist chips from the two real sources:
 * the session tree (reviewer SessionNodes — verdicts, durations, conversation
 * targets) and, when the convoy finished before any per-role node was seen,
 * the PR's own review state (PAN-3917: no stored reviewSubStatuses).
 */
import type { SessionNode } from '@overdeck/contracts';
import type { DerivedIssueState } from '../../types';
import type { SpecialistChip, SpecialistStatus, SpecialistVerdict } from './SpecialistStrip';

export const REVIEW_SPECIALIST_ROLES = ['security', 'correctness', 'performance', 'requirements'] as const;

const REVIEWER_ID_ROLE = /-review-([a-z]+)$/i;

/**
 * Adapt legacy Agent records (drawer) to reviewer SessionNodes: specialists
 * register as agents named agent-<issue>-review-<role>. Supervisors and the
 * bare coordinator agent don't get chips — they aren't verdict reviewers.
 */
export function agentsToReviewerSessions(agents: readonly { id: string; status: string; model?: string; startedAt?: string }[]): SessionNode[] {
  const out: SessionNode[] = [];
  for (const agent of agents) {
    const match = REVIEWER_ID_ROLE.exec(agent.id);
    if (!match) continue;
    const role = match[1].toLowerCase();
    if (role === 'supervisor') continue;
    const live = agent.status === 'running' || agent.status === 'starting' || agent.status === 'healthy';
    out.push({
      type: 'reviewer',
      role,
      sessionId: agent.id,
      model: agent.model ?? '',
      status: agent.status === 'error' || agent.status === 'failed' ? 'error' : live ? 'running' : 'stopped',
      presence: live ? 'active' : 'ended',
      startedAt: agent.startedAt ?? '',
    } as SessionNode);
  }
  return out;
}

function verdictOf(session: SessionNode | undefined): SpecialistVerdict | null {
  const result = session?.roundMetadata?.latestReviewResult;
  if (result === 'APPROVED' || result === 'CHANGES_REQUESTED') return result;
  return null;
}

function statusOf(session: SessionNode): SpecialistStatus {
  if (session.status === 'error' || session.roundMetadata?.latestStatus === 'failed') return 'failed';
  if (session.presence === 'active' || session.presence === 'idle') return 'running';
  return 'done';
}

function lastLineOf(session: SessionNode): string {
  const verdict = verdictOf(session);
  const round = session.roundMetadata?.latestRound;
  if (verdict === 'APPROVED') return `approved${round ? ` · round ${round}` : ''}`;
  if (verdict === 'CHANGES_REQUESTED') return `changes requested${round ? ` · round ${round}` : ''}`;
  if (session.presence === 'active' || session.presence === 'idle') return 'reviewing now…';
  return 'review complete';
}

/**
 * One chip per known specialist role, ordered canonically. Session-tree
 * reviewer nodes win (they carry verdict + conversation); the PR's review
 * state fills in roles whose session node is already gone.
 */
export function deriveSpecialistChips(
  reviewerSessions: SessionNode[],
  derived?: DerivedIssueState | null,
): SpecialistChip[] {
  const byRole = new Map<string, SessionNode>();
  for (const session of reviewerSessions) {
    if (session.type === 'reviewer' && session.role) byRole.set(session.role, session);
  }
  const prReviewState = derived?.pr?.reviewState;
  const roles = new Set<string>([...REVIEW_SPECIALIST_ROLES, ...byRole.keys()]);
  return [...roles].map((role) => {
    const session = byRole.get(role);
    let chip: SpecialistChip;
    if (session) {
      chip = {
        id: role,
        name: `review.${role}`,
        status: statusOf(session),
        verdict: verdictOf(session),
        lastLine: lastLineOf(session),
        model: session?.model,
        hasConversation: true,
      };
    } else if (prReviewState === 'approved') {
      // The convoy finished before we saw a per-role node — reflect the PR's
      // own verdict, never a phantom "queued".
      chip = { id: role, name: `review.${role}`, status: 'done', verdict: 'APPROVED', lastLine: 'approved · convoy complete', hasConversation: false };
    } else if (prReviewState === 'changes-requested') {
      chip = { id: role, name: `review.${role}`, status: 'failed', verdict: 'CHANGES_REQUESTED', lastLine: 'changes requested · convoy complete', hasConversation: false };
    } else {
      chip = { id: role, name: `review.${role}`, status: 'queued', verdict: null, lastLine: 'starts when the convoy slot frees', hasConversation: false };
    }
    return chip;
  }).sort((a, b) => {
    const ai = REVIEW_SPECIALIST_ROLES.indexOf(a.id as (typeof REVIEW_SPECIALIST_ROLES)[number]);
    const bi = REVIEW_SPECIALIST_ROLES.indexOf(b.id as (typeof REVIEW_SPECIALIST_ROLES)[number]);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}
