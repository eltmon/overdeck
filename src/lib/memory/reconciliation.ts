import { stat } from 'node:fs/promises';
import type { MemoryIdentity } from '@panctl/contracts';
import { Effect } from 'effect';
import {
  getAgentRuntimeState,
  getAgentState,
  type AgentRuntimeState,
  type AgentState,
} from '../agents.js';
import { getTranscriptCheckpoint, listTranscriptCheckpoints, type TranscriptCheckpoint } from './checkpoints.js';
import { extractFromTranscriptDelta, type ExtractFromTranscriptDeltaInput, type ExtractFromTranscriptDeltaResult } from './pipeline.js';
import { getActiveTranscriptEntries, type TranscriptEntry } from './transcript-source.js';

export interface MemoryReconciliationResult {
  scanned: number;
  active: number;
  missing: number;
  empty: number;
  fired: number;
  failed: number;
}

export interface ReconcileTranscriptCheckpointOptions {
  statTranscript?: (path: string) => Promise<{ size: number; mtimeMs: number }>;
  extractFromTranscriptDelta?: (input: ExtractFromTranscriptDeltaInput) => Promise<ExtractFromTranscriptDeltaResult>;
}

export interface ReconcileStaleTranscriptCheckpointsOptions extends ReconcileTranscriptCheckpointOptions {
  limit?: number;
  listCheckpoints?: (limit: number) => TranscriptCheckpoint[];
  getActiveTranscriptEntries?: () => Promise<TranscriptEntry[]>;
  log?: (message: string) => void;
}

type GetAgentState = (agentId: string) => Promise<AgentState | null>;
type GetAgentRuntimeState = (agentId: string) => Promise<AgentRuntimeState | null>;

export interface ReconcileAgentMemoryOptions extends ReconcileTranscriptCheckpointOptions {
  getAgentState?: GetAgentState;
  getAgentRuntimeState?: GetAgentRuntimeState;
  getTranscriptCheckpoint?: typeof getTranscriptCheckpoint;
}

export async function reconcileStaleTranscriptCheckpoints(
  options: ReconcileStaleTranscriptCheckpointsOptions = {},
): Promise<MemoryReconciliationResult> {
  const limit = options.limit ?? 100;
  const checkpoints = (options.listCheckpoints ?? listTranscriptCheckpoints)(limit);
  const activeEntries = await (options.getActiveTranscriptEntries ?? getActiveTranscriptEntries)();
  const activeSessionIds = new Set(activeEntries.map((entry) => entry.sessionId));
  const result = emptyResult();

  for (const checkpoint of checkpoints) {
    result.scanned += 1;
    if (activeSessionIds.has(checkpoint.sessionId)) {
      result.active += 1;
      continue;
    }
    applyOutcome(result, await reconcileTranscriptCheckpoint(checkpoint, options));
  }

  options.log?.(`[memory-reconciliation] scanned=${result.scanned} active=${result.active} fired=${result.fired} empty=${result.empty} missing=${result.missing} failed=${result.failed}`);
  return result;
}

export async function reconcileAgentMemory(
  agentId: string,
  options: ReconcileAgentMemoryOptions = {},
): Promise<MemoryReconciliationResult> {
  const getAgentState = options.getAgentState ?? getAgentStateFromStore;
  const getAgentRuntimeState = options.getAgentRuntimeState ?? getAgentRuntimeStateFromStore;
  const state = await getAgentState(agentId);
  const sessionId = state?.sessionId ?? (await getAgentRuntimeState(agentId))?.claudeSessionId;
  const result = emptyResult();
  if (!sessionId) return result;

  const checkpoint = (options.getTranscriptCheckpoint ?? getTranscriptCheckpoint)(sessionId);
  if (!checkpoint) return result;

  result.scanned = 1;
  applyOutcome(result, await reconcileTranscriptCheckpoint(checkpoint, options));
  return result;
}

export async function reconcileTranscriptCheckpoint(
  checkpoint: TranscriptCheckpoint,
  options: ReconcileTranscriptCheckpointOptions = {},
): Promise<'empty' | 'fired' | 'failed' | 'missing'> {
  let fileStat: { size: number; mtimeMs: number };
  try {
    fileStat = await (options.statTranscript ?? getTranscriptStat)(checkpoint.transcriptPath);
  } catch {
    return 'missing';
  }

  if (fileStat.size <= checkpoint.lastOffset) return 'empty';

  const result = await (options.extractFromTranscriptDelta ?? extractFromTranscriptDelta)({
    sessionId: checkpoint.sessionId,
    transcriptPath: checkpoint.transcriptPath,
    fromOffset: checkpoint.lastOffset,
    toOffset: fileStat.size,
    identity: checkpointIdentity(checkpoint),
    trigger: 'reconciliation',
  });

  if (result.status === 'failed') return 'failed';
  if (result.status === 'written') return 'fired';
  return 'empty';
}

function checkpointIdentity(checkpoint: TranscriptCheckpoint): MemoryIdentity {
  return {
    projectId: checkpoint.projectId,
    workspaceId: checkpoint.workspaceId,
    issueId: checkpoint.issueId,
    runId: checkpoint.sessionId,
    sessionId: checkpoint.sessionId,
    agentRole: 'work',
    agentHarness: 'claude-code',
  };
}

async function getTranscriptStat(path: string): Promise<{ size: number; mtimeMs: number }> {
  const fileStat = await stat(path);
  return { size: fileStat.size, mtimeMs: fileStat.mtimeMs };
}

function getAgentStateFromStore(agentId: string): Promise<AgentState | null> {
  return Effect.runPromise(getAgentState(agentId));
}

function getAgentRuntimeStateFromStore(agentId: string): Promise<AgentRuntimeState | null> {
  return Effect.runPromise(getAgentRuntimeState(agentId));
}

function emptyResult(): MemoryReconciliationResult {
  return { scanned: 0, active: 0, missing: 0, empty: 0, fired: 0, failed: 0 };
}

function applyOutcome(result: MemoryReconciliationResult, outcome: 'empty' | 'fired' | 'failed' | 'missing'): void {
  result[outcome] += 1;
}
