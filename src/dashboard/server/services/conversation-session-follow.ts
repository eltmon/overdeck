/**
 * Follow a conversation's current Claude session for a live transcript stream
 * (PAN-2652). Opens the stream on the resolved file, then, on every
 * session-changed notification from the write door
 * (setConversationClaudeSessionId), re-resolves and switches; the first
 * snapshot from a switched file carries reset: true so a shorter fork replaces
 * the view. The listener is registered before the first open, so a change that
 * lands while that open reads the row is never missed.
 */
import { Effect, Queue, Stream } from 'effect';

import { onConversationSessionChanged } from '../../../lib/overdeck/conversation-session-events.js';
import { resolveConversationClaudeSessionId } from '../../../lib/overdeck/conversation-claude-session.js';
import type { LegacyConversation } from '../../../lib/overdeck/conversations.js';
import { sessionFilePath } from '../../../lib/runtimes/storage/claude-code.js';
import { subagentTranscriptPath } from './conversation/subagents.js';
import { isPiSessionFile } from './pi-conversation-parser.js';

export function followConversationSession<E, R, Ev>(
  conversationName: string,
  open: (switched: boolean) => Stream.Stream<Ev, E, R>,
): Stream.Stream<Ev, E, R> {
  const switches = Stream.callback<boolean>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const off = onConversationSessionChanged(conversationName, () => {
          try { Queue.offerUnsafe(queue, true); } catch { /* disconnected */ }
        });
        Queue.offerUnsafe(queue, false);
        return off;
      }),
      (off) => Effect.sync(off),
    ),
  );
  return switches.pipe(Stream.switchMap(open));
}

/**
 * The Claude transcript a conversation stream reads: the resolved session's
 * file, or its subagent transcript when `agentId` is set. Null when no session
 * resolves, and for Pi session files, which use a different JSONL schema and
 * must not be routed through the Claude-only incremental watcher.
 */
export async function resolveConversationTranscriptFile(
  conv: LegacyConversation,
  agentId?: string,
): Promise<string | null> {
  const sessionId = await resolveConversationClaudeSessionId(conv);
  const parentSessionFile = sessionId ? sessionFilePath(conv.cwd, sessionId) : null;
  const sessionFile = parentSessionFile && agentId ? subagentTranscriptPath(parentSessionFile, agentId) : parentSessionFile;
  return sessionFile && !isPiSessionFile(sessionFile) ? sessionFile : null;
}
