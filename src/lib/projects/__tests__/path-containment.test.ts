/**
 * findContainingProject / findContainingProjectAsync agree on every
 * containment case: `~` expansion, symlinks, sibling name prefixes, deepest
 * root, deleted paths. The async variant backs resolveProjectKeyForCwdAsync.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ home: '' }));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => fixture.home };
});

import { canonicalPath, canonicalPathAsync, findContainingProject, findContainingProjectAsync } from '../path-containment.js';

type Projects = Record<string, { path?: string }>;
interface Case {
  name: string;
  projects: (dirs: Dirs) => Projects;
  target: (dirs: Dirs) => string;
  expected: string | null;
}
interface Dirs { root: string; home: string; overdeck: string; workspace: string }

const CASES: Case[] = [
  {
    name: 'expands a ~ project root',
    projects: () => ({ overdeck: { path: '~/Projects/overdeck' } }),
    target: d => d.workspace,
    expected: 'overdeck',
  },
  {
    name: 'expands a ~ target path',
    projects: d => ({ overdeck: { path: d.overdeck } }),
    target: () => '~/Projects/overdeck/workspaces/feature-pan-1',
    expected: 'overdeck',
  },
  {
    name: 'matches the project root itself',
    projects: () => ({ overdeck: { path: '~/Projects/overdeck' } }),
    target: d => d.overdeck,
    expected: 'overdeck',
  },
  {
    name: 'rejects a sibling sharing the name prefix',
    projects: () => ({ overdeck: { path: '~/Projects/overdeck' } }),
    target: d => join(d.home, 'Projects', 'overdeck-knowledge'),
    expected: null,
  },
  {
    name: 'resolves a symlinked target to its real project',
    projects: () => ({ overdeck: { path: '~/Projects/overdeck' } }),
    target: d => join(d.root, 'linked-workspace'),
    expected: 'overdeck',
  },
  {
    name: 'resolves a symlinked project root',
    projects: d => ({ overdeck: { path: join(d.root, 'overdeck-link') } }),
    target: d => join(d.overdeck, 'workspaces'),
    expected: 'overdeck',
  },
  {
    name: 'prefers the deepest containing root',
    projects: () => ({ outer: { path: '~/Projects' }, overdeck: { path: '~/Projects/overdeck' } }),
    target: d => join(d.overdeck, 'workspaces'),
    expected: 'overdeck',
  },
  {
    name: 'falls back to the outer root for a sibling',
    projects: () => ({ outer: { path: '~/Projects' }, overdeck: { path: '~/Projects/overdeck' } }),
    target: d => join(d.home, 'Projects', 'overdeck-knowledge'),
    expected: 'outer',
  },
  {
    name: 'contains everything under a filesystem-root project',
    projects: () => ({ everything: { path: '/' } }),
    target: d => join(d.home, 'Projects'),
    expected: 'everything',
  },
  {
    name: 'matches a deleted path by its lexical form',
    projects: () => ({ overdeck: { path: '~/Projects/overdeck' } }),
    target: d => join(d.overdeck, 'workspaces', 'deleted', 'src'),
    expected: 'overdeck',
  },
  {
    name: 'skips entries without a path',
    projects: () => ({ pathless: {}, overdeck: { path: '~/Projects/overdeck' } }),
    target: d => d.workspace,
    expected: 'overdeck',
  },
  {
    name: 'returns null outside every root',
    projects: () => ({ overdeck: { path: '~/Projects/overdeck' } }),
    target: d => join(d.root, 'elsewhere'),
    expected: null,
  },
];

describe('project path containment', () => {
  let dirs: Dirs;

  beforeEach(() => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'path-containment-')));
    const home = join(root, 'home');
    const overdeck = join(home, 'Projects', 'overdeck');
    const workspace = join(overdeck, 'workspaces', 'feature-pan-1');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(home, 'Projects', 'overdeck-knowledge'), { recursive: true });
    symlinkSync(workspace, join(root, 'linked-workspace'));
    symlinkSync(overdeck, join(root, 'overdeck-link'));
    fixture.home = home;
    dirs = { root, home, overdeck, workspace };
  });

  afterEach(() => {
    rmSync(dirs.root, { recursive: true, force: true });
  });

  it.each(CASES)('$name', async ({ projects, target, expected }) => {
    const table = projects(dirs);
    const path = target(dirs);
    expect(findContainingProject(table, path)?.[0] ?? null).toBe(expected);
    expect((await findContainingProjectAsync(table, path))?.[0] ?? null).toBe(expected);
  });

  it('canonicalPathAsync matches canonicalPath', async () => {
    for (const path of ['~', '~/Projects/overdeck', join(dirs.root, 'linked-workspace'), join(dirs.overdeck, 'gone', 'deeper')]) {
      await expect(canonicalPathAsync(path)).resolves.toBe(canonicalPath(path));
    }
  });
});
