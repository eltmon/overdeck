import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getOverdeckHome } from './paths.js';

/**
 * PAN-1989: durably record a Claude session id in the agent's append-only
 * sessions.json the moment the system learns it.
 *
 * Background: a work agent's resumable session id was only durable if the
 * PostToolUse heartbeat hook had written sessions.json (first tool call) or
 * auto-suspend had written session.id. A session that boots but is stopped
 * before its first tool — kickoff never delivered, or a reboot mid-run — left
 * the id only in the EPHEMERAL in-memory runtime snapshot, which a dashboard
 * restart or reboot rebuilds from sources (state.json + tmux) that don't carry
 * the session id. The agent then resolves to "No saved session ID found" and
 * goes troubled even though its JSONL transcript is intact on disk.
 *
 * Calling this from the AgentStateService event sink (the single convergence
 * point for every model_set event, hook-emitted or server-emitted) makes the
 * pointer durable from the moment it is learned. The append-only list may
 * accumulate aborted/empty ids; the resolver picks the freshest id with a real
 * transcript, so empties never shadow the truth. De-dupes; never throws.
 *
 * Lives in its own module (not agents.ts) so the dashboard event sink can import
 * it without pulling the whole agents.ts graph — avoids an ESM import cycle.
 */
export function appendSessionIdToHistory(agentId: string, sessionId: string): void {
  if (!sessionId || !sessionId.trim()) return;
  try {
    const dir = join(getOverdeckHome(), 'agents', agentId);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'sessions.json');
    let list: string[] = [];
    if (existsSync(file)) {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(parsed)) list = parsed.filter((v): v is string => typeof v === 'string');
    }
    if (list.includes(sessionId)) return;
    list.push(sessionId);
    writeFileSync(file, JSON.stringify(list));
  } catch {
    /* non-fatal — bookkeeping only */
  }
}
