/**
 * PAN-3881: a git hook deleted from `sync-sources/hooks/git-hooks/` must not
 * leave a dangling symlink in every project's hooks dir. Only symlinks into
 * Overdeck's own hook source dir whose target is gone are removed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// installGitHooksInDir reads the module-level SYNC_SOURCES.gitHooks, so point
// it at a fixed temp path that each test recreates.
const fixed = vi.hoisted(() => ({ sourceDir: '' }));
vi.mock('../../../src/lib/paths.js', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  fixed.sourceDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pan-3881-githooks-src-')), 'git-hooks');
  return { SYNC_SOURCES: { gitHooks: fixed.sourceDir } };
});

import { installGitHooksInDir, pruneDanglingGitHookLinks } from '../../../src/lib/git-hooks.js';

let root: string;
let sourceDir: string;
let otherDir: string;
let hooksDir: string;

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pan-3881-githooks-'));
  sourceDir = join(root, 'sync-sources', 'hooks', 'git-hooks');
  mkdirSync(fixed.sourceDir, { recursive: true });
  otherDir = join(root, 'other-hooks');
  hooksDir = join(root, 'repo', '.git', 'hooks');
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(otherDir, { recursive: true });
  mkdirSync(hooksDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(fixed.sourceDir, { recursive: true, force: true });
});

describe('pruneDanglingGitHookLinks', () => {
  it('removes a symlink whose Overdeck source hook was deleted', () => {
    writeFileSync(join(sourceDir, 'post-checkout'), '#!/bin/sh\n');
    writeFileSync(join(sourceDir, 'pre-push'), '#!/bin/sh\n');
    symlinkSync(join(sourceDir, 'post-checkout'), join(hooksDir, 'post-checkout'));
    symlinkSync(join(sourceDir, 'pre-push'), join(hooksDir, 'pre-push'));

    rmSync(join(sourceDir, 'pre-push'));

    expect(pruneDanglingGitHookLinks(hooksDir, sourceDir)).toEqual(['pre-push']);
    expect(isLink(join(hooksDir, 'pre-push'))).toBe(false);
    // The hook whose source still exists stays linked.
    expect(isLink(join(hooksDir, 'post-checkout'))).toBe(true);
  });

  it('resolves relative symlinks into the source dir', () => {
    writeFileSync(join(sourceDir, 'pre-commit'), '#!/bin/sh\n');
    symlinkSync('../../../sync-sources/hooks/git-hooks/pre-commit', join(hooksDir, 'pre-commit'));
    rmSync(join(sourceDir, 'pre-commit'));

    expect(pruneDanglingGitHookLinks(hooksDir, sourceDir)).toEqual(['pre-commit']);
    expect(isLink(join(hooksDir, 'pre-commit'))).toBe(false);
  });

  it('never touches regular hooks, backups, or dangling links into other dirs', () => {
    writeFileSync(join(hooksDir, 'commit-msg'), '#!/bin/sh\nuser hook\n');
    writeFileSync(join(hooksDir, 'pre-push.backup'), '#!/bin/sh\nold user hook\n');
    // A dangling link, but into someone else's hook dir.
    symlinkSync(join(otherDir, 'gone'), join(hooksDir, 'prepare-commit-msg'));
    // A dangling link into a subdirectory of the source dir is not a direct hook.
    symlinkSync(join(sourceDir, 'nested', 'gone'), join(hooksDir, 'post-merge'));

    expect(pruneDanglingGitHookLinks(hooksDir, sourceDir)).toEqual([]);
    expect(readFileSync(join(hooksDir, 'commit-msg'), 'utf8')).toContain('user hook');
    expect(existsSync(join(hooksDir, 'pre-push.backup'))).toBe(true);
    expect(isLink(join(hooksDir, 'prepare-commit-msg'))).toBe(true);
    expect(isLink(join(hooksDir, 'post-merge'))).toBe(true);
  });

  it('prunes nothing when the source dir itself is missing', () => {
    symlinkSync(join(sourceDir, 'post-checkout'), join(hooksDir, 'post-checkout'));
    rmSync(sourceDir, { recursive: true, force: true });

    expect(pruneDanglingGitHookLinks(hooksDir, sourceDir)).toEqual([]);
    expect(isLink(join(hooksDir, 'post-checkout'))).toBe(true);
  });

  it('returns [] when the hooks dir does not exist', () => {
    expect(pruneDanglingGitHookLinks(join(root, 'nope'), sourceDir)).toEqual([]);
  });
});

describe('installGitHooksInDir', () => {
  it('removes links to deleted Overdeck hooks while installing the current ones', () => {
    const gitDir = join(root, 'registered', '.git');
    const repoHooks = join(gitDir, 'hooks');
    mkdirSync(repoHooks, { recursive: true });
    writeFileSync(join(fixed.sourceDir, 'post-checkout'), '#!/bin/sh\n');
    writeFileSync(join(fixed.sourceDir, 'pre-push'), '#!/bin/sh\n');
    writeFileSync(join(repoHooks, 'commit-msg'), '#!/bin/sh\nuser hook\n');

    expect(installGitHooksInDir(gitDir)).toBe(2);
    rmSync(join(fixed.sourceDir, 'pre-push'));
    installGitHooksInDir(gitDir);

    expect(isLink(join(repoHooks, 'pre-push'))).toBe(false);
    expect(isLink(join(repoHooks, 'post-checkout'))).toBe(true);
    expect(readFileSync(join(repoHooks, 'commit-msg'), 'utf8')).toContain('user hook');
  });
});
