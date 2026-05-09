/**
 * vBRIEF v0.5 Full Spec Compliance Tests
 *
 * Verifies that all v0.5 fields are properly handled:
 * - uid, sequence, references, created, updated on VBriefPlan
 * - author, description on VBriefDocument.vBRIEFInfo
 * - created, completed on VBriefItem and VBriefSubItem
 * - Timestamp and sequence updates in io.ts
 * - Planning prompt template includes all new v0.5 fields
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readPlan, updateItemStatus, updateSubItemStatus } from '../../src/lib/vbrief/io.js';
import type { VBriefDocument } from '../../src/lib/vbrief/types.js';

let TEST_DIR: string;

function makeFullSpecDoc(overrides: Partial<VBriefDocument['plan']> = {}): VBriefDocument {
  return {
    vBRIEFInfo: {
      version: '0.5',
      created: '2026-01-01T00:00:00Z',
      author: 'panopticon-cli/0.6.0',
      description: 'Plan for PAN-453: Full vBRIEF v0.5 Spec Support',
    },
    plan: {
      id: 'pan-453',
      title: 'Full vBRIEF v0.5 Spec Support',
      status: 'approved',
      uid: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      sequence: 1,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      author: 'agent:claude-opus-4-6',
      references: [
        { uri: 'https://github.com/eltmon/panopticon-cli/issues/453', label: 'PAN-453', type: 'issue' },
        { uri: 'docs/prds/active/PAN-453-plan.md', label: 'Plan', type: 'prd' },
      ],
      items: [
        {
          id: 'update-types',
          title: 'Update vBRIEF types',
          status: 'pending',
          created: '2026-01-01T00:00:00Z',
          subItems: [
            {
              id: 'update-types.ac1',
              title: 'VBriefPlan has uid field',
              status: 'pending',
              created: '2026-01-01T00:00:00Z',
              metadata: { kind: 'acceptance_criterion' },
            },
          ],
        },
      ],
      edges: [],
      ...overrides,
    },
  };
}

function writePlanDoc(workspacePath: string, doc: VBriefDocument): string {
  const panDir = join(workspacePath, '.pan');
  mkdirSync(panDir, { recursive: true });
  const planPath = join(panDir, 'spec.vbrief.json');
  writeFileSync(planPath, JSON.stringify(doc, null, 2));
  return planPath;
}

function readPlanFromWorkspace(workspacePath: string): VBriefDocument {
  return readPlan(join(workspacePath, '.pan', 'spec.vbrief.json'));
}

beforeEach(() => {
  TEST_DIR = join(tmpdir(), `vbrief-spec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ─── vBRIEFInfo fields ────────────────────────────────────────────────────────

describe('vBRIEFInfo v0.5 fields', () => {
  it('readPlan preserves vBRIEFInfo.author', () => {
    const doc = makeFullSpecDoc();
    const planPath = writePlanDoc(TEST_DIR, doc);
    const result = readPlan(planPath);
    expect(result.vBRIEFInfo.author).toBe('panopticon-cli/0.6.0');
  });

  it('readPlan preserves vBRIEFInfo.description', () => {
    const doc = makeFullSpecDoc();
    const planPath = writePlanDoc(TEST_DIR, doc);
    const result = readPlan(planPath);
    expect(result.vBRIEFInfo.description).toBe('Plan for PAN-453: Full vBRIEF v0.5 Spec Support');
  });
});

// ─── VBriefPlan v0.5 fields ───────────────────────────────────────────────────

describe('VBriefPlan v0.5 fields', () => {
  it('readPlan preserves plan.uid', () => {
    const doc = makeFullSpecDoc();
    const planPath = writePlanDoc(TEST_DIR, doc);
    const result = readPlan(planPath);
    expect(result.plan.uid).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
  });

  it('readPlan preserves plan.sequence', () => {
    const doc = makeFullSpecDoc();
    const planPath = writePlanDoc(TEST_DIR, doc);
    const result = readPlan(planPath);
    expect(result.plan.sequence).toBe(1);
  });

  it('readPlan preserves plan.created', () => {
    const doc = makeFullSpecDoc();
    const planPath = writePlanDoc(TEST_DIR, doc);
    const result = readPlan(planPath);
    expect(result.plan.created).toBe('2026-01-01T00:00:00Z');
  });

  it('readPlan preserves plan.references', () => {
    const doc = makeFullSpecDoc();
    const planPath = writePlanDoc(TEST_DIR, doc);
    const result = readPlan(planPath);
    expect(result.plan.references).toHaveLength(2);
    expect(result.plan.references![0]).toEqual({
      uri: 'https://github.com/eltmon/panopticon-cli/issues/453',
      label: 'PAN-453',
      type: 'issue',
    });
    expect(result.plan.references![1]).toEqual({
      uri: 'docs/prds/active/PAN-453-plan.md',
      label: 'Plan',
      type: 'prd',
    });
  });
});

// ─── VBriefItem timestamps ────────────────────────────────────────────────────

describe('VBriefItem created/completed fields', () => {
  it('readPlan preserves item.created', () => {
    const doc = makeFullSpecDoc();
    const planPath = writePlanDoc(TEST_DIR, doc);
    const result = readPlan(planPath);
    expect(result.plan.items[0].created).toBe('2026-01-01T00:00:00Z');
  });

  it('readPlan preserves subItem.created', () => {
    const doc = makeFullSpecDoc();
    const planPath = writePlanDoc(TEST_DIR, doc);
    const result = readPlan(planPath);
    expect(result.plan.items[0].subItems![0].created).toBe('2026-01-01T00:00:00Z');
  });
});

// ─── updateItemStatus: timestamps and sequence ────────────────────────────────

describe('updateItemStatus: v0.5 timestamp + sequence behavior', () => {
  it('increments plan.sequence on each call', () => {
    const doc = makeFullSpecDoc();
    writePlanDoc(TEST_DIR, doc);

    updateItemStatus(TEST_DIR, 'update-types', 'running');
    const after = readPlanFromWorkspace(TEST_DIR);
    expect(after.plan.sequence).toBe(2);
  });

  it('starts sequence at 1 if missing', () => {
    const doc = makeFullSpecDoc({ sequence: undefined });
    writePlanDoc(TEST_DIR, doc);

    updateItemStatus(TEST_DIR, 'update-types', 'running');
    const after = readPlanFromWorkspace(TEST_DIR);
    expect(after.plan.sequence).toBe(1);
  });

  it('sets plan.updated to a current ISO timestamp', () => {
    const doc = makeFullSpecDoc();
    writePlanDoc(TEST_DIR, doc);
    const before = Date.now();

    updateItemStatus(TEST_DIR, 'update-types', 'running');
    const after = readPlanFromWorkspace(TEST_DIR);

    expect(after.plan.updated).toBeDefined();
    const updatedTime = new Date(after.plan.updated!).getTime();
    expect(updatedTime).toBeGreaterThanOrEqual(before);
    expect(updatedTime).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('sets vBRIEFInfo.updated to a current ISO timestamp', () => {
    const doc = makeFullSpecDoc();
    writePlanDoc(TEST_DIR, doc);
    const before = Date.now();

    updateItemStatus(TEST_DIR, 'update-types', 'running');
    const after = readPlanFromWorkspace(TEST_DIR);

    expect(after.vBRIEFInfo.updated).toBeDefined();
    const updatedTime = new Date(after.vBRIEFInfo.updated!).getTime();
    expect(updatedTime).toBeGreaterThanOrEqual(before);
  });

  it('sets item.completed when status → completed', () => {
    const doc = makeFullSpecDoc();
    writePlanDoc(TEST_DIR, doc);
    const before = Date.now();

    updateItemStatus(TEST_DIR, 'update-types', 'completed');
    const after = readPlanFromWorkspace(TEST_DIR);
    const item = after.plan.items.find(i => i.id === 'update-types');

    expect(item?.completed).toBeDefined();
    const completedTime = new Date(item!.completed!).getTime();
    expect(completedTime).toBeGreaterThanOrEqual(before);
  });

  it('does not set item.completed for non-completed status', () => {
    const doc = makeFullSpecDoc();
    writePlanDoc(TEST_DIR, doc);

    updateItemStatus(TEST_DIR, 'update-types', 'running');
    const after = readPlanFromWorkspace(TEST_DIR);
    const item = after.plan.items.find(i => i.id === 'update-types');

    expect(item?.completed).toBeUndefined();
  });
});

// ─── updateSubItemStatus: timestamps and sequence ─────────────────────────────

describe('updateSubItemStatus: v0.5 timestamp + sequence behavior', () => {
  it('increments plan.sequence on each call', () => {
    const doc = makeFullSpecDoc();
    writePlanDoc(TEST_DIR, doc);

    updateSubItemStatus(TEST_DIR, 'update-types', 'update-types.ac1', 'completed');
    const after = readPlanFromWorkspace(TEST_DIR);
    expect(after.plan.sequence).toBe(2);
  });

  it('sets plan.updated after subItem status change', () => {
    const doc = makeFullSpecDoc();
    writePlanDoc(TEST_DIR, doc);
    const before = Date.now();

    updateSubItemStatus(TEST_DIR, 'update-types', 'update-types.ac1', 'completed');
    const after = readPlanFromWorkspace(TEST_DIR);

    expect(after.plan.updated).toBeDefined();
    const updatedTime = new Date(after.plan.updated!).getTime();
    expect(updatedTime).toBeGreaterThanOrEqual(before);
  });

  it('sets subItem.completed when status → completed', () => {
    const doc = makeFullSpecDoc();
    writePlanDoc(TEST_DIR, doc);
    const before = Date.now();

    updateSubItemStatus(TEST_DIR, 'update-types', 'update-types.ac1', 'completed');
    const after = readPlanFromWorkspace(TEST_DIR);
    const subItem = after.plan.items[0].subItems?.find(s => s.id === 'update-types.ac1');

    expect(subItem?.completed).toBeDefined();
    const completedTime = new Date(subItem!.completed!).getTime();
    expect(completedTime).toBeGreaterThanOrEqual(before);
  });

  it('does not set subItem.completed for non-completed status', () => {
    const doc = makeFullSpecDoc();
    writePlanDoc(TEST_DIR, doc);

    updateSubItemStatus(TEST_DIR, 'update-types', 'update-types.ac1', 'running');
    const after = readPlanFromWorkspace(TEST_DIR);
    const subItem = after.plan.items[0].subItems?.find(s => s.id === 'update-types.ac1');

    expect(subItem?.completed).toBeUndefined();
  });

  it('increments sequence independently from updateItemStatus', () => {
    const doc = makeFullSpecDoc();
    writePlanDoc(TEST_DIR, doc);

    updateItemStatus(TEST_DIR, 'update-types', 'completed');
    const afterItem = readPlanFromWorkspace(TEST_DIR);
    expect(afterItem.plan.sequence).toBe(2);

    updateSubItemStatus(TEST_DIR, 'update-types', 'update-types.ac1', 'completed');
    const afterSub = readPlanFromWorkspace(TEST_DIR);
    expect(afterSub.plan.sequence).toBe(3);
  });
});

// ─── Planning prompt v0.5 fields ──────────────────────────────────────────────

describe('Planning prompt includes v0.5 field placeholders', () => {
  it('includes vBRIEFInfo.author in prompt template', async () => {
    const { buildPlanningPrompt } = await import('../../src/lib/planning/spawn-planning-session.js') as any;

    const prompt = await buildPlanningPrompt(
      {
        identifier: 'PAN-999',
        title: 'Test Issue',
        description: 'Test',
        url: 'https://github.com/example/repo/issues/999',
        comments: [],
      },
      TEST_DIR,
      'claude-opus-4-6'
    );

    expect(prompt).toContain('vBRIEFInfo');
    expect(prompt).toContain('author');
    expect(prompt).toContain('uid');
    expect(prompt).toContain('sequence');
    expect(prompt).toContain('references');
    expect(prompt).toContain('agent:claude-opus-4-6');
  });
});

// ─── PRD discovery ────────────────────────────────────────────────────────────

describe('PRD discovery scans docs/prds/ for issue-matching files', () => {
  it('includes discovered PRD path in references when file matches', async () => {
    // Create a PRD file matching issue ID
    const prdDir = join(TEST_DIR, 'docs', 'prds', 'active');
    mkdirSync(prdDir, { recursive: true });
    writeFileSync(join(prdDir, 'PAN-999-plan.md'), '# Plan for PAN-999\n');

    const { buildPlanningPrompt } = await import('../../src/lib/planning/spawn-planning-session.js') as any;

    const prompt = await buildPlanningPrompt(
      {
        identifier: 'PAN-999',
        title: 'Test Issue',
        description: 'Test',
        url: 'https://github.com/example/repo/issues/999',
        comments: [],
      },
      TEST_DIR,
      'claude-opus-4-6'
    );

    expect(prompt).toContain('PAN-999-plan.md');
  });

  it('does not error when no PRD exists for the issue', async () => {
    const { buildPlanningPrompt } = await import('../../src/lib/planning/spawn-planning-session.js') as any;

    // No PRD files in TEST_DIR — should not throw
    await expect(buildPlanningPrompt(
      {
        identifier: 'PAN-000',
        title: 'No PRD Issue',
        description: 'Test',
        url: 'https://github.com/example/repo/issues/0',
        comments: [],
      },
      TEST_DIR,
      'claude-opus-4-6'
    )).resolves.toBeDefined();
  });
});
