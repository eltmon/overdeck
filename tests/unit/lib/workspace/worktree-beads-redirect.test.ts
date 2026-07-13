import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import {
  resolveFinalBeadsTarget,
  writeWorktreeBeadsRedirectSync,
} from '../../../../src/lib/workspace-manager/worktree-ops.js';
import * as beadsHome from '../../../../src/lib/beads/home.js';

const tmpBase = mkdtempSync(join(tmpdir(), 'beads-redirect-'));

beforeEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  rmSync(tmpBase, { recursive: true, force: true });
});

describe('resolveFinalBeadsTarget', () => {
  it('returns the same directory when no redirect file exists', () => {
    const dir = join(tmpBase, 'no-redirect', '.beads');
    mkdirSync(dir, { recursive: true });
    expect(resolveFinalBeadsTarget(dir)).toBe(resolve(dir));
  });

  it('resolves a relative redirect', () => {
    const repo = join(tmpBase, 'relative-chain');
    const repoBeads = join(repo, '.beads');
    const final = join(repo, 'canonical', '.beads');
    mkdirSync(repoBeads, { recursive: true });
    mkdirSync(final, { recursive: true });
    writeFileSync(join(repoBeads, 'redirect'), 'canonical/.beads', 'utf8');
    expect(resolveFinalBeadsTarget(repoBeads)).toBe(resolve(final));
  });

  it('resolves an absolute redirect', () => {
    const repoBeads = join(tmpBase, 'absolute-chain', '.beads');
    const final = join(tmpBase, 'absolute-target', '.beads');
    mkdirSync(repoBeads, { recursive: true });
    mkdirSync(final, { recursive: true });
    writeFileSync(join(repoBeads, 'redirect'), final, 'utf8');
    expect(resolveFinalBeadsTarget(repoBeads)).toBe(resolve(final));
  });

  it('returns the starting directory on a redirect cycle', () => {
    const beads = join(tmpBase, 'cycle', '.beads');
    mkdirSync(beads, { recursive: true });
    // Redirect points back at the same .beads directory.
    writeFileSync(join(beads, 'redirect'), '.beads', 'utf8');
    expect(resolveFinalBeadsTarget(beads)).toBe(resolve(beads));
  });
});

describe('writeWorktreeBeadsRedirectSync', () => {
  it('writes an absolute redirect when resolveCanonicalBeadsHome returns a canonical path', () => {
    const repoPath = join(tmpBase, 'repo-migrated');
    const stateBeads = join(tmpBase, 'overdeck', 'state', 'project', '.beads');
    mkdirSync(stateBeads, { recursive: true });
    vi.spyOn(beadsHome, 'resolveCanonicalBeadsHome').mockReturnValue(stateBeads);

    const workspacePath = join(tmpBase, 'workspace-migrated');
    writeWorktreeBeadsRedirectSync(repoPath, workspacePath);

    const redirectPath = join(workspacePath, '.beads', 'redirect');
    expect(existsSync(redirectPath)).toBe(true);
    expect(readFileSync(redirectPath, 'utf8').trim()).toBe(resolve(stateBeads));
  });

  it('falls back to a relative repo .beads redirect when resolveCanonicalBeadsHome returns null', () => {
    const repoPath = join(tmpBase, 'repo-legacy');
    const repoBeads = join(repoPath, '.beads');
    mkdirSync(repoBeads, { recursive: true });
    vi.spyOn(beadsHome, 'resolveCanonicalBeadsHome').mockReturnValue(null);

    const workspacePath = join(tmpBase, 'workspace-legacy');
    writeWorktreeBeadsRedirectSync(repoPath, workspacePath);

    const redirectPath = join(workspacePath, '.beads', 'redirect');
    expect(existsSync(redirectPath)).toBe(true);
    const content = readFileSync(redirectPath, 'utf8').trim();
    expect(content).toBe(relative(workspacePath, repoBeads));
    expect(resolve(workspacePath, content)).toBe(resolve(repoBeads));
  });

  it('does not overwrite a pre-existing workspace redirect', () => {
    const repoPath = join(tmpBase, 'repo-existing');
    const workspacePath = join(tmpBase, 'workspace-existing');
    const redirectPath = join(workspacePath, '.beads', 'redirect');
    mkdirSync(dirname(redirectPath), { recursive: true });
    writeFileSync(redirectPath, 'preserve-me', 'utf8');
    vi.spyOn(beadsHome, 'resolveCanonicalBeadsHome').mockReturnValue(join(tmpBase, 'canonical', '.beads'));

    writeWorktreeBeadsRedirectSync(repoPath, workspacePath);

    expect(readFileSync(redirectPath, 'utf8').trim()).toBe('preserve-me');
  });

  it('resolves through a repo-root redirect chain instead of writing a chained redirect', () => {
    const repoPath = join(tmpBase, 'repo-chain');
    const repoBeads = join(repoPath, '.beads');
    const stateBeads = join(tmpBase, 'overdeck', 'state', 'project', '.beads');
    mkdirSync(repoBeads, { recursive: true });
    mkdirSync(stateBeads, { recursive: true });
    // Repo-root .beads redirects to the state worktree — the post-cutover stub layout.
    writeFileSync(join(repoBeads, 'redirect'), relative(repoPath, stateBeads), 'utf8');
    vi.spyOn(beadsHome, 'resolveCanonicalBeadsHome').mockReturnValue(repoBeads);

    const workspacePath = join(tmpBase, 'workspace-chain');
    writeWorktreeBeadsRedirectSync(repoPath, workspacePath);

    const redirectPath = join(workspacePath, '.beads', 'redirect');
    const content = readFileSync(redirectPath, 'utf8').trim();
    expect(resolve(workspacePath, content)).toBe(resolve(stateBeads));
    expect(existsSync(redirectPath)).toBe(true);
  });
});
