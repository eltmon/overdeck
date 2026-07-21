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
