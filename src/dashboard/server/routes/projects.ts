import { jsonResponse } from "../http-helpers.js";
/**
 * Projects route module — Effect HttpRouter.Layer (PAN-821)
 *
 * Implements:
 *   GET /api/projects/:projectKey/session-tree
 */

import { access, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { httpHandler } from './http-handler.js';
import { listProjects } from '../../../lib/projects.js';
import { extractPrefix } from '../../../lib/issue-id.js';
import { listSessionNamesAsync } from '../../../lib/tmux.js';
import { withConcurrencyLimit } from '../../../lib/concurrency.js';
import { IssueDataService } from '../services/issue-data-service.js';
import type { AgentStatus, SessionNode, SessionNodePresence, SessionNodeType } from '@panctl/contracts';
import type { ReviewerRoundMetadata } from './reviewer-tree.js';

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
    case 'active': return 'running';
    case 'completed': return 'stopped';
    case 'failed': return 'error';
    case 'suspended': return 'stopped';
    default: return 'unknown';
  }
}

interface ActivityContext {
  tmuxSessionNames?: Set<string>;
  taskFileContents?: Map<string, string>;
}

interface ActivitySection {
  type: string;
  role?: string;
  sessionId: string;
  tmuxSession?: string;
  model: string;
  startedAt: string;
  endedAt?: string;
  duration: number | null;
  status: string;
  transcript?: string;
  presence: SessionNodePresence;
  hasJsonl?: boolean;
  roundMetadata?: ReviewerRoundMetadata;
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

function mapSectionToSessionNode(section: ActivitySection): SessionNode {
  return {
    type: mapSessionType(section.type),
    role: section.role,
    sessionId: section.sessionId,
    tmuxSession: section.tmuxSession,
    model: section.model,
    startedAt: section.startedAt,
    endedAt: section.endedAt,
    duration: section.duration ?? 0,
    status: mapAgentStatus(section.status),
    transcript: section.transcript,
    presence: section.presence,
    hasJsonl: section.hasJsonl,
    roundMetadata: section.roundMetadata,
  };
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

export async function fetchProjectSessionTree(projectKey: string): Promise<unknown | null> {
  const projects = listProjects();
  const project = projects.find(p =>
    p.key === projectKey || (p.config as { name?: string }).name === projectKey
  );
  if (!project) return null;

  const projectPath = (project.config as { path: string }).path;
  const workspaceConfig = (project.config as { workspace?: { workspaces_dir?: string } }).workspace;
  const workspacesDir = join(projectPath, workspaceConfig?.workspaces_dir || 'workspaces');

  // Hoist shared subprocess calls once per request (PAN-821 review)
  const allSessionsArr = await listSessionNamesAsync().catch(() => [] as string[]);
  const sharedTmuxSessionNames = new Set(allSessionsArr.filter(s => s.trim()));

  const tasksDir = join(homedir(), '.panopticon', 'specialists', 'tasks');
  const sharedTaskFileContents = new Map<string, string>();
  if (await pathExists(tasksDir)) {
    const filenames = (await readdir(tasksDir).catch(() => [] as string[])).filter(f => f.endsWith('.md'));
    await Promise.all(filenames.map(async (f) => {
      const content = await readOptional(join(tasksDir, f));
      if (content) sharedTaskFileContents.set(f, content);
    }));
  }

  const sharedContext: ActivityContext = {
    tmuxSessionNames: sharedTmuxSessionNames,
    taskFileContents: sharedTaskFileContents,
  };

  // Dynamic import breaks static dependency cycle with command-deck.ts (PAN-821)
  // Without this, rolldown bundles projects.ts after server.ts, causing
  // ReferenceError: projectsRouteLayer is not defined at startup.
  const { fetchActivityDataWithContext } = await import('./command-deck.js');

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
          const activityData = await fetchActivityDataWithContext(c.issueId, sharedContext) as {
            issueId: string;
            sections: ActivitySection[];
          };
          if (!activityData.sections || activityData.sections.length === 0) return null;
          const title = await resolveFeatureTitle(c.issueId, c.issueLower, project);
          const allSessions = activityData.sections.map(mapSectionToSessionNode);
          const sessions = allSessions.filter(s => !isStaleLegacySession(s));
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
    const url = new URL(request.url, 'http://localhost');
    const projectsParam = url.searchParams.get('projects') ?? '';
    const projectKeys = projectsParam.split(',').filter(Boolean);

    if (projectKeys.length === 0) {
      return jsonResponse({ trees: [] });
    }

    const results = yield* Effect.tryPromise({
      try: () =>
        Promise.all(
          projectKeys.map(async (projectKey) => {
            const tree = await fetchProjectSessionTree(projectKey);
            return tree ?? { projectKey, features: [] };
          }),
        ),
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
