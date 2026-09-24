import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dirs = vi.hoisted(() => ({
  base: '',
  overdeck: '',
  claude: '',
  syncSources: '',
}));

vi.mock('../../../src/lib/paths.js', () => ({
  OVERDECK_HOME: dirs.overdeck,
  SKILLS_DIR: join(dirs.overdeck, 'skills'),
  COMMANDS_DIR: join(dirs.overdeck, 'commands'),
  AGENTS_DIR: join(dirs.overdeck, 'agents'),
  BIN_DIR: join(dirs.overdeck, 'bin'),
  CLAUDE_DIR: dirs.claude,
  SYNC_SOURCES: {
    root: dirs.syncSources,
    skills: join(dirs.syncSources, 'skills'),
    devSkills: join(dirs.syncSources, 'dev-skills'),
    agents: join(dirs.syncSources, 'agents'),
    rules: join(dirs.syncSources, 'rules'),
    hooks: join(dirs.syncSources, 'hooks'),
    gitHooks: join(dirs.syncSources, 'hooks', 'git-hooks'),
    templates: join(dirs.syncSources, 'templates'),
    traefikTemplates: join(dirs.syncSources, 'templates', 'traefik'),
    claudeMdSections: join(dirs.syncSources, 'templates', 'claude-md', 'sections'),
  },
  CACHE_AGENTS_DIR: join(dirs.overdeck, 'agent-definitions'),
  CACHE_RULES_DIR: join(dirs.overdeck, 'rules'),
  CACHE_MANIFEST: join(dirs.overdeck, '.manifest.json'),
  SYNC_TARGET: {
    skills: join(dirs.claude, 'skills'),
    commands: join(dirs.claude, 'commands'),
    agents: join(dirs.claude, 'agents'),
  },
  isDevMode: () => false,
}));

vi.mock('../../../src/lib/projects.js', () => ({
  listProjectsSync: () => [],
}));

// Imported dynamically inside each test: the paths mock captures `dirs` when the
// factory first runs, which must be after beforeAll has filled in the temp paths.
const loadSync = () => import('../../../src/lib/sync.js');

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

const src = (...parts: string[]) => join(dirs.syncSources, ...parts);
const bin = (name: string) => join(dirs.overdeck, 'bin', name);
const cacheAgent = (name: string) => join(dirs.overdeck, 'agent-definitions', name);
const claudeAgent = (name: string) => join(dirs.claude, 'agents', name);

async function runSync() {
  const { refreshCache, executeSync, syncHooks } = await loadSync();
  const cache = refreshCache();
  const claude = executeSync();
  const hooks = syncHooks();
  return { cache, claude, hooks };
}

describe('pan sync removes targets whose source was deleted (PAN-3881)', () => {
  beforeAll(() => {
    dirs.base = mkdtempSync(join(tmpdir(), 'overdeck-sync-deleted-'));
    dirs.overdeck = join(dirs.base, 'overdeck');
    dirs.claude = join(dirs.base, 'home', '.claude');
    dirs.syncSources = join(dirs.base, 'sync-sources');
  });

  beforeEach(() => {
    rmSync(dirs.base, { recursive: true, force: true });
    write(src('agents', 'keep-agent.md'), 'keep\n');
    write(src('agents', 'gone-agent.md'), 'gone\n');
    write(src('hooks', 'keep-hook'), '#!/bin/sh\necho keep\n');
    write(src('hooks', 'gone-hook'), '#!/bin/sh\necho gone\n');
  });

  afterAll(() => {
    rmSync(dirs.base, { recursive: true, force: true });
  });

  it('removes a deleted agent definition and hook from every target on the next sync', async () => {
    await runSync();
    for (const path of [cacheAgent('gone-agent.md'), claudeAgent('gone-agent.md'), bin('gone-hook')]) {
      expect(existsSync(path)).toBe(true);
    }

    rmSync(src('agents', 'gone-agent.md'));
    rmSync(src('hooks', 'gone-hook'));
    const second = await runSync();

    expect(existsSync(cacheAgent('gone-agent.md'))).toBe(false);
    expect(existsSync(claudeAgent('gone-agent.md'))).toBe(false);
    expect(existsSync(bin('gone-hook'))).toBe(false);
    expect(second.hooks.pruned).toEqual(['gone-hook']);
    expect(existsSync(cacheAgent('keep-agent.md'))).toBe(true);
    expect(existsSync(claudeAgent('keep-agent.md'))).toBe(true);
    expect(existsSync(bin('keep-hook'))).toBe(true);
  });

  it('never removes files sync did not write, and keeps a synced hook edited on disk', async () => {
    write(bin('my-own-script'), 'user\n');
    write(claudeAgent('my-own-agent.md'), 'user\n');
    await runSync();

    write(bin('gone-hook'), '#!/bin/sh\necho edited by the operator\n');
    rmSync(src('hooks', 'gone-hook'));
    const second = await runSync();

    expect(readFileSync(bin('my-own-script'), 'utf-8')).toBe('user\n');
    expect(readFileSync(claudeAgent('my-own-agent.md'), 'utf-8')).toBe('user\n');
    expect(readFileSync(bin('gone-hook'), 'utf-8')).toContain('edited by the operator');
    expect(second.hooks.pruned).toEqual([]);
    expect(second.hooks.keptModified).toEqual(['gone-hook']);
  });

  it('does not remove a hook left from before the manifest existed', async () => {
    write(bin('legacy-hook'), '#!/bin/sh\n');
    const first = await runSync();

    expect(existsSync(bin('legacy-hook'))).toBe(true);
    expect(first.hooks.pruned).toEqual([]);
  });

  it('does not treat a missing hooks source directory as every hook deleted', async () => {
    await runSync();
    rmSync(src('hooks'), { recursive: true, force: true });
    const second = await runSync();

    expect(existsSync(bin('keep-hook'))).toBe(true);
    expect(second.hooks.pruned).toEqual([]);
  });
});
