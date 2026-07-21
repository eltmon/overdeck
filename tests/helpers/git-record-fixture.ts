/**
 * Git record-root fixture for tests that exercise the locked record write
 * door (PAN-2541). `updateIssueRecord` commits and pushes every record write,
 * so any fixture root that receives record writes must be a real git repo
 * with an origin remote — otherwise the write door throws
 * "Failed to commit <ID> state: not a git repo".
 *
 * Mirrors the setup in src/lib/pan-dir/__tests__/record-update.test.ts.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function gitIn(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

/**
 * Initialize `root` as a git repo on `main` with one seed commit and a bare
 * `origin` remote (created as a sibling temp dir). Returns the remote path;
 * callers own removing both directories in their afterEach.
 */
export function initGitRecordRoot(root: string): string {
  const remote = mkdtempSync(join(tmpdir(), 'pan-record-origin-'));
  gitIn(root, 'init', '-q');
  gitIn(root, 'config', 'user.email', 'test@overdeck.local');
  gitIn(root, 'config', 'user.name', 'Overdeck Test');
  gitIn(root, 'config', 'commit.gpgsign', 'false');
  gitIn(root, 'commit', '-q', '--allow-empty', '-m', 'seed fixture root');
  gitIn(root, 'branch', '-M', 'main');
  gitIn(remote, 'init', '--bare', '-q');
  gitIn(root, 'remote', 'add', 'origin', remote);
  gitIn(root, 'push', '-q', '-u', 'origin', 'main');
  return remote;
}

/** Remove a fixture remote created by initGitRecordRoot. */
export function removeGitRecordRemote(remote: string | null | undefined): void {
  if (!remote) return;
  rmSync(remote, { recursive: true, force: true });
}

/**
 * Remove a git-initialized fixture root. Debounced auto-commits can still be
 * writing into `.git/` when afterEach runs (queueAutoCommit schedules work on
 * later event-loop turns), so drain the root's pending commits first and
 * tolerate the residual race with rm retries.
 */
export async function cleanupGitRecordRoot(root: string | null | undefined): Promise<void> {
  if (!root) return;
  try {
    const { Effect } = await import('effect');
    const { flushAutoCommits } = await import('../../src/lib/pan-dir/auto-commit.js');
    await Effect.runPromise(flushAutoCommits(root));
  } catch { /* nothing pending, or the module is mocked away in this test */ }
  // A git child process from an unawaited debounced commit can still be
  // writing objects while we remove; retry over a ~3s window.
  for (let attempt = 0; ; attempt++) {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      return;
    } catch (err) {
      if (attempt >= 5) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
