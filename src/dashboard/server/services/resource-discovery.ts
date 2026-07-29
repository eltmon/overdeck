import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { compareIssueIds } from '@overdeck/contracts';

import type { TaskTotals } from './resource-discovery-signals.js';
import { isWithinRecencyDate, isWithinRecencyMs } from './resource-discovery-signals.js';
import {
  captureSharedResourceSignals,
  type SharedResourceSignals,
  type TrackerIssueRecord,
} from './resource-discovery-shared.js';

import { getAgentRuntimeState } from '../../../lib/agents.js';
import {
  PAN_CONTINUE_FILENAME,
  PAN_DIRNAME,
} from '../../../lib/pan-dir/index.js';
import { findSpecByIssue } from '../../../lib/pan-dir/specs.js';
import { findDraftPrd } from '../../../lib/prd-locations.js';
import { listProjectsSync, resolveProjectFromIssueSync, type ProjectConfig, type ResolvedProject } from '../../../lib/projects.js';
import {
  PLANNED_BACKLOG_SPEC_ONLY_REASON,
  type PipelineBucket,
  type PipelineMembership,
} from '../../../lib/pipeline-membership.js';
import { listOpenPullRequestsSnapshot } from '../../../lib/pipeline-membership-gather.js';
import { loadReadyForMergeFlags } from '../review-status.js';
import { resolveAgentGitInfo } from './git-info.js';
import { parseIssueIdFromTextSync } from '../../../lib/resource-utils.js';
import {
  readPipelineMembershipSnapshotsForProjects,
  refreshMembershipSnapshotsForProjects,
} from './pipeline-membership.js';

const execFileAsync = promisify(execFile);
const RECENT_ACTIVITY_WINDOW_MS = 5_000;

export { RECENCY_DAYS } from './resource-discovery-signals.js';
export type { TaskTotals } from './resource-discovery-signals.js';

export type ResourceSource = 'tracker' | 'tmux' | 'workspace' | 'branch' | 'pr' | 'prd' | 'vbrief' | 'tasks' | 'docker' | 'remote-agent' | 'conversation';

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
  hasXbrief: boolean;
  hasTasks: boolean;
  hasPrd: boolean;
  dockerContainerCount: number;
  /** Current HEAD of the agent's workspace, or null when no workspace exists. */
  actualBranch: string | null;
  /** True when the workspace HEAD differs from the expected feature/<id> branch. */
  branchDrifted: boolean;
  /** True when a feature/* or bypass/* branch for the issue has unmerged commits not on main. */
  branchAheadOfMain: boolean;
  /** True when the workspace path is configured but missing on disk. */
  workspaceMissing: boolean;
  /** Remote (fly.io) work agent for this issue, when one is active (PAN-1676). */
  remoteAgent: { vmName: string; status: string; model: string; startedAt: string } | null;
  /** Non-archived conversations explicitly linked to this issue. */
  conversations: Array<{ id: number; name: string; title: string | null; status: string }>;
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
  taskTotals: TaskTotals | null;
  pipelineBucket?: PipelineBucket;
  /** PAN-2822: planned_backlog caused solely by the L6 spec lens — display surfaces may hide these. */
  specOnlyPlanned?: boolean;
  /** Live resource residue attached to a resolver-rejected terminal issue. */
  resourceDrift?: boolean;
}

interface InternalResourceDetails {
  tmuxSessions: string[];
  workspacePath: string | null;
  localBranches: string[];
  remoteBranches: string[];
  prs: GhPullRequest[];
  xbriefPath: string | null;
  xbriefMtime: number | null;
  tasksPath: string | null;
  prdPath: string | null;
  dockerContainers: string[];
  actualBranch: string | null;
  branchDrifted: boolean;
  branchAheadOfMain: boolean;
  workspaceMissing: boolean;
  remoteAgent: { vmName: string; status: string; model: string; startedAt: string } | null;
  conversations: Array<{ id: number; name: string; title: string | null; status: string; tmuxSession: string | null }>;
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
  taskTotals: TaskTotals | null;
}

interface InternalDiscoveredIssue extends Omit<ResourceAllocatedIssue, 'resourceSources' | 'resourceDetails'> {
  resourceSources: Set<ResourceSource>;
  resourceDetails: InternalResourceDetails;
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
  config: ProjectConfig;
}

interface ResourceDiscoveryCacheEntry {
  value: ResourceAllocatedIssue[];
  computedAt: number;
}

interface ProjectResourceSnapshot {
  detailed: InternalDiscoveredIssue[];
  public: ResourceAllocatedIssue[];
  computedAt: number;
}

const projectResourceSnapshots = new Map<string, ProjectResourceSnapshot>();
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
    hasXbrief: details.xbriefPath !== null,
    hasTasks: details.tasksPath !== null,
    hasPrd: details.prdPath !== null,
    dockerContainerCount: details.dockerContainers.length,
    actualBranch: details.actualBranch,
    branchDrifted: details.branchDrifted,
    branchAheadOfMain: details.branchAheadOfMain,
    workspaceMissing: details.workspaceMissing,
    remoteAgent: details.remoteAgent,
    conversations: details.conversations.map((conv) => ({ id: conv.id, name: conv.name, title: conv.title, status: conv.status })),
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
  return issue.resourceDetails.remoteAgent !== null
    || issue.resourceDetails.tmuxSessions.length > 0
    || issue.resourceDetails.dockerContainers.length > 0
    || hasOpenPr(issue);
}

function isActiveTrackerState(state: string | null): boolean {
  return state === 'in_progress' || state === 'in_review' || state === 'started';
}

function isTerminalTrackerState(state: string | null): boolean {
  return state === 'closed' || state === 'done' || state === 'canceled' || state === 'completed';
}

function hasOpenPr(issue: MutableResourceIssue): boolean {
  return issue.resourceDetails.prs.some((pr) => pr.state === 'OPEN' || pr.state === 'open');
}

function shouldLoadReviewStatus(issue: MutableResourceIssue): boolean {
  return issue.resourceSources.size > 0
    && (!isTerminalTrackerState(issue.trackerState) || hasOpenPr(issue))
    && (isLiveResource(issue) || (isActiveTrackerState(issue.trackerState) && issue.branch != null));
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

async function loadOpenPullRequests(projects: ProjectRef[]): Promise<Map<string, GhPullRequest[]>> {
  const pullRequests = new Map<string, GhPullRequest[]>();
  await Promise.all(projects.map(async (project) => {
    if (!project.config.github_repo) return;
    const [owner, repo] = project.config.github_repo.split('/');
    if (!owner || !repo) return;
    try {
      const prs = await listOpenPullRequestsSnapshot(owner, repo);
      for (const row of prs) {
        if (row.number === undefined || row.title === undefined || row.url === undefined
          || row.state === undefined || row.isDraft === undefined || row.baseRefName === undefined) continue;
        const pr: GhPullRequest = {
          number: row.number, title: row.title, url: row.url, state: row.state,
          isDraft: row.isDraft, headRefName: row.headRefName, baseRefName: row.baseRefName,
        };
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

const PROJECT_BRANCH_PATTERNS = [
  'refs/heads/feature/*',
  'refs/remotes/origin/feature/*',
  'refs/heads/bypass/*',
  'refs/remotes/origin/bypass/*',
];

async function loadProjectBranchSnapshot(projectPath: string): Promise<{
  local: string[];
  remote: string[];
  ahead: Set<string>;
}> {
  const run = (extraArgs: string[] = []) => execFileAsync('git', [
    'for-each-ref',
    '--format=%(refname:short)',
    ...extraArgs,
    ...PROJECT_BRANCH_PATTERNS,
  ], {
    cwd: projectPath,
    encoding: 'utf-8',
    timeout: 10000,
  }).catch(() => ({ stdout: '' }));

  const [allRefs, unmergedRefs] = await Promise.all([
    run(),
    run(['--no-merged=main']),
  ]);
  const branches = allRefs.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const ahead = new Set(unmergedRefs.stdout.split('\n').map((line) => line.trim()).filter(Boolean));

  return {
    local: branches.filter((branch) => !branch.startsWith('origin/')),
    remote: branches.filter((branch) => branch.startsWith('origin/')),
    ahead,
  };
}

interface WorkspaceScanResult {
  workspacePath: string;
  hasPlanning: boolean;
  hasPrd: boolean;
  hasState: boolean;
  hasXbrief: boolean;
  xbriefPath: string | null;
  xbriefMtime: number | null;
  hasTasks: boolean;
}

async function scanWorkspace(
  workspacesDir: string,
  workspaceName: string,
): Promise<WorkspaceScanResult> {
  const workspacePath = join(workspacesDir, workspaceName);
  const projectRoot = join(workspacesDir, '..');
  const workspaceEntries = new Set(await readdir(workspacePath).catch(() => [] as string[]));
  const panEntries = workspaceEntries.has(PAN_DIRNAME)
    ? new Set(await readdir(join(workspacePath, PAN_DIRNAME)).catch(() => [] as string[]))
    : new Set<string>();
  const issueMatch = workspaceName.match(/^feature-([a-z]+-\d+)$/i);
  const issueId = issueMatch ? issueMatch[1].toUpperCase() : null;
  const specEntry = issueId
    ? await Effect.runPromise(findSpecByIssue(projectRoot, issueId)).catch(() => null)
    : null;
  const xbriefPath = specEntry ? specEntry.path : null;
  let xbriefMtime: number | null = null;
  if (xbriefPath) {
    try {
      const stats = await stat(xbriefPath);
      xbriefMtime = stats.mtimeMs;
    } catch {
      xbriefMtime = null;
    }
  }

  return {
    workspacePath,
    hasPlanning: workspaceEntries.has(PAN_DIRNAME),
    hasPrd: panEntries.has('prd.md'),
    hasState: panEntries.has(PAN_CONTINUE_FILENAME),
    hasXbrief: xbriefPath !== null,
    xbriefPath,
    xbriefMtime,
    hasTasks: xbriefPath !== null,
  };
}

async function computeResourceAllocatedIssues(
  projectConfigs: ProjectConfig[],
  sharedSignals?: SharedResourceSignals,
): Promise<InternalDiscoveredIssue[]> {
  const registeredProjects = listProjectsSync() as ProjectRef[];
  const projects = projectConfigs.map((config) =>
    registeredProjects.find((entry) => entry.config.path === config.path)
      ?? { key: config.name ?? config.path, config });
  const {
    trackerIssues,
    tmuxSessions,
    dockerContainers,
    conversations,
    remoteAgentStates,
  } = sharedSignals ?? await captureSharedResourceSignals();
  const pullRequests = await loadOpenPullRequests(projects);

  const issueMap = new Map<string, MutableResourceIssue>();
  const projectByPrefix = new Map<string, ProjectRef>();
  for (const project of projects) {
    for (const prefix of projectPrefixes(project)) {
      projectByPrefix.set(prefix, project);
    }
  }

  const projectRefFromResolved = (resolvedProject: ResolvedProject): ProjectRef | null =>
    projects.find((project) =>
      project.key === resolvedProject.projectKey
      || project.config.path === resolvedProject.projectPath) ?? null;

  const resolveProjectRef = (issueId: string, preferredProject?: ProjectRef): ProjectRef | null => {
    if (preferredProject) return preferredProject;
    const resolvedProject = resolveProjectFromIssueSync(issueId);
    if (resolvedProject) {
      const project = projectRefFromResolved(resolvedProject);
      if (project) return project;
    }
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
      readyForMerge: false,
      lastActivity: null,
      resourceSources: new Set<ResourceSource>(),
      resourceDetails: {
        tmuxSessions: [],
        workspacePath: null,
        localBranches: [],
        remoteBranches: [],
        prs: [],
        xbriefPath: null,
        xbriefMtime: null,
        tasksPath: null,
        prdPath: null,
        dockerContainers: [],
        actualBranch: null,
        branchDrifted: false,
        branchAheadOfMain: false,
        workspaceMissing: false,
        remoteAgent: null,
        conversations: [],
      },
      taskTotals: null,
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

  // Non-archived conversations explicitly linked to an issue are a distinct
  // resource signal from tmux/agent sessions (PAN-2602). They indicate active
  // operator attention even when no agent session is running.
  for (const conv of conversations) {
    if (!conv.issueId || conv.archivedAt) continue;
    const issue = ensureIssue(conv.issueId);
    if (!issue) continue;
    issue.resourceSources.add('conversation');
    issue.resourceDetails.conversations.push({
      id: conv.id,
      name: conv.name,
      title: conv.title,
      status: conv.status,
      tmuxSession: conv.tmuxSession,
    });
  }

  // Remote (fly.io) work agents have no local tmux session — surface them
  // from their remote-state.json so the tree shows the issue as actively
  // worked (PAN-1676).
  for (const remoteState of remoteAgentStates) {
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
    // ONE bulk tasks read per project per refresh, rather than a per-workspace
    // read each 30s TTL — the bulk shape keeps refreshes cheap as the workspace
    // count grows.
    const [workspaceEntries, branches] = await Promise.all([
      readdir(workspacesDir, { withFileTypes: true }).catch(() => []),
      loadProjectBranchSnapshot(projectPath),
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
      if (workspace.xbriefPath) {
        issue.resourceSources.add('vbrief');
        issue.resourceDetails.xbriefPath = workspace.xbriefPath;
        issue.resourceDetails.xbriefMtime = workspace.xbriefMtime;
      }
      if (workspace.hasTasks) {
        issue.resourceSources.add('tasks');
        issue.resourceDetails.tasksPath = join(workspace.workspacePath, '.tasks');
      }
      const gitInfo = await resolveAgentGitInfo(workspace.workspacePath, issue.branch);
      issue.resourceDetails.actualBranch = gitInfo.actualBranch;
      issue.resourceDetails.branchDrifted = gitInfo.branchDrifted;
      issue.resourceDetails.workspaceMissing = gitInfo.workspaceMissing;
    }));

    for (const [branch, key] of [
      ...branches.local.map((b) => [b, 'localBranches'] as const),
      ...branches.remote.map((b) => [b, 'remoteBranches'] as const),
    ]) {
      const issueId = parseIssueIdFromTextSync(branch);
      if (!issueId) continue;
      const issue = ensureIssue(issueId, project);
      if (!issue) continue;
      issue.resourceSources.add('branch');
      if (!issue.resourceDetails[key].includes(branch)) {
        issue.resourceDetails[key].push(branch);
      }
      if (branches.ahead.has(branch)) {
        issue.resourceDetails.branchAheadOfMain = true;
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

  const reviewStatusIssueIds = [...issueMap.values()]
    .filter(shouldLoadReviewStatus)
    .map((issue) => issue.issueId);
  if (reviewStatusIssueIds.length > 0) {
    const readyForMergeFlags = loadReadyForMergeFlags(reviewStatusIssueIds);
    for (const issue of issueMap.values()) {
      issue.readyForMerge = readyForMergeFlags.get(issue.issueId) ?? false;
    }
  }

  const memberships = new Map<string, PipelineMembership>();
  const unavailableProjects = new Set<string>();
  const projectMemberships = readPipelineMembershipSnapshotsForProjects(projects.map((project) => project.config));
  for (const result of projectMemberships) {
    if (result.error) unavailableProjects.add(result.project.name);
    for (const membership of result.memberships ?? []) {
      ensureIssue(membership.issueId);
      memberships.set(membership.issueId, membership);
    }
  }

  await Promise.all([...issueMap.values()].map(async (issue) => {
    const project = resolveProjectRef(issue.issueId);
    if (!project) return;
    const draft = await Effect.runPromise(findDraftPrd(project.config.path, issue.issueId)).catch(() => null);
    if (!draft) return;
    issue.resourceSources.add('prd');
    issue.resourceDetails.prdPath = draft.path;
    issue.hasPrd = true;
  }));

  // The canonical resolver owns pipeline inclusion whenever it returns a verdict.
  // While a project's membership is unavailable, retain only rows backed by a live
  // resource so a transient tracker failure cannot erase running work.
  const discoveredIssues = [...issueMap.values()]
    .filter((issue) => issue.resourceSources.size > 0)
    .filter((issue) => {
      const membership = memberships.get(issue.issueId);
      return membership?.inPipeline === true
        || (membership?.bucket === 'clean_terminal' && isLiveResource(issue))
        || (!membership && unavailableProjects.has(issue.projectName) && isLiveResource(issue));
    })
    .map((issue) => {
        const membership = memberships.get(issue.issueId);
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
          taskTotals: issue.taskTotals,
          pipelineBucket: membership?.bucket,
          specOnlyPlanned: membership
            ? membership.bucket === 'planned_backlog'
              && membership.reasons.includes(PLANNED_BACKLOG_SPEC_ONLY_REASON)
            : undefined,
          resourceDrift: membership ? !membership.inPipeline : undefined,
        } satisfies InternalDiscoveredIssue;
      });

  return discoveredIssues.sort((a, b) => compareIssueIds(a.issueId, b.issueId));
}

function toPublicResourceIssue(issue: InternalDiscoveredIssue): ResourceAllocatedIssue {
  return {
    ...issue,
    resourceSources: [...issue.resourceSources],
    resourceDetails: summarizeResourceDetails(issue.resourceDetails),
  };
}

function rebuildCombinedResourceSnapshot(): ResourceAllocatedIssue[] {
  const detailed = [...projectResourceSnapshots.values()]
    .flatMap((snapshot) => snapshot.detailed)
    .sort((a, b) => compareIssueIds(a.issueId, b.issueId));
  const publicIssues = detailed.map(toPublicResourceIssue);
  cachedDetailedResourceIssues = detailed;
  cachedResourceIssues = {
    value: publicIssues,
    computedAt: Math.max(0, ...[...projectResourceSnapshots.values()].map((snapshot) => snapshot.computedAt)),
  };
  return publicIssues;
}

function publishProjectResourceSnapshot(project: ProjectConfig, issues: InternalDiscoveredIssue[]): void {
  projectResourceSnapshots.set(project.path, {
    detailed: issues,
    public: issues.map(toPublicResourceIssue),
    computedAt: Date.now(),
  });
  rebuildCombinedResourceSnapshot();
}

export interface RefreshResourceAllocatedProjectsOptions {
  refreshMembership?: boolean;
}

/** Refresh only the requested projects, capturing fleet-wide signals once for the batch. */
export async function refreshResourceAllocatedProjects(
  projects: ProjectConfig[],
  options: RefreshResourceAllocatedProjectsOptions = {},
): Promise<ResourceAllocatedIssue[]> {
  if (projects.length === 0) return cachedResourceIssues?.value ?? [];
  const sharedSignals = await captureSharedResourceSignals();
  const failures: Error[] = [];
  for (const project of projects) {
    try {
      if (options.refreshMembership !== false) {
        await refreshMembershipSnapshotsForProjects([project]);
      }
      const issues = await computeResourceAllocatedIssues([project], sharedSignals);
      publishProjectResourceSnapshot(project, issues);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      failures.push(failure);
      console.warn(
        `[resource-discovery] refresh failed for ${project.name ?? project.path}; keeping last-good snapshot:`,
        failure.message,
      );
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} project resource refresh(es) failed`);
  }
  return cachedResourceIssues?.value ?? [];
}

export async function getCachedResourceAllocatedIssues(): Promise<ResourceAllocatedIssue[]> {
  return cachedResourceIssues?.value ?? [];
}

export async function discoverResourceAllocatedIssues(): Promise<ResourceAllocatedIssue[]> {
  return triggerResourceDiscoveryRefresh();
}

/** Explicit all-project refresh for tests and diagnostics; runtime callers use the project queue. */
export function triggerResourceDiscoveryRefresh(): Promise<ResourceAllocatedIssue[]> {
  if (resourceIssuesRefreshPromise) return resourceIssuesRefreshPromise;
  resourceIssuesRefreshPromise = refreshResourceAllocatedProjects(
    listProjectsSync().map((entry) => entry.config),
  ).finally(() => {
    resourceIssuesRefreshPromise = null;
  });
  return resourceIssuesRefreshPromise;
}

export async function discoverResourceAllocatedIssuesFresh(): Promise<ResourceAllocatedIssue[]> {
  const projects = listProjectsSync().map((entry) => entry.config);
  await refreshMembershipSnapshotsForProjects(projects);
  return (await computeResourceAllocatedIssues(projects)).map(toPublicResourceIssue);
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
      hasXbrief: issue.resourceDetails.hasXbrief,
      hasTasks: issue.resourceDetails.hasTasks,
      hasPrd: issue.resourceDetails.hasPrd,
      dockerContainerCount: issue.resourceDetails.dockerContainerCount,
      actualBranch: issue.resourceDetails.actualBranch,
      branchDrifted: issue.resourceDetails.branchDrifted,
      branchAheadOfMain: issue.resourceDetails.branchAheadOfMain,
      workspaceMissing: issue.resourceDetails.workspaceMissing,
      remoteAgent: issue.resourceDetails.remoteAgent ?? null,
      conversations: issue.resourceDetails.conversations.map((conv) => ({ id: conv.id, name: conv.name, title: conv.title, status: conv.status })),
    },
  }));
}

export function toPublicResourceDetailIdentifiers(details: InternalResourceDetails): ResourceDetailIdentifiers {
  return summarizeResourceDetailIdentifiers(details);
}

export async function getResourceDetailIdentifiers(issueId: string): Promise<ResourceDetailIdentifiers | null> {
  const normalizedIssueId = issueId.toUpperCase();
  const cachedMatch = cachedDetailedResourceIssues?.find((entry) => entry.issueId === normalizedIssueId);
  return cachedMatch ? toPublicResourceDetailIdentifiers(cachedMatch.resourceDetails) : null;
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
      features: project.features.sort((a, b) => compareIssueIds(a.issueId, b.issueId)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function resetResourceAllocatedIssuesCacheForTests(): void {
  projectResourceSnapshots.clear();
  cachedResourceIssues = null;
  cachedDetailedResourceIssues = null;
  resourceIssuesRefreshPromise = null;
}
