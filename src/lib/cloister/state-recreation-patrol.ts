import type { ProjectConfig } from '../projects.js';
import { inspectLegacyStatePaths, type LegacyStatePathInspection } from '../state-home.js';

export interface StateRecreationWarning {
  level: 'warn' | 'error';
  message: string;
}

type LegacyStateInspector = (project: ProjectConfig) => Promise<LegacyStatePathInspection>;

function cleanupCommand(projectPath: string, directories: string[]): string {
  const domains = directories.map(path => path.slice(`${projectPath}/.pan/`.length));
  return `rm -rf ${projectPath}/.pan/{${domains.join(',')}}`;
}

export function createRecreatedStateWarningReporter(
  inspect: LegacyStateInspector = inspectLegacyStatePaths,
): (projects: Array<{ config: ProjectConfig }>) => Promise<StateRecreationWarning[]> {
  const reportedProjects = new Set<string>();
  return async (projects) => {
    const warnings: StateRecreationWarning[] = [];
    for (const { config } of projects) {
      if (!config.path || reportedProjects.has(config.path)) continue;
      const inspection = await inspect(config);
      if (
        inspection.postMigrationWrites.length === 0
        && inspection.inertDirectories.length === 0
        && inspection.staleFiles.length === 0
      ) continue;

      reportedProjects.add(config.path);
      const details = [
        inspection.postMigrationWrites.length > 0
          ? `Post-migration legacy state writes (stray writer): ${inspection.postMigrationWrites.join(', ')}. Stop the writer and move the data through the state write door.`
          : null,
        inspection.inertDirectories.length > 0
          ? `Inert legacy state directories (not a stray writer): ${inspection.inertDirectories.join(', ')}. After confirming they are empty, remove them with ${cleanupCommand(config.path, inspection.inertDirectories)}.`
          : null,
        inspection.staleFiles.length > 0
          ? `Unmigrated legacy state content (not a stray writer): ${inspection.staleFiles.join(', ')}. Compare it with overdeck-state before deletion.`
          : null,
      ].filter(Boolean).join(' ');
      warnings.push({
        level: inspection.postMigrationWrites.length > 0 ? 'error' : 'warn',
        message: `Migrated checkout legacy state: ${details}`,
      });
    }
    return warnings;
  };
}

export const recreatedStateWarnings = createRecreatedStateWarningReporter();
export { reconcileProjectStatePlanes, statePlaneReconcileEveryCycles } from './state-plane-patrol.js';
