/**
 * PAN-4046: findProjectByPath containment. `~` expands on both sides,
 * symlinks resolve (paths that no longer exist still match lexically), a
 * sibling that only shares a name prefix is not contained, and the deepest
 * containing root wins over a parent project listed first.
 */
import { mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ root: '', home: '', overdeckHome: '', mtime: 1_000_000 }));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => fixture.home };
});

vi.mock('../paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../paths.js')>();
  const fs = await import('node:fs');
  const os = await vi.importActual<typeof import('node:os')>('node:os');
  const path = await import('node:path');
  fixture.root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'find-project-by-path-')));
  fixture.home = path.join(fixture.root, 'home');
  fixture.overdeckHome = path.join(fixture.root, 'overdeck');
  fs.mkdirSync(fixture.overdeckHome, { recursive: true });
  return { ...actual, OVERDECK_HOME: fixture.overdeckHome };
});

import { findProjectByPath } from '../projects.js';

/** `@` = the temp root, `~` stays literal so the code under test expands it. */
const at = (path: string) => (path.startsWith('@') ? join(fixture.root, path.slice(1)) : path);

function writeProjects(projects: Record<string, string>): void {
  const file = join(fixture.overdeckHome, 'projects.yaml');
  const entries = Object.fromEntries(Object.entries(projects).map(([key, path]) => [key, { name: key, path: at(path) }]));
  writeFileSync(file, stringifyYaml({ projects: entries }));
  // loadProjectsConfigSync caches by mtime; give every write a distinct one.
  fixture.mtime += 10;
  utimesSync(file, fixture.mtime, fixture.mtime);
}

interface Case {
  name: string;
  projects: Record<string, string>;
  target: string;
  expected: string | null;
}

const cases: Case[] = [
  { name: 'expands a ~ project root', projects: { overdeck: '~/Projects/overdeck' }, target: '@home/Projects/overdeck/workspaces/feature-pan-1', expected: 'overdeck' },
  { name: 'expands a ~ target path', projects: { overdeck: '@home/Projects/overdeck' }, target: '~/Projects/overdeck/workspaces/feature-pan-1', expected: 'overdeck' },
  { name: 'matches the project root itself', projects: { overdeck: '@home/Projects/overdeck' }, target: '@home/Projects/overdeck', expected: 'overdeck' },
  { name: 'rejects a sibling sharing the name prefix', projects: { overdeck: '@home/Projects/overdeck' }, target: '@home/Projects/overdeck-knowledge', expected: null },
  { name: 'rejects a sibling of a shorter-named project', projects: { fo: '@home/Projects/fo' }, target: '@home/Projects/foo', expected: null },
  { name: 'rejects a parent of the project root', projects: { overdeck: '@home/Projects/overdeck' }, target: '@home/Projects', expected: null },
  { name: 'resolves a symlinked target path', projects: { overdeck: '@home/Projects/overdeck' }, target: '@linked-workspace', expected: 'overdeck' },
  { name: 'resolves a symlinked project root', projects: { overdeck: '@overdeck-link' }, target: '@home/Projects/overdeck/workspaces', expected: 'overdeck' },
  { name: 'matches a deleted path by its lexical form', projects: { overdeck: '@home/Projects/overdeck' }, target: '@home/Projects/overdeck/workspaces/deleted/src', expected: 'overdeck' },
  { name: 'matches a deleted path under a symlinked root', projects: { overdeck: '@overdeck-link' }, target: '@home/Projects/overdeck/workspaces/gone', expected: 'overdeck' },
  { name: 'matches a deleted path reached through a symlink', projects: { overdeck: '@home/Projects/overdeck' }, target: '@overdeck-link/workspaces/gone/src', expected: 'overdeck' },
  { name: 'prefers the deepest root when the parent is listed first', projects: { outer: '@home/Projects', overdeck: '@home/Projects/overdeck' }, target: '@home/Projects/overdeck/workspaces', expected: 'overdeck' },
  { name: 'prefers the deepest root when the parent is listed last', projects: { overdeck: '@home/Projects/overdeck', outer: '@home/Projects' }, target: '@home/Projects/overdeck/workspaces', expected: 'overdeck' },
  { name: 'falls back to the parent outside the nested root', projects: { outer: '@home/Projects', overdeck: '@home/Projects/overdeck' }, target: '@home/Projects/overdeck-knowledge', expected: 'outer' },
  { name: 'contains everything under a filesystem-root project', projects: { everything: '/' }, target: '@home/Projects', expected: 'everything' },
  { name: 'returns null when no project contains the path', projects: { overdeck: '@home/Projects/overdeck' }, target: '@elsewhere', expected: null },
];

describe('findProjectByPath (PAN-4046)', () => {
  beforeAll(() => {
    mkdirSync(join(fixture.home, 'Projects', 'overdeck', 'workspaces', 'feature-pan-1'), { recursive: true });
    mkdirSync(join(fixture.home, 'Projects', 'overdeck-knowledge'), { recursive: true });
    mkdirSync(join(fixture.home, 'Projects', 'foo'), { recursive: true });
    mkdirSync(join(fixture.root, 'elsewhere'), { recursive: true });
    symlinkSync(join(fixture.home, 'Projects', 'overdeck', 'workspaces', 'feature-pan-1'), join(fixture.root, 'linked-workspace'));
    symlinkSync(join(fixture.home, 'Projects', 'overdeck'), join(fixture.root, 'overdeck-link'));
  });

  afterAll(() => {
    rmSync(fixture.root, { recursive: true, force: true });
  });

  it.each(cases)('$name', ({ projects, target, expected }) => {
    writeProjects(projects);
    expect(findProjectByPath(at(target))?.name ?? null).toBe(expected);
  });
});
