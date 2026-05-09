import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { findPlan, findVBriefInPrdDirs, importVBriefFromPrdDirs, isPlanningComplete, isPlanningProposed, readPlan, readWorkspacePlan, updateItemStatus, updateSubItemStatus } from '../io.js';
import { ensureVBriefDirs, generateVBriefFilename, resolveVBriefDir } from '../lifecycle.js';
import { PAN_DIRNAME, PAN_SPEC_FILENAME } from '../../pan-dir/index.js';
import type { VBriefDocument } from '../types.js';

let TEST_DIR: string;

function makePlanDoc(items: Array<{ id: string; status?: string }> = []): VBriefDocument {
  return {
    vBRIEFInfo: { version: '1.0', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: 'TEST',
      title: 'Test Plan',
      status: 'active',
      items: items.map(i => ({ id: i.id, title: i.id, status: (i.status ?? 'pending') as any })),
      edges: [],
    },
  };
}

function writePlanDoc(workspacePath: string, doc: VBriefDocument): string {
  const planDir = join(workspacePath, PAN_DIRNAME);
  mkdirSync(planDir, { recursive: true });
  const planPath = join(planDir, PAN_SPEC_FILENAME);
  writeFileSync(planPath, JSON.stringify(doc, null, 2));
  return planPath;
}

beforeEach(() => {
  TEST_DIR = join(tmpdir(), `vbrief-io-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('findPlan', () => {
  it('returns null when workspace has no .pan directory', () => {
    expect(findPlan(TEST_DIR)).toBeNull();
  });

  it('returns null when .pan exists but spec.vbrief.json does not', () => {
    mkdirSync(join(TEST_DIR, PAN_DIRNAME), { recursive: true });
    expect(findPlan(TEST_DIR)).toBeNull();
  });

  it('returns the plan path when spec.vbrief.json exists', () => {
    writePlanDoc(TEST_DIR, makePlanDoc());
    const result = findPlan(TEST_DIR);
    expect(result).not.toBeNull();
    expect(result).toContain('.pan/spec.vbrief.json');
    expect(existsSync(result!)).toBe(true);
  });

  it('resolves the workspace plan only, ignoring lifecycle copies (PAN-946)', () => {
    // PAN-946: findPlan() is workspace-scoped. Workspace mutations
    // (updateItemStatus, beads/readiness writes) MUST resolve the in-progress
    // .pan/spec.vbrief.json — never an archived lifecycle copy that has
    // already moved to active/, completed/, or cancelled/. Lifecycle lookups
    // belong in findVBriefByIssue (sync) / findVBriefByIssueAsync (cached).
    const projectRoot = join(TEST_DIR, 'project');
    const workspacePath = join(projectRoot, 'workspaces', 'feature-pan-1');
    mkdirSync(workspacePath, { recursive: true });

    // Workspace plan exists at .pan/spec.vbrief.json
    writePlanDoc(workspacePath, makePlanDoc());

    // A lifecycle plan ALSO exists for this issue — but findPlan must NOT
    // surface it, otherwise workspace status writes would mutate the archive.
    ensureVBriefDirs(projectRoot);
    const lifecyclePlan: VBriefDocument = {
      vBRIEFInfo: { version: '0.5', created: '2026-05-03T00:00:00Z' },
      plan: {
        id: 'pan-1',
        title: 'Lifecycle Plan',
        status: 'active',
        items: [],
        edges: [],
      },
    };
    const filename = generateVBriefFilename('PAN-1', 'test', '2026-05-03');
    writeFileSync(
      join(resolveVBriefDir(projectRoot, 'active'), filename),
      JSON.stringify(lifecyclePlan, null, 2),
    );

    const result = findPlan(workspacePath);
    expect(result).not.toBeNull();
    expect(result!).toContain('.pan/spec.vbrief.json');
    expect(result!).not.toContain('vbrief/active/');
    const doc = JSON.parse(readFileSync(result!, 'utf-8')) as VBriefDocument;
    // Workspace plan title is "Test Plan" (set by makePlanDoc), not "Lifecycle Plan".
    expect(doc.plan.title).toBe('Test Plan');
  });

  it('returns null when workspace lacks .pan/spec.vbrief.json even if lifecycle has one (PAN-946)', () => {
    const projectRoot = join(TEST_DIR, 'project');
    const workspacePath = join(projectRoot, 'workspaces', 'feature-pan-3');
    mkdirSync(workspacePath, { recursive: true });

    ensureVBriefDirs(projectRoot);
    const lifecyclePlan: VBriefDocument = {
      vBRIEFInfo: { version: '0.5', created: '2026-05-03T00:00:00Z' },
      plan: { id: 'pan-3', title: 'Archived', status: 'completed', items: [], edges: [] },
    };
    const filename = generateVBriefFilename('PAN-3', 'test', '2026-05-03');
    writeFileSync(
      join(resolveVBriefDir(projectRoot, 'completed'), filename),
      JSON.stringify(lifecyclePlan, null, 2),
    );

    expect(findPlan(workspacePath)).toBeNull();
  });
});

describe('findVBriefInPrdDirs', () => {
  it.each([
    ['docs planned flat uppercase', ['docs', 'prds', 'planned', 'PAN-945-plan.vbrief.json']],
    ['docs active lowercase subdirectory', ['docs', 'prds', 'active', 'pan-945', 'plan.vbrief.json']],
    ['api docs planned flat lowercase', ['api', 'docs', 'prds', 'planned', 'pan-945-plan.vbrief.json']],
    ['api docs active uppercase subdirectory', ['api', 'docs', 'prds', 'active', 'PAN-945', 'plan.vbrief.json']],
    ['api docs planned slugged uppercase flat file', ['api', 'docs', 'prds', 'planned', 'PAN-945-import-prd-vbrief.vbrief.json']],
  ])('finds %s vBRIEF copies', async (_name, segments) => {
    const projectRoot = join(TEST_DIR, 'project');
    const sourcePath = join(projectRoot, ...segments);
    mkdirSync(join(sourcePath, '..'), { recursive: true });
    writeFileSync(sourcePath, JSON.stringify(makePlanDoc([{ id: 'item-1' }]), null, 2));

    await expect(findVBriefInPrdDirs(projectRoot, 'PAN-945')).resolves.toBe(sourcePath);
  });

  it('returns null when no PRD directory vBRIEF exists for the issue', async () => {
    const projectRoot = join(TEST_DIR, 'project');
    const otherPath = join(projectRoot, 'docs', 'prds', 'planned', 'PAN-944-plan.vbrief.json');
    mkdirSync(join(otherPath, '..'), { recursive: true });
    writeFileSync(otherPath, JSON.stringify(makePlanDoc(), null, 2));

    await expect(findVBriefInPrdDirs(projectRoot, 'PAN-945')).resolves.toBeNull();
  });

  it.each(['../PAN-945', 'PAN-945/../../SECRET', 'PAN.945', `PAN-945${String.fromCharCode(0)}`])('rejects unsafe issue ID %s', async unsafeIssueId => {
    await expect(findVBriefInPrdDirs(join(TEST_DIR, 'project'), unsafeIssueId)).rejects.toThrow('Invalid issue ID');
  });
});

describe('importVBriefFromPrdDirs', () => {
  it('copies a matching PRD vBRIEF into the workspace-local plan path when missing', async () => {
    const projectRoot = join(TEST_DIR, 'project');
    const workspacePath = join(projectRoot, 'workspaces', 'feature-pan-945');
    const sourcePath = join(projectRoot, 'api', 'docs', 'prds', 'planned', 'PAN-945-plan.vbrief.json');
    const sourceDoc = makePlanDoc([{ id: 'item-1' }]);
    sourceDoc.plan.id = 'PAN-945';
    sourceDoc.plan.title = 'PRD Plan';
    mkdirSync(join(sourcePath, '..'), { recursive: true });
    mkdirSync(workspacePath, { recursive: true });
    writeFileSync(sourcePath, JSON.stringify(sourceDoc, null, 2));

    const imported = await importVBriefFromPrdDirs(projectRoot, workspacePath, 'PAN-945');

    expect(imported).toEqual({
      sourcePath,
      workspacePlanPath: join(workspacePath, PAN_DIRNAME, PAN_SPEC_FILENAME),
    });
    expect(findPlan(workspacePath)).toBe(imported!.workspacePlanPath);
    expect(readWorkspacePlan(workspacePath)?.plan.title).toBe('PRD Plan');
  });

  it('does not overwrite an existing workspace-local plan', async () => {
    const projectRoot = join(TEST_DIR, 'project');
    const workspacePath = join(projectRoot, 'workspaces', 'feature-pan-945');
    const sourcePath = join(projectRoot, 'docs', 'prds', 'planned', 'PAN-945-plan.vbrief.json');
    const existingDoc = makePlanDoc([{ id: 'existing' }]);
    existingDoc.plan.title = 'Existing Workspace Plan';
    const sourceDoc = makePlanDoc([{ id: 'source' }]);
    sourceDoc.plan.title = 'PRD Plan';
    mkdirSync(join(sourcePath, '..'), { recursive: true });
    mkdirSync(workspacePath, { recursive: true });
    writePlanDoc(workspacePath, existingDoc);
    writeFileSync(sourcePath, JSON.stringify(sourceDoc, null, 2));

    const imported = await importVBriefFromPrdDirs(projectRoot, workspacePath, 'PAN-945');

    expect(imported).toBeNull();
    expect(readWorkspacePlan(workspacePath)?.plan.title).toBe('Existing Workspace Plan');
  });

  it('imports slugged flat vBRIEF files from api/docs/prds/planned', async () => {
    const projectRoot = join(TEST_DIR, 'project');
    const workspacePath = join(projectRoot, 'workspaces', 'feature-pan-945');
    const sourcePath = join(projectRoot, 'api', 'docs', 'prds', 'planned', 'PAN-945-import-prd-vbrief.vbrief.json');
    const sourceDoc = makePlanDoc([{ id: 'item-1' }]);
    sourceDoc.plan.id = 'PAN-945';
    sourceDoc.plan.title = 'Slugged PRD Plan';
    mkdirSync(join(sourcePath, '..'), { recursive: true });
    mkdirSync(workspacePath, { recursive: true });
    writeFileSync(sourcePath, JSON.stringify(sourceDoc, null, 2));

    const imported = await importVBriefFromPrdDirs(projectRoot, workspacePath, 'pan-945');

    expect(imported?.sourcePath).toBe(sourcePath);
    expect(readWorkspacePlan(workspacePath)?.plan.title).toBe('Slugged PRD Plan');
  });

  it('rejects symlinked PRD vBRIEF artifacts without creating .pan/spec.vbrief.json', async () => {
    const projectRoot = join(TEST_DIR, 'project');
    const workspacePath = join(projectRoot, 'workspaces', 'feature-pan-945');
    const sourcePath = join(projectRoot, 'docs', 'prds', 'planned', 'PAN-945-plan.vbrief.json');
    const secretPath = join(TEST_DIR, 'secret.vbrief.json');
    mkdirSync(join(sourcePath, '..'), { recursive: true });
    mkdirSync(workspacePath, { recursive: true });
    writeFileSync(secretPath, JSON.stringify(makePlanDoc([{ id: 'secret' }]), null, 2));
    symlinkSync(secretPath, sourcePath);

    await expect(importVBriefFromPrdDirs(projectRoot, workspacePath, 'PAN-945')).rejects.toThrow('symlink');
    expect(existsSync(join(workspacePath, PAN_DIRNAME, PAN_SPEC_FILENAME))).toBe(false);
  });

  it('rejects non-regular PRD vBRIEF artifacts without creating .pan/spec.vbrief.json', async () => {
    const projectRoot = join(TEST_DIR, 'project');
    const workspacePath = join(projectRoot, 'workspaces', 'feature-pan-945');
    const sourcePath = join(projectRoot, 'docs', 'prds', 'planned', 'PAN-945-plan.vbrief.json');
    mkdirSync(sourcePath, { recursive: true });
    mkdirSync(workspacePath, { recursive: true });

    await expect(importVBriefFromPrdDirs(projectRoot, workspacePath, 'PAN-945')).rejects.toThrow('non-regular');
    expect(existsSync(join(workspacePath, PAN_DIRNAME, PAN_SPEC_FILENAME))).toBe(false);
  });

  it('rejects invalid existing PRD vBRIEF artifacts without creating .pan/spec.vbrief.json', async () => {
    const projectRoot = join(TEST_DIR, 'project');
    const workspacePath = join(projectRoot, 'workspaces', 'feature-pan-945');
    const sourcePath = join(projectRoot, 'api', 'docs', 'prds', 'planned', 'PAN-945-invalid.vbrief.json');
    mkdirSync(join(sourcePath, '..'), { recursive: true });
    mkdirSync(workspacePath, { recursive: true });
    writeFileSync(sourcePath, JSON.stringify({ plan: { id: 'PAN-945' } }, null, 2));

    await expect(importVBriefFromPrdDirs(projectRoot, workspacePath, 'PAN-945')).rejects.toThrow('Invalid vBRIEF format');
    expect(existsSync(join(workspacePath, PAN_DIRNAME, PAN_SPEC_FILENAME))).toBe(false);
  });
});

describe('readPlan', () => {
  it('parses and returns VBriefDocument', () => {
    const doc = makePlanDoc([{ id: 'item-1' }]);
    const planPath = writePlanDoc(TEST_DIR, doc);
    const result = readPlan(planPath);
    expect(result.plan.id).toBe('TEST');
    expect(result.plan.items).toHaveLength(1);
    expect(result.plan.items[0].id).toBe('item-1');
  });

  it('throws for nonexistent file', () => {
    expect(() => readPlan(join(TEST_DIR, 'nonexistent.json'))).toThrow();
  });

  it('throws for invalid JSON', () => {
    const badPath = join(TEST_DIR, 'bad.json');
    writeFileSync(badPath, 'not valid json!!!');
    expect(() => readPlan(badPath)).toThrow();
  });
});

describe('readWorkspacePlan', () => {
  it('returns null when no plan exists', () => {
    expect(readWorkspacePlan(TEST_DIR)).toBeNull();
  });

  it('returns VBriefDocument when plan exists', () => {
    writePlanDoc(TEST_DIR, makePlanDoc([{ id: 'x' }]));
    const result = readWorkspacePlan(TEST_DIR);
    expect(result).not.toBeNull();
    expect(result!.plan.items[0].id).toBe('x');
  });
});

describe('updateItemStatus', () => {
  it('no-ops when no plan exists', () => {
    expect(() => updateItemStatus(TEST_DIR, 'item-1', 'completed')).not.toThrow();
  });

  it('updates the status of an existing item', () => {
    const doc = makePlanDoc([{ id: 'item-1', status: 'pending' }]);
    writePlanDoc(TEST_DIR, doc);

    updateItemStatus(TEST_DIR, 'item-1', 'completed');

    const updated = readWorkspacePlan(TEST_DIR)!;
    const item = updated.plan.items.find(i => i.id === 'item-1');
    expect(item?.status).toBe('completed');
  });

  it('no-ops when item ID does not exist in plan', () => {
    writePlanDoc(TEST_DIR, makePlanDoc([{ id: 'item-1' }]));
    expect(() => updateItemStatus(TEST_DIR, 'nonexistent', 'completed')).not.toThrow();

    const after = readWorkspacePlan(TEST_DIR)!;
    expect(after.plan.items[0].status).toBe('pending');
  });

  it('preserves other items when updating one', () => {
    const doc = makePlanDoc([
      { id: 'item-1', status: 'pending' },
      { id: 'item-2', status: 'in_progress' },
    ]);
    writePlanDoc(TEST_DIR, doc);

    updateItemStatus(TEST_DIR, 'item-1', 'completed');

    const updated = readWorkspacePlan(TEST_DIR)!;
    const item2 = updated.plan.items.find(i => i.id === 'item-2');
    expect(item2?.status).toBe('in_progress');
  });

  it('writes valid JSON (no .tmp file left over)', () => {
    writePlanDoc(TEST_DIR, makePlanDoc([{ id: 'item-1' }]));
    updateItemStatus(TEST_DIR, 'item-1', 'completed');

    const tmpPath = join(TEST_DIR, PAN_DIRNAME, `${PAN_SPEC_FILENAME}.tmp`);
    expect(existsSync(tmpPath)).toBe(false);

    const planPath = join(TEST_DIR, PAN_DIRNAME, PAN_SPEC_FILENAME);
    expect(() => JSON.parse(readFileSync(planPath, 'utf-8'))).not.toThrow();
  });
});

describe('updateSubItemStatus', () => {
  function makePlanWithSubItems(): VBriefDocument {
    return {
      vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
      plan: {
        id: 'TEST',
        title: 'Test Plan',
        status: 'active',
        items: [{
          id: 'item-1',
          title: 'Task 1',
          status: 'pending' as const,
          subItems: [
            { id: 'item-1.ac1', title: 'First AC', status: 'pending' as const, metadata: { kind: 'acceptance_criterion' } },
            { id: 'item-1.ac2', title: 'Second AC', status: 'pending' as const, metadata: { kind: 'acceptance_criterion' } },
          ],
        }],
        edges: [],
      },
    };
  }

  it('no-ops when no plan exists', () => {
    expect(() => updateSubItemStatus(TEST_DIR, 'item-1', 'item-1.ac1', 'completed')).not.toThrow();
  });

  it('updates a specific subItem status', () => {
    const doc = makePlanWithSubItems();
    writePlanDoc(TEST_DIR, doc);

    updateSubItemStatus(TEST_DIR, 'item-1', 'item-1.ac1', 'completed');

    const updated = readWorkspacePlan(TEST_DIR)!;
    const sub = updated.plan.items[0].subItems!.find(s => s.id === 'item-1.ac1');
    expect(sub?.status).toBe('completed');
  });

  it('preserves other subItems when updating one', () => {
    const doc = makePlanWithSubItems();
    writePlanDoc(TEST_DIR, doc);

    updateSubItemStatus(TEST_DIR, 'item-1', 'item-1.ac1', 'completed');

    const updated = readWorkspacePlan(TEST_DIR)!;
    const other = updated.plan.items[0].subItems!.find(s => s.id === 'item-1.ac2');
    expect(other?.status).toBe('pending');
  });

  it('no-ops when item ID does not exist', () => {
    const doc = makePlanWithSubItems();
    writePlanDoc(TEST_DIR, doc);

    expect(() => updateSubItemStatus(TEST_DIR, 'nonexistent', 'item-1.ac1', 'completed')).not.toThrow();
    const updated = readWorkspacePlan(TEST_DIR)!;
    expect(updated.plan.items[0].subItems![0].status).toBe('pending');
  });

  it('no-ops when subItem ID does not exist', () => {
    const doc = makePlanWithSubItems();
    writePlanDoc(TEST_DIR, doc);

    expect(() => updateSubItemStatus(TEST_DIR, 'item-1', 'nonexistent', 'completed')).not.toThrow();
    const updated = readWorkspacePlan(TEST_DIR)!;
    expect(updated.plan.items[0].subItems![0].status).toBe('pending');
  });
});

function writePlanWithStatus(workspacePath: string, status: string): void {
  const doc = makePlanDoc();
  doc.plan.status = status;
  writePlanDoc(workspacePath, doc);
}

describe('isPlanningProposed', () => {
  it('returns true when plan.status is "proposed"', () => {
    writePlanWithStatus(TEST_DIR, 'proposed');
    expect(isPlanningProposed(TEST_DIR)).toBe(true);
  });

  it('returns false when plan.status is "draft"', () => {
    writePlanWithStatus(TEST_DIR, 'draft');
    expect(isPlanningProposed(TEST_DIR)).toBe(false);
  });

  it('returns false when plan.status is "approved"', () => {
    writePlanWithStatus(TEST_DIR, 'approved');
    expect(isPlanningProposed(TEST_DIR)).toBe(false);
  });

  it('returns false when plan.status is "running"', () => {
    writePlanWithStatus(TEST_DIR, 'running');
    expect(isPlanningProposed(TEST_DIR)).toBe(false);
  });

  it('returns false when plan.status is explicit but not "proposed"', () => {
    writePlanWithStatus(TEST_DIR, 'approved');
    expect(isPlanningProposed(TEST_DIR)).toBe(false);
  });

  it('returns false when plan has no status field', () => {
    const doc = makePlanDoc();
    delete (doc.plan as Partial<typeof doc.plan>).status;
    writePlanDoc(TEST_DIR, doc);
    expect(isPlanningProposed(TEST_DIR)).toBe(false);
  });

  it('returns false when there is no plan at all', () => {
    expect(isPlanningProposed(TEST_DIR)).toBe(false);
  });

  it('returns false when no plan and no marker', () => {
    expect(isPlanningProposed(TEST_DIR)).toBe(false);
  });

  it('returns false when plan is corrupt', () => {
    const dir = join(TEST_DIR, PAN_DIRNAME);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, PAN_SPEC_FILENAME), 'not json');
    expect(isPlanningProposed(TEST_DIR)).toBe(false);
  });
});

describe('isPlanningComplete', () => {
  it.each(['proposed', 'approved', 'pending', 'running', 'completed', 'blocked'])(
    'returns true when plan.status is "%s"',
    (status) => {
      writePlanWithStatus(TEST_DIR, status);
      expect(isPlanningComplete(TEST_DIR)).toBe(true);
    },
  );

  it('returns false when plan.status is "draft"', () => {
    writePlanWithStatus(TEST_DIR, 'draft');
    expect(isPlanningComplete(TEST_DIR)).toBe(false);
  });

  it('returns false when plan.status is "cancelled"', () => {
    writePlanWithStatus(TEST_DIR, 'cancelled');
    expect(isPlanningComplete(TEST_DIR)).toBe(false);
  });

  it('returns false when plan has no status field', () => {
    const doc = makePlanDoc();
    delete (doc.plan as Partial<typeof doc.plan>).status;
    writePlanDoc(TEST_DIR, doc);
    expect(isPlanningComplete(TEST_DIR)).toBe(false);
  });

  it('returns false when no plan exists', () => {
    expect(isPlanningComplete(TEST_DIR)).toBe(false);
  });

  it('returns false when plan.status is an explicit non-finished value', () => {
    writePlanWithStatus(TEST_DIR, 'draft');
    expect(isPlanningComplete(TEST_DIR)).toBe(false);
  });

  it('accepts a planningDir override pointing to a non-standard .pan location', () => {
    const customPlanningDir = join(TEST_DIR, '.pan', 'foo-1');
    mkdirSync(customPlanningDir, { recursive: true });
    const doc = makePlanDoc();
    doc.plan.status = 'running';
    writeFileSync(join(customPlanningDir, PAN_SPEC_FILENAME), JSON.stringify(doc));
    expect(isPlanningComplete(TEST_DIR, customPlanningDir)).toBe(true);
    expect(isPlanningProposed(TEST_DIR, customPlanningDir)).toBe(false);
  });
});
