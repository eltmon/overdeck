import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isAgentRole, type AgentRole } from '@overdeck/contracts';
import { getOverdeckHome } from '../paths.js';

/** `<overdeck home>/conversations/<tmuxSession>`: a conversation's launcher and state files. */
export function conversationStateDir(tmuxSession: string): string {
  return join(getOverdeckHome(), 'conversations', tmuxSession);
}

/**
 * A conversation's pane role lives in `<stateDir>/pane-role` (PAN-3921 D2):
 * no DB column, and it survives every respawn, resume, restart-all and
 * fork-pipeline spawn. Without a file the role is `conversation`.
 */
export async function writeConversationPaneRole(tmuxSession: string, role: AgentRole): Promise<void> {
  const stateDir = conversationStateDir(tmuxSession);
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, 'pane-role'), `${role}\n`, { mode: 0o600 });
}

export async function readConversationPaneRole(tmuxSession: string): Promise<AgentRole> {
  const raw = await readFile(join(conversationStateDir(tmuxSession), 'pane-role'), 'utf-8').catch(() => '');
  const role = raw.trim();
  return isAgentRole(role) ? role : 'conversation';
}
