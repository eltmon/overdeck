import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// PAN-4408: 'okf' is a vendored skill (VENDORED_SKILLS in vendored-skills.ts),
// so sync converges a locally edited real copy instead of treating it as a
// conflict. A symlinked install (the user's own checkout) is untouched.
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

describe('sync converges vendored skills', () => {
  beforeAll(() => {
    dirs.base = mkdtempSync(join(tmpdir(), 'pan-sync-vendored-'));
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

  async function seedManifestEntry(manifestPath: string, key: string, thirdContent: string): Promise<void> {
    const { hashFile, readManifest, setManifestEntry, writeManifest } = await import('../../../src/lib/manifest.js');
    const scratch = join(dirs.base, 'scratch-hash-source');
    write(scratch, thirdContent);
    const manifest = readManifest(manifestPath);
    setManifestEntry(manifest, key, hashFile(scratch), 'overdeck');
    writeManifest(manifestPath, manifest);
  }

  it('replaces a locally edited real copy of a vendored skill and records it as replacedVendored', async () => {
    write(join(dirs.skills, 'okf', 'SKILL.md'), 'new content\n');
    write(join(dirs.claude, 'skills', 'okf', 'SKILL.md'), 'old-variant content\n');
    const manifestPath = join(dirs.claude, '.overdeck-manifest.json');
    await seedManifestEntry(manifestPath, 'skills/okf/SKILL.md', 'third content\n');

    const { executeSync } = await import('../../../src/lib/sync.js');
    const result = executeSync();

    expect(result.replacedVendored).toEqual(['skills/okf/SKILL.md']);
    expect(result.conflicts).toEqual([]);
    expect(readFileSync(join(dirs.claude, 'skills', 'okf', 'SKILL.md'), 'utf-8')).toBe('new content\n');

    const { hashFile, readManifest } = await import('../../../src/lib/manifest.js');
    const manifest = readManifest(manifestPath);
    expect(manifest.installed['skills/okf/SKILL.md'].hash).toBe(
      hashFile(join(dirs.claude, 'skills', 'okf', 'SKILL.md')),
    );
  });

  it('still reports a locally edited non-vendored skill as a conflict', async () => {
    write(join(dirs.skills, 'other', 'SKILL.md'), 'new content\n');
    write(join(dirs.claude, 'skills', 'other', 'SKILL.md'), 'old-variant content\n');
    const manifestPath = join(dirs.claude, '.overdeck-manifest.json');
    await seedManifestEntry(manifestPath, 'skills/other/SKILL.md', 'third content\n');

    const { executeSync } = await import('../../../src/lib/sync.js');
    const result = executeSync();

    expect(result.conflicts).toEqual(['skills/other/SKILL.md']);
    expect(result.replacedVendored).toEqual([]);
    expect(readFileSync(join(dirs.claude, 'skills', 'other', 'SKILL.md'), 'utf-8')).toBe('old-variant content\n');
  });

  it('leaves a symlinked vendored-skill install untouched and reports a conflict', async () => {
    write(join(dirs.skills, 'okf', 'SKILL.md'), 'new content\n');
    const realDir = join(dirs.base, 'user-okf-checkout');
    write(join(realDir, 'SKILL.md'), 'user-owned edited content\n');
    mkdirSync(join(dirs.claude, 'skills'), { recursive: true });
    symlinkSync(realDir, join(dirs.claude, 'skills', 'okf'));
    const manifestPath = join(dirs.claude, '.overdeck-manifest.json');
    await seedManifestEntry(manifestPath, 'skills/okf/SKILL.md', 'third content\n');

    const { executeSync } = await import('../../../src/lib/sync.js');
    const result = executeSync();

    expect(result.conflicts).toEqual(['skills/okf/SKILL.md']);
    expect(result.replacedVendored).toEqual([]);
    expect(readFileSync(join(realDir, 'SKILL.md'), 'utf-8')).toBe('user-owned edited content\n');
  });

  it('planSync reports the vendored file as symlink and the non-vendored file as conflict', async () => {
    write(join(dirs.skills, 'okf', 'SKILL.md'), 'new content\n');
    write(join(dirs.claude, 'skills', 'okf', 'SKILL.md'), 'old-variant content\n');
    write(join(dirs.skills, 'other', 'SKILL.md'), 'new content\n');
    write(join(dirs.claude, 'skills', 'other', 'SKILL.md'), 'old-variant content\n');
    const manifestPath = join(dirs.claude, '.overdeck-manifest.json');
    await seedManifestEntry(manifestPath, 'skills/okf/SKILL.md', 'third content\n');
    await seedManifestEntry(manifestPath, 'skills/other/SKILL.md', 'third content\n');

    const { planSync } = await import('../../../src/lib/sync.js');
    const plan = planSync();

    expect(plan.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'skills/okf/SKILL.md', status: 'symlink' }),
        expect.objectContaining({ name: 'skills/other/SKILL.md', status: 'conflict' }),
      ]),
    );
  });
});
