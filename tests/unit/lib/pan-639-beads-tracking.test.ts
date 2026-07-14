/**
 * PAN-639 / PAN-2541 regression tests: tasks state must never be silently lost.
 *
 * PAN-639 originally guarded that `.tasks/` was tracked (not gitignored) on the
 * code branch, protecting against a repeat of commit fe2c7803 where tasks got
 * accidentally gitignored and task history was lost.
 *
 * PAN-2541 migrated pipeline state — including `.tasks/` — onto the dedicated
 * `overdeck-state` branch, and now *intentionally* gitignores those paths on
 * `main` so state cannot leak back into code history. The fe2c7803-class no-loss
 * guard (tasks/records stay TRACKED on `overdeck-state`) now lives in
 * `tests/integration/state-branch-no-loss.test.ts`, which runs a real migration
 * on a self-contained fixture and asserts `.tasks/issues.jsonl` and
 * `records/*.json` are tracked on `origin/overdeck-state`.
 *
 * This file guards the post-migration `main`-side reality: state paths are
 * ignored and absent, so state can never re-enter code history unnoticed.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');
const gitignorePath = join(ROOT, '.gitignore');

describe('PAN-639 / PAN-2541: tasks state tracking', () => {
  it('.planning/tasks/ must NOT be gitignored', () => {
    const content = readFileSync(gitignorePath, 'utf-8');
    const lines = content.split('\n');

    const activePlanningTasksIgnore = lines.filter(
      (line) => !line.trimStart().startsWith('#') && /^\s*\.planning\/tasks\/?\s*$/.test(line)
    );

    expect(activePlanningTasksIgnore).toEqual([]);
  });

  it('post PAN-2541: .tasks/ is gitignored on main (state lives on overdeck-state)', () => {
    // check-ignore exits 0 when the path is ignored — the intended post-migration
    // state. Tracking on overdeck-state is guarded by state-branch-no-loss.test.ts.
    let ignored = true;
    try {
      execFileSync('git', ['check-ignore', '-q', '.tasks/issues.jsonl'], { cwd: ROOT });
    } catch {
      ignored = false;
    }
    expect(ignored).toBe(true);
  });

  it('post PAN-2541: .tasks/issues.jsonl is not tracked on main', () => {
    const tracked = execFileSync('git', ['ls-files', '.tasks/issues.jsonl'], { cwd: ROOT, encoding: 'utf-8' });
    expect(tracked.trim()).toBe('');
  });
});
