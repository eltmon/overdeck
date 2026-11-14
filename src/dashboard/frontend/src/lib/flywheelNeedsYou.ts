/**
 * resolveNeedsYouAction (PAN-4751 FR-3) — decides what clicking the flywheel's
 * NEEDS YOU banner should do: reopen the pending AskUserQuestion dialog for
 * `conv-flywheel` when one is still open and unanswered, or just show the tick
 * that raised the line otherwise. buildNeedsYouCards (PAN-5283) turns the
 * needs-you items into the Status tab's action cards.
 */
import type { FlywheelInFlightRow, FlywheelLastTick } from '@overdeck/contracts';

import { needsYouRows } from '../components/flywheel/needsYouRows';
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

// ─── Needs-you action cards (PAN-5283 FR-8, D14) ─────────────────────────────

export type NeedsYouCardAction = 'waive-test-removal' | 'start-issue' | 'answer-agent';

export interface NeedsYouCard {
  key: string;
  /** The question as the loop wrote it, or the row's blocker sentence. */
  text: string;
  /** `text` without its trailing `<https://…>` target. */
  label: string;
  target?: string;
  /** Why: the first-raised tick message's prose (D18). */
  context?: string;
  firstRaisedTick?: number;
  firstRaisedAt?: string;
  messageId?: string;
  /** The in-flight issue a structured action belongs to. */
  issueId?: string;
  action?: NeedsYouCardAction;
}

const ISSUE_ID_RE = /\b[A-Z]{2,}-\d+\b/g;

/**
 * One card per needs-you item, plus one per in-flight row whose blocker
 * carries a structured action the loop did not name (D14). A tick item that
 * names an in-flight issue with an action becomes one merged card: the tick
 * text is the question and the row's action is attached. Buttons come only
 * from those structured actions, never from parsing free text.
 */
export function buildNeedsYouCards(
  tick: FlywheelLastTick | null | undefined,
  inFlight: readonly FlywheelInFlightRow[],
): NeedsYouCard[] {
  const actionRows = new Map<string, FlywheelInFlightRow>();
  for (const row of inFlight) {
    if (row.blocker?.action) actionRows.set(row.issueId.toUpperCase(), row);
  }
  const claimed = new Set<string>();
  const cards: NeedsYouCard[] = [];
  for (const row of tick ? needsYouRows(tick) : []) {
    const named = (row.label.match(ISSUE_ID_RE) ?? []).map((id) => id.toUpperCase());
    const issueId = named.find((id) => actionRows.has(id) && !claimed.has(id));
    if (issueId) claimed.add(issueId);
    const action = issueId ? actionRows.get(issueId)?.blocker?.action : undefined;
    cards.push({ ...row, ...(issueId && action ? { issueId, action } : {}) });
  }
  for (const [issueId, row] of actionRows) {
    if (claimed.has(issueId) || !row.blocker?.action) continue;
    const text = `${row.issueId}: ${row.blocker.text}`;
    cards.push({ key: `row:${issueId}`, text, label: text, issueId: row.issueId, action: row.blocker.action });
  }
  return cards;
}
