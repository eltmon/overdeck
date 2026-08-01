import { createHash } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dirs = vi.hoisted(() => ({
  base: '',
  claude: '',
  skills: '',
  agents: '',
  rules: '',
  commands: '',
  bin: '',
  syncSources: '',
  cacheManifest: '',
}));

vi.mock('../../../src/lib/paths.js', () => ({
  OVERDECK_HOME: join(dirs.base, 'overdeck'),
  SKILLS_DIR: dirs.skills,
  COMMANDS_DIR: dirs.commands,
  AGENTS_DIR: dirs.agents,
  BIN_DIR: dirs.bin,
  CLAUDE_DIR: dirs.claude,
  SYNC_SOURCES: {
    skills: join(dirs.syncSources, 'skills'),
    devSkills: join(dirs.syncSources, 'dev-skills'),
    agents: join(dirs.syncSources, 'agents'),
    rules: join(dirs.syncSources, 'rules'),
  },
  CACHE_AGENTS_DIR: dirs.agents,
  CACHE_RULES_DIR: dirs.rules,
  CACHE_MANIFEST: dirs.cacheManifest,
  SYNC_TARGET: {
    skills: join(dirs.claude, 'skills'),
    commands: join(dirs.claude, 'commands'),
    agents: join(dirs.claude, 'agents'),
  },
  isDevMode: () => false,
}));

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function hash(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function writeTargetManifest(
  installed: Record<string, { hash: string; source: string; installed_at: string }>,
): void {
  write(join(dirs.claude, '.overdeck-manifest.json'), JSON.stringify({
    version: 1,
    managed_by: 'overdeck',
    installed,
  }));
}

function readTargetManifest(): {
  installed: Record<string, { hash: string; source: string; installed_at: string }>;
} {
  return JSON.parse(readFileSync(join(dirs.claude, '.overdeck-manifest.json'), 'utf-8'));
}

describe('executeSyncSync stale target pruning', () => {
  beforeAll(() => {
    dirs.base = mkdtempSync(join(tmpdir(), 'overdeck-sync-prune-target-'));
    dirs.claude = join(dirs.base, 'home', '.claude');
    dirs.skills = join(dirs.base, 'overdeck', 'skills');
    dirs.agents = join(dirs.base, 'overdeck', 'agent-definitions');
    dirs.rules = join(dirs.base, 'overdeck', 'rules');
    dirs.commands = join(dirs.base, 'overdeck', 'commands');
    dirs.bin = join(dirs.base, 'overdeck', 'bin');
    dirs.syncSources = join(dirs.base, 'sync-sources');
    dirs.cacheManifest = join(dirs.base, 'overdeck', '.manifest.json');
  });

  beforeEach(() => {
    rmSync(dirs.base, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(dirs.base, { recursive: true, force: true });
  });

  it('deletes an unmodified stale skill and its empty directory', async () => {
    const relativePath = 'skills/old-skill/SKILL.md';
    const targetPath = join(dirs.claude, relativePath);
    write(targetPath, 'old skill\n');
    writeTargetManifest({
      [relativePath]: {
        hash: hash('old skill\n'), source: 'overdeck', installed_at: '2026-08-01T00:00:00.000Z',
      },
    });

    const { executeSyncSync } = await import('../../../src/lib/sync.js');
    const result = executeSyncSync();

    expect(result.pruned).toEqual([relativePath]);
    expect(result.keptModified).toEqual([]);
    expect(existsSync(targetPath)).toBe(false);
    expect(existsSync(join(dirs.claude, 'skills', 'old-skill'))).toBe(false);
    expect(readTargetManifest().installed).toEqual({});
  });

  it('preserves a user-modified stale skill and releases manifest ownership', async () => {
    const relativePath = 'skills/old-skill/SKILL.md';
    const targetPath = join(dirs.claude, relativePath);
    write(targetPath, 'user modified\n');
    writeTargetManifest({
      [relativePath]: {
        hash: hash('old skill\n'), source: 'overdeck', installed_at: '2026-08-01T00:00:00.000Z',
      },
    });

    const { executeSyncSync } = await import('../../../src/lib/sync.js');
    const result = executeSyncSync();

    expect(result.pruned).toEqual([]);
    expect(result.keptModified).toEqual([relativePath]);
    expect(readFileSync(targetPath, 'utf-8')).toBe('user modified\n');
    expect(readTargetManifest().installed).toEqual({});
  });

  it('keeps unmanifested user skills and current cached rules while pruning stale rules', async () => {
    const userSkillPath = join(dirs.claude, 'skills', 'user-skill', 'SKILL.md');
    const currentRulePath = join(dirs.claude, 'rules', 'current.md');
    const staleRulePath = join(dirs.claude, 'rules', 'beads-dolt-authority.md');
    write(userSkillPath, 'user skill\n');
    write(join(dirs.rules, 'current.md'), 'current rule\n');
    write(currentRulePath, 'current rule\n');
    write(staleRulePath, 'stale rule\n');
    writeTargetManifest({
      'rules/current.md': {
        hash: hash('current rule\n'), source: 'overdeck', installed_at: '2026-08-01T00:00:00.000Z',
      },
      'rules/beads-dolt-authority.md': {
        hash: hash('stale rule\n'), source: 'overdeck', installed_at: '2026-08-01T00:00:00.000Z',
      },
    });

    const { executeSyncSync } = await import('../../../src/lib/sync.js');
    const result = executeSyncSync();
    const manifest = readTargetManifest();

    expect(result.pruned).toEqual(['rules/beads-dolt-authority.md']);
    expect(existsSync(userSkillPath)).toBe(true);
    expect(existsSync(currentRulePath)).toBe(true);
    expect(existsSync(staleRulePath)).toBe(false);
    expect(manifest.installed).toHaveProperty('rules/current.md');
    expect(manifest.installed).not.toHaveProperty('rules/beads-dolt-authority.md');
  });
});
