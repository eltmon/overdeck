/**
 * PAN-1990 review fix (cycle 3, durability/correctness): removeMemoryStateMirror
 * can have already `rm`'d the local file and committed that removal in a PRIOR
 * call, then failed only at the push step. On retry, the file no longer exists
 * locally, so a plain "nothing to do" would silently strand the unpushed commit
 * forever — deleteWorkspace would go on to delete the canonical workspace/pin
 * rows with no way left to discover or retry the stuck push. This must instead
 * retry the PUSH itself (pushPendingStateCommits) and only succeed once that's
 * confirmed, or once there was genuinely nothing to push.
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
});

afterEach(() => {
  unregisterProjectSync(PROJECT_KEY);
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('removeMemoryStateMirror retry-push (cycle 3 review fix)', () => {
  it('retries the push (not a silent no-op) when the target is already gone from a prior committed-but-unpushed attempt', async () => {
    const { removeMemoryStateMirror } = await import('../../../../src/lib/memory/state-mirror.js');
    const relativePath = 'pins/already-gone.json';
    const target = join(projectRoot, '.pan', 'memory', relativePath);
    // Simulate: a prior attempt already `rm`'d and committed this removal
    // locally — the file does not exist, but nothing has confirmed it reached
    // the remote yet.
    expect(existsSync(target)).toBe(false);

    mockPushPendingStateCommits.mockReturnValue(Effect.succeed({ pushed: true }));

    await expect(removeMemoryStateMirror(PROJECT_KEY, relativePath, 'chore(memory): unmirror pin')).resolves.toBeUndefined();

    expect(mockPushPendingStateCommits).toHaveBeenCalledWith(projectRoot);
    // No new file write/commit was attempted — there's nothing to add, only
    // the earlier stuck commit needed pushing.
    expect(mockQueueAutoCommit).not.toHaveBeenCalled();
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

  it('the normal path (file still present) commits+pushes as before and never calls pushPendingStateCommits', async () => {
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
