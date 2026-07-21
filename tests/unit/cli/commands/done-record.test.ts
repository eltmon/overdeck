/**
 * PAN-1919: done.ts continue state rerouted to per-issue record.
 *
 * AC1: recordTestWaiver persists the test-waiver decision to the record's
 *      decisions and stores nothing in .pan/continue.json.
 * AC2: pan done appends its end session entry to the record such that a
 *      subsequent readIssueRecord returns it in record.sessionHistory.
 * AC3: done.ts removed from CONTINUE_EXCLUDES; lint-state-writes.sh exits 0
 *      (verified by scripts test — here we check no continue.json is written).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockQueueAutoCommit = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/lib/pan-dir/auto-commit.js', () => ({
  queueAutoCommit: mockQueueAutoCommit,
}));

// Isolate resolveProjectForIssue to return null so the workspace path is used
const mockResolveProjectForIssue = vi.hoisted(() => vi.fn().mockReturnValue(null));
vi.mock('../../../../src/lib/pan-dir/record.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/pan-dir/record.js')>('../../../../src/lib/pan-dir/record.js');
  return { ...actual, resolveProjectForIssue: mockResolveProjectForIssue };
});

import { recordTestWaiver } from '../../../../src/cli/commands/done.js';
import { readIssueRecordSync } from '../../../../src/lib/pan-dir/record.js';

describe('PAN-1919: done.ts → per-issue record (no continue.json)', () => {
  let tmpRoot: string;
  let workspacePath: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'pan-done-record-test-'));
    workspacePath = join(tmpRoot, 'workspaces', 'feature-pan-1919');
    mkdirSync(join(workspacePath, '.pan', 'records'), { recursive: true });
    mockQueueAutoCommit.mockClear();
    mockResolveProjectForIssue.mockReturnValue(null);
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('AC1: recordTestWaiver writes decision to record, not .pan/continue.json', async () => {
    await recordTestWaiver(workspacePath, 'existing test at src/foo.test.ts covers this');

    const project = { name: 'test', path: workspacePath };
    const record = readIssueRecordSync(project, 'PAN-1919');
    expect(record?.decisions).toHaveLength(1);
    expect(record?.decisions?.[0].id).toBe('D-test-waived');
    expect(record?.decisions?.[0].summary).toContain('Test gate waived');

    expect(existsSync(join(workspacePath, '.pan', 'continue.json'))).toBe(false);
  });

  it('AC1: recordTestWaiver appends to existing decisions without clobbering them', async () => {
    await recordTestWaiver(workspacePath, 'reason A');
    await recordTestWaiver(workspacePath, 'reason B');

    const project = { name: 'test', path: workspacePath };
    const record = readIssueRecordSync(project, 'PAN-1919');
    expect(record?.decisions).toHaveLength(2);
    expect(record?.decisions?.[1].summary).toContain('reason B');
  });
});
