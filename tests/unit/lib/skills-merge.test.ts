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

let mergeSkillsIntoWorkspace: typeof import('../../../src/lib/skills-merge.js').mergeSkillsIntoWorkspacemergeSkillsIntoWorkspaceSyncmergeSkillsIntoWorkspace;

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
    mergeSkillsIntoWorkspace = module.mergeSkillsIntoWorkspace;
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

  describe('mergeSkillsIntoWorkspace pruning', () => {
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

      const result = mergeSkillsIntoWorkspace(workspacePath);

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

      const result = mergeSkillsIntoWorkspace(workspacePath);

      expect(result.pruned).toEqual([]);
      expect(result.keptModified).toEqual([]);
      expect(readFileSync(modifiedPath, 'utf-8')).toBe('user modified\n');
      expect(readFileSync(userPath, 'utf-8')).toBe('user skill\n');
      expect(JSON.parse(readFileSync(manifestPath, 'utf-8')).installed[modifiedRelativePath]).toBeDefined();
    });
  });

  it('never copies or prunes native instructions while continuing to copy skills', () => {
    const workspace = join(testDir, 'workspace');
    write(join(cacheDirs.rules, 'new.md'), 'generated rule');
    write(join(cacheDirs.skills, 'sample', 'SKILL.md'), 'skill');
    const target = join(workspace, '.claude', 'rules', 'old.md');
    write(target, 'historical rule');
    write(join(workspace, '.claude', '.overdeck-manifest.json'), JSON.stringify({
      version: 1, managed_by: 'overdeck', installed: {
        'rules/old.md': { hash: hash('historical rule'), source: 'overdeck', installed_at: '' },
      },
    }));
    const result = mergeSkillsIntoWorkspace(workspace);
    expect(readFileSync(target, 'utf8')).toBe('historical rule');
    expect(existsSync(join(workspace, '.claude', 'rules', 'new.md'))).toBe(false);
    expect(readFileSync(join(workspace, '.claude', 'skills', 'sample', 'SKILL.md'), 'utf8')).toBe('skill');
    expect(result.pruned).toEqual([]);
  });


});
