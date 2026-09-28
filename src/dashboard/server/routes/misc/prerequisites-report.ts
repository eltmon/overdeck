/**
 * Composes GET /api/prerequisites (PAN-4282 D4, D5, D6): the host-tool
 * catalog report (PAN-774) plus first-run auth/backend/memory checks. Deps
 * are injectable so tests never shell out to `gh`, read Claude credentials,
 * or touch the live health sampler.
 */

import {
  checkSystemPrerequisites,
  type PrerequisitesReport,
} from '../../../../lib/system-prerequisites.js';
import {
  checkClaudeLogin,
  checkGhLogin,
  checkHostBackend,
  type ClaudeLoginCheck,
  type GhLoginCheck,
  type HostBackendCheck,
} from '../../../../lib/first-run-checks.js';
import type { SystemHealthSnapshot } from '../../services/system-health-service.js';

export interface MemoryReport {
  readonly availableGb: number;
  readonly warnGb: number;
  readonly low: boolean;
}

export interface PrerequisitesReportWithFirstRun extends PrerequisitesReport {
  readonly auth: {
    readonly claude: ClaudeLoginCheck;
    readonly gh: GhLoginCheck;
  };
  readonly backend: HostBackendCheck;
  readonly memory: MemoryReport | null;
}

export interface PrerequisitesReportDeps {
  readonly checkPrerequisites: typeof checkSystemPrerequisites;
  readonly checkClaudeLogin: typeof checkClaudeLogin;
  readonly checkGhLogin: typeof checkGhLogin;
  readonly checkHostBackend: typeof checkHostBackend;
  readonly getHealth: () => Promise<SystemHealthSnapshot>;
}

async function defaultGetHealth(): Promise<SystemHealthSnapshot> {
  const { getSystemHealthSnapshot } = await import('../../services/system-health-service.js');
  return getSystemHealthSnapshot();
}

const defaultDeps: PrerequisitesReportDeps = {
  checkPrerequisites: checkSystemPrerequisites,
  checkClaudeLogin,
  checkGhLogin,
  checkHostBackend,
  getHealth: defaultGetHealth,
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

async function buildMemoryReport(deps: PrerequisitesReportDeps): Promise<MemoryReport | null> {
  try {
    const health = await deps.getHealth();
    if (health.freshness.status !== 'fresh') return null;
    const availableGb = round1(health.summary.availableMemoryBytes / 2 ** 30);
    const warnGb = round1(health.thresholds.memoryAvailableWarningBytes / 2 ** 30);
    return {
      availableGb,
      warnGb,
      low: health.summary.availableMemoryBytes <= health.thresholds.memoryAvailableWarningBytes,
    };
  } catch {
    return null;
  }
}

export async function buildPrerequisitesReport(
  options: { readonly refresh: boolean },
  deps: PrerequisitesReportDeps = defaultDeps,
): Promise<PrerequisitesReportWithFirstRun> {
  const force = options.refresh;
  const catalogReport = await deps.checkPrerequisites();
  const tmuxFound = catalogReport.checks.find((check) => check.id === 'tmux')?.found ?? false;

  const [claude, gh, backend, memory] = await Promise.all([
    deps.checkClaudeLogin({ force }),
    deps.checkGhLogin({ force }),
    deps.checkHostBackend({ force, tmuxFound }),
    buildMemoryReport(deps),
  ]);

  return {
    ...catalogReport,
    auth: { claude, gh },
    backend,
    memory,
  };
}
