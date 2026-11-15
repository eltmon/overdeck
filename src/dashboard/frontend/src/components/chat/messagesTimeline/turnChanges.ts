// Per-user-turn grouping of a conversation's changes (PAN-5295 D2-5, D2-8).
//
// The server ties a commit to one assistant message (`turnId`) and an
// uncommitted file to the assistant messages that edited it (`turnIds`). One
// user turn can spread its changes across several of its assistant messages,
// so the turn card aggregates every change keyed to any assistant id of the
// turn and renders once, under the turn's last assistant message. Pure.

import type { ChangeCommit, ChangedFile, ConversationChanges, UncommittedFile } from '@overdeck/contracts';
import type { ChatMessage } from '../chat-types';

export interface TurnFileRow {
  file: ChangedFile;
  commit?: ChangeCommit;
  uncommitted?: UncommittedFile;
}

export interface TurnChanges {
  /** Last assistant id of the user turn: the card renders under this message. */
  anchorId: string;
  assistantIds: string[];
  /** Uncommitted first, then commits in response order, one row per path. */
  rows: TurnFileRow[];
  files: number;
  additions: number;
  deletions: number;
  commitsPushed: number;
  commitsLocal: number;
  uncommittedFiles: number;
}

type TurnMessage = Pick<ChatMessage, 'id' | 'role' | 'createdAt'>;

function timeOf(message: TurnMessage): number {
  const time = Date.parse(message.createdAt);
  return Number.isNaN(time) ? 0 : time;
}

/** User turns of `messages` (sorted by createdAt; 'user' starts a turn, 'system' does not end one). */
export function userTurns(messages: ReadonlyArray<TurnMessage>): Array<{ anchorId: string; assistantIds: string[] }> {
  // Array.prototype.sort is stable, so messages with equal times keep their order.
  const sorted = [...messages].sort((a, b) => timeOf(a) - timeOf(b));
  const turns: Array<{ anchorId: string; assistantIds: string[] }> = [];
  let current: string[] = [];
  const close = (): void => {
    if (current.length > 0) turns.push({ anchorId: current[current.length - 1], assistantIds: current });
    current = [];
  };
  for (const message of sorted) {
    if (message.role === 'user') close();
    else if (message.role === 'assistant') current.push(message.id);
  }
  close();
  return turns;
}

/** Cards keyed by anchor id; turns with no matching changes are absent. */
export function turnChangesByAnchor(messages: ReadonlyArray<TurnMessage>, changes: ConversationChanges | null): Map<string, TurnChanges> {
  const cards = new Map<string, TurnChanges>();
  if (!changes) return cards;
  for (const { anchorId, assistantIds } of userTurns(messages)) {
    const ids = new Set(assistantIds);
    const uncommitted = changes.uncommitted.filter((file) => file.turnIds.some((id) => ids.has(id)));
    const commits = changes.commits.filter((commit) => commit.turnId !== undefined && ids.has(commit.turnId));
    if (uncommitted.length === 0 && commits.length === 0) continue;

    const rows: TurnFileRow[] = [];
    const seen = new Set<string>();
    const add = (row: TurnFileRow): void => {
      if (seen.has(row.file.path)) return;
      seen.add(row.file.path);
      rows.push(row);
    };
    for (const file of uncommitted) add({ file, uncommitted: file });
    for (const commit of commits) for (const file of commit.files) add({ file, commit });

    cards.set(anchorId, {
      anchorId,
      assistantIds,
      rows,
      files: rows.length,
      additions: rows.reduce((sum, row) => sum + row.file.additions, 0),
      deletions: rows.reduce((sum, row) => sum + row.file.deletions, 0),
      commitsPushed: commits.filter((commit) => commit.pushed).length,
      commitsLocal: commits.filter((commit) => !commit.pushed).length,
      uncommittedFiles: rows.filter((row) => row.uncommitted).length,
    });
  }
  return cards;
}
