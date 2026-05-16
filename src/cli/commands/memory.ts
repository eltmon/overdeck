import { Command } from 'commander';
import chalk from 'chalk';
import {
  createResetMarker,
  generateDailySummary,
  getMemoryStatus,
  readMemorySettingsSummary,
  runMemoryDoctor,
  searchMemory,
} from '../../lib/memory/cli.js';

export function createMemoryCommand(): Command {
  const memory = new Command('memory')
    .description('Search and inspect Panopticon memory');

  memory
    .command('search <query>')
    .description('Search memory observations')
    .option('--project <id>', 'Project ID')
    .option('--workspace <id>', 'Workspace ID')
    .option('--issue <id>', 'Issue ID')
    .option('--tag <tag>', 'Filter by tag')
    .option('--sibling', 'Search same-project sibling issues instead of the selected issue')
    .option('--limit <n>', 'Maximum results', parseInt)
    .option('--json', 'Output JSON')
    .action(async (query, options) => {
      const results = await searchMemory(query, options);
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }
      if (results.length === 0) {
        console.log(chalk.yellow('No memory observations matched.'));
        return;
      }
      for (const { observation, score } of results) {
        console.log(chalk.bold(`${observation.issueId} ${observation.timestamp} score=${score}`));
        console.log(`  ${observation.actionStatus ?? observation.summary}`);
        console.log(chalk.dim(`  ${observation.workspaceId} · ${observation.files.join(', ') || 'no files'}`));
      }
    });

  memory
    .command('status <issue>')
    .description('Show current memory status for an issue')
    .option('--project <id>', 'Project ID', 'panopticon-cli')
    .option('--json', 'Output JSON')
    .action(async (issue, options) => {
      const status = await getMemoryStatus(options.project, issue);
      if (options.json) {
        console.log(JSON.stringify(status ?? null, null, 2));
        return;
      }
      if (!status) {
        console.log(chalk.yellow(`No memory status found for ${issue}.`));
        return;
      }
      console.log(chalk.bold(status.headline));
      console.log(status.summary);
      console.log(chalk.dim(`phase=${status.phase} confidence=${status.confidence}`));
      if (status.nextSteps.length > 0) console.log(`Next: ${status.nextSteps.join('; ')}`);
    });

  memory
    .command('reset <scope> <scopeId>')
    .description('Create a memory reset marker')
    .option('--project <id>', 'Project ID', 'panopticon-cli')
    .requiredOption('--reason <text>', 'Reason for the reset marker')
    .option('--from <iso>', 'Reset from timestamp')
    .option('--json', 'Output JSON')
    .action(async (scope, scopeId, options) => {
      const marker = await createResetMarker({
        projectId: options.project,
        scope,
        scopeId,
        reason: options.reason,
        fromTimestamp: options.from,
      });
      if (options.json) console.log(JSON.stringify(marker, null, 2));
      else console.log(chalk.green(`Created reset marker ${marker.id} for ${marker.scope}:${marker.scopeId}`));
    });

  memory
    .command('summary <issue>')
    .description('Generate a daily markdown memory summary')
    .option('--project <id>', 'Project ID', 'panopticon-cli')
    .option('--date <yyyy-mm-dd>', 'Summary date')
    .option('--json', 'Output JSON')
    .action(async (issue, options) => {
      const result = await generateDailySummary({ projectId: options.project, issueId: issue, date: options.date });
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else console.log(chalk.green(`Wrote ${result.observationCount} observations to ${result.path}`));
    });

  memory
    .command('doctor')
    .description('Print memory health, pending counts, and provider configuration')
    .option('--project <id>', 'Project ID', 'panopticon-cli')
    .option('--json', 'Output JSON')
    .action(async (options) => {
      const result = await runMemoryDoctor({ project: options.project });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        process.exitCode = result.exitCode;
        return;
      }
      console.log(chalk.bold('Memory Doctor'));
      console.log(`Provider: ${result.provider.provider} / ${result.provider.model} (${result.provider.source})`);
      console.log(`Rollup pending threshold: ${result.rollupPendingThreshold}`);
      for (const issue of result.issues) {
        console.log(`${issue.issueId}: health=${issue.health.status} pending=${issue.pendingCount} last_success=${issue.health.last_success ?? 'never'}`);
      }
      if (result.staleActiveAgents.length > 0) {
        console.log(chalk.red('Stale active agents:'));
        for (const agent of result.staleActiveAgents) {
          console.log(chalk.red(`  ${agent.agentId} ${agent.issueId} last_success=${agent.lastSuccess ?? 'never'}`));
        }
      }
      process.exitCode = result.exitCode;
    });

  memory
    .command('config')
    .description('Show memory provider and rollup configuration')
    .option('--json', 'Output JSON')
    .action(async (options) => {
      const summary = await readMemorySettingsSummary();
      if (options.json) console.log(JSON.stringify(summary, null, 2));
      else {
        console.log(`Provider: ${summary.provider.provider} / ${summary.provider.model} (${summary.provider.source})`);
        console.log(`Rollup pending threshold: ${summary.rollupPendingThreshold}`);
      }
    });

  return memory;
}
