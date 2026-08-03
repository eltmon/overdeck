import { join } from 'node:path';

import { Effect } from 'effect';

import {
  listAllAgentsSync,
  removeAgentRecordSync,
  RETAINED_TRANSCRIPTS_PHASE,
  tombstoneAgentRecordSync,
} from '../overdeck/agents.js';
import { readIssueRecordForWorkspaceSync } from '../pan-dir/record.js';
import { getOverdeckHome } from '../paths.js';
import {
  hasRetainedTranscriptsMarker,
  markRetainedTranscripts,
  removeAgentStateDir,
  type RemoveAgentStateDirResult,
} from '../agents/state-dir-removal.js';
import { readLiveTrackerIssueState, type LiveTrackerIssueState } from './issue-closed.js';
import { sessionExists } from '../tmux.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';
import { resolveProjectReposForIssueSync } from '../project-repos.js';
import { listOpenPullRequestsSnapshot } from '../pipeline-membership-gather.js';
import { listOpenGitLabMergeRequests } from '../gitlab-merge-requests.js';
import { getReviewStatusSync } from '../review-status.js';

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

export interface AgentGcTerminalityDeps {
  hasClosedOutFlag: (agent: AgentGcRow) => boolean;
  readTrackerState: (issueId: string) => Promise<LiveTrackerIssueState>;
  hasLiveTmuxSession: (agentId: string) => Promise<boolean>;
  hasOpenChangeRequest: (agent: AgentGcRow) => Promise<boolean>;
  hasInFlightReviewOrTest: (agent: AgentGcRow) => boolean | Promise<boolean>;
  log: (message: string) => void;
}

export interface AgentGcDeps {
  agentsDir: string;
  cleanStateDir: (dirPath: string, agentsDir: string) => Promise<RemoveAgentStateDirResult>;
  hasRetainedMarker: (dirPath: string) => Promise<boolean>;
  markRetained: (dirPath: string) => Promise<void>;
  removeRecord: (id: string) => void;
  tombstoneRecord: (id: string) => void;
  isTerminalAgent: (agent: AgentGcRow) => boolean | Promise<boolean>;
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
  const repos = resolveProjectReposForIssueSync(agent.issueId);
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

function hasInFlightReviewOrTest(agent: AgentGcRow): boolean {
  const status = getReviewStatusSync(agent.issueId);
  if (
    status?.reviewStatus === 'reviewing'
    || status?.testStatus === 'testing'
    || status?.verificationStatus === 'running'
    || (status?.reviewStatus === 'pending' && Boolean(status.reviewRequestedAt))
  ) return true;

  return listAllAgentsSync().some((candidate) =>
    candidate.issueId.toUpperCase() === agent.issueId.toUpperCase()
    && (candidate.role === 'review' || candidate.role === 'test')
    && ['starting', 'running', 'waiting', 'idle'].includes(candidate.status));
}

function defaultTerminalityDeps(): AgentGcTerminalityDeps {
  return {
    hasClosedOutFlag: (agent) => Boolean(agent.workspace
      && readIssueRecordForWorkspaceSync(agent.workspace, agent.issueId)?.pipeline?.closedOut === true),
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
export async function confirmLiveAgentTerminality(
  agent: AgentGcRow,
  deps: AgentGcTerminalityDeps = defaultTerminalityDeps(),
): Promise<boolean> {
  if (agent.status !== 'stopped' || !agent.workspace) return false;
  if (!deps.hasClosedOutFlag(agent)) {
    deps.log(`[agent-gc] preserving ${agent.id}: issue record is not closed out`);
    return false;
  }

  const trackerState = await deps.readTrackerState(agent.issueId);
  if (trackerState !== 'closed') {
    deps.log(`[agent-gc] preserving ${agent.id}: live tracker state is ${trackerState}`);
    return false;
  }
  if (await deps.hasLiveTmuxSession(agent.id)) {
    deps.log(`[agent-gc] preserving ${agent.id}: tmux session is live`);
    return false;
  }
  if (await deps.hasOpenChangeRequest(agent)) {
    deps.log(`[agent-gc] preserving ${agent.id}: an open PR or MR still exists`);
    return false;
  }
  if (await deps.hasInFlightReviewOrTest(agent)) {
    deps.log(`[agent-gc] preserving ${agent.id}: review or test work is still in flight`);
    return false;
  }

  return true;
}

function defaultAgentGcDeps(): AgentGcDeps {
  return {
    agentsDir: join(getOverdeckHome(), 'agents'),
    cleanStateDir: removeAgentStateDir,
    hasRetainedMarker: hasRetainedTranscriptsMarker,
    markRetained: markRetainedTranscripts,
    removeRecord: removeAgentRecordSync,
    tombstoneRecord: tombstoneAgentRecordSync,
    isTerminalAgent: (agent) => confirmLiveAgentTerminality(agent),
    log: (message) => console.warn(message),
  };
}

export async function pruneAgentRowsAfterTranscriptCleanup(
  agents: readonly AgentGcRow[],
  deps: AgentGcDeps = defaultAgentGcDeps(),
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
      const result = await deps.cleanStateDir(agentDir, deps.agentsDir);
      if (!result.removedDir) {
        await deps.markRetained(agentDir);
        deps.tombstoneRecord(agent.id);
        preserved.push(agent.id);
        continue;
      }
      deps.removeRecord(agent.id);
      removed.push(agent.id);
    } catch {
      preserved.push(agent.id);
    }
  }
  return { removed, preserved };
}

/**
 * Close-out-only pruning path. The lifecycle workflow has already positively
 * verified tracker terminality before it reaches this handoff, so it does not
 * repeat the periodic sweep's remote checks.
 */
export async function pruneStoppedAgentsForIssue(
  issueId: string,
  agents: AgentGcRow[] = listAllAgentsSync(),
  deps: AgentGcDeps = defaultAgentGcDeps(),
): Promise<AgentGcResult> {
  const issue = issueId.toUpperCase();
  const scoped = agents.filter(agent => agent.issueId.toUpperCase() === issue);
  const terminal = scoped.filter(agent => agent.status === 'stopped');
  const live = scoped.filter(agent => agent.status !== 'stopped').map(agent => agent.id);
  const result = await pruneAgentRowsAfterTranscriptCleanup(terminal, deps);
  return { removed: result.removed, preserved: [...live, ...result.preserved] };
}

export async function pruneTerminalStoppedAgents(
  agents: AgentGcRow[] = listAllAgentsSync(),
  deps: AgentGcDeps = defaultAgentGcDeps(),
): Promise<AgentGcResult> {
  const candidates = agents.filter((agent) =>
    agent.phase !== RETAINED_TRANSCRIPTS_PHASE
    && agent.status === 'stopped'
    && Boolean(agent.workspace));
  const terminal: AgentGcRow[] = [];
  const preserved: string[] = [];

  for (const agent of candidates) {
    try {
      if (await deps.isTerminalAgent(agent)) terminal.push(agent);
      else preserved.push(agent.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.log?.(`[agent-gc] preserving ${agent.id}: live terminality check failed: ${message}`);
      preserved.push(agent.id);
    }
  }

  const result = await pruneAgentRowsAfterTranscriptCleanup(terminal, deps);
  return { removed: result.removed, preserved: [...preserved, ...result.preserved] };
}
