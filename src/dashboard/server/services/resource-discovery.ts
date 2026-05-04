import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { getAgentRuntimeStateAsync } from '../../../lib/agents.js';
import { listProjects, resolveProjectFromIssue, type ResolvedProject } from '../../../lib/projects.js';
import { listSessionNamesAsync } from '../../../lib/tmux.js';
import { getReviewStatus } from '../review-status.js';
import { getGitHubConfig } from './tracker-config.js';

const execFileAsync = promisify(execFile);
const RESOURCE_DISCOVERY_TTL_MS = 30_000;
const RECENT_ACTIVITY_WINDOW_MS = 5_000;

export type ResourceSource = 'tracker' | 'tmux' | 'workspace' | 'branch' | 'pr' | 'vbrief' | 'beads' | 'docker';

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

function parseIssueIdFromText(value: string): string | null {
  const match = value.match(/\b([A-Za-z]+-\d+|F\d+|US\d+|DE\d+|TA\d+|TC\d+)\b/i);
  return match ? match[1]!.toUpperCase() : null;
}

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
    return (await listSessionNamesAsync()).map((name) => name.trim()).filter(Boolean);
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
        const issueId = parseIssueIdFromText(pr.headRefName);
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
  hasBeads: boolean;
}

async function scanWorkspace(workspacesDir: string, workspaceName: string): Promise<WorkspaceScanResult> {
  const workspacePath = join(workspacesDir, workspaceName);
  const workspaceEntries = new Set(await readdir(workspacePath).catch(() => [] as string[]));
  const planningEntries = workspaceEntries.has('.planning')
    ? new Set(await readdir(join(workspacePath, '.planning')).catch(() => [] as string[]))
    : new Set<string>();
  const beadsEntries = workspaceEntries.has('.beads')
    ? new Set(await readdir(join(workspacePath, '.beads')).catch(() => [] as string[]))
    : new Set<string>();

  return {
    workspacePath,
    hasPlanning: workspaceEntries.has('.planning'),
    hasPrd: planningEntries.has('PLANNING_PROMPT.md'),
    hasState: [...planningEntries].some(e => e.startsWith('continue-') && e.endsWith('.vbrief.json')),
    hasVbrief: planningEntries.has('plan.vbrief.json'),
    hasBeads: beadsEntries.has('issues.jsonl') || beadsEntries.has('redirect'),
  };
}

async function computeResourceAllocatedIssues(): Promise<InternalDiscoveredIssue[]> {
  const projects = listProjects() as ProjectRef[];
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
    const resolvedProject = resolveProjectFromIssue(issueId);
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
      readyForMerge: getReviewStatus(upper)?.readyForMerge ?? false,
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
    if (!sessionName.startsWith('agent-') && !sessionName.startsWith('planning-') && !sessionName.startsWith('specialist-') && !sessionName.startsWith('review-')) {
      continue;
    }
    const issueId = parseIssueIdFromText(sessionName);
    if (!issueId) continue;
    const issue = ensureIssue(issueId);
    if (!issue) continue;
    issue.resourceSources.add('tmux');
    if (!issue.resourceDetails.tmuxSessions.includes(sessionName)) {
      issue.resourceDetails.tmuxSessions.push(sessionName);
    }
  }

  for (const containerName of dockerContainers) {
    const issueId = parseIssueIdFromText(containerName.replace(/feature\//g, 'feature-'));
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
      const planningDir = join(workspace.workspacePath, '.planning');
      const planPath = join(planningDir, 'plan.vbrief.json');
      issue.resourceSources.add('workspace');
      issue.resourceDetails.workspacePath = workspace.workspacePath;
      issue.hasPlanning = workspace.hasPlanning;
      issue.hasPrd = workspace.hasPrd;
      issue.hasState = workspace.hasState;
      if (workspace.hasVbrief) {
        issue.resourceSources.add('vbrief');
        issue.resourceDetails.vbriefPath = planPath;
      }
      if (workspace.hasBeads) {
        issue.resourceSources.add('beads');
        issue.resourceDetails.beadsPath = join(workspace.workspacePath, '.beads');
      }
    }));

    for (const branch of branches.local) {
      const issueId = parseIssueIdFromText(branch);
      if (!issueId) continue;
      const issue = ensureIssue(issueId, project);
      if (!issue) continue;
      issue.resourceSources.add('branch');
      if (!issue.resourceDetails.localBranches.includes(branch)) {
        issue.resourceDetails.localBranches.push(branch);
      }
    }

    for (const branch of branches.remote) {
      const issueId = parseIssueIdFromText(branch);
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

    const issueLower = issue.issueId.toLowerCase();
    const agentId = `agent-${issueLower}`;
    const runtimeState = await getAgentRuntimeStateAsync(agentId).catch(() => null);
    if (!runtimeState) return;

    issue.agentStatus = runtimeState.state;
    const lastActivity = Date.parse(runtimeState.lastActivity);
    issue.lastActivity = Number.isFinite(lastActivity) ? lastActivity : null;
  }));

  // PRD acceptance (PAN-862): tree shows ONLY issues that are tracker-active
  // (in_progress / in_review / ready-for-merge) OR have live runtime resources
  // (tmux session, docker container, open PR). A lingering feature/* branch or
  // workspace directory alone is debris from a merged issue — not active work.
  const isActiveTrackerState = (state: string | null): boolean =>
    state === 'in_progress' || state === 'in_review' || state === 'started';

  const isLiveResource = (issue: MutableResourceIssue): boolean => {
    if (issue.resourceDetails.tmuxSessions.length > 0) return true;
    if (issue.resourceDetails.dockerContainers.length > 0) return true;
    if (issue.resourceDetails.prs.some((pr) => pr.state === 'OPEN' || pr.state === 'open')) return true;
    return false;
  };

  const discoveredIssues = [...issueMap.values()]
    .filter((issue) => issue.resourceSources.size > 0)
    .filter((issue) => issue.readyForMerge || isActiveTrackerState(issue.trackerState) || isLiveResource(issue))
    .map((issue) => {
        const hasTmux = issue.resourceDetails.tmuxSessions.length > 0;
        const hasRecentHeartbeat = hasRecentActivity(issue.lastActivity);
        const stateLabel = deriveStateLabel(issue, hasTmux, hasRecentHeartbeat);
        const status = hasTmux && (issue.agentStatus === 'active' || hasRecentHeartbeat)
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
