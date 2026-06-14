import { Effect } from 'effect';
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
import { createBeadsFromVBrief, resolveBdTimeout, retryBd, clearBeadsForIssue } from '../beads.js';
import { writeAutoStartVBrief } from '../auto-synthesize.js';
import { findPlanSync, readWorkspacePlanSync } from '../io.js';

const originalPanopticonHome = process.env.PANOPTICON_HOME;

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

function createWorktreeShape(workspacePath: string): void {
  writeFileSync(join(workspacePath, '.git'), 'gitdir: ../../.git/worktrees/test-worktree');
  mkdirSync(join(workspacePath, '.pan', 'specs'), { recursive: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createBeadsFromVBrief', () => {
  let projectRoot: string;
  let WORKSPACE_DIR: string;

  beforeEach(() => {
    vi.clearAllMocks();
    // Fix the operational timeout so resolveBdTimeout skips its probe; this keeps
    // existing mock sequences stable. The probe behavior is tested separately below.
    process.env.PANOPTICON_BD_TIMEOUT_MS = '30000';
    const ws = createWorkspace('PAN-500');
    projectRoot = ws.projectRoot;
    WORKSPACE_DIR = ws.workspacePath;
    process.env.PANOPTICON_HOME = join(projectRoot, '.panopticon-home');
  });

  afterEach(() => {
    delete process.env.PANOPTICON_BD_TIMEOUT_MS;
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns error when bd CLI is not found', async () => {
    mockExecAsync.mockRejectedValueOnce(new Error('which: no bd in (PATH)'));

    const result = await Effect.runPromise(createBeadsFromVBrief(WORKSPACE_DIR));

    expect(result.success).toBe(false);
    expect(result.errors).toContain('bd (beads) CLI not found in PATH');
    expect(result.created).toHaveLength(0);
  });

  it('retries transient list failures while clearing existing beads', async () => {
    vi.useFakeTimers();
    setupRedirect(WORKSPACE_DIR);
    mockExecAsync
      .mockRejectedValueOnce(new Error('database is locked'))
      .mockResolvedValueOnce({ stdout: '[]' })
      .mockResolvedValueOnce({ stdout: '[]' });

    const result = await clearBeadsForIssue(WORKSPACE_DIR, 'pan-500', {
      maxAttempts: 2,
      initialDelayMs: 100,
      maxDelayMs: 100,
      random: () => 0,
      sleep: (ms) => vi.advanceTimersByTimeAsync(ms),
    });

    expect(result).toEqual({ cleared: 0, errors: [] });
    expect(mockExecAsync).toHaveBeenCalledTimes(3);
  });

  it('retries transient list failures while the bd process lock is already held', async () => {
    vi.useFakeTimers();
    setupRedirect(WORKSPACE_DIR);
    mockExecAsync
      .mockRejectedValueOnce(new Error('database is locked'))
      .mockResolvedValueOnce({ stdout: '[]' })
      .mockResolvedValueOnce({ stdout: '[]' });

    const result = await clearBeadsForIssue(WORKSPACE_DIR, 'pan-500', {
      lockAlreadyHeld: true,
      maxAttempts: 2,
      initialDelayMs: 100,
      maxDelayMs: 100,
      random: () => 0,
      sleep: (ms) => vi.advanceTimersByTimeAsync(ms),
    });

    expect(result).toEqual({ cleared: 0, errors: [] });
    expect(mockExecAsync).toHaveBeenCalledTimes(3);
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
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'bead-001\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'bead-002\n', stderr: '' });

    const result = await Effect.runPromise(createBeadsFromVBrief(WORKSPACE_DIR));

    expect(result.success).toBe(true);
    expect(result.created).toEqual(['PAN-500: First task', 'PAN-500: Second task']);
  });

  it('creates beads from an auto-start vBRIEF written to the project spec directory for a git worktree', async () => {
    createWorktreeShape(WORKSPACE_DIR);
    setupRedirect(WORKSPACE_DIR);

    const written = await Effect.runPromise(writeAutoStartVBrief(projectRoot, WORKSPACE_DIR, {
      issueId: 'PAN-500',
      title: 'Auto-start round trip',
      body: '- [ ] Create the auto-start bead',
      url: 'https://github.com/eltmon/panopticon-cli/issues/500',
    }));

    expect(findPlanSync(WORKSPACE_DIR)).toBe(written.projectSpecPath);
    const resolvedPlan = readWorkspacePlanSync(WORKSPACE_DIR);
    expect(resolvedPlan).not.toBeNull();
    expect(resolvedPlan!.plan.items[0].id).toBe('auto-start');

    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'bead-auto-start\n', stderr: '' });

    const result = await Effect.runPromise(createBeadsFromVBrief(WORKSPACE_DIR));

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.created.length).toBeGreaterThanOrEqual(1);
    expect(result.created).toContain('pan-500: Implement issue');
    expect(result.beadIds.get('auto-start')).toBe('bead-auto-start');
  });

  it('creates .beads/redirect when main repo has .beads/ but workspace does not', async () => {
    // Main .beads/ exists at project root — no redirect in workspace yet
    mkdirSync(join(projectRoot, '.beads'), { recursive: true });

    writePlan(projectRoot, 'PAN-500', makeDoc('PAN-500', [{ id: 'item-1', title: 'First task' }]));

    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })   // which bd
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // bd ping --json
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })             // bd list --json -l ...
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })             // post-delete bd list verification
      .mockResolvedValueOnce({ stdout: 'bead-001\n', stderr: '' });    // bd create

    const result = await Effect.runPromise(createBeadsFromVBrief(WORKSPACE_DIR));

    // Redirect file must have been written
    const redirectContent = readFileSync(join(WORKSPACE_DIR, '.beads', 'redirect'), 'utf-8');
    expect(redirectContent).toBe('../../.beads');

    expect(result.success).toBe(true);
    expect(result.created).toContain('PAN-500: First task');
  });

  it('returns an error after bd doctor when a redirect-managed probe still fails', async () => {
    vi.useFakeTimers();
    const ws2 = createWorkspace('PAN-501');
    setupRedirect(ws2.workspacePath);
    writePlan(ws2.projectRoot, 'PAN-501', makeDoc('PAN-501', [{ id: 'item-1', title: 'Should not init' }]));

    const dbError = new Error('Error 1146 (HY000): table not found: issues');
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })   // which bd
      .mockRejectedValueOnce(dbError)                                  // bd ping --json attempt 1
      .mockRejectedValueOnce(dbError)                                  // bd ping --json attempt 2
      .mockRejectedValueOnce(dbError)                                  // bd ping --json attempt 3
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // bd doctor --fix
      .mockRejectedValueOnce(dbError)                                  // retry bd ping attempt 1
      .mockRejectedValueOnce(dbError)                                  // retry bd ping attempt 2
      .mockRejectedValueOnce(dbError);                                 // retry bd ping attempt 3

    const resultPromise = Effect.runPromise(createBeadsFromVBrief(ws2.workspacePath));
    await vi.advanceTimersByTimeAsync(10000);
    const result = await resultPromise;

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

    vi.useRealTimers();
    rmSync(ws2.projectRoot, { recursive: true, force: true });
  });

  it('runs bd doctor and continues when retry ping succeeds', async () => {
    vi.useFakeTimers();
    const ws3 = createWorkspace('PAN-502');
    setupRedirect(ws3.workspacePath);
    writePlan(ws3.projectRoot, 'PAN-502', makeDoc('PAN-502', [{ id: 'item-1', title: 'Recovered task' }]));

    const dbError = new Error('Error 1146 (HY000): table not found: issues');
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })   // which bd
      .mockRejectedValueOnce(dbError)                                  // bd ping --json attempt 1
      .mockRejectedValueOnce(dbError)                                  // bd ping --json attempt 2
      .mockRejectedValueOnce(dbError)                                  // bd ping --json attempt 3
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // bd doctor --fix
      .mockRejectedValueOnce(dbError)                                  // retry bd ping attempt 1
      .mockRejectedValueOnce(dbError)                                  // retry bd ping attempt 2
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // retry bd ping attempt 3
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })             // bd list --json -l ... (idempotency)
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })             // post-delete bd list verification
      .mockResolvedValueOnce({ stdout: 'bead-recovered\n', stderr: '' }); // bd create

    const resultPromise = Effect.runPromise(createBeadsFromVBrief(ws3.workspacePath));
    await vi.advanceTimersByTimeAsync(10000);
    const result = await resultPromise;

    const doctorCalls = mockExecAsync.mock.calls.filter(
      ([file, args]: [string, string[]]) =>
        file === 'bd' && Array.isArray(args) && args[0] === 'doctor' && args[1] === '--fix',
    );
    expect(doctorCalls).toHaveLength(1);
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.created).toContain('PAN-502: Recovered task');

    vi.useRealTimers();
    rmSync(ws3.projectRoot, { recursive: true, force: true });
  });

  it('recovers from PAN-457 table-missing corruption and creates every plan item', async () => {
    vi.useFakeTimers();
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
      .mockRejectedValueOnce(tableMissing)                              // bd ping attempt 1
      .mockRejectedValueOnce(tableMissing)                              // bd ping attempt 2
      .mockRejectedValueOnce(tableMissing)                              // bd ping attempt 3
      .mockResolvedValueOnce({ stdout: '', stderr: '' })                // bd doctor --fix
      .mockResolvedValueOnce({ stdout: '', stderr: '' })                // retry bd ping attempt 1 (success)
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'bead-alpha\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'bead-beta\n', stderr: '' });

    const resultPromise = Effect.runPromise(createBeadsFromVBrief(ws9.workspacePath));
    await vi.advanceTimersByTimeAsync(10000);
    const result = await resultPromise;

    const createCalls = mockExecAsync.mock.calls.filter(
      ([file, args]: [string, string[]]) => file === 'bd' && Array.isArray(args) && args[0] === 'create',
    );
    expect(result.success).toBe(true);
    expect(createCalls).toHaveLength(2);
    expect(result.created).toEqual(['PAN-509: Recovered alpha', 'PAN-509: Recovered beta']);
    expect(result.errors.join('\n')).not.toMatch(/stale local-DB artifacts/i);

    vi.useRealTimers();
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
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })             // post-delete bd list verification
      .mockResolvedValueOnce({ stdout: 'bead-002\n', stderr: '' });    // bd create

    const result = await Effect.runPromise(createBeadsFromVBrief(ws3.workspacePath));

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
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })             // post-delete bd list verification
      .mockResolvedValueOnce({ stdout: 'bead-alpha\n', stderr: '' })  // bd create item-a
      .mockResolvedValueOnce({ stdout: 'bead-beta\n', stderr: '' });  // bd create item-b

    const result = await Effect.runPromise(createBeadsFromVBrief(ws4.workspacePath));

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
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })              // post-delete bd list verification
      .mockResolvedValueOnce({ stdout: 'fresh-bead-1\n', stderr: '' }); // bd create

    const result = await Effect.runPromise(createBeadsFromVBrief(ws5.workspacePath));

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
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'bead-auto\n', stderr: '' });

    await Effect.runPromise(createBeadsFromVBrief(ws6.workspacePath));

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
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'bead-deep\n', stderr: '' });

    await Effect.runPromise(createBeadsFromVBrief(ws7.workspacePath));

    const createCall = mockExecAsync.mock.calls.find(
      ([file, args]: [string, string[]]) => file === 'bd' && Array.isArray(args) && args[0] === 'create',
    );
    const metadata = JSON.parse(createCall![1][createCall![1].indexOf('--metadata') + 1]);
    expect(metadata.requiresInspection).toBe(true);
    expect(metadata.inspectionDepth).toBe('deep');

    rmSync(ws7.projectRoot, { recursive: true, force: true });
  });

  describe('idempotency and dedup failure semantics', () => {
    const createCalls = () => mockExecAsync.mock.calls.filter(
      ([file, args]: [string, string[]]) => file === 'bd' && Array.isArray(args) && args[0] === 'create',
    );

    it('three consecutive calls leave exactly planItemCount beads', async () => {
      const ws8 = createWorkspace('PAN-507');
      setupRedirect(ws8.workspacePath);
      writePlan(ws8.projectRoot, 'PAN-507', makeDoc('PAN-507', [
        { id: 'item-a', title: 'Alpha task' },
        { id: 'item-b', title: 'Beta task' },
      ]));

      const beads: Array<{ id: string; title: string }> = [];
      let nextId = 1;
      mockExecAsync.mockImplementation(async (file: string, args: string[]) => {
        if (file === 'which') return { stdout: '/usr/bin/bd', stderr: '' };
        if (file === 'bd' && args[0] === 'ping') return { stdout: '', stderr: '' };
        if (file === 'bd' && args[0] === 'list') return { stdout: JSON.stringify(beads), stderr: '' };
        if (file === 'bd' && args[0] === 'delete') {
          const index = beads.findIndex(bead => bead.id === args[1]);
          if (index !== -1) beads.splice(index, 1);
          return { stdout: '', stderr: '' };
        }
        if (file === 'bd' && args[0] === 'create') {
          const id = `bead-${nextId++}`;
          beads.push({ id, title: args[1] });
          return { stdout: `${id}\n`, stderr: '' };
        }
        throw new Error(`unexpected call: ${file} ${args.join(' ')}`);
      });

      for (let i = 0; i < 3; i++) {
        const result = await Effect.runPromise(createBeadsFromVBrief(ws8.workspacePath));
        expect(result.success).toBe(true);
      }

      expect(beads).toHaveLength(2);
      expect(beads.map(bead => bead.title).sort()).toEqual([
        'PAN-507: Alpha task',
        'PAN-507: Beta task',
      ]);
      expect(new Set(beads.map(bead => bead.title)).size).toBe(2);

      rmSync(ws8.projectRoot, { recursive: true, force: true });
    });

    it('aborts when bd list throws during dedup', async () => {
      vi.useFakeTimers();
      const ws8 = createWorkspace('PAN-508');
      setupRedirect(ws8.workspacePath);
      writePlan(ws8.projectRoot, 'PAN-508', makeDoc('PAN-508', [{ id: 'item-1', title: 'Blocked task' }]));

      mockExecAsync.mockImplementation(async (file: string, args: string[]) => {
        if (file === 'which') return { stdout: '/usr/bin/bd', stderr: '' };
        if (file === 'bd' && args[0] === 'ping') return { stdout: '', stderr: '' };
        if (file === 'bd' && args[0] === 'list') throw new Error('bd list exploded');
        return { stdout: 'unexpected\n', stderr: '' };
      });

      const resultPromise = Effect.runPromise(createBeadsFromVBrief(ws8.workspacePath));
      await vi.advanceTimersByTimeAsync(10000);
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('dedup failed:');
      expect(result.errors[0]).toContain('list failed:');
      expect(createCalls()).toHaveLength(0);

      vi.useRealTimers();
      rmSync(ws8.projectRoot, { recursive: true, force: true });
    });

    it('preserves exhausted transient bd list failures during dedup', async () => {
      vi.useFakeTimers();
      const ws8 = createWorkspace('PAN-508');
      setupRedirect(ws8.workspacePath);
      writePlan(ws8.projectRoot, 'PAN-508', makeDoc('PAN-508', [{ id: 'item-1', title: 'Blocked task' }]));

      mockExecAsync.mockImplementation(async (file: string, args: string[]) => {
        if (file === 'which') return { stdout: '/usr/bin/bd', stderr: '' };
        if (file === 'bd' && args[0] === 'ping') return { stdout: '', stderr: '' };
        if (file === 'bd' && args[0] === 'list') throw Object.assign(new Error('database is locked'), { stderr: 'database is locked' });
        return { stdout: 'unexpected\n', stderr: '' };
      });

      const resultPromise = Effect.runPromise(createBeadsFromVBrief(ws8.workspacePath, {
        maxAttempts: 2,
        initialDelayMs: 100,
        maxDelayMs: 100,
        random: () => 0,
        sleep: (ms) => vi.advanceTimersByTimeAsync(ms),
      }));

      const result = await resultPromise;
      expect(result).toMatchObject({
        success: false,
        transientFailure: expect.anything(),
      });
      expect(result.errors[0]).toContain('dedup failed:');
      expect(result.errors[0]).toContain('list failed:');
      expect(createCalls()).toHaveLength(0);

      rmSync(ws8.projectRoot, { recursive: true, force: true });
    });

    it('aborts when any bd delete fails during dedup', async () => {
      vi.useFakeTimers();
      const ws8 = createWorkspace('PAN-509');
      setupRedirect(ws8.workspacePath);
      writePlan(ws8.projectRoot, 'PAN-509', makeDoc('PAN-509', [{ id: 'item-1', title: 'Blocked task' }]));

      let listCalls = 0;
      const staleBeads = [{ id: 'stale-1' }, { id: 'stale-2' }, { id: 'stale-3' }];
      mockExecAsync.mockImplementation(async (file: string, args: string[]) => {
        if (file === 'which') return { stdout: '/usr/bin/bd', stderr: '' };
        if (file === 'bd' && args[0] === 'ping') return { stdout: '', stderr: '' };
        if (file === 'bd' && args[0] === 'list') {
          listCalls++;
          return { stdout: JSON.stringify(listCalls === 1 ? staleBeads : []), stderr: '' };
        }
        if (file === 'bd' && args[0] === 'delete') {
          if (args[1] === 'stale-2') throw Object.assign(new Error('delete exploded'), { stderr: 'delete exploded' });
          return { stdout: '', stderr: '' };
        }
        return { stdout: 'unexpected\n', stderr: '' };
      });

      const resultPromise = Effect.runPromise(createBeadsFromVBrief(ws8.workspacePath));
      await vi.advanceTimersByTimeAsync(10000);
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errors.some(error => error.includes('dedup failed: delete stale-2:'))).toBe(true);
      expect(createCalls()).toHaveLength(0);

      vi.useRealTimers();
      rmSync(ws8.projectRoot, { recursive: true, force: true });
    });

    it('aborts when post-delete verification finds residual beads', async () => {
      vi.useFakeTimers();
      const ws8 = createWorkspace('PAN-510');
      setupRedirect(ws8.workspacePath);
      writePlan(ws8.projectRoot, 'PAN-510', makeDoc('PAN-510', [{ id: 'item-1', title: 'Blocked task' }]));

      let listCalls = 0;
      mockExecAsync.mockImplementation(async (file: string, args: string[]) => {
        if (file === 'which') return { stdout: '/usr/bin/bd', stderr: '' };
        if (file === 'bd' && args[0] === 'ping') return { stdout: '', stderr: '' };
        if (file === 'bd' && args[0] === 'list') {
          listCalls++;
          const beads = listCalls === 1 ? [{ id: 'stale-1' }, { id: 'stale-2' }] : [{ id: 'stale-2' }];
          return { stdout: JSON.stringify(beads), stderr: '' };
        }
        if (file === 'bd' && args[0] === 'delete') return { stdout: '', stderr: '' };
        return { stdout: 'unexpected\n', stderr: '' };
      });

      const resultPromise = Effect.runPromise(createBeadsFromVBrief(ws8.workspacePath));
      await vi.advanceTimersByTimeAsync(10000);
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errors.some(error => error.includes('dedup failed: residual 1 beads after delete: stale-2'))).toBe(true);
      expect(createCalls()).toHaveLength(0);

      vi.useRealTimers();
      rmSync(ws8.projectRoot, { recursive: true, force: true });
    });

    it('treats "not found" delete errors as success and clears cleanly', async () => {
      vi.useFakeTimers();
      const ws8 = createWorkspace('PAN-522');
      setupRedirect(ws8.workspacePath);
      writePlan(ws8.projectRoot, 'PAN-522', makeDoc('PAN-522', [{ id: 'item-1', title: 'Recovered task' }]));

      let listCalls = 0;
      mockExecAsync.mockImplementation(async (file: string, args: string[]) => {
        if (file === 'which') return { stdout: '/usr/bin/bd', stderr: '' };
        if (file === 'bd' && args[0] === 'ping') return { stdout: '', stderr: '' };
        if (file === 'bd' && args[0] === 'list') {
          listCalls++;
          return { stdout: JSON.stringify(listCalls === 1 ? [{ id: 'stale-1' }] : []), stderr: '' };
        }
        if (file === 'bd' && args[0] === 'delete') {
          throw Object.assign(new Error('issue stale-1 not found'), { stderr: 'issue stale-1 not found' });
        }
        if (file === 'bd' && args[0] === 'create') return { stdout: 'bead-fresh\n', stderr: '' };
        return { stdout: 'unexpected\n', stderr: '' };
      });

      const resultPromise = Effect.runPromise(createBeadsFromVBrief(ws8.workspacePath));
      await vi.advanceTimersByTimeAsync(10000);
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.created).toContain('PAN-522: Recovered task');
      expect(createCalls()).toHaveLength(1);

      vi.useRealTimers();
      rmSync(ws8.projectRoot, { recursive: true, force: true });
    });
  });

  describe('recover bead ID by exact title after create timeout', () => {
    function makeDocWithDeps(planId: string): VBriefDocument {
      return {
        vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
        plan: {
          id: planId,
          title: `${planId} Dep Plan`,
          status: 'active',
          items: [
            { id: 'item-a', title: 'Alpha task', status: 'pending', metadata: { difficulty: 'simple', issueLabel: planId.toLowerCase() } },
            { id: 'item-b', title: 'Beta task', status: 'pending', metadata: { difficulty: 'simple', issueLabel: planId.toLowerCase() } },
          ],
          edges: [{ type: 'blocks' as const, from: 'item-a', to: 'item-b' }],
        },
      };
    }

    it('recovers the bead ID from a matching title and uses it for later deps (AC1)', async () => {
      const ws = createWorkspace('PAN-511');
      setupRedirect(ws.workspacePath);
      writePlan(ws.projectRoot, 'PAN-511', makeDocWithDeps('PAN-511'));

      const timeoutError = Object.assign(new Error('timed out'), { killed: true, code: 'ETIMEDOUT' });
      mockExecAsync
        .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })              // which bd
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                          // bd ping --json
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })                        // dedup list
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })                        // post-delete list
        .mockRejectedValueOnce(timeoutError)                                        // bd create item-a times out
        .mockResolvedValueOnce({ stdout: JSON.stringify([{ id: 'bead-a', title: 'PAN-511: Alpha task' }]), stderr: '' }) // recovery list
        .mockResolvedValueOnce({ stdout: 'bead-b\n', stderr: '' })                  // bd create item-b
        .mockResolvedValueOnce({ stdout: JSON.stringify([{ issue_id: 'bead-b', depends_on_id: 'bead-a', type: 'blocks' }]), stderr: '' }); // dep list verification

      const result = await Effect.runPromise(createBeadsFromVBrief(ws.workspacePath));

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.beadIds.get('item-a')).toBe('bead-a');
      expect(result.beadIds.get('item-b')).toBe('bead-b');

      const createCalls = mockExecAsync.mock.calls.filter(
        ([file, args]: [string, string[]]) => file === 'bd' && Array.isArray(args) && args[0] === 'create',
      );
      expect(createCalls).toHaveLength(2);
      const betaCreateArgs = createCalls[1][1];
      const depsIndex = betaCreateArgs.indexOf('--deps');
      expect(depsIndex).toBeGreaterThan(-1);
      expect(betaCreateArgs[depsIndex + 1]).toBe('bead-a');

      rmSync(ws.projectRoot, { recursive: true, force: true });
    });

    it('records failure when recovery finds no matching title (AC2)', async () => {
      const ws = createWorkspace('PAN-512');
      setupRedirect(ws.workspacePath);
      writePlan(ws.projectRoot, 'PAN-512', makeDocWithDeps('PAN-512'));

      const timeoutError = Object.assign(new Error('timed out'), { killed: true, code: 'ETIMEDOUT' });
      mockExecAsync
        .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
        .mockRejectedValueOnce(timeoutError)                                // bd create item-a times out
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })                 // recovery list: no match
        .mockResolvedValueOnce({ stdout: 'bead-b\n', stderr: '' });          // bd create item-b (no dep, since item-a missing)

      const result = await Effect.runPromise(createBeadsFromVBrief(ws.workspacePath));

      expect(result.success).toBe(false);
      expect(result.errors.some(error => error.includes('Alpha task'))).toBe(true);
      expect(result.beadIds.get('item-a')).toBeUndefined();
      expect(result.beadIds.get('item-b')).toBe('bead-b');

      rmSync(ws.projectRoot, { recursive: true, force: true });
    });

    it('records ambiguity error when recovery finds multiple matching titles (AC3)', async () => {
      const ws = createWorkspace('PAN-513');
      setupRedirect(ws.workspacePath);
      writePlan(ws.projectRoot, 'PAN-513', makeDocWithDeps('PAN-513'));

      const timeoutError = Object.assign(new Error('timed out'), { killed: true, code: 'ETIMEDOUT' });
      mockExecAsync
        .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce({
          stdout: JSON.stringify([
            { id: 'bead-a1', title: 'PAN-513: Alpha task' },
            { id: 'bead-a2', title: 'PAN-513: Alpha task' },
          ]),
          stderr: '',
        })
        .mockResolvedValueOnce({ stdout: 'bead-b\n', stderr: '' });

      const result = await Effect.runPromise(createBeadsFromVBrief(ws.workspacePath));

      expect(result.success).toBe(false);
      expect(result.errors.some(error =>
        error.includes('Alpha task') && error.includes('multiple beads'),
      )).toBe(true);
      expect(result.beadIds.get('item-a')).toBeUndefined();

      rmSync(ws.projectRoot, { recursive: true, force: true });
    });

    it('does not issue a recovery list call after a successful create (AC4)', async () => {
      const ws = createWorkspace('PAN-514');
      setupRedirect(ws.workspacePath);
      writePlan(ws.projectRoot, 'PAN-514', makeDoc('PAN-514', [{ id: 'item-1', title: 'Clean task' }]));

      mockExecAsync
        .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'bead-clean\n', stderr: '' });

      const result = await Effect.runPromise(createBeadsFromVBrief(ws.workspacePath));

      expect(result.success).toBe(true);
      expect(result.beadIds.get('item-1')).toBe('bead-clean');

      const listCalls = mockExecAsync.mock.calls.filter(
        ([file, args]: [string, string[]]) => file === 'bd' && Array.isArray(args) && args[0] === 'list',
      );
      expect(listCalls).toHaveLength(2); // dedup + post-delete only

      rmSync(ws.projectRoot, { recursive: true, force: true });
    });
  });

  describe('retryBd', () => {
    it('retries an idempotent bd list twice then succeeds on the third attempt (AC1)', async () => {
      vi.useFakeTimers();
      const ws = createWorkspace('PAN-515');
      setupRedirect(ws.workspacePath);

      let listCalls = 0;
      let postDeleteAttempts = 0;
      mockExecAsync.mockImplementation(async (file: string, args: string[]) => {
        if (file === 'which') return { stdout: '/usr/bin/bd', stderr: '' };
        if (file === 'bd' && args[0] === 'list') {
          listCalls++;
          if (listCalls > 1) {
            postDeleteAttempts++;
            if (postDeleteAttempts <= 2) throw Object.assign(new Error('timed out'), { killed: true });
          }
          return { stdout: '[]', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const resultPromise = clearBeadsForIssue(ws.workspacePath, 'pan-515', 30000);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await resultPromise;

      expect(result.errors).toHaveLength(0);
      expect(postDeleteAttempts).toBe(3);

      vi.useRealTimers();
      rmSync(ws.projectRoot, { recursive: true, force: true });
    });

    it('fails after three attempts and issues no fourth call (AC2)', async () => {
      vi.useFakeTimers();
      const ws = createWorkspace('PAN-516');
      setupRedirect(ws.workspacePath);

      let attempts = 0;
      mockExecAsync.mockImplementation(async (file: string, args: string[]) => {
        if (file === 'which') return { stdout: '/usr/bin/bd', stderr: '' };
        if (file === 'bd' && args[0] === 'list') {
          attempts++;
          throw Object.assign(new Error('timed out'), { killed: true });
        }
        return { stdout: '', stderr: '' };
      });

      const resultPromise = clearBeadsForIssue(ws.workspacePath, 'pan-516', 30000);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await resultPromise;

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/list failed/);
      expect(attempts).toBe(3);

      vi.useRealTimers();
      rmSync(ws.projectRoot, { recursive: true, force: true });
    });

    it('never retries bd create (AC3)', async () => {
      vi.useFakeTimers();
      const ws = createWorkspace('PAN-517');
      setupRedirect(ws.workspacePath);
      writePlan(ws.projectRoot, 'PAN-517', makeDoc('PAN-517', [{ id: 'item-1', title: 'No retry task' }]));

      let createAttempts = 0;
      mockExecAsync.mockImplementation(async (file: string, args: string[]) => {
        if (file === 'which') return { stdout: '/usr/bin/bd', stderr: '' };
        if (file === 'bd' && args[0] === 'ping') return { stdout: '', stderr: '' };
        if (file === 'bd' && args[0] === 'list') return { stdout: '[]', stderr: '' };
        if (file === 'bd' && args[0] === 'create') {
          createAttempts++;
          throw Object.assign(new Error('timed out'), { killed: true });
        }
        return { stdout: '', stderr: '' };
      });

      const resultPromise = Effect.runPromise(createBeadsFromVBrief(ws.workspacePath));
      await vi.advanceTimersByTimeAsync(10000);
      const result = await resultPromise;

      expect(createAttempts).toBe(1);
      expect(result.success).toBe(false);
      expect(result.errors.some(error => error.includes('No retry task'))).toBe(true);

      vi.useRealTimers();
      rmSync(ws.projectRoot, { recursive: true, force: true });
    });

    it('uses exponential backoff driven by fake timers (AC4)', async () => {
      vi.useFakeTimers();

      let attempts = 0;
      const fn = vi.fn(async () => {
        attempts++;
        if (attempts < 3) throw new Error(`attempt ${attempts}`);
        return 'ok';
      });

      const resultPromise = retryBd(fn, { attempts: 3, baseDelayMs: 500 });
      await vi.advanceTimersByTimeAsync(2000);
      const result = await resultPromise;

      expect(result).toBe('ok');
      expect(attempts).toBe(3);
      expect(fn).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });
  });

  describe('verify and repair dependency edges after creation', () => {
    function makeDocWithDeps(planId: string): VBriefDocument {
      return {
        vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
        plan: {
          id: planId,
          title: `${planId} Dep Plan`,
          status: 'active',
          items: [
            { id: 'item-a', title: 'Alpha task', status: 'pending', metadata: { difficulty: 'simple', issueLabel: planId.toLowerCase() } },
            { id: 'item-b', title: 'Beta task', status: 'pending', metadata: { difficulty: 'simple', issueLabel: planId.toLowerCase() } },
          ],
          edges: [{ type: 'blocks' as const, from: 'item-a', to: 'item-b' }],
        },
      };
    }

    it('repairs a missing blocks edge with bd dep add (AC1)', async () => {
      const ws = createWorkspace('PAN-518');
      setupRedirect(ws.workspacePath);
      writePlan(ws.projectRoot, 'PAN-518', makeDocWithDeps('PAN-518'));

      mockExecAsync
        .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'bead-a\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'bead-b\n', stderr: '' })
        .mockResolvedValueOnce({
          stdout: JSON.stringify([{ issue_id: 'bead-b', depends_on_id: 'bead-c', type: 'blocks' }]),
          stderr: '',
        })                                                                   // dep list: expected edge missing
        .mockResolvedValueOnce({ stdout: '', stderr: '' });                   // dep add repair

      const result = await Effect.runPromise(createBeadsFromVBrief(ws.workspacePath));

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);

      const depAddCalls = mockExecAsync.mock.calls.filter(
        ([file, args]: [string, string[]]) => file === 'bd' && Array.isArray(args) && args[0] === 'dep' && args[1] === 'add',
      );
      expect(depAddCalls).toHaveLength(1);
      expect(depAddCalls[0][1]).toEqual(['dep', 'add', 'bead-b', 'bead-a']);

      rmSync(ws.projectRoot, { recursive: true, force: true });
    });

    it('issues no dep add when dep list already contains the edge (AC2)', async () => {
      const ws = createWorkspace('PAN-519');
      setupRedirect(ws.workspacePath);
      writePlan(ws.projectRoot, 'PAN-519', makeDocWithDeps('PAN-519'));

      mockExecAsync
        .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'bead-a\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'bead-b\n', stderr: '' })
        .mockResolvedValueOnce({
          stdout: JSON.stringify([{ issue_id: 'bead-b', depends_on_id: 'bead-a', type: 'blocks' }]),
          stderr: '',
        });

      const result = await Effect.runPromise(createBeadsFromVBrief(ws.workspacePath));

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);

      const depAddCalls = mockExecAsync.mock.calls.filter(
        ([file, args]: [string, string[]]) => file === 'bd' && Array.isArray(args) && args[0] === 'dep' && args[1] === 'add',
      );
      expect(depAddCalls).toHaveLength(0);

      rmSync(ws.projectRoot, { recursive: true, force: true });
    });

    it('falls back to dep.id when depends_on_id is absent (single-ID shape)', async () => {
      const ws = createWorkspace('PAN-5199');
      setupRedirect(ws.workspacePath);
      writePlan(ws.projectRoot, 'PAN-5199', makeDocWithDeps('PAN-5199'));

      mockExecAsync
        .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'bead-a\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'bead-b\n', stderr: '' })
        .mockResolvedValueOnce({
          stdout: JSON.stringify([{ issue_id: 'bead-b', id: 'bead-a', dependency_type: 'blocks' }]),
          stderr: '',
        });

      const result = await Effect.runPromise(createBeadsFromVBrief(ws.workspacePath));

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);

      const depAddCalls = mockExecAsync.mock.calls.filter(
        ([file, args]: [string, string[]]) => file === 'bd' && Array.isArray(args) && args[0] === 'dep' && args[1] === 'add',
      );
      expect(depAddCalls).toHaveLength(0);

      rmSync(ws.projectRoot, { recursive: true, force: true });
    });

    it('fails when dep add repair fails (AC3)', async () => {
      vi.useFakeTimers();
      const ws = createWorkspace('PAN-520');
      setupRedirect(ws.workspacePath);
      writePlan(ws.projectRoot, 'PAN-520', makeDocWithDeps('PAN-520'));

      mockExecAsync
        .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'bead-a\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'bead-b\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
        .mockRejectedValueOnce(new Error('dep add failed'))
        .mockRejectedValueOnce(new Error('dep add failed'))
        .mockRejectedValueOnce(new Error('dep add failed'));

      const resultPromise = Effect.runPromise(createBeadsFromVBrief(ws.workspacePath));
      await vi.advanceTimersByTimeAsync(10000);
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errors.some(error => error.includes('item-a') && error.includes('item-b'))).toBe(true);

      vi.useRealTimers();
      rmSync(ws.projectRoot, { recursive: true, force: true });
    });

    it('skips verification when plan has zero blocks edges (AC4)', async () => {
      const ws = createWorkspace('PAN-521');
      setupRedirect(ws.workspacePath);
      writePlan(ws.projectRoot, 'PAN-521', makeDoc('PAN-521', [{ id: 'item-1', title: 'Solo task' }]));

      mockExecAsync
        .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'bead-solo\n', stderr: '' });

      const result = await Effect.runPromise(createBeadsFromVBrief(ws.workspacePath));

      expect(result.success).toBe(true);

      const depCalls = mockExecAsync.mock.calls.filter(
        ([file, args]: [string, string[]]) => file === 'bd' && Array.isArray(args) && args[0] === 'dep',
      );
      expect(depCalls).toHaveLength(0);

      rmSync(ws.projectRoot, { recursive: true, force: true });
    });
  });

  describe('resolveBdTimeout', () => {
    it('returns PANOPTICON_BD_TIMEOUT_MS verbatim and does not probe bd (AC1)', async () => {
      delete process.env.PANOPTICON_BD_TIMEOUT_MS;
      process.env.PANOPTICON_BD_TIMEOUT_MS = '120000';

      const ws = createWorkspace('PAN-520');
      setupRedirect(ws.workspacePath);

      const timeout = await resolveBdTimeout(ws.workspacePath);

      expect(timeout).toBe(120000);
      const pingCalls = mockExecAsync.mock.calls.filter(
        ([file, args]: [string, string[]]) => file === 'bd' && Array.isArray(args) && args[0] === 'ping',
      );
      expect(pingCalls).toHaveLength(0);

      rmSync(ws.projectRoot, { recursive: true, force: true });
    });

    it('clamps bd ping total_ms * 20 between floor and ceiling (AC2)', async () => {
      delete process.env.PANOPTICON_BD_TIMEOUT_MS;

      const cases = [
        { totalMs: 5000, expected: 100000 },
        { totalMs: 255, expected: 30000 },
        { totalMs: 12000, expected: 180000 },
      ];

      for (const { totalMs, expected } of cases) {
        vi.clearAllMocks();
        const ws = createWorkspace(`PAN-${520 + totalMs}`);
        setupRedirect(ws.workspacePath);

        mockExecAsync.mockResolvedValueOnce({ stdout: JSON.stringify({ total_ms: totalMs }), stderr: '' });

        const timeout = await resolveBdTimeout(ws.workspacePath);
        expect(timeout).toBe(expected);

        const pingCalls = mockExecAsync.mock.calls.filter(
          ([file, args]: [string, string[]]) => file === 'bd' && Array.isArray(args) && args[0] === 'ping',
        );
        expect(pingCalls).toHaveLength(1);
        expect(pingCalls[0][2]).toMatchObject({ timeout: 8000 });

        rmSync(ws.projectRoot, { recursive: true, force: true });
      }
    });

    it('returns floor when bd ping throws or returns unparseable JSON (AC3)', async () => {
      delete process.env.PANOPTICON_BD_TIMEOUT_MS;

      const errorCases = [
        { label: 'throws', result: () => Promise.reject(new Error('ping failed')) },
        { label: 'unparseable', result: () => Promise.resolve({ stdout: 'not-json', stderr: '' }) },
      ];

      for (const { label, result } of errorCases) {
        vi.clearAllMocks();
        const ws = createWorkspace(`PAN-530-${label}`);
        setupRedirect(ws.workspacePath);

        mockExecAsync.mockImplementation(result);

        const timeout = await resolveBdTimeout(ws.workspacePath);
        expect(timeout).toBe(30000);

        rmSync(ws.projectRoot, { recursive: true, force: true });
      }
    });

    it('clamps PANOPTICON_BD_TIMEOUT_MS to the hard floor and ceiling', async () => {
      delete process.env.PANOPTICON_BD_TIMEOUT_MS;

      const cases = [
        { value: '5000', expected: 30000 },
        { value: '999999999', expected: 180000 },
      ];

      for (const { value, expected } of cases) {
        vi.clearAllMocks();
        process.env.PANOPTICON_BD_TIMEOUT_MS = value;
        const ws = createWorkspace(`PAN-540-${value}`);
        setupRedirect(ws.workspacePath);

        const timeout = await resolveBdTimeout(ws.workspacePath);
        expect(timeout).toBe(expected);

        const pingCalls = mockExecAsync.mock.calls.filter(
          ([file, args]: [string, string[]]) => file === 'bd' && Array.isArray(args) && args[0] === 'ping',
        );
        expect(pingCalls).toHaveLength(0);

        delete process.env.PANOPTICON_BD_TIMEOUT_MS;
        rmSync(ws.projectRoot, { recursive: true, force: true });
      }
    });
  });

  it('passes the resolved timeout to bd create (AC4)', async () => {
    delete process.env.PANOPTICON_BD_TIMEOUT_MS;
    process.env.PANOPTICON_BD_TIMEOUT_MS = '95000';

    const ws = createWorkspace('PAN-540');
    setupRedirect(ws.workspacePath);
    writePlan(ws.projectRoot, 'PAN-540', makeDoc('PAN-540', [{ id: 'item-1', title: 'Timeout task' }]));

    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })   // which bd
      .mockResolvedValueOnce({ stdout: '', stderr: '' })               // bd ping --json (connectivity probe)
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })             // bd list (dedup)
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })             // post-delete list
      .mockResolvedValueOnce({ stdout: 'bead-timeout\n', stderr: '' }); // bd create

    const result = await Effect.runPromise(createBeadsFromVBrief(ws.workspacePath));

    expect(result.success).toBe(true);

    const createCall = mockExecAsync.mock.calls.find(
      ([file, args]: [string, string[]]) => file === 'bd' && Array.isArray(args) && args[0] === 'create',
    );
    expect(createCall).toBeDefined();
    expect(createCall![2]).toMatchObject({ timeout: 95000 });

    rmSync(ws.projectRoot, { recursive: true, force: true });
  });
});
