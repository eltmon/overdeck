import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mockListProjectsSync = vi.hoisted(() => vi.fn(() => [] as Array<{ key: string; config: { path: string } }>));

vi.mock('../../../../src/lib/projects.js', () => ({
  listProjectsSync: mockListProjectsSync,
}));

import {
  clearClosedIssueWorkspaceCache,
  collectClosedIssueWorkspaces,
} from '../../../../src/lib/workspaces/closed-issue-workspaces.js';

describe('collectClosedIssueWorkspaces', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'closed-issue-workspaces-test-'));
    const workspacesDir = join(projectPath, 'workspaces');
    mkdirSync(join(workspacesDir, 'feature-pan-1'), { recursive: true });
    mkdirSync(join(workspacesDir, 'feature-pan-1-strike'), { recursive: true });
    mkdirSync(join(workspacesDir, 'feature-pan-2'), { recursive: true });
    clearClosedIssueWorkspaceCache();
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
    clearClosedIssueWorkspaceCache();
  });

  const listProjects = () => [{ key: 'proj', config: { path: projectPath } }];

  it('counts only closed issues, sums known sizes across all shapes, and marks unknown sizes', async () => {
    const report = await collectClosedIssueWorkspaces({
      listProjects,
      isClosed: async (issueId) => issueId === 'PAN-1',
      dirSize: async () => 100,
      isTrackerPaused: () => false,
      now: () => new Date('2026-09-28T00:00:00.000Z'),
    });

    expect(report.closedCount).toBe(1);
    expect(report.totalBytes).toBe(200);
    expect(report.unknownSizeCount).toBe(0);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.issueId).toBe('PAN-1');
    expect(report.rows[0]?.paths).toHaveLength(2);
  });

  it('marks a row unknown-size when any of its paths has an unknown size', async () => {
    const report = await collectClosedIssueWorkspaces({
      listProjects,
      isClosed: async (issueId) => issueId === 'PAN-1',
      dirSize: async (path) => (path.endsWith('-strike') ? null : 100),
      isTrackerPaused: () => false,
      now: () => new Date(),
    });

    expect(report.unknownSizeCount).toBe(1);
    expect(report.rows[0]?.sizeBytes).toBeNull();
  });

  it('reports trackerReadsPaused from isTrackerPaused', async () => {
    const report = await collectClosedIssueWorkspaces({
      listProjects,
      isClosed: async () => false,
      dirSize: async () => 0,
      isTrackerPaused: () => true,
      now: () => new Date(),
    });

    expect(report.trackerReadsPaused).toBe(true);
    expect(report.closedCount).toBe(0);
  });

  it('marks polyrepo project rows', async () => {
    const report = await collectClosedIssueWorkspaces({
      listProjects: () => [{ key: 'proj', config: { path: projectPath, workspace: { type: 'polyrepo' } } }],
      isClosed: async (issueId) => issueId === 'PAN-1',
      dirSize: async () => 100,
      isTrackerPaused: () => false,
      now: () => new Date(),
    });

    expect(report.rows[0]?.polyrepo).toBe(true);
  });

  it('caches the default-deps report for 60s and clearClosedIssueWorkspaceCache forces recomputation', async () => {
    mockListProjectsSync.mockClear();

    const first = await collectClosedIssueWorkspaces();
    const second = await collectClosedIssueWorkspaces();
    expect(second).toBe(first);
    expect(mockListProjectsSync).toHaveBeenCalledTimes(1);

    clearClosedIssueWorkspaceCache();
    const third = await collectClosedIssueWorkspaces();
    expect(third).not.toBe(first);
    expect(mockListProjectsSync).toHaveBeenCalledTimes(2);
  });
});
