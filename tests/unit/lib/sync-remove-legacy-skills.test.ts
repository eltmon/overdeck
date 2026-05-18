/**
 * Tests for removeLegacySkills070() (PAN-705).
 *
 * Redirects SYNC_TARGET.skills to a temp dir via vi.mock so the function
 * operates on test-owned files. Covers:
 *   (a) returns [] when skills dir does not exist
 *   (b) removes existing legacy skill directories and returns their names
 *   (c) skips non-existent legacy entries silently, keeping other legacies
 *   (d) leaves non-legacy skills alone
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

// Use a fixed per-suite path under /tmp. A PID-scoped suffix keeps parallel
// test runs from colliding. Hoisted so vi.mock can reference it.
const { mockClaudeSkills } = vi.hoisted(() => ({
  mockClaudeSkills: `/tmp/pan705-legacy-skills-${process.pid}/.claude/skills`,
}));

vi.mock('../../../src/lib/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/paths.js')>();
  return {
    ...actual,
    SYNC_TARGET: {
      skills: mockClaudeSkills,
      commands: join(mockClaudeSkills, '..', 'commands'),
      agents: join(mockClaudeSkills, '..', 'agents'),
    },
  };
});

import { removeLegacySkills070 } from '../../../src/lib/sync.js';

// Helpers ----------------------------------------------------------------

function makeLegacySkill(name: string): string {
  const dir = join(mockClaudeSkills, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `# ${name}\n`);
  return dir;
}

// Tests -------------------------------------------------------------------

describe('removeLegacySkills070', () => {
  beforeEach(() => {
    // Global setup creates TEMP_DIR fresh each test — sometimes we want the
    // skills subdir too.
    mkdirSync(mockClaudeSkills, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(mockClaudeSkills, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('returns [] when skills target directory does not exist', () => {
    // Delete the skills dir entirely — the function should no-op, not throw.
    rmSync(mockClaudeSkills, { recursive: true, force: true });
    expect(existsSync(mockClaudeSkills)).toBe(false);

    const result = removeLegacySkills070();
    expect(result).toEqual([]);
  });

  it('returns [] when skills dir exists but contains none of the legacy names', () => {
    makeLegacySkill('my-user-skill');
    makeLegacySkill('unrelated-skill');

    const result = removeLegacySkills070();
    expect(result).toEqual([]);

    // Non-legacy skills must NOT be removed
    expect(existsSync(join(mockClaudeSkills, 'my-user-skill'))).toBe(true);
    expect(existsSync(join(mockClaudeSkills, 'unrelated-skill'))).toBe(true);
  });

  it('removes every legacy skill that exists and returns their names', () => {
    const legacyNames = [
      'pan-issue',
      'pan-plan-finalize',
      'pan-setup',
      'pan-rescue',
      'pan-config',
      'pan-tracker',
    ];
    for (const name of legacyNames) makeLegacySkill(name);

    const result = removeLegacySkills070();

    expect(result.sort()).toEqual([...legacyNames].sort());
    for (const name of legacyNames) {
      expect(existsSync(join(mockClaudeSkills, name))).toBe(false);
    }
  });

  it('skips legacy names that do not exist and reports only those actually removed', () => {
    makeLegacySkill('pan-tldr');
    makeLegacySkill('pan-config');

    const result = removeLegacySkills070();

    expect(result.sort()).toEqual(['pan-config']);
    expect(existsSync(join(mockClaudeSkills, 'pan-tldr'))).toBe(true);
    expect(existsSync(join(mockClaudeSkills, 'pan-config'))).toBe(false);
  });

  it('leaves non-legacy skills untouched when removing legacy ones', () => {
    makeLegacySkill('pan-plan-finalize');  // legacy
    makeLegacySkill('pan-plan');            // KEEP — new 0.7.0 skill
    makeLegacySkill('beads');               // unrelated
    makeLegacySkill('bug-fix');             // unrelated

    const result = removeLegacySkills070();

    expect(result).toEqual(['pan-plan-finalize']);
    expect(existsSync(join(mockClaudeSkills, 'pan-plan-finalize'))).toBe(false);
    expect(existsSync(join(mockClaudeSkills, 'pan-plan'))).toBe(true);
    expect(existsSync(join(mockClaudeSkills, 'beads'))).toBe(true);
    expect(existsSync(join(mockClaudeSkills, 'bug-fix'))).toBe(true);
  });

  it('is idempotent — second call is a no-op after the first call removes legacy skills', () => {
    makeLegacySkill('pan-tldr');
    makeLegacySkill('pan-setup');

    const firstRun = removeLegacySkills070();
    expect(firstRun.sort()).toEqual(['pan-setup']);


    expect(readdirSync(mockClaudeSkills)).toEqual(['pan-tldr']);

    const secondRun = removeLegacySkills070();
    expect(secondRun).toEqual([]);
  });
});
