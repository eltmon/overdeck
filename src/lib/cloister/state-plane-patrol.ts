import { Effect } from 'effect';
import type { ProjectConfig } from '../projects.js';
import { queueBeadsAutoCommit, reconcileStatePlaneDrift } from '../pan-dir/auto-commit.js';

export interface StatePlaneReconcileAction {
  message: string;
  level: 'action' | 'warn';
}

export async function reconcileProjectStatePlanes(
  projects: Array<{ config: ProjectConfig }>,
): Promise<StatePlaneReconcileAction[]> {
  const actions: StatePlaneReconcileAction[] = [];
  for (const { config } of projects) {
    if (!config.path) continue;
    queueBeadsAutoCommit(config.path);
    const write = await Effect.runPromise(reconcileStatePlaneDrift(config.path));
    if (!write.committed) continue;
    actions.push({
      message: `Reconciled pending spec/record state for ${config.name ?? config.path}`,
      level: write.pushed === false ? 'warn' : 'action',
    });
  }
  return actions;
}
