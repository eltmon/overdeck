import chalk from 'chalk';
import { getAgentStateSync, resolveAgentTargetSync, setAgentPausedSync, stopAgentSync } from '../../lib/agents.js';
import { sessionExistsSync } from '../../lib/tmux.js';
import { appendOperatorInterventionEvent } from '../../lib/operator-interventions.js';

interface PauseOptions {
  reason?: string;
}

export async function pauseCommand(id: string, options: PauseOptions): Promise<void> {
  // PAN-1760: resolve through normalizeAgentId so full agent IDs
  // (strike-pan-1723, inspect-…, agent-…-ship) are addressable, not just issue IDs.
  const agentId = resolveAgentTargetSync(id);
  if (!agentId) {
    console.error(chalk.red(`Could not resolve agent target "${id}"`));
    console.error(chalk.dim(
      'Pass an issue ID like "PAN-1148" or a full agent ID like "strike-pan-1723"; the state dir must exist under ~/.overdeck/agents/',
    ));
    process.exit(1);
  }
  const state = getAgentStateSync(agentId);

  if (!state) {
    console.error(chalk.red(`Agent ${agentId} not found.`));
    process.exit(1);
  }
  const issueId = state.issueId;

  const shouldStop = sessionExistsSync(agentId) || state.status === 'running' || state.status === 'starting';

  try {
    setAgentPausedSync(agentId, options.reason, shouldStop);
    if (shouldStop) {
      stopAgentSync(agentId);
    }
    await appendOperatorInterventionEvent({ issueId, kind: 'pause', source: 'pan pause' });

    const reason = options.reason ? ` (${options.reason})` : '';
    const stopped = shouldStop ? ' and stopped' : '';
    console.log(chalk.green(`Paused${stopped} agent: ${agentId}${reason}`));
  } catch (error: any) {
    console.error(chalk.red('Error: ' + error.message));
    process.exit(1);
  }
}
