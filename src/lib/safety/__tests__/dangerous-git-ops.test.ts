import { Effect } from 'effect';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  runGitClean,
  dryRunGitClean,
  runGitResetHard,
  DangerousGitOpError,
  DangerousOpBlockedError,
} from '../dangerous-git-ops.js';
import { GIT_CLEAN_EXCLUDES, gitCleanExcludeFlags } from '../protected-paths.js';

function makeTmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pan-safety-test-'));
  execSync('git init -q -b main', { cwd: dir });
  execSync('git config user.email a@b.c && git config user.name test', { cwd: dir });
  writeFileSync(join(dir, 'README'), 'tracked\n');
  execSync('git add . && git commit -q -m init', { cwd: dir });
  return dir;
}

describe('protected-paths', () => {
  it('exposes a non-empty exclude list with both .pan and .devcontainer', () => {
    expect(GIT_CLEAN_EXCLUDES.length).toBeGreaterThan(0);
    expect(GIT_CLEAN_EXCLUDES).toContain('.pan');
    expect(GIT_CLEAN_EXCLUDES).toContain('.beads');
    expect(GIT_CLEAN_EXCLUDES).toContain('.devcontainer');
    expect(GIT_CLEAN_EXCLUDES).toContain('.env');
    expect(GIT_CLEAN_EXCLUDES).toContain('node_modules');
  });

  it('formats exclude flags with quoted paths for git clean', () => {
    const flags = gitCleanExcludeFlags();
    for (const p of GIT_CLEAN_EXCLUDES) {
      expect(flags).toContain(`-e ${JSON.stringify(p)}`);
    }
  });

  it('appends extra excludes after the canonical list', () => {
    const flags = gitCleanExcludeFlags(['custom-extra']);
    expect(flags).toContain('-e "custom-extra"');
  });
});

describe('runGitClean', () => {
  let repo: string;

  beforeEach(() => {
    repo = makeTmpRepo();
    // Three untracked items; .devcontainer and .pan must survive.
    writeFileSync(join(repo, 'untracked.txt'), 'x');
    writeFileSync(join(repo, '.env'), 'X=1');
    execSync('mkdir .devcontainer && touch .devcontainer/keep.yml', { cwd: repo });
    execSync('mkdir -p .pan/feedback && touch .pan/continue.json', { cwd: repo });
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('hard-fails with DangerousOpBlockedError when userInvoked is false', async () => {
    await expect(Effect.runPromise(
      runGitClean({
        workspacePath: repo,
        userInvoked: false,
        reason: 'agent attempted auto-clean',
      }),
    )).rejects.toBeInstanceOf(DangerousGitOpError);
  });

  it('blocked error carries a structured payload for routes to surface', async () => {
    try {
      await Effect.runPromise(runGitClean({
        workspacePath: repo,
        userInvoked: false,
        reason: 'agent attempted auto-clean',
      }));
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DangerousGitOpError);
      const blocked = (err as DangerousGitOpError).cause as DangerousOpBlockedError;
      const payload = blocked.toJSON();
      expect(payload.code).toBe('DANGEROUS_OP_BLOCKED');
      expect(payload.operation).toBe('git_clean');
      expect(payload.reason).toContain('agent attempted auto-clean');
      expect(payload.recovery).toContain('pan workspace deep-clean');
    }
    // Untracked file must still exist — the block prevented any deletion.
    expect(existsSync(join(repo, 'untracked.txt'))).toBe(true);
  });

  it('with userInvoked=true, deletes only paths NOT in the protected list', async () => {
    await Effect.runPromise(runGitClean({
      workspacePath: repo,
      userInvoked: true,
      reason: 'pan workspace deep-clean test',
    }));
    expect(existsSync(join(repo, 'untracked.txt'))).toBe(false);
    // Protected paths survived.
    expect(existsSync(join(repo, '.env'))).toBe(true);
    expect(existsSync(join(repo, '.devcontainer', 'keep.yml'))).toBe(true);
    expect(existsSync(join(repo, '.pan', 'continue.json'))).toBe(true);
  });

  it('dry-run lists what would be deleted without touching anything', async () => {
    const out = await Effect.runPromise(dryRunGitClean({ workspacePath: repo }));
    expect(out).toContain('untracked.txt');
    expect(out.every(p => !p.includes('.env'))).toBe(true);
    expect(out.every(p => !p.includes('.devcontainer'))).toBe(true);
    // Filesystem unchanged.
    expect(existsSync(join(repo, 'untracked.txt'))).toBe(true);
  });
});

describe('runGitResetHard', () => {
  let repo: string;

  beforeEach(() => {
    repo = makeTmpRepo();
    writeFileSync(join(repo, 'README'), 'tracked\n');
    execSync('git add . && git commit -q -m c2 --allow-empty', { cwd: repo });
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('runs without a userInvoked gate (tracked-only op)', async () => {
    const result = await Effect.runPromise(runGitResetHard({
      workspacePath: repo,
      ref: 'HEAD',
      reason: 'unit test',
    }));
    expect(result).toBeDefined();
  });

  it('rejects refs containing shell metacharacters', async () => {
    await expect(Effect.runPromise(
      runGitResetHard({
        workspacePath: repo,
        ref: 'HEAD; rm -rf /',
        reason: 'unit test',
      }),
    )).rejects.toMatchObject({ reason: expect.stringMatching(/unsafe ref/i) });
  });
});
