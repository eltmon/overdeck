/** Cloister reactive lifecycle scheduler. */
import { Effect } from 'effect';
import { getAgentState } from '../agents.js';
import type { Role } from '../agents.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { capturePane, sessionExists, killSession } from '../tmux.js';
import {
  decideAutonomousPlanDispatch,
  gatherAutonomousPlanDispatchInput,
} from './autonomous-plan-dispatch.js';
import {
  decideAutonomousWorkDispatch,
  gatherAutonomousWorkDispatchInput,
} from './autonomous-work-dispatch.js';
import { recordDeadEndNeedsYou } from './dead-end-trip.js';
import { isIssueClosed } from './issue-closed.js';
import { shouldSkipDispatchAsMerged } from './merge-verification.js';

/** Return issues orphaned in reviewStatus='reviewing' with no active reviewer. */
export function identifyOrphanedReviewingIssues(
  statuses: Record<string, { reviewStatus: string; history?: Array<{ type: string; status: string }> }>,
  activeReviewIssues: Set<string>,
): string[] {
  const orphaned: string[] = [];
  for (const [issueId, status] of Object.entries(statuses)) {
    if (status.reviewStatus !== 'reviewing') continue;
    const hasPassedReview = status.history?.some(
      (h) => h.type === 'review' && h.status === 'passed',
    );
    if (hasPassedReview) continue;
    if (activeReviewIssues.has(issueId.toUpperCase())) continue;
    orphaned.push(issueId);
  }
  return orphaned;
}

export function parseSpecialistAgentSession(name: string): {
  projectKey: string;
  specialistType: 'review-agent' | 'test-agent' | 'merge-agent';
  issueId?: string;
} | null {
  const issueScoped = name.match(/^specialist-(.+)-([A-Z]+-\d+)-(review-agent|test-agent|merge-agent)$/);
  if (issueScoped) {
    return {
      projectKey: issueScoped[1],
      issueId: issueScoped[2],
      specialistType: issueScoped[3] as 'review-agent' | 'test-agent' | 'merge-agent',
    };
  }

  const legacy = name.match(/^specialist-(.+)-(review-agent|test-agent|merge-agent)$/);
  if (legacy) {
    return {
      projectKey: legacy[1],
      specialistType: legacy[2] as 'review-agent' | 'test-agent' | 'merge-agent',
    };
  }

  return null;
}

export type ReactiveIssueState =
  | 'todo'
  | 'open'
  | 'in_planning'
  | 'in_progress'
  | 'in_review'
  | 'testing'
  | 'shipping'
  | 'closed'
  | 'canceled';

export interface CloisterDomainEventLike {
  type: string;
  payload?: unknown;
}

const ROLE_RUN_STATES: Record<ReactiveIssueState, Role | null> = {
  todo: null,
  open: null,
  in_planning: 'plan',
  in_progress: 'work',
  in_review: 'review',
  testing: 'test',
  shipping: null,
  closed: null,
  canceled: null,
};

/**
 * Map issue lifecycle state to the role that should own that state.
 */
export function stateToRole(state: string): Role | null {
  const normalized = state.toLowerCase().replace(/[ -]/g, '_') as ReactiveIssueState;
  return ROLE_RUN_STATES[normalized] ?? null;
}

function normalizeIssueId(issueId: string): string {
  return issueId.trim().toUpperCase();
}

function roleFromAgentId(agentId: string, issueId: string): Role | null {
  const base = `agent-${issueId.toLowerCase()}`;
  if (agentId === base) return 'work';
  const role = agentId.slice(base.length + 1);
  return ['plan', 'review', 'test'].includes(role) ? role as Role : null;
}

/**
 * Grace window for `starting` states without a tmux session yet. The
 * start-planning route deliberately writes state.json BEFORE the lifecycle
 * transition (PAN-1048) so this guard can see the planner coming — but the
 * tmux session is only created after the transition. Treating any
 * starting-without-session as dead (the original S1 unstick heuristic)
 * re-opened the PAN-1048 race and spawned a duplicate `agent-<issue>-plan`
 * twin on EVERY `pan plan` (PAN-2159, 100% repro). A fresh `starting` state
 * is a startup in progress; only a stale one is a crashed spawn to unstick.
 */
const STARTING_WITHOUT_SESSION_GRACE_MS = 120_000;

function isFreshStarting(state: { startedAt?: string }): boolean {
  const startedAt = Date.parse(state.startedAt ?? '');
  return Number.isFinite(startedAt) && Date.now() - startedAt < STARTING_WITHOUT_SESSION_GRACE_MS;
}

async function activeRoleRunExists(issueId: string, role: Role, workspacePath?: string): Promise<boolean> {
  const issueLower = issueId.toLowerCase();

  // C1: For 'plan', also check the legacy planning-pan-X session format
  // alongside the canonical agent-pan-X-plan format. The start-planning route
  // writes to planning-pan-X while spawnRun uses agent-pan-X-plan.
  if (role === 'plan') {
    const legacyId = `planning-${issueLower}`;
    const legacyState = await Effect.runPromise(getAgentState(legacyId));
    if (legacyState?.role === 'plan' && legacyState.status !== 'stopped' && legacyState.status !== 'error') {
      // S1 (age-aware): only a STALE 'starting' state with no live tmux
      // session is a crashed spawn; a fresh one is mid-startup (PAN-2159).
      if (legacyState.status === 'starting' && !(await Effect.runPromise(sessionExists(legacyId)))) {
        return isFreshStarting(legacyState);
      }
      return true;
    }
  }

  const candidateId = role === 'work'
    ? `agent-${issueLower}`
    : `agent-${issueLower}-${role}`;

  const state = await Effect.runPromise(getAgentState(candidateId));
  if (!state) return false;

  const stateRole = state.role ?? roleFromAgentId(candidateId, issueId);

  // S1 (age-aware): only a STALE 'starting' state with no live tmux session
  // is a crashed spawn; a fresh one is mid-startup (PAN-2159).
  if (stateRole === role && state.status === 'starting' && !(await Effect.runPromise(sessionExists(candidateId)))) {
    return isFreshStarting(state);
  }

  const aliveByStatus = stateRole === role && state.status !== 'stopped' && state.status !== 'error';
  if (!aliveByStatus) return false;

  // Zombie detection: an agent that finished its work but never exited keeps
  // status:'running' forever, which would block every future re-dispatch for
  // this role (the ship/test stall bug). Producer-issued anchors cover every
  // code root in monorepo and polyrepo workspaces. Persisted pre-fix short SHAs
  // intentionally compare stale once, then the next run receives a full anchor.
  if (workspacePath && state.roleRunHead) {
    try {
      const { formatAnchorShort, snapshotWorkspaceHeadsPromise } = await import('../git-utils.js');
      const currentHead = await snapshotWorkspaceHeadsPromise(issueId, workspacePath);
      if (currentHead && currentHead !== state.roleRunHead) {
        console.log(
          `[cloister] ${issueId}: ${role} session ${candidateId} is stale `
          + `(ran against ${formatAnchorShort(state.roleRunHead)}, HEAD is now ${formatAnchorShort(currentHead)}) — not active`,
        );
        return false;
      }
    } catch { /* non-fatal — fall through to the status-only result */ }
  }

  return true;
}

function buildReactiveRolePrompt(issueId: string, state: string, role: Role): string {
  return `${role.toUpperCase()} TASK for ${issueId}:

The issue lifecycle transitioned to ${state}. Run the ${role} role for this issue.

Required steps:
1. Work only in the workspace configured for ${issueId}.
2. Read .pan/continue.json, .pan/spec.vbrief.json, project instructions, and issue context.
3. Follow the boundaries and success criteria in roles/${role}.md exactly.
4. Report the role-specific terminal status when done.`;
}

/**
 * Resolve the workspace path for an issue from agent state, then fall back
 * to the canonical `<projectPath>/workspaces/feature-<issueLower>` layout.
 * Mirrors the resolution used by startup recovery (service.ts:583-609) so
 * the reactive scheduler dispatches review/test wrappers with the same
 * workspace contract those wrappers receive on the manual code path.
 */
async function resolveWorkspaceForIssue(issueId: string): Promise<string | null> {
  const issueLower = issueId.toLowerCase();
  const agentState = await Effect.runPromise(getAgentState(`agent-${issueLower}`));
  if (agentState?.workspace) return agentState.workspace;
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) return null;
  return `${resolved.projectPath}/workspaces/feature-${issueLower}`;
}async function onIssueStateChangePromise(issueId: string, newState: string): Promise<void> {
  const normalizedIssueId = normalizeIssueId(issueId);
  const role = stateToRole(newState);
  if (!role) {
    console.log(`[cloister] ${normalizedIssueId}: no role for issue state '${newState}'`);
    return;
  }

  if (await isIssueClosed(normalizedIssueId)) {
    const message = `${normalizedIssueId}: skipping ${role} dispatch — issue is closed`;
    console.log(`[cloister] ${message}`);
    emitActivityEntrySync({ source: 'cloister', level: 'info', message, issueId: normalizedIssueId });
    return;
  }

  // PAN-1746: a merged issue is terminal — never re-dispatch an advancing role
  // for work that already landed. Boot reconciliation replays issue-state-change
  // events on restart, and a long-merged issue still carrying its lifecycle
  // state (e.g. `verifying-on-main`) would otherwise re-trigger a ship dispatch
  // for a branch that merged weeks ago. Mirror the isIssueClosed gate above:
  // mergeStatus='merged' is the same terminal signal closed-state is.
  const { getReviewStatusSync } = await import('../review-status.js');
  if (getReviewStatusSync(normalizedIssueId)?.mergeStatus === 'merged') {
    const message = `${normalizedIssueId}: skipping ${role} dispatch — merge already landed (merge_status='merged' is terminal)`;
    console.log(`[cloister] ${message}`);
    emitActivityEntrySync({ source: 'cloister', level: 'info', message, issueId: normalizedIssueId });
    return;
  }

  // PAN-2420: GitHub-authoritative guard. Even when merge_status is not yet
  // 'merged' (e.g. a permission failure left it as 'failed'), do not respawn
  // advancing roles against a PR that GitHub already reports merged.
  const mergedGuard = await shouldSkipDispatchAsMerged(normalizedIssueId);
  if (mergedGuard.skip) {
    const message = `${normalizedIssueId}: skipping ${role} dispatch — ${mergedGuard.reason}`;
    console.log(`[cloister] ${message}`);
    emitActivityEntrySync({ source: 'cloister', level: 'info', message, issueId: normalizedIssueId });
    return;
  }

  // Resolve the workspace up front so activeRoleRunExists can probe the
  // workspace HEAD for stale-session (zombie) detection.
  const workspace = await resolveWorkspaceForIssue(normalizedIssueId);

  if (await activeRoleRunExists(normalizedIssueId, role, workspace ?? undefined)) {
    const message = `${normalizedIssueId}: ${role} role already active; skipping lifecycle spawn`;
    console.log(`[cloister] ${message}`);
    emitActivityEntrySync({ source: 'cloister', level: 'info', message, issueId: normalizedIssueId });
    return;
  }

  // activeRoleRunExists returned false. If a tmux session for this role still
  // physically exists, it's a zombie (agent finished work but never exited,
  // and the workspace HEAD has since advanced). Kill it before re-dispatch so
  // the fresh run gets a clean session name instead of colliding with the
  // dead one.
  const issueLower = normalizedIssueId.toLowerCase();
  const roleSessionId = role === 'work' ? `agent-${issueLower}` : `agent-${issueLower}-${role}`;
  if (await Effect.runPromise(sessionExists(roleSessionId))) {
    const message = `${normalizedIssueId}: killing stale ${role} session ${roleSessionId} before re-dispatch`;
    console.log(`[cloister] ${message}`);
    emitActivityEntrySync({ source: 'cloister', level: 'info', message, issueId: normalizedIssueId });
    try {
      await Effect.runPromise(killSession(roleSessionId));
    } catch (err) {
      console.error(`[cloister] failed to kill stale session ${roleSessionId}:`, err instanceof Error ? err.message : String(err));
    }
  }

  try {
    if (role === 'review') {
      if (!workspace) {
        const failure = `${normalizedIssueId}: cannot dispatch review role — no workspace or project resolved`;
        console.error(`[cloister] ${failure}`);
        emitActivityEntrySync({ source: 'cloister', level: 'error', message: failure, issueId: normalizedIssueId });
        return;
      }
      const branch = `feature/${normalizedIssueId.toLowerCase()}`;
      const { spawnReviewRoleForIssue } = await import('./review-agent.js');
      const result = await Effect.runPromise(spawnReviewRoleForIssue({ issueId: normalizedIssueId, workspace, branch }));
      const message = `${normalizedIssueId}: review role dispatched from lifecycle state '${newState}' (${result.message})`;
      console.log(`[cloister] ${message}`);
      emitActivityEntrySync({ source: 'cloister', level: result.success ? 'info' : 'error', message, issueId: normalizedIssueId });
      return;
    }

    if (role === 'test') {
      const branch = `feature/${normalizedIssueId.toLowerCase()}`;
      const { dispatchTestAgentAndNotify } = await import('./test-agent-queue.js');
      await Effect.runPromise(dispatchTestAgentAndNotify(normalizedIssueId, workspace ?? undefined, branch));
      const message = `${normalizedIssueId}: test role dispatched from lifecycle state '${newState}'`;
      console.log(`[cloister] ${message}`);
      emitActivityEntrySync({ source: 'cloister', level: 'info', message, issueId: normalizedIssueId });
      return;
    }

    const { spawnRun } = await import('../agents.js');
    if (role === 'plan') {
      const decision = decideAutonomousPlanDispatch(
        await gatherAutonomousPlanDispatchInput(normalizedIssueId),
      );
      if (!decision.allow) {
        const message = `${normalizedIssueId}: ${decision.reason}`;
        console.log(`[cloister] ${message}`);
        emitActivityEntrySync({ source: 'cloister', level: 'warn', message, issueId: normalizedIssueId });
        await recordDeadEndNeedsYou(
          normalizedIssueId,
          'autonomous-plan-dispatch',
          newState,
          message,
        );
        return;
      }
      const run = await spawnRun(normalizedIssueId, 'plan', {
        prompt: buildReactiveRolePrompt(normalizedIssueId, newState, 'plan'),
        model: decision.model,
        startedBy: 'reactive-lifecycle',
      });
      const message = `${normalizedIssueId}: ${role} role started from lifecycle state '${newState}' as ${run.id}`;
      console.log(`[cloister] ${message}`);
      emitActivityEntrySync({ source: 'cloister', level: 'info', message, issueId: normalizedIssueId });
      return;
    }

    let autoSpawnConsentRequired = false;
    if (role === 'work') {
      const decision = decideAutonomousWorkDispatch(
        await gatherAutonomousWorkDispatchInput(normalizedIssueId),
      );
      if (!decision.allow) {
        const message = `${normalizedIssueId}: ${decision.reason}`;
        console.log(`[cloister] ${message}`);
        emitActivityEntrySync({ source: 'cloister', level: 'warn', message, issueId: normalizedIssueId });
        await recordDeadEndNeedsYou(
          normalizedIssueId,
          'reactive-work-dispatch-pickup-gate',
          newState,
          message,
        );
        return;
      }
      autoSpawnConsentRequired = decision.releaseSource === 'planning-consent';
    }

    const run = await spawnRun(normalizedIssueId, role, {
      prompt: buildReactiveRolePrompt(normalizedIssueId, newState, role),
      startedBy: 'reactive-lifecycle',
      ...(role === 'work' ? { autoSpawnConsentRequired } : {}),
    });
    const message = `${normalizedIssueId}: ${role} role started from lifecycle state '${newState}' as ${run.id}`;
    console.log(`[cloister] ${message}`);
    emitActivityEntrySync({ source: 'cloister', level: 'info', message, issueId: normalizedIssueId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('already running')) {
      const skipMessage = `${normalizedIssueId}: ${role} role already running; skipping lifecycle spawn`;
      console.log(`[cloister] ${skipMessage}`);
      emitActivityEntrySync({ source: 'cloister', level: 'info', message: skipMessage, issueId: normalizedIssueId });
      return;
    }
    console.error(`[cloister] Failed to start ${role} role for ${normalizedIssueId}:`, error);
    emitActivityEntrySync({ source: 'cloister', level: 'error', message: `${normalizedIssueId}: failed to start ${role} role: ${message}`, issueId: normalizedIssueId });
  }
}

function payloadRecord(event: CloisterDomainEventLike): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {};
}

export function issueStateChangeFromDomainEvent(event: CloisterDomainEventLike): { issueId: string; state: string } | null {
  const payload = payloadRecord(event);
  const issueId = typeof payload.issueId === 'string' ? payload.issueId : null;
  if (!issueId) return null;

  switch (event.type) {
    case 'issue.transitioned':
      return typeof payload.state === 'string' ? { issueId, state: payload.state } : null;
    case 'issue.statusChanged':
      return typeof payload.canonicalStatus === 'string' ? { issueId, state: payload.canonicalStatus } : null;
    case 'issue.closed':
      return { issueId, state: 'closed' };
    case 'agent.completed': {
      // PAN-1048 review feedback 003: agent.completed is emitted by every
      // role's lifecycle (work, review, test, ship). Map it to in_review only
      // when the work role completes — letting other roles land here would
      // ricochet back into review the moment a review or test role finished.
      const role = typeof payload.role === 'string' ? payload.role : undefined;
      if (role === undefined || role === 'work') {
        return { issueId, state: 'in_review' };
      }
      return null;
    }
    case 'work.completed':
      return { issueId, state: 'in_review' };
    case 'review.approved':
      return { issueId, state: 'testing' };
    case 'test.passed':
      return { issueId, state: 'shipping' };
    default:
      return null;
  }
}

async function handleCloisterDomainEventPromise(event: CloisterDomainEventLike): Promise<void> {
  if (event.type === 'agent.activity_changed') {
    const payload = payloadRecord(event);
    const agentId = typeof payload['agentId'] === 'string' ? payload['agentId'] : undefined;
    if (agentId && payload['hookName'] === 'PostCompact' && !agentId.startsWith('conv-')) {
      try {
        const { continueCompactedAgentAfterHook } = await import('./compaction-continuation.js');
        const { findLastCompactBoundary } = await import(
          '../../dashboard/server/services/conversation-service.js'
        );
        const { deliverAgentMessage, getAgentStateSync } = await import('../agents.js');
        const continued = await continueCompactedAgentAfterHook({
          agentId,
          capturePane: (target) => Effect.runPromise(capturePane(target, 80)),
          send: (target, message) => deliverAgentMessage(target, message, 'hook:post-compact-continuation'),
          findBoundary: findLastCompactBoundary,
        });
        if (continued) {
          console.log(`[cloister] ${continued}`);
          emitActivityEntrySync({
            source: 'cloister',
            level: 'warn',
            message: `${agentId} stopped after a context compaction — continued from PostCompact`,
            issueId: getAgentStateSync(agentId)?.issueId,
          });
        }
      } catch (error) {
        console.error(`[cloister] PostCompact continuation failed for ${agentId}:`, error);
      }
    }
    return;
  }

  if (event.type === 'linear_mcp_auth.healthy') {
    const { processLinearMcpAuthWake } = await import('../linear-mcp-auth.js');
    await processLinearMcpAuthWake();
    return;
  }

  // PAN-1908: reactive agent liveness — deacon handles agent.stopped and
  // agent.heartbeat_dead events instead of scanning agent directories.
  if (event.type === 'agent.stopped') {
    const payload = event.payload as { agentId?: string } | undefined;
    const agentId = payload?.agentId;
    if (agentId) {
      const { handleAgentStoppedEvent, handleAgentStoppedForOrphanReviewerSessions } = await import('./deacon.js');
      const { handleAgentLifecycleEventForIdleStack } = await import('./idle-stack-reaper.js');
      handleAgentLifecycleEventForIdleStack(agentId);
      const slotMatch = /^agent-(.+)-slot-\d+$/.exec(agentId);
      await Promise.all([
        handleAgentStoppedEvent(agentId),
        handleAgentStoppedForOrphanReviewerSessions(agentId),
        slotMatch
          ? (await import('../agents/messaging.js')).messageAgent(
              `agent-${slotMatch[1]!.toLowerCase()}`,
              `[swarm-event] ${agentId} stopped; run pan swarm status ${slotMatch[1]!.toUpperCase()} --json`,
              'reactive:swarm-event',
            )
          : Promise.resolve(),
      ]);
    }
    return;
  }
  if (event.type === 'agent.started') {
    const agentId = (event.payload as { agentId?: string } | undefined)?.agentId;
    if (agentId) (await import('./idle-stack-reaper.js')).handleAgentLifecycleEventForIdleStack(agentId);
    return;
  }
  if (event.type === 'agent.heartbeat_dead') {
    const payload = event.payload as { agentId?: string } | undefined;
    const agentId = payload?.agentId;
    if (agentId) {
      const { handleAgentHeartbeatDeadEvent } = await import('./deacon.js');
      await handleAgentHeartbeatDeadEvent(agentId, 'event');
    }
    return;
  }

  // PAN-1908: reactive review-status handlers — deacon handles review lifecycle
  // events instead of scanning directories / the review-status DB.
  if (event.type === 'review.coordinator.died') {
    const payload = event.payload as { issueId?: string; sessionName?: string; reason?: string } | undefined;
    const issueId = payload?.issueId;
    if (issueId) {
      const { handleReviewCoordinatorDied } = await import('./deacon.js');
      await handleReviewCoordinatorDied(issueId, payload?.sessionName ?? '', payload?.reason ?? '');
    }
    return;
  }
  if (event.type === 'work.completed') {
    const payload = event.payload as { issueId?: string } | undefined;
    const issueId = payload?.issueId;
    if (issueId) {
      const { handleWorkCompleted } = await import('./deacon.js');
      await handleWorkCompleted(issueId);
    }
    // Fall through to onIssueStateChange for in_review dispatch.
  }

  // PAN-1908: reactive reconcilers — deacon handles issue.statusChanged events
  // for closed issues and proposed specs instead of patrol scans.
  if (event.type === 'issue.statusChanged') {
    const payload = event.payload as { issueId?: string; status?: string; canonicalStatus?: string } | undefined;
    const issueId = payload?.issueId;
    const canonicalStatus = payload?.canonicalStatus?.toLowerCase();
    const status = payload?.status?.toLowerCase();
    if (issueId) {
      if (canonicalStatus === 'closed' || status === 'closed') {
        const { handleIssueStatusChangedClosed } = await import('./closed-issue-reaper.js');
        await handleIssueStatusChangedClosed(issueId);
        return;
      }
      if (canonicalStatus === 'todo' || status === 'planned' || status === 'todo') {
        const { handleOrphanProposedSpec } = await import('./orphan-proposed-reconciler.js');
        await handleOrphanProposedSpec(issueId);
        // Fall through to onIssueStateChange in case it drives role dispatch.
      }
    }
  }

  const change = issueStateChangeFromDomainEvent(event);
  if (!change) return;
  await Effect.runPromise(onIssueStateChange(change.issueId, change.state));
}


// ─── PAN-1249: additive Effect variants ───────────────────────────────────────
// service.ts is the top-level Cloister orchestrator (1817 lines, heavy use of
// closures and direct fs IO). A full Effect rewrite would cascade into half
// the codebase (review-agent, test-agent-queue, agents.ts) so for the
// batch-C migration we expose Effect variants only at the two domain-event
// entry points. The legacy Promise surfaces stay live for existing callers;
// Effect callers should prefer the *Effect variants. The internal
// implementations swallow errors (logging via emitActivityEntry instead),
// so the error channel is `never`.

/**
 * Effect-typed variant of {@link onIssueStateChange}. Never fails — failures
 * surface through `emitActivityEntry` inside the legacy implementation.
 */
export function onIssueStateChange(
  issueId: string,
  newState: string,
): Effect.Effect<void> {
  return Effect.promise(() => onIssueStateChangePromise(issueId, newState));
}

/**
 * Effect-typed variant of {@link handleCloisterDomainEvent}. Never fails.
 */
export function handleCloisterDomainEvent(
  event: CloisterDomainEventLike,
): Effect.Effect<void> {
  return Effect.promise(() => handleCloisterDomainEventPromise(event));
}
