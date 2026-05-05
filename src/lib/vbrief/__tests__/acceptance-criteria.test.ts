import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  extractAcceptanceCriteria,
  extractACFromDocument,
  formatAcceptanceCriteria,
  checkAllCriteriaCompleted,
} from '../acceptance-criteria.js';
import { PAN_DIRNAME, PAN_SPEC_FILENAME } from '../../pan-dir/index.js';
import type { VBriefDocument } from '../types.js';

let TEST_DIR: string;

function makePlanWithAC(items: Array<{
  id: string;
  title: string;
  subItems?: Array<{ id: string; title: string; status?: string; kind?: string }>;
}>): VBriefDocument {
  return {
    vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: 'TEST',
      title: 'Test Plan',
      status: 'approved',
      items: items.map(i => ({
        id: i.id,
        title: i.title,
        status: 'pending' as const,
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

function writePlan(workspacePath: string, doc: VBriefDocument): void {
  const planDir = join(workspacePath, PAN_DIRNAME);
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, PAN_SPEC_FILENAME), JSON.stringify(doc, null, 2));
}

beforeEach(() => {
  TEST_DIR = join(tmpdir(), `vbrief-ac-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('extractAcceptanceCriteria', () => {
  it('returns empty array when no plan exists', () => {
    expect(extractAcceptanceCriteria(TEST_DIR)).toEqual([]);
  });

  it('returns empty array when plan has no subItems', () => {
    const doc = makePlanWithAC([{ id: 'item-1', title: 'Task 1' }]);
    writePlan(TEST_DIR, doc);
    expect(extractAcceptanceCriteria(TEST_DIR)).toEqual([]);
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
    writePlan(TEST_DIR, doc);

    const result = extractAcceptanceCriteria(TEST_DIR);
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
    writePlan(TEST_DIR, doc);

    const result = extractAcceptanceCriteria(TEST_DIR);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('AC item');
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
    writePlan(TEST_DIR, doc);

    const result = extractAcceptanceCriteria(TEST_DIR);
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
    const result = checkAllCriteriaCompleted(TEST_DIR);
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
    writePlan(TEST_DIR, doc);

    const result = checkAllCriteriaCompleted(TEST_DIR);
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
    writePlan(TEST_DIR, doc);

    const result = checkAllCriteriaCompleted(TEST_DIR);
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
    writePlan(TEST_DIR, doc);

    const result = checkAllCriteriaCompleted(TEST_DIR);
    expect(result.allCompleted).toBe(true);
  });

  it('returns allCompleted=true when items have no AC subItems', () => {
    const doc = makePlanWithAC([{ id: 'item-1', title: 'Task' }]);
    writePlan(TEST_DIR, doc);

    const result = checkAllCriteriaCompleted(TEST_DIR);
    expect(result.allCompleted).toBe(true);
  });
});
