/**
 * PAN-5211 D20: move Codex bookmarks from counter-form message ids to offset-form ids, once.
 *
 * Codex message ids used to embed a parse counter (`codex-user-3`), which changes when the dashboard
 * reads only part of a transcript. They now embed the record's byte offset (`codex-user-@12345`). The
 * first bookmark list of a conversation that holds counter-form bookmarks streams its transcript from
 * byte 0 and counts rows exactly as the pre-PAN-5211 parser did, so each counter id maps to the record
 * that produced it. Ids it cannot map are left alone. A pass that finishes is recorded for the life of
 * the process; a pass that fails (no transcript yet, a read error) is tried again on the next list.
 */
import { open } from 'node:fs/promises';
import { readCodexRolloutMessage } from '../codex-rollout-message.js';
import { extractCodexToolOutput } from '../../dashboard/server/services/codex-conversation-parser.js';
import { RECORD_PARSE_MAX_BYTES, scrubImageDataUrls } from '../../dashboard/server/services/conversation/tool-result-bounds.js';
import { createTranscriptLineSplitter } from '../../dashboard/server/services/incremental-transcript-reader.js';
import { listConversationBookmarks, renameConversationBookmarkIds } from './conversation-bookmarks.js';
import { getConversationByName, type LegacyConversation as Conversation } from './conversations.js';
import { resolveSessionFile } from './conversation-reads.js';

const COUNTER_ID_RE = /^codex-(user|agent)-\d+$/;
const READ_CHUNK_BYTES = 1024 * 1024;
const OVERSIZED_HEAD_BYTES = 4096;
const OVERSIZED_CALL_RE = /"type":"(function_call|custom_tool_call)"/;
const OVERSIZED_OUTPUT_RE = /"type":"(function_call_output|custom_tool_call_output)"/;
const OVERSIZED_MESSAGE_RE = /"type":"(user_message|agent_message)"/;
const CALL_ID_RE = /"call_id":"([^"]+)"/;

const migrated = new Set<string>();
const inFlight = new Map<string, Promise<void>>();

export interface CodexBookmarkMigrationDeps {
  readonly resolveSessionFile: (conv: Conversation) => Promise<string | null>;
}

interface RecordLike {
  type?: unknown;
  payload?: { type?: unknown; call_id?: unknown; output?: unknown };
}

/**
 * The pre-PAN-5211 counter: +1 for each message, each tool call, and each non-empty output whose call it
 * has not seen. It keeps every call id (no window) and counts records over the parse limit by kind.
 */
function createLegacyCounter(wanted: ReadonlySet<string>, mapped: Map<string, string>) {
  const openCalls = new Set<string>();
  let counter = 0;
  const output = (callId: string, nonEmpty: boolean): void => {
    if (callId && openCalls.has(callId)) openCalls.delete(callId);
    else if (nonEmpty) counter += 1;
  };
  return (line: Buffer, offset: number): void => {
    if (line.length === 0) return;
    const scrubbed = scrubImageDataUrls(line);
    if (scrubbed.length > RECORD_PARSE_MAX_BYTES) {
      // Never parsed whole: classify it from its first bytes. An oversized message counts but cannot be
      // bookmarked under its new id (the parser shows a skipped row), so it maps to nothing.
      const head = scrubbed.toString('utf8', 0, OVERSIZED_HEAD_BYTES);
      const callId = CALL_ID_RE.exec(head)?.[1] ?? '';
      if (OVERSIZED_OUTPUT_RE.test(head)) output(callId, true);
      else if (OVERSIZED_CALL_RE.test(head)) { counter += 1; if (callId) openCalls.add(callId); }
      else if (head.includes('"type":"event_msg"') && OVERSIZED_MESSAGE_RE.test(head)) counter += 1;
      return;
    }
    let entry: RecordLike;
    try { entry = JSON.parse(scrubbed.toString('utf8')) as RecordLike; } catch { return; }
    if (!entry || typeof entry !== 'object' || !entry.payload || typeof entry.payload !== 'object') return;
    const ptype = entry.payload.type;
    if (entry.type === 'event_msg') {
      const message = readCodexRolloutMessage(entry);
      if (!message) return;
      counter += 1;
      const kind = message.role === 'user' ? 'user' : 'agent';
      const legacyId = `codex-${kind}-${counter}`;
      if (wanted.has(legacyId)) mapped.set(legacyId, `codex-${kind}-@${offset}`);
    } else if (entry.type === 'response_item') {
      const callId = typeof entry.payload.call_id === 'string' ? entry.payload.call_id : '';
      if (ptype === 'function_call' || ptype === 'custom_tool_call') {
        counter += 1;
        if (callId) openCalls.add(callId);
      } else if (ptype === 'function_call_output' || ptype === 'custom_tool_call_output') {
        output(callId, extractCodexToolOutput(entry.payload.output) !== '');
      }
    }
  };
}

/** Stream `file` from byte 0 and map each wanted counter id to its offset id. */
async function mapCounterIds(file: string, wanted: ReadonlySet<string>): Promise<Map<string, string>> {
  const mapped = new Map<string, string>();
  const count = createLegacyCounter(wanted, mapped);
  const splitter = createTranscriptLineSplitter(0, (line, location) => count(line, location.offset));
  const handle = await open(file, 'r');
  try {
    const chunk = Buffer.alloc(READ_CHUNK_BYTES);
    for (let offset = 0; mapped.size < wanted.size;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
      if (bytesRead === 0) break;
      splitter.write(chunk.subarray(0, bytesRead));
      offset += bytesRead;
    }
    if (mapped.size < wanted.size) splitter.flushComplete();
  } finally {
    await handle.close();
  }
  return mapped;
}

/** True when the pass finished (even with ids it could not map); false when it should run again. */
async function migrate(name: string, deps: CodexBookmarkMigrationDeps): Promise<boolean> {
  const conv = getConversationByName(name);
  if (!conv) return false;
  // Only the Codex parser ever produced `codex-(user|agent)-<n>` ids, so the id pattern selects
  // Codex conversations without a harness check.
  const wanted = new Set(listConversationBookmarks(name).map((b) => b.messageId).filter((id) => COUNTER_ID_RE.test(id)));
  if (wanted.size === 0) return true;
  const file = await deps.resolveSessionFile(conv);
  if (!file) return false;
  renameConversationBookmarkIds(name, [...await mapCounterIds(file, wanted)]);
  return true;
}

export async function migrateCodexCounterBookmarks(
  name: string,
  deps: CodexBookmarkMigrationDeps = { resolveSessionFile },
): Promise<void> {
  if (migrated.has(name)) return;
  const running = inFlight.get(name);
  if (running) return running;
  const job = (async () => {
    try {
      if (await migrate(name, deps)) migrated.add(name);
    } catch (error) {
      console.warn(`[bookmarks] Codex bookmark id migration failed for ${name}:`, error instanceof Error ? error.message : String(error));
    } finally {
      inFlight.delete(name);
    }
  })();
  inFlight.set(name, job);
  return job;
}

/** Test seam: forget which conversations were migrated. */
export function resetCodexBookmarkMigrationForTests(): void {
  migrated.clear();
  inFlight.clear();
}
