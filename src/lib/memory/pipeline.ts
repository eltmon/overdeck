import { createHash } from 'crypto';
import type { MemoryIdentity, MemoryObservation, PendingTurn } from '@panctl/contracts';
import {
  claimTranscriptRange,
  commitTranscriptRange,
  getTranscriptCheckpoint,
  releaseTranscriptRange,
  type ClaimTranscriptRangeResult,
  type CommitTranscriptRangeResult,
  type TranscriptClaimTrigger,
} from './checkpoints.js';
import { compressTranscriptDelta, type CompressedTranscriptDelta } from './compress.js';
import {
  extractObservationFromTurn,
  type ExtractObservationInput,
  type ExtractObservationResult,
} from './extract.js';
import { updateMemoryHealth, type MemoryHealthUpdate } from './health.js';
import { writeObservation, type WriteObservationResult } from './observations.js';
import {
  maybeTriggerStatusRollup,
  writePendingTurn,
  type StatusRollupTriggerOptions,
  type StatusRollupTriggerResult,
  type WritePendingTurnResult,
} from './pending.js';
import { isSubagentHookPayload } from './subagent-filter.js';

export interface ExtractFromTranscriptDeltaInput {
  sessionId: string;
  transcriptPath: string;
  fromOffset?: number;
  toOffset: number;
  identity: MemoryIdentity;
  trigger: TranscriptClaimTrigger;
  hookPayload?: unknown;
  gitBranch?: string;
  previousObservations?: ExtractObservationInput['previousObservations'];
  settings?: ExtractObservationInput['settings'];
  perDayCostCapUsd?: ExtractObservationInput['perDayCostCapUsd'];
  now?: Date;
  id?: string;
  claimRange?: PipelineClaimRange;
  commitRange?: PipelineCommitRange;
  releaseRange?: PipelineReleaseRange;
  compress?: PipelineCompress;
  extract?: ExtractObservationInput['extract'];
  writeObservation?: PipelineWriteObservation;
  writePendingTurn?: PipelineWritePendingTurn;
  maybeTriggerRollup?: PipelineMaybeTriggerRollup;
  updateHealth?: PipelineUpdateHealth;
  emitObservationCreated?: PipelineEmitObservationCreated;
  rollupOptions?: StatusRollupTriggerOptions;
}

export type ExtractFromTranscriptDeltaResult =
  | {
      status: 'written';
      observation: MemoryObservation;
      reason: null;
      pendingTurn: PendingTurn;
      writeResult: WriteObservationResult;
      pendingResult: WritePendingTurnResult;
      rollupResult: StatusRollupTriggerResult;
    }
  | { status: 'noop'; observation: null; reason: 'subagent' | 'invalid-range' | 'offset-mismatch' | 'empty-delta' }
  | { status: 'skipped'; observation: null; reason: Extract<ExtractObservationResult, { status: 'skipped' }>['reason'] }
  | { status: 'dropped'; observation: null; reason: Extract<ExtractObservationResult, { status: 'dropped' }>['reason'] }
  | { status: 'failed'; observation: null; reason: 'claim-failed' | 'compress-failed' | 'write-failed' | 'pending-write-failed' | 'event-emit-failed' | 'rollup-failed' | 'checkpoint-commit-failed' | 'pipeline-error' };

export type PipelineClaimRange = (input: {
  sessionId: string;
  expectedFromOffset: number;
  toOffset: number;
  transcriptPath: string;
  identity: Pick<MemoryIdentity, 'projectId' | 'workspaceId' | 'issueId'>;
  trigger: TranscriptClaimTrigger;
  now?: Date;
}) => ClaimTranscriptRangeResult;
export type PipelineCommitRange = (input: {
  sessionId: string;
  expectedFromOffset: number;
  toOffset: number;
  consumedOffset: number;
  transcriptPath: string;
  identity: Pick<MemoryIdentity, 'projectId' | 'workspaceId' | 'issueId'>;
  trigger: TranscriptClaimTrigger;
  now?: Date;
}) => CommitTranscriptRangeResult;
export type PipelineReleaseRange = (sessionId: string, expectedFromOffset: number, toOffset: number) => void;
export type PipelineCompress = (input: { transcriptPath: string; fromOffset: number; toOffset: number }) => Promise<CompressedTranscriptDelta>;
export type PipelineWriteObservation = (observation: MemoryObservation) => Promise<WriteObservationResult>;
export type PipelineWritePendingTurn = (turn: PendingTurn, options?: StatusRollupTriggerOptions) => Promise<WritePendingTurnResult>;
export type PipelineMaybeTriggerRollup = (identity: MemoryIdentity, options?: StatusRollupTriggerOptions) => Promise<StatusRollupTriggerResult>;
export type PipelineUpdateHealth = (identity: MemoryIdentity, update: MemoryHealthUpdate) => Promise<unknown>;
export type PipelineEmitObservationCreated = (observation: MemoryObservation, timestamp: string) => Promise<void> | void;

export async function extractFromTranscriptDelta(input: ExtractFromTranscriptDeltaInput): Promise<ExtractFromTranscriptDeltaResult> {
  if (isSubagentHookPayload(input.hookPayload)) return { status: 'noop', observation: null, reason: 'subagent' };

  const updateHealthStage = input.updateHealth ?? updateMemoryHealth;
  const recordHealth = async (update: MemoryHealthUpdate) => {
    try {
      await updateHealthStage(input.identity, update);
    } catch {
      // Health telemetry must not make the transcript pipeline throw.
    }
  };

  let claimedRange: Extract<ClaimTranscriptRangeResult, { status: 'claimed' }> | null = null;
  let checkpointCommitted = false;

  try {
    const claimed = await safeClaim(input);
    if (claimed.status === 'failed') {
      await recordHealth({ status: 'failing', reason: claimed.reason, success: false });
      return { status: 'failed', observation: null, reason: claimed.reason };
    }
    if (claimed.result.status === 'empty') return { status: 'noop', observation: null, reason: claimed.result.reason };
    claimedRange = claimed.result;

    const compressed = await safeCompress(input, claimed.result.fromOffset, claimed.result.toOffset);
    if (compressed.status === 'failed') {
      await recordHealth({ status: 'failing', reason: 'compress-failed', success: false });
      return { status: 'failed', observation: null, reason: 'compress-failed' };
    }
    if (compressed.result.eventsConsumed === 0 || compressed.result.text.trim().length === 0) {
      const committed = await safeCommit(input, claimed.result, compressed.result.lastFullLineOffset);
      if (committed.status === 'failed' || (committed.status === 'empty' && committed.result.reason !== 'offset-mismatch')) {
        await recordHealth({ status: 'failing', reason: 'checkpoint-commit-failed', success: false });
        return { status: 'failed', observation: null, reason: 'checkpoint-commit-failed' };
      }
      if (committed.status === 'empty') return { status: 'noop', observation: null, reason: committed.result.reason };
      checkpointCommitted = true;
      return { status: 'noop', observation: null, reason: 'empty-delta' };
    }

    const extracted = await extractObservationFromTurn({
      compressedText: compressed.result.text,
      identity: input.identity,
      gitBranch: input.gitBranch ?? '',
      sourceTranscriptOffset: claimed.result.fromOffset,
      previousObservations: input.previousObservations,
      settings: input.settings,
      perDayCostCapUsd: input.perDayCostCapUsd,
      now: input.now,
      id: input.id ?? deterministicObservationId(input.sessionId, claimed.result.fromOffset),
      extract: input.extract,
    });

    if (extracted.status === 'skipped') {
      const committed = await safeCommit(input, claimed.result, compressed.result.lastFullLineOffset);
      if (committed.status === 'failed' || (committed.status === 'empty' && committed.result.reason !== 'offset-mismatch')) {
        await recordHealth({ status: 'failing', reason: 'checkpoint-commit-failed', success: false });
        return { status: 'failed', observation: null, reason: 'checkpoint-commit-failed' };
      }
      if (committed.status === 'empty') return { status: 'noop', observation: null, reason: committed.result.reason };
      checkpointCommitted = true;
      await recordHealth({ status: 'degraded', reason: extracted.reason, success: false });
      return { status: 'skipped', observation: null, reason: extracted.reason };
    }

    if (extracted.status === 'dropped') {
      const committed = await safeCommit(input, claimed.result, compressed.result.lastFullLineOffset);
      if (committed.status === 'failed' || (committed.status === 'empty' && committed.result.reason !== 'offset-mismatch')) {
        await recordHealth({ status: 'failing', reason: 'checkpoint-commit-failed', success: false });
        return { status: 'failed', observation: null, reason: 'checkpoint-commit-failed' };
      }
      if (committed.status === 'empty') return { status: 'noop', observation: null, reason: committed.result.reason };
      checkpointCommitted = true;
      await recordHealth({ status: 'failing', reason: extracted.reason, success: false });
      return { status: 'dropped', observation: null, reason: extracted.reason };
    }

    const writeObservationStage = input.writeObservation ?? writeObservation;
    let writeResult: WriteObservationResult;
    try {
      writeResult = await writeObservationStage(extracted.observation);
    } catch {
      await recordHealth({ status: 'failing', reason: 'write-failed', success: false });
      return { status: 'failed', observation: null, reason: 'write-failed' };
    }

    const pendingTurn = buildPendingTurn(input, claimed.result.fromOffset, claimed.result.toOffset, compressed.result);
    const writePendingStage = input.writePendingTurn ?? writePendingTurn;
    let pendingResult: WritePendingTurnResult;
    try {
      pendingResult = await writePendingStage(pendingTurn, { ...input.rollupOptions, triggerRollup: false });
    } catch {
      await recordHealth({ status: 'failing', reason: 'pending-write-failed', success: false });
      return { status: 'failed', observation: null, reason: 'pending-write-failed' };
    }

    try {
      await (input.emitObservationCreated ?? emitMemoryObservationCreated)(extracted.observation, extracted.observation.timestamp);
    } catch {
      await recordHealth({ status: 'failing', reason: 'event-emit-failed', success: false });
      return { status: 'failed', observation: null, reason: 'event-emit-failed' };
    }

    const maybeTriggerRollupStage = input.maybeTriggerRollup ?? maybeTriggerStatusRollup;
    let rollupResult: StatusRollupTriggerResult;
    try {
      rollupResult = await maybeTriggerRollupStage(input.identity, input.rollupOptions);
    } catch {
      await recordHealth({ status: 'failing', reason: 'rollup-failed', success: false });
      return { status: 'failed', observation: null, reason: 'rollup-failed' };
    }

    const committed = await safeCommit(input, claimed.result, compressed.result.lastFullLineOffset);
    if (committed.status === 'failed') {
      await recordHealth({ status: 'failing', reason: 'checkpoint-commit-failed', success: false });
      return { status: 'failed', observation: null, reason: 'checkpoint-commit-failed' };
    }
    checkpointCommitted = true;

    await recordHealth({ status: 'healthy', success: true });
    return {
      status: 'written',
      observation: extracted.observation,
      reason: null,
      pendingTurn,
      writeResult,
      pendingResult,
      rollupResult,
    };
  } catch {
    await recordHealth({ status: 'failing', reason: 'pipeline-error', success: false });
    return { status: 'failed', observation: null, reason: 'pipeline-error' };
  } finally {
    if (claimedRange && !checkpointCommitted) {
      const release = input.releaseRange ?? releaseTranscriptRange;
      release(input.sessionId, claimedRange.fromOffset, claimedRange.toOffset);
    }
  }
}

function deterministicObservationId(sessionId: string, fromOffset: number): string {
  const digest = createHash('sha256').update(`${sessionId}:${fromOffset}`).digest('hex').slice(0, 32);
  return `obs-${digest}`;
}

function deterministicPendingTurnId(sessionId: string, fromOffset: number, toOffset: number): string {
  const digest = createHash('sha256').update(`${sessionId}:${fromOffset}:${toOffset}`).digest('hex').slice(0, 32);
  return `pending-${digest}`;
}

async function safeClaim(input: ExtractFromTranscriptDeltaInput): Promise<
  | { status: 'claimed'; result: ClaimTranscriptRangeResult }
  | { status: 'failed'; reason: 'claim-failed' }
> {
  try {
    const claim = input.claimRange ?? claimTranscriptRange;
    return {
      status: 'claimed',
      result: claim({
        sessionId: input.sessionId,
        expectedFromOffset: input.fromOffset ?? getTranscriptCheckpoint(input.sessionId)?.lastOffset ?? 0,
        toOffset: input.toOffset,
        transcriptPath: input.transcriptPath,
        identity: input.identity,
        trigger: input.trigger,
        now: input.now,
      }),
    };
  } catch {
    return { status: 'failed', reason: 'claim-failed' };
  }
}

async function safeCompress(input: ExtractFromTranscriptDeltaInput, fromOffset: number, toOffset: number): Promise<
  | { status: 'compressed'; result: CompressedTranscriptDelta }
  | { status: 'failed' }
> {
  try {
    const compress = input.compress ?? compressTranscriptDelta;
    return { status: 'compressed', result: await compress({ transcriptPath: input.transcriptPath, fromOffset, toOffset }) };
  } catch {
    return { status: 'failed' };
  }
}

async function safeCommit(
  input: ExtractFromTranscriptDeltaInput,
  claimed: Extract<ClaimTranscriptRangeResult, { status: 'claimed' }>,
  consumedOffset: number,
): Promise<
  | { status: 'committed'; result: Extract<CommitTranscriptRangeResult, { status: 'committed' }> }
  | { status: 'empty'; result: Extract<CommitTranscriptRangeResult, { status: 'empty' }> }
  | { status: 'failed' }
> {
  try {
    const commit = input.commitRange ?? commitTranscriptRange;
    const result = commit({
      sessionId: input.sessionId,
      expectedFromOffset: claimed.fromOffset,
      toOffset: claimed.toOffset,
      consumedOffset,
      transcriptPath: input.transcriptPath,
      identity: input.identity,
      trigger: input.trigger,
      now: input.now,
    });
    return result.status === 'committed'
      ? { status: 'committed', result }
      : { status: 'empty', result };
  } catch {
    return { status: 'failed' };
  }
}

function buildPendingTurn(
  input: ExtractFromTranscriptDeltaInput,
  fromOffset: number,
  toOffset: number,
  compressed: CompressedTranscriptDelta,
): PendingTurn {
  return {
    id: deterministicPendingTurnId(input.sessionId, fromOffset, toOffset),
    createdAt: (input.now ?? new Date()).toISOString(),
    identity: input.identity,
    trigger: input.trigger,
    transcriptPath: input.transcriptPath,
    fromOffset,
    toOffset,
    lastFullLineOffset: compressed.lastFullLineOffset,
    eventsConsumed: compressed.eventsConsumed,
    compressedText: compressed.text,
  };
}

async function emitMemoryObservationCreated(observation: MemoryObservation, timestamp: string): Promise<void> {
  const { initEventStore } = await import('../../dashboard/server/event-store.js');
  const store = await initEventStore();
  await store.appendAsync({
    type: 'memory.observation_created',
    timestamp,
    payload: { observation },
  });
}
