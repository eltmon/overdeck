import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { cleanupGitignore, cleanupWorkspaceGitignore } from '../../../src/lib/skills-merge.js';

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
      const result = cleanupGitignore(join(testDir, 'does-not-exist'));
      expect(result).toEqual({ cleaned: false, duplicatesRemoved: 0, entriesAfter: 0 });
    });

    it('should return early for file without Panopticon section', () => {
      const gitignorePath = join(testDir, '.gitignore');
      writeFileSync(gitignorePath, '# Some other gitignore\nnode_modules\ndist\n');

      const result = cleanupGitignore(gitignorePath);
      expect(result).toEqual({ cleaned: false, duplicatesRemoved: 0, entriesAfter: 0 });

      // Content should be unchanged
      const content = readFileSync(gitignorePath, 'utf-8');
      expect(content).toBe('# Some other gitignore\nnode_modules\ndist\n');
    });

    it('should not modify file without duplicates', () => {
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

      const result = cleanupGitignore(gitignorePath);
      expect(result.cleaned).toBe(false);
      expect(result.duplicatesRemoved).toBe(0);
      expect(result.entriesAfter).toBe(3);
    });

    it('should remove duplicate entries', () => {
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

      const result = cleanupGitignore(gitignorePath);
      expect(result.cleaned).toBe(true);
      expect(result.duplicatesRemoved).toBe(3); // beads, feature-work, release appear twice
      expect(result.entriesAfter).toBe(4); // beads, bug-fix, feature-work, release (sorted)

      // Verify content
      const content = readFileSync(gitignorePath, 'utf-8');
      expect(content).toContain('# Panopticon-managed symlinks (not committed)');
      expect(content).toContain('beads');
      expect(content).toContain('bug-fix');
      expect(content).toContain('feature-work');
      expect(content).toContain('release');

      // Should only have one Panopticon header
      const matches = content.match(/# Panopticon-managed symlinks/g);
      expect(matches?.length).toBe(1);
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

      const result = cleanupGitignore(gitignorePath);
      expect(result.cleaned).toBe(true);
      expect(result.duplicatesRemoved).toBe(1);

      const newContent = readFileSync(gitignorePath, 'utf-8');
      expect(newContent).toContain('# IDE files');
      expect(newContent).toContain('.idea/');
      expect(newContent).toContain('.vscode/');
      expect(newContent).toContain('# Build artifacts');
      expect(newContent).toContain('dist/');
      expect(newContent).toContain('node_modules/');
    });

    it('should sort entries alphabetically', () => {
      const gitignorePath = join(testDir, '.gitignore');
      const content = `# Panopticon-managed symlinks (not committed)
zebra
alpha
middle
`;
      writeFileSync(gitignorePath, content);

      // Call it once to normalize (no duplicates but will sort)
      const result = cleanupGitignore(gitignorePath);
      // No duplicates, so not cleaned
      expect(result.cleaned).toBe(false);

      // Add duplicates to trigger cleanup
      writeFileSync(gitignorePath, `# Panopticon-managed symlinks (not committed)
zebra
alpha
middle
zebra
`);
      const result2 = cleanupGitignore(gitignorePath);
      expect(result2.cleaned).toBe(true);

      const newContent = readFileSync(gitignorePath, 'utf-8');
      const lines = newContent.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      expect(lines).toEqual(['alpha', 'middle', 'zebra']);
    });

    it('should handle severely duplicated content (like the real bug)', () => {
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

      const result = cleanupGitignore(gitignorePath);
      expect(result.cleaned).toBe(true);
      expect(result.duplicatesRemoved).toBe(skills.length * 4); // 4 extra copies
      expect(result.entriesAfter).toBe(skills.length);

      // Verify only one section remains
      const newContent = readFileSync(gitignorePath, 'utf-8');
      const headerMatches = newContent.match(/# Panopticon-managed symlinks/g);
      expect(headerMatches?.length).toBe(1);

      // Verify each skill appears exactly once
      for (const skill of skills) {
        const skillMatches = newContent.match(new RegExp(`^${skill}$`, 'gm'));
        expect(skillMatches?.length).toBe(1);
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

      const result = cleanupWorkspaceGitignore(workspacePath);
      expect(result.cleaned).toBe(true);
      expect(result.duplicatesRemoved).toBe(1);
      expect(result.entriesAfter).toBe(2);
    });

    it('should handle missing workspace', () => {
      const result = cleanupWorkspaceGitignore(join(testDir, 'nonexistent'));
      expect(result).toEqual({ cleaned: false, duplicatesRemoved: 0, entriesAfter: 0 });
    });
  });
});
