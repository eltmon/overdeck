/**
 * PAN-1920: reconstruct the dashboard cache from sources of truth.
 *
 * Rebuilds the agents table from state.json + tmux, enumerates in-flight
 * issues from GitHub + workspaces, derives each pipeline phase from the
 * tracker and the PR, and produces the AgentSnapshot / AgentRuntimeSnapshot
 * maps the dashboard bootstrap paths need.
 *
 * Reads NO SQLite cache tables: no events, no projection cache. PAN-3917: the
 * review-status half is gone with the rows it rebuilt.
 */

import { Effect } from 'effect';
import type {
  AgentRuntimeSnapshot,
  AgentSnapshot,
} from '@overdeck/contracts';
import { listAgentStatesSync } from '../agents/agent-state.js';
import { listRunningAgents, type AgentState } from '../agents.js';
import { listProjectsSync, type ProjectConfig } from '../projects.js';
import { enumerateInFlightIssuesFromSources } from './enumerate-in-flight.js';
import { derivePipelinePhase, type PipelinePhase } from './derive-phase.js';

export interface ReconstructOptions {
  verbose?: boolean;
}

export interface ReconstructResult {
  issuesEnumerated: number;
  agentsEnumerated: number;
  phaseCounts: Record<PipelinePhase, number>;
  agentRuntimeById: Record<string, AgentRuntimeSnapshot>;
  agentsById: Record<string, AgentSnapshot>;
  phaseByIssueId: Record<string, PipelinePhase>;
}

function toAgentStatus(status: string): AgentSnapshot['status'] {
  if (
    status === 'starting' ||
    status === 'running' ||
    status === 'stopped' ||
    status === 'error'
  ) {
    return status;
  }
  return 'unknown';
}

function toAgentRole(role: string): AgentSnapshot['role'] | undefined {
  if (
    role === 'plan' ||
    role === 'work' ||
    role === 'review' ||
    role === 'test' ||
    role === 'ship' ||
    role === 'flywheel' ||
    role === 'strike'
  ) {
    return role;
  }
  return undefined;
}

function toAgentSnapshot(state: AgentState & { tmuxActive?: boolean }): AgentSnapshot {
  return {
    id: state.id,
    issueId: state.issueId,
    workspace: state.workspace || undefined,
    runtime: state.harness || undefined,
    model: state.model || undefined,
    status: toAgentStatus(state.status),
    startedAt: state.startedAt || undefined,
    lastActivity: state.lastActivity || undefined,
    branch: state.branch || undefined,
    costSoFar: state.costSoFar,
    sessionId: state.sessionId || undefined,
    role: toAgentRole(state.role),
    phase: state.phase || undefined,
    workType: state.workType || undefined,
    roleRunHead: state.roleRunHead || undefined,
    hasLivePane: state.tmuxActive,
    // Deprecated alias of `hasLivePane` (#4105).
    hasLiveTmuxSession: state.tmuxActive,
    stoppedByUser: state.stoppedByUser,
    paused: state.paused,
    pausedReason: state.pausedReason,
    pausedAt: state.pausedAt,
    troubled: state.troubled,
    troubledAt: state.troubledAt,
    consecutiveFailures: state.consecutiveFailures,
    firstFailureInRunAt: state.firstFailureInRunAt,
    lastFailureAt: state.lastFailureAt,
    lastFailureReason: state.lastFailureReason,
    lastFailureNextRetryAt: state.lastFailureNextRetryAt,
  };
}

function toAgentRuntimeSnapshot(state: AgentState): AgentRuntimeSnapshot {
  const now = new Date().toISOString();
  const activity: AgentRuntimeSnapshot['activity'] =
    state.status === 'running' || state.status === 'starting'
      ? 'working'
      : state.status === 'stopped'
        ? 'stopped'
        : 'idle';

  return {
    id: state.id,
    activity,
    lastActivity: state.lastActivity || now,
    model: state.model || undefined,
    currentIssue: state.issueId,
    updatedAtSequence: 0,
  };
}

function normalizeIssueId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

function isIssueClosed(issue: {
  completedAt?: unknown;
  state?: unknown;
  canonicalStatus?: unknown;
  status?: unknown;
}): boolean {
  const state = String(issue.state ?? '').toLowerCase();
  const status = String(issue.status ?? '').toLowerCase();
  const canonicalStatus = String(issue.canonicalStatus ?? '').toLowerCase();
  if (issue.completedAt) return true;
  if (
    state === 'closed' ||
    state === 'done' ||
    state === 'completed'
  ) {
    return true;
  }
  if (
    status === 'done' ||
    status === 'closed' ||
    status === 'completed' ||
    status === 'cancelled' ||
    status === 'canceled'
  ) {
    return true;
  }
  if (
    canonicalStatus === 'done' ||
    canonicalStatus === 'closed' ||
    canonicalStatus === 'completed' ||
    canonicalStatus === 'cancelled' ||
    canonicalStatus === 'canceled'
  ) {
    return true;
  }
  return false;
}

async function loadInFlightIssueIds(
  projects: ProjectConfig[],
): Promise<Set<string>> {
  return enumerateInFlightIssuesFromSources(projects);
}

async function fetchPrState(
  issueId: string,
): Promise<{ hasPr: boolean; reviewDecision: string | null }> {
  const { fetchIssuePullRequest } = await import(
    '../overdeck/pull-requests.js'
  );
  const result = await fetchIssuePullRequest(issueId);
  if (!result.pr) return { hasPr: false, reviewDecision: null };
  return { hasPr: true, reviewDecision: result.pr.reviewDecision };
}

/**
 * Reconstruct the dashboard cache from durable sources only.
 *
 * The `_db` parameter is accepted for backward compatibility but is no longer
 * used — the cache now reads from the overdeck layer directly.
 */
export async function reconstructCache(
  _db?: unknown,
  opts?: ReconstructOptions,
): Promise<ReconstructResult> {
  const verbose = opts?.verbose ?? false;

  // 1. Build AgentSnapshot / AgentRuntimeSnapshot maps from the agent state files.
  //    PAN-3917: there is no agents table to rebuild first — every reader below
  //    reads ~/.overdeck/agents/<id>/state.json, which is the only copy.
  let runningAgents: (AgentState & { tmuxActive: boolean })[] = [];
  try {
    runningAgents = await Effect.runPromise(listRunningAgents());
  } catch (err) {
    console.warn(
      '[reconstruct-cache] listRunningAgents failed, falling back to the state files:',
      (err as Error).message,
    );
    runningAgents = listAgentStatesSync().map((state) => ({ ...state, tmuxActive: false }));
  }

  const agentsById: Record<string, AgentSnapshot> = {};
  const agentRuntimeById: Record<string, AgentRuntimeSnapshot> = {};
  for (const a of runningAgents) {
    agentsById[a.id] = toAgentSnapshot(a);
    agentRuntimeById[a.id] = toAgentRuntimeSnapshot(a);
  }

  // 2. Enumerate in-flight issues from GitHub + workspaces.
  const projects = listProjectsSync().map(({ config }) => config);
  const inFlight = await loadInFlightIssueIds(projects);

  // 3. Derive phases from the tracker and the PR.
  const phaseCounts: Record<PipelinePhase, number> = {
    work: 0,
    review: 0,
    merge: 0,
    done: 0,
  };
  const phaseByIssueId: Record<string, PipelinePhase> = {};

  for (const issueId of inFlight) {
    const { hasPr, reviewDecision } = await fetchPrState(issueId);
    const phase = derivePipelinePhase({ issueClosed: false, hasPr, reviewDecision });
    phaseCounts[phase]++;
    phaseByIssueId[issueId] = phase;

    if (verbose) {
      console.log(`[reconstruct-cache] ${issueId} → ${phase}`);
    }
  }

  return {
    issuesEnumerated: inFlight.size,
    agentsEnumerated: runningAgents.length,
    phaseCounts,
    agentRuntimeById,
    agentsById,
    phaseByIssueId,
  };
}

export function reconstructCacheAuto(opts?: ReconstructOptions): Promise<ReconstructResult> {
  return reconstructCache(undefined, opts);
}
