import type { Command } from 'commander';
import { collectLabelReconcileCandidates, reconcilePipelineLabels } from '../../../lib/cloister/label-reconciler.js';

export function registerReconcileLabelsCommand(admin: Command): void {
  admin.command('reconcile-labels')
    .description('Reconcile pipeline labels from permanent issue truth')
    .option('--dry-run', 'Print changes without mutating labels')
    .action(async (options: { dryRun?: boolean }) => {
      const changes = await reconcilePipelineLabels(await collectLabelReconcileCandidates(), { dryRun: options.dryRun });
      for (const change of changes) console.log(`${options.dryRun ? 'would ' : ''}${change.op} ${change.label} on ${change.issueId}`);
      process.exitCode = 0;
    });
}
