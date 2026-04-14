import chalk from 'chalk';
import { existsSync, unlinkSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getAgentState, getAgentDir, getAgentRuntimeFile, getLatestSessionId } from '../../../lib/agents.js';
import { getWorkAgentLifecycleState } from '../../../lib/work-agent-lifecycle.js';

export async function resetSessionCommand(id: string): Promise<void> {
  // Support "agent-xxx" prefix, or just the issue ID
  let agentId = id;
  if (!id.startsWith('agent-')) {
    agentId = `agent-${id.toLowerCase()}`;
  }

  const state = getAgentState(agentId);
  if (!state) {
    console.log(chalk.red(`Agent ${agentId} not found.`));
    process.exit(1);
  }

  const lifecycle = getWorkAgentLifecycleState(agentId);

  // Refuse if running
  if (lifecycle.hasLiveTmuxSession) {
    console.log(chalk.red(`Agent ${agentId} is running. Stop it first with: pan work kill ${id}`));
    process.exit(1);
  }

  const previousSessionId = getLatestSessionId(agentId);
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

  // Clear claudeSessionId from runtime.json (preserve other fields).
  // Must write directly — saveAgentRuntimeState merges with existing file.
  const runtimeFile = getAgentRuntimeFile(agentId);
  if (existsSync(runtimeFile)) {
    try {
      const runtime = JSON.parse(readFileSync(runtimeFile, 'utf8'));
      delete runtime.claudeSessionId;
      writeFileSync(runtimeFile, JSON.stringify(runtime, null, 2));
    } catch { /* non-fatal */ }
  }

  console.log(chalk.green(`✓ Reset session for ${agentId}`));
  console.log(chalk.dim(`  Previous session: ${previousSessionId}`));
  console.log(chalk.dim(`  Workspace preserved: ${state.workspace}`));
  console.log(`\nNext "Start Agent" will create a fresh Claude session.`);
}
