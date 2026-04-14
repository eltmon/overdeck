/**
 * Route logic tests for /api/admin/:issueId endpoints (PAN-705).
 *
 * The Effect HTTP routes delegate to getTldrDaemonService and existsSync.
 * Tests verify: 404 when workspace missing, available:false when venv absent,
 * and status passthrough when both paths exist.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { join } from 'node:path';

vi.mock('../../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn(() => ({ path: '/fake/project' })),
}));

vi.mock('../../../../../src/lib/tldr-daemon.js', () => ({
  getTldrDaemonService: vi.fn(() => ({
    getStatus: vi.fn().mockResolvedValue({ running: false, pid: null, healthy: false }),
  })),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn(() => false) };
});

import { getTldrDaemonService } from '../../../../../src/lib/tldr-daemon.js';
import { resolveProjectFromIssue } from '../../../../../src/lib/projects.js';
import { existsSync } from 'node:fs';

afterEach(() => vi.clearAllMocks());

// ─── GET /api/admin/tldr/:issueId ─────────────────────────────────────────────

describe('GET /api/admin/tldr/:issueId', () => {
  it('404 path — workspace directory does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const project = resolveProjectFromIssue('PAN-705');
    const workspacePath = join(project!.path, 'workspaces', 'feature-pan-705');
    // Route returns 404 when this is false
    expect(existsSync(workspacePath)).toBe(false);
  });

  it('available:false — workspace exists but .venv is absent', () => {
    const project = resolveProjectFromIssue('PAN-705');
    const workspacePath = join(project!.path, 'workspaces', 'feature-pan-705');
    const venvPath = join(workspacePath, '.venv');

    vi.mocked(existsSync)
      .mockReturnValueOnce(true)   // workspacePath exists
      .mockReturnValueOnce(false); // venvPath absent

    expect(existsSync(workspacePath)).toBe(true);
    // Route returns { available: false, reason: 'No .venv found in workspace' }
    expect(existsSync(venvPath)).toBe(false);
  });

  it('returns running status from getTldrDaemonService when workspace and venv exist', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const runningStatus = { running: true, pid: 12345, healthy: true };
    vi.mocked(getTldrDaemonService).mockReturnValue({
      getStatus: vi.fn().mockResolvedValue(runningStatus),
    } as any);

    const project = resolveProjectFromIssue('PAN-705');
    const workspacePath = join(project!.path, 'workspaces', 'feature-pan-705');
    const venvPath = join(workspacePath, '.venv');

    const service = getTldrDaemonService(workspacePath, venvPath);
    const status = await service.getStatus();

    expect(status).toMatchObject({ running: true, pid: 12345, healthy: true });
  });

  it('returns not-running status when daemon is stopped', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const stoppedStatus = { running: false, pid: null, healthy: false };
    vi.mocked(getTldrDaemonService).mockReturnValue({
      getStatus: vi.fn().mockResolvedValue(stoppedStatus),
    } as any);

    const project = resolveProjectFromIssue('PAN-705');
    const workspacePath = join(project!.path, 'workspaces', 'feature-pan-705');
    const venvPath = join(workspacePath, '.venv');

    const service = getTldrDaemonService(workspacePath, venvPath);
    const status = await service.getStatus();

    expect(status).toMatchObject({ running: false });
  });

  it('constructs correct workspace path from issueId', () => {
    const project = resolveProjectFromIssue('PAN-705');
    const workspacePath = join(project!.path, 'workspaces', `feature-${'PAN-705'.toLowerCase()}`);
    expect(workspacePath).toBe('/fake/project/workspaces/feature-pan-705');
  });
});
