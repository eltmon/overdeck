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
import {
  resolveProjectFromIssueSync,
  listProjectsSync,
  getProjectSync,
  setProjectAutoMergeDefaultSync,
  setProjectMergeTrainSync,
} from '../../../lib/projects.js';
import { isMergeTrainEnabledForProject } from '../../../lib/cloister/auto-merge-policy.js';
import { extractPrefixSync } from '../../../lib/issue-id.js';
import { listSessionNames } from '../../../lib/tmux.js';
import { withConcurrencyLimit } from '../../../lib/concurrency.js';
import { ReadModelService } from '../read-model.js';
import type { AgentSnapshot, SessionNode, SessionNodePresence, SessionNodeType } from '@panctl/contracts';
import { normalizeAgentStatus } from '../services/agent-status.js';
import { deriveSessionPresence } from '../services/session-presence.js';
import { getAgentRuntimeState } from '../../../lib/agents.js';
import { detectAwaitingInputForAgent, type AwaitingInputDetection } from '../../../lib/agent-input-detection.js';
import { getTmuxSessionName } from '../../../lib/cloister/specialists.js';
import { getReviewStatusSync } from '../review-status.js';
import { resolveJsonlPath } from './jsonl-resolver.js';
import { buildReviewerNodes, readSynthesisRounds, type ReviewerRoundMetadata } from './reviewer-tree.js';
import { PAN_CONTINUE_FILENAME, PAN_DIRNAME } from '../../../lib/pan-dir/index.js';
import { findSpecByIssue } from '../../../lib/pan-dir/specs.js';
import { buildIssueTitleMap, sanitizeDisplayTitle } from '../services/issue-title-map.js';

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

interface ActivityContext {
  tmuxSessionNames?: Set<string>;
  issueTitles?: ReadonlyMap<string, string>;
  agentSnapshotsById?: ReadonlyMap<string, AgentSnapshot>;
}

function awaitingInputFromProjection(
  agentId: string,
  agentSnapshotsById?: ReadonlyMap<string, AgentSnapshot>,
): AwaitingInputDetection | null | undefined {
  const agent = agentSnapshotsById?.get(agentId);
  if (!agent) return undefined;
  if (agent.hasPendingQuestion !== true) return null;
  return {
    reason: (agent.pendingQuestionReason as AwaitingInputDetection['reason'] | undefined) ?? 'other',
    prompt: agent.pendingQuestionPrompt || 'Agent is waiting for human input',
  };
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
  agentSnapshotsById?: ReadonlyMap<string, AgentSnapshot>;
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

/** Read the pause gate from an agent's state.json (PAN-1779): specialist
 *  sessions are built from review history, not state, so the gate must be
 *  looked up separately for them. Returns {} when not paused. */
async function readSessionPauseFields(
  sessionId: string,
): Promise<{ paused?: true; pausedReason?: string; pausedAt?: string }> {
  const stateText = await readOptional(join(homedir(), '.panopticon', 'agents', sessionId, 'state.json'));
  if (!stateText) return {};
  try {
    const s = JSON.parse(stateText) as { paused?: boolean; pausedReason?: string; pausedAt?: string };
    if (s.paused === true) return { paused: true, pausedReason: s.pausedReason, pausedAt: s.pausedAt };
  } catch { /* malformed state — treat as unpaused */ }
  return {};
}

async function collectSessionTreeNodes(
  issueId: string,
  workspacePath: string,
  projectPath: string,
  context: SessionTreeContext,
): Promise<SessionNode[]> {
  const issueLower = issueId.toLowerCase();
  const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
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
      const state = JSON.parse(stateText) as { model?: string; startedAt?: string; createdAt?: string; status?: string; deliveryMethod?: 'auto' | 'channels' | 'tmux'; paused?: boolean; pausedReason?: string; pausedAt?: string };
      const isPlanning = checkId.startsWith('planning-');
      const sectionType = isPlanning ? 'planning' : 'work';
      if (isPlanning) hasPlanningSection = true;
      const rtState = await Effect.runPromise(getAgentRuntimeState(checkId));
      const presence = await deriveSessionPresence(checkId, rtState, context.tmuxSessionNames);
      const projectedAwaitingInput = awaitingInputFromProjection(checkId, context.agentSnapshotsById);
      const awaitingInput = projectedAwaitingInput !== undefined
        ? projectedAwaitingInput
        : context.tmuxSessionNames.has(checkId)
          ? await Effect.runPromise(detectAwaitingInputForAgent(checkId, { isPlanning }))
          : null;
      const sessionWorkspacePath = getSessionTreeWorkspacePath(issueLower, workspacePath, projectPath, checkId);
      const jsonlPath = await resolveJsonlPath(checkId, sessionWorkspacePath);
      sections.push({
        type: sectionType,
        sessionId: checkId,
        tmuxSession: sectionType === 'work' || sectionType === 'planning' ? checkId : undefined,
        model: state.model || 'unknown',
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
        awaitingInput: awaitingInput !== null,
        awaitingInputPrompt: awaitingInput?.prompt,
        awaitingInputReason: awaitingInput?.reason,
        hasJsonl: !!jsonlPath,
        deliveryMethod: state.deliveryMethod,
        paused: state.paused === true ? true : undefined,
        pausedReason: state.paused === true ? state.pausedReason : undefined,
        pausedAt: state.paused === true ? state.pausedAt : undefined,
      });
    } catch {
      // skip malformed state
    }
  }

  if (!hasPlanningSection) {
    const panContinuePath = join(workspacePath, PAN_DIRNAME, PAN_CONTINUE_FILENAME);
    const planningPathForTimestamp = await pathExists(panContinuePath)
      ? panContinuePath
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

  const centralStatus = getReviewStatusSync(issueId.toUpperCase());
  if (centralStatus?.history && centralStatus.history.length > 0) {
    const reviewEntries = centralStatus.history.filter((entry) => entry.type === 'review');
    const latestReview = reviewEntries[reviewEntries.length - 1];
    if (latestReview) {
      const resolvedProject = resolveProjectFromIssueSync(issueId);
      const reviewerProjectKey = resolvedProject?.projectKey ?? issuePrefix.toLowerCase();
      const synthesisRoundMetadata = await readSynthesisRounds(issueId, reviewerProjectKey);
      // PAN-1048: review orchestrator uses spawnRun naming — agent-<issue>-review
      const orchestratorSessionName = `agent-${issueLower}-review`;
      const orchestratorPresence: SessionNodePresence = context.tmuxSessionNames.has(orchestratorSessionName)
        ? (latestReview.status === 'reviewing' ? 'active' : 'idle')
        : 'ended';
      const orchestratorJsonlPath = await resolveJsonlPath(orchestratorSessionName, workspacePath);
      sections.push({
        type: 'review',
        sessionId: orchestratorSessionName,
        model: 'specialist',
        startedAt: latestReview.timestamp,
        endedAt: undefined,
        duration: 0,
        status: normalizeAgentStatus(latestReview.status === 'reviewing' ? 'running' : latestReview.status),
        presence: orchestratorPresence,
        roundMetadata: synthesisRoundMetadata as SessionNode['roundMetadata'],
        hasJsonl: !!orchestratorJsonlPath,
        tmuxSession: orchestratorSessionName,
        ...(await readSessionPauseFields(orchestratorSessionName)),
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
      sections.push(...(reviewerNodes as unknown as SessionNode[]));
    }

    // Test role — one canonical session (`agent-<issue>-test`) reused across
    // rounds, so emit a single node anchored to the latest `test` history
    // entry, the same way review uses latestReview.
    const testEntries = centralStatus.history.filter((entry) => entry.type === 'test');
    const latestTest = testEntries[testEntries.length - 1];
    if (latestTest) {
      const testSessionName = `agent-${issueLower}-test`;
      const testIsLive = context.tmuxSessionNames.has(testSessionName);
      const testJsonlPath = await resolveJsonlPath(testSessionName, workspacePath);
      sections.push({
        type: 'test',
        sessionId: testSessionName,
        model: 'specialist',
        startedAt: latestTest.timestamp,
        endedAt: undefined,
        duration: 0,
        status: normalizeAgentStatus(latestTest.status === 'testing' ? 'running' : latestTest.status),
        presence: testIsLive ? (latestTest.status === 'testing' ? 'active' : 'idle') : 'ended',
        hasJsonl: !!testJsonlPath,
        tmuxSession: testIsLive ? testSessionName : undefined,
        ...(await readSessionPauseFields(testSessionName)),
      });
    }

    // Merge/ship history — server-side shipping now prepares the branch, while
    // historical `merge` entries still surface under the `ship` node identity.
    const mergeEntries = centralStatus.history.filter((entry) => entry.type === 'merge');
    const latestMerge = mergeEntries[mergeEntries.length - 1];
    if (latestMerge) {
      const shipSessionName = `agent-${issueLower}-ship`;
      const shipIsLive = context.tmuxSessionNames.has(shipSessionName);
      const shipJsonlPath = await resolveJsonlPath(shipSessionName, workspacePath);
      sections.push({
        type: 'ship',
        sessionId: shipSessionName,
        model: 'specialist',
        startedAt: latestMerge.timestamp,
        endedAt: undefined,
        duration: 0,
        status: normalizeAgentStatus(latestMerge.status === 'merging' ? 'running' : latestMerge.status),
        presence: shipIsLive ? (latestMerge.status === 'merging' ? 'active' : 'idle') : 'ended',
        hasJsonl: !!shipJsonlPath,
        tmuxSession: shipIsLive ? shipSessionName : undefined,
        ...(await readSessionPauseFields(shipSessionName)),
      });
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
      const entry = await Effect.runPromise(findSpecByIssue(projectPath, issueId));
      if (entry) {
        const specContent = await readOptional(entry.path);
        if (specContent) {
          const parsed = JSON.parse(specContent) as { plan?: { title?: string } };
          const title = sanitizeDisplayTitle(parsed.plan?.title ?? '');
          if (title) return title;
        }
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
    const readModel = yield* ReadModelService;
    const projectKey = params['projectKey'] ?? '';
    const snapshot = yield* readModel.getSnapshot;
    const agentSnapshotsById = new Map(snapshot.agents.map((agent) => [agent.id, agent]));

    const result = yield* Effect.tryPromise({
      try: () => fetchProjectSessionTree(projectKey, { agentSnapshotsById }),
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
  const projects = listProjectsSync();
  const project = projects.find(p =>
    p.key === projectKey || (p.config as { name?: string }).name === projectKey
  );
  if (!project) return null;

  const projectPath = (project.config as { path: string }).path;
  const workspaceConfig = (project.config as { workspace?: { workspaces_dir?: string } }).workspace;
  const workspacesDir = join(projectPath, workspaceConfig?.workspaces_dir || 'workspaces');

  // Reuse shared request-scoped data when provided; otherwise fetch lazily.
  const sharedTmuxSessionNames = sharedContext?.tmuxSessionNames
    ?? new Set((await Effect.runPromise(listSessionNames()).catch(() => [] as string[])).filter(s => s.trim()));

  const effectiveSharedContext: SessionTreeContext = {
    tmuxSessionNames: sharedTmuxSessionNames,
    agentSnapshotsById: sharedContext?.agentSnapshotsById,
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

    const results = await Effect.runPromise(withConcurrencyLimit(
      featureCandidates.map((c) => Effect.promise(async () => {
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
      })),
      15,
    ));

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
    const readModel = yield* ReadModelService;
    const snapshot = yield* readModel.getSnapshot;
    const agentSnapshotsById = new Map(snapshot.agents.map((agent) => [agent.id, agent]));

    if (projectKeys.length === 0) {
      return jsonResponse({ trees: [] });
    }

    const results = yield* Effect.tryPromise({
      try: async () => {
        const allSessionsArr = await Effect.runPromise(listSessionNames()).catch(() => [] as string[]);
        const sharedTmuxSessionNames = new Set(allSessionsArr.filter(s => s.trim()));

        const issueTitles = await buildIssueTitleMap();
        const sharedContext: ActivityContext = {
          tmuxSessionNames: sharedTmuxSessionNames,
          issueTitles,
          agentSnapshotsById,
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

const readProjectJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
});

// ─── Route: GET /api/projects/:projectKey/auto-merge-default ─────────────────
const getProjectAutoMergeDefaultRoute = HttpRouter.add(
  'GET',
  '/api/projects/:projectKey/auto-merge-default',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const config = getProjectSync(params['projectKey'] ?? '');
    if (!config) return jsonResponse({ error: 'Project not found' }, { status: 404 });
    return jsonResponse({ value: config.auto_merge_default ?? null });
  })),
);

// ─── Route: POST /api/projects/:projectKey/auto-merge-default ────────────────
// PAN-1695: set the per-project auto-merge default ('auto' | 'hold' | null=clear).
const postProjectAutoMergeDefaultRoute = HttpRouter.add(
  'POST',
  '/api/projects/:projectKey/auto-merge-default',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const key = params['projectKey'] ?? '';
    if (!getProjectSync(key)) return jsonResponse({ error: 'Project not found' }, { status: 404 });
    const body = (yield* readProjectJsonBody) as { value?: unknown };
    const v = body.value;
    if (v !== 'auto' && v !== 'hold' && v !== null) {
      return jsonResponse({ error: "value must be 'auto', 'hold', or null" }, { status: 400 });
    }
    setProjectAutoMergeDefaultSync(key, v);
    return jsonResponse({ value: v });
  })),
);

// ─── Route: GET /api/projects/:projectKey/merge-train ───────────────────────
const getProjectMergeTrainRoute = HttpRouter.add(
  'GET',
  '/api/projects/:projectKey/merge-train',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const key = params['projectKey'] ?? '';
    const config = getProjectSync(key);
    if (!config) return jsonResponse({ error: 'Project not found' }, { status: 404 });
    return jsonResponse({
      value: config.merge_train ?? null,
      effective: isMergeTrainEnabledForProject(key),
    });
  })),
);

// ─── Route: POST /api/projects/:projectKey/merge-train ──────────────────────
const postProjectMergeTrainRoute = HttpRouter.add(
  'POST',
  '/api/projects/:projectKey/merge-train',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const key = params['projectKey'] ?? '';
    if (!getProjectSync(key)) return jsonResponse({ error: 'Project not found' }, { status: 404 });
    const body = (yield* readProjectJsonBody) as { value?: unknown };
    const v = body.value;
    if (v !== 'enabled' && v !== 'disabled' && v !== null) {
      return jsonResponse({ error: "value must be 'enabled', 'disabled', or null" }, { status: 400 });
    }
    setProjectMergeTrainSync(key, v);
    return jsonResponse({ value: v, effective: isMergeTrainEnabledForProject(key) });
  })),
);

export const projectsRouteLayer = Layer.mergeAll(
  getProjectSessionTreeRoute,
  getAllSessionTreesRoute,
  getProjectAutoMergeDefaultRoute,
  postProjectAutoMergeDefaultRoute,
  getProjectMergeTrainRoute,
  postProjectMergeTrainRoute,
);

export default projectsRouteLayer;
