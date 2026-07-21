import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
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

describe('sync legacy pre-manifest adoption', () => {
  beforeAll(() => {
    dirs.base = mkdtempSync(join(tmpdir(), 'pan-sync-adopt-'));
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

  it('plans stale source-owned files as adopted instead of conflicts', async () => {
    write(join(dirs.skills, 'pan-memory', 'SKILL.md'), '# Pan Memory\nnew content\n');
    write(join(dirs.claude, 'skills', 'pan-memory', 'SKILL.md'), '# Pan Memory\nstale content\n');

    const { planSyncSync } = await import('../../../src/lib/sync.js');

    const plan = planSyncSync();

    expect(plan.skills).toEqual([
      expect.objectContaining({
        name: 'skills/pan-memory/SKILL.md',
        status: 'adopted',
      }),
    ]);
  });

  it('overwrites and records stale source-owned files as adopted', async () => {
    const sourcePath = join(dirs.skills, 'pan-memory', 'SKILL.md');
    const targetPath = join(dirs.claude, 'skills', 'pan-memory', 'SKILL.md');
    write(sourcePath, '# Pan Memory\nnew content\n');
    write(targetPath, '# Pan Memory\nstale content\n');

    const { executeSyncSync } = await import('../../../src/lib/sync.js');

    const result = executeSyncSync();

    expect(result.adopted).toEqual(['skills/pan-memory/SKILL.md']);
    expect(result.skipped).toEqual([]);
    expect(readFileSync(targetPath, 'utf-8')).toBe(readFileSync(sourcePath, 'utf-8'));

    const manifestPath = join(dirs.claude, '.overdeck-manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest.installed['skills/pan-memory/SKILL.md']).toMatchObject({
      source: 'overdeck',
    });
  });
});
