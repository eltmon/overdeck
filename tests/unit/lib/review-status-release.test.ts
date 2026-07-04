import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../helpers/overdeck-test-db.js';

const mockNotifyPipeline = vi.fn();

vi.mock('../../../src/lib/pipeline-notifier.js', () => ({
  notifyPipeline: vi.fn(),
  notifyPipelineSync: (...args: unknown[]) => mockNotifyPipeline(...args),
}));

vi.mock('../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  emitActivityTts: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

import {
  getReviewStatusSync,
  setReviewStatusSync,
} from '../../../src/lib/review-status.js';
import {
  getReviewStatusSync as getJsonReviewStatusSync,
  setReviewStatusSync as setJsonReviewStatusSync,
} from '../../../src/lib/review-status-json.js';

describe('release status write door', () => {
  let odb: OverdeckTestDb;

  beforeEach(() => {
    odb = setupOverdeckTestDb();
    mockNotifyPipeline.mockClear();
  });

  afterEach(() => {
    teardownOverdeckTestDb(odb);
  });

  it('persists releaseStatus and records release history without clobbering existing statuses', () => {
    setReviewStatusSync('PAN-399', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'merged',
      readyForMerge: false,
    });

    setReviewStatusSync('PAN-399', {
      releaseStatus: 'releasing',
      releaseNotes: 'Waiting for API health check',
    });

    const status = getReviewStatusSync('PAN-399');
    expect(status).toMatchObject({
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'merged',
      releaseStatus: 'releasing',
      releaseNotes: 'Waiting for API health check',
      readyForMerge: false,
    });

    const row = odb.raw().prepare(`
      SELECT type, status, notes
      FROM status_history
      WHERE issue_id = ? AND type = 'release'
    `).get('PAN-399') as { type: string; status: string; notes: string } | undefined;
    expect(row).toEqual({
      type: 'release',
      status: 'releasing',
      notes: 'Waiting for API health check',
    });
  });
});

describe('release status JSON fallback', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-review-status-release-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('round-trips releaseStatus through the JSON fallback file', () => {
    const filePath = join(tempDir, 'review-status.json');

    setJsonReviewStatusSync('PAN-399', {
      releaseStatus: 'skipped',
      releaseNotes: 'No release config',
    }, filePath);

    expect(getJsonReviewStatusSync('PAN-399', filePath)).toMatchObject({
      releaseStatus: 'skipped',
      releaseNotes: 'No release config',
      history: [
        expect.objectContaining({
          type: 'release',
          status: 'skipped',
          notes: 'No release config',
        }),
      ],
    });
  });
});
