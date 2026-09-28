/**
 * PAN-4264 Work Item 21: a project with no resolvable tracker is skipped by
 * every membership refresh — no gather, no failure warning, one log line per
 * projects.yaml mtime — and listed for pan doctor github-quota.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readPipelineMembershipSnapshotsForProjects,
  refreshMembershipSnapshotsForProjects,
} from '../../../../../src/dashboard/server/services/pipeline-membership.js';
import { readSkippedProjects, resetSkippedProjectsForTests } from '../../../../../src/lib/github-quota/skipped-projects.js';
import type { ProjectConfig } from '../../../../../src/lib/projects.js';

const unresolvable: ProjectConfig = { name: 'papers-please', path: '/projects/papers-please' };
const resolvable: ProjectConfig = { name: 'overdeck', path: '/projects/overdeck', github_repo: 'eltmon/overdeck', issue_prefix: 'PAN' };

function membershipLookup() {
  const lookup = vi.fn(async () => []) as unknown as ((project: ProjectConfig) => Promise<never[]>) & { invalidate: ReturnType<typeof vi.fn> };
  lookup.invalidate = vi.fn();
  return lookup;
}

describe('membership refresh skips projects with no tracker (PAN-4264)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-skip-projects-'));
    process.env.OVERDECK_HOME = home;
    resetSkippedProjectsForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('never gathers, never warns, and logs once across two refresh cycles', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const lookup = membershipLookup();

    await expect(refreshMembershipSnapshotsForProjects([unresolvable, resolvable], lookup)).resolves.toBeUndefined();
    await expect(refreshMembershipSnapshotsForProjects([unresolvable, resolvable], lookup)).resolves.toBeUndefined();

    expect(lookup).toHaveBeenCalledTimes(2);
    expect((lookup as unknown as ReturnType<typeof vi.fn>).mock.calls.every(([project]) => project === resolvable)).toBe(true);
    const skipLines = log.mock.calls.filter(([line]) => String(line).includes('skipping membership for papers-please'));
    expect(skipLines).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();

    const [result] = readPipelineMembershipSnapshotsForProjects([unresolvable]);
    expect(result?.unavailableReason).toBe('tracker_unconfigured');
  });

  it('logs the skip again once after projects.yaml changes', async () => {
    const { utimesSync, writeFileSync } = await import('node:fs');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const projectsYaml = join(home, 'projects.yaml');
    writeFileSync(projectsYaml, 'projects: {}\n');
    utimesSync(projectsYaml, 1_000, 1_000);
    const skipLines = () => log.mock.calls.filter(([line]) => String(line).includes('skipping membership for papers-please')).length;

    await refreshMembershipSnapshotsForProjects([unresolvable], membershipLookup());
    await refreshMembershipSnapshotsForProjects([unresolvable], membershipLookup());
    expect(skipLines()).toBe(1);

    utimesSync(projectsYaml, 2_000, 2_000);
    await refreshMembershipSnapshotsForProjects([unresolvable], membershipLookup());
    await refreshMembershipSnapshotsForProjects([unresolvable], membershipLookup());
    expect(skipLines()).toBe(2);
  });

  it('writes the skipped list for pan doctor github-quota', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await refreshMembershipSnapshotsForProjects([unresolvable], membershipLookup());
    await vi.waitFor(() => {
      expect(readSkippedProjects()).toEqual([{ name: 'papers-please', path: '/projects/papers-please' }]);
    });
  });
});
