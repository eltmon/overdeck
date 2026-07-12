import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';

import { jsonResponse } from '../../dashboard/server/http-helpers.js';
import { LinearClient } from '../../dashboard/server/services/linear-client.js';
import {
  getCachedResourceAllocatedIssues,
  getResourceDetailIdentifiers,
  sanitizeResourceAllocatedIssues,
} from '../../dashboard/server/services/resource-discovery.js';
import { getGitHubConfig } from '../../dashboard/server/services/tracker-config.js';
import { spawnInspectAgent } from '../cloister/inspect-agent.js';
import { extractPrefixSync, parseIssueIdSync } from '../issue-id.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { loadRemoteAgentState } from '../remote/remote-agents.js';
import { loadWorkspaceMetadataSync as loadWorkspaceMetadataStatic } from '../remote/workspace-metadata.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';
import { createBeadsResolver } from '../beads/resolver.js';
import { getBeadsHealth } from '../beads/telemetry.js';

function isGitHubIssue(issueId: string): {
  isGitHub: boolean;
  owner?: string;
  repo?: string;
  number?: number;
} {
  const resolved = resolveGitHubIssueSync(issueId);
  if (resolved.isGitHub) {
    return { isGitHub: true, owner: resolved.owner, repo: resolved.repo, number: resolved.number };
  }
  return { isGitHub: false };
}

function getGitHubLocalPaths(): Record<string, string> {
  const ghConfig = getGitHubConfig();
  if (!ghConfig) return {};
  const out: Record<string, string> = {};
  for (const r of ghConfig.repos) {
    const localPath = (r as { localPath?: unknown }).localPath;
    if (typeof localPath === 'string') {
      out[`${r.owner}/${r.repo}`] = localPath;
    }
  }
  return out;
}

function getProjectPath(linearProjectId?: string, issuePrefix?: string): string {
  if (issuePrefix) {
    const issueId = `${issuePrefix}-1`;
    const resolved = resolveProjectFromIssueSync(issueId);
    if (resolved) return resolved.projectPath;
  }
  if (issuePrefix) {
    const config = getGitHubConfig();
    if (config) {
      for (const { owner, repo, prefix } of config.repos) {
        const repoPrefix = prefix || repo.toUpperCase().replace(/-CLI$/, '').replace(/-/g, '');
        if (repoPrefix.toUpperCase() === issuePrefix.toUpperCase()) {
          const possiblePaths = [
            join(homedir(), 'Projects', repo),
            join(homedir(), 'Projects', repo.replace(/-cli$/, '')),
            join(homedir(), 'Projects', owner, repo),
          ];
          for (const path of possiblePaths) {
            if (existsSync(path)) return path;
          }
        }
      }
    }
  }
  return join(homedir(), 'Projects');
}

export function resolveIssueProjectPathSync(id: string): string {
  const githubCheck = isGitHubIssue(id);
  let projectPath = '';
  if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
    const localPaths = getGitHubLocalPaths();
    projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
  }
  if (!projectPath) {
    const issuePrefix = extractPrefixSync(id) ?? id.split('-')[0];
    try { projectPath = getProjectPath(undefined, issuePrefix); } catch { projectPath = ''; }
  }
  return projectPath;
}

async function pathIsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export function analyzeIssue(id: string) {
  return Effect.gen(function* () {
    const linear = yield* LinearClient;

    const issue = yield* Effect.promise(() =>
      Effect.runPromise(linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)))),
    );

    if (!issue) {
      return jsonResponse({ error: 'Issue not found' }, { status: 404 });
    }

    const desc = (issue.description || '').toLowerCase();
    const title = issue.title.toLowerCase();
    const combined = `${title} ${desc}`;

    const reasons: string[] = [];
    const subsystems: string[] = [];
    let estimatedTasks = 1;

    if (combined.includes('frontend') || combined.includes('ui') || combined.includes('component')) subsystems.push('frontend');
    if (combined.includes('backend') || combined.includes('api') || combined.includes('endpoint')) subsystems.push('backend');
    if (combined.includes('database') || combined.includes('migration') || combined.includes('schema')) subsystems.push('database');
    if (combined.includes('test') || combined.includes('e2e') || combined.includes('playwright')) subsystems.push('tests');

    if (subsystems.length > 1) {
      reasons.push(`Multiple subsystems involved: ${subsystems.join(', ')}`);
      estimatedTasks += subsystems.length;
    }

    const ambiguousPatterns = ['should we', 'maybe', 'or', 'consider', 'option', 'approach', 'tbd', 'unclear'];
    for (const pattern of ambiguousPatterns) {
      if (combined.includes(pattern)) { reasons.push('Requirements may be ambiguous'); break; }
    }

    const architecturePatterns = ['refactor', 'architecture', 'redesign', 'migrate', 'integration', 'authentication'];
    for (const pattern of architecturePatterns) {
      if (combined.includes(pattern)) {
        reasons.push(`Architecture decision needed: ${pattern}`);
        estimatedTasks += 2;
        break;
      }
    }

    if (desc.length > 500) { reasons.push('Detailed description suggests complexity'); estimatedTasks += 1; }

    const labels = issue.labels.map((l) => l.name);
    const complexLabels = ['complex', 'large', 'epic', 'multi-phase', 'architecture'];
    for (const label of labels) {
      if (complexLabels.some((cl: string) => label.toLowerCase().includes(cl))) {
        reasons.push(`Label indicates complexity: ${label}`);
        estimatedTasks += 2;
      }
    }

    const isComplex = reasons.length >= 2 || subsystems.length > 1 || estimatedTasks >= 4;

    return jsonResponse({
      issue: {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        status: issue.state.name,
        priority: issue.priority,
        url: issue.url,
        labels,
      },
      complexity: {
        isComplex,
        reasons,
        subsystems,
        estimatedTasks: Math.max(estimatedTasks, subsystems.length + 1),
      },
    });
  });
}

export function getIssueBeads(id: string) {
  return Effect.gen(function* () {
    const issueLower = id.toLowerCase();
    const resolvedProject = resolveProjectFromIssueSync(id);
    const projectPath = resolvedProject?.projectPath ?? resolveIssueProjectPathSync(id);
    const workspacePath = projectPath ? join(projectPath, 'workspaces', `feature-${issueLower}`) : '';

    // Check for remote workspace (reads non-fatal state files)
    const { isRemoteWorkspace, remoteVmName } = yield* Effect.promise(async (): Promise<{ isRemoteWorkspace: boolean; remoteVmName: string | null }> => {
      const planningSessionName = `planning-${issueLower}`;
      try {
        const remoteState = loadRemoteAgentState(planningSessionName);
        if (remoteState?.vmName) return { isRemoteWorkspace: true, remoteVmName: remoteState.vmName };
      } catch { /* Ignore */ }

      try {
        const remoteMetadataPath = join(homedir(), '.overdeck', 'agents', planningSessionName, 'remote-workspace.json');
        if (existsSync(remoteMetadataPath)) {
          const remoteMetadata = JSON.parse(await readFile(remoteMetadataPath, 'utf-8'));
          if (remoteMetadata.vmName) return { isRemoteWorkspace: true, remoteVmName: remoteMetadata.vmName };
        }
      } catch { /* Ignore parse errors */ }

      try {
        const wsMetadata = loadWorkspaceMetadataStatic(id);
        if (wsMetadata?.vmName) return { isRemoteWorkspace: true, remoteVmName: wsMetadata.vmName };
      } catch { /* Not a remote workspace */ }

      return { isRemoteWorkspace: false, remoteVmName: null };
    });

    // Try local beads query (non-fatal on bd error)
    const { beads, querySource, staleReason } = yield* Effect.promise(async (): Promise<{ beads: any[]; querySource: string; staleReason?: string }> => {
      const bdSearchDir = (workspacePath && existsSync(workspacePath)) ? workspacePath : (projectPath || homedir());
      // 8s (was 500ms): under live pipeline traffic the shared bd lock queue
      // is hot and a 500ms acquisition virtually never wins, leaving the rail
      // permanently stale. The wait is async (never blocks the event loop)
      // and stays under the rail's 10s poll interval.
      const result = await createBeadsResolver(bdSearchDir, { retry: { acquisitionTimeoutMs: 8_000 } }).getBeadsForIssue(id);
      return result.ok
        ? { beads: result.value, querySource: 'canonical-dolt' }
        : { beads: [], querySource: 'canonical-dolt', staleReason: result.reason };
    });

    const tasks = beads.map((bead: any) => ({
      id: bead.id,
      title: bead.title,
      status: bead.status,
      type: bead.issue_type || bead.type || 'task',
      blockedBy: bead.blocked_by || [],
      createdAt: bead.created_at,
      startedAt: bead.started_at,
      updatedAt: bead.updated_at,
      closedAt: bead.closed_at,
      labels: bead.labels || [],
      priority: bead.priority,
    }));

    tasks.sort((a: any, b: any) => {
      if (a.priority !== b.priority) return (a.priority || 4) - (b.priority || 4);
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    // Suppress unused variable warning — remoteVmName available for callers if needed
    void remoteVmName;

    const freshness = yield* Effect.promise(() => getBeadsHealth(resolvedProject?.projectKey ?? '', (workspacePath && existsSync(workspacePath)) ? workspacePath : (projectPath || homedir())));
    return jsonResponse({
      tasks,
      workspacePath,
      count: tasks.length,
      source: querySource,
      isRemote: isRemoteWorkspace,
      lastSyncedAt: freshness.lastSuccessfulPullAt,
      freshnessAgeMs: freshness.freshnessAgeMs,
      stale: Boolean(staleReason || freshness.lastSyncError),
      syncError: staleReason ?? freshness.lastSyncError,
      health: freshness,
    });
  });
}

function isValidBeadId(beadId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(beadId);
}

export function inspectIssueBead(options: {
  id: string;
  beadId: string;
  body: unknown;
}) {
  return Effect.gen(function* () {
    const { id, beadId, body } = options;
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    if (!beadId.trim()) {
      return jsonResponse({ error: 'Missing bead ID' }, { status: 400 });
    }
    if (!isValidBeadId(beadId)) {
      return jsonResponse({ error: 'Invalid bead ID' }, { status: 400 });
    }

    const project = resolveProjectFromIssueSync(id);
    if (!project) {
      return jsonResponse({ error: `Could not resolve project for ${id}` }, { status: 404 });
    }

    const issueLower = id.toLowerCase();
    const workspace = join(project.projectPath, 'workspaces', `feature-${issueLower}`);
    const workspaceExists = yield* Effect.promise(() => pathIsDirectory(workspace));
    if (!workspaceExists) {
      return jsonResponse({ error: `No workspace found for ${id}` }, { status: 404 });
    }

    const result = yield* spawnInspectAgent({
      projectKey: project.projectKey,
      projectPath: project.projectPath,
      issueId: id,
      beadId,
      workspace,
      branch: `feature/${issueLower}`,
    }, { deep: (body as { deep?: unknown }).deep === true });

    if (!result.success) {
      return jsonResponse({ success: false, error: result.error ?? result.message }, { status: 500 });
    }

    if (result.skipped) {
      return jsonResponse({ success: true, skipped: true, message: result.message, tmuxSession: result.tmuxSession });
    }

    return jsonResponse({ success: true, runId: result.runId, tmuxSession: result.tmuxSession });
  });
}

export function getResourceAllocatedIssues() {
  return Effect.gen(function* () {
    const issues = yield* Effect.tryPromise({
      try: async () => sanitizeResourceAllocatedIssues(await getCachedResourceAllocatedIssues()),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    return jsonResponse(issues);
  });
}

export function getIssueResourceDetails(rawId: string) {
  return Effect.gen(function* () {
    const parsedIssueId = parseIssueIdSync(rawId);
    if (!parsedIssueId) {
      return jsonResponse({ error: 'Invalid issue id: ' + rawId }, { status: 400 });
    }
    const id = parsedIssueId.raw.toUpperCase();

    const details = yield* Effect.tryPromise({
      try: () => getResourceDetailIdentifiers(id),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    if (!details) {
      return jsonResponse({ error: `No resource details found for ${id}` }, { status: 404 });
    }

    return jsonResponse(details);
  });
}
