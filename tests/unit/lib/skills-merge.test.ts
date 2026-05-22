import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { cleanupGitignoreSync, cleanupWorkspaceGitignoreSync } from '../../../src/lib/skills-merge.js';

describe('skills-merge', () => {
  let testDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `panopticon-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('cleanupGitignore', () => {
    it('should return early for non-existent file', () => {
      const result = cleanupGitignoreSync(join(testDir, 'does-not-exist'));
      expect(result).toEqual({ cleaned: false, duplicatesRemoved: 0, entriesAfter: 0 });
    });

    it('should return early for file without Panopticon section', () => {
      const gitignorePath = join(testDir, '.gitignore');
      writeFileSync(gitignorePath, '# Some other gitignore\nnode_modules\ndist\n');

      const result = cleanupGitignoreSync(gitignorePath);
      expect(result).toEqual({ cleaned: false, duplicatesRemoved: 0, entriesAfter: 0 });

      // Content should be unchanged
      const content = readFileSync(gitignorePath, 'utf-8');
      expect(content).toBe('# Some other gitignore\nnode_modules\ndist\n');
    });

    it('should remove Panopticon section entirely (skills are copies now)', () => {
      const gitignorePath = join(testDir, '.gitignore');
      const originalContent = `# User content
node_modules
dist
# Panopticon-managed symlinks (not committed)
beads
feature-work
release
`;
      writeFileSync(gitignorePath, originalContent);

      const result = cleanupGitignoreSync(gitignorePath);
      expect(result.cleaned).toBe(true);
      expect(result.duplicatesRemoved).toBe(0);
      expect(result.entriesAfter).toBe(0);

      // Verify content no longer has Panopticon section
      const content = readFileSync(gitignorePath, 'utf-8');
      expect(content).not.toContain('# Panopticon-managed symlinks');
      expect(content).toContain('# User content');
      expect(content).toContain('node_modules');
    });

    it('should remove entire Panopticon section including duplicates', () => {
      const gitignorePath = join(testDir, '.gitignore');
      const duplicatedContent = `# User content
node_modules
# Panopticon-managed symlinks (not committed)
beads
feature-work
release
# Panopticon-managed symlinks (not committed)
beads
feature-work
release
bug-fix
`;
      writeFileSync(gitignorePath, duplicatedContent);

      const result = cleanupGitignoreSync(gitignorePath);
      expect(result.cleaned).toBe(true);
      expect(result.duplicatesRemoved).toBe(0); // Section removal, not deduplication
      expect(result.entriesAfter).toBe(0); // Entire section removed

      // Verify content no longer has Panopticon section
      const content = readFileSync(gitignorePath, 'utf-8');
      expect(content).not.toContain('# Panopticon-managed symlinks');
      expect(content).not.toContain('beads');
      expect(content).not.toContain('bug-fix');

      // User content should be preserved
      expect(content).toContain('# User content');
      expect(content).toContain('node_modules');
    });

    it('should preserve user content before Panopticon section', () => {
      const gitignorePath = join(testDir, '.gitignore');
      const content = `# IDE files
.idea/
.vscode/

# Build artifacts
dist/
build/

# Dependencies
node_modules/
# Panopticon-managed symlinks (not committed)
beads
beads
feature-work
`;
      writeFileSync(gitignorePath, content);

      const result = cleanupGitignoreSync(gitignorePath);
      expect(result.cleaned).toBe(true);
      expect(result.duplicatesRemoved).toBe(0); // Section removal, not deduplication

      const newContent = readFileSync(gitignorePath, 'utf-8');
      // User content preserved
      expect(newContent).toContain('# IDE files');
      expect(newContent).toContain('.idea/');
      expect(newContent).toContain('.vscode/');
      expect(newContent).toContain('# Build artifacts');
      expect(newContent).toContain('dist/');
      expect(newContent).toContain('node_modules/');

      // Panopticon section removed
      expect(newContent).not.toContain('# Panopticon-managed symlinks');
      expect(newContent).not.toContain('beads');
      expect(newContent).not.toContain('feature-work');
    });

    it('should remove entire section (sorting no longer applicable)', () => {
      const gitignorePath = join(testDir, '.gitignore');
      const content = `# Panopticon-managed symlinks (not committed)
zebra
alpha
middle
`;
      writeFileSync(gitignorePath, content);

      const result = cleanupGitignoreSync(gitignorePath);
      expect(result.cleaned).toBe(true);
      expect(result.entriesAfter).toBe(0);

      const newContent = readFileSync(gitignorePath, 'utf-8');
      expect(newContent).not.toContain('# Panopticon-managed symlinks');
      expect(newContent).not.toContain('zebra');
      expect(newContent).not.toContain('alpha');
      expect(newContent).not.toContain('middle');
    });

    it('should handle severely duplicated content by removing entire section', () => {
      const gitignorePath = join(testDir, '.gitignore');
      // Simulate what the old bug produced - multiple identical sections
      const skills = ['beads', 'bug-fix', 'code-review', 'feature-work', 'refactor', 'release'];
      let content = '# User content\nnode_modules\n';

      // Add the same section multiple times (simulating repeated pan sync calls)
      for (let i = 0; i < 5; i++) {
        content += `# Panopticon-managed symlinks (not committed)\n`;
        content += skills.join('\n') + '\n';
      }

      writeFileSync(gitignorePath, content);

      const result = cleanupGitignoreSync(gitignorePath);
      expect(result.cleaned).toBe(true);
      expect(result.duplicatesRemoved).toBe(0); // Section removal, not deduplication
      expect(result.entriesAfter).toBe(0); // Entire section removed

      // Verify no Panopticon section remains
      const newContent = readFileSync(gitignorePath, 'utf-8');
      const headerMatches = newContent.match(/# Panopticon-managed symlinks/g);
      expect(headerMatches).toBeNull();

      // Verify user content is preserved
      expect(newContent).toContain('# User content');
      expect(newContent).toContain('node_modules');

      // Verify no skills remain
      for (const skill of skills) {
        expect(newContent).not.toContain(skill);
      }
    });
  });

  describe('cleanupWorkspaceGitignore', () => {
    it('should target the correct path within workspace', () => {
      const workspacePath = join(testDir, 'workspace');
      const skillsDir = join(workspacePath, '.claude', 'skills');
      mkdirSync(skillsDir, { recursive: true });

      const gitignorePath = join(skillsDir, '.gitignore');
      writeFileSync(gitignorePath, `# Panopticon-managed symlinks (not committed)
skill1
skill1
skill2
`);

      const result = cleanupWorkspaceGitignoreSync(workspacePath);
      expect(result.cleaned).toBe(true);
      expect(result.duplicatesRemoved).toBe(0); // Section removal, not deduplication
      expect(result.entriesAfter).toBe(0); // Entire section removed

      // Verify section is removed
      const content = readFileSync(gitignorePath, 'utf-8');
      expect(content).not.toContain('# Panopticon-managed symlinks');
      expect(content).not.toContain('skill1');
      expect(content).not.toContain('skill2');
    });

    it('should handle missing workspace', () => {
      const result = cleanupWorkspaceGitignoreSync(join(testDir, 'nonexistent'));
      expect(result).toEqual({ cleaned: false, duplicatesRemoved: 0, entriesAfter: 0 });
    });
  });
});
