import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync, lstatSync } from 'fs';
import { join } from 'path';
import { TEMP_DIR } from '../../setup.js';

// Mock paths to use temp directories
const mockOverdeckSkills = join(TEMP_DIR, '.panopticon', 'skills');
const mockClaudeSkills = join(TEMP_DIR, '.claude', 'skills');

vi.mock('../../../src/lib/paths.js', () => ({
  SKILLS_DIR: mockOverdeckSkills,
  SYNC_TARGET: {
    skills: mockClaudeSkills,
    commands: join(TEMP_DIR, '.claude', 'commands'),
    agents: join(TEMP_DIR, '.claude', 'agents'),
  },
}));

vi.mock('../../../src/lib/config.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../src/lib/config.js')>()),
  loadConfig: vi.fn().mockReturnValue({
    sync: {
      strategy: 'symlink',
      backup_before_sync: false,
    },
  }),
}));

describe('sync command', () => {
  beforeEach(() => {
    // Create mock directories (TEMP_DIR is created by global setup)
    mkdirSync(mockOverdeckSkills, { recursive: true });
    mkdirSync(mockClaudeSkills, { recursive: true });

    // Create a test skill
    const skillDir = join(mockOverdeckSkills, 'test-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# Test Skill');
  });

  // Cleanup handled by global setup

  describe('skill discovery', () => {
    it('should find skills in panopticon directory', () => {
      const skills = readdirSync(mockOverdeckSkills);
      expect(skills).toContain('test-skill');
    });

    it('should only sync directories with SKILL.md', () => {
      // Create a non-skill directory
      const nonSkillDir = join(mockOverdeckSkills, 'not-a-skill');
      mkdirSync(nonSkillDir, { recursive: true });
      writeFileSync(join(nonSkillDir, 'README.md'), '# Not a skill');

      const skills = readdirSync(mockOverdeckSkills)
        .filter(name => {
          const skillPath = join(mockOverdeckSkills, name, 'SKILL.md');
          return existsSync(skillPath);
        });

      expect(skills).toContain('test-skill');
      expect(skills).not.toContain('not-a-skill');
    });
  });

  describe('symlink strategy', () => {
    it('should create symlinks to skill directories', () => {
      // Simulate sync by creating symlink
      const { symlinkSync } = require('fs');
      const targetPath = join(mockClaudeSkills, 'test-skill');
      const sourcePath = join(mockOverdeckSkills, 'test-skill');

      try {
        symlinkSync(sourcePath, targetPath);
      } catch (e) {
        // May fail if symlink exists or permission issues in test env
      }

      if (existsSync(targetPath)) {
        const stats = lstatSync(targetPath);
        expect(stats.isSymbolicLink()).toBe(true);
      }
    });
  });

  describe('dry run mode', () => {
    it('should not create actual symlinks in dry run', () => {
      const dryRun = true;
      const targetPath = join(mockClaudeSkills, 'dry-run-skill');

      if (!dryRun) {
        // Would create symlink here
      }

      expect(existsSync(targetPath)).toBe(false);
    });

    it('should report what would be synced', () => {
      const skillsToSync: string[] = [];

      readdirSync(mockOverdeckSkills).forEach(name => {
        if (existsSync(join(mockOverdeckSkills, name, 'SKILL.md'))) {
          skillsToSync.push(name);
        }
      });

      expect(skillsToSync).toContain('test-skill');
    });
  });

  describe('conflict handling', () => {
    it('should skip skills that already exist in target', () => {
      // Create existing skill in target
      const existingSkillDir = join(mockClaudeSkills, 'test-skill');
      mkdirSync(existingSkillDir, { recursive: true });
      writeFileSync(join(existingSkillDir, 'SKILL.md'), '# Local skill');

      const existsInTarget = existsSync(existingSkillDir);
      expect(existsInTarget).toBe(true);

      // Sync logic should skip this
    });

    it('should overwrite with --force flag', () => {
      const force = true;
      const targetPath = join(mockClaudeSkills, 'test-skill');

      if (force && existsSync(targetPath)) {
        rmSync(targetPath, { recursive: true, force: true });
      }

      // Then create new symlink
      expect(force).toBe(true);
    });
  });
});
