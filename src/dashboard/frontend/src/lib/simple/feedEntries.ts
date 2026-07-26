/**
 * PAN-3090 — narrative feed shaping for the simple issue page.
 *
 * Pure presentation mapping from the conversation-messages stream payload
 * ({ messages, workLog }) to narrative-feed entries. No React, no fetching —
 * unit-tested offline in lib/__tests__/simple-feed.test.ts.
 *
 * Every transcript item has a home (no-loss): the first user message (the
 * machine kickoff prompt) becomes a one-line system entry with the raw text
 * preserved for the disclosure; later user messages become neutral replies;
 * assistant messages become prose rows; tool calls become one-line actions.
 */
import type { ChatMessage, WorkLogEntry } from '../../components/chat/chat-types';
import { SIMPLE_STRINGS } from './strings';

export type SimpleFeedEntry =
  | { kind: 'system'; id: string; createdAt: string; text: string; raw: string }
  | { kind: 'say'; id: string; createdAt: string; preview: string; full: string; clamp: boolean }
  | { kind: 'action'; id: string; createdAt: string; text: string; files?: readonly string[]; failed: boolean }
  | { kind: 'reply'; id: string; createdAt: string; text: string };

const PREVIEW_CHARS = 280;
const COMMAND_CHARS = 80;
const SHOWN_FILES = 2;

/** Tool name → past-tense verb for one-line actions (detail follows). */
const TOOL_VERB: Record<string, string> = {
  Bash: 'Ran',
  Read: 'Read',
  Edit: 'Edited',
  MultiEdit: 'Edited',
  Write: 'Wrote',
  NotebookEdit: 'Edited',
  Glob: 'Searched',
  Grep: 'Searched',
  LS: 'Listed files in',
  WebFetch: 'Fetched',
  WebSearch: 'Searched the web for',
  TodoWrite: 'Updated the task list',
};

/** Tool name → standalone phrase when the server sent no input summary. */
const TOOL_PHRASE: Record<string, string> = {
  Bash: 'Ran a command',
  Read: 'Read a file',
  Edit: 'Edited a file',
  MultiEdit: 'Edited a file',
  Write: 'Wrote a file',
  NotebookEdit: 'Edited a file',
  Glob: 'Searched the code',
  Grep: 'Searched the code',
  LS: 'Listed files',
  WebFetch: 'Fetched a page',
  WebSearch: 'Searched the web',
  TodoWrite: 'Updated the task list',
};

/** Markdown → plain text for clamped previews. Deliberately shallow. */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' … ') // fenced code blocks
    .replace(/`([^`]*)`/g, '$1') // inline code keeps its text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // headers
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, '$1$2') // emphasis
    .replace(/^\s*[-*+]\s+/gm, '') // bullets
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tool results that failed arrive with tone 'tool' but an "Error: …" detail. */
function isFailedTool(entry: WorkLogEntry): boolean {
  return entry.tone === 'error' || /^error[:\s]/i.test(entry.detail ?? '');
}

function shapeAction(entry: WorkLogEntry): string {
  const files = entry.changedFiles ?? [];
  if (files.length > 0) {
    const shown = files.slice(0, SHOWN_FILES).join(', ');
    const more = files.length > SHOWN_FILES ? ` (+${files.length - SHOWN_FILES} more)` : '';
    return `Edited ${shown}${more}`;
  }
  if (entry.command) {
    const cmd = entry.command.length > COMMAND_CHARS ? `${entry.command.slice(0, COMMAND_CHARS)}…` : entry.command;
    return `Ran ${cmd}`;
  }
  // A failed tool result already narrates itself ("Error: Exit code 1 …") —
  // prepend no verb ("Ran Error: …" is nonsense) and let the row go red.
  if (isFailedTool(entry) && entry.detail) return entry.detail;
  // The server's collapsed-row summary (format-tool-input) is a one-liner
  // already — a command first line, a basename, a pattern. Verb + detail
  // reads as an action ("Ran npm test"); bare tool names never stand alone.
  const verb = TOOL_VERB[entry.label];
  if (verb && entry.detail) return `${verb} ${entry.detail}`;
  if (entry.detail) return entry.detail;
  return TOOL_PHRASE[entry.label] ?? entry.label;
}

export function buildSimpleFeedEntries(input: {
  messages: readonly ChatMessage[];
  workLog: readonly WorkLogEntry[];
  issueTitle: string;
}): SimpleFeedEntry[] {
  const entries: SimpleFeedEntry[] = [];
  let kickoffSeen = false;

  for (const m of input.messages) {
    if (m.role === 'user' && !kickoffSeen) {
      kickoffSeen = true;
      entries.push({
        kind: 'system',
        id: `sys-${m.id}`,
        createdAt: m.createdAt,
        text: SIMPLE_STRINGS.issue.taskStartedPrefix + input.issueTitle.toLowerCase(),
        raw: m.text,
      });
      continue;
    }
    if (m.role === 'user') {
      entries.push({ kind: 'reply', id: `re-${m.id}`, createdAt: m.createdAt, text: m.text });
      continue;
    }
    if (m.role === 'assistant') {
      const plain = toPlainText(m.text);
      entries.push({
        kind: 'say',
        id: `say-${m.id}`,
        createdAt: m.createdAt,
        preview: plain.length > PREVIEW_CHARS ? `${plain.slice(0, PREVIEW_CHARS)}…` : plain,
        full: m.text,
        clamp: m.text.length > PREVIEW_CHARS,
      });
    }
  }

  for (const w of input.workLog) {
    // Phase markers, not content: the operator transcript uses these to drive
    // its working spinner; as feed rows they are noise ("thinking", "thinking").
    if (w.tone === 'thinking') continue;
    entries.push({
      kind: 'action',
      id: `act-${w.id}`,
      createdAt: w.createdAt,
      text: shapeAction(w),
      files: w.changedFiles,
      failed: isFailedTool(w),
    });
  }

  // Chronological merge; Array.prototype.sort is stable in modern JS, so
  // equal timestamps keep stream order.
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const ta = new Date(a.entry.createdAt).getTime();
      const tb = new Date(b.entry.createdAt).getTime();
      if (ta !== tb) return ta - tb;
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}
