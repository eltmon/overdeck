import { randomUUID } from 'crypto';
import type { MemoryIdentity } from '@panctl/contracts';
import { getDatabase } from '../database/index.js';

export type TranscriptClaimTrigger = 'stop-hook' | 'poller' | 'reconciliation' | 'manual';

const CLAIM_EXPIRY_MS = 60_000;

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
  claimOwner: string | null;
  claimFrom: number | null;
  claimTo: number | null;
  claimExpiresAt: string | null;
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
  | { status: 'empty'; reason: 'invalid-range' | 'offset-mismatch' | 'already-claimed' };

export type CommitTranscriptRangeResult =
  | { status: 'committed'; checkpoint: TranscriptCheckpoint }
  | { status: 'empty'; reason: 'invalid-range' | 'offset-mismatch' | 'no-active-claim' };

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
  claim_owner: string | null;
  claim_from: number | null;
  claim_to: number | null;
  claim_expires_at: string | null;
}

export function claimTranscriptRange(input: ClaimTranscriptRangeInput): ClaimTranscriptRangeResult {
  if (!isValidOffset(input.expectedFromOffset) || !isValidOffset(input.toOffset) || input.toOffset <= input.expectedFromOffset) {
    return { status: 'empty', reason: 'invalid-range' };
  }

  const db = getDatabase();
  const now = (input.now ?? new Date()).toISOString();
  const expiry = new Date((input.now ?? new Date()).getTime() + CLAIM_EXPIRY_MS).toISOString();
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

  const owner = `claim-${cryptoRandomUUID()}`;
  const claim = db.prepare(`
    UPDATE transcript_checkpoints
    SET
      claim_owner = @owner,
      claim_from = @expectedFromOffset,
      claim_to = @toOffset,
      claim_expires_at = @expiry,
      updated_at = @now
    WHERE session_id = @sessionId
      AND last_offset = @expectedFromOffset
      AND (claim_owner IS NULL OR claim_expires_at < @now)
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
      updated_at,
      claim_owner,
      claim_from,
      claim_to,
      claim_expires_at
  `);

  const runClaim = db.transaction(() => {
    insertInitialCheckpoint.run(bind(input, now));
    return claim.get({ ...bind(input, now), owner, expiry }) as TranscriptCheckpointRow | undefined;
  });

  const row = runClaim();
  if (!row) {
    const existing = db.prepare(`
      SELECT claim_owner, claim_expires_at FROM transcript_checkpoints WHERE session_id = ?
    `).get(input.sessionId) as { claim_owner: string | null; claim_expires_at: string | null } | undefined;
    if (existing && existing.claim_owner && (existing.claim_expires_at ?? '9999') >= now) {
      return { status: 'empty', reason: 'already-claimed' };
    }
    return { status: 'empty', reason: 'offset-mismatch' };
  }

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
      claim_owner = NULL,
      claim_from = NULL,
      claim_to = NULL,
      claim_expires_at = NULL,
      updated_at = @now
    WHERE session_id = @sessionId
      AND last_offset = @expectedFromOffset
      AND claim_owner IS NOT NULL
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
      updated_at,
      claim_owner,
      claim_from,
      claim_to,
      claim_expires_at
  `);

  const row = commit.get({ ...bind(input, now), consumedOffset: input.consumedOffset }) as TranscriptCheckpointRow | undefined;
  if (!row) {
    const existing = db.prepare(`SELECT last_offset, claim_owner FROM transcript_checkpoints WHERE session_id = ?`).get(input.sessionId) as { last_offset: number; claim_owner: string | null } | undefined;
    if (existing && existing.last_offset !== input.expectedFromOffset) {
      return { status: 'empty', reason: 'offset-mismatch' };
    }
    return { status: 'empty', reason: 'no-active-claim' };
  }
  return { status: 'committed', checkpoint: rowToCheckpoint(row) };
}

export function releaseTranscriptRange(sessionId: string, _expectedFromOffset: number, _toOffset: number): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE transcript_checkpoints
    SET claim_owner = NULL,
        claim_from = NULL,
        claim_to = NULL,
        claim_expires_at = NULL
    WHERE session_id = ?
      AND claim_owner IS NOT NULL
  `).run(sessionId);
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
        updated_at,
        claim_owner,
        claim_from,
        claim_to,
        claim_expires_at
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
        updated_at,
        claim_owner,
        claim_from,
        claim_to,
        claim_expires_at
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
    claimOwner: row.claim_owner,
    claimFrom: row.claim_from,
    claimTo: row.claim_to,
    claimExpiresAt: row.claim_expires_at,
  };
}

function isValidOffset(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function cryptoRandomUUID(): string {
  try {
    return randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
