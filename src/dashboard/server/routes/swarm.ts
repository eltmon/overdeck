/**
 * Swarm route module — Effect HttpRouter.Layer (PAN-970)
 *
 * Implements:
 *   POST /api/swarm          — dispatch wave-parallel agents for a vBRIEF plan
 *   GET  /api/swarm/:issueId — get swarm state for an issue
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { getSystemHealthSnapshot, getResourceConfig } from '../services/system-health-service.js';
import { evaluateSpawnGuardrails } from './agents.js';
import { resolveProjectFromIssue } from '../../../lib/projects.js';
import { findPlan, VBriefMergeConflictError } from '../../../lib/vbrief/io.js';
import { readContinueStateAsync, writeContinueStateAsync, type ContinueState, type SwarmRuntime } from '../../../lib/vbrief/continue-state.js';
import { getDispatchableItems, groupItemsByWave, hasFileOverlap, blockingParentCount, deriveSynthesisMetadata, applyTaskOperationToPlanFileAsync, workspacePlanPath, type Wave, type WaveItem } from '../../../lib/vbrief/dag.js';
import type { VBriefDocument, VBriefItem } from '../../../lib/vbrief/types.js';
import { spawnAgent, type SpawnOptions } from '../../../lib/agents.js';
import { listSessionNamesAsync, isPaneDeadAsync, killSessionAsync, listPaneValuesAsync } from '../../../lib/tmux.js';

const execFileAsync = promisify(execFile);

// ─── Swarm state persistence ────────────────────────────────────────────────

interface SlotAssignment {
  slot: number;
  itemId: string;
  itemTitle: string;
  sessionName: string;
  workspace: string;
  status: 'pending' | 'running' | 'completed' | 'merged' | 'failed';
  startedAt?: string;
  completedAt?: string;
  failureReason?: string;
}

interface DeferredSwarmItem {
  itemId: string;
  itemTitle: string;
}

interface SwarmState {
  issueId: string;
  currentWave: number;
  totalWaves: number;
  model: string;
  autoAdvance?: boolean;
  autoAdvanceFailureCount?: number;
  autoAdvanceRetryAfter?: string;
  lastAutoAdvanceError?: string;
  slots: SlotAssignment[];
  deferred?: DeferredSwarmItem[];
  createdAt: string;
  updatedAt: string;
}

interface SwarmDispatchRequest {
  issueId: string;
  wave?: number;
  model?: string;
  maxSlots?: number;
  autoAdvance?: boolean;
}

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;

function canonicalIssueId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const canonical = value.trim().toUpperCase();
  return ISSUE_KEY_PATTERN.test(canonical) ? canonical : null;
}

function assertPathInside(parent: string, child: string): void {
  const rel = relative(parent, child);
  if (rel.startsWith('..') || rel === '' || rel.includes(`..${'/'}`)) {
    throw new Error(`Refusing path outside ${parent}: ${child}`);
  }
}

async function readWorkspacePlanAsync(workspacePath: string): Promise<VBriefDocument | null> {
  const planPath = join(workspacePath, '.pan', 'spec.vbrief.json');
  try {
    const raw = await readFile(planPath, 'utf-8');
    if (raw.includes('<<<<<<<') && raw.includes('=======') && raw.includes('>>>>>>>')) {
      throw new VBriefMergeConflictError(planPath);
    }
    const parsed = JSON.parse(raw);
    if (parsed.vBRIEFInfo && parsed.plan) return parsed as VBriefDocument;
    throw new Error(`Invalid vBRIEF format in ${planPath}`);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

interface SwarmDispatchResponseBody {
  success?: boolean;
  issueId?: string;
  wave?: number;
  totalWaves?: number;
  model?: string;
  autoAdvance?: boolean;
  dispatched?: number;
  capacity?: { current: number; limit: number; available: number };
  slots?: Array<{ slot: number; itemId: string; itemTitle: string; sessionName: string; status: SlotAssignment['status'] }>;
  deferred?: DeferredSwarmItem[];
  errors?: string[];
  wavePlan?: Wave[];
  error?: string;
  hint?: string;
  guardrails?: ReturnType<typeof evaluateSpawnGuardrails>;
}

const SWARM_AUTO_ADVANCE_POLL_MS = 5000;
const SWARM_AUTO_ADVANCE_BACKOFF_MS = 60_000;
const SWARM_AUTO_ADVANCE_BACKOFF_THRESHOLD = 3;
const SWARM_PANE_CHECK_CONCURRENCY = 10;
const SWARM_SLOT_SPAWN_CONCURRENCY = 3;
const autoAdvanceInFlight = new Set<string>();
let autoAdvanceLoopStarted = false;
let autoAdvancePolling = false;
let autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;

function getSwarmDir(): string {
  return join(homedir(), '.panopticon', 'swarms');
}

function getSwarmStatePath(issueId: string): string {
  return join(getSwarmDir(), `${issueId.toLowerCase()}.json`);
}

function continueDirForWorkspace(workspacePath: string): string {
  return join(workspacePath, '.pan');
}

function emptyContinueState(issueId: string, now: string): ContinueState {
  return {
    version: '1',
    issueId: issueId.toUpperCase(),
    created: now,
    updated: now,
    gitState: { branch: `feature/${issueId.toLowerCase()}`, dirty: false },
    decisions: [],
    hazards: [],
    resumePoint: null,
    beadsMapping: {},
    sessionHistory: [],
  };
}

async function loadWorkspaceContinue(workspacePath: string, issueId: string): Promise<ContinueState> {
  const now = new Date().toISOString();
  return await readContinueStateAsync(continueDirForWorkspace(workspacePath), issueId) ?? emptyContinueState(issueId, now);
}

async function saveRuntimeToContinue(workspacePath: string, issueId: string, runtime: SwarmRuntime): Promise<void> {
  const continueDir = continueDirForWorkspace(workspacePath);
  await mkdir(continueDir, { recursive: true });
  const cont = await loadWorkspaceContinue(workspacePath, issueId);
  await writeContinueStateAsync(continueDir, issueId, { ...cont, swarmRuntime: runtime });
}

function stateFromRuntime(issueId: string, runtime: SwarmRuntime): SwarmState {
  const slots: SlotAssignment[] = runtime.slots.map(slot => ({
    slot: slot.slotId,
    itemId: slot.itemId,
    itemTitle: slot.itemTitle,
    sessionName: slot.sessionName,
    workspace: slot.workspace,
    status: slot.status === 'merged' ? 'merged' : slot.status === 'failed' ? 'failed' : 'running',
    startedAt: slot.dispatchedAt,
    completedAt: slot.mergedAt,
  }));
  return {
    issueId: issueId.toUpperCase(),
    currentWave: runtime.currentWave ?? 0,
    totalWaves: runtime.totalWaves ?? 0,
    model: runtime.model,
    autoAdvance: runtime.autoAdvance,
    autoAdvanceFailureCount: runtime.autoAdvanceFailureCount,
    autoAdvanceRetryAfter: runtime.autoAdvanceRetryAfter,
    lastAutoAdvanceError: runtime.lastAutoAdvanceError,
    slots,
    deferred: runtime.deferred,
    createdAt: runtime.createdAt,
    updatedAt: runtime.updatedAt,
  };
}

function runtimeFromState(state: SwarmState, existing?: SwarmRuntime): SwarmRuntime {
  const now = new Date().toISOString();
  return {
    model: state.model,
    slots: state.slots.map(slot => ({
      slotId: slot.slot,
      itemId: slot.itemId,
      itemTitle: slot.itemTitle,
      sessionName: slot.sessionName,
      workspace: slot.workspace,
      status: slot.status === 'completed' ? 'merged' : slot.status === 'merged' ? 'merged' : slot.status === 'failed' ? 'failed' : 'running',
      dispatchedAt: slot.startedAt,
      mergedAt: slot.completedAt,
    })),
    currentWave: state.currentWave,
    totalWaves: state.totalWaves,
    autoAdvance: state.autoAdvance,
    autoAdvanceFailureCount: state.autoAdvanceFailureCount,
    autoAdvanceRetryAfter: state.autoAdvanceRetryAfter,
    lastAutoAdvanceError: state.lastAutoAdvanceError,
    deferred: state.deferred,
    synthesisOutputs: existing?.synthesisOutputs ?? {},
    createdAt: existing?.createdAt ?? state.createdAt ?? now,
    updatedAt: now,
  };
}

async function persistSwarmRuntime(workspacePath: string, state: SwarmState): Promise<void> {
  const existing = (await loadWorkspaceContinue(workspacePath, state.issueId)).swarmRuntime;
  await saveRuntimeToContinue(workspacePath, state.issueId, runtimeFromState(state, existing));
}

async function persistSynthesisOutput(
  workspacePath: string,
  issueId: string,
  doc: VBriefDocument,
  item: VBriefItem,
): Promise<void> {
  const cont = await loadWorkspaceContinue(workspacePath, issueId);
  const now = new Date().toISOString();
  const existingRuntime = cont.swarmRuntime ?? {
    model: DEFAULT_SWARM_MODEL,
    slots: [],
    synthesisOutputs: {},
    createdAt: now,
    updatedAt: now,
  };
  if (existingRuntime.synthesisOutputs[item.id]) return;
  const parentIds = doc.plan.edges.filter(edge => edge.type === 'blocks' && edge.to === item.id).map(edge => edge.from);
  const parents = parentIds
    .map(parentId => doc.plan.items.find(planItem => planItem.id === parentId))
    .filter((parent): parent is VBriefItem => Boolean(parent));
  const contextUpdate = [
    `Synthesis for convergence item ${item.id}: ${item.title}`,
    '',
    'Resolved upstream context:',
    ...parents.map(parent => `- ${parent.id}: ${parent.title} [${parent.status}]${parent.narrative?.Action ? ` — ${parent.narrative.Action}` : ''}`),
  ].join('\n');
  await writeContinueStateAsync(continueDirForWorkspace(workspacePath), issueId, {
    ...cont,
    swarmRuntime: {
      ...existingRuntime,
      synthesisOutputs: {
        ...existingRuntime.synthesisOutputs,
        [item.id]: { targetItemId: item.id, writtenAt: now, contextUpdate },
      },
      updatedAt: now,
    },
    sessionHistory: [
      ...cont.sessionHistory,
      { timestamp: now, reason: 'manual', note: `swarm synthesis prepared for ${item.id}` },
    ],
  });
}

async function loadLegacySwarmState(issueId: string): Promise<SwarmState | null> {
  const path = getSwarmStatePath(issueId);
  if (!existsSync(path)) return null;
  try {
    const data = await readFile(path, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function loadSwarmState(issueId: string): Promise<SwarmState | null> {
  const canonical = canonicalIssueId(issueId);
  if (!canonical) return null;
  const project = resolveProjectFromIssue(canonical);
  if (project) {
    const workspace = join(project.projectPath, 'workspaces', `feature-${canonical.toLowerCase()}`);
    const runtime = (await loadWorkspaceContinue(workspace, canonical)).swarmRuntime;
    const legacy = await loadLegacySwarmState(canonical);
    const legacyPath = getSwarmStatePath(canonical);
    const legacyMtime = legacy ? (await stat(legacyPath).catch(() => null))?.mtimeMs : undefined;
    const runtimeUpdated = runtime ? Date.parse(runtime.updatedAt) : undefined;
    if (runtime && (!legacy || (runtimeUpdated ?? 0) >= (legacyMtime ?? Date.parse(legacy.updatedAt)))) {
      return stateFromRuntime(canonical, runtime);
    }
    if (legacy) {
      await persistSwarmRuntime(workspace, legacy).catch(() => undefined);
      return legacy;
    }
  }

  // Backward-compatible one-time import from the PAN-970 sidecar. All writes after
  // this point go through the continue vBRIEF runtime authority.
  const legacy = await loadLegacySwarmState(canonical);
  if (legacy && project) {
    const workspace = join(project.projectPath, 'workspaces', `feature-${canonical.toLowerCase()}`);
    await persistSwarmRuntime(workspace, legacy).catch(() => undefined);
  }
  return legacy;
}

async function saveSwarmState(state: SwarmState): Promise<void> {
  const dir = getSwarmDir();
  await mkdir(dir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  await writeFile(getSwarmStatePath(state.issueId), JSON.stringify(state, null, 2));
}

async function runWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const maxConcurrent = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: maxConcurrent }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]!, currentIndex);
    }
  });

  await Promise.all(runners);
  return results;
}

async function getPaneExitStatusAsync(sessionName: string): Promise<number | null> {
  try {
    const value = (await listPaneValuesAsync(sessionName, '#{pane_dead_status}'))[0]?.trim();
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isAutoAdvanceCoolingDown(state: SwarmState, now = Date.now()): boolean {
  if (!state.autoAdvanceRetryAfter) return false;
  const retryAt = Date.parse(state.autoAdvanceRetryAfter);
  return Number.isFinite(retryAt) && retryAt > now;
}

function recordAutoAdvanceFailure(state: SwarmState, error: string, now = Date.now()): SwarmState {
  const failureCount = (state.autoAdvanceFailureCount ?? 0) + 1;
  return {
    ...state,
    autoAdvanceFailureCount: failureCount,
    autoAdvanceRetryAfter:
      failureCount >= SWARM_AUTO_ADVANCE_BACKOFF_THRESHOLD
        ? new Date(now + SWARM_AUTO_ADVANCE_BACKOFF_MS).toISOString()
        : undefined,
    lastAutoAdvanceError: error,
    updatedAt: new Date(now).toISOString(),
  };
}

async function refreshSwarmSlotStatuses(
  state: SwarmState,
  sessions?: string[],
): Promise<{ state: SwarmState; changed: boolean }> {
  const liveSessions = sessions ?? await listSessionNamesAsync();
  const runningSlots = state.slots.filter((slot) => slot.status === 'running');
  if (runningSlots.length === 0) {
    return { state, changed: false };
  }

  const slotStatuses = await runWithConcurrencyLimit(
    runningSlots,
    SWARM_PANE_CHECK_CONCURRENCY,
    async (slot) => {
      const sessionPresent = liveSessions.includes(slot.sessionName);
      const paneDead = sessionPresent ? await isPaneDeadAsync(slot.sessionName).catch(() => false) : false;
      const exitStatus = sessionPresent && paneDead ? await getPaneExitStatusAsync(slot.sessionName) : null;
      return {
        sessionName: slot.sessionName,
        sessionPresent,
        paneDead,
        exitStatus,
      };
    },
  );

  const statusBySession = new Map(slotStatuses.map((slotStatus) => [slotStatus.sessionName, slotStatus]));
  let changed = false;
  const completedAt = new Date().toISOString();

  const slots = state.slots.map((slot) => {
    if (slot.status !== 'running') {
      return slot;
    }

    const slotStatus = statusBySession.get(slot.sessionName);
    if (!slotStatus) {
      changed = true;
      return {
        ...slot,
        status: 'failed' as const,
        completedAt: slot.completedAt ?? completedAt,
        failureReason: 'tmux session disappeared before completion could be confirmed',
      };
    }

    if (slotStatus.sessionPresent && !slotStatus.paneDead) {
      return slot;
    }

    changed = true;
    if (slotStatus.exitStatus === 0) {
      return {
        ...slot,
        status: 'completed' as const,
        completedAt: slot.completedAt ?? completedAt,
        failureReason: undefined,
      };
    }

    return {
      ...slot,
      status: 'failed' as const,
      completedAt: slot.completedAt ?? completedAt,
      failureReason:
        slotStatus.exitStatus == null
          ? 'tmux pane died before completion could be confirmed'
          : `tmux pane exited with status ${slotStatus.exitStatus}`,
    };
  });

  if (!changed) return { state, changed: false };
  return {
    state: {
      ...state,
      slots,
      updatedAt: completedAt,
    },
    changed: true,
  };
}

async function dispatchSwarmWave(
  request: SwarmDispatchRequest,
): Promise<{ status: number; body: SwarmDispatchResponseBody }> {
  const { wave: requestedWave, model: requestedModel, maxSlots, autoAdvance } = request;
  const issueUpper = canonicalIssueId(request.issueId);
  if (!issueUpper) {
    return { status: 400, body: { error: 'issueId must be a tracker key like PAN-977.' } };
  }
  const issueLower = issueUpper.toLowerCase();

  const project = resolveProjectFromIssue(issueUpper);
  if (!project) {
    return {
      status: 404,
      body: { error: `Could not resolve project for ${issueUpper}` },
    };
  }

  const workspacesDir = join(project.projectPath, 'workspaces');
  const mainWorkspace = join(workspacesDir, `feature-${issueLower}`);
  assertPathInside(workspacesDir, mainWorkspace);
  if (!existsSync(mainWorkspace)) {
    return {
      status: 404,
      body: {
        error: `No workspace found for ${issueUpper}`,
        hint: 'Create a workspace first: pan start ' + issueUpper,
      },
    };
  }

  let doc = await readWorkspacePlanAsync(mainWorkspace);
  if (!doc) {
    return {
      status: 422,
      body: {
        error: `No vBRIEF plan found for ${issueUpper}`,
        hint: 'Run planning first to produce a vBRIEF plan.',
      },
    };
  }

  let annotatedDoc = deriveSynthesisMetadata(doc);
  const waves = groupItemsByWave(annotatedDoc);
  const existingState = await loadSwarmState(issueUpper);
  const continueState = await loadWorkspaceContinue(mainWorkspace, issueUpper);
  const mergedItemIds = new Set<string>([
    ...(continueState.swarmRuntime?.slots ?? [])
      .filter(slot => slot.status === 'merged')
      .map(slot => slot.itemId),
    ...(existingState?.slots ?? [])
      .filter(slot => slot.status === 'completed' || slot.status === 'merged')
      .map(slot => slot.itemId),
  ]);
  const runningItems = (continueState.swarmRuntime?.slots ?? [])
    .filter(slot => slot.status === 'running')
    .map(slot => annotatedDoc.plan.items.find(item => item.id === slot.itemId))
    .filter((item): item is VBriefItem => Boolean(item));
  let readyItems = existingState?.deferred?.length
    ? existingState.deferred
      .map(deferred => annotatedDoc.plan.items.find(item => item.id === deferred.itemId))
      .filter((item): item is VBriefItem => Boolean(item))
    : getDispatchableItems(annotatedDoc, mergedItemIds).filter(item => !mergedItemIds.has(item.id));

  const waveIndex = requestedWave ?? existingState?.currentWave ?? 0;
  const requestedWaveItems = waves[waveIndex]?.items;
  if (!requestedWaveItems) {
    return {
      status: 400,
      body: { error: `Wave ${waveIndex} does not exist for ${issueUpper}.`, wavePlan: waves },
    };
  }
  if (requestedWave !== undefined && !existingState?.deferred?.length) {
    const waveItemIds = new Set(requestedWaveItems.map(item => item.id));
    readyItems = readyItems.filter(item => waveItemIds.has(item.id));
  }

  const selectedItems: VBriefItem[] = [];
  const deferredByOverlap: VBriefItem[] = [];
  for (const item of readyItems) {
    if (hasFileOverlap([...runningItems, ...selectedItems], item)) {
      deferredByOverlap.push(item);
      continue;
    }
    selectedItems.push(item);
  }
  const candidates = selectedItems;
  if (candidates.length === 0) {
    return {
      status: 422,
      body: {
        error: `No dispatchable items in the plan for ${issueUpper}`,
        hint: readyItems.length > 0
          ? 'Ready items are waiting for overlapping files_scope work to finish.'
          : 'All items may already be running, completed, blocked, or waiting on dependencies.',
        wavePlan: waves,
      },
    };
  }

  const itemById = new Map(annotatedDoc.plan.items.map((planItem) => [planItem.id, planItem]));
  const pendingItems: WaveItem[] = candidates.map(item => ({
    id: item.id,
    title: item.title,
    difficulty: item.metadata?.difficulty,
    blockedBy: annotatedDoc.plan.edges
      .filter(edge => edge.type === 'blocks' && edge.to === item.id)
      .map(edge => edge.from),
  }));

  const health = await getSystemHealthSnapshot();
  const guardrails = evaluateSpawnGuardrails(health);
  if (guardrails.blocked) {
    return {
      status: guardrails.status,
      body: {
        error: guardrails.error,
        hint: guardrails.hint,
        guardrails,
      },
    };
  }

  const swarmModel = requestedModel || DEFAULT_SWARM_MODEL;
  const resourceConfig = getResourceConfig();
  const envLimit = process.env['PAN_AGENT_BLOCK_COUNT'];
  const parsedEnvLimit = envLimit !== undefined ? Number(envLimit) : undefined;
  const hardLimit = Number.isFinite(parsedEnvLimit) ? parsedEnvLimit : resourceConfig.agentBlockCount;
  const currentAgents = health.summary.workAgentCount;
  const systemAvailable = Math.max(0, hardLimit - currentAgents);

  if (systemAvailable === 0) {
    return {
      status: 429,
      body: {
        error: `No agent capacity available (${currentAgents}/${hardLimit} agents running).`,
        hint: 'Wait for running agents to finish or stop some before dispatching a swarm.',
      },
    };
  }

  const userMax = maxSlots ?? 4;
  if (!Number.isInteger(userMax) || userMax <= 0) {
    return {
      status: 400,
      body: {
        error: 'maxSlots must be a positive integer.',
      },
    };
  }

  const maxConcurrent = Math.min(pendingItems.length, userMax, systemAvailable);
  const itemsToDispatch = pendingItems.slice(0, maxConcurrent);
  const deferredItems = [
    ...pendingItems.slice(maxConcurrent),
    ...deferredByOverlap.map(item => ({
      id: item.id,
      title: item.title,
      difficulty: item.metadata?.difficulty,
      blockedBy: annotatedDoc.plan.edges
        .filter(edge => edge.type === 'blocks' && edge.to === item.id)
        .map(edge => edge.from),
    })),
  ];

  const existingSessions = await listSessionNamesAsync();
  const existingSwarmSessions = existingSessions.filter(
    s => s.startsWith(`agent-${issueLower}-`) && /agent-[a-z0-9-]+-\d+$/.test(s),
  );

  const aliveSlots = new Set<string>();
  const sessionLiveness = await runWithConcurrencyLimit(
    existingSwarmSessions,
    SWARM_PANE_CHECK_CONCURRENCY,
    async (sessionName) => {
      const paneDead = await isPaneDeadAsync(sessionName).catch(() => false);
      if (paneDead) {
        await killSessionAsync(sessionName).catch(() => {});
        return { sessionName, alive: false };
      }
      return { sessionName, alive: true };
    },
  );

  for (const session of sessionLiveness) {
    if (session.alive) {
      aliveSlots.add(session.sessionName);
    }
  }

  const dispatched: SlotAssignment[] = [];
  const errors: string[] = [];
  const planPath = findPlan(mainWorkspace);

  const slotResults = await runWithConcurrencyLimit(
    itemsToDispatch,
    SWARM_SLOT_SPAWN_CONCURRENCY,
    async (item, index) => {
      const slotNum = index + 1;
      const sessionName = `agent-${issueLower}-${slotNum}`;

      if (aliveSlots.has(sessionName)) {
        return {
          slot: slotNum,
          itemId: item.id,
          itemTitle: item.title,
          sessionName,
          workspace: '',
          status: 'running' as const,
        } satisfies SlotAssignment;
      }

      const worktreeResult = await createSlotWorktree(project.projectPath, issueUpper, slotNum);
      if (!worktreeResult.success) {
        return `Slot ${slotNum}: failed to create worktree — ${worktreeResult.error}`;
      }

      if (planPath) {
        const slotPanDir = join(worktreeResult.workspacePath, '.pan');
        await mkdir(slotPanDir, { recursive: true });
        const slotPlanPath = join(slotPanDir, 'spec.vbrief.json');
        if (!existsSync(slotPlanPath)) {
          try {
            const planContent = await readFile(planPath, 'utf-8');
            await writeFile(slotPlanPath, planContent);
          } catch {}
        }
      }

      const fullItem = itemById.get(item.id);
      const requiresSynthesis = Boolean(fullItem && (fullItem.metadata?.requiresSynthesis || blockingParentCount(annotatedDoc, fullItem.id) > 1));
      const hasSynthesisOutput = Boolean(continueState.swarmRuntime?.synthesisOutputs?.[item.id]);
      const dispatchSynthesisFirst = requiresSynthesis && !hasSynthesisOutput;

      const itemPrompt = dispatchSynthesisFirst
        ? buildSynthesisPrompt(annotatedDoc, issueUpper, item, waveIndex, slotNum)
        : buildSlotPrompt(
        annotatedDoc,
        issueUpper,
        item,
        waveIndex,
        slotNum,
        worktreeResult.branch,
        worktreeResult.parentBranch,
        itemById,
      );

      try {
        const spawnOptions: SpawnOptions = {
          issueId: issueUpper,
          workspace: worktreeResult.workspacePath,
          model: swarmModel,
          slotId: slotNum,
          swarmItemId: item.id,
          prompt: itemPrompt,
          phase: dispatchSynthesisFirst ? 'synthesis' : 'implementation',
        };

        await spawnAgent(spawnOptions);
        if (!dispatchSynthesisFirst) {
          await applyTaskOperationToPlanFileAsync(workspacePlanPath(mainWorkspace), {
            type: 'claim',
            itemId: item.id,
            reason: `Swarm slot ${slotNum} dispatched`,
            writerId: `swarm-dispatch-${process.pid}`,
          });
        }

        doc = await readWorkspacePlanAsync(mainWorkspace) ?? doc;
        annotatedDoc = deriveSynthesisMetadata(doc);

        return {
          slot: slotNum,
          itemId: item.id,
          itemTitle: item.title,
          sessionName,
          workspace: worktreeResult.workspacePath,
          status: 'running' as const,
          startedAt: new Date().toISOString(),
        } satisfies SlotAssignment;
      } catch (err: any) {
        return `Slot ${slotNum} (${item.id}): ${err.message}`;
      }
    },
  );

  for (const slotResult of slotResults) {
    if (typeof slotResult === 'string') {
      errors.push(slotResult);
    } else {
      dispatched.push(slotResult);
    }
  }

  if (itemsToDispatch.length > 0 && dispatched.length === 0) {
    return {
      status: 500,
      body: {
        error: `Failed to dispatch any slots for ${issueUpper} wave ${waveIndex}.`,
        hint: 'Resolve the slot creation or agent spawn errors, then retry the swarm wave.',
        errors,
        wavePlan: waves,
      },
    };
  }

  const state: SwarmState = {
    issueId: issueUpper,
    currentWave: waveIndex,
    totalWaves: waves.length,
    model: swarmModel,
    autoAdvance: autoAdvance ?? existingState?.autoAdvance ?? false,
    autoAdvanceFailureCount: 0,
    autoAdvanceRetryAfter: undefined,
    lastAutoAdvanceError: undefined,
    slots: dispatched,
    deferred: deferredItems.length > 0
      ? deferredItems.map((item) => ({ itemId: item.id, itemTitle: item.title }))
      : undefined,
    createdAt: existingState?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveSwarmState(state);
  await persistSwarmRuntime(mainWorkspace, state);

  if (state.autoAdvance) {
    ensureSwarmAutoAdvanceLoop();
  }

  return {
    status: 200,
    body: {
      success: true,
      issueId: issueUpper,
      wave: waveIndex,
      totalWaves: waves.length,
      model: swarmModel,
      autoAdvance: state.autoAdvance,
      dispatched: dispatched.length,
      capacity: { current: currentAgents, limit: hardLimit, available: systemAvailable },
      slots: dispatched.map(s => ({
        slot: s.slot,
        itemId: s.itemId,
        itemTitle: s.itemTitle,
        sessionName: s.sessionName,
        status: s.status,
      })),
      deferred: state.deferred,
      errors: errors.length > 0 ? errors : undefined,
      wavePlan: waves,
    },
  };
}

async function onSlotMergeComplete(issueId: string, itemId: string, slotId: number, synthesisOutput?: string): Promise<void> {
  const issueUpper = canonicalIssueId(issueId);
  if (!issueUpper) return;
  const project = resolveProjectFromIssue(issueUpper);
  if (!project) return;
  const mainWorkspace = join(project.projectPath, 'workspaces', `feature-${issueUpper.toLowerCase()}`);
  const now = new Date().toISOString();
  const state = await loadSwarmState(issueUpper);
  if (state) {
    const slots = state.slots.map(slot => slot.slot === slotId || slot.itemId === itemId
      ? { ...slot, status: 'merged' as const, completedAt: slot.completedAt ?? now }
      : slot);
    const nextState = { ...state, slots, updatedAt: now };
    await saveSwarmState(nextState);
    await persistSwarmRuntime(mainWorkspace, nextState);
    if (synthesisOutput) {
      const cont = await loadWorkspaceContinue(mainWorkspace, issueUpper);
      const runtime = cont.swarmRuntime ?? runtimeFromState(nextState);
      await writeContinueStateAsync(continueDirForWorkspace(mainWorkspace), issueUpper, {
        ...cont,
        swarmRuntime: {
          ...runtime,
          synthesisOutputs: {
            ...runtime.synthesisOutputs,
            [itemId]: { targetItemId: itemId, writtenAt: now, contextUpdate: synthesisOutput },
          },
          updatedAt: now,
        },
      });
    }
    if (nextState.autoAdvance) {
      const result = await dispatchSwarmWave({ issueId: issueUpper, wave: nextState.deferred?.length ? nextState.currentWave : nextState.currentWave + 1, model: nextState.model, autoAdvance: true });
      if (result.status >= 400) ensureSwarmAutoAdvanceLoop();
    }
  }
  await applyTaskOperationToPlanFileAsync(workspacePlanPath(mainWorkspace), {
    type: 'done',
    itemId,
    reason: `Swarm slot ${slotId} merged into feature branch`,
    writerId: `swarm-merge-${process.pid}`,
  }).catch(() => undefined);
}

async function pollSwarmAutoAdvance(): Promise<void> {
  const entries = await readdir(getSwarmDir()).catch(() => [] as string[]);
  if (entries.length === 0) return;

  const sessions = await listSessionNamesAsync().catch(() => [] as string[]);

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;

    const issueId = entry.replace(/\.json$/, '').toUpperCase();
    const loadedState = await loadSwarmState(issueId);
    if (!loadedState?.autoAdvance) continue;
    if (loadedState.currentWave >= loadedState.totalWaves - 1 && !loadedState.deferred?.length) continue;
    if (autoAdvanceInFlight.has(loadedState.issueId)) continue;
    if (isAutoAdvanceCoolingDown(loadedState)) continue;

    const { state, changed } = await refreshSwarmSlotStatuses(loadedState, sessions);
    if (changed) {
      await saveSwarmState(state);
      const project = resolveProjectFromIssue(state.issueId);
      if (project) {
        await persistSwarmRuntime(join(project.projectPath, 'workspaces', `feature-${state.issueId.toLowerCase()}`), state);
      }
    }

    if (state.slots.some((slot) => slot.status === 'failed')) {
      if (!state.autoAdvanceRetryAfter && !state.lastAutoAdvanceError) {
        await saveSwarmState(recordAutoAdvanceFailure(state, 'One or more swarm slots failed before completion was confirmed.'));
      }
      continue;
    }

    const allSlotsCompleted = state.slots.length > 0 && state.slots.every(
      (slot) => slot.status === 'completed',
    );
    if (!allSlotsCompleted) continue;

    autoAdvanceInFlight.add(state.issueId);
    try {
      const result = await dispatchSwarmWave({
        issueId: state.issueId,
        wave: state.deferred?.length ? state.currentWave : state.currentWave + 1,
        model: state.model,
        autoAdvance: true,
      });
      if (result.status >= 400) {
        const error = result.body.error ?? 'unknown error';
        console.warn(`[swarm] Auto-advance for ${state.issueId} stalled: ${error}`);
        await saveSwarmState(recordAutoAdvanceFailure(state, error));
      }
    } finally {
      autoAdvanceInFlight.delete(state.issueId);
    }
  }
}

function scheduleNextSwarmAutoAdvancePoll(): void {
  autoAdvanceTimer = setTimeout(() => {
    void runSwarmAutoAdvancePollLoop();
  }, SWARM_AUTO_ADVANCE_POLL_MS);
  autoAdvanceTimer.unref?.();
}

async function runSwarmAutoAdvancePollLoop(): Promise<void> {
  if (autoAdvancePolling) {
    scheduleNextSwarmAutoAdvancePoll();
    return;
  }

  autoAdvancePolling = true;
  try {
    await pollSwarmAutoAdvance();
  } catch (err) {
    console.error('[swarm] Auto-advance loop failed:', err);
  } finally {
    autoAdvancePolling = false;
    scheduleNextSwarmAutoAdvancePoll();
  }
}

function ensureSwarmAutoAdvanceLoop(): void {
  if (autoAdvanceLoopStarted) return;
  autoAdvanceLoopStarted = true;
  scheduleNextSwarmAutoAdvancePoll();
}

async function resumeSwarmAutoAdvanceLoopOnStartup(): Promise<void> {
  const entries = await readdir(getSwarmDir()).catch(() => [] as string[]);
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;

    const state = await loadSwarmState(entry.replace(/\.json$/, '').toUpperCase());
    if (!state?.autoAdvance) continue;
    if (state.currentWave >= state.totalWaves - 1 && !state.deferred?.length) continue;

    ensureSwarmAutoAdvanceLoop();
    return;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    const parsed = text ? JSON.parse(text) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
});

const DEFAULT_SWARM_MODEL = 'kimi-k2.6';

async function createSlotWorktree(
  projectPath: string,
  issueId: string,
  slotNum: number,
): Promise<{ success: boolean; workspacePath: string; branch: string; parentBranch: string; error?: string }> {
  const issueUpper = canonicalIssueId(issueId);
  if (!issueUpper) return { success: false, workspacePath: '', branch: '', parentBranch: '', error: 'Invalid issue ID' };
  const issueLower = issueUpper.toLowerCase();
  const featureBranch = `feature/${issueLower}`;
  const slotBranch = `feature/${issueLower}/slot-${slotNum}`;
  const slotWorkspaceName = `feature-${issueLower}-slot-${slotNum}`;
  const workspacesDir = join(projectPath, 'workspaces');
  const workspacePath = join(workspacesDir, slotWorkspaceName);
  assertPathInside(workspacesDir, workspacePath);

  if (existsSync(workspacePath)) {
    return { success: true, workspacePath, branch: slotBranch, parentBranch: featureBranch };
  }

  try {
    await execFileAsync('git', ['fetch', 'origin'], { cwd: projectPath });
    await execFileAsync('git', ['worktree', 'prune'], { cwd: projectPath });

    // Create slot worktree branching off the main feature branch
    const { stdout: localBranches } = await execFileAsync('git', ['branch', '--list'], { cwd: projectPath });
    const { stdout: remoteBranches } = await execFileAsync('git', ['branch', '-r', '--list'], { cwd: projectPath });
    const localList = localBranches.split('\n').map(b => b.replace(/^[*+\s]+/, '').trim()).filter(Boolean);
    const remoteList = remoteBranches.split('\n').map(b => b.trim()).filter(Boolean);

    const slotBranchExists =
      localList.includes(slotBranch) ||
      remoteList.includes(`origin/${slotBranch}`);

    if (slotBranchExists) {
      await execFileAsync('git', ['worktree', 'add', workspacePath, slotBranch], { cwd: projectPath });
    } else {
      // Branch off the main feature branch (or main if feature branch doesn't exist)
      const baseBranch = localList.includes(featureBranch) || remoteList.includes(`origin/${featureBranch}`)
        ? featureBranch
        : 'main';
      await execFileAsync('git', ['worktree', 'add', workspacePath, '-b', slotBranch, baseBranch], { cwd: projectPath });
    }

    // Restore any unstaged deletions
    await execFileAsync('git', ['restore', '.'], { cwd: workspacePath }).catch(() => {});
    await execFileAsync('git', ['config', 'beads.role', 'contributor'], { cwd: workspacePath }).catch(() => {});

    // Set up beads redirect
    const sourceBeadsDir = join(projectPath, '.beads');
    if (existsSync(sourceBeadsDir)) {
      const worktreeBeadsDir = join(workspacePath, '.beads');
      const redirectPath = join(worktreeBeadsDir, 'redirect');
      if (!existsSync(redirectPath)) {
        try {
          await mkdir(worktreeBeadsDir, { recursive: true });
          const relPath = relative(workspacePath, sourceBeadsDir);
          await writeFile(redirectPath, relPath, 'utf-8');
        } catch {}
      }
    }

    // Install dependencies (non-fatal)
    try {
      await execFileAsync('bun', ['install'], { cwd: workspacePath, timeout: 60000 });
    } catch {}

    return { success: true, workspacePath, branch: slotBranch, parentBranch: featureBranch };
  } catch (err: any) {
    return { success: false, workspacePath, branch: slotBranch, parentBranch: featureBranch, error: err.message };
  }
}

// ─── POST /api/swarm ────────────────────────────────────────────────────────

const postSwarmRoute = HttpRouter.add(
  'POST',
  '/api/swarm',
  httpHandler(Effect.gen(function* () {
    const body = yield* readJsonBody;
    const { wave, model, maxSlots, autoAdvance } = body as SwarmDispatchRequest;
    const issueId = canonicalIssueId((body as Record<string, unknown>)['issueId']);

    if (!issueId) {
      return jsonResponse({ error: 'issueId must be a tracker key like PAN-977.' }, { status: 400 });
    }
    if (wave !== undefined && (!Number.isInteger(wave) || wave < 0)) {
      return jsonResponse({ error: 'wave must be a non-negative integer.' }, { status: 400 });
    }
    if (maxSlots !== undefined && (!Number.isInteger(maxSlots) || maxSlots <= 0)) {
      return jsonResponse({ error: 'maxSlots must be a positive integer.' }, { status: 400 });
    }
    if (model !== undefined && typeof model !== 'string') {
      return jsonResponse({ error: 'model must be a string.' }, { status: 400 });
    }

    const result = yield* Effect.promise(() => dispatchSwarmWave({
      issueId,
      wave,
      model,
      maxSlots,
      autoAdvance,
    }));

    return jsonResponse(result.body, { status: result.status });
  })),
);

interface StructuredSlotTaskInput {
  schema: 'AgentTaskInput';
  agent_id: string;
  issue_id: string;
  plan_id: string;
  task_id: string;
  title: string;
  wave_index: number;
  slot: number;
  branch: string;
  pr_target: string;
  workspace_plan_path: string;
  dependencies: Array<{ item_id: string; title: string }>;
  acceptance_criteria: string[];
}

function extractAcceptanceCriteria(item: VBriefItem): string[] {
  return (item.subItems ?? [])
    .filter(subItem => subItem.metadata?.kind === 'acceptance_criterion')
    .map(subItem => subItem.title);
}

function buildStructuredSlotTaskInput(
  doc: VBriefDocument,
  issueId: string,
  item: WaveItem,
  waveIndex: number,
  slotNum: number,
  slotBranch: string,
  parentBranch: string,
  itemById = new Map(doc.plan.items.map((planItem) => [planItem.id, planItem])),
): StructuredSlotTaskInput {
  const fullItem = itemById.get(item.id) ?? doc.plan.items.find((planItem) => planItem.id === item.id);
  const issueLower = issueId.toLowerCase();

  return {
    schema: 'AgentTaskInput',
    agent_id: `agent-${issueLower}-${slotNum}`,
    issue_id: issueId,
    plan_id: doc.plan.id,
    task_id: item.id,
    title: item.title,
    wave_index: waveIndex,
    slot: slotNum,
    branch: slotBranch,
    pr_target: parentBranch,
    workspace_plan_path: '.pan/spec.vbrief.json',
    dependencies: item.blockedBy.map((dependencyId) => ({
      item_id: dependencyId,
      title: itemById.get(dependencyId)?.title ?? dependencyId,
    })),
    acceptance_criteria: fullItem ? extractAcceptanceCriteria(fullItem) : [],
  };
}

function buildSynthesisPrompt(
  doc: VBriefDocument,
  issueId: string,
  item: WaveItem,
  waveIndex: number,
  slotNum: number,
): string {
  const parents = item.blockedBy
    .map(parentId => doc.plan.items.find(planItem => planItem.id === parentId))
    .filter((parent): parent is VBriefItem => Boolean(parent));

  return [
    `You are synthesis slot ${slotNum} for wave ${waveIndex} of plan ${doc.plan.id}.`,
    `Issue: ${issueId}`,
    `Convergence target: **${item.id}: ${item.title}**`,
    '',
    'Read the merged upstream changes for these completed parent items:',
    ...parents.map(parent => `- ${parent.id}: ${parent.title}`),
    '',
    'Produce a concise markdown synthesis of the upstream decisions, changed files, hazards, and constraints the downstream implementation agent must know.',
    'When complete, call the production merge-complete path with this synthesis output so Panopticon can persist it into the continue vBRIEF before dispatching downstream work.',
    'Do not implement the convergence target itself in this synthesis slot.',
  ].join('\n');
}

function buildSlotPrompt(
  doc: VBriefDocument,
  issueId: string,
  item: WaveItem,
  waveIndex: number,
  slotNum: number,
  slotBranch: string,
  parentBranch: string,
  itemById = new Map(doc.plan.items.map((planItem) => [planItem.id, planItem])),
): string {
  const taskInput = buildStructuredSlotTaskInput(
    doc,
    issueId,
    item,
    waveIndex,
    slotNum,
    slotBranch,
    parentBranch,
    itemById,
  );

  return [
    `You are swarm slot ${slotNum} working on wave ${waveIndex} of plan ${doc.plan.id}.`,
    `Your assigned task is: **${item.id}: ${item.title}**`,
    '',
    'Focus ONLY on this specific task from the vBRIEF plan.',
    'The plan is in .pan/spec.vbrief.json — read it for full context, acceptance criteria, and dependencies.',
    '',
    'Structured AgentTaskInput:',
    '```json',
    JSON.stringify(taskInput, null, 2),
    '```',
    '',
    `Your slot branch: **${slotBranch}**`,
    `Parent feature branch (merge target): **${parentBranch}**`,
    '',
    'When your task is complete:',
    `1. Commit your changes to branch \`${slotBranch}\``,
    `2. Find your bead: \`bd list -l ${doc.plan.id.toLowerCase()} --status open\` and look for the one matching "${item.title}"`,
    `3. Close it: \`bd close <bead-id>\``,
    `4. Push branch \`${slotBranch}\``,
    `5. Create a PR targeting \`${parentBranch}\` — do NOT target main`,
    '',
    `Do NOT run \`pan done\` — that closes the entire issue. You are one slot in a parallel swarm.`,
    'Other slots are working on sibling tasks in parallel. Stay within your task scope.',
  ].join('\n');
}

// ─── POST /api/swarm/slot-merged ────────────────────────────────────────────

const postSwarmSlotMergedRoute = HttpRouter.add(
  'POST',
  '/api/swarm/slot-merged',
  httpHandler(Effect.gen(function* () {
    const body = yield* readJsonBody;
    const issueId = canonicalIssueId((body as Record<string, unknown>)['issueId']);
    const itemId = (body as Record<string, unknown>)['itemId'];
    const slotId = (body as Record<string, unknown>)['slotId'];
    const synthesisOutput = (body as Record<string, unknown>)['synthesisOutput'];

    if (!issueId) return jsonResponse({ error: 'issueId must be a tracker key like PAN-977.' }, { status: 400 });
    if (typeof itemId !== 'string' || itemId.length === 0) return jsonResponse({ error: 'itemId required' }, { status: 400 });
    if (!Number.isInteger(slotId) || (slotId as number) <= 0) return jsonResponse({ error: 'slotId must be a positive integer.' }, { status: 400 });
    if (synthesisOutput !== undefined && typeof synthesisOutput !== 'string') return jsonResponse({ error: 'synthesisOutput must be a string.' }, { status: 400 });

    yield* Effect.promise(() => onSlotMergeComplete(issueId, itemId, slotId as number, synthesisOutput as string | undefined));
    return jsonResponse({ success: true });
  })),
);

// ─── GET /api/swarm/:issueId ────────────────────────────────────────────────

const getSwarmRoute = HttpRouter.add(
  'GET',
  '/api/swarm/:issueId',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = canonicalIssueId(params['issueId'] ?? '');
    if (!issueId) {
      return jsonResponse({ error: 'issueId must be a tracker key like PAN-977.' }, { status: 400 });
    }

    const state = yield* Effect.promise(() => loadSwarmState(issueId));
    if (!state) {
      return jsonResponse({ error: `No swarm state for ${issueId}` }, { status: 404 });
    }

    const sessions = yield* Effect.promise(() => listSessionNamesAsync());
    const refreshed = yield* Effect.promise(() => refreshSwarmSlotStatuses(state, sessions));
    if (refreshed.changed) {
      yield* Effect.promise(async () => {
        await saveSwarmState(refreshed.state);
        const project = resolveProjectFromIssue(issueId);
        if (project) {
          await persistSwarmRuntime(join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`), refreshed.state);
        }
      });
    }

    return jsonResponse(refreshed.state);
  })),
);

// ─── Export ─────────────────────────────────────────────────────────────────

export const __testInternals = {
  refreshSwarmSlotStatuses,
  dispatchSwarmWave,
  pollSwarmAutoAdvance,
  ensureSwarmAutoAdvanceLoop,
  resumeSwarmAutoAdvanceLoopOnStartup,
  onSlotMergeComplete,
  buildStructuredSlotTaskInput,
  buildSlotPrompt,
};

export { resumeSwarmAutoAdvanceLoopOnStartup };

export const swarmRouteLayer = Layer.mergeAll(
  postSwarmRoute,
  postSwarmSlotMergedRoute,
  getSwarmRoute,
);
