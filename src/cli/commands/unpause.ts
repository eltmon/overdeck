import { exitCli } from '../exit.js';
import chalk from 'chalk';
import { clearAgentPausedSync, getAgentStateSync, resolveAgentTargetSync } from '../../lib/agents.js';
import { appendOperatorInterventionEvent } from '../../lib/operator-interventions.js';
import { getWorkAgentLifecycleStateSync } from '../../lib/work-agent-lifecycle.js';
import { resumeAgent } from '../../lib/agents/resume.js';

export async function unpauseCommand(id: string): Promise<void> {
  // PAN-1760: resolve through normalizeAgentId so full agent IDs
  // (strike-pan-1723, inspect-…, agent-…-ship) are addressable, not just issue IDs.
  const agentId = resolveAgentTargetSync(id);
  if (!agentId) {
    console.error(chalk.red(`Could not resolve agent target "${id}"`));
    console.error(chalk.dim(
      'Pass an issue ID like "PAN-1148" or a full agent ID like "strike-pan-1723"; the state dir must exist under ~/.overdeck/agents/',
    ));
    return exitCli(1);
  }
  const state = getAgentStateSync(agentId);

  if (!state) {
    console.error(chalk.red(`Agent ${agentId} not found.`));
    return exitCli(1);
  }
  const issueId = state.issueId;

  try {
    const wasPaused = state.paused === true;
    clearAgentPausedSync(agentId);

    if (wasPaused) {
      await appendOperatorInterventionEvent({ issueId, kind: 'unpause', source: 'pan unpause' });
      console.log(chalk.green(`Unpaused agent: ${agentId}`));
    } else {
      console.log(chalk.dim(`Agent ${agentId} is already unpaused.`));
    }

    // Resume immediately — unpause means "go now", not "wait for the Deacon's
    // next patrol". Only when there is actually a session to resume; a plain
    // stopped agent with no session is pointed at pan start instead.
    if (wasPaused && getWorkAgentLifecycleStateSync(agentId).canResumeSession) {
      console.log(chalk.dim('Resuming now…'));
      const result = await resumeAgent(agentId);
      if (result.success) {
        console.log(chalk.green(`Agent ${agentId} resumed.`));
      } else {
        console.error(chalk.red(`Resume failed: ${result.error ?? 'unknown error'}`));
        console.error(chalk.dim(`Run pan start ${issueId} to spawn a fresh agent.`));
        process.exitCode = 1;
      }
    } else if (wasPaused) {
      console.log(chalk.dim(`No saved session to resume — run pan start ${issueId} to spawn now.`));
    }
  } catch (error: any) {
    console.error(chalk.red('Error: ' + error.message));
    return exitCli(1);
  }
}
