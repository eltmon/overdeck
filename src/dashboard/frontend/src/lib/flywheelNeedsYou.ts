/**
 * resolveNeedsYouAction (PAN-4751 FR-3) — decides what clicking the flywheel's
 * NEEDS YOU banner should do: reopen the pending AskUserQuestion dialog for
 * `conv-flywheel` when one is still open and unanswered, or just show the tick
 * that raised the line otherwise.
 */
import type { ConversationPendingInputRow } from './useDecisions';

// Inlined to avoid a lint:circular cycle with ./flywheelApi, which exports
// this same value as FLYWHEEL_CONVERSATION_NAME.
const FLYWHEEL_CONVERSATION_NAME = 'conv-flywheel';

export type NeedsYouAction = { kind: 'reopen-question'; toolUseId: string } | { kind: 'show-tick' };

export function resolveNeedsYouAction(
  rows: unknown,
  answeredToolUseIds: ReadonlySet<string>,
): NeedsYouAction {
  const list: ConversationPendingInputRow[] = Array.isArray(rows) ? rows : [];
  const flywheel = list.find((row) => row.name === FLYWHEEL_CONVERSATION_NAME);
  const toolUseId = flywheel?.pendingAskUserQuestion?.toolUseId;
  if (toolUseId && !answeredToolUseIds.has(toolUseId)) {
    return { kind: 'reopen-question', toolUseId };
  }
  return { kind: 'show-tick' };
}
