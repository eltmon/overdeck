import chalk from 'chalk';
import { messageAgent } from '../../../lib/agents.js';

export async function tellCommand(id: string, message: string): Promise<void> {
  const agentId = id.startsWith('agent-') ? id : `agent-${id.toLowerCase()}`;

  try {
    await messageAgent(agentId, message);
    console.log(chalk.green('Message sent to ' + agentId));
    console.log(chalk.dim(`  "${message}"`));
  } catch (error: any) {
    console.error(chalk.red('Error: ' + error.message));
    process.exit(1);
  }
}
