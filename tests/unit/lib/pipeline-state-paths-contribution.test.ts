/**
 * PAN-2468: the post-review guard must survive a rebase.
 *
 * When a passed-review feature branch is rebased onto a newer main, every commit
 * SHA on the branch is rewritten even though the patch the branch applies is
 * byte-for-byte identical. The SHA-based `haveSameEffectiveCodeCommit` reports a
 * change and the deacon resets the passed review — an infinite re-review loop
 * while main is active. `haveSameCodeContribution` compares the merge-base-
 * relative contribution by git patch-id (content, not SHA) so a benign rebase is
 * recognised and the review/test verdicts are preserved.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import {
  haveSameCodeContribution,
  haveSameEffectiveCodeCommit,
} from '../../../src/lib/pipeline-state-paths.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

describe('haveSameCodeContribution (PAN-2468 rebase-tolerant review guard)', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'pan-2468-contrib-'));
    git(repo, 'init', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@test.com');
    git(repo, 'config', 'user.name', 'Test');
    writeFileSync(join(repo, 'app.ts'), 'export const x = 1;\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'base');
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  /** Build a feature branch: one real-code commit + one state-plane commit on top. */
  function makeFeature(): string {
    git(repo, 'checkout', '-b', 'feature/x', 'main');
    writeFileSync(join(repo, 'feature.ts'), 'export const feat = true;\n');
    git(repo, 'add', 'feature.ts');
    git(repo, 'commit', '-m', 'feat: add feature');
    mkdirSync(join(repo, '.pan', 'specs'), { recursive: true });
    writeFileSync(join(repo, '.pan', 'specs', 's.json'), '{"a":1}');
    git(repo, 'add', '.pan');
    git(repo, 'commit', '-m', 'chore: sync planning artifacts');
    return git(repo, 'rev-parse', 'HEAD');
  }

  it('preserves review across a pure rebase onto a newer main', async () => {
    const reviewedTip = makeFeature();

    // main advances with an unrelated commit
    git(repo, 'checkout', 'main');
    writeFileSync(join(repo, 'other.ts'), 'export const y = 2;\n');
    git(repo, 'add', 'other.ts');
    git(repo, 'commit', '-m', 'unrelated main change');

    // rebase the feature onto the new main → new SHAs, identical contribution
    git(repo, 'checkout', 'feature/x');
    git(repo, 'rebase', 'main');
    const rebasedTip = git(repo, 'rev-parse', 'HEAD');

    expect(rebasedTip).not.toBe(reviewedTip); // the rebase rewrote every SHA

    // The bug this guards against: the SHA-based check reads the rebase as new code
    expect(await haveSameEffectiveCodeCommit(repo, reviewedTip, rebasedTip)).toBe(false);
    // The fix: the patch-id check recognises the benign rebase and preserves review
    expect(await haveSameCodeContribution(repo, reviewedTip, rebasedTip, 'main')).toBe(true);
  });

  it('resets review when the code contribution genuinely changes', async () => {
    const reviewedTip = makeFeature();

    writeFileSync(join(repo, 'feature.ts'), 'export const feat = false; // changed\n');
    git(repo, 'add', 'feature.ts');
    git(repo, 'commit', '-m', 'fix: change feature behaviour');
    const changedTip = git(repo, 'rev-parse', 'HEAD');

    expect(await haveSameCodeContribution(repo, reviewedTip, changedTip, 'main')).toBe(false);
  });

  it('ignores state-plane-only churn between two heads', async () => {
    const reviewedTip = makeFeature();

    writeFileSync(join(repo, '.pan', 'specs', 's.json'), '{"a":2}');
    git(repo, 'add', '.pan');
    git(repo, 'commit', '-m', 'chore: sync planning artifacts again');
    const stateTip = git(repo, 'rev-parse', 'HEAD');

    expect(stateTip).not.toBe(reviewedTip);
    expect(await haveSameCodeContribution(repo, reviewedTip, stateTip, 'main')).toBe(true);
  });

  it('returns false when the base ref cannot be resolved', async () => {
    const reviewedTip = makeFeature();
    expect(await haveSameCodeContribution(repo, reviewedTip, reviewedTip, 'origin/nonexistent')).toBe(false);
  });

  it('treats two heads whose contributions are both state-only as identical', async () => {
    // Branch with ONLY state-plane commits: the code contribution is empty on
    // both sides — the empty-diff sentinel must compare equal, not null-out.
    git(repo, 'checkout', '-b', 'feature/state-only', 'main');
    mkdirSync(join(repo, '.pan', 'records'), { recursive: true });
    writeFileSync(join(repo, '.pan', 'records', 'r.json'), '{"a":1}');
    git(repo, 'add', '.pan');
    git(repo, 'commit', '-m', 'chore: record state');
    const tipA = git(repo, 'rev-parse', 'HEAD');

    writeFileSync(join(repo, '.pan', 'records', 'r.json'), '{"a":2}');
    git(repo, 'add', '.pan');
    git(repo, 'commit', '-m', 'chore: record more state');
    const tipB = git(repo, 'rev-parse', 'HEAD');

    expect(await haveSameCodeContribution(repo, tipA, tipB, 'main')).toBe(true);
  });
});
