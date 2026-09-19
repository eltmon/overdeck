/**
 * xBRIEF v0.5 Full Spec Compliance Tests
 *
 * Verifies that all v0.5 fields are properly handled:
 * - uid, sequence, references, created, updated on XBriefPlan
 * - author, description on XBriefDocument.xBRIEFInfo
 * - created, completed on XBriefItem and XBriefSubItem
 * - Timestamp and sequence updates in io.ts
 * - Planning prompt template includes all new v0.5 fields
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readPlanSync, readWorkspacePlanSync, updateItemStatus, updateSubItemStatus } from '../../src/lib/xbrief/io.js';
import type { XBriefDocument } from '../../src/lib/xbrief/types.js';

let PROJECT_ROOT: string;
let TEST_DIR: string;

function makeFullSpecDoc(overrides: Partial<XBriefDocument['plan']> = {}): XBriefDocument {
  return {
    xBRIEFInfo: {
      version: '0.5',
      created: '2026-01-01T00:00:00Z',
      author: 'overdeck/0.6.0',
      description: 'Plan for PAN-453: Full xBRIEF v0.5 Spec Support',
    },
    plan: {
      id: 'pan-453',
      title: 'Full xBRIEF v0.5 Spec Support',
      status: 'active',
      uid: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      sequence: 1,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      author: 'agent:claude-opus-4-6',
      references: [
        { uri: 'https://github.com/eltmon/overdeck/issues/453', label: 'PAN-453', type: 'issue' },
        { uri: 'docs/prds/active/PAN-453-plan.md', label: 'Plan', type: 'prd' },
      ],
      items: [
        {
          id: 'update-types',
          title: 'Update xBRIEF types',
          status: 'pending',
          created: '2026-01-01T00:00:00Z',
          subItems: [
            {
              id: 'update-types.ac1',
              title: 'XBriefPlan has uid field',
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

/**
 * Write the spec to the main-side `.pan/specs/` directory (canonical location)
 * AND to the workspace `.pan/spec.vbrief.json` for tests that read directly.
 */
function writePlanDoc(workspacePath: string, doc: XBriefDocument): string {
  const specsDir = join(PROJECT_ROOT, '.pan', 'specs');
  mkdirSync(specsDir, { recursive: true });
  const specPath = join(specsDir, '2026-01-01-PAN-453-full-vbrief-spec-support.vbrief.json');
  writeFileSync(specPath, JSON.stringify(doc, null, 2));

  const panDir = join(workspacePath, '.pan');
  mkdirSync(panDir, { recursive: true });
  const localPath = join(panDir, 'spec.vbrief.json');
  writeFileSync(localPath, JSON.stringify(doc, null, 2));
  return localPath;
}

function readPlanFromWorkspace(workspacePath: string): XBriefDocument {
  return readPlanSync(join(workspacePath, '.pan', 'spec.vbrief.json'));
}

// PAN-3917: item status lives in the plan home's continue file
// (`<planHome>/.pan/continues/<ISSUE>.xbrief.json`, `items[key].status`), not
// a per-issue record's statusOverrides. The workspace is its own plan home
// here (no registered project).
function readContinueStatusOverrides(workspacePath: string): Record<string, string> | undefined {
  const continuePath = join(workspacePath, '.pan', 'continues', 'PAN-453.xbrief.json');
  if (!existsSync(continuePath)) return undefined;
  const raw = readFileSync(continuePath, 'utf-8');
  const items = (JSON.parse(raw) as { items?: Record<string, { status?: string }> }).items ?? {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(items)) {
    if (value?.status) out[key] = value.status;
  }
  return out;
}

beforeEach(() => {
  PROJECT_ROOT = join(tmpdir(), `xbrief-project-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  TEST_DIR = join(PROJECT_ROOT, 'workspaces', 'feature-pan-453');
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(PROJECT_ROOT, { recursive: true, force: true });
});

// ─── xBRIEFInfo fields ────────────────────────────────────────────────────────

describe('xBRIEFInfo v0.5 fields', () => {
  it('readPlan preserves xBRIEFInfo.author', () => {
    const doc = makeFullSpecDoc();
    const planPath = writePlanDoc(TEST_DIR, doc);
    const result = readPlanSync(planPath);
    expect(result.xBRIEFInfo.author).toBe('overdeck/0.6.0');
  });

  it('readPlan preserves xBRIEFInfo.description', () => {
    const doc = makeFullSpecDoc();
    const planPath = writePlanDoc(TEST_DIR, doc);
    const result = readPlanSync(planPath);
    expect(result.xBRIEFInfo.description).toBe('Plan for PAN-453: Full xBRIEF v0.5 Spec Support');
  });
});

// ─── XBriefPlan v0.5 fields ───────────────────────────────────────────────────

describe('XBriefPlan v0.5 fields', () => {
  it('readPlan preserves plan.uid', () => {
    const doc = makeFullSpecDoc();
    const planPath = writePlanDoc(TEST_DIR, doc);
    const result = readPlanSync(planPath);
    expect(result.plan.uid).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
  });

  it('readPlan preserves plan.sequence', () => {
    const doc = makeFullSpecDoc();
    const planPath = writePlanDoc(TEST_DIR, doc);
    const result = readPlanSync(planPath);
    expect(result.plan.sequence).toBe(1);
  });

  it('readPlan preserves plan.created', () => {
    const doc = makeFullSpecDoc();
    const planPath = writePlanDoc(TEST_DIR, doc);
    const result = readPlanSync(planPath);
    expect(result.plan.created).toBe('2026-01-01T00:00:00Z');
  });

  it('readPlan preserves plan.references', () => {
    const doc = makeFullSpecDoc();
    const planPath = writePlanDoc(TEST_DIR, doc);
    const result = readPlanSync(planPath);
    expect(result.plan.references).toHaveLength(2);
    expect(result.plan.references![0]).toEqual({
      uri: 'https://github.com/eltmon/overdeck/issues/453',
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

// ─── XBriefItem timestamps ────────────────────────────────────────────────────

describe('XBriefItem created/completed fields', () => {
  it('readPlan preserves item.created', () => {
    const doc = makeFullSpecDoc();
    const planPath = writePlanDoc(TEST_DIR, doc);
    const result = readPlanSync(planPath);
    expect(result.plan.items[0].created).toBe('2026-01-01T00:00:00Z');
  });

  it('readPlan preserves subItem.created', () => {
    const doc = makeFullSpecDoc();
    const planPath = writePlanDoc(TEST_DIR, doc);
    const result = readPlanSync(planPath);
    expect(result.plan.items[0].subItems![0].created).toBe('2026-01-01T00:00:00Z');
  });
});

// ─── updateItemStatus: statusOverrides in continue.json ─────────────────────

describe('updateItemStatus: writes to the plan-home continue file', () => {
  it('writes status to the continue file items map', async () => {
    const doc = makeFullSpecDoc();
    writePlanDoc(TEST_DIR, doc);

    updateItemStatus(TEST_DIR, 'update-types', 'running');
    const overrides = readContinueStatusOverrides(TEST_DIR);
    expect(overrides?.['update-types']).toBe('running');
  });

  it('does not mutate the spec file on disk', () => {
    const doc = makeFullSpecDoc();
    const planPath = writePlanDoc(TEST_DIR, doc);

    updateItemStatus(TEST_DIR, 'update-types', 'running');
    const raw = readPlanSync(planPath);
    expect(raw.plan.sequence).toBe(1);
    expect(raw.plan.items[0].status).toBe('pending');
  });

  it('merged view reflects updated status via readWorkspacePlan', () => {
    const doc = makeFullSpecDoc();
    writePlanDoc(TEST_DIR, doc);

    updateItemStatus(TEST_DIR, 'update-types', 'running');
    const merged = readWorkspacePlanSync(TEST_DIR);
    const item = merged!.plan.items.find(i => i.id === 'update-types');
    expect(item?.status).toBe('running');
  });

  it('sets item.completed in merged view when status → completed', () => {
    const doc = makeFullSpecDoc();
    writePlanDoc(TEST_DIR, doc);
    const before = Date.now();

    updateItemStatus(TEST_DIR, 'update-types', 'completed');
    const merged = readWorkspacePlanSync(TEST_DIR);
    const item = merged!.plan.items.find(i => i.id === 'update-types');

    expect(item?.completed).toBeDefined();
    const completedTime = new Date(item!.completed!).getTime();
    expect(completedTime).toBeGreaterThanOrEqual(before);
  });

  it('does not set item.completed for non-completed status', () => {
    const doc = makeFullSpecDoc();
    writePlanDoc(TEST_DIR, doc);

    updateItemStatus(TEST_DIR, 'update-types', 'running');
    const merged = readWorkspacePlanSync(TEST_DIR);
    const item = merged!.plan.items.find(i => i.id === 'update-types');

    expect(item?.completed).toBeUndefined();
  });
});

// ─── updateSubItemStatus: statusOverrides in continue.json ──────────────────

describe('updateSubItemStatus: writes to the plan-home continue file', () => {
  it('writes status to the continue file with a dotted key', async () => {
    const doc = makeFullSpecDoc();
    writePlanDoc(TEST_DIR, doc);

    updateSubItemStatus(TEST_DIR, 'update-types', 'update-types.ac1', 'completed');
    const overrides = readContinueStatusOverrides(TEST_DIR);
    expect(overrides?.['update-types.ac1']).toBe('completed');
  });

  it('merged view reflects updated subItem status', () => {
    const doc = makeFullSpecDoc();
    writePlanDoc(TEST_DIR, doc);

    updateSubItemStatus(TEST_DIR, 'update-types', 'update-types.ac1', 'completed');
    const merged = readWorkspacePlanSync(TEST_DIR);
    const subItem = merged!.plan.items[0].subItems?.find(s => s.id === 'update-types.ac1');
    expect(subItem?.status).toBe('completed');
  });

  it('sets subItem.completed in merged view when status → completed', () => {
    const doc = makeFullSpecDoc();
    writePlanDoc(TEST_DIR, doc);
    const before = Date.now();

    updateSubItemStatus(TEST_DIR, 'update-types', 'update-types.ac1', 'completed');
    const merged = readWorkspacePlanSync(TEST_DIR);
    const subItem = merged!.plan.items[0].subItems?.find(s => s.id === 'update-types.ac1');

    expect(subItem?.completed).toBeDefined();
    const completedTime = new Date(subItem!.completed!).getTime();
    expect(completedTime).toBeGreaterThanOrEqual(before);
  });

  it('does not set subItem.completed for non-completed status', () => {
    const doc = makeFullSpecDoc();
    writePlanDoc(TEST_DIR, doc);

    updateSubItemStatus(TEST_DIR, 'update-types', 'update-types.ac1', 'running');
    const merged = readWorkspacePlanSync(TEST_DIR);
    const subItem = merged!.plan.items[0].subItems?.find(s => s.id === 'update-types.ac1');

    expect(subItem?.completed).toBeUndefined();
  });

  it('accumulates both item and subItem overrides', async () => {
    const doc = makeFullSpecDoc();
    writePlanDoc(TEST_DIR, doc);

    updateItemStatus(TEST_DIR, 'update-types', 'completed');
    updateSubItemStatus(TEST_DIR, 'update-types', 'update-types.ac1', 'completed');
    const overrides = readContinueStatusOverrides(TEST_DIR);
    expect(overrides?.['update-types']).toBe('completed');
    expect(overrides?.['update-types.ac1']).toBe('completed');
  });
});

// ─── Planning prompt xBRIEF fields ────────────────────────────────────────────

describe('Planning prompt includes xBRIEF field placeholders', () => {
  it('includes xBRIEFInfo.author in prompt template', async () => {
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
      'test-model'
    );

    expect(prompt).toContain('xBRIEFInfo');
    expect(prompt).toContain('author');
    expect(prompt).toContain('uid');
    expect(prompt).toContain('sequence');
    expect(prompt).toContain('references');
    expect(prompt).toContain('agent:test-model');
  });
});

// ─── PRD discovery ────────────────────────────────────────────────────────────

describe('legacy docs/prds discovery is removed from the planning prompt', () => {
  it('does not reference docs/prds files even when one matches the issue', async () => {
    // Create a legacy PRD file matching issue ID — must be ignored
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
      'test-model'
    );

    expect(prompt).not.toContain('PAN-999-plan.md');
    expect(prompt).not.toContain('docs/prds');
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
      'test-model'
    )).resolves.toBeDefined();
  });
});
