import { detectCanonicalBeadsSplitBrain } from '../../lib/beads/home.js';
import { listProjectsSync } from '../../lib/projects.js';
import type { CheckResult } from './doctor.js';

export function checkCanonicalBeadsHomes(): CheckResult[] {
  return listProjectsSync().flatMap(({ key, config }) => {
    const split = detectCanonicalBeadsSplitBrain(config);
    return split ? [{
      name: `Beads authority: ${key}`,
      status: 'error' as const,
      message: `Split-brain project ${split.projectId}: ${split.paths.join(' and ')}`,
      fix: `Run pan beads reconcile --project ${key}; do not mutate either database until one canonical home is selected.`,
    }] : [];
  });
}
