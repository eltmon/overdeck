/**
 * Sync primitives for transcript_checkpoints in overdeck.db.
 *
 * Mirrors the surface of database/transcript-checkpoint-db.ts but uses
 * getOverdeckDatabaseSync() instead of getDatabase().
 *
 * Schema differences vs old DB:
 * - Timestamps stored as integer unix seconds (not ISO text)
 * - last_observation_at dropped (zero reads; overdeck-schema.ts:387)
 */
import { randomUUID } from 'node:crypto';
import { getOverdeckDatabaseSync } from './infra.js';

export type TranscriptClaimTrigger = 'stop-hook' | 'poller' | 'reconciliation' | 'manual';

const CLAIM_EXPIRY_MS = 60_000;

export interface TranscriptCheckpoint {
  sessionId: string;
  /** Nullable in overdeck.db schema; returned as empty string when NULL. */
  projectId: string;
  workspaceId: string;
  issueId: string;
  transcriptPath: string;
  lastOffset: number;
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
  identity: { projectId: string; workspaceId: string; issueId: string };
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

// ── Row type from overdeck (unix-int timestamps) ─────────────────────────────

interface DbRow {
  session_id: string;
  transcript_path: string;
  last_offset: number;
  mid_turn_count_in_current_turn: number;
  last_mid_turn_at: number | null;
  updated_at: number;
  claim_owner: string | null;
  claim_from: number | null;
  claim_to: number | null;
  claim_expires_at: number | null;
  project_id: string | null;   // nullable in overdeck schema
  workspace_id: string | null; // nullable in overdeck schema
  issue_id: string | null;     // nullable in overdeck schema
}

function toIso(unixSecs: number | null): string | null {
  if (unixSecs === null || unixSecs === undefined) return null;
  return new Date(unixSecs * 1000).toISOString();
}

function toSecs(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

function rowToCheckpoint(row: DbRow): TranscriptCheckpoint {
  return {
    sessionId: row.session_id,
    transcriptPath: row.transcript_path,
    lastOffset: row.last_offset,
    midTurnCountInCurrentTurn: row.mid_turn_count_in_current_turn ?? 0,
    lastMidTurnAt: toIso(row.last_mid_turn_at),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
    claimOwner: row.claim_owner,
    claimFrom: row.claim_from,
    claimTo: row.claim_to,
    claimExpiresAt: toIso(row.claim_expires_at),
    // Default null to empty string to maintain the non-nullable API contract.
    projectId: row.project_id ?? '',
    workspaceId: row.workspace_id ?? '',
    issueId: row.issue_id ?? '',
  };
}

function isValidOffset(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export function claimTranscriptRange(input: ClaimTranscriptRangeInput): ClaimTranscriptRangeResult {
  if (!isValidOffset(input.expectedFromOffset) || !isValidOffset(input.toOffset) || input.toOffset <= input.expectedFromOffset) {
    return { status: 'empty', reason: 'invalid-range' };
  }

  const db = getOverdeckDatabaseSync();
  const nowDate = input.now ?? new Date();
  const nowSecs = toSecs(nowDate);
  const expirySecs = toSecs(new Date(nowDate.getTime() + CLAIM_EXPIRY_MS));

  const insertInitial = db.prepare(`
    INSERT INTO transcript_checkpoints (
      session_id, transcript_path, last_offset,
      project_id, workspace_id, issue_id,
      mid_turn_count_in_current_turn, updated_at
    )
    SELECT ?, ?, 0, ?, ?, ?, 0, ?
    WHERE ? = 0
    ON CONFLICT(session_id) DO NOTHING
  `);

  const owner = `claim-${randomUUID()}`;
  const claim = db.prepare(`
    UPDATE transcript_checkpoints
    SET
      claim_owner = ?,
      claim_from = ?,
      claim_to = ?,
      claim_expires_at = ?,
      updated_at = ?
    WHERE session_id = ?
      AND last_offset = ?
      AND (claim_owner IS NULL OR claim_expires_at < ?)
    RETURNING
      session_id, transcript_path, last_offset,
      mid_turn_count_in_current_turn, last_mid_turn_at, updated_at,
      claim_owner, claim_from, claim_to, claim_expires_at,
      project_id, workspace_id, issue_id
  `);

  const runClaim = db.transaction(() => {
    insertInitial.run(
      input.sessionId,
      input.transcriptPath,
      input.identity.projectId,
      input.identity.workspaceId,
      input.identity.issueId,
      nowSecs,
      input.expectedFromOffset,
    );
    return claim.get(
      owner,
      input.expectedFromOffset,
      input.toOffset,
      expirySecs,
      nowSecs,
      input.sessionId,
      input.expectedFromOffset,
      nowSecs,
    ) as DbRow | undefined;
  });

  const row = runClaim();
  if (!row) {
    const existing = db
      .prepare(`SELECT claim_owner, claim_expires_at FROM transcript_checkpoints WHERE session_id = ?`)
      .get(input.sessionId) as { claim_owner: string | null; claim_expires_at: number | null } | undefined;
    if (existing && existing.claim_owner && (existing.claim_expires_at ?? 0) >= nowSecs) {
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

  const db = getOverdeckDatabaseSync();
  const nowSecs = toSecs(input.now ?? new Date());
  const trigger = input.trigger ?? 'manual';

  const row = db.prepare(`
    UPDATE transcript_checkpoints
    SET
      project_id = ?,
      workspace_id = ?,
      issue_id = ?,
      transcript_path = ?,
      last_offset = ?,
      last_mid_turn_at = CASE
        WHEN ? = 'stop-hook' THEN NULL
        WHEN ? = 'poller' THEN ?
        ELSE last_mid_turn_at
      END,
      mid_turn_count_in_current_turn = CASE
        WHEN ? = 'stop-hook' THEN 0
        WHEN ? = 'poller' THEN mid_turn_count_in_current_turn + 1
        ELSE mid_turn_count_in_current_turn
      END,
      claim_owner = NULL,
      claim_from = NULL,
      claim_to = NULL,
      claim_expires_at = NULL,
      updated_at = ?
    WHERE session_id = ?
      AND last_offset = ?
      AND claim_owner IS NOT NULL
    RETURNING
      session_id, transcript_path, last_offset,
      mid_turn_count_in_current_turn, last_mid_turn_at, updated_at,
      claim_owner, claim_from, claim_to, claim_expires_at,
      project_id, workspace_id, issue_id
  `).get(
    input.identity.projectId,
    input.identity.workspaceId,
    input.identity.issueId,
    input.transcriptPath,
    input.consumedOffset,
    trigger, trigger, nowSecs,   // last_mid_turn_at CASE
    trigger, trigger,             // mid_turn_count CASE
    nowSecs,
    input.sessionId,
    input.expectedFromOffset,
  ) as DbRow | undefined;

  if (!row) {
    const existing = db
      .prepare(`SELECT last_offset, claim_owner FROM transcript_checkpoints WHERE session_id = ?`)
      .get(input.sessionId) as { last_offset: number; claim_owner: string | null } | undefined;
    if (existing && existing.last_offset !== input.expectedFromOffset) {
      return { status: 'empty', reason: 'offset-mismatch' };
    }
    return { status: 'empty', reason: 'no-active-claim' };
  }

  return { status: 'committed', checkpoint: rowToCheckpoint(row) };
}

export function releaseTranscriptRange(sessionId: string, expectedFromOffset: number, toOffset: number): void {
  getOverdeckDatabaseSync().prepare(`
    UPDATE transcript_checkpoints
    SET claim_owner = NULL,
        claim_from = NULL,
        claim_to = NULL,
        claim_expires_at = NULL
    WHERE session_id = ?
      AND claim_owner IS NOT NULL
      AND claim_from = ?
      AND claim_to = ?
  `).run(sessionId, expectedFromOffset, toOffset);
}

export function listTranscriptCheckpoints(limit = 100): TranscriptCheckpoint[] {
  const rows = getOverdeckDatabaseSync()
    .prepare(`
      SELECT
        session_id, transcript_path, last_offset,
        mid_turn_count_in_current_turn, last_mid_turn_at, updated_at,
        claim_owner, claim_from, claim_to, claim_expires_at,
        project_id, workspace_id, issue_id
      FROM transcript_checkpoints
      ORDER BY updated_at ASC
      LIMIT ?
    `)
    .all(Math.max(0, Math.floor(limit))) as DbRow[];
  return rows.map(rowToCheckpoint);
}

export function getTranscriptCheckpoint(sessionId: string): TranscriptCheckpoint | null {
  const row = getOverdeckDatabaseSync()
    .prepare(`
      SELECT
        session_id, transcript_path, last_offset,
        mid_turn_count_in_current_turn, last_mid_turn_at, updated_at,
        claim_owner, claim_from, claim_to, claim_expires_at,
        project_id, workspace_id, issue_id
      FROM transcript_checkpoints
      WHERE session_id = ?
    `)
    .get(sessionId) as DbRow | undefined;
  return row ? rowToCheckpoint(row) : null;
}
