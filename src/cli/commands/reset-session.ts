import chalk from 'chalk';
import { existsSync } from 'fs';
import { getAgentStateSync, getAgentDir, getLatestSessionIdSync } from '../../lib/agents.js';
import { clearAgentSessionPointers } from '../../lib/agents/session-pointers.js';
import { listAgentIdsByPrefixSync } from '../../lib/overdeck/agents.js';
import { getWorkAgentLifecycleStateSync } from '../../lib/work-agent-lifecycle.js';
import { resolveIssueIdSync } from '../../lib/issue-id.js';

async function resetAgentSessions(agentIds: string[]): Promise<void> {
  const targets = [...new Set(agentIds)];
  const running = targets.find((agentId) => getWorkAgentLifecycleStateSync(agentId).hasLiveTmuxSession);
  if (running) {
    console.log(chalk.red(`Agent ${running} is running. Stop it first before resetting its session.`));
    process.exit(1);
    return;
  }

  for (const agentId of targets) {
    const state = getAgentStateSync(agentId);
    const previousSessionId = getLatestSessionIdSync(agentId);
    const hasAgentDir = existsSync(getAgentDir(agentId));
    if (!state && !previousSessionId && !hasAgentDir) {
      console.log(chalk.yellow(`Agent ${agentId} has no saved session to reset.`));
      continue;
    }

    await clearAgentSessionPointers(agentId);

    console.log(chalk.green(`✓ Reset session for ${agentId}`));
    if (previousSessionId) {
      console.log(chalk.dim(`  Previous session: ${previousSessionId}`));
    }
    if (state?.workspace) {
      console.log(chalk.dim(`  Workspace preserved: ${state.workspace}`));
    }
  }

  console.log('\nNext start will create a fresh Claude session.');
}

export async function resetSessionCommand(id: string): Promise<void> {
  const issueId = resolveIssueIdSync(id);
  const agentId = `agent-${issueId.toLowerCase()}`;

  if (!getAgentStateSync(agentId) && !existsSync(getAgentDir(agentId))) {
    console.log(chalk.red(`Agent ${agentId} not found.`));
    process.exit(1);
    return;
  }

  await resetAgentSessions([agentId]);
}

export async function resetReviewSessionsCommand(id: string): Promise<void> {
  const issueId = resolveIssueIdSync(id);
  const prefix = `agent-${issueId.toLowerCase()}-review`;
  const reviewAgentIds = listAgentIdsByPrefixSync(prefix);

  if (reviewAgentIds.length === 0) {
    console.log(chalk.yellow(`No saved review sessions found for ${issueId}.`));
    return;
  }

  await resetAgentSessions(reviewAgentIds);
}
