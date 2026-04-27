import { jsonResponse } from "../http-helpers.js";
/**
 * Projects route module — Effect HttpRouter.Layer (PAN-821)
 *
 * Implements:
 *   GET /api/projects/:projectKey/session-tree
 */

import { access, readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { httpHandler } from './http-handler.js';
import { resolveProjectFromIssue, listProjects } from '../../../lib/projects.js';
import { extractPrefix } from '../../../lib/issue-id.js';
import { listSessionNamesAsync } from '../../../lib/tmux.js';
import { withConcurrencyLimit } from '../../../lib/concurrency.js';
import { IssueDataService } from '../services/issue-data-service.js';
import type { AgentStatus, SessionNode, SessionNodePresence, SessionNodeType } from '@panopticon/contracts';
import { deriveSessionPresence } from '../services/session-presence.js';
import { getAgentRuntimeStateAsync } from '../../../lib/agents.js';
import { getTmuxSessionName } from '../../../lib/cloister/specialists.js';
import { getReviewStatus } from '../review-status.js';
import { resolveJsonlPath } from './jsonl-resolver.js';
import { buildReviewerNodes, type ReviewerRoundMetadata } from './reviewer-tree.js';

// ─── Shared IssueDataService (via singleton) ────────────────────────────────

async function getIssueDataService(): Promise<IssueDataService> {
  const { getSharedIssueService } = await import('../services/issue-service-singleton.js');
  return getSharedIssueService();
}

// ─── Async FS helpers ─────────────────────────────────────────────────────────

/** Returns true if the path exists (any type). */
async function pathExists(p: string): Promise<boolean> {
  return access(p).then(() => true, () => false);
}

/** Read a file or return null if not found. */
async function readOptional(p: string): Promise<string | null> {
  return readFile(p, 'utf-8').catch(() => null);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapSessionType(type: string): SessionNodeType {
  const validTypes: SessionNodeType[] = [
    'planning', 'work', 'review', 'reviewer', 'test', 'merge', 'legacy',
  ];
  return (validTypes.includes(type as SessionNodeType) ? type : 'legacy') as SessionNodeType;
}

function mapAgentStatus(status: string): AgentStatus {
  switch (status) {
    case 'running': return 'running';
    case 'active':
    case 'reviewing':
    case 'testing':
    case 'merging':
    case 'verifying':
      return 'running';
    case 'completed':
    case 'passed':
    case 'queued':
    case 'merged':
    case 'suspended':
      return 'stopped';
    case 'failed':
    case 'blocked':
    case 'commented':
    case 'changes-requested':
    case 'dispatch_failed':
      return 'error';
    default: return 'unknown';
  }
}

interface ActivityContext {
  tmuxSessionNames?: Set<string>;
}

const LEGACY_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Hide stopped legacy sessions older than 24h from the Command Deck tree.
 *  These are typically synthetic STATE.md planning placeholders or stale
 *  timestamp-named tmux sessions that no longer carry live context. */
function isStaleLegacySession(s: SessionNode): boolean {
  if (s.type !== 'legacy') return false;
  if (s.presence !== 'ended' || s.status === 'running') return false;
  const startedAtMs = Date.parse(s.startedAt);
  if (Number.isNaN(startedAtMs)) return false;
  return (Date.now() - startedAtMs) > LEGACY_SESSION_MAX_AGE_MS;
}


interface SessionTreeContext {
  tmuxSessionNames: Set<string>;
}

async function collectSessionTreeNodes(
  issueId: string,
  workspacePath: string,
  projectPath: string,
  context: SessionTreeContext,
): Promise<SessionNode[]> {
  const issueLower = issueId.toLowerCase();
  const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
  const agentsDir = join(homedir(), '.panopticon', 'agents');
  const agentId = `agent-${issueLower}`;
  const planningAgentId = `planning-${issueLower}`;
  const sections: SessionNode[] = [];
  let hasPlanningSection = false;

  for (const checkId of [planningAgentId, agentId]) {
    const agentDir = join(agentsDir, checkId);
    if (!await pathExists(agentDir)) continue;
    const stateText = await readOptional(join(agentDir, 'state.json'));
    if (!stateText) continue;

    try {
      const state = JSON.parse(stateText) as { model?: string; runtime?: string; startedAt?: string; createdAt?: string; status?: string };
      const isPlanning = checkId.startsWith('planning-');
      const sectionType = isPlanning ? 'planning' : 'work';
      if (isPlanning) hasPlanningSection = true;
      const rtState = await getAgentRuntimeStateAsync(checkId);
      const presence = await deriveSessionPresence(checkId, rtState, context.tmuxSessionNames);
      const jsonlPath = await resolveJsonlPath(checkId, workspacePath);
      sections.push({
        type: sectionType,
        sessionId: checkId,
        tmuxSession: sectionType === 'work' || sectionType === 'planning' ? checkId : undefined,
        model: state.model || state.runtime || 'unknown',
        startedAt: state.startedAt || state.createdAt || new Date().toISOString(),
        endedAt: undefined,
        duration: state.startedAt
          ? (() => {
              const ms = Date.now() - new Date(state.startedAt).getTime();
              return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
            })()
          : 0,
        status: mapAgentStatus(
          rtState?.state === 'active'
            ? 'running'
            : rtState?.state === 'suspended'
              ? 'completed'
              : (state.status || 'completed'),
        ),
        presence,
        hasJsonl: !!jsonlPath,
      });
    } catch {
      // skip malformed state
    }
  }

  if (!hasPlanningSection) {
    const planningDir = join(workspacePath, '.planning');
    if (await pathExists(planningDir)) {
      const planningStatePath = join(planningDir, 'STATE.md');
      const planningPromptPath = join(planningDir, 'PLANNING_PROMPT.md');
      const planningPathForTimestamp = await pathExists(planningStatePath)
        ? planningStatePath
        : planningPromptPath;
      const planningStat = await stat(planningPathForTimestamp).catch(() => null);
      const sessionId = `planning-${issueLower}-state`;
      const jsonlPath = await resolveJsonlPath(sessionId, workspacePath);
      sections.push({
        type: 'legacy',
        sessionId,
        model: 'unknown',
        startedAt: planningStat?.mtime.toISOString() ?? new Date(0).toISOString(),
        duration: 0,
        status: 'stopped',
        presence: 'ended',
        hasJsonl: !!jsonlPath,
      });
    }
  }

  const centralStatus = getReviewStatus(issueId.toUpperCase());
  if (centralStatus?.history && centralStatus.history.length > 0) {
    const reviewEntries = centralStatus.history.filter((entry) => entry.type === 'review');
    const latestReview = reviewEntries[reviewEntries.length - 1];
    if (latestReview) {
      const resolvedProject = resolveProjectFromIssue(issueId);
      const reviewerProjectKey = resolvedProject?.projectKey ?? issuePrefix.toLowerCase();
      const orchestratorSessionName = getTmuxSessionName('review-agent', reviewerProjectKey);
      const orchestratorPresence: SessionNodePresence = context.tmuxSessionNames.has(orchestratorSessionName)
        ? (latestReview.status === 'reviewing' ? 'active' : 'idle')
        : 'ended';
      sections.push({
        type: 'review',
        sessionId: orchestratorSessionName,
        model: 'specialist',
        startedAt: latestReview.timestamp,
        endedAt: undefined,
        duration: 0,
        status: mapAgentStatus(latestReview.status === 'reviewing' ? 'running' : latestReview.status),
        presence: orchestratorPresence,
      });
      const reviewerNodes = await buildReviewerNodes({
        issueId,
        projectKey: reviewerProjectKey,
        workspacePath,
        projectPath,
        tmuxSessionNames: context.tmuxSessionNames,
        startedAt: latestReview.timestamp,
        endedAt: undefined,
        status: mapAgentStatus(latestReview.status === 'reviewing' ? 'running' : latestReview.status),
      });
      sections.push(...reviewerNodes);
    }
  }

  return sections.filter((s) => !isStaleLegacySession(s));
}

async function resolveFeatureTitle(
  issueId: string,
  issueLower: string,
  project?: { config: { path: string; workspace?: { workspaces_dir?: string } } },
): Promise<string> {
  // Try issue data service first
  try {
    const issueDataService = await getIssueDataService();
    const allIssues = issueDataService.getIssues() as Array<Record<string, unknown>>;
    const issue = allIssues.find(i =>
      i['identifier'] === issueId ||
      (i['identifier'] as string)?.toLowerCase() === issueId.toLowerCase()
    );
    if (issue?.['title']) {
      return String(issue['title']);
    }
  } catch { /* non-fatal */ }

  // Fall back to PLANNING_PROMPT.md first line
  if (project) {
    try {
      const projectPath = (project.config as { path: string }).path;
      const workspaceConfig = (project.config as { workspace?: { workspaces_dir?: string } }).workspace;
      const workspacesDir = join(projectPath, workspaceConfig?.workspaces_dir || 'workspaces');
      const planningDir = join(workspacesDir, `feature-${issueLower}`, '.planning');
      const promptContent = await readOptional(join(planningDir, 'PLANNING_PROMPT.md'));
      if (promptContent) {
        const firstLine = promptContent.split('\n').find(l => l.trim().length > 0) || '';
        const title = firstLine.replace(/^#+\s*/, '').trim();
        if (title) return title;
      }
    } catch { /* non-fatal */ }
  }

  return issueId;
}

// ─── Route: GET /api/projects/:projectKey/session-tree ──────────────────────

const getProjectSessionTreeRoute = HttpRouter.add(
  'GET',
  '/api/projects/:projectKey/session-tree',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const projectKey = params['projectKey'] ?? '';

    const result = yield* Effect.tryPromise({
      try: () => fetchProjectSessionTree(projectKey),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    if (result === null) {
      return jsonResponse({ error: 'Project not found' }, { status: 404 });
    }

    return jsonResponse(result);
  })),
);

export async function fetchProjectSessionTree(
  projectKey: string,
  sharedContext?: ActivityContext,
): Promise<unknown | null> {
  const projects = listProjects();
  const project = projects.find(p =>
    p.key === projectKey || (p.config as { name?: string }).name === projectKey
  );
  if (!project) return null;

  const projectPath = (project.config as { path: string }).path;
  const workspaceConfig = (project.config as { workspace?: { workspaces_dir?: string } }).workspace;
  const workspacesDir = join(projectPath, workspaceConfig?.workspaces_dir || 'workspaces');

  // Reuse shared request-scoped data when provided; otherwise fetch lazily.
  const sharedTmuxSessionNames = sharedContext?.tmuxSessionNames
    ?? new Set((await listSessionNamesAsync().catch(() => [] as string[])).filter(s => s.trim()));

  const effectiveSharedContext: SessionTreeContext = {
    tmuxSessionNames: sharedTmuxSessionNames,
  };

  const features: Array<{
    issueId: string;
    title: string;
    sessions: SessionNode[];
  }> = [];

  if (await pathExists(workspacesDir)) {
    const entries = await readdir(workspacesDir, { withFileTypes: true }).catch(() => []);
    const featureCandidates = entries
      .filter(e => e.isDirectory() && e.name.startsWith('feature-'))
      .map(e => ({
        name: e.name,
        issueLower: e.name.replace('feature-', ''),
        issueId: e.name.replace('feature-', '').toUpperCase(),
      }))
      .filter(c => /^[a-z]+-\d+$/.test(c.issueLower));

    const results = await withConcurrencyLimit(
      featureCandidates.map((c) => async () => {
        const agentDir = join(homedir(), '.panopticon', 'agents', `agent-${c.issueLower}`);
        const planningDir = join(workspacesDir, c.name, '.planning');
        const [hasAgent, hasPlanning] = await Promise.all([
          pathExists(agentDir),
          pathExists(planningDir),
        ]);
        if (!hasAgent && !hasPlanning) return null;
        try {
          const workspacePath = join(workspacesDir, c.name);
          const sessions = await collectSessionTreeNodes(c.issueId, workspacePath, projectPath, effectiveSharedContext);
          if (sessions.length === 0) return null;
          const title = await resolveFeatureTitle(c.issueId, c.issueLower, project);
          return { issueId: c.issueId, title, sessions };
        } catch (err) {
          console.warn(`[fetchProjectSessionTree] Failed to process feature ${c.issueId}:`, err);
          return null;
        }
      }),
      15,
    );

    features.push(...results.filter((f): f is NonNullable<typeof f> => f !== null));
  }

  // Sort features by issueId for stable ordering
  features.sort((a, b) => a.issueId.localeCompare(b.issueId));

  return { projectKey, features };
}

// ─── Route: GET /api/session-trees ────────────────────────────────────────────

const getAllSessionTreesRoute = HttpRouter.add(
  'GET',
  '/api/session-trees',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url);
    const projectsParam = url.searchParams.get('projects') ?? '';
    const projectKeys = projectsParam.split(',').filter(Boolean);

    if (projectKeys.length === 0) {
      return jsonResponse({ trees: [] });
    }

    const results = yield* Effect.tryPromise({
      try: async () => {
        const allSessionsArr = await listSessionNamesAsync().catch(() => [] as string[]);
        const sharedTmuxSessionNames = new Set(allSessionsArr.filter(s => s.trim()));

        const sharedContext: ActivityContext = {
          tmuxSessionNames: sharedTmuxSessionNames,
        };

        return Promise.all(
          projectKeys.map(async (projectKey) => {
            const tree = await fetchProjectSessionTree(projectKey, sharedContext);
            return tree ?? { projectKey, features: [] };
          }),
        );
      },
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    return jsonResponse({ trees: results });
  })),
);

// ─── Compose route into a single Layer ────────────────────────────────────────

export const projectsRouteLayer = Layer.mergeAll(
  getProjectSessionTreeRoute,
  getAllSessionTreesRoute,
);

export default projectsRouteLayer;
