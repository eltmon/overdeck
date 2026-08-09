import { createHash } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const cacheDirs = vi.hoisted(() => ({ skills: '', agents: '', rules: '' }));

vi.mock('../../../src/lib/paths.js', () => ({
  SKILLS_DIR: cacheDirs.skills,
  CACHE_AGENTS_DIR: cacheDirs.agents,
  CACHE_RULES_DIR: cacheDirs.rules,
}));

let cleanupGitignoreSync: typeof import('../../../src/lib/skills-merge.js').cleanupGitignoreSync;
let cleanupWorkspaceGitignoreSync: typeof import('../../../src/lib/skills-merge.js').cleanupWorkspaceGitignoreSync;
let mergeSkillsIntoWorkspaceSync: typeof import('../../../src/lib/skills-merge.js').mergeSkillsIntoWorkspaceSync;

function hash(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

describe('skills-merge', () => {
  let testDir: string;
  let cacheBase: string;

  beforeAll(async () => {
    cacheBase = mkdtempSync(join(tmpdir(), 'overdeck-skills-merge-cache-'));
    cacheDirs.skills = join(cacheBase, 'skills');
    cacheDirs.agents = join(cacheBase, 'agent-definitions');
    cacheDirs.rules = join(cacheBase, 'rules');
    const module = await import('../../../src/lib/skills-merge.js');
    cleanupGitignoreSync = module.cleanupGitignoreSync;
    cleanupWorkspaceGitignoreSync = module.cleanupWorkspaceGitignoreSync;
    mergeSkillsIntoWorkspaceSync = module.mergeSkillsIntoWorkspaceSync;
  });

  beforeEach(() => {
    rmSync(cacheBase, { recursive: true, force: true });
    mkdirSync(cacheBase, { recursive: true });
    testDir = join(tmpdir(), `overdeck-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    rmSync(cacheBase, { recursive: true, force: true });
  });

  describe('mergeSkillsIntoWorkspaceSync pruning', () => {
    it('deletes and reports stale manifest-tracked workspace files', () => {
      const workspacePath = join(testDir, 'workspace');
      const relativePath = 'skills/old-skill/SKILL.md';
      const targetPath = join(workspacePath, '.claude', relativePath);
      const manifestPath = join(workspacePath, '.claude', '.overdeck-manifest.json');
      write(targetPath, 'old skill\n');
      write(manifestPath, JSON.stringify({
        version: 1,
        managed_by: 'overdeck',
        installed: {
          [relativePath]: {
            hash: hash('old skill\n'), source: 'overdeck', installed_at: '2026-08-01T00:00:00.000Z',
          },
        },
      }));

      const result = mergeSkillsIntoWorkspaceSync(workspacePath);

      expect(result.pruned).toEqual([relativePath]);
      expect(result.keptModified).toEqual([]);
      expect(existsSync(targetPath)).toBe(false);
      expect(JSON.parse(readFileSync(manifestPath, 'utf-8')).installed).toEqual({});
    });

    it('preserves modified and unmanifested workspace files', () => {
      const workspacePath = join(testDir, 'workspace');
      const modifiedRelativePath = 'rules/modified.md';
      const modifiedPath = join(workspacePath, '.claude', modifiedRelativePath);
      const userPath = join(workspacePath, '.claude', 'skills', 'user-skill', 'SKILL.md');
      const manifestPath = join(workspacePath, '.claude', '.overdeck-manifest.json');
      write(modifiedPath, 'user modified\n');
      write(userPath, 'user skill\n');
      write(manifestPath, JSON.stringify({
        version: 1,
        managed_by: 'overdeck',
        installed: {
          [modifiedRelativePath]: {
            hash: hash('original\n'), source: 'overdeck', installed_at: '2026-08-01T00:00:00.000Z',
          },
        },
      }));

      const result = mergeSkillsIntoWorkspaceSync(workspacePath);

      expect(result.pruned).toEqual([]);
      expect(result.keptModified).toEqual([modifiedRelativePath]);
      expect(readFileSync(modifiedPath, 'utf-8')).toBe('user modified\n');
      expect(readFileSync(userPath, 'utf-8')).toBe('user skill\n');
      expect(JSON.parse(readFileSync(manifestPath, 'utf-8')).installed).toEqual({});
    });
  });

  describe('cleanupGitignore', () => {
    it('should return early for non-existent file', () => {
      const result = cleanupGitignoreSync(join(testDir, 'does-not-exist'));
      expect(result).toEqual({ cleaned: false, duplicatesRemoved: 0, entriesAfter: 0 });
    });

    it('should return early for file without Overdeck section', () => {
      const gitignorePath = join(testDir, '.gitignore');
      writeFileSync(gitignorePath, '# Some other gitignore\nnode_modules\ndist\n');

      const result = cleanupGitignoreSync(gitignorePath);
      expect(result).toEqual({ cleaned: false, duplicatesRemoved: 0, entriesAfter: 0 });

      // Content should be unchanged
      const content = readFileSync(gitignorePath, 'utf-8');
      expect(content).toBe('# Some other gitignore\nnode_modules\ndist\n');
    });

    it('should remove Overdeck section entirely (skills are copies now)', () => {
      const gitignorePath = join(testDir, '.gitignore');
      const originalContent = `# User content
node_modules
dist
# Overdeck-managed symlinks (not committed)
tasks
feature-work
release
`;
      writeFileSync(gitignorePath, originalContent);

      const result = cleanupGitignoreSync(gitignorePath);
      expect(result.cleaned).toBe(true);
      expect(result.duplicatesRemoved).toBe(0);
      expect(result.entriesAfter).toBe(0);

      // Verify content no longer has Overdeck section
      const content = readFileSync(gitignorePath, 'utf-8');
      expect(content).not.toContain('# Overdeck-managed symlinks');
      expect(content).toContain('# User content');
      expect(content).toContain('node_modules');
    });

    it('should remove entire Overdeck section including duplicates', () => {
      const gitignorePath = join(testDir, '.gitignore');
      const duplicatedContent = `# User content
node_modules
# Overdeck-managed symlinks (not committed)
tasks
feature-work
release
# Overdeck-managed symlinks (not committed)
tasks
feature-work
release
bug-fix
`;
      writeFileSync(gitignorePath, duplicatedContent);

      const result = cleanupGitignoreSync(gitignorePath);
      expect(result.cleaned).toBe(true);
      expect(result.duplicatesRemoved).toBe(0); // Section removal, not deduplication
      expect(result.entriesAfter).toBe(0); // Entire section removed

      // Verify content no longer has Overdeck section
      const content = readFileSync(gitignorePath, 'utf-8');
      expect(content).not.toContain('# Overdeck-managed symlinks');
      expect(content).not.toContain('tasks');
      expect(content).not.toContain('bug-fix');

      // User content should be preserved
      expect(content).toContain('# User content');
      expect(content).toContain('node_modules');
    });

    it('should preserve user content before Overdeck section', () => {
      const gitignorePath = join(testDir, '.gitignore');
      const content = `# IDE files
.idea/
.vscode/

# Build artifacts
dist/
build/

# Dependencies
node_modules/
# Overdeck-managed symlinks (not committed)
tasks
tasks
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

      // Overdeck section removed
      expect(newContent).not.toContain('# Overdeck-managed symlinks');
      expect(newContent).not.toContain('tasks');
      expect(newContent).not.toContain('feature-work');
    });

    it('should remove entire section (sorting no longer applicable)', () => {
      const gitignorePath = join(testDir, '.gitignore');
      const content = `# Overdeck-managed symlinks (not committed)
zebra
alpha
middle
`;
      writeFileSync(gitignorePath, content);

      const result = cleanupGitignoreSync(gitignorePath);
      expect(result.cleaned).toBe(true);
      expect(result.entriesAfter).toBe(0);

      const newContent = readFileSync(gitignorePath, 'utf-8');
      expect(newContent).not.toContain('# Overdeck-managed symlinks');
      expect(newContent).not.toContain('zebra');
      expect(newContent).not.toContain('alpha');
      expect(newContent).not.toContain('middle');
    });

    it('should handle severely duplicated content by removing entire section', () => {
      const gitignorePath = join(testDir, '.gitignore');
      // Simulate what the old bug produced - multiple identical sections
      const skills = ['tasks', 'bug-fix', 'code-review', 'feature-work', 'refactor', 'release'];
      let content = '# User content\nnode_modules\n';

      // Add the same section multiple times (simulating repeated pan sync calls)
      for (let i = 0; i < 5; i++) {
        content += `# Overdeck-managed symlinks (not committed)\n`;
        content += skills.join('\n') + '\n';
      }

      writeFileSync(gitignorePath, content);

      const result = cleanupGitignoreSync(gitignorePath);
      expect(result.cleaned).toBe(true);
      expect(result.duplicatesRemoved).toBe(0); // Section removal, not deduplication
      expect(result.entriesAfter).toBe(0); // Entire section removed

      // Verify no Overdeck section remains
      const newContent = readFileSync(gitignorePath, 'utf-8');
      const headerMatches = newContent.match(/# Overdeck-managed symlinks/g);
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
      writeFileSync(gitignorePath, `# Overdeck-managed symlinks (not committed)
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
      expect(content).not.toContain('# Overdeck-managed symlinks');
      expect(content).not.toContain('skill1');
      expect(content).not.toContain('skill2');
    });

    it('should handle missing workspace', () => {
      const result = cleanupWorkspaceGitignoreSync(join(testDir, 'nonexistent'));
      expect(result).toEqual({ cleaned: false, duplicatesRemoved: 0, entriesAfter: 0 });
    });
  });
});
