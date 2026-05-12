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
  execFile: vi.fn().mockImplementation((_file, _args, _opts, callback) => {
    // Invoke callback based on mockExecAsync's current rejection state.
    // This is needed because execFile uses a callback API but mockExecAsync
    // uses promise-based mock rejection — the callback bridges the two.
    const maybePromise = mockExecAsync(_file, _args, _opts);
    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise.then(
        (v: any) => callback(null, v.stdout ?? '', v.stderr ?? ''),
        (e: any) => callback(e, '', ''),
      );
    } else {
      callback(null, (maybePromise as any)?.stdout ?? '', (maybePromise as any)?.stderr ?? '');
    }
    return {};
  }),
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
      .mockResolvedValueOnce({ stdout: '{"ok":true}', stderr: '' })   // bd ping --json
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })             // bd list --json -l ...
      .mockResolvedValueOnce({ stdout: 'bead-001\n', stderr: '' });    // bd create

    const result = await createBeadsFromVBrief(workspacePath);

    // Redirect file must have been written
    const redirectContent = readFileSync(join(workspacePath, '.beads', 'redirect'), 'utf-8');
    expect(redirectContent).toBe('../../.beads');

    expect(result.success).toBe(true);
    expect(result.created).toContain('PAN-TEST: First task');
  });

  it('refuses to bd init when redirect exists and probe fails (would clobber redirect)', async () => {
    // Regression: createBeadsFromVBrief used to run `bd init --prefix` in a worktree
    // whenever the connectivity probe failed AND a redirect existed. `bd init` creates
    // a self-contained local Dolt DB, clobbering the redirect — and if init then failed
    // partway, the worktree was left with metadata.json pointing at a schema-less local
    // DB that broke every subsequent bd call ("table not found: issues").
    const projectRoot = WORKSPACE_DIR;
    const workspacePath = join(projectRoot, 'workspaces', 'feature-redirect-probe-fail');
    mkdirSync(workspacePath, { recursive: true });

    setupRedirect(workspacePath);
    writePlan(workspacePath, makeDoc('PAN-NOINIT', [{ id: 'item-1', title: 'Should not init' }]));

    const dbError = new Error('Error 1146 (HY000): table not found: issues');
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })   // which bd
      .mockRejectedValueOnce(dbError)                                  // bd ping --json (fails — not "unknown command")
      .mockRejectedValueOnce(dbError)                                  // bd doctor --fix (also fails)
      .mockRejectedValueOnce(new Error('unreachable'));                 // bd ping --json (retry after doctor — still fails)

    const result = await createBeadsFromVBrief(workspacePath);

    // bd init must NOT have been called.
    const initCall = mockExecAsync.mock.calls.find(
      ([file, args]: [string, string[]]) =>
        file === 'bd' && Array.isArray(args) && args[0] === 'init',
    );
    expect(initCall).toBeUndefined();

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/connectivity|probe/i);
  });

  it('runs bd init only when there is no redirect AND no main beads (true fresh install)', async () => {
    // Standalone path: a single-repo project (not a worktree) with no .beads/ anywhere.
    // The early setup block in createBeadsFromVBrief runs `bd init` here (line ~92),
    // because mainBeadsDir doesn't exist and beadsDir doesn't exist. The probe that
    // follows then succeeds against the freshly-initialized DB.
    const projectRoot = WORKSPACE_DIR;
    const workspacePath = join(projectRoot, 'workspaces', 'feature-init');
    mkdirSync(workspacePath, { recursive: true });
    // No setupRedirect, no main .beads/ — true fresh-install scenario.

    writePlan(workspacePath, makeDoc('PAN-INIT', [{ id: 'item-1', title: 'Setup task' }]));

    const expectedPrefix = basename(projectRoot).toLowerCase().replace(/[^a-z0-9-]/g, '-');

    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })   // which bd
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // bd init --prefix <expectedPrefix> (early setup)
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // git config beads.role contributor
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // bd config set export.git-add false
      .mockResolvedValueOnce({ stdout: '{"ok":true}', stderr: '' })   // bd ping --json (probe — succeeds after init)
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })             // bd list --json -l ... (idempotency)
      .mockResolvedValueOnce({ stdout: 'bead-002\n', stderr: '' });    // bd create

    const result = await createBeadsFromVBrief(workspacePath);

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
      .mockResolvedValueOnce({ stdout: '{"ok":true}', stderr: '' })   // bd ping --json
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
      .mockResolvedValueOnce({ stdout: '{"ok":true}', stderr: '' })    // bd ping --json
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

  it('defaults missing inspection policy to auto and preserves per-item metadata', async () => {
    setupRedirect(WORKSPACE_DIR);
    const doc = makeDoc('PAN-AUTO', [{ id: 'item-1', title: 'Auto task' }]);
    doc.plan.items[0].metadata = {
      difficulty: 'simple',
      issueLabel: 'pan-auto',
      requiresInspection: true,
      inspectionDepth: 'deep',
    };
    writePlan(WORKSPACE_DIR, doc);

    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })
      .mockResolvedValueOnce({ stdout: '{"ok":true}', stderr: '' })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'bead-auto\n', stderr: '' });

    await createBeadsFromVBrief(WORKSPACE_DIR);

    const createCall = mockExecAsync.mock.calls.find(
      ([file, args]: [string, string[]]) => file === 'bd' && Array.isArray(args) && args[0] === 'create',
    );
    const metadata = JSON.parse(createCall![1][createCall![1].indexOf('--metadata') + 1]);
    expect(metadata.requiresInspection).toBe(true);
    expect(metadata.inspectionDepth).toBe('deep');
  });

  it('materializes global inspection policy into bead metadata', async () => {
    setupRedirect(WORKSPACE_DIR);
    const doc = makeDoc('PAN-DEEP', [{ id: 'item-1', title: 'Deep task' }]);
    doc.vBRIEFInfo.inspectionPolicy = 'deep';
    doc.plan.items[0].metadata = {
      difficulty: 'simple',
      issueLabel: 'pan-deep',
      requiresInspection: false,
      inspectionDepth: 'fast',
    };
    writePlan(WORKSPACE_DIR, doc);

    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })
      .mockResolvedValueOnce({ stdout: '{"ok":true}', stderr: '' })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'bead-deep\n', stderr: '' });

    await createBeadsFromVBrief(WORKSPACE_DIR);

    const createCall = mockExecAsync.mock.calls.find(
      ([file, args]: [string, string[]]) => file === 'bd' && Array.isArray(args) && args[0] === 'create',
    );
    const metadata = JSON.parse(createCall![1][createCall![1].indexOf('--metadata') + 1]);
    expect(metadata.requiresInspection).toBe(true);
    expect(metadata.inspectionDepth).toBe('deep');
  });

  it('falls back to bd list --json --limit 0 when bd ping --json fails with unknown command (v1.0.2 compat)', async () => {
    // v1.0.2 does not have `bd ping`. When ping fails with "unknown command",
    // the code falls back to the old bd list --json --limit 0 probe.
    setupRedirect(WORKSPACE_DIR);
    writePlan(WORKSPACE_DIR, makeDoc('PAN-FALLBACK', [{ id: 'item-1', title: 'Fallback task' }]));

    const unknownCmdError = new Error('Error: unknown command "ping" for "bd"');
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })    // which bd
      .mockRejectedValueOnce(unknownCmdError)                            // bd ping --json (unknown command — triggers fallback)
      .mockResolvedValueOnce({ stdout: '', stderr: '' })                // bd list --json --limit 0 (fallback succeeds)
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })               // bd list --json -l ... (idempotency)
      .mockResolvedValueOnce({ stdout: 'bead-fb\n', stderr: '' });      // bd create

    const result = await createBeadsFromVBrief(WORKSPACE_DIR);

    expect(result.success).toBe(true);
    expect(result.created).toContain('PAN-FALLBACK: Fallback task');
    expect(result.beadIds.get('item-1')).toBe('bead-fb');

    // Verify bd ping was called first (fallback was triggered by unknown command)
    const pingCall = mockExecAsync.mock.calls.find(
      ([file, args]: [string, string[]]) =>
        file === 'bd' && Array.isArray(args) && args[0] === 'ping',
    );
    expect(pingCall).toBeDefined();
    // And bd list was called as fallback
    const listCall = mockExecAsync.mock.calls.find(
      ([file, args]: [string, string[]]) =>
        file === 'bd' && Array.isArray(args) && args[0] === 'list' && args[2] === '--limit' && args[3] === '0',
    );
    expect(listCall).toBeDefined();
  });
});
