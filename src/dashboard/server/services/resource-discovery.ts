import { execFile } from 'node:child_process';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { existsSync } from 'node:fs';

import { listProjects, resolveProjectFromIssue, type ResolvedProject } from '../../../lib/projects.js';
import { listSessionNamesAsync } from '../../../lib/tmux.js';
import { getAgentRuntimeStateAsync } from '../../../lib/agents.js';
import { getGitHubConfig } from './tracker-config.js';
import { getReviewStatus } from '../review-status.js';

const execFileAsync = promisify(execFile);

export type ResourceSource = 'tracker' | 'tmux' | 'workspace' | 'branch' | 'pr' | 'vbrief' | 'beads' | 'docker';

export interface ResourceDetails {
  tmuxSessions: string[];
  workspacePath: string | null;
  localBranches: string[];
  remoteBranches: string[];
  pr: {
    number: number;
    title: string;
    url: string;
    state: string;
    isDraft: boolean;
    headRefName: string;
    baseRefName: string;
  } | null;
  vbriefPath: string | null;
  beadsPath: string | null;
  dockerContainers: string[];
}

export interface ResourceAllocatedIssue {
  issueId: string;
  title: string;
  projectName: string;
  projectPath: string;
  branch: string;
  status: string;
  stateLabel: string;
  agentStatus: string | null;
  hasPlanning: boolean;
  hasPrd: boolean;
  hasState: boolean;
  isShadow: boolean;
  readyForMerge: boolean;
  rawTrackerState?: string;
  resourceSources: ResourceSource[];
  resourceDetails: ResourceDetails;
}

interface MutableResourceIssue {
  issueId: string;
  title: string;
  projectName: string;
  projectPath: string;
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
  resourceDetails: ResourceDetails;
}

interface TrackerIssueRecord {
  identifier?: string;
  title?: string;
  state?: string;
  status?: string;
  rawTrackerState?: string;
  source?: string;
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

function hasPath(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

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

async function loadOpenPullRequests(): Promise<Map<string, GhPullRequest>> {
  const pullRequests = new Map<string, GhPullRequest>();
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
        if (issueId) pullRequests.set(issueId, pr);
      }
    } catch {
      // ignore repo-specific failures
    }
  }));

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

export async function discoverResourceAllocatedIssues(): Promise<ResourceAllocatedIssue[]> {
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
      projectPath: resolved.config.path,
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
        pr: null,
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

    for (const entry of workspaceEntries) {
      if (!entry.isDirectory() || !entry.name.startsWith('feature-')) continue;
      const issueId = entry.name.replace(/^feature-/, '').toUpperCase();
      const issue = ensureIssue(issueId, project);
      if (!issue) continue;
      const workspacePath = join(workspacesDir, entry.name);
      const planningDir = join(workspacePath, '.planning');
      const planPath = join(planningDir, 'plan.vbrief.json');
      const prdPath = join(planningDir, 'PLANNING_PROMPT.md');
      const statePath = join(planningDir, 'STATE.md');
      const beadsPath = join(workspacePath, '.beads', 'issues.jsonl');

      const [hasPlanning, hasPrd, hasState, hasVbrief, hasBeads] = await Promise.all([
        hasPath(planningDir),
        hasPath(prdPath),
        hasPath(statePath),
        hasPath(planPath),
        hasPath(beadsPath),
      ]);

      issue.resourceSources.add('workspace');
      issue.resourceDetails.workspacePath = workspacePath;
      issue.hasPlanning = hasPlanning;
      issue.hasPrd = hasPrd;
      issue.hasState = hasState;
      if (hasVbrief) {
        issue.resourceSources.add('vbrief');
        issue.resourceDetails.vbriefPath = planPath;
      }
      if (hasBeads) {
        issue.resourceSources.add('beads');
        issue.resourceDetails.beadsPath = beadsPath;
      }
    }

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

  for (const [issueId, pr] of pullRequests) {
    const issue = ensureIssue(issueId);
    if (!issue) continue;
    issue.resourceSources.add('pr');
    issue.resourceDetails.pr = pr;
    issue.title = issue.title === issue.issueId && pr.title ? pr.title : issue.title;
  }

  await Promise.all([...issueMap.values()].map(async (issue) => {
    const issueLower = issue.issueId.toLowerCase();
    const agentId = `agent-${issueLower}`;
    const planningId = `planning-${issueLower}`;
    const stateFileCandidates = [
      join(homedir(), '.panopticon', 'agents', agentId, 'state.json'),
      join(homedir(), '.panopticon', 'agents', planningId, 'state.json'),
    ];

    for (const stateFile of stateFileCandidates) {
      try {
        if (!existsSync(stateFile)) continue;
        const raw = await readFile(stateFile, 'utf-8');
        const parsed = JSON.parse(raw) as { state?: string; lastActivity?: string };
        issue.agentStatus = parsed.state ?? issue.agentStatus;
        if (parsed.lastActivity) {
          issue.lastActivity = new Date(parsed.lastActivity).getTime();
        }
        break;
      } catch {
        // ignore malformed state
      }
    }

    const runtimeState = await getAgentRuntimeStateAsync(agentId).catch(() => null);
    if (runtimeState?.state) {
      issue.agentStatus = runtimeState.state;
    }
  }));

  return [...issueMap.values()]
    .filter((issue) => issue.resourceSources.size > 0)
    .map((issue) => {
      const heartbeatPath = join(homedir(), '.panopticon', 'heartbeats', `agent-${issue.issueId.toLowerCase()}.json`);
      const hasTmux = issue.resourceDetails.tmuxSessions.length > 0;
      const hasFreshHeartbeat = existsSync(heartbeatPath);
      const stateLabel = deriveStateLabel(issue, hasTmux, hasFreshHeartbeat);
      const status = hasTmux && (issue.agentStatus === 'active' || hasFreshHeartbeat)
        ? 'running'
        : issue.hasState
          ? 'has_state'
          : 'idle';

      return {
        issueId: issue.issueId,
        title: issue.title,
        projectName: issue.projectName,
        projectPath: issue.projectPath,
        branch: issue.branch,
        status,
        stateLabel,
        agentStatus: issue.agentStatus,
        hasPlanning: issue.hasPlanning,
        hasPrd: issue.hasPrd,
        hasState: issue.hasState,
        isShadow: issue.isShadow,
        readyForMerge: issue.readyForMerge,
        rawTrackerState: issue.rawTrackerState,
        resourceSources: [...issue.resourceSources].sort(),
        resourceDetails: {
          ...issue.resourceDetails,
          tmuxSessions: [...issue.resourceDetails.tmuxSessions].sort(),
          localBranches: [...issue.resourceDetails.localBranches].sort(),
          remoteBranches: [...issue.resourceDetails.remoteBranches].sort(),
          dockerContainers: [...issue.resourceDetails.dockerContainers].sort(),
        },
      } satisfies ResourceAllocatedIssue;
    })
    .sort((a, b) => a.issueId.localeCompare(b.issueId));
}
