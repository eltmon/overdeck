/**
 * Unit tests for mirrorProjectSkills — the skills/ → .claude/skills/ mirror logic.
 *
 * Covers:
 *  - no-op when no skills/ directory exists
 *  - no-op when skills/ has no SKILL.md files
 *  - adds new skill dirs (with SKILL.md)
 *  - updates a SKILL.md when source content changes (reports 1 updated)
 *  - removes a .claude/skills/ dir that was previously mirrored but no longer in source
 *  - preserves .claude/skills/.gitignore untouched (mirror does not write to it)
 *  - skills with lowercase skill.md are recognised and mirrored
 *  - manifest stored outside .claude/skills/ — no untracked files created in the repo
 *  - idempotent: repeated runs with same skills produce no new files
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync, chmodSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mirrorProjectSkills } from '../../src/lib/sync.js';

describe('mirrorProjectSkills', () => {
  let cwd: string;
  let skillsDir: string;
  let claudeSkillsDir: string;
  let manifestDir: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'pan-mirror-test-'));
    skillsDir = join(cwd, 'skills');
    claudeSkillsDir = join(cwd, '.claude', 'skills');
    manifestDir = join(cwd, '_manifest'); // outside .claude/skills/ — simulates external storage
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
    const result = mirrorProjectSkills(cwd, { manifestDir });
    expect(result).toEqual({ added: [], updated: [], removed: [] });
    expect(existsSync(claudeSkillsDir)).toBe(false);
  });

  it('is a no-op when skills/ has directories but none contain SKILL.md', () => {
    mkdirSync(join(skillsDir, 'not-a-skill'), { recursive: true });
    writeFileSync(join(skillsDir, 'not-a-skill', 'README.md'), '# not a skill', 'utf-8');

    const result = mirrorProjectSkills(cwd, { manifestDir });
    expect(result).toEqual({ added: [], updated: [], removed: [] });
    expect(existsSync(claudeSkillsDir)).toBe(false);
  });

  it('adds a new skill directory and SKILL.md when missing from target', () => {
    createSkill('pan-help', '# Help\nUse pan help.');

    const result = mirrorProjectSkills(cwd, { manifestDir });

    expect(result.added).toEqual(['pan-help']);
    expect(result.updated).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(existsSync(join(claudeSkillsDir, 'pan-help', 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(claudeSkillsDir, 'pan-help', 'SKILL.md'), 'utf-8')).toBe('# Help\nUse pan help.');
  });

  it('updates SKILL.md when source content has changed (reports 1 updated)', () => {
    createSkill('pan-help', '# Help\nOriginal.');
    // Pre-populate target with stale content — simulate a previous mirror run
    mkdirSync(join(claudeSkillsDir, 'pan-help'), { recursive: true });
    writeFileSync(join(claudeSkillsDir, 'pan-help', 'SKILL.md'), '# Help\nStale.', 'utf-8');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, 'manifest'), 'pan-help\n', 'utf-8');

    const result = mirrorProjectSkills(cwd, { manifestDir });

    expect(result.added).toEqual([]);
    expect(result.updated).toEqual(['pan-help']);
    expect(result.removed).toEqual([]);
    expect(readFileSync(join(claudeSkillsDir, 'pan-help', 'SKILL.md'), 'utf-8')).toBe('# Help\nOriginal.');
  });

  it('does not report updated when SKILL.md is already up to date', () => {
    createSkill('pan-help', '# Help\nSame content.');
    mkdirSync(join(claudeSkillsDir, 'pan-help'), { recursive: true });
    writeFileSync(join(claudeSkillsDir, 'pan-help', 'SKILL.md'), '# Help\nSame content.', 'utf-8');

    const result = mirrorProjectSkills(cwd, { manifestDir });

    expect(result).toEqual({ added: [], updated: [], removed: [] });
  });

  it('removes a .claude/skills/ dir that no longer exists in skills/ (reports 1 removed)', () => {
    createSkill('pan-help', '# Help');
    // Target has a stale dir that was previously managed by the mirror
    mkdirSync(join(claudeSkillsDir, 'old-skill'), { recursive: true });
    writeFileSync(join(claudeSkillsDir, 'old-skill', 'SKILL.md'), '# Old\n', 'utf-8');
    // Manifest records it as previously mirrored (written to external manifestDir)
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, 'manifest'), 'old-skill\n', 'utf-8');

    const result = mirrorProjectSkills(cwd, { manifestDir });

    expect(result.removed).toContain('old-skill');
    expect(existsSync(join(claudeSkillsDir, 'old-skill'))).toBe(false);
  });

  it('preserves .claude/skills/.gitignore untouched (mirror does not write to it)', () => {
    createSkill('pan-help', '# Help');
    mkdirSync(claudeSkillsDir, { recursive: true });
    writeFileSync(join(claudeSkillsDir, '.gitignore'), '*.log\n', 'utf-8');

    mirrorProjectSkills(cwd, { manifestDir });

    expect(existsSync(join(claudeSkillsDir, '.gitignore'))).toBe(true);
    expect(readFileSync(join(claudeSkillsDir, '.gitignore'), 'utf-8')).toBe('*.log\n');
  });

  it('recognises lowercase skill.md and mirrors it as SKILL.md in target', () => {
    createSkill('workspace-add-repo', '# Workspace\nAdd repo.', 'skill.md');

    const result = mirrorProjectSkills(cwd, { manifestDir });

    expect(result.added).toContain('workspace-add-repo');
    expect(existsSync(join(claudeSkillsDir, 'workspace-add-repo', 'SKILL.md'))).toBe(true);
  });

  it('normalizes skill.md → SKILL.md even when content is identical', () => {
    const content = '# Workspace\nIdentical content.';
    // Source uses SKILL.md (uppercase)
    createSkill('workspace-add-repo', content);
    // Target has skill.md (lowercase) with the SAME content — simulate a previous mirror run
    mkdirSync(join(claudeSkillsDir, 'workspace-add-repo'), { recursive: true });
    writeFileSync(join(claudeSkillsDir, 'workspace-add-repo', 'skill.md'), content, 'utf-8');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, 'manifest'), 'workspace-add-repo\n', 'utf-8');

    const result = mirrorProjectSkills(cwd, { manifestDir });

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
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, 'manifest'), 'workspace-add-repo\n', 'utf-8');

    const result = mirrorProjectSkills(cwd, { manifestDir });

    expect(result.updated).toEqual(['workspace-add-repo']);
    // New canonical SKILL.md must exist with updated content
    expect(existsSync(join(claudeSkillsDir, 'workspace-add-repo', 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(claudeSkillsDir, 'workspace-add-repo', 'SKILL.md'), 'utf-8')).toBe('# Workspace\nUpdated content.');
    // Stale lowercase file must be removed
    expect(existsSync(join(claudeSkillsDir, 'workspace-add-repo', 'skill.md'))).toBe(false);
  });

  it('classifies as added (not updated) when target dir exists but has no SKILL.md', () => {
    createSkill('pan-help', '# Help\nContent.');
    // Target dir exists (mirror-managed) but contains no SKILL.md — simulates a partial prior run
    mkdirSync(join(claudeSkillsDir, 'pan-help'), { recursive: true });
    writeFileSync(join(claudeSkillsDir, 'pan-help', 'README.md'), '# Other\n', 'utf-8');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, 'manifest'), 'pan-help\n', 'utf-8');

    const result = mirrorProjectSkills(cwd, { manifestDir });

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

    const result = mirrorProjectSkills(cwd, { manifestDir });

    expect(result.removed).not.toContain('conv-lookup');
    expect(result.removed).not.toContain('test-specialist-workflow');
    expect(existsSync(join(claudeSkillsDir, 'conv-lookup'))).toBe(true);
    expect(existsSync(join(claudeSkillsDir, 'test-specialist-workflow'))).toBe(true);
  });

  it('creates new dirs for all skills regardless of .gitignore contents', () => {
    // Skills are always mirrored — .gitignore listing is irrelevant to mirroring.
    createSkill('pan-help', '# Help');
    createSkill('new-unlisted-skill', '# New');
    mkdirSync(claudeSkillsDir, { recursive: true });
    // .gitignore lists pan-help but NOT new-unlisted-skill — both must be mirrored
    writeFileSync(join(claudeSkillsDir, '.gitignore'), 'pan-help\n', 'utf-8');

    const result = mirrorProjectSkills(cwd, { manifestDir });

    expect(result.added).toContain('pan-help');
    expect(result.added).toContain('new-unlisted-skill');
    expect(existsSync(join(claudeSkillsDir, 'pan-help', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(claudeSkillsDir, 'new-unlisted-skill', 'SKILL.md'))).toBe(true);
  });

  it('does not create .mirror-manifest inside .claude/skills/ (no untracked repo files)', () => {
    createSkill('pan-help', '# Help');

    mirrorProjectSkills(cwd, { manifestDir });

    // Manifest must NOT appear inside the target skills dir (would create untracked repo files)
    expect(existsSync(join(claudeSkillsDir, '.mirror-manifest'))).toBe(false);
    // Manifest IS written to the external manifestDir
    expect(existsSync(join(manifestDir, 'manifest'))).toBe(true);
  });

  it('does not modify files in .claude/skills/ on repeated runs with unchanged skills (idempotent)', () => {
    createSkill('pan-help', '# Help\nContent.');

    mirrorProjectSkills(cwd, { manifestDir });

    // Record all files in claudeSkillsDir after first run
    const skillMdPath = join(claudeSkillsDir, 'pan-help', 'SKILL.md');
    const contentAfterFirst = readFileSync(skillMdPath, 'utf-8');
    const manifestAfterFirst = readFileSync(join(manifestDir, 'manifest'), 'utf-8');

    mirrorProjectSkills(cwd, { manifestDir });

    expect(readFileSync(skillMdPath, 'utf-8')).toBe(contentAfterFirst);
    expect(readFileSync(join(manifestDir, 'manifest'), 'utf-8')).toBe(manifestAfterFirst);
    // No new entries in .claude/skills/
    expect(existsSync(join(claudeSkillsDir, '.mirror-manifest'))).toBe(false);
  });

  // ── Companion file tests (recursive copy) ────────────────────────────────

  it('copies companion files alongside SKILL.md (resources/, scripts/, package.json)', () => {
    // Set up a skill with the same structure as stitch-react-components
    const skillDir = join(skillsDir, 'stitch-react');
    mkdirSync(join(skillDir, 'resources'), { recursive: true });
    mkdirSync(join(skillDir, 'scripts'), { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# Stitch React\n', 'utf-8');
    writeFileSync(join(skillDir, 'package.json'), '{"name":"stitch-react"}', 'utf-8');
    writeFileSync(join(skillDir, 'resources', 'style-guide.json'), '{"colors":[]}', 'utf-8');
    writeFileSync(join(skillDir, 'resources', 'component-template.tsx'), 'export {};\n', 'utf-8');
    writeFileSync(join(skillDir, 'scripts', 'validate.js'), 'console.log("ok");\n', 'utf-8');

    const result = mirrorProjectSkills(cwd, { manifestDir });

    expect(result.added).toContain('stitch-react');

    const target = join(claudeSkillsDir, 'stitch-react');
    expect(readFileSync(join(target, 'SKILL.md'), 'utf-8')).toBe('# Stitch React\n');
    expect(readFileSync(join(target, 'package.json'), 'utf-8')).toBe('{"name":"stitch-react"}');
    expect(readFileSync(join(target, 'resources', 'style-guide.json'), 'utf-8')).toBe('{"colors":[]}');
    expect(readFileSync(join(target, 'resources', 'component-template.tsx'), 'utf-8')).toBe('export {};\n');
    expect(readFileSync(join(target, 'scripts', 'validate.js'), 'utf-8')).toBe('console.log("ok");\n');
  });

  it('updates a companion file when source content changes (reports updated)', () => {
    const skillDir = join(skillsDir, 'stitch-react');
    mkdirSync(join(skillDir, 'resources'), { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# Stitch React\n', 'utf-8');
    writeFileSync(join(skillDir, 'resources', 'style-guide.json'), '{"version":1}', 'utf-8');

    // First sync — populate target
    mirrorProjectSkills(cwd, { manifestDir });

    // Update companion file in source
    writeFileSync(join(skillDir, 'resources', 'style-guide.json'), '{"version":2}', 'utf-8');

    const result = mirrorProjectSkills(cwd, { manifestDir });

    expect(result.updated).toContain('stitch-react');
    expect(readFileSync(join(claudeSkillsDir, 'stitch-react', 'resources', 'style-guide.json'), 'utf-8'))
      .toBe('{"version":2}');
  });

  it('removes a companion file from target when removed from source', () => {
    const skillDir = join(skillsDir, 'stitch-react');
    mkdirSync(join(skillDir, 'resources'), { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# Stitch React\n', 'utf-8');
    writeFileSync(join(skillDir, 'resources', 'style-guide.json'), '{"colors":[]}', 'utf-8');

    // First sync — populate target including companion file
    mirrorProjectSkills(cwd, { manifestDir });

    const companionInTarget = join(claudeSkillsDir, 'stitch-react', 'resources', 'style-guide.json');
    expect(existsSync(companionInTarget)).toBe(true);

    // Remove companion file from source
    rmSync(join(skillDir, 'resources', 'style-guide.json'));

    const result = mirrorProjectSkills(cwd, { manifestDir });

    expect(result.updated).toContain('stitch-react');
    expect(existsSync(companionInTarget)).toBe(false);
  });

  it('preserves executable mode bits on companion scripts (initial sync and update)', () => {
    const skillDir = join(skillsDir, 'pan-tts');
    mkdirSync(join(skillDir, 'scripts'), { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# TTS\n', 'utf-8');
    const srcScript = join(skillDir, 'scripts', 'say.sh');
    writeFileSync(srcScript, '#!/bin/sh\necho hello\n', 'utf-8');
    chmodSync(srcScript, 0o755);

    // Initial mirror — target script must be executable
    mirrorProjectSkills(cwd, { manifestDir });
    const dstScript = join(claudeSkillsDir, 'pan-tts', 'scripts', 'say.sh');
    expect(statSync(dstScript).mode & 0o111).toBeGreaterThan(0);

    // Update script content — mode must still be preserved after update
    writeFileSync(srcScript, '#!/bin/sh\necho world\n', 'utf-8');
    chmodSync(srcScript, 0o755);
    mirrorProjectSkills(cwd, { manifestDir });
    expect(readFileSync(dstScript, 'utf-8')).toBe('#!/bin/sh\necho world\n');
    expect(statSync(dstScript).mode & 0o111).toBeGreaterThan(0);
  });

  it('handles multiple skills in a single pass', () => {
    createSkill('pan-help', '# Help');
    createSkill('commit', '# Commit');
    // Stale mirror-managed skill in target
    mkdirSync(join(claudeSkillsDir, 'old-removed'), { recursive: true });
    writeFileSync(join(claudeSkillsDir, 'old-removed', 'SKILL.md'), '# Old\n', 'utf-8');
    // Manifest records it as previously mirrored (written to external manifestDir)
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, 'manifest'), 'old-removed\n', 'utf-8');

    const result = mirrorProjectSkills(cwd, { manifestDir });

    expect(result.added.sort()).toEqual(['commit', 'pan-help']);
    expect(result.removed).toContain('old-removed');
  });


  it('mirrors skills when called from a subdirectory (walks up to repo root)', () => {
    createSkill('pan-help', '# Help\nContent.');

    // Call with a subdirectory path — resolveSkillsRoot should walk up to cwd
    const subdir = join(cwd, 'src', 'lib');
    mkdirSync(subdir, { recursive: true });

    const result = mirrorProjectSkills(subdir, { manifestDir });

    // Skills must be mirrored into cwd/.claude/skills/, not subdir/.claude/skills/
    expect(result.added).toContain('pan-help');
    expect(existsSync(join(claudeSkillsDir, 'pan-help', 'SKILL.md'))).toBe(true);
    // Subdirectory must not have a stray .claude/skills/
    expect(existsSync(join(subdir, '.claude', 'skills'))).toBe(false);
  });

  it('does not overwrite a user-managed .claude/skills/<name> dir that pre-exists outside the manifest', () => {
    createSkill('pan-help', '# Help\nSource content.');

    // Pre-create a user-managed conv-lookup skill that was never mirrored
    const userSkillDir = join(claudeSkillsDir, 'conv-lookup');
    mkdirSync(userSkillDir, { recursive: true });
    const userSkillMd = join(userSkillDir, 'SKILL.md');
    writeFileSync(userSkillMd, '# User Conv Lookup\nUser content.', 'utf-8');
    writeFileSync(join(userSkillDir, 'extra-file.txt'), 'user extra', 'utf-8');

    // First run: pan-help is new, conv-lookup is user-managed (not in manifest yet)
    const result1 = mirrorProjectSkills(cwd, { manifestDir });
    expect(result1.added).toContain('pan-help');
    expect(result1.added).not.toContain('conv-lookup');

    // User-managed skill must be completely unchanged
    expect(readFileSync(userSkillMd, 'utf-8')).toBe('# User Conv Lookup\nUser content.');
    expect(existsSync(join(userSkillDir, 'extra-file.txt'))).toBe(true);

    // conv-lookup must NOT appear in the manifest (only mirrored skills are written)
    const manifest = readFileSync(join(manifestDir, 'manifest'), 'utf-8');
    expect(manifest).not.toContain('conv-lookup');

    // Second run: manifest now exists; conv-lookup still not in it — must still be skipped
    const result2 = mirrorProjectSkills(cwd, { manifestDir });
    expect(result2.added).not.toContain('conv-lookup');
    expect(result2.updated).not.toContain('conv-lookup');
    expect(result2.removed).not.toContain('conv-lookup');
    expect(readFileSync(userSkillMd, 'utf-8')).toBe('# User Conv Lookup\nUser content.');
    expect(existsSync(join(userSkillDir, 'extra-file.txt'))).toBe(true);
  });

  it('does not overwrite a user-managed .claude/skills/<name> that shares its name with a source skill (same-name collision)', () => {
    // Both source skills/<name>/ and user-managed .claude/skills/<name>/ exist with the same name.
    // The target dir is NOT in the manifest — it pre-dates the mirror or was created by the user.
    // pan sync must leave the user's files completely untouched.
    createSkill('pan-help', '# Help\nSource content.');
    const userSkillDir = join(claudeSkillsDir, 'pan-help');
    mkdirSync(userSkillDir, { recursive: true });
    const userSkillMd = join(userSkillDir, 'SKILL.md');
    writeFileSync(userSkillMd, '# Help\nUser-managed content.', 'utf-8');
    writeFileSync(join(userSkillDir, 'user-only-file.txt'), 'user extra', 'utf-8');
    // No manifest — pan-help not recorded as mirror-managed

    const result = mirrorProjectSkills(cwd, { manifestDir });

    // Ownership guard must skip pan-help: user content preserved
    expect(readFileSync(userSkillMd, 'utf-8')).toBe('# Help\nUser-managed content.');
    expect(existsSync(join(userSkillDir, 'user-only-file.txt'))).toBe(true);
    // pan-help must not appear in the manifest (not mirror-managed)
    const manifest = readFileSync(join(manifestDir, 'manifest'), 'utf-8');
    expect(manifest).not.toContain('pan-help');
    // pan-help must not appear in any result category
    expect(result.added).not.toContain('pan-help');
    expect(result.updated).not.toContain('pan-help');
    expect(result.removed).not.toContain('pan-help');
  });
});
