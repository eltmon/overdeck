/**
 * Single reader for the user/assistant text in a Codex rollout `event_msg`.
 *
 * Codex has written that text two different ways, and every surface that reads
 * a rollout — the chat-panel adapter, the transcript adapter, harness metadata,
 * enrichment, the cost parser — has to understand both. They used to each carry
 * their own `payload.type === 'user_message' || 'agent_message'` check, so the
 * CLI's rename broke all of them at once and silently (PAN-3781): the panel
 * rendered tool rows with no assistant text, message counts read 0, and
 * conversation search indexed nothing. This module is the one place that knows
 * the shapes.
 *
 * Legacy (cli ≥ 0.137.0, every rollout written before 2026-09-07):
 *
 *     { type: 'event_msg', payload: { type: 'user_message' | 'agent_message',
 *                                     message: '…' } }
 *
 * Current (cli ≥ 0.153.4): both events became one `item_completed` carrying a
 * `payload.item` whose `type` is the PascalCase variant name.
 *
 *     { type: 'event_msg', payload: { type: 'item_completed', item: {
 *         type: 'UserMessage' | 'AgentMessage',
 *         content: [{ type: 'text' | 'Text', text: '…' }],
 *         phase: 'commentary' | 'final_answer'   // AgentMessage only
 *     } } }
 *
 * The content `type` casing genuinely differs between the two variants —
 * `UserMessage` emits lowercase `text`, `AgentMessage` emits `Text` — so the
 * match is case-insensitive. Non-text parts (the image parts on an attachment
 * turn) carry no `text` and drop out.
 *
 * `item_completed` also reports `CommandExecution`, `Reasoning`, `ImageView`
 * and `Extension` items. Those are deliberately not returned here: tool
 * activity still arrives as `response_item` `custom_tool_call`/`function_call`,
 * which every caller already handles separately, so surfacing both would
 * double-count each tool row.
 *
 * `phase` is not used to filter. Codex narrates mid-turn ("Checking the branch
 * first.") as a `commentary` message before running tools and shows it in its
 * own TUI, exactly as the legacy `agent_message` stream did — callers that care
 * whether a turn ended decide that from trailing tool activity (PAN-3770), not
 * from the phase.
 */

/** A user or assistant turn recovered from one rollout `event_msg` entry. */
export interface CodexRolloutMessage {
  role: 'user' | 'assistant';
  /** Trimmed visible text. Never empty — an empty message yields undefined. */
  text: string;
  /**
   * `'commentary'` or `'final_answer'` on a current-format assistant message;
   * undefined for user turns and for every legacy-format message.
   */
  phase?: string;
}

interface RolloutEntryLike {
  type?: unknown;
  payload?: unknown;
}

interface PayloadLike {
  type?: unknown;
  message?: unknown;
  item?: unknown;
}

interface ItemLike {
  type?: unknown;
  content?: unknown;
  phase?: unknown;
}

/** Join the text parts of a current-format message item, case-insensitively. */
function itemText(item: ItemLike): string {
  if (!Array.isArray(item.content)) return '';
  return item.content
    .map((part) => (part && typeof part === 'object' ? (part as { type?: unknown; text?: unknown }) : undefined))
    .filter((part) => part && typeof part.text === 'string' && String(part.type).toLowerCase() === 'text')
    .map((part) => part!.text as string)
    .join('')
    .trim();
}

/**
 * Read the user/assistant turn out of one rollout entry, in either shape.
 *
 * Returns undefined for entries that are not `event_msg` message records and
 * for messages whose visible text is empty, so callers can branch on truthiness
 * without repeating the shape checks.
 */
export function readCodexRolloutMessage(entry: unknown): CodexRolloutMessage | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const { type, payload } = entry as RolloutEntryLike;
  if (type !== 'event_msg' || !payload || typeof payload !== 'object') return undefined;

  const { type: ptype, message, item } = payload as PayloadLike;

  // Legacy shape — clean text sits directly on the payload.
  if (ptype === 'user_message' || ptype === 'agent_message') {
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) return undefined;
    return { role: ptype === 'user_message' ? 'user' : 'assistant', text };
  }

  // Current shape — the message is an item_completed variant.
  if (ptype !== 'item_completed' || !item || typeof item !== 'object') return undefined;
  const itemLike = item as ItemLike;
  if (itemLike.type !== 'UserMessage' && itemLike.type !== 'AgentMessage') return undefined;
  const text = itemText(itemLike);
  if (!text) return undefined;
  return {
    role: itemLike.type === 'UserMessage' ? 'user' : 'assistant',
    text,
    ...(typeof itemLike.phase === 'string' ? { phase: itemLike.phase } : {}),
  };
}
