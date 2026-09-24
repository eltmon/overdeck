/**
 * Tests for src/lib/reopen.ts — reopenWorkspaceState()
 *
 * PAN-3917: reopening no longer rewrites a review_status row — every field it
 * used to reset is derived from the tracker and the PR. What is left is the
 * issue-closed cache and the continue-file breadcrumb.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../helpers/overdeck-test-db.js';

// ── Overdeck DB fixture ───────────────────────────────────────────────────────

let odb: OverdeckTestDb;
let projectStub: { projectPath: string; projectKey?: string } | null = null;
const mockClearIssueClosedCache = vi.fn();

vi.mock('../../src/lib/cloister/issue-closed.js', () => ({
  clearIssueClosedCache: (...args: unknown[]) => mockClearIssueClosedCache(...args),
}));

vi.mock('../../src/lib/pipeline-notifier.js', () => ({
  notifyPipeline: vi.fn(),
}));

vi.mock('../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityTts: vi.fn(),
}));

// PAN-946 regression: the reopen flow now resolves the project path so it can
// append a session breadcrumb beside the issue's current xBRIEF (which may live
// in completed/ or cancelled/). Stub the resolver so the test controls the
// project root and can seed the lifecycle layout below.
vi.mock('../../src/lib/projects.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/projects.js')>(
    '../../src/lib/projects.js',
  );
  return {
    ...actual,
    resolveProjectFromIssue: () => projectStub,
    resolveProjectFromIssueSync: () => projectStub,
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a minimal workspace directory (no longer used directly by reopen, but
 * kept for parity with callers that still pass workspacePath). */
function createWorkspace(): string {
  const wsDir = mkdtempSync(join(tmpdir(), 'pan-reopen-ws-'));
  const planningDir = join(wsDir, '.planning');
  mkdirSync(planningDir, { recursive: true });
  return wsDir;
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  odb = setupOverdeckTestDb();
  projectStub = null;
  mockClearIssueClosedCache.mockClear();
}, 20_000);

afterEach(() => {
  teardownOverdeckTestDb(odb);
});

// ── Import under test (after mocks) ─────────────────────────────────────────

import { reopenWorkspaceState } from '../../src/lib/reopen.js';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('reopenWorkspaceState', () => {
  it('clears the closed-issue cache for the reopened issue', async () => {
    const wsDir = createWorkspace();

    await reopenWorkspaceState('PAN-999', wsDir);

    expect(mockClearIssueClosedCache).toHaveBeenCalledWith('PAN-999');

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('skips the continue breadcrumb when the issue resolves to no project', async () => {
    const wsDir = createWorkspace();

    const result = await reopenWorkspaceState('PAN-999', wsDir, { reason: 'regression' });

    expect(result.continueFileUpdated).toBe(false);
    expect(result.reason).toBe('regression');

    rmSync(wsDir, { recursive: true, force: true });
  });
});
