import { detectCanonicalBeadsSplitBrain } from '../../lib/beads/home.js';
import { listProjectsSync } from '../../lib/projects.js';
import type { CheckResult } from './doctor.js';
import { MINIMUM_BD_VERSION, isSupportedBdVersion, readInstalledBdVersionSync, unsupportedBdVersionMessage } from '../../lib/beads/version.js';

export function checkCanonicalBeadsHomes(): CheckResult[] {
  const version = readInstalledBdVersionSync();
  const versionCheck: CheckResult[] = version && !isSupportedBdVersion(version) ? [{
    name: 'Beads CLI version policy',
    status: 'error',
    message: unsupportedBdVersionMessage(version),
    fix: `Run pan beads upgrade to install bd ${MINIMUM_BD_VERSION} or newer before using canonical beads reads or writes.`,
  }] : [];
  return versionCheck.concat(listProjectsSync().flatMap(({ key, config }) => {
    const split = detectCanonicalBeadsSplitBrain(config);
    return split ? [{
      name: `Beads authority: ${key}`,
      status: 'error' as const,
      message: `Split-brain project ${split.projectId}: ${split.paths.join(' and ')}`,
      fix: `Run pan beads reconcile --project ${key}; do not mutate either database until one canonical home is selected.`,
    }] : [];
  }));
}
