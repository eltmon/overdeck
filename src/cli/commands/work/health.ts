import chalk from 'chalk';
import {
  getAgentHealth,
  pingAgent,
  handleStuckAgent,
  runHealthCheck,
  startHealthDaemon,
  formatHealthStatus,
  DEFAULT_PING_TIMEOUT_MS,
  DEFAULT_CONSECUTIVE_FAILURES,
  DEFAULT_COOLDOWN_MS,
  DEFAULT_CHECK_INTERVAL_MS,
  type HealthConfig,
} from '../../../lib/health.js';
import { listRunningAgents } from '../../../lib/agents.js';

interface HealthOptions {
  json?: boolean;
  daemon?: boolean;
  interval?: number;
}

export async function healthCommand(
  action?: string,
  arg?: string,
  options: HealthOptions = {}
): Promise<void> {
  const config: HealthConfig = {
    pingTimeoutMs: DEFAULT_PING_TIMEOUT_MS,
    consecutiveFailures: DEFAULT_CONSECUTIVE_FAILURES,
    cooldownMs: DEFAULT_COOLDOWN_MS,
    checkIntervalMs: options.interval ? options.interval * 1000 : DEFAULT_CHECK_INTERVAL_MS,
  };

  switch (action) {
    case 'check': {
      // Run a single health check
      console.log(chalk.bold('Running health check...\n'));

      const results = await runHealthCheck(config);

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      console.log(`Checked: ${results.checked} agents`);
      console.log(`  ${chalk.green('\u2705 Healthy:')} ${results.healthy}`);
      console.log(`  ${chalk.yellow('\u26a0\ufe0f Warning:')} ${results.warning}`);
      console.log(`  ${chalk.hex('#FFA500')('\u{1f7e0} Stuck:')} ${results.stuck}`);
      console.log(`  ${chalk.red('\u274c Dead:')} ${results.dead}`);

      if (results.recovered.length > 0) {
        console.log('');
        console.log(chalk.green('Recovered agents:'));
        for (const agentId of results.recovered) {
          console.log(`  - ${agentId}`);
        }
      }
      break;
    }

    case 'status': {
      // Show health status of all agents
      const agents = listRunningAgents();

      if (agents.length === 0) {
        console.log(chalk.dim('No agents found.'));
        return;
      }

      const healthData = agents.map((agent) => {
        const health = getAgentHealth(agent.id);
        return { agent, health };
      });

      if (options.json) {
        console.log(JSON.stringify(healthData.map((d) => d.health), null, 2));
        return;
      }

      console.log(chalk.bold('Agent Health Status:\n'));

      for (const { health } of healthData) {
        console.log(formatHealthStatus(health));
        console.log('');
      }
      break;
    }

    case 'ping': {
      // Ping a specific agent
      if (!arg) {
        console.log(chalk.red('Agent ID required'));
        console.log(chalk.dim('Usage: pan work health ping <agent-id>'));
        return;
      }

      const agentId = arg.startsWith('agent-') ? arg : `agent-${arg.toLowerCase()}`;
      console.log(chalk.dim(`Pinging ${agentId}...`));

      const health = await pingAgent(agentId, config);

      if (options.json) {
        console.log(JSON.stringify(health, null, 2));
        return;
      }

      console.log('');
      console.log(formatHealthStatus(health));
      break;
    }

    case 'recover': {
      // Force recovery of a specific agent
      if (!arg) {
        console.log(chalk.red('Agent ID required'));
        console.log(chalk.dim('Usage: pan work health recover <agent-id>'));
        return;
      }

      const agentId = arg.startsWith('agent-') ? arg : `agent-${arg.toLowerCase()}`;
      console.log(chalk.dim(`Attempting recovery of ${agentId}...`));

      // Override config to allow immediate recovery
      const forceConfig = { ...config, consecutiveFailures: 0 };
      const result = await handleStuckAgent(agentId, forceConfig);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.action === 'recovered') {
        console.log(chalk.green(`\u2705 ${result.reason}`));
      } else if (result.action === 'cooldown') {
        console.log(chalk.yellow(`\u26a0\ufe0f ${result.reason}`));
      } else {
        console.log(chalk.dim(result.reason));
      }
      break;
    }

    case 'daemon': {
      // Start the health monitoring daemon
      console.log(chalk.bold('Starting Panopticon Health Daemon'));
      console.log(chalk.dim(`Check interval: ${config.checkIntervalMs / 1000}s`));
      console.log(chalk.dim(`Failure threshold: ${config.consecutiveFailures}`));
      console.log(chalk.dim(`Cooldown: ${config.cooldownMs / (1000 * 60)}m`));
      console.log('');
      console.log(chalk.dim('Press Ctrl+C to stop...\n'));

      const stop = startHealthDaemon(config, (results) => {
        const timestamp = new Date().toLocaleTimeString();
        const statusParts = [
          `[${timestamp}]`,
          `\u2705${results.healthy}`,
          `\u26a0\ufe0f${results.warning}`,
          `\u{1f7e0}${results.stuck}`,
          `\u274c${results.dead}`,
        ];

        if (results.recovered.length > 0) {
          statusParts.push(chalk.green(`+${results.recovered.length} recovered`));
        }

        console.log(statusParts.join(' '));
      });

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log('\n' + chalk.dim('Stopping health daemon...'));
        stop();
        process.exit(0);
      });

      // Keep process running
      await new Promise(() => {});
      break;
    }

    default:
      console.log(chalk.bold('Health Monitoring Commands:'));
      console.log('');
      console.log(`  ${chalk.cyan('pan work health check')}         - Run single health check`);
      console.log(`  ${chalk.cyan('pan work health status')}        - Show all agent health`);
      console.log(`  ${chalk.cyan('pan work health ping <id>')}     - Ping specific agent`);
      console.log(`  ${chalk.cyan('pan work health recover <id>')}  - Force recover agent`);
      console.log(`  ${chalk.cyan('pan work health daemon')}        - Start health daemon`);
      console.log('');
      console.log(chalk.bold('Options:'));
      console.log(`  ${chalk.dim('--json')}               Output as JSON`);
      console.log(`  ${chalk.dim('--interval <sec>')}     Check interval for daemon (default: 30)`);
      console.log('');
      console.log(chalk.bold('Deacon Pattern Defaults:'));
      console.log(`  Ping timeout: ${DEFAULT_PING_TIMEOUT_MS / 1000}s`);
      console.log(`  Consecutive failures: ${DEFAULT_CONSECUTIVE_FAILURES}`);
      console.log(`  Cooldown after kill: ${DEFAULT_COOLDOWN_MS / (1000 * 60)}m`);
      console.log('');
  }
}
