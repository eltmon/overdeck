import type { MemoryIdentity } from '@panctl/contracts';
import { getDatabase } from '../database/index.js';

export type TranscriptClaimTrigger = 'stop-hook' | 'poller' | 'reconciliation' | 'manual';

export interface TranscriptCheckpoint {
  sessionId: string;
  projectId: string;
  workspaceId: string;
  issueId: string;
  transcriptPath: string;
  lastOffset: number;
  lastObservationAt: string | null;
  lastMidTurnAt: string | null;
  midTurnCountInCurrentTurn: number;
  updatedAt: string;
}

export interface ClaimTranscriptRangeInput {
  sessionId: string;
  expectedFromOffset: number;
  toOffset: number;
  transcriptPath: string;
  identity: Pick<MemoryIdentity, 'projectId' | 'workspaceId' | 'issueId'>;
  trigger?: TranscriptClaimTrigger;
  now?: Date;
}

export interface CommitTranscriptRangeInput extends ClaimTranscriptRangeInput {
  consumedOffset: number;
}

export type ClaimTranscriptRangeResult =
  | {
      status: 'claimed';
      fromOffset: number;
      toOffset: number;
      checkpoint: TranscriptCheckpoint;
    }
  | { status: 'empty'; reason: 'invalid-range' | 'offset-mismatch' };

export type CommitTranscriptRangeResult =
  | { status: 'committed'; checkpoint: TranscriptCheckpoint }
  | { status: 'empty'; reason: 'invalid-range' | 'offset-mismatch' };

const reservedRanges = new Map<string, string>();

interface TranscriptCheckpointRow {
  session_id: string;
  project_id: string;
  workspace_id: string;
  issue_id: string;
  transcript_path: string;
  last_offset: number;
  last_observation_at: string | null;
  last_mid_turn_at: string | null;
  mid_turn_count_in_current_turn: number;
  updated_at: string;
}

export function claimTranscriptRange(input: ClaimTranscriptRangeInput): ClaimTranscriptRangeResult {
  if (!isValidOffset(input.expectedFromOffset) || !isValidOffset(input.toOffset) || input.toOffset <= input.expectedFromOffset) {
    return { status: 'empty', reason: 'invalid-range' };
  }

  const db = getDatabase();
  const now = (input.now ?? new Date()).toISOString();
  const insertInitialCheckpoint = db.prepare(`
    INSERT INTO transcript_checkpoints (
      session_id,
      project_id,
      workspace_id,
      issue_id,
      transcript_path,
      last_offset,
      updated_at
    )
    SELECT @sessionId, @projectId, @workspaceId, @issueId, @transcriptPath, 0, @now
    WHERE @expectedFromOffset = 0
    ON CONFLICT(session_id) DO NOTHING
  `);
  const claim = db.prepare(`
    SELECT
      session_id,
      project_id,
      workspace_id,
      issue_id,
      transcript_path,
      last_offset,
      last_observation_at,
      last_mid_turn_at,
      mid_turn_count_in_current_turn,
      updated_at
    FROM transcript_checkpoints
    WHERE session_id = @sessionId
      AND last_offset = @expectedFromOffset
  `);

  const reservationKey = rangeKey(input.sessionId, input.expectedFromOffset);
  if (reservedRanges.has(reservationKey)) return { status: 'empty', reason: 'offset-mismatch' };

  const runClaim = db.transaction(() => {
    insertInitialCheckpoint.run(bind(input, now));
    return claim.get(bind(input, now)) as TranscriptCheckpointRow | undefined;
  });

  const row = runClaim();
  if (!row) return { status: 'empty', reason: 'offset-mismatch' };
  reservedRanges.set(reservationKey, rangeValue(input.toOffset));

  return {
    status: 'claimed',
    fromOffset: input.expectedFromOffset,
    toOffset: input.toOffset,
    checkpoint: rowToCheckpoint(row),
  };
}

export function commitTranscriptRange(input: CommitTranscriptRangeInput): CommitTranscriptRangeResult {
  if (
    !isValidOffset(input.expectedFromOffset)
    || !isValidOffset(input.toOffset)
    || !isValidOffset(input.consumedOffset)
    || input.toOffset <= input.expectedFromOffset
    || input.consumedOffset < input.expectedFromOffset
    || input.consumedOffset > input.toOffset
  ) {
    return { status: 'empty', reason: 'invalid-range' };
  }

  const reservationKey = rangeKey(input.sessionId, input.expectedFromOffset);
  if (reservedRanges.get(reservationKey) !== rangeValue(input.toOffset)) return { status: 'empty', reason: 'offset-mismatch' };

  const db = getDatabase();
  const now = (input.now ?? new Date()).toISOString();
  const commit = db.prepare(`
    UPDATE transcript_checkpoints
    SET
      project_id = @projectId,
      workspace_id = @workspaceId,
      issue_id = @issueId,
      transcript_path = @transcriptPath,
      last_offset = @consumedOffset,
      last_observation_at = @now,
      last_mid_turn_at = CASE
        WHEN @trigger = 'stop-hook' THEN NULL
        WHEN @trigger = 'poller' THEN @now
        ELSE last_mid_turn_at
      END,
      mid_turn_count_in_current_turn = CASE
        WHEN @trigger = 'stop-hook' THEN 0
        WHEN @trigger = 'poller' THEN mid_turn_count_in_current_turn + 1
        ELSE mid_turn_count_in_current_turn
      END,
      updated_at = @now
    WHERE session_id = @sessionId
      AND last_offset = @expectedFromOffset
    RETURNING
      session_id,
      project_id,
      workspace_id,
      issue_id,
      transcript_path,
      last_offset,
      last_observation_at,
      last_mid_turn_at,
      mid_turn_count_in_current_turn,
      updated_at
  `);

  try {
    const row = commit.get({ ...bind(input, now), consumedOffset: input.consumedOffset }) as TranscriptCheckpointRow | undefined;
    if (!row) return { status: 'empty', reason: 'offset-mismatch' };
    return { status: 'committed', checkpoint: rowToCheckpoint(row) };
  } finally {
    reservedRanges.delete(reservationKey);
  }
}

export function releaseTranscriptRange(sessionId: string, expectedFromOffset: number, toOffset: number): void {
  const reservationKey = rangeKey(sessionId, expectedFromOffset);
  if (reservedRanges.get(reservationKey) === rangeValue(toOffset)) reservedRanges.delete(reservationKey);
}

export function listTranscriptCheckpoints(limit = 100): TranscriptCheckpoint[] {
  const rows = getDatabase()
    .prepare(`
      SELECT
        session_id,
        project_id,
        workspace_id,
        issue_id,
        transcript_path,
        last_offset,
        last_observation_at,
        last_mid_turn_at,
        mid_turn_count_in_current_turn,
        updated_at
      FROM transcript_checkpoints
      ORDER BY updated_at ASC
      LIMIT ?
    `)
    .all(Math.max(0, Math.floor(limit))) as TranscriptCheckpointRow[];
  return rows.map(rowToCheckpoint);
}

export function getTranscriptCheckpoint(sessionId: string): TranscriptCheckpoint | null {
  const row = getDatabase()
    .prepare(`
      SELECT
        session_id,
        project_id,
        workspace_id,
        issue_id,
        transcript_path,
        last_offset,
        last_observation_at,
        last_mid_turn_at,
        mid_turn_count_in_current_turn,
        updated_at
      FROM transcript_checkpoints
      WHERE session_id = ?
    `)
    .get(sessionId) as TranscriptCheckpointRow | undefined;
  return row ? rowToCheckpoint(row) : null;
}

function bind(input: ClaimTranscriptRangeInput, now: string) {
  return {
    sessionId: input.sessionId,
    projectId: input.identity.projectId,
    workspaceId: input.identity.workspaceId,
    issueId: input.identity.issueId,
    transcriptPath: input.transcriptPath,
    expectedFromOffset: input.expectedFromOffset,
    toOffset: input.toOffset,
    trigger: input.trigger ?? 'manual',
    now,
  };
}

function rangeKey(sessionId: string, fromOffset: number): string {
  return `${sessionId}:${fromOffset}`;
}

function rangeValue(toOffset: number): string {
  return String(toOffset);
}

function rowToCheckpoint(row: TranscriptCheckpointRow): TranscriptCheckpoint {
  return {
    sessionId: row.session_id,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    issueId: row.issue_id,
    transcriptPath: row.transcript_path,
    lastOffset: row.last_offset,
    lastObservationAt: row.last_observation_at,
    lastMidTurnAt: row.last_mid_turn_at,
    midTurnCountInCurrentTurn: row.mid_turn_count_in_current_turn,
    updatedAt: row.updated_at,
  };
}

function isValidOffset(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}
