/**
 * Unit tests for mirrorProjectSkills — the skills/ → .claude/skills/ mirror logic.
 *
 * Covers:
 *  - no-op when no skills/ directory exists
 *  - no-op when skills/ has no SKILL.md files
 *  - adds new skill dirs (with SKILL.md)
 *  - updates a SKILL.md when source content changes (reports 1 updated)
 *  - removes a .claude/skills/ dir that no longer exists in skills/
 *  - preserves .claude/skills/.gitignore untouched
 *  - skills with lowercase skill.md are recognised and mirrored
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mirrorProjectSkills } from '../../src/lib/sync.js';

describe('mirrorProjectSkills', () => {
  let cwd: string;
  let skillsDir: string;
  let claudeSkillsDir: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'pan-mirror-test-'));
    skillsDir = join(cwd, 'skills');
    claudeSkillsDir = join(cwd, '.claude', 'skills');
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function createSkill(name: string, content = '# Skill\nContent.', filename = 'SKILL.md') {
    const dir = join(skillsDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), content, 'utf-8');
  }

  it('is a no-op when skills/ directory does not exist', () => {
    const result = mirrorProjectSkills(cwd);
    expect(result).toEqual({ added: [], updated: [], removed: [] });
    expect(existsSync(claudeSkillsDir)).toBe(false);
  });

  it('is a no-op when skills/ has directories but none contain SKILL.md', () => {
    mkdirSync(join(skillsDir, 'not-a-skill'), { recursive: true });
    writeFileSync(join(skillsDir, 'not-a-skill', 'README.md'), '# not a skill', 'utf-8');

    const result = mirrorProjectSkills(cwd);
    expect(result).toEqual({ added: [], updated: [], removed: [] });
    expect(existsSync(claudeSkillsDir)).toBe(false);
  });

  it('adds a new skill directory and SKILL.md when missing from target', () => {
    createSkill('pan-help', '# Help\nUse pan help.');

    const result = mirrorProjectSkills(cwd);

    expect(result.added).toEqual(['pan-help']);
    expect(result.updated).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(existsSync(join(claudeSkillsDir, 'pan-help', 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(claudeSkillsDir, 'pan-help', 'SKILL.md'), 'utf-8')).toBe('# Help\nUse pan help.');
  });

  it('updates SKILL.md when source content has changed (reports 1 updated)', () => {
    createSkill('pan-help', '# Help\nOriginal.');
    // Pre-populate target with stale content
    mkdirSync(join(claudeSkillsDir, 'pan-help'), { recursive: true });
    writeFileSync(join(claudeSkillsDir, 'pan-help', 'SKILL.md'), '# Help\nStale.', 'utf-8');

    const result = mirrorProjectSkills(cwd);

    expect(result.added).toEqual([]);
    expect(result.updated).toEqual(['pan-help']);
    expect(result.removed).toEqual([]);
    expect(readFileSync(join(claudeSkillsDir, 'pan-help', 'SKILL.md'), 'utf-8')).toBe('# Help\nOriginal.');
  });

  it('does not report updated when SKILL.md is already up to date', () => {
    createSkill('pan-help', '# Help\nSame content.');
    mkdirSync(join(claudeSkillsDir, 'pan-help'), { recursive: true });
    writeFileSync(join(claudeSkillsDir, 'pan-help', 'SKILL.md'), '# Help\nSame content.', 'utf-8');

    const result = mirrorProjectSkills(cwd);

    expect(result).toEqual({ added: [], updated: [], removed: [] });
  });

  it('removes a .claude/skills/ dir that no longer exists in skills/ (reports 1 removed)', () => {
    createSkill('pan-help', '# Help');
    // Target has a stale dir that was previously managed by the mirror
    mkdirSync(join(claudeSkillsDir, 'old-skill'), { recursive: true });
    writeFileSync(join(claudeSkillsDir, 'old-skill', 'SKILL.md'), '# Old\n', 'utf-8');
    // Manifest records it as previously mirrored
    mkdirSync(claudeSkillsDir, { recursive: true });
    writeFileSync(join(claudeSkillsDir, '.mirror-manifest'), 'old-skill\n', 'utf-8');

    const result = mirrorProjectSkills(cwd);

    expect(result.removed).toContain('old-skill');
    expect(existsSync(join(claudeSkillsDir, 'old-skill'))).toBe(false);
  });

  it('preserves .claude/skills/.gitignore untouched', () => {
    createSkill('pan-help', '# Help');
    mkdirSync(claudeSkillsDir, { recursive: true });
    writeFileSync(join(claudeSkillsDir, '.gitignore'), '*.log\n', 'utf-8');

    mirrorProjectSkills(cwd);

    expect(existsSync(join(claudeSkillsDir, '.gitignore'))).toBe(true);
    expect(readFileSync(join(claudeSkillsDir, '.gitignore'), 'utf-8')).toBe('*.log\n');
  });

  it('recognises lowercase skill.md and mirrors it as SKILL.md in target', () => {
    createSkill('workspace-add-repo', '# Workspace\nAdd repo.', 'skill.md');

    const result = mirrorProjectSkills(cwd);

    expect(result.added).toContain('workspace-add-repo');
    expect(existsSync(join(claudeSkillsDir, 'workspace-add-repo', 'SKILL.md'))).toBe(true);
  });

  it('normalizes skill.md → SKILL.md even when content is identical', () => {
    const content = '# Workspace\nIdentical content.';
    // Source uses SKILL.md (uppercase)
    createSkill('workspace-add-repo', content);
    // Target has skill.md (lowercase) with the SAME content — triggers the equality path
    mkdirSync(join(claudeSkillsDir, 'workspace-add-repo'), { recursive: true });
    writeFileSync(join(claudeSkillsDir, 'workspace-add-repo', 'skill.md'), content, 'utf-8');

    const result = mirrorProjectSkills(cwd);

    // Filename must be normalized: SKILL.md created, skill.md removed
    expect(existsSync(join(claudeSkillsDir, 'workspace-add-repo', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(claudeSkillsDir, 'workspace-add-repo', 'skill.md'))).toBe(false);
    expect(readFileSync(join(claudeSkillsDir, 'workspace-add-repo', 'SKILL.md'), 'utf-8')).toBe(content);
    expect(result.updated).toContain('workspace-add-repo');
  });

  it('removes stale lowercase skill.md from target when content changes', () => {
    // Source uses SKILL.md (uppercase)
    createSkill('workspace-add-repo', '# Workspace\nUpdated content.');
    // Target still has the old lowercase skill.md from a previous mirror run
    mkdirSync(join(claudeSkillsDir, 'workspace-add-repo'), { recursive: true });
    writeFileSync(join(claudeSkillsDir, 'workspace-add-repo', 'skill.md'), '# Workspace\nStale content.', 'utf-8');

    const result = mirrorProjectSkills(cwd);

    expect(result.updated).toEqual(['workspace-add-repo']);
    // New canonical SKILL.md must exist with updated content
    expect(existsSync(join(claudeSkillsDir, 'workspace-add-repo', 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(claudeSkillsDir, 'workspace-add-repo', 'SKILL.md'), 'utf-8')).toBe('# Workspace\nUpdated content.');
    // Stale lowercase file must be removed
    expect(existsSync(join(claudeSkillsDir, 'workspace-add-repo', 'skill.md'))).toBe(false);
  });

  it('classifies as added (not updated) when target dir exists but has no SKILL.md', () => {
    createSkill('pan-help', '# Help\nContent.');
    // Target dir exists but contains no SKILL.md or skill.md — existingContent will be null
    mkdirSync(join(claudeSkillsDir, 'pan-help'), { recursive: true });
    writeFileSync(join(claudeSkillsDir, 'pan-help', 'README.md'), '# Other\n', 'utf-8');

    const result = mirrorProjectSkills(cwd);

    expect(result.added).toEqual(['pan-help']);
    expect(result.updated).toEqual([]);
    expect(existsSync(join(claudeSkillsDir, 'pan-help', 'SKILL.md'))).toBe(true);
  });

  it('preserves canonical .claude/skills entries not tracked in the mirror manifest', () => {
    createSkill('pan-help', '# Help');
    // Canonical checked-in skills (never mirrored — not in manifest)
    mkdirSync(join(claudeSkillsDir, 'conv-lookup'), { recursive: true });
    writeFileSync(join(claudeSkillsDir, 'conv-lookup', 'SKILL.md'), '# Conv Lookup\n', 'utf-8');
    mkdirSync(join(claudeSkillsDir, 'test-specialist-workflow'), { recursive: true });
    writeFileSync(join(claudeSkillsDir, 'test-specialist-workflow', 'SKILL.md'), '# Test Specialist\n', 'utf-8');

    const result = mirrorProjectSkills(cwd);

    expect(result.removed).not.toContain('conv-lookup');
    expect(result.removed).not.toContain('test-specialist-workflow');
    expect(existsSync(join(claudeSkillsDir, 'conv-lookup'))).toBe(true);
    expect(existsSync(join(claudeSkillsDir, 'test-specialist-workflow'))).toBe(true);
  });

  it('handles multiple skills in a single pass', () => {
    createSkill('pan-help', '# Help');
    createSkill('commit', '# Commit');
    // Stale mirror-managed skill in target
    mkdirSync(join(claudeSkillsDir, 'old-removed'), { recursive: true });
    writeFileSync(join(claudeSkillsDir, 'old-removed', 'SKILL.md'), '# Old\n', 'utf-8');
    // Manifest records it as previously mirrored
    mkdirSync(claudeSkillsDir, { recursive: true });
    writeFileSync(join(claudeSkillsDir, '.mirror-manifest'), 'old-removed\n', 'utf-8');

    const result = mirrorProjectSkills(cwd);

    expect(result.added.sort()).toEqual(['commit', 'pan-help']);
    expect(result.removed).toContain('old-removed');
  });
});
