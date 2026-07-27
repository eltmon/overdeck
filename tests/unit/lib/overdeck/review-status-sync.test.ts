import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getReviewStatusFromDbSync,
  upsertReviewStatusSync,
} from '../../../../src/lib/overdeck/review-status-sync.js';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';

describe('overdeck review status sync', () => {
  let odb: OverdeckTestDb;

  beforeEach(() => {
    odb = setupOverdeckTestDb();
  });

  afterEach(() => {
    teardownOverdeckTestDb(odb);
  });

  it('round-trips strike transport backoff state for patrol reloads', () => {
    upsertReviewStatusSync({
      issueId: 'PAN-TRANSPORT-RETRY',
      reviewStatus: 'pending',
      testStatus: 'pending',
      strikeLandingState: 'ready',
      strikeTransportRetryCount: 4,
      strikeNextAttemptAt: '2026-07-22T00:15:00.000Z',
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
    });

    const raw = odb.raw().prepare(
      'SELECT strike_transport_retry_count, strike_next_attempt_at FROM review_status WHERE issue_id = ?',
    ).get('PAN-TRANSPORT-RETRY') as {
      strike_transport_retry_count: number;
      strike_next_attempt_at: number;
    };
    expect(raw.strike_transport_retry_count).toBe(4);
    expect(raw.strike_next_attempt_at).toBe(Date.parse('2026-07-22T00:15:00.000Z'));
    expect(getReviewStatusFromDbSync('PAN-TRANSPORT-RETRY')).toEqual(expect.objectContaining({
      strikeTransportRetryCount: 4,
      strikeNextAttemptAt: '2026-07-22T00:15:00.000Z',
    }));
  });

  it('round-trips the active inspection owner session', () => {
    upsertReviewStatusSync({
      issueId: 'PAN-INSPECT-OWNER',
      reviewStatus: 'pending',
      testStatus: 'pending',
      inspectStatus: 'inspecting',
      inspectBeadId: 'workspace-owner',
      inspectOwnerSession: 'agent-pan-inspect-owner-review-supervisor',
      updatedAt: new Date().toISOString(),
    });

    const raw = odb.raw().prepare(
      'SELECT inspect_owner_session FROM review_status WHERE issue_id = ?',
    ).get('PAN-INSPECT-OWNER') as { inspect_owner_session: string };
    expect(raw.inspect_owner_session).toBe('agent-pan-inspect-owner-review-supervisor');
    expect(getReviewStatusFromDbSync('PAN-INSPECT-OWNER')).toEqual(expect.objectContaining({
      inspectBeadId: 'workspace-owner',
      inspectOwnerSession: 'agent-pan-inspect-owner-review-supervisor',
    }));
  });

  it('round-trips conflictsSince', () => {
    upsertReviewStatusSync({
      issueId: 'PAN-CONFLICTS-SINCE',
      reviewStatus: 'pending',
      testStatus: 'pending',
      conflictsSince: {
        sha: '6ac4a3dc11',
        detectedAt: '2026-07-26T18:58:00.000Z',
        paths: ['scripts/file-size-baseline.txt'],
      },
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
    });

    const raw = odb.raw().prepare(
      'SELECT conflicts_since FROM review_status WHERE issue_id = ?',
    ).get('PAN-CONFLICTS-SINCE') as { conflicts_since: string };
    expect(JSON.parse(raw.conflicts_since)).toEqual({
      sha: '6ac4a3dc11',
      detectedAt: '2026-07-26T18:58:00.000Z',
      paths: ['scripts/file-size-baseline.txt'],
    });
    expect(getReviewStatusFromDbSync('PAN-CONFLICTS-SINCE')).toEqual(expect.objectContaining({
      conflictsSince: {
        sha: '6ac4a3dc11',
        detectedAt: '2026-07-26T18:58:00.000Z',
        paths: ['scripts/file-size-baseline.txt'],
      },
    }));
  });

  it('leaves conflictsSince undefined when never set', () => {
    upsertReviewStatusSync({
      issueId: 'PAN-NO-CONFLICTS',
      reviewStatus: 'pending',
      testStatus: 'pending',
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
    });

    expect(getReviewStatusFromDbSync('PAN-NO-CONFLICTS')?.conflictsSince).toBeUndefined();
  });

  it('clears conflictsSince back to undefined on a subsequent write', () => {
    upsertReviewStatusSync({
      issueId: 'PAN-CLEAR-CONFLICTS',
      reviewStatus: 'pending',
      testStatus: 'pending',
      conflictsSince: {
        sha: '6ac4a3dc11',
        detectedAt: '2026-07-26T18:58:00.000Z',
        paths: ['a.txt'],
      },
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
    });
    upsertReviewStatusSync({
      issueId: 'PAN-CLEAR-CONFLICTS',
      reviewStatus: 'pending',
      testStatus: 'pending',
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
    });

    expect(getReviewStatusFromDbSync('PAN-CLEAR-CONFLICTS')?.conflictsSince).toBeUndefined();
  });
});
