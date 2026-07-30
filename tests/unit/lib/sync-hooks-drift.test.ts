import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
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

function hookSource(name: string, content: string): void {
  mkdirSync(join(dirs.syncSources, 'hooks'), { recursive: true });
  writeFileSync(join(dirs.syncSources, 'hooks', name), content, 'utf-8');
}

function deployedHook(name: string, content: string): void {
  mkdirSync(join(dirs.overdeck, 'bin'), { recursive: true });
  writeFileSync(join(dirs.overdeck, 'bin', name), content, 'utf-8');
}

describe('hook sync reports what it actually changed (PAN-3327)', () => {
  beforeAll(() => {
    dirs.base = mkdtempSync(join(tmpdir(), 'pan-hook-drift-'));
    dirs.overdeck = join(dirs.base, 'overdeck');
    dirs.claude = join(dirs.base, 'home', '.claude');
    dirs.syncSources = join(dirs.base, 'sync-sources');
  });

  beforeEach(() => {
    rmSync(join(dirs.syncSources, 'hooks'), { recursive: true, force: true });
    rmSync(join(dirs.overdeck, 'bin'), { recursive: true, force: true });
    mkdirSync(join(dirs.syncSources, 'hooks'), { recursive: true });
  });

  afterAll(() => {
    rmSync(dirs.base, { recursive: true, force: true });
  });

  it('marks a byte-identical deployed hook as current, not updated', async () => {
    const { planHooksSyncSync } = await loadSync();
    hookSource('stop-hook', '#!/bin/bash\necho same\n');
    deployedHook('stop-hook', '#!/bin/bash\necho same\n');

    expect(planHooksSyncSync()).toEqual([
      expect.objectContaining({ name: 'stop-hook', status: 'current' }),
    ]);
  });

  it('marks a diverged deployed hook as updated', async () => {
    const { planHooksSyncSync } = await loadSync();
    hookSource('stop-hook', '#!/bin/bash\necho fixed\n');
    deployedHook('stop-hook', '#!/bin/bash\necho stale\n');

    expect(planHooksSyncSync()).toEqual([
      expect.objectContaining({ name: 'stop-hook', status: 'updated' }),
    ]);
  });

  it('marks a hook with no deployed copy as new', async () => {
    const { planHooksSyncSync } = await loadSync();
    hookSource('stop-hook', '#!/bin/bash\necho new\n');

    expect(planHooksSyncSync()).toEqual([
      expect.objectContaining({ name: 'stop-hook', status: 'new' }),
    ]);
  });

  it('separates changed from unchanged hooks and names the source tree', async () => {
    const { syncHooksSync } = await loadSync();
    hookSource('changed-hook', '#!/bin/bash\necho fixed\n');
    deployedHook('changed-hook', '#!/bin/bash\necho stale\n');
    hookSource('same-hook', '#!/bin/bash\necho same\n');
    deployedHook('same-hook', '#!/bin/bash\necho same\n');
    hookSource('new-hook', '#!/bin/bash\necho new\n');

    const result = syncHooksSync();

    expect(result.errors).toEqual([]);
    expect(result.synced.sort()).toEqual(['changed-hook', 'new-hook', 'same-hook']);
    expect(result.changed.sort()).toEqual(['changed-hook', 'new-hook']);
    expect(result.unchanged).toEqual(['same-hook']);
    expect(result.sourceRoot).toBe(join(dirs.syncSources, 'hooks'));
    // The copy still happens for every hook — the counts describe it, not gate it.
    expect(readFileSync(join(dirs.overdeck, 'bin', 'changed-hook'), 'utf-8')).toBe('#!/bin/bash\necho fixed\n');
  });
});
