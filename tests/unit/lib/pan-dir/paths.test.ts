/**
 * PAN-3917 W1: `getProjectPanPaths` is unconditional — `<planHome>/.pan/`, with
 * no state worktree, no migration marker, and no `migrated` branch.
 */
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/projects.js')>();
  return { ...actual, findProjectByPathSync: (path: string) => findProject(path) };
});

type ProjectConfig = import('../../../../src/lib/projects.js').ProjectConfig;

let findProject: (path: string) => ProjectConfig | null = () => null;

const { getProjectPanPaths, resolvePlanHome } = await import('../../../../src/lib/pan-dir/paths.js');

afterEach(() => {
  findProject = () => null;
});

describe('resolvePlanHome (PAN-3917)', () => {
  it('is the project root itself for an unregistered path', () => {
    expect(resolvePlanHome('/repos/whatever')).toBe('/repos/whatever');
  });

  it('is the project root when the project sets no pan_records.repo', () => {
    findProject = () => ({ name: 'Overdeck', path: '/repos/overdeck' });
    expect(resolvePlanHome('/repos/overdeck')).toBe('/repos/overdeck');
  });

  it('is the pan_records.repo checkout for a polyrepo project', () => {
    findProject = () => ({
      name: 'Mind Your Now',
      path: '/repos/myn',
      pan_records: { repo: 'infra' },
      workspace: { repos: [{ name: 'infra', path: 'infra' }, { name: 'api', path: 'api' }] },
    } as ProjectConfig);
    expect(resolvePlanHome('/repos/myn')).toBe('/repos/myn/infra');
  });

  it('resolves the plan-home sub-repo relative to the root it is given', () => {
    // An agent working in a worktree must write — and commit — the plan inside
    // that worktree, not in the main checkout.
    findProject = () => ({
      name: 'Mind Your Now',
      path: '/repos/myn',
      pan_records: { repo: 'infra' },
      workspace: { repos: [{ name: 'infra', path: 'infra' }] },
    } as ProjectConfig);
    expect(resolvePlanHome('/repos/myn/workspaces/feature-min-1')).toBe(
      '/repos/myn/workspaces/feature-min-1/infra',
    );
  });
});

describe('getProjectPanPaths (PAN-3917)', () => {
  it('returns <projectRoot>/.pan unconditionally', () => {
    const paths = getProjectPanPaths('/repos/overdeck');
    expect(paths).toEqual({
      panDir: '/repos/overdeck/.pan',
      specsDir: join('/repos/overdeck/.pan', 'specs'),
      draftsDir: join('/repos/overdeck/.pan', 'drafts'),
      continuesDir: join('/repos/overdeck/.pan', 'continues'),
    });
  });

  it('roots every subdirectory in the pan_records.repo plan home', () => {
    findProject = () => ({
      name: 'Mind Your Now',
      path: '/repos/myn',
      pan_records: { repo: 'infra' },
      workspace: { repos: [{ name: 'infra', path: 'infra' }] },
    } as ProjectConfig);
    const paths = getProjectPanPaths('/repos/myn');
    expect(paths.panDir).toBe('/repos/myn/infra/.pan');
    expect(paths.specsDir).toBe('/repos/myn/infra/.pan/specs');
    expect(paths.continuesDir).toBe('/repos/myn/infra/.pan/continues');
  });

  it('never points at an overdeck state worktree', () => {
    process.env.OVERDECK_HOME = '/tmp/overdeck-home-should-not-matter';
    expect(getProjectPanPaths('/repos/overdeck').panDir).not.toContain('state');
  });
});
