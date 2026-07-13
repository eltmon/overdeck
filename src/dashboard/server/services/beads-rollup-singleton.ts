import type { BeadsRollupServiceDependencies } from './beads-rollup-service.js';
import { createBeadsRollupService, type ProjectRollupState } from './beads-rollup-service.js';

let service: ReturnType<typeof createBeadsRollupService> | null = null;

export function startBeadsRollupService(dependencies: BeadsRollupServiceDependencies = {}): void {
  if (service) return;
  service = createBeadsRollupService(dependencies);
  service.start();
}

export function stopBeadsRollupService(): void {
  service?.stop();
  service = null;
}

export function getBeadsRollupService(): { getProjectRollups(projectKey: string): ProjectRollupState | null } {
  return service ?? {
    getProjectRollups: () => null,
  };
}
