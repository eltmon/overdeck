/**
 * PAN-2908 · C-DETAIL — assemble specialist chips from the two real sources:
 * the session tree (reviewer SessionNodes — verdicts, durations, conversation
 * targets) and ReviewStatusSnapshot.reviewSubStatuses (running/done when a
 * reviewer has no session node yet → "queued").
 */
import type { ReviewStatusSnapshot, SessionNode } from '@overdeck/contracts';
import type { SpecialistChip, SpecialistStatus, SpecialistVerdict } from './SpecialistStrip';

export const REVIEW_SPECIALIST_ROLES = ['security', 'correctness', 'performance', 'requirements'] as const;

function verdictOf(session: SessionNode | undefined): SpecialistVerdict | null {
  const result = session?.roundMetadata?.latestReviewResult;
  if (result === 'APPROVED' || result === 'CHANGES_REQUESTED') return result;
  return null;
}

function statusOf(role: string, session: SessionNode | undefined, subStatuses: Record<string, string> | undefined): SpecialistStatus {
  if (session) {
    if (session.status === 'error' || session.roundMetadata?.latestStatus === 'failed') return 'failed';
    if (session.presence === 'active' || session.presence === 'idle') return 'running';
    return 'done';
  }
  const sub = subStatuses?.[role];
  if (sub === 'running') return 'running';
  if (sub === 'done') return 'done';
  return 'queued';
}

function lastLineOf(role: string, session: SessionNode | undefined, subStatuses: Record<string, string> | undefined): string {
  if (session) {
    const verdict = verdictOf(session);
    const round = session.roundMetadata?.latestRound;
    if (verdict === 'APPROVED') return `approved${round ? ` · round ${round}` : ''}`;
    if (verdict === 'CHANGES_REQUESTED') return `changes requested${round ? ` · round ${round}` : ''}`;
    if (session.presence === 'active' || session.presence === 'idle') return 'reviewing now…';
    return 'review complete';
  }
  const sub = subStatuses?.[role];
  if (sub === 'running') return 'reviewing now…';
  if (sub === 'done') return 'review complete';
  return 'starts when the convoy slot frees';
}

/**
 * One chip per known specialist role, ordered canonically. Session-tree
 * reviewer nodes win (they carry verdict + conversation); reviewSubStatuses
 * fill in roles that have no session node yet.
 */
export function deriveSpecialistChips(
  reviewerSessions: SessionNode[],
  reviewStatus?: Pick<ReviewStatusSnapshot, 'reviewSubStatuses' | 'reviewStatus'> | null,
): SpecialistChip[] {
  const byRole = new Map<string, SessionNode>();
  for (const session of reviewerSessions) {
    if (session.type === 'reviewer' && session.role) byRole.set(session.role, session);
  }
  const subStatuses = reviewStatus?.reviewSubStatuses as Record<string, string> | undefined;
  const aggregate = reviewStatus?.reviewStatus;
  const roles = new Set<string>([...REVIEW_SPECIALIST_ROLES, ...byRole.keys(), ...Object.keys(subStatuses ?? {})]);
  return [...roles].map((role) => {
    const session = byRole.get(role);
    const sub = subStatuses?.[role];
    let chip: SpecialistChip;
    if (session) {
      chip = {
        id: role,
        name: `review.${role}`,
        status: statusOf(role, session, subStatuses),
        verdict: verdictOf(session),
        lastLine: lastLineOf(role, session, subStatuses),
        model: session?.model,
        hasConversation: true,
      };
    } else if (sub === 'running' || sub === 'done') {
      chip = {
        id: role,
        name: `review.${role}`,
        status: sub === 'running' ? 'running' : 'done',
        verdict: null,
        lastLine: sub === 'running' ? 'reviewing now…' : 'review complete',
        hasConversation: false,
      };
    } else if (aggregate === 'passed' || aggregate === 'skipped') {
      // Convoy finished before we had per-role data — reflect the completed
      // review, never a phantom "queued".
      chip = { id: role, name: `review.${role}`, status: 'done', verdict: 'APPROVED', lastLine: 'approved · convoy complete', hasConversation: false };
    } else if (aggregate === 'failed' || aggregate === 'blocked') {
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
