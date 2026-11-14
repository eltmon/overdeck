/**
 * PAN-5238 WI-1: listSkillCatalog reads its roots and per-skill SKILL.md files
 * concurrently through a bounded fs limiter, with output identical to the
 * sequential version — same entries, same origin, first-root-wins precedence,
 * sorted by name.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const { listSkillCatalog } = await import('../catalog.js');

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
