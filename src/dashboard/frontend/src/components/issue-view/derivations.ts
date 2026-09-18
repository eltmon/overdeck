import type { AgentSnapshot, SessionNode } from '@overdeck/contracts';
import type { DerivedIssueState } from '../../types';
import type { IssueShipModel, OperatorNeedsYou } from './types';

/**
 * Issue-view derivations (PAN-2499).
 *
 * PAN-3917: every answer here comes from the derived issue state (the tracker,
 * the PR, checks, git) or from the session/pane inventory. Nothing reads a
 * stored status field.
 */

/** True when the agent/session is actively running right now. */
export function isAgentRunning(session: SessionNode, agent?: AgentSnapshot): boolean {
  if (agent?.status === 'running' || agent?.status === 'starting') return true;
  if (session.status === 'running' || session.status === 'starting') {
    return session.presence !== 'ended';
  }
  return false;
}

/** The forge says this PR can merge now. */
export function readyForMerge(derived: DerivedIssueState | undefined): boolean {
  return derived?.state === 'ready';
}

/** Human-readable reason the issue is not moving. */
export function stuckReason(derived: DerivedIssueState | undefined): string {
  if (derived?.attention === 'api-error') return 'Provider API errors';
  if (derived?.state === 'changes-requested') return 'Review requested changes';
  if (derived?.pr?.checks === 'red') return 'Checks are red';
  if (derived?.pr && derived.pr.mergeable === false) return 'Branch conflicts with main';
  return 'Needs attention';
}

const OPERATOR_NEED_PRIORITY: Record<OperatorNeedsYou['kind'], number> = {
  awaiting_input: 0,
  stuck: 1,
  paused: 2,
  blocker: 3,
  pickup_gate: 4,
  ready_for_merge: 5,
  stopped: 6,
};

/** Sort operator signals into the cockpit's single-slot priority ladder. */
export function sortOperatorNeeds(items: readonly OperatorNeedsYou[]): OperatorNeedsYou[] {
  return items.map((item, index) => ({ item, index }))
    .sort((a, b) => OPERATOR_NEED_PRIORITY[a.item.kind] - OPERATOR_NEED_PRIORITY[b.item.kind] || a.index - b.index)
    .map(({ item }) => item);
}

/** The merge door's state as the forge reports it. */
export function deriveShip(derived: DerivedIssueState | undefined): IssueShipModel {
  const status: IssueShipModel['status'] =
    derived?.state === 'merged' ? 'merged' : derived?.state === 'ready' ? 'ready' : 'pending';

  return {
    status,
    ...(derived?.pr ? { prUrl: derived.pr.url, prNumber: derived.pr.number, checks: derived.pr.checks, mergeable: derived.pr.mergeable } : {}),
    ...(status === 'pending' && derived ? { blockerReason: stuckReason(derived) } : {}),
  };
}
