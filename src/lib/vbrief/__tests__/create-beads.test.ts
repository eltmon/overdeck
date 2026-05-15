import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join, basename } from 'path';
import { tmpdir } from 'os';
import type { VBriefDocument } from '../types.js';

// Must be hoisted so vi.mock() can reference it before module evaluation
const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>();
  return {
    ...actual,
    promisify: () => mockExecAsync,
  };
});

// Import after mocks are registered
import { createBeadsFromVBrief } from '../beads.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writePlan(projectRoot: string, issueId: string, doc: VBriefDocument): void {
  const specsDir = join(projectRoot, '.pan', 'specs');
  mkdirSync(specsDir, { recursive: true });
  const slug = doc.plan.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const filename = `2026-01-01-${issueId}-${slug}.vbrief.json`;
  writeFileSync(join(specsDir, filename), JSON.stringify({ ...doc, status: 'active' }, null, 2));
}

function writeWorkspaceDraft(workspacePath: string, doc: VBriefDocument): void {
  const panDir = join(workspacePath, '.pan');
  mkdirSync(panDir, { recursive: true });
  writeFileSync(join(panDir, 'spec.vbrief.json'), JSON.stringify(doc, null, 2));
}

function makeDoc(planId: string, items: Array<{ id: string; title: string }>): VBriefDocument {
  return {
    vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: planId,
      title: `${planId} Test Plan`,
      status: 'active',
      items: items.map(i => ({
        id: i.id,
        title: i.title,
        status: 'pending' as const,
        metadata: { difficulty: 'simple', issueLabel: planId.toLowerCase() },
      })),
      edges: [],
    },
  };
}

/** Create a .beads/redirect so existsSync(redirectPath) is true, skipping redirect logic. */
function setupRedirect(workspacePath: string): void {
  const beadsDir = join(workspacePath, '.beads');
  mkdirSync(beadsDir, { recursive: true });
  writeFileSync(join(beadsDir, 'redirect'), '../../.beads');
}

/**
 * Create the standard project + workspace directory structure.
 * Issue ID must match PREFIX-NUMBER format (e.g. PAN-500).
 * Returns { projectRoot, workspacePath }.
 */
function createWorkspace(issueId: string): { projectRoot: string; workspacePath: string } {
  const projectRoot = join(tmpdir(), `cbfv-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const workspacePath = join(projectRoot, 'workspaces', `feature-${issueId.toLowerCase()}`);
  mkdirSync(workspacePath, { recursive: true });
  return { projectRoot, workspacePath };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createBeadsFromVBrief', () => {
  let projectRoot: string;
  let WORKSPACE_DIR: string;

  beforeEach(() => {
    vi.clearAllMocks();
    const ws = createWorkspace('PAN-500');
    projectRoot = ws.projectRoot;
    WORKSPACE_DIR = ws.workspacePath;
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns error when bd CLI is not found', async () => {
    mockExecAsync.mockRejectedValueOnce(new Error('which: no bd in (PATH)'));

    const result = await createBeadsFromVBrief(WORKSPACE_DIR);

    expect(result.success).toBe(false);
    expect(result.errors).toContain('bd (beads) CLI not found in PATH');
    expect(result.created).toHaveLength(0);
  });

  it('creates beads from the workspace draft before a canonical spec exists', async () => {
    setupRedirect(WORKSPACE_DIR);
    writeWorkspaceDraft(WORKSPACE_DIR, makeDoc('PAN-500', [
      { id: 'item-1', title: 'First task' },
      { id: 'item-2', title: 'Second task' },
    ]));

    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'bead-001\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'bead-002\n', stderr: '' });

    const result = await createBeadsFromVBrief(WORKSPACE_DIR);

    expect(result.success).toBe(true);
    expect(result.created).toEqual(['PAN-500: First task', 'PAN-500: Second task']);
  });

  it('creates .beads/redirect when main repo has .beads/ but workspace does not', async () => {
    // Main .beads/ exists at project root — no redirect in workspace yet
    mkdirSync(join(projectRoot, '.beads'), { recursive: true });

    writePlan(projectRoot, 'PAN-500', makeDoc('PAN-500', [{ id: 'item-1', title: 'First task' }]));

    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })   // which bd
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // bd ping --json
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })             // bd list --json -l ...
      .mockResolvedValueOnce({ stdout: 'bead-001\n', stderr: '' });    // bd create

    const result = await createBeadsFromVBrief(WORKSPACE_DIR);

    // Redirect file must have been written
    const redirectContent = readFileSync(join(WORKSPACE_DIR, '.beads', 'redirect'), 'utf-8');
    expect(redirectContent).toBe('../../.beads');

    expect(result.success).toBe(true);
    expect(result.created).toContain('PAN-500: First task');
  });

  it('returns an error after bd doctor when a redirect-managed probe still fails', async () => {
    const ws2 = createWorkspace('PAN-501');
    setupRedirect(ws2.workspacePath);
    writePlan(ws2.projectRoot, 'PAN-501', makeDoc('PAN-501', [{ id: 'item-1', title: 'Should not init' }]));

    const dbError = new Error('Error 1146 (HY000): table not found: issues');
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })   // which bd
      .mockRejectedValueOnce(dbError)                                  // bd ping --json (probe)
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // bd doctor --fix
      .mockRejectedValueOnce(dbError);                                 // bd ping --json (retry)

    const result = await createBeadsFromVBrief(ws2.workspacePath);

    const doctorCalls = mockExecAsync.mock.calls.filter(
      ([file, args]: [string, string[]]) =>
        file === 'bd' && Array.isArray(args) && args[0] === 'doctor' && args[1] === '--fix',
    );
    expect(doctorCalls).toHaveLength(1);

    const initCall = mockExecAsync.mock.calls.find(
      ([file, args]: [string, string[]]) =>
        file === 'bd' && Array.isArray(args) && args[0] === 'init',
    );
    expect(initCall).toBeUndefined();

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/failed after recovery/i);

    rmSync(ws2.projectRoot, { recursive: true, force: true });
  });

  it('runs bd doctor and continues when retry ping succeeds', async () => {
    const ws3 = createWorkspace('PAN-502');
    setupRedirect(ws3.workspacePath);
    writePlan(ws3.projectRoot, 'PAN-502', makeDoc('PAN-502', [{ id: 'item-1', title: 'Recovered task' }]));

    const dbError = new Error('Error 1146 (HY000): table not found: issues');
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })   // which bd
      .mockRejectedValueOnce(dbError)                                  // bd ping --json (probe)
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // bd doctor --fix
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // bd ping --json (retry)
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })             // bd list --json -l ... (idempotency)
      .mockResolvedValueOnce({ stdout: 'bead-recovered\n', stderr: '' }); // bd create

    const result = await createBeadsFromVBrief(ws3.workspacePath);

    const doctorCalls = mockExecAsync.mock.calls.filter(
      ([file, args]: [string, string[]]) =>
        file === 'bd' && Array.isArray(args) && args[0] === 'doctor' && args[1] === '--fix',
    );
    expect(doctorCalls).toHaveLength(1);
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.created).toContain('PAN-502: Recovered task');

    rmSync(ws3.projectRoot, { recursive: true, force: true });
  });

  it('recovers from PAN-457 table-missing corruption and creates every plan item', async () => {
    const ws9 = createWorkspace('PAN-509');
    setupRedirect(ws9.workspacePath);
    writePlan(ws9.projectRoot, 'PAN-509', makeDoc('PAN-509', [
      { id: 'item-a', title: 'Recovered alpha' },
      { id: 'item-b', title: 'Recovered beta' },
    ]));

    const tableMissing = Object.assign(new Error('table not found: issues'), {
      stderr: 'table not found: issues',
    });
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })
      .mockRejectedValueOnce(tableMissing)
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'bead-alpha\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'bead-beta\n', stderr: '' });

    const result = await createBeadsFromVBrief(ws9.workspacePath);

    const createCalls = mockExecAsync.mock.calls.filter(
      ([file, args]: [string, string[]]) => file === 'bd' && Array.isArray(args) && args[0] === 'create',
    );
    expect(result.success).toBe(true);
    expect(createCalls).toHaveLength(2);
    expect(result.created).toEqual(['PAN-509: Recovered alpha', 'PAN-509: Recovered beta']);
    expect(result.errors.join('\n')).not.toMatch(/stale local-DB artifacts/i);

    rmSync(ws9.projectRoot, { recursive: true, force: true });
  });

  it('runs bd init only when there is no redirect AND no main beads (true fresh install)', async () => {
    const ws3 = createWorkspace('PAN-502');
    writePlan(ws3.projectRoot, 'PAN-502', makeDoc('PAN-502', [{ id: 'item-1', title: 'Setup task' }]));

    const expectedPrefix = basename(ws3.projectRoot).toLowerCase().replace(/[^a-z0-9-]/g, '-');

    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })   // which bd
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // bd init --prefix <expectedPrefix> (early setup)
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // git config beads.role contributor
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // bd config set export.git-add false
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // bd ping --json (probe — succeeds after init)
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })             // bd list --json -l ... (idempotency)
      .mockResolvedValueOnce({ stdout: 'bead-002\n', stderr: '' });    // bd create

    const result = await createBeadsFromVBrief(ws3.workspacePath);

    const initCall = mockExecAsync.mock.calls.find(
      ([file, args]: [string, string[]]) =>
        file === 'bd' && Array.isArray(args) && args[0] === 'init' && args.includes('--prefix'),
    );
    expect(initCall).toBeDefined();
    expect(initCall![1]).toContain(expectedPrefix);

    expect(result.success).toBe(true);
    expect(result.created).toContain('PAN-502: Setup task');

    rmSync(ws3.projectRoot, { recursive: true, force: true });
  });

  it('creates beads for each plan item and returns their IDs', async () => {
    const ws4 = createWorkspace('PAN-503');
    setupRedirect(ws4.workspacePath);
    writePlan(ws4.projectRoot, 'PAN-503', makeDoc('PAN-503', [
      { id: 'item-a', title: 'Alpha task' },
      { id: 'item-b', title: 'Beta task' },
    ]));

    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })   // which bd
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // bd ping --json
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })             // bd list --json -l ... (idempotency)
      .mockResolvedValueOnce({ stdout: 'bead-alpha\n', stderr: '' })  // bd create item-a
      .mockResolvedValueOnce({ stdout: 'bead-beta\n', stderr: '' });  // bd create item-b

    const result = await createBeadsFromVBrief(ws4.workspacePath);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.created).toEqual(['PAN-503: Alpha task', 'PAN-503: Beta task']);
    expect(result.beadIds.get('item-a')).toBe('bead-alpha');
    expect(result.beadIds.get('item-b')).toBe('bead-beta');

    rmSync(ws4.projectRoot, { recursive: true, force: true });
  });

  it('deletes existing beads for the same label before creating new ones', async () => {
    const ws5 = createWorkspace('PAN-504');
    setupRedirect(ws5.workspacePath);
    writePlan(ws5.projectRoot, 'PAN-504', makeDoc('PAN-504', [{ id: 'item-1', title: 'Rebuilt task' }]));

    const existingBeads = JSON.stringify([{ id: 'stale-bead-42' }, { id: 'stale-bead-43' }]);
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })    // which bd
      .mockResolvedValueOnce({ stdout: '', stderr: '' })                // bd ping --json
      .mockResolvedValueOnce({ stdout: existingBeads, stderr: '' })    // bd list --json -l ... (idempotency)
      .mockResolvedValueOnce({ stdout: '', stderr: '' })                // bd delete stale-bead-42
      .mockResolvedValueOnce({ stdout: '', stderr: '' })                // bd delete stale-bead-43
      .mockResolvedValueOnce({ stdout: 'fresh-bead-1\n', stderr: '' }); // bd create

    const result = await createBeadsFromVBrief(ws5.workspacePath);

    // execFile form: mockExecAsync('bd', ['delete', '<id>', '--force'], opts)
    const deleteCalls = mockExecAsync.mock.calls.filter(
      ([file, args]: [string, string[]]) =>
        file === 'bd' && Array.isArray(args) && args[0] === 'delete',
    );
    expect(deleteCalls).toHaveLength(2);
    expect(deleteCalls[0][1]).toContain('stale-bead-42');
    expect(deleteCalls[1][1]).toContain('stale-bead-43');

    expect(result.success).toBe(true);
    expect(result.created).toContain('PAN-504: Rebuilt task');
    expect(result.beadIds.get('item-1')).toBe('fresh-bead-1');

    rmSync(ws5.projectRoot, { recursive: true, force: true });
  });

  it('defaults missing inspection policy to auto and preserves per-item metadata', async () => {
    const ws6 = createWorkspace('PAN-505');
    setupRedirect(ws6.workspacePath);
    const doc = makeDoc('PAN-505', [{ id: 'item-1', title: 'Auto task' }]);
    doc.plan.items[0].metadata = {
      difficulty: 'simple',
      issueLabel: 'pan-505',
      requiresInspection: true,
      inspectionDepth: 'deep',
    };
    writePlan(ws6.projectRoot, 'PAN-505', doc);

    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'bead-auto\n', stderr: '' });

    await createBeadsFromVBrief(ws6.workspacePath);

    const createCall = mockExecAsync.mock.calls.find(
      ([file, args]: [string, string[]]) => file === 'bd' && Array.isArray(args) && args[0] === 'create',
    );
    const metadata = JSON.parse(createCall![1][createCall![1].indexOf('--metadata') + 1]);
    expect(metadata.requiresInspection).toBe(true);
    expect(metadata.inspectionDepth).toBe('deep');

    rmSync(ws6.projectRoot, { recursive: true, force: true });
  });

  it('materializes global inspection policy into bead metadata', async () => {
    const ws7 = createWorkspace('PAN-506');
    setupRedirect(ws7.workspacePath);
    const doc = makeDoc('PAN-506', [{ id: 'item-1', title: 'Deep task' }]);
    doc.vBRIEFInfo.inspectionPolicy = 'deep';
    doc.plan.items[0].metadata = {
      difficulty: 'simple',
      issueLabel: 'pan-506',
      requiresInspection: false,
      inspectionDepth: 'fast',
    };
    writePlan(ws7.projectRoot, 'PAN-506', doc);

    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'bead-deep\n', stderr: '' });

    await createBeadsFromVBrief(ws7.workspacePath);

    const createCall = mockExecAsync.mock.calls.find(
      ([file, args]: [string, string[]]) => file === 'bd' && Array.isArray(args) && args[0] === 'create',
    );
    const metadata = JSON.parse(createCall![1][createCall![1].indexOf('--metadata') + 1]);
    expect(metadata.requiresInspection).toBe(true);
    expect(metadata.inspectionDepth).toBe('deep');

    rmSync(ws7.projectRoot, { recursive: true, force: true });
  });
});
