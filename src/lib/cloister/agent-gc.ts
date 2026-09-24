import { join } from 'node:path';

import { Effect } from 'effect';

import { listAgentStatesSync } from '../agents/agent-state.js';
import { getOverdeckHome } from '../paths.js';
import { emitActivityEntry } from '../activity-logger.js';
import {
  hasRetainedTranscriptsMarker,
  listAgentStateFilesForRemoval,
  markRetainedTranscripts,
  removeAgentStateDir,
  type RemoveAgentStateDirResult,
} from '../agents/state-dir-removal.js';
import { readLiveTrackerIssueState, type LiveTrackerIssueState } from './issue-closed.js';
import { sessionExists } from '../tmux.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';
import { resolveProjectReposForIssue } from '../project-repos.js';
import { listOpenPullRequestsSnapshot } from '../pipeline-membership-gather.js';
import { listOpenGitLabMergeRequests } from '../gitlab-merge-requests.js';

export interface AgentGcResult { removed: string[]; preserved: string[] }
export interface AgentGcRow {
  id: string;
  issueId: string;
  status: string;
  workspace?: string | null;
  phase?: string | null;
  role?: string | null;
  branch?: string | null;
}

/**
 * Why the GC decided an agent was terminal (PAN-3917).
 *
 * This used to be `AgentGcTerminalityEvidence` from the durable agent plane
 * on the state branch: the GC wrote a tombstone there and pushed it before it
 * was allowed to delete local agent state. The state branch is gone, so the
 * evidence has no durable home and needs none — it is the reason line on the
 * prune event, which is what an operator reads afterwards either way.
 */
export interface AgentGcTerminalityEvidence {
  closedOutFlag: boolean;
  trackerState: string;
  liveTmux: boolean | null;
  openChangeRequest: boolean | null;
  inFlightReviewOrTest: boolean | null;
}

/** What the GC reports when it prunes an agent's local state. */
export interface AgentGcPruneEntry {
  at: string;
  event: 'tombstoned';
  predicate?: AgentGcTerminalityEvidence;
  filesRemoved?: string[];
}

export interface AgentGcTerminalityDeps {
  hasClosedOutFlag: (agent: AgentGcRow) => boolean;
  readTrackerState: (issueId: string) => Promise<LiveTrackerIssueState>;
  hasLiveTmuxSession: (agentId: string) => Promise<boolean>;
  hasOpenChangeRequest: (agent: AgentGcRow) => Promise<boolean>;
  hasInFlightReviewOrTest: (agent: AgentGcRow) => boolean | Promise<boolean>;
  log: (message: string) => void;
}

export type AgentGcTerminalityResult = boolean | AgentGcTerminalityEvidence | null;

export interface AgentGcDeps {
  agentsDir: string;
  cleanStateDir: (dirPath: string, agentsDir: string) => Promise<RemoveAgentStateDirResult>;
  listFilesToRemove: (dirPath: string, agentsDir: string) => Promise<string[]>;
  hasRetainedMarker: (dirPath: string) => Promise<boolean>;
  markRetained: (dirPath: string) => Promise<void>;
  emitPruneEvent: (agent: AgentGcRow, entry: AgentGcPruneEntry) => void;
  isTerminalAgent: (agent: AgentGcRow) => AgentGcTerminalityResult | Promise<AgentGcTerminalityResult>;
  log?: (message: string) => void;
}

function branchCandidates(agent: AgentGcRow, configuredBranch: string): Set<string> {
  return new Set([
    agent.branch,
    configuredBranch,
    `feature/${agent.issueId.toLowerCase()}`,
    `strike/${agent.issueId.toLowerCase()}`,
  ].filter((branch): branch is string => Boolean(branch)));
}

async function hasOpenChangeRequest(agent: AgentGcRow): Promise<boolean> {
  const resolved = resolveProjectFromIssueSync(agent.issueId);
  if (!resolved) throw new Error(`No configured project resolves ${agent.issueId}`);
  const project = getProjectSync(resolved.projectKey);
  if (!project) throw new Error(`Project ${resolved.projectKey} is not configured`);
  const repos = resolveProjectReposForIssue(agent.issueId);
  if (!repos?.length) throw new Error(`No configured repositories resolve ${agent.issueId}`);

  const githubRepos = repos.filter((repo) => repo.forge === 'github');
  if (githubRepos.length > 0) {
    const [owner, repo] = project.github_repo?.split('/') ?? [];
    if (githubRepos.length !== 1 || !owner || !repo) {
      throw new Error(`Cannot safely resolve GitHub PR repository for ${agent.issueId}`);
    }
    const openPullRequests = await listOpenPullRequestsSnapshot(owner, repo);
    const candidates = branchCandidates(agent, githubRepos[0].sourceBranch);
    if (openPullRequests.some((pullRequest) => candidates.has(pullRequest.headRefName))) return true;
  }

  for (const repo of repos.filter((candidate) => candidate.forge === 'gitlab')) {
    const candidates = branchCandidates(agent, repo.sourceBranch);
    const openMergeRequests = await listOpenGitLabMergeRequests(repo.repoPath);
    if (openMergeRequests.some((mergeRequest) => candidates.has(mergeRequest.source_branch))) return true;
  }

  return false;
}

/**
 * PAN-3917: a review or test is in flight when a review or test agent for the
 * issue is live. That is the fact; the status row was a copy of it.
 */
function hasInFlightReviewOrTest(agent: AgentGcRow): boolean {
  return listAgentStatesSync().some((candidate) =>
    candidate.issueId.toUpperCase() === agent.issueId.toUpperCase()
    && (candidate.role === 'review' || candidate.role === 'test')
    && ['starting', 'running', 'waiting', 'idle'].includes(candidate.status));
}

function defaultTerminalityDeps(): AgentGcTerminalityDeps {
  return {
    // PAN-3917: close-out is the tracker closing the issue, read by
    // readTrackerState below. There is no separate closedOut flag.
    hasClosedOutFlag: () => false,
    readTrackerState: readLiveTrackerIssueState,
    hasLiveTmuxSession: (agentId) => Effect.runPromise(sessionExists(agentId)),
    hasOpenChangeRequest,
    hasInFlightReviewOrTest,
    log: (message) => console.log(message),
  };
}

/**
 * Confirm every live fact required before periodic GC may remove agent state.
 * Any dependency failure is allowed to reject; the sweep catches it and
 * preserves the agent because uncertainty cannot authorize deletion.
 */
export async function resolveLiveAgentTerminalityEvidence(
  agent: AgentGcRow,
  deps: AgentGcTerminalityDeps = defaultTerminalityDeps(),
): Promise<AgentGcTerminalityEvidence | null> {
  if (agent.status !== 'stopped' || !agent.workspace) return null;
  const closedOutFlag = deps.hasClosedOutFlag(agent);
  if (!closedOutFlag) {
    deps.log(`[agent-gc] preserving ${agent.id}: issue record is not closed out`);
    return null;
  }

  const trackerState = await deps.readTrackerState(agent.issueId);
  if (trackerState !== 'closed') {
    deps.log(`[agent-gc] preserving ${agent.id}: live tracker state is ${trackerState}`);
    return null;
  }
  const liveTmux = await deps.hasLiveTmuxSession(agent.id);
  if (liveTmux) {
    deps.log(`[agent-gc] preserving ${agent.id}: tmux session is live`);
    return null;
  }
  const openChangeRequest = await deps.hasOpenChangeRequest(agent);
  if (openChangeRequest) {
    deps.log(`[agent-gc] preserving ${agent.id}: an open PR or MR still exists`);
    return null;
  }
  const inFlightReviewOrTest = await deps.hasInFlightReviewOrTest(agent);
  if (inFlightReviewOrTest) {
    deps.log(`[agent-gc] preserving ${agent.id}: review or test work is still in flight`);
    return null;
  }

  return {
    closedOutFlag,
    trackerState,
    liveTmux,
    openChangeRequest,
    inFlightReviewOrTest,
  };
}

function emitAgentGcPruneEvent(
  agent: AgentGcRow,
  entry: AgentGcPruneEntry,
): void {
  emitActivityEntry({
    source: 'cloister',
    level: 'info',
    status: 'completed',
    issueId: agent.issueId,
    message: `${agent.id} tombstoned before local agent-state cleanup`,
    details: JSON.stringify({
      predicate: entry.predicate,
      filesRemoved: entry.filesRemoved,
    }),
  });
}

function defaultAgentGcDeps(): AgentGcDeps {
  return {
    agentsDir: join(getOverdeckHome(), 'agents'),
    cleanStateDir: removeAgentStateDir,
    listFilesToRemove: listAgentStateFilesForRemoval,
    hasRetainedMarker: hasRetainedTranscriptsMarker,
    markRetained: markRetainedTranscripts,
    emitPruneEvent: emitAgentGcPruneEvent,
    isTerminalAgent: (agent) => resolveLiveAgentTerminalityEvidence(agent),
    log: (message) => console.warn(message),
  };
}

function preverifiedCloseOutPredicate(): AgentGcTerminalityEvidence {
  return {
    closedOutFlag: true,
    trackerState: 'closed-preverified-by-close-out',
    liveTmux: null,
    openChangeRequest: null,
    inFlightReviewOrTest: null,
  };
}

export async function pruneAgentRowsAfterTranscriptCleanup(
  agents: readonly AgentGcRow[],
  deps: AgentGcDeps = defaultAgentGcDeps(),
  evidenceByAgent: ReadonlyMap<string, AgentGcTerminalityEvidence> = new Map(),
): Promise<AgentGcResult> {
  const removed: string[] = [];
  const preserved: string[] = [];
  for (const agent of agents) {
    try {
      const agentDir = join(deps.agentsDir, agent.id);
      if (await deps.hasRetainedMarker(agentDir)) {
        preserved.push(agent.id);
        continue;
      }
      const entry: AgentGcPruneEntry = {
        at: new Date().toISOString(),
        event: 'tombstoned',
        predicate: evidenceByAgent.get(agent.id) ?? preverifiedCloseOutPredicate(),
        filesRemoved: await deps.listFilesToRemove(agentDir, deps.agentsDir),
      };
      deps.emitPruneEvent(agent, entry);
      const result = await deps.cleanStateDir(agentDir, deps.agentsDir);
      if (!result.removedDir) {
        await deps.markRetained(agentDir);
        preserved.push(agent.id);
        continue;
      }
      removed.push(agent.id);
    } catch (error) {
      deps.log?.(
        `[agent-gc] preserving ${agent.id}: tombstone or cleanup failed: `
        + `${error instanceof Error ? error.message : String(error)}`,
      );
      preserved.push(agent.id);
    }
  }
  return { removed, preserved };
}

export async function pruneTerminalStoppedAgents(
  agents: AgentGcRow[] = listAgentStatesSync(),
  deps: AgentGcDeps = defaultAgentGcDeps(),
  options: { dryRun?: boolean } = {},
): Promise<AgentGcResult> {
  // PAN-3465/PAN-3917: an already-retired agent must not draw a live tracker or
  // forge probe. Its evidence used to be a tombstone phase on the row; with the
  // row gone it is the retained-transcripts marker on the directory.
  const stopped = agents.filter((agent) =>
    agent.status === 'stopped' && Boolean(agent.workspace));
  const candidates: AgentGcRow[] = [];
  for (const agent of stopped) {
    if (await deps.hasRetainedMarker(join(deps.agentsDir, agent.id))) continue;
    candidates.push(agent);
  }
  const terminal: AgentGcRow[] = [];
  const evidenceByAgent = new Map<string, AgentGcTerminalityEvidence>();
  const preserved: string[] = [];

  for (const agent of candidates) {
    try {
      const terminality = await deps.isTerminalAgent(agent);
      if (terminality) {
        terminal.push(agent);
        if (typeof terminality === 'object') {
          evidenceByAgent.set(agent.id, terminality);
        }
      } else preserved.push(agent.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.log?.(`[agent-gc] preserving ${agent.id}: live terminality check failed: ${message}`);
      preserved.push(agent.id);
    }
  }

  if (options.dryRun) {
    return { removed: terminal.map((agent) => agent.id), preserved };
  }

  const result = await pruneAgentRowsAfterTranscriptCleanup(
    terminal,
    deps,
    evidenceByAgent,
  );
  return { removed: result.removed, preserved: [...preserved, ...result.preserved] };
}
