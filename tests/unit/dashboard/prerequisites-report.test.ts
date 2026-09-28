/**
 * Unit tests for buildPrerequisitesReport (PAN-4282 item C, D4/D5/D6).
 * Every dependency is injected so the test never shells out to `gh`, reads
 * Claude credentials, or touches the live health sampler.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildPrerequisitesReport,
  type PrerequisitesReportDeps,
} from '../../../src/dashboard/server/routes/misc/prerequisites-report.js';
import type { PrerequisitesReport } from '../../../src/lib/system-prerequisites.js';

const GIB = 2 ** 30;

function catalogReport(tmuxFound = true): PrerequisitesReport {
  return {
    platform: 'linux',
    allRequiredFound: true,
    checks: [
      { id: 'tmux', name: 'tmux', required: false, purpose: 'p', install: { linux: '', mac: '', win: '' }, found: tmuxFound, version: tmuxFound ? '3.3' : null },
      { id: 'git', name: 'git', required: true, purpose: 'p', install: { linux: '', mac: '', win: '' }, found: true, version: '2.40' },
    ],
  };
}

function makeDeps(overrides: Partial<PrerequisitesReportDeps> = {}): PrerequisitesReportDeps {
  return {
    checkPrerequisites: vi.fn().mockResolvedValue(catalogReport()),
    checkClaudeLogin: vi.fn().mockResolvedValue({ ok: true, detail: 'Signed in (max)' }),
    checkGhLogin: vi.fn().mockResolvedValue({ installed: true, ok: true }),
    checkHostBackend: vi.fn().mockResolvedValue({ name: 'herdr', available: true, reason: null }),
    getHealth: vi.fn().mockResolvedValue({
      freshness: { status: 'fresh', observedAt: new Date().toISOString() },
      summary: { availableMemoryBytes: 8 * GIB },
      thresholds: { memoryAvailableWarningBytes: 4 * GIB },
    } as any),
    ...overrides,
  };
}

describe('buildPrerequisitesReport', () => {
  it('reports memory as not low when well above the warning threshold', async () => {
    const deps = makeDeps();
    const report = await buildPrerequisitesReport({ refresh: false }, deps);
    expect(report.memory).toEqual({ availableGb: 8, warnGb: 4, low: false });
  });

  it('reports memory as low at 3 GiB against a 4 GiB warning threshold', async () => {
    const deps = makeDeps({
      getHealth: vi.fn().mockResolvedValue({
        freshness: { status: 'fresh', observedAt: new Date().toISOString() },
        summary: { availableMemoryBytes: 3 * GIB },
        thresholds: { memoryAvailableWarningBytes: 4 * GIB },
      } as any),
    });
    const report = await buildPrerequisitesReport({ refresh: false }, deps);
    expect(report.memory).toEqual({ availableGb: 3, warnGb: 4, low: true });
  });

  it('is null while the health sampler is still measuring', async () => {
    const deps = makeDeps({
      getHealth: vi.fn().mockResolvedValue({
        freshness: { status: 'measuring', observedAt: new Date().toISOString() },
        summary: { availableMemoryBytes: 8 * GIB },
        thresholds: { memoryAvailableWarningBytes: 4 * GIB },
      } as any),
    });
    const report = await buildPrerequisitesReport({ refresh: false }, deps);
    expect(report.memory).toBeNull();
  });

  it('is null and leaves the rest of the report intact when the health getter throws', async () => {
    const deps = makeDeps({ getHealth: vi.fn().mockRejectedValue(new Error('sampler down')) });
    const report = await buildPrerequisitesReport({ refresh: false }, deps);
    expect(report.memory).toBeNull();
    expect(report.auth.claude.ok).toBe(true);
    expect(report.backend.name).toBe('herdr');
    expect(report.checks).toHaveLength(2);
  });

  it('passes force:true to every first-run check when refresh is true, force:false otherwise', async () => {
    const deps = makeDeps();
    await buildPrerequisitesReport({ refresh: true }, deps);
    expect(deps.checkClaudeLogin).toHaveBeenCalledWith({ force: true });
    expect(deps.checkGhLogin).toHaveBeenCalledWith({ force: true });
    expect(deps.checkHostBackend).toHaveBeenCalledWith({ force: true, tmuxFound: true });

    await buildPrerequisitesReport({ refresh: false }, deps);
    expect(deps.checkClaudeLogin).toHaveBeenCalledWith({ force: false });
    expect(deps.checkGhLogin).toHaveBeenCalledWith({ force: false });
    expect(deps.checkHostBackend).toHaveBeenCalledWith({ force: false, tmuxFound: true });
  });

  it('copies auth and backend straight from the injected deps', async () => {
    const deps = makeDeps({
      checkClaudeLogin: vi.fn().mockResolvedValue({ ok: false, detail: 'Not signed in' }),
      checkGhLogin: vi.fn().mockResolvedValue({ installed: false, ok: false }),
      checkHostBackend: vi.fn().mockResolvedValue({ name: 'tmux', available: false, reason: 'tmux is not installed.' }),
    });
    const report = await buildPrerequisitesReport({ refresh: false }, deps);
    expect(report.auth).toEqual({
      claude: { ok: false, detail: 'Not signed in' },
      gh: { installed: false, ok: false },
    });
    expect(report.backend).toEqual({ name: 'tmux', available: false, reason: 'tmux is not installed.' });
  });

  it('passes the tmux check found flag through as tmuxFound', async () => {
    const deps = makeDeps({ checkPrerequisites: vi.fn().mockResolvedValue(catalogReport(false)) });
    await buildPrerequisitesReport({ refresh: false }, deps);
    expect(deps.checkHostBackend).toHaveBeenCalledWith({ force: false, tmuxFound: false });
  });
});
