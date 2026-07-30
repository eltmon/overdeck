/**
 * PAN-1990 review fix (cycle 3, corrected in cycle 4): removeMemoryStateMirror
 * can have already `rm`'d the local file in a PRIOR call and then failed in one
 * of two different ways:
 *
 *   (a) the deletion was fully committed locally, only the PUSH failed — on
 *       retry there is nothing new to add/commit, so the retry must fall back
 *       to pushing the already-committed change.
 *   (b) `git add`/`git commit` itself failed (index lock, hook/signing
 *       failure, branch mismatch) — NOTHING was committed at all. On retry,
 *       `git add` on the already-missing-from-disk path still stages the
 *       deletion (same as `git rm`), so re-running add+commit+push is what
 *       actually recovers this case. A cycle-3 bug treated (a) and (b) the
 *       same way (push-only retry), which silently "succeeds" for (b): there
 *       is nothing ahead to push, so `git push` trivially reports success
 *       while the remote mirror was never actually removed.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerProjectSync, unregisterProjectSync } from '../../../../src/lib/projects.js';

const mockQueueAutoCommit = vi.hoisted(() => vi.fn());
const mockFlushAutoCommits = vi.hoisted(() => vi.fn());
const mockPushPendingStateCommits = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/lib/pan-dir/auto-commit.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/pan-dir/auto-commit.js')>(
    '../../../../src/lib/pan-dir/auto-commit.js',
  );
  return {
    ...actual,
    queueAutoCommit: mockQueueAutoCommit,
    flushAutoCommits: mockFlushAutoCommits,
    pushPendingStateCommits: mockPushPendingStateCommits,
  };
});

let projectRoot: string;
const PROJECT_KEY = 'state-mirror-retry-push-test-project';

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pan-1990-state-mirror-retry-'));
  registerProjectSync(PROJECT_KEY, { name: 'Retry Push Test', path: projectRoot });
  mockQueueAutoCommit.mockReset();
  mockFlushAutoCommits.mockReset();
  mockPushPendingStateCommits.mockReset();
  // Default: nothing new to add/commit for the (already-missing) target this
  // attempt — most tests below want to reach the push-only fallback branch.
  mockFlushAutoCommits.mockReturnValue(Effect.succeed({ committed: false, reason: 'no diff' }));
});

afterEach(() => {
  unregisterProjectSync(PROJECT_KEY);
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('removeMemoryStateMirror retry (case a: already committed, push failed)', () => {
  it('retries the push (not a silent no-op) when the target is already gone and the deletion was already committed', async () => {
    const { removeMemoryStateMirror } = await import('../../../../src/lib/memory/state-mirror.js');
    const relativePath = 'pins/already-gone.json';
    const target = join(projectRoot, '.pan', 'memory', relativePath);
    expect(existsSync(target)).toBe(false);

    mockPushPendingStateCommits.mockReturnValue(Effect.succeed({ pushed: true }));

    await expect(removeMemoryStateMirror(PROJECT_KEY, relativePath, 'chore(memory): unmirror pin')).resolves.toBeUndefined();

    // The retry re-attempted add+commit first (mocked as "no diff"), THEN
    // fell back to the push-only retry once it found nothing new to commit.
    expect(mockQueueAutoCommit).toHaveBeenCalledWith(expect.objectContaining({ projectRoot, paths: [target] }));
    expect(mockPushPendingStateCommits).toHaveBeenCalledWith(projectRoot);
  });

  it('still throws (does not silently succeed) when the retry-push also fails', async () => {
    const { removeMemoryStateMirror } = await import('../../../../src/lib/memory/state-mirror.js');
    const relativePath = 'pins/still-stuck.json';

    mockPushPendingStateCommits.mockReturnValue(Effect.succeed({ pushed: false, reason: 'non-fast-forward' }));

    await expect(removeMemoryStateMirror(PROJECT_KEY, relativePath, 'chore(memory): unmirror pin'))
      .rejects.toThrow('non-fast-forward');
  });

  it('treats a null pushPendingStateCommits result (nothing to push / no repo) as a clean no-op', async () => {
    const { removeMemoryStateMirror } = await import('../../../../src/lib/memory/state-mirror.js');
    const relativePath = 'pins/never-mirrored.json';

    mockPushPendingStateCommits.mockReturnValue(Effect.succeed(null));

    await expect(removeMemoryStateMirror(PROJECT_KEY, relativePath, 'chore(memory): unmirror pin')).resolves.toBeUndefined();
  });
});

describe('removeMemoryStateMirror retry (case b: add/commit itself failed — cycle 4 review fix)', () => {
  it('re-commits and pushes successfully when the retry find a real diff to stage (add/commit failed last time, never actually committed)', async () => {
    const { removeMemoryStateMirror } = await import('../../../../src/lib/memory/state-mirror.js');
    const relativePath = 'pins/add-failed-last-time.json';

    // This time, staging the already-missing path succeeds and produces a
    // real commit that gets pushed — proving the retry actually re-attempts
    // the commit rather than assuming it already happened.
    mockFlushAutoCommits.mockReturnValue(Effect.succeed({ committed: true, pushed: true }));

    await expect(removeMemoryStateMirror(PROJECT_KEY, relativePath, 'chore(memory): unmirror pin')).resolves.toBeUndefined();

    expect(mockQueueAutoCommit).toHaveBeenCalled();
    // A fresh commit was made and confirmed pushed — no need to also call
    // the push-only fallback.
    expect(mockPushPendingStateCommits).not.toHaveBeenCalled();
  });

  it('throws immediately on an add/commit error, WITHOUT falling through to the push-only retry (the exact bug this cycle fixes)', async () => {
    const { removeMemoryStateMirror } = await import('../../../../src/lib/memory/state-mirror.js');
    const relativePath = 'pins/index-locked.json';

    // Simulates git add/commit itself failing (e.g. index.lock present).
    mockFlushAutoCommits.mockReturnValue(Effect.succeed({ committed: false, errored: true, reason: 'index.lock exists' }));
    // If the bug were still present, the code would ignore this error and
    // fall back to pushPendingStateCommits, which would report a false
    // success since nothing was ever actually committed.
    mockPushPendingStateCommits.mockReturnValue(Effect.succeed({ pushed: true }));

    await expect(removeMemoryStateMirror(PROJECT_KEY, relativePath, 'chore(memory): unmirror pin'))
      .rejects.toThrow('index.lock exists');

    expect(mockPushPendingStateCommits).not.toHaveBeenCalled();
  });

  it('re-commits successfully but throws when THAT push fails', async () => {
    const { removeMemoryStateMirror } = await import('../../../../src/lib/memory/state-mirror.js');
    const relativePath = 'pins/recommit-push-fails.json';

    mockFlushAutoCommits.mockReturnValue(Effect.succeed({ committed: true, pushed: false, reason: 'non-fast-forward on retry' }));

    await expect(removeMemoryStateMirror(PROJECT_KEY, relativePath, 'chore(memory): unmirror pin'))
      .rejects.toThrow('non-fast-forward on retry');
    expect(mockPushPendingStateCommits).not.toHaveBeenCalled();
  });
});

describe('removeMemoryStateMirror normal path (file still present)', () => {
  it('commits+pushes as before and never calls pushPendingStateCommits', async () => {
    const { removeMemoryStateMirror } = await import('../../../../src/lib/memory/state-mirror.js');
    const relativePath = 'pins/present.json';
    const target = join(projectRoot, '.pan', 'memory', relativePath);
    mkdirSync(join(projectRoot, '.pan', 'memory', 'pins'), { recursive: true });
    writeFileSync(target, '{}', 'utf8');

    mockFlushAutoCommits.mockReturnValue(Effect.succeed({ committed: true, pushed: true }));

    await expect(removeMemoryStateMirror(PROJECT_KEY, relativePath, 'chore(memory): unmirror pin')).resolves.toBeUndefined();

    expect(existsSync(target)).toBe(false);
    expect(mockQueueAutoCommit).toHaveBeenCalledWith(expect.objectContaining({ projectRoot, paths: [target] }));
    expect(mockPushPendingStateCommits).not.toHaveBeenCalled();
  });
});
