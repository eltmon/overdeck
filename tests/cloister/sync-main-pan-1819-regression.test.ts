/**
 * PAN-1819 regression test: sync-main auto-commit must never commit
 * gitignored workspace-state files, and must explicitly exclude
 * workspace-state/sync-target paths regardless of ignore state.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  autoCommitWorkspaceChangesBeforeSync,
  AUTO_COMMIT_EXCLUDED_PATHS,
  syncMainIntoWorkspace,
} from '../../src/lib/cloister/merge-agent.js';

describe('autoCommitWorkspaceChangesBeforeSync (PAN-1819)', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'pan-1819-'));
    execSync('git init --initial-branch=main -q', { cwd: repo });
    execSync('git config user.email "test@test.com"', { cwd: repo });
    execSync('git config user.name "Test"', { cwd: repo });
    execSync('git config commit.gpgsign false', { cwd: repo });

    // Seed a file and an initial commit so HEAD exists.
    writeFileSync(join(repo, 'README.md'), '# test');
    execSync('git add README.md', { cwd: repo });
    execSync('git commit -q -m "init"', { cwd: repo });

    // Workspace-state files must be gitignored.
    writeFileSync(
      join(repo, '.gitignore'),
      ['.pan/continue.json', '.pan/spec.vbrief.json', '.pan/handoff-*.md', '.claude/rules/', ''].join('\n'),
    );
    execSync('git add .gitignore', { cwd: repo });
    execSync('git commit -q -m "add gitignore"', { cwd: repo });
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('does not commit gitignored files or excluded sync-target paths', async () => {
    mkdirSync(join(repo, '.pan'), { recursive: true });
    mkdirSync(join(repo, '.claude', 'rules'), { recursive: true });

    // Dirty a tracked source file (should be committed).
    writeFileSync(join(repo, 'README.md'), '# updated');

    // Dirty gitignored files (must NOT be committed).
    writeFileSync(join(repo, '.pan', 'continue.json'), '{"v":1}');
    writeFileSync(join(repo, '.pan', 'spec.vbrief.json'), '{"p":1}');
    writeFileSync(join(repo, '.pan', 'handoff-123.md'), '# handoff');

    // Dirty an excluded sync-target file that is not gitignored (must NOT be committed).
    writeFileSync(join(repo, '.claude', 'rules', 'async-tmux.md'), '# rule');

    const result = await autoCommitWorkspaceChangesBeforeSync(repo);

    expect(result.success).toBe(true);
    expect(result.committed).toBe(true);

    // The commit should contain only README.md.
    const committedFiles = execSync('git diff-tree --no-commit-id --name-only -r HEAD', {
      cwd: repo,
      encoding: 'utf-8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);

    expect(committedFiles).toEqual(['README.md']);

    // Excluded files must remain present but unstaged/untracked.
    for (const file of [
      '.pan/continue.json',
      '.pan/spec.vbrief.json',
      '.pan/handoff-123.md',
      '.claude/rules/async-tmux.md',
    ]) {
      expect(execSync('git ls-files ' + file, { cwd: repo, encoding: 'utf-8' }).trim()).toBe('');
    }
  });

  it('is a no-op when only excluded/ignored files are dirty', async () => {
    mkdirSync(join(repo, '.pan'), { recursive: true });
    writeFileSync(join(repo, '.pan', 'continue.json'), '{"v":1}');

    const before = execSync('git log --oneline', { cwd: repo, encoding: 'utf-8' }).trim();

    const result = await autoCommitWorkspaceChangesBeforeSync(repo);

    expect(result.success).toBe(true);
    expect(result.committed).toBe(false);

    const after = execSync('git log --oneline', { cwd: repo, encoding: 'utf-8' }).trim();
    expect(after).toBe(before);
  });

  it('exports the expected exclusion list', () => {
    expect(AUTO_COMMIT_EXCLUDED_PATHS).toContain('.pan/kickoff.md');
    expect(AUTO_COMMIT_EXCLUDED_PATHS).toContain('.pan/continue.json');
    expect(AUTO_COMMIT_EXCLUDED_PATHS).toContain('.pan/handoff-*.md');
    expect(AUTO_COMMIT_EXCLUDED_PATHS).toContain('.pan/spec.vbrief.json');
    expect(AUTO_COMMIT_EXCLUDED_PATHS).toContain('.claude/rules/');
    expect(AUTO_COMMIT_EXCLUDED_PATHS).toContain('.claude/skills/');
  });
});

describe('syncMainIntoWorkspace pipeline-owned conflicts (PAN-1841)', () => {
  let repo: string;
  let remote: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'pan-1841-repo-'));
    remote = mkdtempSync(join(tmpdir(), 'pan-1841-origin-'));
    execSync('git init --bare -q', { cwd: remote });

    execSync('git init --initial-branch=main -q', { cwd: repo });
    execSync('git config user.email "test@test.com"', { cwd: repo });
    execSync('git config user.name "Test"', { cwd: repo });
    execSync('git config commit.gpgsign false', { cwd: repo });
    execSync(`git remote add origin ${remote}`, { cwd: repo });

    mkdirSync(join(repo, '.beads'), { recursive: true });
    mkdirSync(join(repo, '.pan', 'continues'), { recursive: true });
    mkdirSync(join(repo, '.pan', 'specs'), { recursive: true });
    writeFileSync(join(repo, '.beads', 'issues.jsonl'), '{"id":"PAN-1","state":"base"}\n');
    writeFileSync(join(repo, '.pan', 'continues', 'PAN-1.vbrief.json'), '{"state":"base"}\n');
    writeFileSync(join(repo, '.pan', 'specs', 'PAN-1.vbrief.json'), '{"spec":"base"}\n');
    writeFileSync(join(repo, 'README.md'), '# base\n');
    execSync('git add .', { cwd: repo });
    execSync('git commit -q -m "init"', { cwd: repo });
    execSync('git push -q -u origin main', { cwd: repo });

    execSync('git switch -q -c feature/pan-1841', { cwd: repo });
    writeFileSync(join(repo, '.beads', 'issues.jsonl'), '{"id":"PAN-1","state":"feature"}\n');
    writeFileSync(join(repo, '.pan', 'continues', 'PAN-1.vbrief.json'), '{"state":"feature"}\n');
    writeFileSync(join(repo, '.pan', 'specs', 'PAN-1.vbrief.json'), '{"spec":"feature"}\n');
    execSync('git add .beads .pan', { cwd: repo });
    execSync('git commit -q -m "feature state"', { cwd: repo });

    execSync('git switch -q main', { cwd: repo });
    writeFileSync(join(repo, '.beads', 'issues.jsonl'), '{"id":"PAN-1","state":"main"}\n');
    writeFileSync(join(repo, '.pan', 'continues', 'PAN-1.vbrief.json'), '{"state":"main"}\n');
    writeFileSync(join(repo, '.pan', 'specs', 'PAN-1.vbrief.json'), '{"spec":"main"}\n');
    execSync('git add .beads .pan', { cwd: repo });
    execSync('git commit -q -m "main state"', { cwd: repo });
    execSync('git push -q origin main', { cwd: repo });

    execSync('git switch -q feature/pan-1841', { cwd: repo });
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });

  it('prefers origin/main for divergent .pan lifecycle and .beads files', async () => {
    const result = await syncMainIntoWorkspace(repo, 'PAN-1841');

    expect(result.success).toBe(true);
    expect(result.conflictFiles).toBeUndefined();
    expect(execSync('git diff --name-only --diff-filter=U', { cwd: repo, encoding: 'utf-8' }).trim()).toBe('');
    expect(execSync('git status --porcelain', { cwd: repo, encoding: 'utf-8' }).trim()).toBe('');
    expect(readFileSync(join(repo, '.beads', 'issues.jsonl'), 'utf-8')).toBe('{"id":"PAN-1","state":"main"}\n');
    expect(readFileSync(join(repo, '.pan', 'continues', 'PAN-1.vbrief.json'), 'utf-8')).toBe('{"state":"main"}\n');
    expect(readFileSync(join(repo, '.pan', 'specs', 'PAN-1.vbrief.json'), 'utf-8')).toBe('{"spec":"main"}\n');
  });
});
