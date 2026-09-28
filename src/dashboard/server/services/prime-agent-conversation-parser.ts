/**
 * Prime Agent session JSONL → chat panel (PAN-3668 WI-18, FR-11, FR-18).
 *
 * Prime Agent writes the pi v3 session format (`session`, `message` with user /
 * assistant / toolResult roles, text / thinking / toolCall blocks), so it shares the
 * pi parser core in its `prime-agent` dialect. The dialect adds what Prime writes on
 * top of pi: `compaction` entries become compaction markers, assistant turns that end
 * with `stopReason: 'error' | 'aborted'` become error rows carrying `errorMessage`,
 * `child_usage_attributed` aggregates replace their target message's usage (D16), and
 * a turn is finished once the last assistant message's stopReason is not `toolUse`.
 * Other entry types (model_change, agent_status, session_state, …) are skipped.
 */
import type { ParseResult } from './conversation/types.js';
import { parsePiConversationMessages } from './pi-conversation-parser.js';

export function parsePrimeAgentConversationMessages(sessionFile: string): Promise<ParseResult> {
  return parsePiConversationMessages(sessionFile, { dialect: 'prime-agent' });
}
