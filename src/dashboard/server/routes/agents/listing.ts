import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import {
  getAgentState,
  getAgentRuntimeState,
  listAgentStates,
  type AgentState,
} from '../../../../lib/agents.js';
import { getReviewStatusSync } from '../../../../lib/review-status.js';
import { computeAgentEnrichment, isBlockedOnPendingInput } from '../../../../lib/agent-enrichment.js';
import { normalizeAwaitingInputPrompt } from '../../../../lib/agent-input-detection.js';
import { getWorkAgentLifecycleState } from '../../../../lib/work-agent-lifecycle.js';
import { resolveAgentGitInfo } from '../../services/git-info.js';
import { listSessions, sessionExists } from '../../../../lib/tmux.js';
import {
  AGENTS_CACHE_TTL_MS,
  agentsCache,
  buildAgentGateFailureSnapshot,
  buildStoppedAgentLifecycle,
  filterClosedIssueAgents,
  getGitStatusAsync,
  getIssueDataService,
  getWorkspaceLocation,
  hasActiveAgentGateOrRetry,
  readRemoteAgentState,
} from './shared.js';

/**
 * PAN-3070 — the health status a live agent row reports.
 *
 * A live tmux session used to mean `healthy` unconditionally, so an agent frozen
 * for hours on an unanswered tool-permission prompt was reported
 * `status: healthy` / `resolution: working` while the Decisions surface
 * simultaneously showed it as needing the operator. Two surfaces answering "is
 * this agent stuck?" from different evidence, and this one stale.
 *
 * `warning` is the value `src/lib/health.ts` already reports for an agent
 * waiting on a human, and it stays inside the fleet-view status set, so a
 * blocked agent is flagged without disappearing from any existing list.
 */
export function liveAgentHealthStatus(enrichment: {
  hasPendingQuestion?: boolean;
  pendingQuestionReason?: string;
}): 'healthy' | 'warning' {
  return isBlockedOnPendingInput(enrichment) ? 'warning' : 'healthy';
}

// ─── Route: GET /api/agents ───────────────────────────────────────────────────

export const getAgentsRoute = HttpRouter.add(
  'GET',
  '/api/agents',
  httpHandler(Effect.gen(function* () {
        const now = Date.now();

        if (agentsCache.data && (now - agentsCache.timestamp) < AGENTS_CACHE_TTL_MS) {
          return jsonResponse(agentsCache.data);
        }

        const sessions = yield* listSessions();
        const sessionByName = new Map(sessions.map((session) => [session.name, session]));
        const registeredStates = listAgentStates()
          .filter((state) => state.id.startsWith('agent-') || state.id.startsWith('planning-') || state.id.startsWith('strike-'));

        const allAgents = (yield* Effect.promise(() => Promise.all(
          registeredStates.map(async (state) => {
            const name = state.id;
            const isPlanning = name.startsWith('planning-');
            const isStrike = name.startsWith('strike-');
            const issueId = state.issueId?.toUpperCase() ||
              (isPlanning ? name.replace('planning-', '') : isStrike ? name.replace('strike-', '') : name.replace('agent-', '')).toUpperCase();
            const session = sessionByName.get(name);
            const remoteState = await readRemoteAgentState(name);
            const isRemote = remoteState.location === 'remote';
            const runtimeData = await Effect.runPromise(getAgentRuntimeState(name));
            const startedAt = state.startedAt || (session ? new Date(session.created).toISOString() : new Date().toISOString());
            const healthFile = join(homedir(), '.overdeck', 'agents', name, 'health.json');
            let health: any = { killCount: 0 };
            if (existsSync(healthFile)) {
              try { health = { ...health, ...JSON.parse(await readFile(healthFile, 'utf-8')) }; } catch {}
            }

            if (state.status === 'stopped') {
              const stoppedTimestamp = state.stoppedAt || runtimeData?.lastActivity || state.lastActivity;
              const stoppedAt = stoppedTimestamp ? new Date(stoppedTimestamp) : null;
              const reviewStatus = getReviewStatusSync(issueId);
              const keepStoppedAgentVisible =
                hasActiveAgentGateOrRetry(state, now) ||
                (
                  !!reviewStatus &&
                  reviewStatus.mergeStatus !== 'merged' &&
                  (
                    !!reviewStatus.prUrl ||
                    reviewStatus.readyForMerge === true ||
                    reviewStatus.reviewStatus !== 'pending' ||
                    reviewStatus.testStatus !== 'pending' ||
                    reviewStatus.mergeStatus === 'failed'
                  )
                );
              if (stoppedAt && (now - stoppedAt.getTime()) > 60 * 60 * 1000 && !keepStoppedAgentVisible) return null;
              const lifecycle = buildStoppedAgentLifecycle(name, state, runtimeData ?? {});
              const needsInput = runtimeData?.resolution === 'needs_input';
              const pendingQuestionPrompt = needsInput
                ? normalizeAwaitingInputPrompt(
                    runtimeData?.waitingNotification ||
                      'Agent stopped because it needs human input or hit a blocker',
                  )
                : undefined;
              const pendingQuestionReason = needsInput
                ? runtimeData?.waitingReason || 'other'
                : undefined;
              return {
                id: name,
                issueId,
                runtime: state.harness ?? 'claude-code',
                model: state.model || (isPlanning ? 'opus' : 'sonnet'),
                status: 'stopped' as const,
                startedAt,
                ...buildAgentGateFailureSnapshot(state),
                killCount: health.killCount || 0,
                workspace: state.workspace || null,
                workspaceLocation: isRemote ? 'remote' : 'local',
                // A stopped agent never shells `git` against its workspace (no
                // process cost for a row nobody is actively watching), so this
                // can only report the persisted branch, not live uncommitted/
                // commit detail — better than the unconditional null every
                // stopped agent used to report regardless of what it stored.
                git: state.branch ? { branch: state.branch, uncommittedFiles: 0, latestCommit: '' } : null,
                type: 'agent',
                role: state.role ?? (isStrike ? 'strike' : isPlanning ? 'plan' : 'work'),
                hasPendingQuestion: needsInput,
                pendingQuestionCount: 0,
                pendingQuestionPrompt,
                pendingQuestionReason,
                resolution: runtimeData?.resolution || 'working',
                resolutionCount: runtimeData?.resolutionCount || 0,
                hasSession: lifecycle.canResumeSession,
                lifecycle,
                ...(isRemote ? { remote: true, vmName: remoteState.vmName } : {}),
              };
            }

            if (state.status === 'starting') {
              return {
                id: name,
                issueId,
                runtime: state.harness ?? 'claude-code',
                model: state.model || (isPlanning ? 'opus' : 'sonnet'),
                status: 'starting' as const,
                startedAt,
                ...buildAgentGateFailureSnapshot(state),
                killCount: health.killCount || 0,
                workspace: state.workspace || null,
                workspaceLocation: isRemote ? 'remote' : 'local',
                git: null,
                type: 'agent',
                role: state.role ?? (isStrike ? 'strike' : isPlanning ? 'plan' : 'work'),
                hasPendingQuestion: false,
                pendingQuestionCount: 0,
                message: (state as { message?: string }).message || 'Starting...',
                ...(isRemote ? { remote: true, vmName: remoteState.vmName } : {}),
              };
            }

            if (state.status === 'error') {
              return {
                id: name,
                issueId,
                runtime: state.harness ?? 'claude-code',
                model: state.model || (isPlanning ? 'opus' : 'sonnet'),
                status: 'error' as const,
                startedAt,
                ...buildAgentGateFailureSnapshot(state),
                killCount: health.killCount || 0,
                workspace: state.workspace || null,
                workspaceLocation: isRemote ? 'remote' : 'local',
                git: null,
                type: 'agent',
                role: state.role ?? (isStrike ? 'strike' : isPlanning ? 'plan' : 'work'),
                hasPendingQuestion: false,
                pendingQuestionCount: 0,
                error: state.lastFailureReason || 'Unknown error',
                ...(isRemote ? { remote: true, vmName: remoteState.vmName } : {}),
              };
            }

            if (!session && !isRemote) {
              return {
                id: name,
                issueId,
                runtime: state.harness ?? 'claude-code',
                model: state.model || (isPlanning ? 'opus' : 'sonnet'),
                status: 'unknown' as const,
                startedAt,
                lastActivity: runtimeData?.lastActivity || state.lastActivity,
                ...buildAgentGateFailureSnapshot(state),
                killCount: health.killCount || 0,
                workspace: state.workspace || null,
                workspaceLocation: 'local' as const,
                git: null,
                type: 'agent',
                role: state.role ?? (isStrike ? 'strike' : isPlanning ? 'plan' : 'work'),
                hasLiveTmuxSession: false,
                hasPendingQuestion: false,
                pendingQuestionCount: 0,
                lastFailureReason: state.lastFailureReason || 'No live tmux session found for registered agent',
                resolution: runtimeData?.resolution || 'working',
                resolutionCount: runtimeData?.resolutionCount || 0,
              };
            }

            const issueReviewStatus = getReviewStatusSync(issueId);
            const hasActiveSpecialist = issueReviewStatus?.reviewStatus === 'reviewing'
              || issueReviewStatus?.testStatus === 'testing'
              || issueReviewStatus?.mergeStatus === 'merging';
            const enrichment = await Effect.runPromise(computeAgentEnrichment(name, startedAt, hasActiveSpecialist));
            const workspaceLocation = isRemote ? 'remote' : await getWorkspaceLocation(issueId);
            const workspace = isRemote && remoteState.vmName
              ? `/workspace (${String(remoteState.vmName)})`
              : state.workspace || null;
            const gitStatus = workspace && !isRemote ? await getGitStatusAsync(issueId, workspace) : null;

            let contextPercent: number | null = null;
            let initialContextPercent: number | null = null;
            const agentCtxDir = join(homedir(), '.overdeck', 'agents', name);
            try {
              const ctxFile = join(agentCtxDir, 'context-pct');
              contextPercent = parseInt((await readFile(ctxFile, 'utf-8').catch(() => '')).trim(), 10) || null;
              const initCtxFile = join(agentCtxDir, 'initial-context-pct');
              initialContextPercent = parseInt((await readFile(initCtxFile, 'utf-8').catch(() => '')).trim(), 10) || null;
            } catch {}

            const blockedOnPendingInput = isBlockedOnPendingInput(enrichment);

            return {
              id: name,
              issueId,
              runtime: state.harness ?? 'claude-code',
              model: state.model || (isPlanning ? 'opus' : 'sonnet'),
              status: liveAgentHealthStatus(enrichment),
              startedAt,
              ...buildAgentGateFailureSnapshot(state),
              killCount: health.killCount || 0,
              workspace,
              workspaceLocation,
              git: gitStatus,
              type: 'agent',
              role: state.role ?? (isStrike ? 'strike' : isPlanning ? 'plan' : 'work'),
              hasLiveTmuxSession: true,
              hasPendingQuestion: enrichment.hasPendingQuestion,
              pendingQuestionCount: enrichment.pendingQuestionCount,
              pendingQuestionPrompt: enrichment.pendingQuestionPrompt,
              pendingQuestionReason: enrichment.pendingQuestionReason,
              pendingInputCount: enrichment.pendingInputCount,
              pendingInputKinds: enrichment.pendingInputKinds,
              pendingAskUserQuestion: enrichment.pendingAskUserQuestion,
              // PAN-3070 — the detection wins over the runtime resolution here
              // too: `runtimeData.resolution` is written by the stop hook and
              // stays at whatever it last was, so a frozen agent reported
              // `working` even once the enrichment knew better.
              resolution: blockedOnPendingInput
                ? 'needs_input'
                : (runtimeData?.resolution || enrichment.resolution || 'working'),
              resolutionCount: runtimeData?.resolutionCount || enrichment.resolutionCount || 0,
              contextPercent,
              initialContextPercent,
              ...(isRemote ? { remote: true, vmName: remoteState.vmName } : {}),
            };
          }),
        ))).filter(Boolean);
        const visibleAgents = filterClosedIssueAgents(allAgents, getIssueDataService().getIssues());
        agentsCache.data = visibleAgents;
        agentsCache.timestamp = now;
        return jsonResponse(visibleAgents);
  })),
);

// ─── Route: GET /api/agents/:id/git-info ─────────────────────────────────────
//
// Branch + worktree status for the agent's workspace (PAN-1523). Used by
// AgentOutputPanel to render the Local/Worktree/Drifted chip in the panel
// header. Work agents don't have a conversation row to enrich, so the panel
// queries this dedicated endpoint instead.

/**
 * True when the agent has a concrete workspace + issue we can evaluate git
 * state for. When false, the git-info route must NOT claim the worktree is
 * missing — an unresolvable session id (e.g. a legacy / JSONL-only "Planning
 * state" node) or an agent that never got a workspace is "unknown", not
 * "workspace gone from disk". Conflating the two made such nodes falsely render
 * "Worktree missing" in the SessionPanel chip (PAN-1718).
 */
export function agentHasResolvableWorkspace(
  agentState: AgentState | null,
): agentState is AgentState {
  return Boolean(agentState?.workspace && agentState.issueId);
}

/**
 * Benign git-info response for a session we cannot resolve to a workspace-bound
 * agent. workspaceMissing is false (not true): we have no path to stat, so we
 * cannot assert the worktree is gone. The frontend chip hides on this shape
 * (showChip = actualBranch || workspaceMissing). The genuine on-disk
 * "workspace missing" case is detected separately by resolveAgentGitInfo, which
 * stats the real path. See PAN-1718.
 */
export const UNRESOLVABLE_AGENT_GIT_INFO = {
  actualBranch: null,
  branchDrifted: false,
  workspaceMissing: false,
  expectedBranch: null,
} as const;

export const getAgentGitInfoRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/git-info',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!id.trim()) {
      return jsonResponse({ error: 'missing agent id' }, { status: 400 });
    }

    const agentState = yield* getAgentState(id);
    if (!agentHasResolvableWorkspace(agentState)) {
      // PAN-1718: unknown session id / no workspace bound → "unknown", not
      // "worktree missing". Return the benign shape so the chip hides instead of
      // flashing a false alarm. Real on-disk absence is caught by
      // resolveAgentGitInfo below.
      return jsonResponse(UNRESOLVABLE_AGENT_GIT_INFO);
    }

    const expectedBranch = `feature/${agentState.issueId.toLowerCase()}`;
    const info = yield* Effect.promise(() =>
      resolveAgentGitInfo(agentState.workspace as string, expectedBranch),
    );
    return jsonResponse({
      ...info,
      expectedBranch,
      workspacePath: agentState.workspace,
    });
  })),
);

// ─── Route: GET /api/agents/:id/tmux-alive ──────────────────────────────────

export const getAgentTmuxAliveRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/tmux-alive',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const agentId = params['id'] ?? '';
    const alive = yield* sessionExists(agentId);
    return jsonResponse({ alive });
  }),
);

// ─── Route: GET /api/agents/:id/has-session ─────────────────────────────────
// Returns whether a stopped agent has a resumable Claude session.

export const getAgentHasSessionRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/has-session',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const lifecycle = yield* getWorkAgentLifecycleState(id);
    return jsonResponse({
      hasSession: lifecycle.canResumeSession,
      lifecycle,
    });
  })),
);
