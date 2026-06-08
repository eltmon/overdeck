import chalk from 'chalk';
import { createInterface } from 'node:readline/promises';
import { resumeAgent } from '../../lib/agents.js';
import { assertCanResumeSessionSync, getWorkAgentLifecycleStateSync } from '../../lib/work-agent-lifecycle.js';

interface ResumeOptions {
  host?: boolean;
  yes?: boolean;
  compact?: boolean;
}

async function confirmHostOverride(options: ResumeOptions): Promise<boolean> {
  if (!options.host) return true;

  if (!process.stdin.isTTY) {
    if (options.yes) {
      console.warn(chalk.yellow('--host --yes given in a non-interactive context; bypassing workspace stack-health gate.'));
      return true;
    }
    console.error(chalk.red('Error: --host requires an interactive confirmation, or pass --yes for non-interactive use.'));
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(chalk.bold('Are you sure? This bypasses the workspace docker stack-health gate. (y/N) '))).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

export async function resumeCommand(id: string, options: ResumeOptions = {}): Promise<void> {
  let lifecycle;
  try {
    lifecycle = assertCanResumeSessionSync(id);
  } catch (error) {
    const msg = (error as Error).message;
    // PAN-1675: `--compact` exists to recover a context-wedged agent, which is
    // typically still 'running' (a live but stuck session). The normal lifecycle
    // gate rejects a running agent ("already running"); for --compact, proceed
    // anyway — resumeAgent compacts the JSONL out-of-band and kills the wedged
    // session before relaunch. Other lifecycle blocks (paused/troubled/no saved
    // session) still hard-fail.
    if (options.compact && /already running/i.test(msg)) {
      lifecycle = getWorkAgentLifecycleStateSync(id);
    } else {
      console.error(chalk.red(msg));
      process.exit(1);
    }
  }

  const allowHost = await confirmHostOverride(options);
  if (!allowHost) {
    process.exit(1);
  }

  const result = await resumeAgent(id, undefined, { allowHost: options.host === true, compact: options.compact === true });
  if (!result.success) {
    console.error(chalk.red(result.error || `Failed to resume ${lifecycle.agentId}`));
    if ((result.error || '').includes('No saved session ID')) {
      console.log(chalk.dim(`Use 'pan start ${id}' to start a fresh session in the existing workspace.`));
      console.log(chalk.dim(`If the saved metadata is stale, run 'pan review reset --session ${id}' first.`));
    }
    if ((result.error || '').includes('stack')) {
      console.log(chalk.dim(`Or retry with --host to bypass the docker stack-health gate.`));
    }
    process.exit(1);
  }

  console.log(chalk.green(`Resumed session for ${lifecycle.agentId}`));
}
