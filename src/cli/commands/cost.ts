/**
 * Cost CLI Commands
 *
 * Track and report AI usage costs
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  readTodayCosts,
  getDailySummary,
  getWeeklySummary,
  getMonthlySummary,
  generateReport,
  formatCost,
  createBudget,
  getAllBudgets,
  checkBudget,
  deleteBudget,
  readIssueCosts,
  summarizeCosts,
} from '../../lib/cost.js';

export function createCostCommand(): Command {
  const cost = new Command('cost')
    .description('Track and report AI usage costs');

  // Show today's costs
  cost
    .command('today')
    .description('Show today\'s cost summary')
    .option('-d, --detail', 'Show individual entries')
    .action((options) => {
      try {
        const summary = getDailySummary();

        console.log(chalk.bold('Today\'s Cost Summary'));
        console.log();
        console.log(`Total Cost: ${chalk.green(formatCost(summary.totalCost))}`);
        console.log(`API Calls: ${summary.entryCount}`);
        console.log(`Tokens: ${summary.totalTokens.total.toLocaleString()}`);
        console.log(`  Input: ${summary.totalTokens.input.toLocaleString()}`);
        console.log(`  Output: ${summary.totalTokens.output.toLocaleString()}`);
        console.log();

        if (Object.keys(summary.byProvider).length > 0) {
          console.log(chalk.bold('By Provider'));
          for (const [provider, cost] of Object.entries(summary.byProvider)) {
            console.log(`  ${provider}: ${formatCost(cost)}`);
          }
          console.log();
        }

        if (Object.keys(summary.byModel).length > 0) {
          console.log(chalk.bold('By Model'));
          for (const [model, cost] of Object.entries(summary.byModel)) {
            console.log(`  ${model}: ${formatCost(cost)}`);
          }
          console.log();
        }

        if (options.detail) {
          const entries = readTodayCosts();
          if (entries.length > 0) {
            console.log(chalk.bold('Entries'));
            for (const entry of entries.slice(-10)) {
              const time = new Date(entry.timestamp).toLocaleTimeString();
              console.log(`  ${chalk.dim(time)} ${entry.model} ${formatCost(entry.cost)} ${entry.operation}`);
            }
            if (entries.length > 10) {
              console.log(chalk.dim(`  ... and ${entries.length - 10} more`));
            }
          }
        }
      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Show weekly summary
  cost
    .command('week')
    .description('Show weekly cost summary')
    .action(() => {
      try {
        const summary = getWeeklySummary();

        console.log(chalk.bold('Weekly Cost Summary'));
        console.log(chalk.dim(`${summary.period.start} to ${summary.period.end}`));
        console.log();
        console.log(`Total Cost: ${chalk.green(formatCost(summary.totalCost))}`);
        console.log(`API Calls: ${summary.entryCount}`);
        console.log(`Tokens: ${summary.totalTokens.total.toLocaleString()}`);
        console.log();

        if (Object.keys(summary.byProvider).length > 0) {
          console.log(chalk.bold('By Provider'));
          for (const [provider, cost] of Object.entries(summary.byProvider)) {
            console.log(`  ${provider}: ${formatCost(cost)}`);
          }
          console.log();
        }

        if (Object.keys(summary.byIssue).length > 0) {
          console.log(chalk.bold('Top Issues by Cost'));
          const sorted = Object.entries(summary.byIssue)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5);
          for (const [issue, cost] of sorted) {
            console.log(`  ${issue}: ${formatCost(cost)}`);
          }
        }
      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Show monthly summary
  cost
    .command('month')
    .description('Show monthly cost summary')
    .action(() => {
      try {
        const summary = getMonthlySummary();

        console.log(chalk.bold('Monthly Cost Summary'));
        console.log(chalk.dim(`${summary.period.start} to ${summary.period.end}`));
        console.log();
        console.log(`Total Cost: ${chalk.green(formatCost(summary.totalCost))}`);
        console.log(`API Calls: ${summary.entryCount}`);
        console.log(`Tokens: ${summary.totalTokens.total.toLocaleString()}`);
        console.log();

        if (Object.keys(summary.byProvider).length > 0) {
          console.log(chalk.bold('By Provider'));
          for (const [provider, cost] of Object.entries(summary.byProvider)) {
            console.log(`  ${provider}: ${formatCost(cost)}`);
          }
          console.log();
        }

        if (Object.keys(summary.byModel).length > 0) {
          console.log(chalk.bold('By Model'));
          for (const [model, cost] of Object.entries(summary.byModel)) {
            console.log(`  ${model}: ${formatCost(cost)}`);
          }
          console.log();
        }

        if (Object.keys(summary.byIssue).length > 0) {
          console.log(chalk.bold('Top 10 Issues by Cost'));
          const sorted = Object.entries(summary.byIssue)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10);
          for (const [issue, cost] of sorted) {
            console.log(`  ${issue}: ${formatCost(cost)}`);
          }
        }
      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Generate report
  cost
    .command('report')
    .description('Generate a cost report')
    .option('-s, --start <date>', 'Start date (YYYY-MM-DD)')
    .option('-e, --end <date>', 'End date (YYYY-MM-DD)')
    .action((options) => {
      try {
        const end = options.end || new Date().toISOString().split('T')[0];
        const start = options.start || (() => {
          const d = new Date();
          d.setDate(d.getDate() - 30);
          return d.toISOString().split('T')[0];
        })();

        const report = generateReport(start, end);
        console.log(report);
      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Show costs for an issue
  cost
    .command('issue <issueId>')
    .description('Show costs for a specific issue')
    .option('-d, --days <n>', 'Number of days to look back', '30')
    .action((issueId: string, options) => {
      try {
        const entries = readIssueCosts(issueId, parseInt(options.days, 10));

        if (entries.length === 0) {
          console.log(chalk.dim('No costs found for issue:'), issueId);
          return;
        }

        const summary = summarizeCosts(entries);

        console.log(chalk.bold(`Costs for ${issueId}`));
        console.log();
        console.log(`Total Cost: ${chalk.green(formatCost(summary.totalCost))}`);
        console.log(`API Calls: ${summary.entryCount}`);
        console.log(`Tokens: ${summary.totalTokens.total.toLocaleString()}`);
        console.log();

        if (Object.keys(summary.byModel).length > 0) {
          console.log(chalk.bold('By Model'));
          for (const [model, cost] of Object.entries(summary.byModel)) {
            console.log(`  ${model}: ${formatCost(cost)}`);
          }
        }
      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Budget subcommands
  const budget = cost
    .command('budget')
    .description('Manage cost budgets');

  // Create a budget
  budget
    .command('create <name>')
    .description('Create a cost budget')
    .option('-l, --limit <amount>', 'Budget limit in USD', '100')
    .option('-t, --type <type>', 'Budget type (daily, monthly, project, issue, feature)', 'monthly')
    .option('-a, --alert <threshold>', 'Alert threshold (0-1)', '0.8')
    .action((name: string, options) => {
      try {
        const newBudget = createBudget({
          name,
          type: options.type as any,
          limit: parseFloat(options.limit),
          currency: 'USD',
          alertThreshold: parseFloat(options.alert),
          enabled: true,
        });

        console.log(chalk.green('✓ Budget created'));
        console.log(`  ID: ${chalk.cyan(newBudget.id)}`);
        console.log(`  Name: ${newBudget.name}`);
        console.log(`  Type: ${newBudget.type}`);
        console.log(`  Limit: ${formatCost(newBudget.limit)}`);
        console.log(`  Alert at: ${(newBudget.alertThreshold * 100).toFixed(0)}%`);
      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // List budgets
  budget
    .command('list')
    .description('List all budgets')
    .action(() => {
      try {
        const budgets = getAllBudgets();

        if (budgets.length === 0) {
          console.log(chalk.dim('No budgets configured'));
          console.log(chalk.dim('Create one with: pan cost budget create "Monthly Limit" --limit 100'));
          return;
        }

        console.log(chalk.bold('Budgets'));
        console.log();

        for (const b of budgets) {
          const status = checkBudget(b.id);
          const percentStr = `${(status.percentUsed * 100).toFixed(0)}%`;

          let statusColor = chalk.green;
          if (status.exceeded) {
            statusColor = chalk.red;
          } else if (status.alert) {
            statusColor = chalk.yellow;
          }

          console.log(`${b.enabled ? '●' : '○'} ${chalk.cyan(b.id)} ${b.name}`);
          console.log(`  Type: ${b.type}`);
          console.log(`  Limit: ${formatCost(b.limit)}`);
          console.log(`  Spent: ${statusColor(formatCost(b.spent))} (${statusColor(percentStr)})`);
          console.log(`  Remaining: ${formatCost(status.remaining)}`);
          console.log();
        }
      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Check a budget
  budget
    .command('check <id>')
    .description('Check budget status')
    .action((id: string) => {
      try {
        const status = checkBudget(id);

        if (!status.budget) {
          console.log(chalk.red('Budget not found:'), id);
          process.exit(1);
        }

        const b = status.budget;
        const percentStr = `${(status.percentUsed * 100).toFixed(0)}%`;

        let statusColor = chalk.green;
        let statusText = 'OK';
        if (status.exceeded) {
          statusColor = chalk.red;
          statusText = 'EXCEEDED';
        } else if (status.alert) {
          statusColor = chalk.yellow;
          statusText = 'WARNING';
        }

        console.log(chalk.bold(b.name));
        console.log();
        console.log(`Status: ${statusColor(statusText)}`);
        console.log(`Limit: ${formatCost(b.limit)}`);
        console.log(`Spent: ${statusColor(formatCost(b.spent))} (${statusColor(percentStr)})`);
        console.log(`Remaining: ${formatCost(status.remaining)}`);
        console.log(`Alert Threshold: ${(b.alertThreshold * 100).toFixed(0)}%`);
      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Delete a budget
  budget
    .command('delete <id>')
    .description('Delete a budget')
    .action((id: string) => {
      try {
        const success = deleteBudget(id);

        if (success) {
          console.log(chalk.green('✓ Budget deleted'));
        } else {
          console.log(chalk.red('Budget not found:'), id);
          process.exit(1);
        }
      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  return cost;
}
