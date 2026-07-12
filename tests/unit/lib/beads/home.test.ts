import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectCanonicalBeadsSplitBrain, resolveCanonicalBeadsHome } from '../../../../src/lib/beads/home.js';
import type { ProjectConfig } from '../../../../src/lib/projects.js';

describe('canonical beads home', () => {
  let root: string;
  let prior: string | undefined;
  let project: ProjectConfig;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'beads-home-'));
    prior = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(root, 'overdeck-home');
    project = { name: 'Example', path: join(root, 'project') };
    mkdirSync(project.path, { recursive: true });
  });

  afterEach(() => {
    if (prior === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = prior;
    rmSync(root, { recursive: true, force: true });
  });

  function markMigrated(): string {
    const state = join(process.env.OVERDECK_HOME!, 'state', 'project');
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, 'migration-complete.json'), JSON.stringify({
      version: 1,
      sourceMainSha: 'a'.repeat(40),
      stateBranchSha: 'b'.repeat(40),
      completedAt: '2026-07-12T00:00:00.000Z',
    }));
    return state;
  }

  it('resolves main, state, and feature paths to one migrated home', () => {
    const state = markMigrated();
    const expected = join(state, '.beads');
    expect(resolveCanonicalBeadsHome(project.path, project)).toBe(expected);
    expect(resolveCanonicalBeadsHome(state, project)).toBe(expected);
    expect(resolveCanonicalBeadsHome(join(project.path, 'workspaces', 'feature-pan-1'), project)).toBe(expected);
  });

  it('keeps the legacy project home before migration', () => {
    expect(resolveCanonicalBeadsHome(project.path, project)).toBe(join(project.path, '.beads'));
  });

  it('blocks two populated homes with the same project id', () => {
    const state = markMigrated();
    for (const beads of [join(project.path, '.beads'), join(state, '.beads')]) {
      mkdirSync(join(beads, 'embeddeddolt'), { recursive: true });
      writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ project_id: 'shared-id' }));
    }
    expect(detectCanonicalBeadsSplitBrain(project)).toEqual({
      projectId: 'shared-id',
      paths: [join(project.path, '.beads'), join(state, '.beads')],
    });
  });
});
