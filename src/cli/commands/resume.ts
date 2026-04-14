import chalk from 'chalk';
import { resumeAgent } from '../../lib/agents.js';
import { assertCanResumeSession } from '../../lib/work-agent-lifecycle.js';

export async function resumeCommand(id: string): Promise<void> {
  let lifecycle;
  try {
    lifecycle = assertCanResumeSession(id);
  } catch (error) {
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }

  const result = await resumeAgent(id);
  if (!result.success) {
    console.error(chalk.red(result.error || `Failed to resume ${lifecycle.agentId}`));
    if ((result.error || '').includes('No saved session ID')) {
      console.log(chalk.dim(`Use 'pan work issue ${id}' to start a fresh session in the existing workspace.`));
      console.log(chalk.dim(`If the saved metadata is stale, run 'pan work reset-session ${id}' first.`));
    }
    process.exit(1);
  }

  console.log(chalk.green(`Resumed session for ${lifecycle.agentId}`));
}
