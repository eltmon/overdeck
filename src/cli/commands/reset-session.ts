import chalk from 'chalk';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getAgentStateSync, getAgentDir, getLatestSessionIdSync } from '../../lib/agents.js';
import { getWorkAgentLifecycleStateSync } from '../../lib/work-agent-lifecycle.js';
import { resolveIssueIdSync } from '../../lib/issue-id.js';

export async function resetSessionCommand(id: string): Promise<void> {
  // Support "agent-xxx" prefix, or just the issue ID
  const issueId = resolveIssueIdSync(id);
  const agentId = `agent-${issueId.toLowerCase()}`;

  const state = getAgentStateSync(agentId);
  if (!state) {
    console.log(chalk.red(`Agent ${agentId} not found.`));
    process.exit(1);
  }

  const lifecycle = getWorkAgentLifecycleStateSync(agentId);

  // Refuse if running
  if (lifecycle.hasLiveTmuxSession) {
    console.log(chalk.red(`Agent ${agentId} is running. Stop it first with: pan kill ${id}`));
    process.exit(1);
  }

  const previousSessionId = getLatestSessionIdSync(agentId);
  if (!previousSessionId) {
    console.log(chalk.yellow(`Agent ${agentId} has no saved session to reset.`));
    return;
  }

  const agentDir = getAgentDir(agentId);

  // Clear session.id
  const sessionIdFile = join(agentDir, 'session.id');
  if (existsSync(sessionIdFile)) {
    unlinkSync(sessionIdFile);
  }

  // Clear sessions.json
  const sessionsFile = join(agentDir, 'sessions.json');
  if (existsSync(sessionsFile)) {
    unlinkSync(sessionsFile);
  }

  // claudeSessionId lives on the AgentRuntimeSnapshot in AgentStateService.
  // The next SessionStart hook fire will emit agent.model_set with the fresh
  // session id, overwriting the stale one — no explicit clear needed.

  console.log(chalk.green(`✓ Reset session for ${agentId}`));
  console.log(chalk.dim(`  Previous session: ${previousSessionId}`));
  console.log(chalk.dim(`  Workspace preserved: ${state.workspace}`));
  console.log(`\nNext "Start Agent" will create a fresh Claude session.`);
}
