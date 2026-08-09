import { exitCli } from '../exit.js';
import chalk from 'chalk';
import ora from 'ora';
import {
  detectCrashedAgents,
  recoverAgent,
  autoRecoverAgents,
  normalizeAgentId,
  resolveAgentTargetSync,
  resumeAgent,
} from '../../lib/agents.js';

interface RecoverOptions {
  all?: boolean;
  compact?: boolean;
  json?: boolean;
  model?: string;
}

export async function recoverCommand(id?: string, options: RecoverOptions = {}): Promise<void> {
  const spinner = ora('Checking for crashed agents...').start();

  try {
    if (options.compact && !id) {
      spinner.fail('Specify an agent ID when using --compact');
      return exitCli(1);
    }

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

    // Recover specific agent. Preserve known prefixes; resolve a bare issue ID
    // against the agents actually registered for it.
    //
    // PAN-3150: prefixing blindly with `agent-` made every non-work agent
    // unreachable — `pan recover PAN-3150` reported "Agent not found:
    // agent-pan-3150" while the issue's only agent was `strike-pan-3150`, so the
    // strike namespace had no recovery door at all. resolveAgentTargetSync still
    // prefers the canonical work agent when one exists, and falls back to the
    // single registered agent for the issue whatever its prefix.
    const agentId = resolveAgentTargetSync(id) ?? normalizeAgentId(id);
    spinner.text = options.model
      ? `Recovering ${agentId} on ${options.model}...`
      : `Recovering ${agentId}...`;

    if (options.compact) {
      const result = await resumeAgent(agentId, undefined, {
        compact: true,
        recoverGated: true,
        model: options.model,
      });
      if (!result.success) {
        spinner.fail(result.error || `Failed to compact-recover ${agentId}`);
        return exitCli(1);
      }

      spinner.succeed(`Compact-recovered: ${agentId}`);
      console.log('');
      console.log(chalk.dim('This recovered a context-wedged agent by spawning a fresh session seeded from the saved transcript summary.'));
      console.log(chalk.dim(`Message: pan tell ${agentId} "your message"`));
      return;
    }

    const recovery = await recoverAgent(agentId, { modelOverride: options.model });

    if (!recovery) {
      spinner.fail(`Agent not found or cannot be recovered: ${agentId}`);
      return exitCli(1);
    }

    if (recovery.action === 'already-running') {
      spinner.fail(`No recovery performed: ${agentId} already has a live harness runtime`);
      return exitCli(1);
    }

    const state = recovery.state;
    spinner.succeed(`Respawned: ${agentId}`);
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
    return exitCli(1);
  }
}
