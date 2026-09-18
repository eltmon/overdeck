import { join } from 'node:path';

import { Effect } from 'effect';

import {
  listAllAgentsSync,
  removeAgentRecordSync,
  RETAINED_TRANSCRIPTS_PHASE,
  tombstoneAgentRecordSync,
} from '../overdeck/agents.js';
import {
  appendAgentPlaneLifecycle,
  flushAgentPlaneWrites,
  type AgentPlaneLifecycleEntry,
  type AgentPlaneTombstonePredicate,
} from '../pan-dir/agents.js';
import { readIssueRecordForWorkspaceSync } from '../pan-dir/record.js';
import { getOverdeckHome } from '../paths.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { getAgentStateSync } from '../agents/agent-state.js';
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

export type AgentGcTerminalityResult = boolean | AgentPlaneTombstonePredicate | null;

export interface AgentGcDeps {
  agentsDir: string;
  cleanStateDir: (dirPath: string, agentsDir: string) => Promise<RemoveAgentStateDirResult>;
  listFilesToRemove: (dirPath: string, agentsDir: string) => Promise<string[]>;
  hasRetainedMarker: (dirPath: string) => Promise<boolean>;
  markRetained: (dirPath: string) => Promise<void>;
  writeTombstone: (agent: AgentGcRow, entry: AgentPlaneLifecycleEntry) => Promise<void>;
  emitPruneEvent: (agent: AgentGcRow, entry: AgentPlaneLifecycleEntry) => void;
  removeRecord: (id: string) => void;
  tombstoneRecord: (id: string) => void;
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
export async function resolveLiveAgentTerminalityEvidence(
  agent: AgentGcRow,
  deps: AgentGcTerminalityDeps = defaultTerminalityDeps(),
): Promise<AgentPlaneTombstonePredicate | null> {
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

export async function confirmLiveAgentTerminality(
  agent: AgentGcRow,
  deps: AgentGcTerminalityDeps = defaultTerminalityDeps(),
): Promise<boolean> {
  return (await resolveLiveAgentTerminalityEvidence(agent, deps)) !== null;
}

async function persistAgentGcTombstone(
  agent: AgentGcRow,
  entry: AgentPlaneLifecycleEntry,
): Promise<void> {
  const state = getAgentStateSync(agent.id);
  if (!state) {
    throw new Error(`local agent state is unavailable for durable tombstone ${agent.id}`);
  }
  // The GC owns the durability boundary below. Keep this concrete mutation in
  // the queue until its explicit flush can reconcile a concurrent remote
  // advance while the desired tombstone is still available.
  const written = await appendAgentPlaneLifecycle(state, entry, { deferCommit: true });
  if (!written) {
    throw new Error(`durable agent plane is unavailable for tombstone ${agent.id}`);
  }
  const flush = await flushAgentPlaneWrites(agent.issueId, agent.id);
  if (!flush || flush.errored || flush.pushed !== true) {
    throw new Error(
      `durable tombstone push failed for ${agent.id}: ${flush?.reason ?? 'no confirmed state-branch push'}`,
    );
  }
}

function emitAgentGcPruneEvent(
  agent: AgentGcRow,
  entry: AgentPlaneLifecycleEntry,
): void {
  emitActivityEntrySync({
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
    writeTombstone: persistAgentGcTombstone,
    emitPruneEvent: emitAgentGcPruneEvent,
    removeRecord: removeAgentRecordSync,
    tombstoneRecord: tombstoneAgentRecordSync,
    isTerminalAgent: (agent) => resolveLiveAgentTerminalityEvidence(agent),
    log: (message) => console.warn(message),
  };
}

function preverifiedCloseOutPredicate(): AgentPlaneTombstonePredicate {
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
  evidenceByAgent: ReadonlyMap<string, AgentPlaneTombstonePredicate> = new Map(),
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
      const entry: AgentPlaneLifecycleEntry = {
        at: new Date().toISOString(),
        event: 'tombstoned',
        predicate: evidenceByAgent.get(agent.id) ?? preverifiedCloseOutPredicate(),
        filesRemoved: await deps.listFilesToRemove(agentDir, deps.agentsDir),
      };
      await deps.writeTombstone(agent, entry);
      deps.emitPruneEvent(agent, entry);
      const result = await deps.cleanStateDir(agentDir, deps.agentsDir);
      if (!result.removedDir) {
        await deps.markRetained(agentDir);
        deps.tombstoneRecord(agent.id);
        preserved.push(agent.id);
        continue;
      }
      deps.removeRecord(agent.id);
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
  options: { dryRun?: boolean } = {},
): Promise<AgentGcResult> {
  const candidates = agents.filter((agent) =>
    agent.phase !== RETAINED_TRANSCRIPTS_PHASE
    && agent.status === 'stopped'
    && Boolean(agent.workspace));
  const terminal: AgentGcRow[] = [];
  const evidenceByAgent = new Map<string, AgentPlaneTombstonePredicate>();
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
