/**
 * PAN-1919: dag.ts mirrorTaskOperationToRecord persists statusOverrides
 * into the per-issue record, NOT into workspace .pan/continue.json.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockQueueAutoCommit = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/lib/pan-dir/auto-commit.js', () => ({
  queueAutoCommit: mockQueueAutoCommit,
}));

import { applyTaskOperationToPlanFile } from '../../../../src/lib/vbrief/dag.js';
import { readIssueRecordSync } from '../../../../src/lib/pan-dir/record.js';
import type { VBriefDocument } from '../../../../src/lib/vbrief/types.js';

function makePlan(issueId: string): VBriefDocument {
  return {
    vBRIEFInfo: { version: '1.0', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: issueId,
      title: `${issueId} plan`,
      status: 'active',
      sequence: 1,
      items: [
        {
          id: `${issueId}-a`,
          title: 'Item A',
          status: 'running' as const,
          subItems: [{ id: `${issueId}-a.ac1`, title: 'AC 1', status: 'pending' as const }],
        },
      ],
      edges: [],
    },
  };
}

describe('PAN-1919: dag.ts applyTaskOperationToPlanFile → per-issue record', () => {
  let tmpRoot: string;
  let workspacePath: string;
  let planPath: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'pan-dag-record-test-'));
    // Convention: workspaces/feature-<issueId-lowercase>/
    workspacePath = join(tmpRoot, 'workspaces', 'feature-pan-1919');
    const planDir = join(workspacePath, '.pan');
    mkdirSync(planDir, { recursive: true });
    mkdirSync(join(workspacePath, '.pan', 'records'), { recursive: true });
    planPath = join(planDir, 'spec.vbrief.json');
    writeFileSync(planPath, JSON.stringify(makePlan('PAN-1919'), null, 2));
    mockQueueAutoCommit.mockClear();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('AC1: persists bead status override into .pan/records/pan-1919.json, not continue.json', async () => {
    await Effect.runPromise(
      applyTaskOperationToPlanFile(planPath, {
        type: 'done',
        itemId: 'PAN-1919-a',
        writerId: 'test-writer',
      }, workspacePath),
    );

    const record = readIssueRecordSync({ name: 'test', path: workspacePath }, 'PAN-1919');
    expect(record?.statusOverrides?.['PAN-1919-a']).toBe('completed');

    // Must NOT write workspace .pan/continue.json
    expect(existsSync(join(workspacePath, '.pan', 'continue.json'))).toBe(false);
  });

  it('AC2: item and sub-items get the same status override', async () => {
    await Effect.runPromise(
      applyTaskOperationToPlanFile(planPath, {
        type: 'done',
        itemId: 'PAN-1919-a',
        writerId: 'test-writer-2',
      }, workspacePath),
    );

    const record = readIssueRecordSync({ name: 'test', path: workspacePath }, 'PAN-1919');
    expect(record?.statusOverrides?.['PAN-1919-a']).toBe('completed');
    // Sub-items stored as ${itemId}.${fullSubItemId} — consistent with dag-cli.ts
    // applyStatusOverrides can resolve this because it finds the sub via s.id === key.slice(dotIndex+1)
    const overrideKeys = Object.keys(record?.statusOverrides ?? {});
    const subItemKey = overrideKeys.find(k => k !== 'PAN-1919-a' && record!.statusOverrides![k] === 'completed');
    expect(subItemKey).toBeDefined();
  });
});
