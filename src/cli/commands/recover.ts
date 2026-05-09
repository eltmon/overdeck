import chalk from 'chalk';
import ora from 'ora';
import {
  detectCrashedAgents,
  recoverAgent,
  autoRecoverAgents,
} from '../../lib/agents.js';

interface RecoverOptions {
  all?: boolean;
  json?: boolean;
  model?: string;
}

export async function recoverCommand(id?: string, options: RecoverOptions = {}): Promise<void> {
  const spinner = ora('Checking for crashed agents...').start();

  try {
    // Auto-recover all crashed agents
    if (options.all || !id) {
      const crashed = detectCrashedAgents();

      if (crashed.length === 0) {
        spinner.succeed('No crashed agents found');
        return;
      }

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify({ crashed: crashed.map((a) => a.id) }, null, 2));

        if (!options.all) {
          console.log(chalk.dim('\nUse --all to auto-recover all crashed agents'));
          return;
        }
      }

      if (!options.all) {
        spinner.info(`Found ${crashed.length} crashed agent(s)`);
        console.log('');

        for (const agent of crashed) {
          console.log(`  ${chalk.red('●')} ${chalk.cyan(agent.id)}`);
          console.log(`    Issue: ${agent.issueId}`);
          console.log(`    Started: ${agent.startedAt}`);
          console.log('');
        }

        console.log(chalk.dim('Use --all to auto-recover, or specify an agent ID'));
        return;
      }

      spinner.text = 'Auto-recovering agents...';
      const result = await autoRecoverAgents();

      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.recovered.length > 0) {
        console.log(chalk.green(`✓ Recovered ${result.recovered.length} agent(s):`));
        for (const agentId of result.recovered) {
          console.log(`  ${chalk.cyan(agentId)}`);
        }
      }

      if (result.failed.length > 0) {
        console.log(chalk.red(`✗ Failed to recover ${result.failed.length} agent(s):`));
        for (const agentId of result.failed) {
          console.log(`  ${chalk.dim(agentId)}`);
        }
      }

      return;
    }

    // Recover specific agent. Preserve known prefixes; bare PAN-NNN gets the work prefix.
    const agentId = (id.startsWith('agent-') || id.startsWith('planning-'))
      ? id
      : `agent-${id.toLowerCase()}`;
    spinner.text = options.model
      ? `Recovering ${agentId} on ${options.model}...`
      : `Recovering ${agentId}...`;

    const state = await recoverAgent(agentId, { modelOverride: options.model });

    if (!state) {
      spinner.fail(`Agent not found: ${agentId}`);
      process.exit(1);
    }

    spinner.succeed(`Recovered: ${agentId}`);
    console.log('');
    console.log(chalk.bold('Agent Details:'));
    console.log(`  Issue:     ${chalk.cyan(state.issueId)}`);
    console.log(`  Workspace: ${chalk.dim(state.workspace)}`);
    console.log(`  Model:     ${state.model}`);
    console.log('');
    console.log(chalk.dim('Commands:'));
    console.log(`  Attach:  tmux attach -t ${state.id}`);
    console.log(`  Message: pan tell ${state.issueId} "your message"`);

  } catch (error: any) {
    spinner.fail(error.message);
    process.exit(1);
  }
}
