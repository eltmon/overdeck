/**
 * PAN-5623: the pure candidate rules for reclaiming a parked issue's workspace
 * stack while the quality-gate admission queue is starved (FR-2).
 *
 * No I/O here: the reclaim service (`src/dashboard/server/services/
 * stack-reclaim-service.ts`) does the reads and passes the facts in. The
 * rules are deny-by-default: anything that cannot be shown to be safe is not
 * a candidate.
 */
import type { BackendPane } from '@overdeck/contracts';

import type { QualityGateQueueSnapshot } from '../cloister/quality-gate-admission.js';
import { RECLAIMABLE_STACK_SERVICES, type ComposeContainer } from './stack-reclaim-docker.js';
import { hasIssueToken } from './stack-health.js';

/** `unknown`: the runtime mirror has no snapshot; `boundary`: between turns; `in-turn`: mid-turn. */
export type TurnState = 'boundary' | 'in-turn' | 'unknown';

export type PaneReclaimRefusal =
  | 'pane-not-work' | 'pane-no-agent-id' | 'pane-working' | 'pane-not-idle' | 'pane-in-turn' | 'pane-unknown';

/** True when `child` equals `parent` or lies inside it. */
export function isInsidePath(child: string, parent: string): boolean {
  const base = parent.replace(/\/+$/, '');
  return child === base || child.startsWith(`${base}/`);
}

/** The live panes that belong to the issue: by issue token, by agent-id token, or by cwd inside the workspace. */
export function issuePanes(panes: readonly BackendPane[], issueId: string, workspacePath: string): BackendPane[] {
  const id = issueId.toUpperCase();
  return panes.filter((pane) =>
    pane.issue?.toUpperCase() === id
    || (pane.agentId !== undefined && hasIssueToken(pane.agentId, issueId))
    || (pane.workspace !== undefined && isInsidePath(pane.workspace, workspacePath)));
}

/**
 * FR-2 rule 7. `review` panes are ignored (review reads only the committed
 * diff). Every other pane must be an idle `work` pane at a turn boundary. The
 * backend state must be known to be at rest: `idle` (tmux and Herdr) or
 * `done` (Herdr, a finished harness at its prompt); `unknown` and `blocked`
 * (an approval prompt) refuse.
 */
export function panesAllowReclaim(
  panes: readonly BackendPane[],
  turnState: (agentId: string) => TurnState,
): { ok: true } | { ok: false; reason: PaneReclaimRefusal } {
  for (const pane of panes) {
    if (pane.role === 'review') continue;
    if (pane.role !== 'work') return { ok: false, reason: 'pane-not-work' };
    if (!pane.agentId) return { ok: false, reason: 'pane-no-agent-id' };
    if (pane.state === 'working') return { ok: false, reason: 'pane-working' };
    if (pane.state !== 'idle' && pane.state !== 'done') return { ok: false, reason: 'pane-not-idle' };
    const turn = turnState(pane.agentId);
    if (turn === 'in-turn') return { ok: false, reason: 'pane-in-turn' };
    if (turn === 'unknown') return { ok: false, reason: 'pane-unknown' };
  }
  return { ok: true };
}

/** FR-5 turn trigger: any non-`review` pane is working or mid-turn. */
export function panesNeedStack(panes: readonly BackendPane[], turnState: (agentId: string) => TurnState): boolean {
  return panes.some((pane) =>
    pane.role !== 'review'
    && (pane.state === 'working' || (pane.agentId !== undefined && turnState(pane.agentId) === 'in-turn')));
}

/** FR-2 rule 4: a gate-queue owner or waiter belongs to the issue, by id or by workspace path. */
export function issueInGateQueue(snapshot: QualityGateQueueSnapshot, issueId: string, workspacePath: string): boolean {
  const id = issueId.toUpperCase();
  return [...snapshot.owners, ...snapshot.waiters].some((entry) =>
    entry.issueId?.toUpperCase() === id || isInsidePath(entry.workspacePath, workspacePath));
}

/** The running containers of `composeProject` whose service is reclaimable. */
export function reclaimableContainers(containers: readonly ComposeContainer[], composeProject: string): ComposeContainer[] {
  return containers.filter((container) =>
    container.state === 'running'
    && container.composeProject === composeProject
    && RECLAIMABLE_STACK_SERVICES.has(container.composeService));
}

export interface ReclaimCandidate {
  issueId: string;
  workspacePath: string;
  composeProject: string;
  containers: ComposeContainer[];
  memoryBytes: number;
}

/** Sums each candidate's container memory and orders largest first; ties by issue id ascending. */
export function rankCandidates(
  candidates: readonly Omit<ReclaimCandidate, 'memoryBytes'>[],
  memory: ReadonlyMap<string, number>,
): ReclaimCandidate[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      memoryBytes: candidate.containers.reduce((sum, container) => sum + (memory.get(container.name) ?? 0), 0),
    }))
    .sort((a, b) => b.memoryBytes - a.memoryBytes || a.issueId.localeCompare(b.issueId));
}
