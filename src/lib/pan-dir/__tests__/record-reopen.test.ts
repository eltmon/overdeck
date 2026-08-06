import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ProjectConfig } from '../../projects.js';
import {
  readIssueRecordSync,
  type PanIssueRecord,
} from '../record.js';
import { clearRecordPipelineClosedOut } from '../record-update.js';

const ISSUE_ID = 'REOPENFIX-1';

describe('PAN-3513 record reopen transition', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('clears terminal flags and records reopenedAt through the record write door', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pan-record-reopen-'));
    roots.push(root);
    const project: ProjectConfig = { name: 'Reopen fixture', path: root };
    const recordPath = join(root, '.pan', 'records', 'reopenfix-1.json');
    mkdirSync(join(root, '.pan', 'records'), { recursive: true });
    writeFileSync(recordPath, JSON.stringify({
      issueId: ISSUE_ID,
      schemaVersion: 2,
      pipeline: {
        issueId: ISSUE_ID,
        reviewStatus: 'passed',
        testStatus: 'passed',
        readyForMerge: false,
        closedOut: true,
        closedOutAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
      },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'main' },
    } satisfies PanIssueRecord));

    await expect(clearRecordPipelineClosedOut(project, ISSUE_ID, {
      reopenedAt: '2026-08-03T00:00:00.000Z',
      autoCommit: false,
    })).resolves.toBe(true);

    const updated = readIssueRecordSync(project, ISSUE_ID);
    expect(updated?.pipeline).toMatchObject({
      reopenedAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
    });
    expect(updated?.pipeline.closedOut).toBeUndefined();
    expect(updated?.pipeline.closedOutAt).toBeUndefined();
  });
});
