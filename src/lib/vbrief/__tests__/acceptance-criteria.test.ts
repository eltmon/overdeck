import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  extractAcceptanceCriteriaSync,
  extractACFromDocument,
  formatAcceptanceCriteria,
  checkAllCriteriaCompletedSync,
} from '../acceptance-criteria.js';
import type { VBriefDocument } from '../types.js';

let PROJECT_ROOT: string;
let WORKSPACE_PATH: string;
const ISSUE_ID = 'PAN-200';
const SPEC_FILENAME = '2026-01-01-PAN-200-test-plan.vbrief.json';

function makePlanWithAC(items: Array<{
  id: string;
  title: string;
  status?: string;
  metadata?: Record<string, unknown>;
  subItems?: Array<{ id: string; title: string; status?: string; kind?: string }>;
}>): VBriefDocument {
  return {
    vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: 'TEST',
      title: 'Test Plan',
      status: 'active',
      items: items.map(i => ({
        id: i.id,
        title: i.title,
        status: (i.status ?? 'pending') as any,
        metadata: i.metadata,
        subItems: i.subItems?.map(s => ({
          id: s.id,
          title: s.title,
          status: (s.status ?? 'pending') as any,
          metadata: { kind: s.kind ?? 'acceptance_criterion' },
        })),
      })),
      edges: [],
    },
  };
}

function writePlan(doc: VBriefDocument): void {
  const specsDir = join(PROJECT_ROOT, '.pan', 'specs');
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(join(specsDir, SPEC_FILENAME), JSON.stringify({ ...doc, status: 'active' }, null, 2));
}

beforeEach(() => {
  PROJECT_ROOT = join(tmpdir(), `vbrief-ac-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  WORKSPACE_PATH = join(PROJECT_ROOT, 'workspaces', `feature-${ISSUE_ID.toLowerCase()}`);
  mkdirSync(WORKSPACE_PATH, { recursive: true });
});

afterEach(() => {
  rmSync(PROJECT_ROOT, { recursive: true, force: true });
});

describe('extractAcceptanceCriteria', () => {
  it('returns empty array when no plan exists', () => {
    expect(extractAcceptanceCriteriaSync(WORKSPACE_PATH)).toEqual([]);
  });

  it('returns empty array when plan has no subItems', () => {
    const doc = makePlanWithAC([{ id: 'item-1', title: 'Task 1' }]);
    writePlan(doc);
    expect(extractAcceptanceCriteriaSync(WORKSPACE_PATH)).toEqual([]);
  });

  it('extracts AC subItems with parent context', () => {
    const doc = makePlanWithAC([{
      id: 'item-1',
      title: 'Build module',
      subItems: [
        { id: 'item-1.ac1', title: 'Function exists' },
        { id: 'item-1.ac2', title: 'Tests pass' },
      ],
    }]);
    writePlan(doc);

    const result = extractAcceptanceCriteriaSync(WORKSPACE_PATH);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      itemId: 'item-1',
      itemTitle: 'Build module',
      subItemId: 'item-1.ac1',
      title: 'Function exists',
      status: 'pending',
    });
  });

  it('only extracts subItems with kind=acceptance_criterion', () => {
    const doc = makePlanWithAC([{
      id: 'item-1',
      title: 'Task',
      subItems: [
        { id: 'item-1.ac1', title: 'AC item', kind: 'acceptance_criterion' },
        { id: 'item-1.note', title: 'Just a note', kind: 'note' },
      ],
    }]);
    writePlan(doc);

    const result = extractAcceptanceCriteriaSync(WORKSPACE_PATH);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('AC item');
  });

  it('skips acceptance criteria from deferred items', () => {
    const doc = makePlanWithAC([
      {
        id: 'active-item',
        title: 'Active task',
        subItems: [{ id: 'active-item.ac1', title: 'Active AC' }],
      },
      {
        id: 'deferred-item',
        title: 'Deferred task',
        status: 'deferred',
        metadata: { deferred: true },
        subItems: [{ id: 'deferred-item.ac1', title: 'Deferred AC' }],
      },
    ]);
    writePlan(doc);

    const result = extractAcceptanceCriteriaSync(WORKSPACE_PATH);
    expect(result).toHaveLength(1);
    expect(result[0].itemId).toBe('active-item');
  });

  it('extracts AC from multiple items', () => {
    const doc = makePlanWithAC([
      {
        id: 'item-1',
        title: 'First task',
        subItems: [{ id: 'item-1.ac1', title: 'Criterion A' }],
      },
      {
        id: 'item-2',
        title: 'Second task',
        subItems: [{ id: 'item-2.ac1', title: 'Criterion B' }],
      },
    ]);
    writePlan(doc);

    const result = extractAcceptanceCriteriaSync(WORKSPACE_PATH);
    expect(result).toHaveLength(2);
    expect(result[0].itemTitle).toBe('First task');
    expect(result[1].itemTitle).toBe('Second task');
  });
});

describe('extractACFromDocument', () => {
  it('works with an in-memory document', () => {
    const doc = makePlanWithAC([{
      id: 'item-1',
      title: 'Task',
      subItems: [{ id: 'item-1.ac1', title: 'Criterion' }],
    }]);

    const result = extractACFromDocument(doc);
    expect(result).toHaveLength(1);
    expect(result[0].subItemId).toBe('item-1.ac1');
  });
});

describe('formatAcceptanceCriteria', () => {
  it('returns empty string for no criteria', () => {
    expect(formatAcceptanceCriteria([])).toBe('');
  });

  it('formats as markdown checklist grouped by parent', () => {
    const criteria = [
      { itemId: 'a', itemTitle: 'Task A', subItemId: 'a.1', title: 'Done thing', status: 'completed' as const },
      { itemId: 'a', itemTitle: 'Task A', subItemId: 'a.2', title: 'Pending thing', status: 'pending' as const },
      { itemId: 'b', itemTitle: 'Task B', subItemId: 'b.1', title: 'Another thing', status: 'pending' as const },
    ];

    const result = formatAcceptanceCriteria(criteria);
    expect(result).toContain('### Task A');
    expect(result).toContain('- [x] Done thing');
    expect(result).toContain('- [ ] Pending thing');
    expect(result).toContain('### Task B');
    expect(result).toContain('- [ ] Another thing');
  });

  it('groups multiple AC under same parent', () => {
    const criteria = [
      { itemId: 'a', itemTitle: 'Task A', subItemId: 'a.1', title: 'First', status: 'pending' as const },
      { itemId: 'a', itemTitle: 'Task A', subItemId: 'a.2', title: 'Second', status: 'completed' as const },
    ];

    const result = formatAcceptanceCriteria(criteria);
    // Should only have one ### Task A heading
    const headingCount = (result.match(/### Task A/g) || []).length;
    expect(headingCount).toBe(1);
  });
});

describe('checkAllCriteriaCompleted', () => {
  it('returns allCompleted=true when no plan exists (legacy compat)', () => {
    const result = checkAllCriteriaCompletedSync(WORKSPACE_PATH);
    expect(result.allCompleted).toBe(true);
    expect(result.incomplete).toEqual([]);
  });

  it('returns allCompleted=true when all AC are completed', () => {
    const doc = makePlanWithAC([{
      id: 'item-1',
      title: 'Task',
      subItems: [
        { id: 'item-1.ac1', title: 'Done', status: 'completed' },
        { id: 'item-1.ac2', title: 'Also done', status: 'completed' },
      ],
    }]);
    writePlan(doc);

    const result = checkAllCriteriaCompletedSync(WORKSPACE_PATH);
    expect(result.allCompleted).toBe(true);
    expect(result.incomplete).toEqual([]);
  });

  it('returns incomplete AC when some are pending', () => {
    const doc = makePlanWithAC([{
      id: 'item-1',
      title: 'Task',
      subItems: [
        { id: 'item-1.ac1', title: 'Done', status: 'completed' },
        { id: 'item-1.ac2', title: 'Not done', status: 'pending' },
      ],
    }]);
    writePlan(doc);

    const result = checkAllCriteriaCompletedSync(WORKSPACE_PATH);
    expect(result.allCompleted).toBe(false);
    expect(result.incomplete).toHaveLength(1);
    expect(result.incomplete[0].title).toBe('Not done');
  });

  it('treats cancelled AC as completed (not blocking)', () => {
    const doc = makePlanWithAC([{
      id: 'item-1',
      title: 'Task',
      subItems: [
        { id: 'item-1.ac1', title: 'Done', status: 'completed' },
        { id: 'item-1.ac2', title: 'Cancelled', status: 'cancelled' },
      ],
    }]);
    writePlan(doc);

    const result = checkAllCriteriaCompletedSync(WORKSPACE_PATH);
    expect(result.allCompleted).toBe(true);
  });

  it('does not block completion on deferred item acceptance criteria', () => {
    const doc = makePlanWithAC([{
      id: 'deferred-item',
      title: 'Deferred task',
      status: 'deferred',
      metadata: { deferred: true },
      subItems: [
        { id: 'deferred-item.ac1', title: 'Deferred and not done', status: 'pending' },
      ],
    }]);
    writePlan(doc);

    const result = checkAllCriteriaCompletedSync(WORKSPACE_PATH);
    expect(result.allCompleted).toBe(true);
    expect(result.incomplete).toEqual([]);
  });

  it('returns allCompleted=true when items have no AC subItems', () => {
    const doc = makePlanWithAC([{ id: 'item-1', title: 'Task' }]);
    writePlan(doc);

    const result = checkAllCriteriaCompletedSync(WORKSPACE_PATH);
    expect(result.allCompleted).toBe(true);
  });
});
