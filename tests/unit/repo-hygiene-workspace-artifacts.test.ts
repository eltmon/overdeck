import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

// Workspace-local plan artifacts are gitignored and must NEVER be git-tracked.
// A tracked copy on main is inherited by every new workspace (a worktree of
// main), which is how one issue's workspace ends up showing another issue's
// spec ("spec drift" — PAN-1982's spec surfaced in feature-pan-1894). Once a
// file is tracked, .gitignore no longer protects it: the work agent's own
// `git add -A` / per-bead commits re-carry it into PRs and back onto main.
// This guard fails the build if any of these ever become tracked again, so the
// contamination can't silently recur.
const MUST_NOT_BE_TRACKED = ['.pan/spec.vbrief.json', '.pan/continue.json'];

describe('workspace-local plan artifacts are not git-tracked', () => {
  for (const path of MUST_NOT_BE_TRACKED) {
    it(`${path} is gitignored and not tracked on the repo`, () => {
      const tracked = execFileSync('git', ['ls-files', path], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      }).trim();
      expect(tracked).toBe('');
    });
  }
});
