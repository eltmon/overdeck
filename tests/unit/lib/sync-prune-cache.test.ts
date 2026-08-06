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
  devMode: false,
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
  isDevMode: () => dirs.devMode,
}));

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function hash(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function writeManifest(
  installed: Record<string, { hash: string; source: string; installed_at: string }>,
): void {
  write(dirs.cacheManifest, JSON.stringify({
    version: 1,
    managed_by: 'overdeck',
    installed,
  }));
}

function readManifest(): {
  installed: Record<string, { hash: string; source: string; installed_at: string }>;
} {
  return JSON.parse(readFileSync(dirs.cacheManifest, 'utf-8'));
}

describe('refreshCacheSync stale cache pruning', () => {
  beforeAll(() => {
    dirs.base = mkdtempSync(join(tmpdir(), 'overdeck-sync-prune-cache-'));
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
    dirs.devMode = false;
  });

  afterAll(() => {
    rmSync(dirs.base, { recursive: true, force: true });
  });

  it('prunes stale skills and rules recorded as Overdeck-managed', async () => {
    const skillPath = join(dirs.skills, 'beads', 'SKILL.md');
    const rulePath = join(dirs.rules, 'beads.md');
    write(skillPath, 'stale skill\n');
    write(rulePath, 'stale rule\n');
    writeManifest({
      'skills/beads/SKILL.md': {
        hash: hash('stale skill\n'), source: 'overdeck', installed_at: '2026-08-01T00:00:00.000Z',
      },
      'rules/beads.md': {
        hash: hash('stale rule\n'), source: 'overdeck', installed_at: '2026-08-01T00:00:00.000Z',
      },
    });

    const { refreshCacheSync } = await import('../../../src/lib/sync.js');
    const result = refreshCacheSync();

    expect(result.pruned).toEqual(['skills/beads/SKILL.md', 'rules/beads.md']);
    expect(result.keptModified).toEqual([]);
    expect(existsSync(skillPath)).toBe(false);
    expect(existsSync(rulePath)).toBe(false);
    expect(readManifest().installed).toEqual({});
  });

  it('preserves user content and carries forward known non-Overdeck provenance', async () => {
    const unmanifestedPath = join(dirs.skills, 'user-skill', 'SKILL.md');
    const modifiedPath = join(dirs.rules, 'modified.md');
    const projectPath = join(dirs.rules, 'project.md');
    write(unmanifestedPath, 'user skill\n');
    write(modifiedPath, 'user changed this\n');
    write(projectPath, 'project changed this\n');
    writeManifest({
      'rules/modified.md': {
        hash: hash('original\n'), source: 'overdeck', installed_at: '2026-08-01T00:00:00.000Z',
      },
      'rules/project.md': {
        hash: hash('old project\n'), source: 'project-template', installed_at: '2026-07-01T00:00:00.000Z',
      },
    });

    const { refreshCacheSync } = await import('../../../src/lib/sync.js');
    const result = refreshCacheSync();
    const manifest = readManifest();

    expect(result.pruned).toEqual([]);
    expect(result.keptModified).toEqual(['rules/modified.md']);
    expect(readFileSync(unmanifestedPath, 'utf-8')).toBe('user skill\n');
    expect(readFileSync(modifiedPath, 'utf-8')).toBe('user changed this\n');
    expect(manifest.installed['skills/user-skill/SKILL.md'].source).toBe('user');
    expect(manifest.installed['rules/modified.md'].source).toBe('user');
    expect(manifest.installed['rules/project.md']).toMatchObject({
      source: 'project-template',
      installed_at: '2026-07-01T00:00:00.000Z',
      hash: hash('project changed this\n'),
    });
  });

  it('does not mirror or count empty regular and dev skill directories', async () => {
    mkdirSync(join(dirs.syncSources, 'skills', 'empty-skill', 'nested'), { recursive: true });
    mkdirSync(join(dirs.syncSources, 'dev-skills', 'empty-dev-skill'), { recursive: true });
    dirs.devMode = true;

    const { refreshCacheSync } = await import('../../../src/lib/sync.js');
    const result = refreshCacheSync();

    expect(result.skills).toEqual({ copied: 0, total: 0 });
    expect(existsSync(join(dirs.skills, 'empty-skill'))).toBe(false);
    expect(existsSync(join(dirs.skills, 'empty-dev-skill'))).toBe(false);
  });

  it('returns no pruning changes on a second refresh', async () => {
    const stalePath = join(dirs.rules, 'removed.md');
    write(stalePath, 'stale\n');
    writeManifest({
      'rules/removed.md': {
        hash: hash('stale\n'), source: 'overdeck', installed_at: '2026-08-01T00:00:00.000Z',
      },
    });

    const { refreshCacheSync } = await import('../../../src/lib/sync.js');
    const first = refreshCacheSync();
    const second = refreshCacheSync();

    expect(first.pruned).toEqual(['rules/removed.md']);
    expect(second.pruned).toEqual([]);
    expect(second.keptModified).toEqual([]);
  });
});
