import { jsonResponse } from "../http-helpers.js";
/** Projects route module — Effect HttpRouter.Layer (PAN-821). */

import { access, readFile, readdir, mkdir, stat, realpath } from 'node:fs/promises';
import { join, isAbsolute, sep, resolve, normalize, dirname, relative } from 'node:path';
import { homedir } from 'node:os';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { httpHandler } from './http-handler.js';
import { postProjectRenameRoute } from './project-rename.js';
import {
  resolveProjectFromIssueSync,
  listProjectsSync,
  getProjectSync,
  setProjectAutoMergeDefault,
  setProjectSwarmPolicy,
  validateVersionSyncConfig,
  type ProjectConfig,
  type VersionSyncConfig,
} from '../../../lib/projects.js';
import { resolveSwarmPolicy } from '../../../lib/swarm-policy.js';
import type { SwarmPolicyLayer } from '../../../lib/swarm-policy.js';
import { setProjectVersionSync } from '../../../lib/projects-writer.js';
import { listUatGenerationsSync, type UatGeneration } from '../../../lib/overdeck/merge-sync.js';
import { loadConfigSync } from '../../../lib/config-yaml.js';
import { resolveImplicitStaffing } from '../../../lib/agents/staffing.js';
import { resolveTieredExecutionBlock } from '../../../lib/agents/tier-table.js';
import { registerProjectFromPath, DuplicateProjectError } from '../../../lib/project-registration.js';
import {
  resolveProjectCreateIntent,
  toPublicProjectIntent,
  type ProjectCreateInput,
  type ResolvedProjectIntent,
} from '../../../lib/projects/create.js';
import { projectCreateJobRoutesLayer } from './project-create-routes.js';
import { readProjectJsonBody } from './project-body.js';
import {
  rejectUnauthorizedDashboardRequest,
  rejectUnsafeDashboardMutationRequest,
} from './dashboard-auth.js';

import { extractPrefixSync } from '../../../lib/issue-id.js';
import { listSessionNames } from '../../../lib/tmux.js';
import { withConcurrencyLimit } from '../../../lib/concurrency.js';
import { IssueDataService } from '../services/issue-data-service.js';
import { ReadModelService } from '../read-model.js';
import { compareIssueIds, type AgentSnapshot, type SessionNode, type SessionNodeType } from '@overdeck/contracts';
import { normalizeAgentStatus } from '../services/agent-status.js';
import { buildLintSessionNode } from './command-deck-lint-node.js';
import { getBackendPanesForIssue } from '../services/backend-inventory.js';
import { getDerivedIssueState } from '../services/derived-issue-state.js';
import { getShipLog } from '../../../lib/cloister/ship-log.js';
import { deriveSessionPresence } from '../services/session-presence.js';
import { getAgentRuntimeState, getAgentStateSync } from '../../../lib/agents.js';
import { enrichSessionsWithModelOrigin } from '../services/model-origin-enrich.js';
import { detectAwaitingInputForAgent } from '../../../lib/agent-input-detection.js';
import { getTmuxSessionName } from '../../../lib/cloister/specialists.js';
import { resolveJsonlPath } from './jsonl-resolver.js';
import type { ReviewerRoundMetadata } from './reviewer-tree.js';
import {
  awaitingInputFromProjection,
  buildSpecialistSessionNodes,
} from './session-tree-specialists.js';
import { PAN_CONTINUE_FILENAME, PAN_DIRNAME, WORKSPACE_RUNTIME_DIRNAME } from '../../../lib/pan-dir/index.js';
import { isPlanningComplete } from '../../../lib/xbrief/io.js';
import { findSpecByIssueThroughOverdeck } from '../../../lib/overdeck/specs.js';
import { findSpecByIssue } from '../../../lib/pan-dir/specs.js';
import { getOverdeckHome } from '../../../lib/paths.js';
import { parseIssueIdFromTextSync } from '../../../lib/resource-utils.js';
import { isDiscoverableAgentSession } from '../services/resource-discovery.js';

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
    'planning', 'work', 'knowledge', 'strike', 'review', 'reviewer', 'test', 'merge', 'legacy',
  ];
  return (validTypes.includes(type as SessionNodeType) ? type : 'legacy') as SessionNodeType;
}

function sanitizeDisplayTitle(title: string): string {
  return title
    .replace(/<!--\s*overdeck:[\s\S]*?-->/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ActivityContext {
  tmuxSessionNames?: Set<string>;
  issueTitles?: ReadonlyMap<string, string>;
  agentSnapshotsById?: ReadonlyMap<string, AgentSnapshot>;
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
  return new RegExp(`^agent-${escapeRegExp(issueLower)}-slot-(\\d+)$`, 'i');
}

function issueIdsWithLiveTmuxSessions(sessionNames: ReadonlySet<string>): Set<string> {
  const issueIds = new Set<string>();
  for (const sessionName of sessionNames) {
    if (!isDiscoverableAgentSession(sessionName)) continue;
    const issueId = parseIssueIdFromTextSync(sessionName);
    if (issueId) issueIds.add(issueId.toLowerCase());
  }
  return issueIds;
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
  if (sessionId.toLowerCase() === `strike-${issueLower.toLowerCase()}`) return join(projectPath, 'workspaces', `feature-${issueLower}-strike`);
  const slotNumber = getSlotWorkSessionNumber(sessionId, issueLower);
  return slotNumber === null ? baseWorkspacePath : join(projectPath, 'workspaces', `feature-${issueLower}-slot-${slotNumber}`);
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
  const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
  const agentsDir = join(getOverdeckHome(), 'agents');
  const agentId = `agent-${issueLower}`;
  const planningAgentId = `planning-${issueLower}`;
  const planRunAgentId = `agent-${issueLower}-plan`;
  const strikeAgentId = `strike-${issueLower}`;
  const knowledgeAgentId = `agent-${issueLower}-knowledge`;
  const slotWorkSessionPattern = getSlotWorkSessionPattern(issueLower);
  const sections: SessionNode[] = [];
  let hasPlanningSection = false;

  // Resolve once per request: canonical spec exists and planning has finished.
  const planningFinished = await Effect.runPromise(
    isPlanningComplete(workspacePath).pipe(Effect.orElseSucceed(() => false)),
  );

  const candidateSessionIds = new Set<string>([
    planningAgentId,
    agentId,
    planRunAgentId,
    strikeAgentId,
    knowledgeAgentId,
  ]);
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
    // PAN-1908: the agents registry decides whether a session exists — never
    // the ~/.overdeck/agents/<id>/ dir, which janitors remove after sessions end.
    const state = getAgentStateSync(checkId);
    if (!state) continue;

    try {
      const isPlanning = checkId.startsWith('planning-') || state.role === 'plan';
      const isStrike = checkId.startsWith('strike-');
      const sectionType: SessionNodeType = isPlanning
        ? 'planning'
        : isStrike
          ? 'strike'
          : state.role === 'knowledge'
            ? 'knowledge'
            : 'work';
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

      // Terminal-end signal: endedAt is populated only when the session has
      // actually ended. duration is preserved as elapsed seconds for existing UI.
      const tmuxAlive = context.tmuxSessionNames.has(checkId);
      const sessionEnded = rtState?.state === 'suspended'
        || presence === 'ended'
        || (!!state.stoppedAt && !tmuxAlive);
      const endedAt = sessionEnded
        ? (state.stoppedAt || state.lastActivity || state.startedAt)
        : undefined;

      sections.push({
        type: sectionType,
        sessionId: checkId,
        tmuxSession: sectionType === 'work' || sectionType === 'planning' || sectionType === 'strike' || sectionType === 'knowledge' ? checkId : undefined,
        model: state.model || 'unknown',
        startedAt: state.startedAt || new Date().toISOString(),
        endedAt,
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
        pendingInputKinds: context.agentSnapshotsById?.get(checkId)?.pendingInputKinds,
        hasJsonl: !!jsonlPath,
        harness: state.harness,
        deliveryMethod: state.deliveryMethod,
        planningComplete: isPlanning ? planningFinished : undefined,
      });
    } catch {
      // skip malformed state
    }
  }

  // Synthesize a planning node for a live tmux planning session even when the
  // agent state dir is missing or unreadable. This catches the PAN-2597 case
  // where only planning-<issue> (or agent-<issue>-plan) exists in tmux.
  if (!hasPlanningSection) {
    const planningTmuxId = context.tmuxSessionNames.has(planningAgentId)
      ? planningAgentId
      : context.tmuxSessionNames.has(planRunAgentId)
        ? planRunAgentId
        : null;
    if (planningTmuxId) {
      const jsonlPath = await resolveJsonlPath(planningTmuxId, workspacePath);
      const jsonlStat = jsonlPath ? await stat(jsonlPath).catch(() => null) : null;
      const stableStartedAt = jsonlStat
        ? (jsonlStat.birthtimeMs > 0 ? jsonlStat.birthtime : jsonlStat.mtime).toISOString()
        : new Date(0).toISOString();
      const presence = await deriveSessionPresence(planningTmuxId, null, context.tmuxSessionNames);
      sections.push({
        type: 'planning',
        sessionId: planningTmuxId,
        model: 'unknown',
        startedAt: stableStartedAt,
        duration: null,
        status: 'running',
        presence,
        hasJsonl: !!jsonlPath,
        tmuxSession: planningTmuxId,
        planningComplete: planningFinished,
      });
      hasPlanningSection = true;
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

  // PAN-3917 FR-6: there is no central review-status record. Specialist rows
  // are the issue's own panes plus the PR's review state; the ship row comes
  // from the in-memory ship log the merge writes as it runs.
  const shipLog = getShipLog(issueId.toUpperCase());
  const [treeDerived, treePanes] = await Promise.all([
    getDerivedIssueState(issueId),
    getBackendPanesForIssue(issueId),
  ]);

  // Lint node (PAN-2665): the verification quality-gate run, shown between
  // Work and Review (TYPE_PRIORITY orders it client-side). Unlike agent nodes
  // this one has no JSONL/tmux backing, so SessionPanel renders its transcript
  // — include it here (bounded: gate table + ≤2KB tail per failing gate).
  const lintSection = buildLintSessionNode({
    workspacePath,
    issueLower,
    includeTranscripts: true,
  });
  if (lintSection) {
    sections.push({
      ...lintSection,
      status: normalizeAgentStatus(lintSection.status),
    });
  }

  sections.push(...await buildSpecialistSessionNodes({
    issueId,
    fallbackProjectKey: issuePrefix.toLowerCase(),
    workspacePath,
    projectPath,
    tmuxSessionNames: context.tmuxSessionNames,
    agentSnapshotsById: context.agentSnapshotsById,
    derived: treeDerived,
    panes: treePanes,
  }));

  if (shipLog) {
    const shipSessionName = `agent-${issueLower}-ship`;
    const shipIsLive = context.tmuxSessionNames.has(shipSessionName);
    const shipJsonlPath = shipIsLive ? await resolveJsonlPath(shipSessionName, workspacePath) : null;
    const shipRunning = shipIsLive && shipLog.step !== undefined && shipLog.step !== 'merged';
    if (shipIsLive || shipJsonlPath) {
      const shipAwaitingInput = awaitingInputFromProjection(shipSessionName, context.agentSnapshotsById);
      const shipSnapshot = context.agentSnapshotsById?.get(shipSessionName);
      sections.push({
        type: 'ship',
        sessionId: shipSessionName,
        model: 'specialist',
        startedAt: shipLog.startedAt,
        endedAt: undefined,
        duration: 0,
        status: normalizeAgentStatus(shipRunning ? 'running' : 'completed'),
        presence: shipIsLive ? (shipRunning ? 'active' : 'idle') : 'ended',
        awaitingInput: shipAwaitingInput !== undefined ? (shipAwaitingInput !== null) : false,
        awaitingInputPrompt: shipAwaitingInput?.prompt,
        awaitingInputReason: shipAwaitingInput?.reason,
        pendingInputKinds: shipSnapshot?.pendingInputKinds ? [...shipSnapshot.pendingInputKinds] : undefined,
        hasJsonl: !!shipJsonlPath,
        tmuxSession: shipIsLive ? shipSessionName : undefined,
      });
    }
  }
  // PAN-2053: attach read-only model-origin so the right-click MODEL inspector works
  // in the project tree, not just the activity cockpit. Shared helper with command-deck.
  enrichSessionsWithModelOrigin(
    sections as Parameters<typeof enrichSessionsWithModelOrigin>[0],
    issueId,
  );

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
      const entry = await Effect.runPromise(findSpecByIssueThroughOverdeck(projectPath, issueId));
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
  const liveTmuxIssueIds = issueIdsWithLiveTmuxSessions(sharedTmuxSessionNames);

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
    // Strike and slot workspaces (feature-<issue>-strike, feature-<issue>-slot-N)
    // map to the same issue as the base feature-<issue> workspace — a strike on
    // an issue that never had a base workspace creates only the -strike dir.
    const candidateIssueLowers = new Set<string>();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const match = /^feature-([a-z]+-\d+)(?:-strike|-slot-\d+)?$/.exec(entry.name);
      if (match) candidateIssueLowers.add(match[1]!);
    }
    // Live agent sessions can exist with no workspace directory at all; seed
    // candidates from tmux too, scoped to this project's issue prefix so one
    // project's tree never grows rows for another project's sessions.
    for (const issueLower of liveTmuxIssueIds) {
      if (candidateIssueLowers.has(issueLower)) continue;
      if (resolveProjectFromIssueSync(issueLower.toUpperCase())?.projectKey === project.key) {
        candidateIssueLowers.add(issueLower);
      }
    }
    const featureCandidates = [...candidateIssueLowers].map((issueLower) => ({
      name: `feature-${issueLower}`,
      issueLower,
      issueId: issueLower.toUpperCase(),
    }));

    const results = await Effect.runPromise(withConcurrencyLimit(
      featureCandidates.map((c) => Effect.promise(async () => {
        const agentDir = join(getOverdeckHome(), 'agents', `agent-${c.issueLower}`);
        const planningAgentDir = join(getOverdeckHome(), 'agents', `planning-${c.issueLower}`);
        const planRunAgentDir = join(getOverdeckHome(), 'agents', `agent-${c.issueLower}-plan`);
        const strikeAgentDir = join(getOverdeckHome(), 'agents', `strike-${c.issueLower}`);
        const panDir = join(workspacesDir, c.name, PAN_DIRNAME);
        const overdeckDir = join(workspacesDir, c.name, WORKSPACE_RUNTIME_DIRNAME);
        const hasIssueTmux = liveTmuxIssueIds.has(c.issueLower);
        const [hasAgent, hasPlanning, hasPlanningAgent, hasPlanRunAgent, hasStrikeAgent, hasOverdeck] = await Promise.all([
          pathExists(agentDir),
          pathExists(panDir),
          pathExists(planningAgentDir),
          pathExists(planRunAgentDir),
          pathExists(strikeAgentDir),
          pathExists(overdeckDir),
        ]);
        const hasAnySignal = hasAgent || hasPlanning || hasPlanningAgent || hasPlanRunAgent || hasStrikeAgent || hasOverdeck || hasIssueTmux;
        if (!hasAnySignal) return null;
        try {
          const workspacePath = join(workspacesDir, c.name);
          const sessions = await collectSessionTreeNodes(c.issueId, workspacePath, projectPath, effectiveSharedContext);
          if (sessions.length === 0 && !hasAnySignal) return null;
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
  features.sort((a, b) => compareIssueIds(a.issueId, b.issueId));

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

// Defined in project-body.ts so project-create-routes.ts can use it without
// importing this module back (the circular-dependency guard refuses that cycle).
// Re-exported here because existing consumers import it from this path.
export { readProjectJsonBody };

// ─── Route: GET /api/projects/:projectKey/release-status ─────────────────────
// PAN-2555: release/publish pipeline visibility — npm dist-tags, release
// workflow runs with job-level detail (partial failures), latest GitHub
// Release. Accepts the deck's name-or-key identifiers; read-only.
const getProjectReleaseStatusRoute = HttpRouter.add(
  'GET',
  '/api/projects/:projectKey/release-status',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const projectKey = params['projectKey'] ?? '';
    const result = yield* Effect.tryPromise({
      try: async () => {
        const { fetchProjectReleaseStatus } = await import('../../../lib/overdeck/project-pipelines.js');
        return fetchProjectReleaseStatus(projectKey);
      },
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    return jsonResponse(result);
  })),
);

interface ProjectVersionSyncRouteDeps {
  getProject: (key: string) => ProjectConfig | null;
  listProjectKeys: () => string[];
  listPromotedGenerations: (projectRoot: string) => UatGeneration[];
  writeVersionSync: typeof setProjectVersionSync;
}

const defaultProjectVersionSyncRouteDeps: ProjectVersionSyncRouteDeps = {
  getProject: key => getProjectSync(key) ?? null,
  listProjectKeys: () => listProjectsSync().map(entry => entry.key),
  listPromotedGenerations: projectRoot => listUatGenerationsSync({
    projectRoot: resolve(projectRoot),
    statuses: ['promoted'],
    limit: 1,
  }),
  writeVersionSync: setProjectVersionSync,
};

export async function getProjectVersionSyncPayload(
  projectKey: string,
  deps: ProjectVersionSyncRouteDeps = defaultProjectVersionSyncRouteDeps,
): Promise<{ status: number; body: unknown }> {
  const project = deps.getProject(projectKey);
  if (!project) return { status: 404, body: { error: `Unknown project key: ${projectKey}` } };

  // PAN-3917 D6: ship records are gone — a shipped version is a git tag plus a
  // GitHub release. `lastOutcome` stays in the shape (W7 renders it) but is
  // null until the release engine exposes a tag-derived read.
  const generation = deps.listPromotedGenerations(project.path)[0];
  return { status: 200, body: { config: project.version_sync ?? null, lastOutcome: null, generation: generation?.name ?? null } };
}

export async function putProjectVersionSyncPayload(
  projectKey: string,
  payload: unknown,
  deps: ProjectVersionSyncRouteDeps = defaultProjectVersionSyncRouteDeps,
): Promise<{ status: number; body: unknown }> {
  const project = deps.getProject(projectKey);
  if (!project) {
    const known = deps.listProjectKeys();
    return {
      status: 404,
      body: { error: `Unknown project key: ${projectKey}. Known project keys: ${known.join(', ') || '(none)'}` },
    };
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload) || !('config' in payload)) {
    return { status: 400, body: { error: 'body must be { config: VersionSyncConfig | null }' } };
  }

  const raw = (payload as { config: unknown }).config;
  if (raw === null) {
    await deps.writeVersionSync(projectKey, null);
    return { status: 200, body: { config: null } };
  }
  const validation = validateVersionSyncConfig(raw);
  if (!validation.ok) return { status: 400, body: { errors: validation.errors } };
  await deps.writeVersionSync(projectKey, validation.config);
  return { status: 200, body: { config: validation.config } };
}

const getProjectVersionSyncRoute = HttpRouter.add(
  'GET',
  '/api/projects/:projectKey/version-sync',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return authError;
    const key = (yield* HttpRouter.params)['projectKey'] ?? '';
    const response = yield* Effect.promise(() => getProjectVersionSyncPayload(key));
    return jsonResponse(response.body, { status: response.status });
  })),
);

const putProjectVersionSyncRoute = HttpRouter.add(
  'PUT',
  '/api/projects/:projectKey/version-sync',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const key = (yield* HttpRouter.params)['projectKey'] ?? '';
    const body = yield* readProjectJsonBody;
    const response = yield* Effect.promise(() => putProjectVersionSyncPayload(key, body));
    return jsonResponse(response.body, { status: response.status });
  })),
);

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
    yield* Effect.promise(() => setProjectAutoMergeDefault(key, v));
    return jsonResponse({ value: v });
  })),
);

const getProjectSwarmPolicyRoute = HttpRouter.add('GET', '/api/projects/:projectKey/swarm-policy', httpHandler(Effect.gen(function* () {
  const key = (yield* HttpRouter.params)['projectKey'] ?? '';
  const config = getProjectSync(key);
  if (!config) return jsonResponse({ error: 'Project not found' }, { status: 404 });
  return jsonResponse({ configured: config.swarm ? { mode: config.swarm.mode, maxSlots: config.swarm.maxSlots, autoAdvance: config.swarm.autoAdvance } : null });
})));
const postProjectSwarmPolicyRoute = HttpRouter.add('POST', '/api/projects/:projectKey/swarm-policy', httpHandler(Effect.gen(function* () {
  const key = (yield* HttpRouter.params)['projectKey'] ?? '';
  if (!getProjectSync(key)) return jsonResponse({ error: 'Project not found' }, { status: 404 });
  const body = (yield* readProjectJsonBody) as { value?: { mode?: unknown; maxSlots?: unknown; autoAdvance?: unknown } | null };
  if (body.value !== null && body.value?.mode !== undefined && !['off', 'auto', 'always'].includes(String(body.value.mode))) return jsonResponse({ error: 'invalid swarm mode' }, { status: 400 });
  const value = body.value === null ? null : {
    ...(body.value?.mode !== undefined ? { mode: String(body.value.mode) as SwarmPolicyLayer['mode'] } : {}),
    ...(typeof body.value?.maxSlots === 'number' ? { maxSlots: body.value.maxSlots } : {}),
    ...(typeof body.value?.autoAdvance === 'boolean' ? { autoAdvance: body.value.autoAdvance } : {}),
  };
  yield* Effect.promise(() => setProjectSwarmPolicy(key, value)); return jsonResponse({ configured: value });
})));
const getIssueSwarmPolicyRoute = HttpRouter.add('GET', '/api/issues/:issueId/swarm-policy', httpHandler(Effect.gen(function* () {
  const issueId = ((yield* HttpRouter.params)['issueId'] ?? '').toUpperCase();
  const resolved = resolveProjectFromIssueSync(issueId); const project = resolved ? getProjectSync(resolved.projectKey) : undefined;
  if (!project) return jsonResponse({ error: 'Issue project not found' }, { status: 404 });
  // PAN-3917: the per-issue swarm policy layer lived on the issue record and
  // had no other owner, so it is gone. The resolved policy is the project's,
  // then the global default. POST /api/issues/:issueId/swarm-policy is deleted;
  // set the layer on the project instead.
  return jsonResponse({ configured: null, resolved: resolveSwarmPolicy(issueId) });
})));

async function getIssueStaffingPayload(
  issueId: string,
  planMetadata: { [key: string]: unknown } | undefined,
) {
  const config = loadConfigSync().config;
  // PAN-3917: `tieredExecutionOverride` and `workModel` lived on the issue
  // record. Neither is derivable and neither had another home, so the per-issue
  // override is gone: staffing resolves from the plan's own metadata and the
  // configured defaults. `recordedModel` is now the live pane's `model` token
  // (FR-5), which is the truth the record was always trying to mirror.
  const block = resolveTieredExecutionBlock(config.tieredExecution, planMetadata, null);
  const implicit = resolveImplicitStaffing(config, `work:${issueId.toLowerCase()}`);
  const panes = await getBackendPanesForIssue(issueId);
  const workPane = panes.find((pane) => pane.role === 'work') ?? panes[0];
  const liveModel = workPane && workPane.model !== 'unknown' ? workPane.model : null;
  return {
    override: { workModel: null },
    tieredExecution: block,
    resolved: {
      model: implicit.model,
      tiered: block.effective,
      source: 'default',
      recordedModel: liveModel,
    },
  };
}

const getIssueStaffingRoute = HttpRouter.add('GET', '/api/issues/:issueId/staffing', httpHandler(Effect.gen(function* () {
  const issueId = ((yield* HttpRouter.params)['issueId'] ?? '').toUpperCase();
  const resolved = resolveProjectFromIssueSync(issueId);
  const project = resolved ? getProjectSync(resolved.projectKey) : undefined;
  if (!project) return jsonResponse({ error: 'Issue project not found' }, { status: 404 });
  const spec = yield* findSpecByIssue(project.path, issueId).pipe(
    Effect.catch(() => Effect.succeed(null)),
  );
  return jsonResponse(yield* Effect.promise(() => getIssueStaffingPayload(issueId, spec?.document.plan.metadata)));
})));

// ─── Route: POST /api/projects/resolve ──────────────────────────────────────
// PAN-3836: dry-run resolve intent before POST /api/projects. Uses the
// resolve-before-create pattern from PAN-3330 (workspaces) — dashboard /projects/new
// calls this endpoint on every keystroke to show findings without creating anything.

const postProjectsResolveRoute = HttpRouter.add(
  'POST',
  '/api/projects/resolve',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const body = (yield* readProjectJsonBody) as {
      mode?: unknown;
      url?: unknown;
      path?: unknown;
      parentDir?: unknown;
      name?: unknown;
      issuePrefix?: unknown;
    };

    // Validate mode
    const mode = body.mode;
    if (mode !== 'clone' && mode !== 'existing' && mode !== 'new') {
      return jsonResponse({ error: "mode must be 'clone', 'existing', or 'new'" }, { status: 400 });
    }

    // Validate malformed/empty body
    if (!body || Object.keys(body).length === 0) {
      return jsonResponse({ error: 'request body is required' }, { status: 400 });
    }

    const input: ProjectCreateInput = {
      mode,
      url: typeof body.url === 'string' ? body.url : undefined,
      path: typeof body.path === 'string' ? body.path : undefined,
      parentDir: typeof body.parentDir === 'string' ? body.parentDir : undefined,
      name: typeof body.name === 'string' ? body.name : undefined,
      issuePrefix: typeof body.issuePrefix === 'string' ? body.issuePrefix : undefined,
      homeBoundary: true,
      // No refreshRemote: this route is called once per settled keystroke, so it
      // must read the 60 s probe memo rather than force a fresh `git ls-remote`
      // every time. POST /api/projects still refreshes before it writes.
    };

    const intent = yield* Effect.promise(() => resolveProjectCreateIntent(input));
    // Never the raw intent: its cloneUrl is the operator's transport URL and can
    // carry credentials the browser must not get back.
    return jsonResponse(toPublicProjectIntent(intent));
  })),
);

export const projectsRouteLayer = Layer.mergeAll(
  getProjectSessionTreeRoute,
  getAllSessionTreesRoute,
  getProjectReleaseStatusRoute,
  getProjectVersionSyncRoute,
  putProjectVersionSyncRoute,
  getProjectAutoMergeDefaultRoute,
  postProjectAutoMergeDefaultRoute,
  postProjectRenameRoute,
  getProjectSwarmPolicyRoute,
  postProjectSwarmPolicyRoute,
  getIssueSwarmPolicyRoute,
  getIssueStaffingRoute,
  postProjectsResolveRoute,
  // The create-job routes live in project-create-routes.ts (file-size ratchet);
  // they are merged first so their literal path segments win over
  // /api/projects/:projectKey/*.
  projectCreateJobRoutesLayer,
);

export default projectsRouteLayer;
