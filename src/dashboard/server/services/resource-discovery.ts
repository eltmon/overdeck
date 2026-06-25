import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Effect } from 'effect';

import { getAgentRuntimeState } from '../../../lib/agents.js';
import {
  PAN_CONTINUE_FILENAME,
  PAN_DIRNAME,
} from '../../../lib/pan-dir/index.js';
import { findSpecByIssue } from '../../../lib/pan-dir/specs.js';
import { listProjectsSync, resolveProjectFromIssueSync, type ResolvedProject } from '../../../lib/projects.js';
import { listSessionNames } from '../../../lib/tmux.js';
import { getReviewStatusSync } from '../review-status.js';
import { getGitHubConfig } from './tracker-config.js';
import { resolveAgentGitInfo } from './git-info.js';
import { parseIssueIdFromTextSync } from '../../../lib/resource-utils.js';

const execFileAsync = promisify(execFile);
const RESOURCE_DISCOVERY_TTL_MS = 30_000;
const RECENT_ACTIVITY_WINDOW_MS = 5_000;

export type ResourceSource = 'tracker' | 'tmux' | 'workspace' | 'branch' | 'pr' | 'vbrief' | 'beads' | 'docker' | 'remote-agent';

export interface ResourcePullRequest {
  number: number;
  title: string;
  url?: string;
  state: string;
  isDraft: boolean;
}

export interface ResourceDetails {
  hasWorkspace: boolean;
  localBranchCount: number;
  remoteBranchCount: number;
  tmuxSessionCount: number;
  prs: ResourcePullRequest[];
  hasVbrief: boolean;
  hasBeads: boolean;
  dockerContainerCount: number;
  /** Current HEAD of the agent's workspace, or null when no workspace exists. */
  actualBranch: string | null;
  /** True when the workspace HEAD differs from the expected feature/<id> branch. */
  branchDrifted: boolean;
  /** True when the workspace path is configured but missing on disk. */
  workspaceMissing: boolean;
  /** Remote (fly.io) work agent for this issue, when one is active (PAN-1676). */
  remoteAgent: { vmName: string; status: string; model: string; startedAt: string } | null;
}

export interface ResourceDetailIdentifiers {
  workspacePaths: string[];
  localBranchNames: string[];
  remoteBranchNames: string[];
  tmuxSessionNames: string[];
  prs: Array<{
    number: number;
    title: string;
    state: string;
    isDraft: boolean;
  }>;
  dockerContainerNames: string[];
}

export interface ResourceAllocatedIssue {
  issueId: string;
  title: string;
  projectName: string;
  branch: string;
  status: string;
  stateLabel: string;
  agentStatus: string | null;
  hasPlanning: boolean;
  hasPrd: boolean;
  hasState: boolean;
  isShadow: boolean;
  isRally: boolean;
  childCount?: number;
  completedCount?: number;
  inProgressCount?: number;
  readyForMerge: boolean;
  rawTrackerState?: string;
  resourceSources: ResourceSource[];
  resourceDetails: ResourceDetails;
}

interface InternalResourceDetails {
  tmuxSessions: string[];
  workspacePath: string | null;
  localBranches: string[];
  remoteBranches: string[];
  prs: GhPullRequest[];
  vbriefPath: string | null;
  beadsPath: string | null;
  dockerContainers: string[];
  actualBranch: string | null;
  branchDrifted: boolean;
  workspaceMissing: boolean;
  remoteAgent: { vmName: string; status: string; model: string; startedAt: string } | null;
}

interface MutableResourceIssue {
  issueId: string;
  title: string;
  projectName: string;
  branch: string;
  trackerState: string | null;
  rawTrackerState?: string;
  isRally: boolean;
  hasPlanning: boolean;
  hasPrd: boolean;
  hasState: boolean;
  isShadow: boolean;
  agentStatus: string | null;
  readyForMerge: boolean;
  lastActivity: number | null;
  resourceSources: Set<ResourceSource>;
  resourceDetails: InternalResourceDetails;
}

interface InternalDiscoveredIssue extends Omit<ResourceAllocatedIssue, 'resourceSources' | 'resourceDetails'> {
  resourceSources: Set<ResourceSource>;
  resourceDetails: InternalResourceDetails;
}

interface TrackerIssueRecord {
  identifier?: string;
  title?: string;
  state?: string;
  status?: string;
  rawTrackerState?: string;
  source?: string;
  totalChildCount?: number;
  completedChildCount?: number;
  inProgressChildCount?: number;
}

interface GhPullRequest {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
}

interface ProjectRef {
  key: string;
  config: {
    name?: string;
    path: string;
    issue_prefix?: string;
    issue_prefixes?: string[];
  };
}

interface ResourceDiscoveryCacheEntry {
  value: ResourceAllocatedIssue[];
  computedAt: number;
}

let cachedResourceIssues: ResourceDiscoveryCacheEntry | null = null;
let cachedDetailedResourceIssues: InternalDiscoveredIssue[] | null = null;
let resourceIssuesRefreshPromise: Promise<ResourceAllocatedIssue[]> | null = null;

function projectPrefixes(project: ProjectRef): string[] {
  const prefixes = new Set<string>();
  if (project.config.issue_prefix) prefixes.add(project.config.issue_prefix.toUpperCase());
  for (const prefix of project.config.issue_prefixes ?? []) prefixes.add(prefix.toUpperCase());
  if (prefixes.size === 0) prefixes.add(project.key.toUpperCase().replace(/-/g, ''));
  return [...prefixes];
}

function deriveStateLabel(issue: MutableResourceIssue, hasTmux: boolean, hasFreshHeartbeat: boolean): string {
  const trackerState = issue.trackerState ?? '';
  if (issue.readyForMerge) return 'In Review';
  if (trackerState === 'done' || trackerState === 'closed' || trackerState === 'canceled') {
    return hasTmux ? 'Closed' : 'Done';
  }
  if (trackerState === 'in_review') return 'In Review';
  if (trackerState === 'in_progress') return 'In Progress';
  if (hasTmux && (issue.agentStatus === 'active' || hasFreshHeartbeat)) return 'In Progress';
  if (issue.agentStatus === 'suspended') return 'Suspended';
  if (issue.hasPrd && !issue.hasState) return 'Planning';
  if (issue.hasState) return 'Has Context';
  if (issue.resourceSources.has('workspace') || issue.resourceSources.has('branch')) return 'Allocated';
  return 'Idle';
}

function sortPullRequests(prs: GhPullRequest[]): GhPullRequest[] {
  return [...prs].sort((a, b) => {
    if (a.isDraft !== b.isDraft) return a.isDraft ? 1 : -1;
    return a.number - b.number;
  });
}

function summarizeResourceDetails(details: InternalResourceDetails): ResourceDetails {
  return {
    hasWorkspace: details.workspacePath !== null,
    localBranchCount: details.localBranches.length,
    remoteBranchCount: details.remoteBranches.length,
    tmuxSessionCount: details.tmuxSessions.length,
    prs: sortPullRequests(details.prs).map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: pr.state,
      isDraft: pr.isDraft,
    })),
    hasVbrief: details.vbriefPath !== null,
    hasBeads: details.beadsPath !== null,
    dockerContainerCount: details.dockerContainers.length,
    actualBranch: details.actualBranch,
    branchDrifted: details.branchDrifted,
    workspaceMissing: details.workspaceMissing,
    remoteAgent: details.remoteAgent,
  };
}

function summarizeResourceDetailIdentifiers(details: InternalResourceDetails): ResourceDetailIdentifiers {
  return {
    workspacePaths: details.workspacePath ? [details.workspacePath] : [],
    localBranchNames: [...details.localBranches].sort(),
    remoteBranchNames: [...details.remoteBranches].sort(),
    tmuxSessionNames: [...details.tmuxSessions].sort(),
    prs: sortPullRequests(details.prs).map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      isDraft: pr.isDraft,
    })),
    dockerContainerNames: [...details.dockerContainers].sort(),
  };
}

function hasRecentActivity(lastActivity: number | null): boolean {
  return lastActivity !== null && Number.isFinite(lastActivity) && (Date.now() - lastActivity) < RECENT_ACTIVITY_WINDOW_MS;
}

function isLiveResource(issue: MutableResourceIssue): boolean {
  return issue.resourceDetails.tmuxSessions.length > 0
    || issue.resourceDetails.dockerContainers.length > 0
    || issue.resourceDetails.prs.length > 0
    || issue.agentStatus === 'active'
    || hasRecentActivity(issue.lastActivity);
}

/**
 * tmux session-name prefixes that map a session to its issue in the Command Deck
 * tree. `strike-` MUST be included (PAN-1682): strike sessions are named
 * `strike-<issue>` and a strike issue is typically `todo` (not an active tracker
 * state), so without registering the tmux resource the issue is filtered out of
 * the tree entirely. Keep this list in sync with the agent-session prefixes the
 * dashboard recognizes elsewhere (e.g. routes/agents.ts).
 */
const DISCOVERABLE_SESSION_PREFIXES = ['agent-', 'planning-', 'specialist-', 'review-', 'strike-'] as const;

export function isDiscoverableAgentSession(sessionName: string): boolean {
  return DISCOVERABLE_SESSION_PREFIXES.some((prefix) => sessionName.startsWith(prefix));
}

async function loadTrackerIssues(): Promise<Map<string, TrackerIssueRecord>> {
  const map = new Map<string, TrackerIssueRecord>();
  try {
    const { getSharedIssueService } = await import('./issue-service-singleton.js');
    const service = await getSharedIssueService();
    const issues = service.getIssues() as TrackerIssueRecord[];
    for (const issue of issues) {
      if (issue.identifier) {
        map.set(issue.identifier.toUpperCase(), issue);
      }
    }
  } catch {
    return map;
  }
  return map;
}

async function loadTmuxSessions(): Promise<string[]> {
  try {
    return (await Effect.runPromise(listSessionNames())).map((name) => name.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function loadDockerContainers(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('docker', ['ps', '--format', '{{.Names}}'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function loadOpenPullRequests(): Promise<Map<string, GhPullRequest[]>> {
  const pullRequests = new Map<string, GhPullRequest[]>();
  const githubConfig = getGitHubConfig();
  const repos = githubConfig?.repos ?? [];

  await Promise.all(repos.map(async (repo) => {
    try {
      const { stdout } = await execFileAsync(
        'gh',
        [
          'pr', 'list',
          '--repo', `${repo.owner}/${repo.repo}`,
          '--state', 'open',
          '--limit', '200',
          '--json', 'number,title,url,state,isDraft,headRefName,baseRefName',
        ],
        { encoding: 'utf-8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
      );
      const prs = JSON.parse(stdout) as GhPullRequest[];
      for (const pr of prs) {
        const issueId = parseIssueIdFromTextSync(pr.headRefName);
        if (!issueId) continue;
        const existing = pullRequests.get(issueId) ?? [];
        existing.push(pr);
        pullRequests.set(issueId, existing);
      }
    } catch {
      // ignore repo-specific failures
    }
  }));

  for (const [issueId, prs] of pullRequests) {
    pullRequests.set(issueId, sortPullRequests(prs));
  }

  return pullRequests;
}

async function loadProjectBranches(projectPath: string): Promise<{ local: string[]; remote: string[] }> {
  try {
    const [localResult, remoteResult] = await Promise.all([
      execFileAsync('git', ['for-each-ref', 'refs/heads/feature/*', '--format=%(refname:short)'], {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 10000,
      }).catch(() => ({ stdout: '' })),
      execFileAsync('git', ['for-each-ref', 'refs/remotes/origin/feature/*', '--format=%(refname:short)'], {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 10000,
      }).catch(() => ({ stdout: '' })),
    ]);

    return {
      local: localResult.stdout.split('\n').map((line) => line.trim()).filter(Boolean),
      remote: remoteResult.stdout.split('\n').map((line) => line.trim()).filter(Boolean),
    };
  } catch {
    return { local: [], remote: [] };
  }
}

interface WorkspaceScanResult {
  workspacePath: string;
  hasPlanning: boolean;
  hasPrd: boolean;
  hasState: boolean;
  hasVbrief: boolean;
  vbriefPath: string | null;
  hasBeads: boolean;
}

async function scanWorkspace(workspacesDir: string, workspaceName: string): Promise<WorkspaceScanResult> {
  const workspacePath = join(workspacesDir, workspaceName);
  const projectRoot = join(workspacesDir, '..');
  const workspaceEntries = new Set(await readdir(workspacePath).catch(() => [] as string[]));
  const panEntries = workspaceEntries.has(PAN_DIRNAME)
    ? new Set(await readdir(join(workspacePath, PAN_DIRNAME)).catch(() => [] as string[]))
    : new Set<string>();
  const beadsEntries = workspaceEntries.has('.beads')
    ? new Set(await readdir(join(workspacePath, '.beads')).catch(() => [] as string[]))
    : new Set<string>();
  const issueMatch = workspaceName.match(/^feature-([a-z]+-\d+)$/i);
  const issueId = issueMatch ? issueMatch[1].toUpperCase() : null;
  const specEntry = issueId
    ? await Effect.runPromise(findSpecByIssue(projectRoot, issueId)).catch(() => null)
    : null;
  const vbriefPath = specEntry ? specEntry.path : null;

  return {
    workspacePath,
    hasPlanning: workspaceEntries.has(PAN_DIRNAME),
    hasPrd: panEntries.has('prd.md'),
    hasState: panEntries.has(PAN_CONTINUE_FILENAME),
    hasVbrief: vbriefPath !== null,
    vbriefPath,
    hasBeads: beadsEntries.has('issues.jsonl') || beadsEntries.has('redirect'),
  };
}

async function computeResourceAllocatedIssues(): Promise<InternalDiscoveredIssue[]> {
  const projects = listProjectsSync() as ProjectRef[];
  const [trackerIssues, tmuxSessions, dockerContainers, pullRequests] = await Promise.all([
    loadTrackerIssues(),
    loadTmuxSessions(),
    loadDockerContainers(),
    loadOpenPullRequests(),
  ]);

  const issueMap = new Map<string, MutableResourceIssue>();
  const projectByPrefix = new Map<string, ProjectRef>();
  for (const project of projects) {
    for (const prefix of projectPrefixes(project)) {
      projectByPrefix.set(prefix, project);
    }
  }

  const projectRefFromResolved = (resolvedProject: ResolvedProject): ProjectRef => ({
    key: resolvedProject.projectKey,
    config: {
      name: resolvedProject.projectName,
      path: resolvedProject.projectPath,
    },
  });

  const resolveProjectRef = (issueId: string, preferredProject?: ProjectRef): ProjectRef | null => {
    if (preferredProject) return preferredProject;
    const resolvedProject = resolveProjectFromIssueSync(issueId);
    if (resolvedProject) return projectRefFromResolved(resolvedProject);
    const prefix = issueId.toUpperCase().match(/^([A-Z]+)-\d+$/)?.[1] ?? '';
    return projectByPrefix.get(prefix) ?? null;
  };

  const ensureIssue = (issueId: string, preferredProject?: ProjectRef): MutableResourceIssue | null => {
    const upper = issueId.toUpperCase();
    const existing = issueMap.get(upper);
    if (existing) return existing;

    const resolved = resolveProjectRef(upper, preferredProject);
    if (!resolved) return null;

    const tracker = trackerIssues.get(upper);
    const created: MutableResourceIssue = {
      issueId: upper,
      title: tracker?.title?.trim() || upper,
      projectName: resolved.config.name ?? resolved.key,
      branch: `feature/${upper.toLowerCase()}`,
      trackerState: typeof tracker?.state === 'string' ? tracker.state : null,
      rawTrackerState: tracker?.rawTrackerState,
      isRally: tracker?.source === 'rally',
      hasPlanning: false,
      hasPrd: false,
      hasState: false,
      isShadow: false,
      agentStatus: null,
      readyForMerge: getReviewStatusSync(upper)?.readyForMerge ?? false,
      lastActivity: null,
      resourceSources: new Set<ResourceSource>(),
      resourceDetails: {
        tmuxSessions: [],
        workspacePath: null,
        localBranches: [],
        remoteBranches: [],
        prs: [],
        vbriefPath: null,
        beadsPath: null,
        dockerContainers: [],
        actualBranch: null,
        branchDrifted: false,
        workspaceMissing: false,
        remoteAgent: null,
      },
    };
    issueMap.set(upper, created);
    return created;
  };

  for (const [issueId, tracker] of trackerIssues) {
    const issue = ensureIssue(issueId);
    if (!issue) continue;
    issue.title = tracker.title?.trim() || issue.title;
    issue.trackerState = typeof tracker.state === 'string' ? tracker.state : issue.trackerState;
    issue.rawTrackerState = tracker.rawTrackerState ?? issue.rawTrackerState;
    issue.isRally = tracker.source === 'rally';
    issue.resourceSources.add('tracker');
  }

  for (const sessionName of tmuxSessions) {
    if (!isDiscoverableAgentSession(sessionName)) {
      continue;
    }
    const issueId = parseIssueIdFromTextSync(sessionName);
    if (!issueId) continue;
    const issue = ensureIssue(issueId);
    if (!issue) continue;
    issue.resourceSources.add('tmux');
    if (!issue.resourceDetails.tmuxSessions.includes(sessionName)) {
      issue.resourceDetails.tmuxSessions.push(sessionName);
    }
  }

  // Remote (fly.io) work agents have no local tmux session — surface them
  // from their remote-state.json so the tree shows the issue as actively
  // worked (PAN-1676).
  try {
    const { listActiveRemoteAgentStates } = await import('../../../lib/remote/remote-agents.js');
    for (const remoteState of listActiveRemoteAgentStates()) {
      const issue = ensureIssue(remoteState.issueId);
      if (!issue) continue;
      issue.resourceSources.add('remote-agent');
      issue.resourceDetails.remoteAgent = {
        vmName: remoteState.vmName,
        status: remoteState.status,
        model: remoteState.model,
        startedAt: remoteState.startedAt,
      };
      if (!issue.agentStatus) issue.agentStatus = 'active';
    }
  } catch {
    // Remote module unavailable — tree simply omits remote agents.
  }

  for (const containerName of dockerContainers) {
    const issueId = parseIssueIdFromTextSync(containerName.replace(/feature\//g, 'feature-'));
    if (!issueId) continue;
    const issue = ensureIssue(issueId);
    if (!issue) continue;
    issue.resourceSources.add('docker');
    issue.resourceDetails.dockerContainers.push(containerName);
  }

  await Promise.all(projects.map(async (project) => {
    const projectPath = project.config.path;
    const workspacesDir = join(projectPath, 'workspaces');
    const [workspaceEntries, branches] = await Promise.all([
      readdir(workspacesDir, { withFileTypes: true }).catch(() => []),
      loadProjectBranches(projectPath),
    ]);

    await Promise.all(workspaceEntries.map(async (entry) => {
      if (!entry.isDirectory() || !entry.name.startsWith('feature-')) return;
      const issueId = entry.name.replace(/^feature-/, '').toUpperCase();
      const issue = ensureIssue(issueId, project);
      if (!issue) return;
      const workspace = await scanWorkspace(workspacesDir, entry.name);
      issue.resourceSources.add('workspace');
      issue.resourceDetails.workspacePath = workspace.workspacePath;
      issue.hasPlanning = workspace.hasPlanning;
      issue.hasPrd = workspace.hasPrd;
      issue.hasState = workspace.hasState;
      if (workspace.vbriefPath) {
        issue.resourceSources.add('vbrief');
        issue.resourceDetails.vbriefPath = workspace.vbriefPath;
      }
      if (workspace.hasBeads) {
        issue.resourceSources.add('beads');
        issue.resourceDetails.beadsPath = join(workspace.workspacePath, '.beads');
      }
      const gitInfo = await resolveAgentGitInfo(workspace.workspacePath, issue.branch);
      issue.resourceDetails.actualBranch = gitInfo.actualBranch;
      issue.resourceDetails.branchDrifted = gitInfo.branchDrifted;
      issue.resourceDetails.workspaceMissing = gitInfo.workspaceMissing;
    }));

    for (const branch of branches.local) {
      const issueId = parseIssueIdFromTextSync(branch);
      if (!issueId) continue;
      const issue = ensureIssue(issueId, project);
      if (!issue) continue;
      issue.resourceSources.add('branch');
      if (!issue.resourceDetails.localBranches.includes(branch)) {
        issue.resourceDetails.localBranches.push(branch);
      }
    }

    for (const branch of branches.remote) {
      const issueId = parseIssueIdFromTextSync(branch);
      if (!issueId) continue;
      const issue = ensureIssue(issueId, project);
      if (!issue) continue;
      issue.resourceSources.add('branch');
      if (!issue.resourceDetails.remoteBranches.includes(branch)) {
        issue.resourceDetails.remoteBranches.push(branch);
      }
    }
  }));

  for (const [issueId, prs] of pullRequests) {
    const issue = ensureIssue(issueId);
    if (!issue) continue;
    issue.resourceSources.add('pr');
    issue.resourceDetails.prs = prs;
    const bestTitle = prs.find((pr) => !pr.isDraft)?.title ?? prs[0]?.title;
    issue.title = issue.title === issue.issueId && bestTitle ? bestTitle : issue.title;
  }

  await Promise.all([...issueMap.values()].map(async (issue) => {
    if (issue.resourceDetails.tmuxSessions.length === 0) return;

    // Runtime-state ids equal session names (agent-<issue>, strike-<issue>,
    // planning-<issue>, ...). Probe every discovered session — not just
    // agent-<issue> — so strike/planning sessions surface as live agents.
    // PAN-1682 made these sessions discoverable but left attribution
    // agent-only, which rendered a running strike as a lifeless node.
    const states = (await Promise.all(
      issue.resourceDetails.tmuxSessions.map((sessionName) =>
        Effect.runPromise(getAgentRuntimeState(sessionName)).catch(() => null),
      ),
    )).filter((state): state is NonNullable<typeof state> => state !== null);
    if (states.length === 0) return;

    const best = states.find((state) => state.state === 'active')
      ?? states.reduce((a, b) => (Date.parse(a.lastActivity) >= Date.parse(b.lastActivity) ? a : b));
    issue.agentStatus = best.state;

    const lastActivity = Math.max(
      ...states.map((state) => Date.parse(state.lastActivity)).filter(Number.isFinite),
    );
    issue.lastActivity = Number.isFinite(lastActivity) ? lastActivity : null;
  }));

  // PRD acceptance (PAN-862): the tree shows ONLY issues with real in-flight work.
  // PAN-1966 (durable-signal membership): an active tracker LABEL is NOT sufficient
  // on its own — labels drift (an issue can stay `in-progress`/`in-review` after its
  // work landed, or carry a stale planning vBRIEF with no implementation). So a
  // tracker-active state only qualifies when it is backed by a real implementation
  // artifact (a feature branch); otherwise inclusion requires ready-for-merge or a
  // live runtime resource (tmux / docker / open PR / remote agent). A branch or
  // workspace dir alone (no active label, no live resource) is merged-issue debris
  // and stays excluded.
  const isActiveTrackerState = (state: string | null): boolean =>
    state === 'in_progress' || state === 'in_review' || state === 'started';

  // PAN-2054: a CLOSED/done/canceled issue is terminal — the operator (or close-out)
  // has declared it finished. Any workspace, feature branch, or *paused* work-agent
  // tmux session left behind is stale close-out residue, not active pipeline work.
  const isTerminalTrackerState = (state: string | null): boolean =>
    state === 'closed' || state === 'done' || state === 'canceled' || state === 'completed';

  const hasOpenPr = (issue: MutableResourceIssue): boolean =>
    issue.resourceDetails.prs.some((pr) => pr.state === 'OPEN' || pr.state === 'open');

  const isLiveResource = (issue: MutableResourceIssue): boolean => {
    if (issue.resourceDetails.remoteAgent) return true;
    if (issue.resourceDetails.tmuxSessions.length > 0) return true;
    if (issue.resourceDetails.dockerContainers.length > 0) return true;
    if (issue.resourceDetails.prs.some((pr) => pr.state === 'OPEN' || pr.state === 'open')) return true;
    return false;
  };

  const discoveredIssues = [...issueMap.values()]
    .filter((issue) => issue.resourceSources.size > 0)
    // PAN-2054: drop terminal (closed/done/canceled) issues from the active resource
    // tree even when leftover residue makes them look "live". Their paused agent /
    // workspace / merged branch is debris to reap, not pipeline work — without this a
    // merged + closed-out issue whose paused work-agent tmux session is still alive
    // (isLiveResource → true) lingers forever as "merged — awaiting close-out". An
    // OPEN PR is the one terminal-state case that still warrants attention.
    .filter((issue) => !isTerminalTrackerState(issue.trackerState) || hasOpenPr(issue))
    .filter(
      (issue) =>
        issue.readyForMerge
        || isLiveResource(issue)
        || (isActiveTrackerState(issue.trackerState) && issue.branch != null),
    )
    .map((issue) => {
        const hasTmux = issue.resourceDetails.tmuxSessions.length > 0;
        const hasRecentHeartbeat = hasRecentActivity(issue.lastActivity);
        const stateLabel = deriveStateLabel(issue, hasTmux, hasRecentHeartbeat);
        const isRemoteRunning = issue.resourceDetails.remoteAgent?.status === 'running'
          || issue.resourceDetails.remoteAgent?.status === 'starting';
        const status = (hasTmux && (issue.agentStatus === 'active' || hasRecentHeartbeat)) || isRemoteRunning
          ? 'running'
          : issue.hasState
            ? 'has_state'
            : 'idle';

        return {
          issueId: issue.issueId,
          title: issue.title,
          projectName: issue.projectName,
          branch: issue.branch,
          status,
          stateLabel,
          agentStatus: issue.agentStatus,
          hasPlanning: issue.hasPlanning,
          hasPrd: issue.hasPrd,
          hasState: issue.hasState,
          isShadow: issue.isShadow,
          isRally: issue.isRally,
          childCount: trackerIssues.get(issue.issueId)?.totalChildCount,
          completedCount: trackerIssues.get(issue.issueId)?.completedChildCount,
          inProgressCount: trackerIssues.get(issue.issueId)?.inProgressChildCount,
          readyForMerge: issue.readyForMerge,
          rawTrackerState: issue.rawTrackerState,
          resourceSources: new Set([...issue.resourceSources].sort()),
          resourceDetails: issue.resourceDetails,
        } satisfies InternalDiscoveredIssue;
      });

  return discoveredIssues.sort((a, b) => a.issueId.localeCompare(b.issueId));
}

function toPublicResourceIssue(issue: InternalDiscoveredIssue): ResourceAllocatedIssue {
  return {
    ...issue,
    resourceSources: [...issue.resourceSources],
    resourceDetails: summarizeResourceDetails(issue.resourceDetails),
  };
}

function refreshResourceAllocatedIssues(): Promise<ResourceAllocatedIssue[]> {
  if (resourceIssuesRefreshPromise) return resourceIssuesRefreshPromise;

  resourceIssuesRefreshPromise = computeResourceAllocatedIssues()
    .then((issues) => {
      cachedDetailedResourceIssues = issues;
      const publicIssues = issues.map(toPublicResourceIssue);
      cachedResourceIssues = {
        value: publicIssues,
        computedAt: Date.now(),
      };
      return publicIssues;
    })
    .finally(() => {
      resourceIssuesRefreshPromise = null;
    });

  return resourceIssuesRefreshPromise;
}

export async function getCachedResourceAllocatedIssues(): Promise<ResourceAllocatedIssue[]> {
  const now = Date.now();
  if (cachedResourceIssues && now - cachedResourceIssues.computedAt < RESOURCE_DISCOVERY_TTL_MS) {
    return cachedResourceIssues.value;
  }

  if (cachedResourceIssues) {
    void refreshResourceAllocatedIssues().catch(() => {
      // keep serving the last good snapshot until the next successful refresh
    });
    return cachedResourceIssues.value;
  }

  return refreshResourceAllocatedIssues();
}

export async function discoverResourceAllocatedIssues(): Promise<ResourceAllocatedIssue[]> {
  return getCachedResourceAllocatedIssues();
}

export async function discoverResourceAllocatedIssuesFresh(): Promise<ResourceAllocatedIssue[]> {
  return (await computeResourceAllocatedIssues()).map(toPublicResourceIssue);
}

export function sanitizeResourceAllocatedIssues(issues: ResourceAllocatedIssue[]): ResourceAllocatedIssue[] {
  return issues.map((issue) => ({
    ...issue,
    resourceDetails: {
      hasWorkspace: issue.resourceDetails.hasWorkspace,
      localBranchCount: issue.resourceDetails.localBranchCount,
      remoteBranchCount: issue.resourceDetails.remoteBranchCount,
      tmuxSessionCount: issue.resourceDetails.tmuxSessionCount,
      prs: issue.resourceDetails.prs.map((pr) => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        isDraft: pr.isDraft,
      })),
      hasVbrief: issue.resourceDetails.hasVbrief,
      hasBeads: issue.resourceDetails.hasBeads,
      dockerContainerCount: issue.resourceDetails.dockerContainerCount,
      actualBranch: issue.resourceDetails.actualBranch,
      branchDrifted: issue.resourceDetails.branchDrifted,
      workspaceMissing: issue.resourceDetails.workspaceMissing,
      remoteAgent: issue.resourceDetails.remoteAgent ?? null,
    },
  }));
}

export function toPublicResourceDetailIdentifiers(details: InternalResourceDetails): ResourceDetailIdentifiers {
  return summarizeResourceDetailIdentifiers(details);
}

export async function getResourceDetailIdentifiers(issueId: string): Promise<ResourceDetailIdentifiers | null> {
  const normalizedIssueId = issueId.toUpperCase();
  const cachedMatch = cachedDetailedResourceIssues?.find((entry) => entry.issueId === normalizedIssueId);
  if (cachedMatch) {
    return toPublicResourceDetailIdentifiers(cachedMatch.resourceDetails);
  }

  await refreshResourceAllocatedIssues();
  const refreshedMatch = cachedDetailedResourceIssues?.find((entry) => entry.issueId === normalizedIssueId);
  return refreshedMatch ? toPublicResourceDetailIdentifiers(refreshedMatch.resourceDetails) : null;
}

export function groupResourceAllocatedIssuesByProject(issues: ResourceAllocatedIssue[]): Array<{
  name: string;
  path: string;
  features: ResourceAllocatedIssue[];
}> {
  const projectTree = new Map<string, { name: string; path: string; features: ResourceAllocatedIssue[] }>();

  for (const issue of issues) {
    const existing = projectTree.get(issue.projectName);
    if (existing) {
      existing.features.push(issue);
      continue;
    }
    projectTree.set(issue.projectName, {
      name: issue.projectName,
      path: issue.projectName,
      features: [issue],
    });
  }

  return [...projectTree.values()]
    .map((project) => ({
      ...project,
      features: project.features.sort((a, b) => a.issueId.localeCompare(b.issueId)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function resetResourceAllocatedIssuesCacheForTests(): void {
  cachedResourceIssues = null;
  cachedDetailedResourceIssues = null;
  resourceIssuesRefreshPromise = null;
}
