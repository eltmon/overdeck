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
});
