/**
 * PAN-3538: the global `pan` link must run the same generation as the live
 * dashboard server — drift means every spawn executes stale code (observed
 * live: a strike spawned without PTY supervisor wiring a full deploy after
 * the fix landed). Observed processes decide the server side, because the
 * active-bundle record can diverge after a failed deploy (PAN-3329).
 */

import { liveDashboardDeploymentRoots } from '../../lib/deploy/build-from-origin.js';
import { describeCliGenerationDrift } from '../../lib/deploy/global-cli-link.js';

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-hooks-drift.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export async function checkCliGenerationLink(): Promise<CheckResult> {
  try {
    const liveRoots = await liveDashboardDeploymentRoots();
    const serverRoot = liveRoots.find((root) =>
      root.processes.some((proc) => /dist\/dashboard\/server\.js$/.test(proc.entrypoint)),
    )?.root ?? null;
    const drift = await describeCliGenerationDrift(serverRoot);
    return {
      name: 'CLI Generation',
      status: drift.ok ? 'ok' : 'error',
      message: drift.message,
      fix: drift.ok ? undefined : 'Run: pan reload — activation repoints the global pan link (PAN-3538)',
    };
  } catch (error) {
    return { name: 'CLI Generation', status: 'warn', message: `check failed: ${(error as Error).message}` };
  }
}
