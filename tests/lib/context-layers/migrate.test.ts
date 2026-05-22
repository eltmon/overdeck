/**
 * One-shot devroot migration (PAN-1201).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { migrateDevroot } from '../../../src/lib/context-layers/migrate.js';
import { globalContextFile, globalSkillsDir } from '../../../src/lib/context-layers/layers.js';

describe('migrateDevroot', () => {
  let home: string;
  let oldClaudeDir: string;
  let projectsRoot: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-migrate-'));
    prevHome = process.env.PANOPTICON_HOME;
    process.env.PANOPTICON_HOME = join(home, '.panopticon');
    projectsRoot = join(home, 'Projects');
    oldClaudeDir = join(projectsRoot, '.claude');
    mkdirSync(join(oldClaudeDir, 'skills', 'demo-skill'), { recursive: true });
    writeFileSync(join(oldClaudeDir, 'CLAUDE.md'), 'old global content');
    writeFileSync(join(oldClaudeDir, 'skills', 'demo-skill', 'SKILL.md'), 'demo skill body');
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.PANOPTICON_HOME;
    else process.env.PANOPTICON_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('copies CLAUDE.md to global.md and skills into the global layer', () => {
    const result = migrateDevroot({ oldClaudeDir, projectsRoot });
    expect(result.detected).toBe(true);
    expect(existsSync(globalContextFile())).toBe(true);
    expect(readFileSync(globalContextFile(), 'utf-8')).toBe('old global content');
    expect(existsSync(join(globalSkillsDir(), 'demo-skill', 'SKILL.md'))).toBe(true);
  });

  it('never overwrites an existing target — idempotent on re-run', () => {
    migrateDevroot({ oldClaudeDir, projectsRoot });
    writeFileSync(globalContextFile(), 'edited by the user');

    const second = migrateDevroot({ oldClaudeDir, projectsRoot });
    expect(readFileSync(globalContextFile(), 'utf-8')).toBe('edited by the user');
    expect(second.skipped.some((s) => s.includes('global.md'))).toBe(true);
  });

  it('never deletes the source devroot content', () => {
    migrateDevroot({ oldClaudeDir, projectsRoot });
    expect(existsSync(join(oldClaudeDir, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(oldClaudeDir, 'skills', 'demo-skill', 'SKILL.md'))).toBe(true);
  });

  it('reports detected=false when there is no legacy devroot', () => {
    const result = migrateDevroot({ oldClaudeDir: join(home, 'nonexistent'), projectsRoot });
    expect(result.detected).toBe(false);
    expect(result.copied).toHaveLength(0);
  });
});
