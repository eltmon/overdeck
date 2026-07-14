import type { TaskTotals } from './resource-discovery-signals.js';

export interface ProjectTaskRollupState {
  rollups: Map<string, TaskTotals>;
  stale: boolean;
}

export interface TasksRollupService {
  getProjectRollups(projectKey: string): ProjectTaskRollupState | null;
}

let service: TasksRollupService | null = null;

export function setTasksRollupServiceForTests(next: TasksRollupService | null): void {
  service = next;
}

export function getTasksRollupService(): TasksRollupService {
  return service ?? {
    getProjectRollups: () => null,
  };
}
