/**
 * PAN-5238 WI-1/WI-2: listSkillCatalog reads its roots and per-skill SKILL.md
 * files concurrently through a bounded fs limiter, with output identical to
 * the sequential version — same entries, same origin, first-root-wins
 * precedence, sorted by name. listPackCatalog reuses a pack's manifest while
 * its extract dir keeps the same inode, mtime and ctime.
 */
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../skill-packs/sources.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../skill-packs/sources.js')>();
  return { ...actual, listPacks: vi.fn(), packExtractDir: vi.fn(), packRenderDir: vi.fn() };
});

vi.mock('../../skill-packs/adapters.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../skill-packs/adapters.js')>();
  return { ...actual, readPackManifest: vi.fn(actual.readPackManifest) };
});

const { getCounters } = vi.hoisted(() => {
  let inFlight = 0;
  let maxInFlight = 0;
  return {
    getCounters: () => ({
      get inFlight() { return inFlight; },
      set inFlight(v: number) { inFlight = v; },
      get maxInFlight() { return maxInFlight; },
      set maxInFlight(v: number) { maxInFlight = v; },
    }),
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const counters = getCounters();
  return {
    ...actual,
    readFile: vi.fn(async (...args: Parameters<typeof actual.readFile>) => {
      counters.inFlight++;
      counters.maxInFlight = Math.max(counters.maxInFlight, counters.inFlight);
      try {
        return await (actual.readFile as (...a: typeof args) => Promise<unknown>)(...args);
      } finally {
        counters.inFlight--;
      }
    }),
  };
});

const { listSkillCatalog, listPackCatalog } = await import('../catalog.js');
const { readPackManifest } = await import('../../skill-packs/adapters.js');
const { listPacks, packExtractDir, packRenderDir } = await import('../../skill-packs/sources.js');

function writeSkill(dir: string, name: string, description: string): void {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), `---\ndescription: ${description}\n---\nBody.`);
}

describe('listSkillCatalog', () => {
  let home: string;
  let projectRoot: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'skill-catalog-home-'));
    projectRoot = mkdtempSync(join(tmpdir(), 'skill-catalog-project-'));
    const counters = getCounters();
    counters.inFlight = 0;
    counters.maxInFlight = 0;
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('keeps first-root-wins precedence', async () => {
    writeSkill(join(home, '.overdeck', 'skills'), 'dup', 'from overdeck');
    writeSkill(join(home, '.claude', 'skills'), 'dup', 'from claude');
    writeSkill(join(projectRoot, '.pan', 'skills'), 'only-project', 'project only');
    mkdirSync(join(home, '.overdeck', 'skills', 'no-skill-md'), { recursive: true });

    const entries = await listSkillCatalog({ home, projectRoot });

    expect(entries.map((e) => e.name)).toEqual(['dup', 'only-project']);
    const dup = entries.find((e) => e.name === 'dup');
    expect(dup).toMatchObject({ origin: 'overdeck' });
    expect(dup?.projectSkill).toBeUndefined();
    const projectOnly = entries.find((e) => e.name === 'only-project');
    expect(projectOnly).toMatchObject({ origin: 'project', projectSkill: true });
  });

  it('reads SKILL.md files concurrently, at most 32 at a time', async () => {
    const root = join(home, '.overdeck', 'skills');
    for (let i = 0; i < 40; i++) {
      writeSkill(root, `skill-${String(i).padStart(2, '0')}`, `skill ${i}`);
    }

    await listSkillCatalog({ home });

    const counters = getCounters();
    expect(counters.maxInFlight).toBeGreaterThan(1);
    expect(counters.maxInFlight).toBeLessThanOrEqual(32);
  });
});

function buildPackExtractDir(skillName: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'skill-pack-extract-'));
  writeSkill(join(dir, 'skills'), skillName, skillName);
  return dir;
}

describe('listPackCatalog', () => {
  const commit = 'a'.repeat(40);

  beforeEach(() => {
    vi.mocked(readPackManifest).mockClear();
  });

  it('reuses the manifest for an unchanged extract dir', async () => {
    const dir = buildPackExtractDir('hello');
    vi.mocked(listPacks).mockResolvedValue([
      { id: 'demo', url: 'https://example.invalid/demo', ref: 'v1', commit, adapter: 'plain' },
    ]);
    vi.mocked(packExtractDir).mockReturnValue(dir);
    vi.mocked(packRenderDir).mockReturnValue(join(dir, 'render'));

    const first = await listPackCatalog();
    const second = await listPackCatalog();

    expect(readPackManifest).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    rmSync(dir, { recursive: true, force: true });
  });

  it('re-reads after the extract dir is rebuilt', async () => {
    const dir = buildPackExtractDir('hello');
    vi.mocked(listPacks).mockResolvedValue([
      { id: 'demo', url: 'https://example.invalid/demo', ref: 'v1', commit, adapter: 'plain' },
    ]);
    vi.mocked(packExtractDir).mockReturnValue(dir);
    vi.mocked(packRenderDir).mockReturnValue(join(dir, 'render'));

    await listPackCatalog();

    const rebuilt = buildPackExtractDir('goodbye');
    rmSync(dir, { recursive: true, force: true });
    renameSync(rebuilt, dir);

    const second = await listPackCatalog();

    expect(readPackManifest).toHaveBeenCalledTimes(2);
    expect(second[0]?.manifest?.skills.map((s) => s.name)).toEqual(['goodbye']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not cache a failed read', async () => {
    const dir = buildPackExtractDir('hello');
    vi.mocked(listPacks).mockResolvedValue([
      { id: 'demo', url: 'https://example.invalid/demo', ref: 'v1', commit, adapter: 'plain' },
    ]);
    vi.mocked(packExtractDir).mockReturnValue(dir);
    vi.mocked(packRenderDir).mockReturnValue(join(dir, 'render'));
    vi.mocked(readPackManifest).mockRejectedValueOnce(new Error('boom'));

    const first = await listPackCatalog();
    expect(first[0]?.manifest).toBeNull();

    await listPackCatalog();

    expect(readPackManifest).toHaveBeenCalledTimes(2);
    rmSync(dir, { recursive: true, force: true });
  });
});
