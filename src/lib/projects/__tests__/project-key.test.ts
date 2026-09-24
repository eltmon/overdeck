/**
 * findProjectKeyByPathSync containment (CodeRabbit follow-up on #4022): `~`
 * roots expand, symlinked paths resolve to their real location, and a sibling
 * that only shares a name prefix is not contained.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  home: '',
  projects: {} as Record<string, { name: string; path: string }>,
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => fixture.home };
});

vi.mock('../../projects.js', () => ({
  loadProjectsConfigSync: () => ({ projects: fixture.projects }),
}));

import { findProjectKeyByPath } from '../project-key.js';

describe('findProjectKeyByPathSync', () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'project-key-')));
    fixture.home = join(root, 'home');
    mkdirSync(join(fixture.home, 'Projects', 'overdeck', 'workspaces', 'feature-pan-1'), { recursive: true });
    mkdirSync(join(fixture.home, 'Projects', 'overdeck-knowledge'), { recursive: true });
    fixture.projects = {};
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('expands a ~ project root before matching', () => {
    fixture.projects = { overdeck: { name: 'Overdeck', path: '~/Projects/overdeck' } };
    const workspace = join(fixture.home, 'Projects', 'overdeck', 'workspaces', 'feature-pan-1');
    expect(findProjectKeyByPath(workspace)).toBe('overdeck');
  });

  it('expands a ~ target path', () => {
    fixture.projects = { overdeck: { name: 'Overdeck', path: join(fixture.home, 'Projects', 'overdeck') } };
    expect(findProjectKeyByPath('~/Projects/overdeck/workspaces/feature-pan-1')).toBe('overdeck');
  });

  it('matches the project root itself', () => {
    fixture.projects = { overdeck: { name: 'Overdeck', path: '~/Projects/overdeck' } };
    expect(findProjectKeyByPath(join(fixture.home, 'Projects', 'overdeck'))).toBe('overdeck');
  });

  it('does not treat a sibling sharing the name prefix as contained', () => {
    fixture.projects = { overdeck: { name: 'Overdeck', path: '~/Projects/overdeck' } };
    expect(findProjectKeyByPath(join(fixture.home, 'Projects', 'overdeck-knowledge'))).toBeNull();
  });

  it('resolves a symlinked path to the project it really lives in', () => {
    fixture.projects = { overdeck: { name: 'Overdeck', path: '~/Projects/overdeck' } };
    const link = join(root, 'linked-workspace');
    symlinkSync(join(fixture.home, 'Projects', 'overdeck', 'workspaces', 'feature-pan-1'), link);
    expect(findProjectKeyByPath(link)).toBe('overdeck');
  });

  it('resolves a symlinked project root', () => {
    const linkedRoot = join(root, 'overdeck-link');
    symlinkSync(join(fixture.home, 'Projects', 'overdeck'), linkedRoot);
    fixture.projects = { overdeck: { name: 'Overdeck', path: linkedRoot } };
    expect(findProjectKeyByPath(join(fixture.home, 'Projects', 'overdeck', 'workspaces'))).toBe('overdeck');
  });

  it('prefers the deepest containing root', () => {
    fixture.projects = {
      outer: { name: 'Outer', path: '~/Projects' },
      overdeck: { name: 'Overdeck', path: '~/Projects/overdeck' },
    };
    expect(findProjectKeyByPath(join(fixture.home, 'Projects', 'overdeck', 'workspaces'))).toBe('overdeck');
    expect(findProjectKeyByPath(join(fixture.home, 'Projects', 'overdeck-knowledge'))).toBe('outer');
  });

  it('contains everything under a filesystem-root project', () => {
    fixture.projects = { everything: { name: 'Everything', path: '/' } };
    expect(findProjectKeyByPath(join(fixture.home, 'Projects'))).toBe('everything');
  });

  it('matches a path that no longer exists by its lexical form', () => {
    fixture.projects = { overdeck: { name: 'Overdeck', path: '~/Projects/overdeck' } };
    expect(findProjectKeyByPath(join(fixture.home, 'Projects', 'overdeck', 'workspaces', 'deleted'))).toBe('overdeck');
  });

  it('matches a deleted path under a symlinked root', () => {
    // ~/Projects is a symlink to the real checkout directory; the workspace was deleted.
    const realProjects = join(root, 'real-projects');
    mkdirSync(join(realProjects, 'overdeck', 'workspaces'), { recursive: true });
    const linkedHome = join(root, 'linked-home');
    mkdirSync(linkedHome);
    symlinkSync(realProjects, join(linkedHome, 'Projects'));
    fixture.home = linkedHome;
    fixture.projects = { overdeck: { name: 'Overdeck', path: '~/Projects/overdeck' } };

    expect(findProjectKeyByPath('~/Projects/overdeck/workspaces/feature-gone/src')).toBe('overdeck');
    expect(findProjectKeyByPath(join(realProjects, 'overdeck', 'workspaces', 'feature-gone'))).toBe('overdeck');
    expect(findProjectKeyByPath(join(linkedHome, 'Projects', 'overdeck-gone'))).toBeNull();
  });

  it('returns null for an empty path', () => {
    expect(findProjectKeyByPath('')).toBeNull();
  });
});
