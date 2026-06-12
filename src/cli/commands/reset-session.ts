import chalk from 'chalk';
import { existsSync, unlinkSync, readFileSync, writeFileSync } from 'fs';
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

  // Clear codex-thread-id — getLatestSessionIdSync's source #4. Leaving it made
  // `pan start --fresh` refuse forever for any agent that ever attempted a
  // codex spawn: reset cleared sources 1-2, then the fresh-start guard found
  // the surviving thread-id and demanded --fresh again — a catch-22 (PAN-1799).
  const codexThreadIdFile = join(agentDir, 'codex-thread-id');
  if (existsSync(codexThreadIdFile)) {
    unlinkSync(codexThreadIdFile);
  }

  // Clear runtime.json claudeSessionId (source #3). The old comment assumed
  // "the next SessionStart hook overwrites it" — but the fresh-start guard
  // consults getLatestSessionIdSync BEFORE any new session exists, so a
  // surviving runtime id reproduces the same --fresh catch-22. The agent is
  // stopped here (guarded above), so a direct read-modify-write is race-free.
  // Keep this command in lockstep with getLatestSessionIdSync's source chain.
  const runtimeFile = join(agentDir, 'runtime.json');
  try {
    if (existsSync(runtimeFile)) {
      const runtime = JSON.parse(readFileSync(runtimeFile, 'utf-8'));
      if (runtime.claudeSessionId) {
        delete runtime.claudeSessionId;
        writeFileSync(runtimeFile, JSON.stringify(runtime, null, 2));
      }
    }
  } catch { /* non-fatal — file sources above are the primary chain */ }

  console.log(chalk.green(`✓ Reset session for ${agentId}`));
  console.log(chalk.dim(`  Previous session: ${previousSessionId}`));
  console.log(chalk.dim(`  Workspace preserved: ${state.workspace}`));
  console.log(`\nNext "Start Agent" will create a fresh Claude session.`);
}
