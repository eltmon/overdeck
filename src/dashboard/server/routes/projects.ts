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
import type { SessionNode, SessionNodePresence, SessionNodeType } from '@panctl/contracts';
import { normalizeAgentStatus } from '../services/agent-status.js';
import { deriveSessionPresence } from '../services/session-presence.js';
import { getAgentRuntimeStateAsync } from '../../../lib/agents.js';
import { getTmuxSessionName } from '../../../lib/cloister/specialists.js';
import { getReviewStatus } from '../review-status.js';
import { resolveJsonlPath } from './jsonl-resolver.js';
import { buildReviewerNodes, type ReviewerRoundMetadata } from './reviewer-tree.js';
import { PAN_CONTINUE_FILENAME, PAN_DIRNAME, PAN_SPEC_FILENAME } from '../../../lib/pan-dir/index.js';

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

function sanitizeDisplayTitle(title: string): string {
  return title
    .replace(/<!--\s*panopticon:[\s\S]*?-->/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ActivityContext {
  tmuxSessionNames?: Set<string>;
  issueTitles?: ReadonlyMap<string, string>;
}

const LEGACY_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Hide stopped legacy sessions older than 24h from the Command Deck tree.
 *  These are typically synthetic planning placeholders or stale
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSlotWorkSessionPattern(issueLower: string): RegExp {
  return new RegExp(`^agent-${escapeRegExp(issueLower)}-(\\d+)$`, 'i');
}

export function getSlotWorkSessionNumber(sessionId: string, issueLower: string): number | null {
  const match = sessionId.match(getSlotWorkSessionPattern(issueLower));
  if (!match) return null;
  return Number.parseInt(match[1]!, 10);
}

export function getSessionTreeWorkspacePath(
  issueLower: string,
  baseWorkspacePath: string,
  projectPath: string,
  sessionId: string,
): string {
  const slotNumber = getSlotWorkSessionNumber(sessionId, issueLower);
  if (slotNumber === null) return baseWorkspacePath;
  return join(projectPath, 'workspaces', `feature-${issueLower}-slot-${slotNumber}`);
}

export function compareSessionTreeSessionIds(a: string, b: string, issueLower: string): number {
  const planningAgentId = `planning-${issueLower}`;
  const workAgentId = `agent-${issueLower}`;
  const rank = (sessionId: string): [number, number, string] => {
    if (sessionId === planningAgentId) return [0, 0, sessionId];
    if (sessionId === workAgentId) return [1, 0, sessionId];
    const slotNumber = getSlotWorkSessionNumber(sessionId, issueLower);
    if (slotNumber !== null) return [2, slotNumber, sessionId];
    return [3, 0, sessionId];
  };

  const [aRank, aSlot, aId] = rank(a);
  const [bRank, bSlot, bId] = rank(b);
  if (aRank !== bRank) return aRank - bRank;
  if (aSlot !== bSlot) return aSlot - bSlot;
  return aId.localeCompare(bId);
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
  const slotWorkSessionPattern = getSlotWorkSessionPattern(issueLower);
  const sections: SessionNode[] = [];
  let hasPlanningSection = false;

  const candidateSessionIds = new Set<string>([planningAgentId, agentId]);
  const agentEntries = await readdir(agentsDir, { withFileTypes: true }).catch(() => []);

  for (const entry of agentEntries) {
    if (!entry.isDirectory()) continue;
    if (slotWorkSessionPattern.test(entry.name)) {
      candidateSessionIds.add(entry.name);
    }
  }

  for (const sessionName of context.tmuxSessionNames) {
    if (slotWorkSessionPattern.test(sessionName)) {
      candidateSessionIds.add(sessionName);
    }
  }

  for (const checkId of [...candidateSessionIds].sort((a, b) => compareSessionTreeSessionIds(a, b, issueLower))) {
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
      const sessionWorkspacePath = getSessionTreeWorkspacePath(issueLower, workspacePath, projectPath, checkId);
      const jsonlPath = await resolveJsonlPath(checkId, sessionWorkspacePath);
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
              return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
            })()
          : null,
        status: normalizeAgentStatus(
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
    const panContinuePath = join(workspacePath, PAN_DIRNAME, PAN_CONTINUE_FILENAME);
    const panSpecPath = join(workspacePath, PAN_DIRNAME, PAN_SPEC_FILENAME);
    const planningPathForTimestamp = await pathExists(panContinuePath)
      ? panContinuePath
      : await pathExists(panSpecPath)
        ? panSpecPath
        : null;
    if (planningPathForTimestamp) {
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
        status: normalizeAgentStatus(latestReview.status === 'reviewing' ? 'running' : latestReview.status),
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
        status: normalizeAgentStatus(latestReview.status === 'reviewing' ? 'running' : latestReview.status),
      });
      sections.push(...reviewerNodes);
    }
  }

  return sections.filter((s) => !isStaleLegacySession(s));
}

async function resolveFeatureTitle(
  issueId: string,
  issueLower: string,
  issueTitles: ReadonlyMap<string, string>,
  project?: { config: { path: string; workspace?: { workspaces_dir?: string } } },
): Promise<string> {
  const mappedTitle = issueTitles.get(issueId) ?? issueTitles.get(issueId.toLowerCase());
  if (mappedTitle) {
    return mappedTitle;
  }

  if (project) {
    try {
      const projectPath = (project.config as { path: string }).path;
      const workspaceConfig = (project.config as { workspace?: { workspaces_dir?: string } }).workspace;
      const workspacesDir = join(projectPath, workspaceConfig?.workspaces_dir || 'workspaces');
      const specContent = await readOptional(
        join(workspacesDir, `feature-${issueLower}`, PAN_DIRNAME, PAN_SPEC_FILENAME),
      );
      if (specContent) {
        const parsed = JSON.parse(specContent) as { plan?: { title?: string } };
        const title = sanitizeDisplayTitle(parsed.plan?.title ?? '');
        if (title) return title;
      }
    } catch { /* non-fatal */ }
  }

  return '';
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

const ISSUE_TITLE_MAP_TTL_MS = 30_000;
let issueTitleMapCache: { timestamp: number; data: ReadonlyMap<string, string> } | null = null;

async function buildIssueTitleMap(): Promise<ReadonlyMap<string, string>> {
  if (issueTitleMapCache && issueTitleMapCache.timestamp > Date.now() - ISSUE_TITLE_MAP_TTL_MS) {
    return issueTitleMapCache.data;
  }

  const issueTitles = new Map<string, string>();
  try {
    const issueDataService = await getIssueDataService();
    const allIssues = issueDataService.getIssues() as Array<Record<string, unknown>>;
    for (const issue of allIssues) {
      const identifier = typeof issue['identifier'] === 'string' ? issue['identifier'] : null;
      const title = typeof issue['title'] === 'string' ? sanitizeDisplayTitle(issue['title']) : '';
      if (!identifier || !title) continue;
      issueTitles.set(identifier, title);
      issueTitles.set(identifier.toLowerCase(), title);
    }
  } catch {
    // non-fatal: callers fall back to planning prompt or issue id
  }

  issueTitleMapCache = { timestamp: Date.now(), data: issueTitles };
  return issueTitles;
}

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
  const issueTitles = sharedContext?.issueTitles ?? await buildIssueTitleMap();

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
        const panDir = join(workspacesDir, c.name, PAN_DIRNAME);
        const [hasAgent, hasPlanning] = await Promise.all([
          pathExists(agentDir),
          pathExists(panDir),
        ]);
        if (!hasAgent && !hasPlanning) return null;
        try {
          const workspacePath = join(workspacesDir, c.name);
          const sessions = await collectSessionTreeNodes(c.issueId, workspacePath, projectPath, effectiveSharedContext);
          if (sessions.length === 0) return null;
          const title = await resolveFeatureTitle(c.issueId, c.issueLower, issueTitles, project);
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
    const url = new URL(request.url, 'http://localhost');
    const projectsParam = url.searchParams.get('projects') ?? '';
    const projectKeys = projectsParam.split(',').filter(Boolean);

    if (projectKeys.length === 0) {
      return jsonResponse({ trees: [] });
    }

    const results = yield* Effect.tryPromise({
      try: async () => {
        const allSessionsArr = await listSessionNamesAsync().catch(() => [] as string[]);
        const sharedTmuxSessionNames = new Set(allSessionsArr.filter(s => s.trim()));

        const issueTitles = await buildIssueTitleMap();
        const sharedContext: ActivityContext = {
          tmuxSessionNames: sharedTmuxSessionNames,
          issueTitles,
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
