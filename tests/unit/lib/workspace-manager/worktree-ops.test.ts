import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { tmpdir } from 'os';

// Use vi.hoisted to avoid initialization order issues
const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));
vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>();
  return {
    ...actual,
    promisify: () => mockExecAsync,
  };
});

vi.mock('../../../../src/lib/beads/home.js', () => ({
  resolveCanonicalBeadsHome: vi.fn(),
}));

import { createWorktree } from '../../../../src/lib/workspace-manager/worktree-ops.js';
import { resolveCanonicalBeadsHome } from '../../../../src/lib/beads/home.js';

describe('createWorktree redirect', () => {
  let repoPath: string;
  let targetPath: string;
  let canonicalHome: string;

  beforeEach(() => {
    vi.mocked(resolveCanonicalBeadsHome).mockReset();
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

    repoPath = mkdtempSync(join(tmpdir(), 'overdeck-worktree-repo-'));
    targetPath = mkdtempSync(join(tmpdir(), 'overdeck-worktree-target-'));
    canonicalHome = join(tmpdir(), 'overdeck-canonical-home-');
  });

  afterEach(() => {
    if (existsSync(repoPath)) rmSync(repoPath, { recursive: true, force: true });
    if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true });
    if (existsSync(canonicalHome)) rmSync(canonicalHome, { recursive: true, force: true });
  });

  it('writes the absolute canonical beads home path when resolution succeeds', async () => {
    mkdirSync(canonicalHome, { recursive: true });
    mkdirSync(join(repoPath, '.beads'), { recursive: true });
    vi.mocked(resolveCanonicalBeadsHome).mockReturnValue(canonicalHome);

    const result = await createWorktree(repoPath, targetPath, 'feature/pan-100');

    expect(result.success).toBe(true);
    const redirectPath = join(targetPath, '.beads', 'redirect');
    expect(existsSync(redirectPath)).toBe(true);
    expect(readFileSync(redirectPath, 'utf-8')).toBe(canonicalHome);
  });

  it('falls back to a relative project-root .beads path when no canonical home resolves', async () => {
    mkdirSync(join(repoPath, '.beads'), { recursive: true });
    vi.mocked(resolveCanonicalBeadsHome).mockReturnValue(null);

    const result = await createWorktree(repoPath, targetPath, 'feature/pan-100');

    expect(result.success).toBe(true);
    const redirectPath = join(targetPath, '.beads', 'redirect');
    expect(existsSync(redirectPath)).toBe(true);
    expect(readFileSync(redirectPath, 'utf-8')).toBe(relative(targetPath, join(repoPath, '.beads')));
  });

  it('preserves a pre-existing redirect file', async () => {
    mkdirSync(join(repoPath, '.beads'), { recursive: true });
    mkdirSync(join(targetPath, '.beads'), { recursive: true });
    const redirectPath = join(targetPath, '.beads', 'redirect');
    const existingContent = '/some/pre-existing/path';
    writeFileSync(redirectPath, existingContent, 'utf-8');
    vi.mocked(resolveCanonicalBeadsHome).mockReturnValue(canonicalHome);

    const result = await createWorktree(repoPath, targetPath, 'feature/pan-100');

    expect(result.success).toBe(true);
    expect(readFileSync(redirectPath, 'utf-8')).toBe(existingContent);
  });
});
