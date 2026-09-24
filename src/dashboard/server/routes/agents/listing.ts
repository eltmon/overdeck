import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import type { DerivedIssueState } from '@overdeck/contracts';

import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import {
  getAgentState,
  getAgentRuntimeState,
  listAgentStates,
  type AgentState,
} from '../../../../lib/agents.js';
import { getBackendPanes } from '../../services/backend-inventory.js';
import { computeAgentEnrichment, isBlockedOnPendingInput } from '../../../../lib/agent-enrichment.js';
import { normalizeAwaitingInputPrompt } from '../../../../lib/agent-input-detection.js';
import { getWorkAgentLifecycleState } from '../../../../lib/work-agent-lifecycle.js';
import { resolveAgentGitInfo } from '../../services/git-info.js';
import { loadIssueStatesForIssues } from '../../services/derived-issue-state.js';
import {
  AGENTS_CACHE_TTL_MS,
  agentsCache,
  buildStoppedAgentLifecycle,
  getGitStatusAsync,
  getWorkspaceLocation,
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

/** The issue a registered agent works on: its stamped id, else the one its name carries. */
function issueIdOf(state: AgentState): string {
  const name = state.id;
  const isPlanning = name.startsWith('planning-');
  const isStrike = name.startsWith('strike-');
  return state.issueId?.toUpperCase() ||
    (isPlanning ? name.replace('planning-', '') : isStrike ? name.replace('strike-', '') : name.replace('agent-', '')).toUpperCase();
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

        // PAN-3917 (FR-12): the terminal backend is the inventory. `listAgentStates`
        // still supplies the PERMANENT facts stamped at spawn (issue, workspace,
        // role, harness, model, branch); every liveness and state answer below
        // comes from the pane.
        const panes = yield* Effect.promise(() => getBackendPanes());
        const paneById = new Map(panes.map((pane) => [pane.terminalId ?? pane.id, pane]));
        const specialistIssues = new Set(
          panes
            .filter((pane) => pane.state !== 'exited' && (pane.role === 'review' || pane.role === 'test' || pane.role === 'uat'))
            .map((pane) => pane.issue)
            .filter((issue): issue is string => Boolean(issue)),
        );

        const registeredStates = listAgentStates()
          .filter((state) => state.id.startsWith('agent-') || state.id.startsWith('planning-') || state.id.startsWith('strike-'));

        // PAN-3925: every stopped agent's issue derives in one batch per
        // project, started by the first stopped agent that needs it, instead
        // of a single-issue derivation (three spawns) per agent.
        let derivedBatch: Promise<Map<string, DerivedIssueState>> | null = null;
        const derivedFor = (issueId: string): Promise<DerivedIssueState | null> => {
          derivedBatch ??= loadIssueStatesForIssues(
            registeredStates
              .filter((state) => { const pane = paneById.get(state.id); return pane === undefined || pane.state === 'exited'; })
              .map(issueIdOf),
          ).catch(() => new Map<string, DerivedIssueState>());
          return derivedBatch.then((states) => states.get(issueId) ?? null);
        };

        const allAgents = (yield* Effect.promise(() => Promise.all(
          registeredStates.map(async (state) => {
            const name = state.id;
            const isPlanning = name.startsWith('planning-');
            const isStrike = name.startsWith('strike-');
            const issueId = issueIdOf(state);
            const pane = paneById.get(name);
            const live = pane !== undefined && pane.state !== 'exited';
            const remoteState = await readRemoteAgentState(name);
            const isRemote = remoteState.location === 'remote';
            const runtimeData = await Effect.runPromise(getAgentRuntimeState(name));
            const startedAt = state.startedAt
              || (pane?.stateSince ? new Date(pane.stateSince).toISOString() : new Date().toISOString());
            const healthFile = join(homedir(), '.overdeck', 'agents', name, 'health.json');
            let health: any = { killCount: 0 };
            if (existsSync(healthFile)) {
              try { health = { ...health, ...JSON.parse(await readFile(healthFile, 'utf-8')) }; } catch {}
            }
            const role = pane?.role ?? state.role ?? (isStrike ? 'strike' : isPlanning ? 'plan' : 'work');
            const runtime = (pane?.harness && pane.harness !== 'unknown' ? pane.harness : state.harness) ?? 'claude-code';
            const model = (pane?.model && pane.model !== 'unknown' ? pane.model : state.model)
              || (isPlanning ? 'opus' : 'sonnet');

            // No live pane and not remote: the agent is stopped. There is no
            // persisted `starting`/`error` status any more — a pane either
            // exists in the backend or it does not.
            if (!live && !isRemote) {
              const stoppedTimestamp = pane?.stateSince
                ? new Date(pane.stateSince).toISOString()
                : runtimeData?.lastActivity ?? state.lastActivity;
              const stoppedAt = stoppedTimestamp ? new Date(stoppedTimestamp) : null;
              // Keep a recently-stopped agent visible while its PR is still in
              // play: that is the forge's answer, not a stored status row.
              const derived = await derivedFor(issueId);
              const keepStoppedAgentVisible = derived !== null
                && derived.state !== 'merged'
                && derived.state !== 'closed'
                && derived.pr !== undefined;
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
                runtime,
                model,
                status: 'stopped' as const,
                paneState: pane?.state ?? 'exited',
                startedAt,
                killCount: health.killCount || 0,
                workspace: pane?.workspace ?? state.workspace ?? null,
                workspaceLocation: 'local' as const,
                // A stopped agent never shells `git` against its workspace (no
                // process cost for a row nobody is actively watching), so this
                // can only report the persisted branch, not live uncommitted/
                // commit detail.
                git: state.branch ? { branch: state.branch, uncommittedFiles: 0, latestCommit: '' } : null,
                type: 'agent',
                role,
                hasLiveTmuxSession: false,
                hasPendingQuestion: needsInput,
                pendingQuestionCount: 0,
                pendingQuestionPrompt,
                pendingQuestionReason,
                resolution: runtimeData?.resolution || 'working',
                resolutionCount: runtimeData?.resolutionCount || 0,
                hasSession: lifecycle.canResumeSession,
                lifecycle,
              };
            }

            const hasActiveSpecialist = specialistIssues.has(issueId);
            const enrichment = await computeAgentEnrichment(name, startedAt, hasActiveSpecialist);
            const workspaceLocation = isRemote ? 'remote' : await getWorkspaceLocation(issueId);
            const workspace = isRemote && remoteState.vmName
              ? `/workspace (${String(remoteState.vmName)})`
              : pane?.workspace ?? state.workspace ?? null;
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
              runtime,
              model,
              // A pane the backend reports `blocked` is waiting on the operator,
              // which is the same thing the enrichment calls a pending input.
              status: pane?.state === 'blocked' ? 'warning' as const : liveAgentHealthStatus(enrichment),
              paneState: pane?.state ?? 'unknown',
              startedAt,
              killCount: health.killCount || 0,
              workspace,
              workspaceLocation,
              git: gitStatus,
              type: 'agent',
              role,
              hasLiveTmuxSession: true,
              hasPendingQuestion: enrichment.hasPendingQuestion || pane?.state === 'blocked',
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
              resolution: blockedOnPendingInput || pane?.state === 'blocked'
                ? 'needs_input'
                : (runtimeData?.resolution || enrichment.resolution || 'working'),
              resolutionCount: runtimeData?.resolutionCount || enrichment.resolutionCount || 0,
              contextPercent,
              initialContextPercent,
              ...(isRemote ? { remote: true, vmName: remoteState.vmName } : {}),
            };
          }),
        ))).filter(Boolean);
        agentsCache.data = allAgents;
        agentsCache.timestamp = now;
        return jsonResponse(allAgents);
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

    const agentState = getAgentState(id);
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
//
// PAN-3917: the answer is the terminal backend's, whichever adapter is live.
// The path keeps its name so existing callers do not change.

export const getAgentTmuxAliveRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/tmux-alive',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const agentId = params['id'] ?? '';
    const panes = yield* Effect.promise(() => getBackendPanes());
    const pane = panes.find((candidate) => (candidate.terminalId ?? candidate.id) === agentId);
    return jsonResponse({ alive: pane !== undefined && pane.state !== 'exited' });
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
    const lifecycle = yield* Effect.promise(() => getWorkAgentLifecycleState(id));
    return jsonResponse({
      hasSession: lifecycle.canResumeSession,
      lifecycle,
    });
  })),
);
