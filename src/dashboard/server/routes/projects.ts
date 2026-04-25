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
import { HttpRouter } from 'effect/unstable/http';

import { fetchActivityData } from './mission-control.js';
import { httpHandler } from './http-handler.js';
import { listProjects } from '../../../lib/projects.js';
import { extractPrefix } from '../../../lib/issue-id.js';
import { IssueDataService } from '../services/issue-data-service.js';
import type { AgentStatus, SessionNode, SessionNodePresence, SessionNodeType } from '@panopticon/contracts';

// ─── Shared IssueDataService (via singleton) ────────────────────────────────

function getIssueDataService(): IssueDataService {
  const { getSharedIssueService } = require('../services/issue-service-singleton.js');
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
    case 'completed': return 'stopped';
    case 'failed': return 'error';
    case 'suspended': return 'stopped';
    default: return 'unknown';
  }
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
  jsonlPath?: string;
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
    jsonlPath: section.jsonlPath,
  } as SessionNode;
}

async function resolveFeatureTitle(
  issueId: string,
  issueLower: string,
  issuePrefix: string,
): Promise<string> {
  // Try issue data service first
  try {
    const issueDataService = getIssueDataService();
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
  try {
    const projects = listProjects();
    for (const project of projects) {
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
    }
  } catch { /* non-fatal */ }

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

async function fetchProjectSessionTree(projectKey: string): Promise<unknown | null> {
  const projects = listProjects();
  const project = projects.find(p => p.key === projectKey);
  if (!project) return null;

  const projectPath = (project.config as { path: string }).path;
  const workspaceConfig = (project.config as { workspace?: { workspaces_dir?: string } }).workspace;
  const workspacesDir = join(projectPath, workspaceConfig?.workspaces_dir || 'workspaces');

  const features: Array<{
    issueId: string;
    title: string;
    sessions: SessionNode[];
  }> = [];

  if (await pathExists(workspacesDir)) {
    const entries = await readdir(workspacesDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('feature-')) continue;

      const issueLower = entry.name.replace('feature-', '');
      const issueId = issueLower.toUpperCase();
      const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];

      // Skip features with no activity data
      const agentDir = join(homedir(), '.panopticon', 'agents', `agent-${issueLower}`);
      const planningDir = join(workspacesDir, entry.name, '.planning');
      const hasAgent = await pathExists(agentDir);
      const hasPlanning = await pathExists(planningDir);
      if (!hasAgent && !hasPlanning) continue;

      try {
        const activityData = await fetchActivityData(issueId) as {
          issueId: string;
          sections: ActivitySection[];
        };

        if (!activityData.sections || activityData.sections.length === 0) continue;

        const title = await resolveFeatureTitle(issueId, issueLower, issuePrefix);
        const sessions = activityData.sections.map(mapSectionToSessionNode);

        features.push({ issueId, title, sessions });
      } catch {
        // Skip features that fail to load activity data
        continue;
      }
    }
  }

  // Sort features by issueId for stable ordering
  features.sort((a, b) => a.issueId.localeCompare(b.issueId));

  return { projectKey, features };
}

// ─── Compose route into a single Layer ────────────────────────────────────────

export const projectsRouteLayer = Layer.mergeAll(
  getProjectSessionTreeRoute,
);

export default projectsRouteLayer;
