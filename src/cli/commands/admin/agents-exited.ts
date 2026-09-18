import type { Command } from 'commander';

import { getAgentStateSync, markAgentStoppedState, saveAgentStateSync } from '../../../lib/agents/agent-state.js';
import { logAgentLifecycleSync } from '../../../lib/persistent-logger.js';

/**
 * PAN-3848 (W26, FR-21): `pan admin agents exited <agentId> --code <n>` — the
 * transition writes its own state. A reviewer's launcher calls this when the
 * reviewer process exits, so no patrol has to infer the exit from a missing
 * tmux session. `markAgentStoppedState(state, 'system')` keeps `stoppedByUser`
 * unset (PAN-3324: a machinery-initiated stop is not operator intent), and
 * `saveAgentStateSync` writes both state.json and the agents row, so the
 * dashboard updates without a patrol sweep.
 */
export async function agentsExitedCommand(agentId: string, options: { code: string }): Promise<void> {
  const exitCode = Number.parseInt(options.code, 10);
  const state = getAgentStateSync(agentId);
  if (!state) {
    console.warn(`[admin agents exited] no agent state for ${agentId} — nothing to mark (exit code ${options.code})`);
    return;
  }
  if (state.status === 'stopped') return;
  markAgentStoppedState(state, 'system');
  saveAgentStateSync(state);
  logAgentLifecycleSync(
    state.id,
    `process exited with code ${Number.isNaN(exitCode) ? options.code : exitCode} (launcher-reported, PAN-3848)`,
  );
}

export function registerAgentsCommands(admin: Command): void {
  const agents = admin
    .command('agents')
    .description('Agent state plumbing');

  agents
    .command('exited <agentId>')
    .description('Record that an agent process exited (reported by its launcher; PAN-3848)')
    .requiredOption('--code <n>', 'Process exit code')
    .action(async (agentId: string, options: { code: string }) => {
      await agentsExitedCommand(agentId, options);
    });
}
