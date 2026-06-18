/**
 * Resolve the conversation the caller is currently running inside.
 *
 * This is the deterministic answer to "which conversation am I?" — it replaces
 * the old scan-and-guess pattern, where an agent inside a conversation had no
 * way to identify its own row and would run `pan conv scan`/`show` and guess
 * (frequently wrong, per PAN-1520).
 *
 * Resolution order:
 *   1. `PANOPTICON_AGENT_ID` — the launcher exports this for every non-Docker
 *      claude-code conversation, set to the tmux session name (`conv-<name>`).
 *      We resolve the live conversation on that session.
 *   2. tmux fallback — read the current session name via `display-message` (the
 *      inherited `$TMUX` points at the managed socket from inside a pane).
 *
 * Returns null when neither signal is available (e.g. run outside a conversation
 * or inside a Docker workspace where the env var is not exported). Callers that
 * require a current conversation should surface a clear error rather than guess.
 */

import { promisify } from 'util';
import { execFile } from 'child_process';
import { getConversationByTmuxSession, type Conversation } from '../database/conversations-db.js';
import { getTmuxCommand } from '../tmux.js';

const execFileAsync = promisify(execFile);

/**
 * The tmux session name the caller is running inside, or null if undeterminable.
 * Prefers the launcher-exported env var; falls back to asking tmux directly.
 */
export async function currentTmuxSession(): Promise<string | null> {
  const fromEnv = process.env['PANOPTICON_AGENT_ID'];
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  // Only meaningful when actually inside a tmux pane.
  if (!process.env['TMUX']) return null;
  try {
    const { command, args } = getTmuxCommand(['display-message', '-p', '#S']);
    const { stdout } = await execFileAsync(command, args, { timeout: 5000 });
    const session = stdout.trim();
    return session.length > 0 ? session : null;
  } catch {
    return null;
  }
}

/**
 * The conversation the caller is running inside, or null if undeterminable.
 */
export async function resolveCurrentConversation(): Promise<Conversation | null> {
  const session = await currentTmuxSession();
  if (!session) return null;
  return getConversationByTmuxSession(session);
}
