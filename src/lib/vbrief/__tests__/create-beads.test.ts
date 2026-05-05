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
import { PAN_DIRNAME, PAN_SPEC_FILENAME } from '../../pan-dir/index.js';
import { createBeadsFromVBrief } from '../beads.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writePlan(workspacePath: string, doc: VBriefDocument): void {
  const planDir = join(workspacePath, PAN_DIRNAME);
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, PAN_SPEC_FILENAME), JSON.stringify(doc));
}

function makeDoc(planId: string, items: Array<{ id: string; title: string }>): VBriefDocument {
  return {
    vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: planId,
      title: `${planId} Test Plan`,
      status: 'approved',
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createBeadsFromVBrief', () => {
  let WORKSPACE_DIR: string;

  beforeEach(() => {
    vi.clearAllMocks();
    WORKSPACE_DIR = join(
      tmpdir(),
      `cbfv-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(WORKSPACE_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(WORKSPACE_DIR, { recursive: true, force: true });
  });

  it('returns error when bd CLI is not found', async () => {
    mockExecAsync.mockRejectedValueOnce(new Error('which: no bd in (PATH)'));

    const result = await createBeadsFromVBrief(WORKSPACE_DIR);

    expect(result.success).toBe(false);
    expect(result.errors).toContain('bd (beads) CLI not found in PATH');
    expect(result.created).toHaveLength(0);
  });

  it('creates .beads/redirect when main repo has .beads/ but workspace does not', async () => {
    // Workspace lives two levels below the project root: projectRoot/workspaces/feature-x/
    const projectRoot = WORKSPACE_DIR;
    const workspacePath = join(projectRoot, 'workspaces', 'feature-test');
    mkdirSync(workspacePath, { recursive: true });

    // Main .beads/ exists at project root — no redirect in workspace yet
    mkdirSync(join(projectRoot, '.beads'), { recursive: true });

    writePlan(workspacePath, makeDoc('PAN-TEST', [{ id: 'item-1', title: 'First task' }]));

    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })   // which bd
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // bd list --json --limit 0
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })             // bd list --json -l ...
      .mockResolvedValueOnce({ stdout: 'bead-001\n', stderr: '' });    // bd create

    const result = await createBeadsFromVBrief(workspacePath);

    // Redirect file must have been written
    const redirectContent = readFileSync(join(workspacePath, '.beads', 'redirect'), 'utf-8');
    expect(redirectContent).toBe('../../.beads');

    expect(result.success).toBe(true);
    expect(result.created).toContain('PAN-TEST: First task');
  });

  it('auto-inits database when bd list fails with "database not found"', async () => {
    // Use a nested workspace path so deriveProjectPrefix is deterministic:
    // workspace = projectRoot/workspaces/feature-init  →  prefix = basename(projectRoot)
    const projectRoot = WORKSPACE_DIR;
    const workspacePath = join(projectRoot, 'workspaces', 'feature-init');
    mkdirSync(workspacePath, { recursive: true });

    setupRedirect(workspacePath);
    writePlan(workspacePath, makeDoc('PAN-INIT', [{ id: 'item-1', title: 'Setup task' }]));

    const expectedPrefix = basename(projectRoot).toLowerCase().replace(/[^a-z0-9-]/g, '-');

    const dbError = new Error('Error: database not found, defaulting to local');
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })   // which bd
      .mockRejectedValueOnce(dbError)                                  // bd list --json --limit 0
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // bd init --prefix <expectedPrefix>
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // git config beads.role contributor
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // bd config set export.git-add false
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })             // bd list --json -l ...
      .mockResolvedValueOnce({ stdout: 'bead-002\n', stderr: '' });    // bd create

    const result = await createBeadsFromVBrief(workspacePath);

    // bd init must have been called with the repo-derived prefix.
    const initCall = mockExecAsync.mock.calls.find(
      ([file, args]: [string, string[]]) =>
        file === 'bd' && Array.isArray(args) && args[0] === 'init' && args.includes('--prefix'),
    );
    expect(initCall).toBeDefined();
    expect(initCall![1]).toContain(expectedPrefix);

    expect(result.success).toBe(true);
    expect(result.created).toContain('PAN-INIT: Setup task');
  });

  it('creates beads for each plan item and returns their IDs', async () => {
    setupRedirect(WORKSPACE_DIR);
    writePlan(WORKSPACE_DIR, makeDoc('PAN-MULTI', [
      { id: 'item-a', title: 'Alpha task' },
      { id: 'item-b', title: 'Beta task' },
    ]));

    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })   // which bd
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // bd list --json --limit 0
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })             // bd list --json -l ... (idempotency)
      .mockResolvedValueOnce({ stdout: 'bead-alpha\n', stderr: '' })  // bd create item-a
      .mockResolvedValueOnce({ stdout: 'bead-beta\n', stderr: '' });  // bd create item-b

    const result = await createBeadsFromVBrief(WORKSPACE_DIR);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.created).toEqual(['PAN-MULTI: Alpha task', 'PAN-MULTI: Beta task']);
    expect(result.beadIds.get('item-a')).toBe('bead-alpha');
    expect(result.beadIds.get('item-b')).toBe('bead-beta');
  });

  it('deletes existing beads for the same label before creating new ones', async () => {
    setupRedirect(WORKSPACE_DIR);
    writePlan(WORKSPACE_DIR, makeDoc('PAN-IDEM', [{ id: 'item-1', title: 'Rebuilt task' }]));

    const existingBeads = JSON.stringify([{ id: 'stale-bead-42' }, { id: 'stale-bead-43' }]);
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })    // which bd
      .mockResolvedValueOnce({ stdout: '', stderr: '' })                // bd list --json --limit 0
      .mockResolvedValueOnce({ stdout: existingBeads, stderr: '' })    // bd list --json -l ... (idempotency)
      .mockResolvedValueOnce({ stdout: '', stderr: '' })                // bd delete stale-bead-42
      .mockResolvedValueOnce({ stdout: '', stderr: '' })                // bd delete stale-bead-43
      .mockResolvedValueOnce({ stdout: 'fresh-bead-1\n', stderr: '' }); // bd create

    const result = await createBeadsFromVBrief(WORKSPACE_DIR);

    // execFile form: mockExecAsync('bd', ['delete', '<id>', '--force'], opts)
    const deleteCalls = mockExecAsync.mock.calls.filter(
      ([file, args]: [string, string[]]) =>
        file === 'bd' && Array.isArray(args) && args[0] === 'delete',
    );
    expect(deleteCalls).toHaveLength(2);
    expect(deleteCalls[0][1]).toContain('stale-bead-42');
    expect(deleteCalls[1][1]).toContain('stale-bead-43');

    expect(result.success).toBe(true);
    expect(result.created).toContain('PAN-IDEM: Rebuilt task');
    expect(result.beadIds.get('item-1')).toBe('fresh-bead-1');
  });
});
