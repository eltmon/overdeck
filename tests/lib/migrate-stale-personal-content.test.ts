/**
 * Tests for migrateStalePersonalContent — ~/.claude symlink cleanup.
 *
 * Covers:
 *  - Symlinks to .panopticon paths are removed
 *  - Symlinks to panopticon-cli paths are removed
 *  - Symlinks to unrelated paths are preserved
 *  - Plain directories with a same-name devroot entry are preserved (not deleted)
 *  - Plain directories without a devroot counterpart are preserved
 *  - No-op when ~/.claude/skills/ does not exist
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, mkdtempSync, symlinkSync, lstatSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── Module-level mocks ────────────────────────────────────────────────────────

const mockGetDevrootPath = vi.fn<[], string | null>();

vi.mock('../../src/lib/config.js', () => ({
  getDevrootPath: () => mockGetDevrootPath(),
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  getConfig: vi.fn().mockReturnValue({}),
}));

// migrateStalePersonalContent uses homedir() to locate ~/.claude
// Mock homedir() so the function writes to our temp directory instead
vi.mock('os', async (importOriginal) => {
  const original = await importOriginal<typeof import('os')>();
  return {
    ...original,
    homedir: () => mockHomedir(),
  };
});

let mockHomedirFn: () => string;
function mockHomedir(): string {
  return mockHomedirFn();
}

// ── Test helpers ──────────────────────────────────────────────────────────────

function setupFakeHome(base: string): string {
  const fakeHome = join(base, 'home');
  mkdirSync(join(fakeHome, '.claude', 'skills'), { recursive: true });
  mkdirSync(join(fakeHome, '.claude', 'commands'), { recursive: true });
  mkdirSync(join(fakeHome, '.claude', 'agents'), { recursive: true });
  return fakeHome;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('migrateStalePersonalContent', () => {
  let tmpBase: string;
  let fakeHome: string;
  let migrateStalePersonalContent: () => import('../../src/lib/sync.js').MigrationResult;

  beforeEach(async () => {
    vi.resetModules();
    mockGetDevrootPath.mockReset().mockReturnValue(null);

    tmpBase = mkdtempSync(join(tmpdir(), 'pan-migrate-test-'));
    fakeHome = setupFakeHome(tmpBase);
    mockHomedirFn = () => fakeHome;

    const mod = await import('../../src/lib/sync.js');
    migrateStalePersonalContent = mod.migrateStalePersonalContentSync;
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it('removes a symlink pointing to a .panopticon path', () => {
    const skillsDir = join(fakeHome, '.claude', 'skills');
    symlinkSync('/home/user/.panopticon/skills/pan-help', join(skillsDir, 'pan-help'));

    const result = migrateStalePersonalContent();

    expect(result.removedSymlinks).toContain('skills/pan-help');
    expect(result.preservedUserContent).not.toContain('skills/pan-help');
    expect(existsSync(join(skillsDir, 'pan-help'))).toBe(false);
  });

  it('removes a symlink pointing to a panopticon-cli path', () => {
    const skillsDir = join(fakeHome, '.claude', 'skills');
    symlinkSync('/home/user/panopticon-cli/skills/pan-help', join(skillsDir, 'pan-help'));

    const result = migrateStalePersonalContent();

    expect(result.removedSymlinks).toContain('skills/pan-help');
    expect(existsSync(join(skillsDir, 'pan-help'))).toBe(false);
  });

  it('preserves a symlink pointing to an unrelated path', () => {
    const skillsDir = join(fakeHome, '.claude', 'skills');
    symlinkSync('/home/user/my-custom-skills/custom-skill', join(skillsDir, 'custom-skill'));

    const result = migrateStalePersonalContent();

    expect(result.preservedUserContent).toContain('skills/custom-skill');
    expect(result.removedSymlinks).not.toContain('skills/custom-skill');
    // Symlink must still exist
    expect(lstatSync(join(skillsDir, 'custom-skill')).isSymbolicLink()).toBe(true);
  });

  it('preserves a plain directory even when a same-named entry exists in devroot (regression: no destructive removal)', () => {
    // Set up a devroot with a skills/pan-help entry
    const devroot = join(tmpBase, 'devroot');
    mkdirSync(join(devroot, '.claude', 'skills', 'pan-help'), { recursive: true });
    writeFileSync(join(devroot, '.claude', 'skills', 'pan-help', 'SKILL.md'), '# Pan Help\n', 'utf-8');
    mockGetDevrootPath.mockReturnValue(devroot);

    // User also has a plain ~/.claude/skills/pan-help/ directory with their own content
    const userSkillDir = join(fakeHome, '.claude', 'skills', 'pan-help');
    mkdirSync(userSkillDir, { recursive: true });
    writeFileSync(join(userSkillDir, 'SKILL.md'), '# User Custom Help\n', 'utf-8');

    const result = migrateStalePersonalContent();

    // Must NOT be deleted — it's a plain directory, ownership is ambiguous
    expect(existsSync(userSkillDir)).toBe(true);
    expect(existsSync(join(userSkillDir, 'SKILL.md'))).toBe(true);
    expect(result.preservedUserContent).toContain('skills/pan-help');
    expect(result.removedSymlinks).not.toContain('skills/pan-help');
    expect(result.removedSymlinks).not.toContain('skills/pan-help (stale copy)');
  });

  it('preserves a plain directory with no devroot counterpart', () => {
    const userSkillDir = join(fakeHome, '.claude', 'skills', 'my-custom-skill');
    mkdirSync(userSkillDir, { recursive: true });
    writeFileSync(join(userSkillDir, 'SKILL.md'), '# My Custom Skill\n', 'utf-8');

    const result = migrateStalePersonalContent();

    expect(existsSync(userSkillDir)).toBe(true);
    expect(result.preservedUserContent).toContain('skills/my-custom-skill');
    expect(result.removedSymlinks).not.toContain('skills/my-custom-skill');
  });

  it('is a no-op when ~/.claude/skills/ does not exist', () => {
    // Remove the pre-created skills dir
    rmSync(join(fakeHome, '.claude', 'skills'), { recursive: true, force: true });

    const result = migrateStalePersonalContent();

    expect(result.removedSymlinks).toHaveLength(0);
    expect(result.preservedUserContent).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('handles multiple subdirs (skills, commands, agents) in one pass', () => {
    symlinkSync('/home/user/.panopticon/commands/my-cmd', join(fakeHome, '.claude', 'commands', 'my-cmd'));
    symlinkSync('/home/user/.panopticon/agents/my-agent', join(fakeHome, '.claude', 'agents', 'my-agent'));
    mkdirSync(join(fakeHome, '.claude', 'skills', 'user-skill'), { recursive: true });

    const result = migrateStalePersonalContent();

    expect(result.removedSymlinks).toContain('commands/my-cmd');
    expect(result.removedSymlinks).toContain('agents/my-agent');
    expect(result.preservedUserContent).toContain('skills/user-skill');
  });
});
