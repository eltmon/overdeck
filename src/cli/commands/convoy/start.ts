import chalk from 'chalk';
import ora from 'ora';
import { startConvoy, type ConvoyContext } from '../../../lib/convoy.js';
import { getConvoyTemplate } from '../../../lib/convoy-templates.js';

interface StartOptions {
  files?: string;
  prUrl?: string;
  issueId?: string;
  projectPath?: string;
}

export async function startCommand(
  templateName: string,
  options: StartOptions
): Promise<void> {
  const spinner = ora('Starting convoy...').start();

  try {
    // Validate template exists
    const template = getConvoyTemplate(templateName);
    if (!template) {
      spinner.fail(chalk.red(`Unknown template: ${templateName}`));
      console.log(chalk.dim('\nAvailable templates: code-review, planning, triage, health-monitor'));
      process.exit(1);
    }

    // Build context
    const context: ConvoyContext = {
      projectPath: options.projectPath || process.cwd(),
    };

    if (options.files) {
      context.files = [options.files];
    }

    if (options.prUrl) {
      context.prUrl = options.prUrl;
    }

    if (options.issueId) {
      context.issueId = options.issueId;
    }

    spinner.text = `Starting convoy: ${template.name}`;

    const convoy = await startConvoy(templateName, context);

    spinner.succeed(chalk.green('Convoy started'));

    console.log('');
    console.log(chalk.bold('Convoy Details:'));
    console.log(chalk.dim('  ID:       ') + convoy.id);
    console.log(chalk.dim('  Template: ') + convoy.template);
    console.log(chalk.dim('  Agents:   ') + convoy.agents.length);
    console.log(chalk.dim('  Output:   ') + convoy.outputDir);
    console.log('');

    console.log(chalk.bold('Agents:'));
    for (const agent of convoy.agents) {
      const statusColor = agent.status === 'running' ? chalk.green : chalk.dim;
      console.log(`  ${statusColor(`• ${agent.role}`)} (${agent.subagent}) - ${agent.status}`);
    }

    console.log('');
    console.log(chalk.dim('Monitor status with: ') + chalk.cyan(`pan convoy status ${convoy.id}`));
    console.log(chalk.dim('Attach to agent:     ') + chalk.cyan(`tmux attach -t ${convoy.agents[0]?.tmuxSession}`));
  } catch (error) {
    spinner.fail(chalk.red('Failed to start convoy'));
    if (error instanceof Error) {
      console.error(chalk.red('\n' + error.message));
    }
    process.exit(1);
  }
}
