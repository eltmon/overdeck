/**
 * PAN-5211 D20: move Codex bookmarks from counter-form message ids to offset-form ids, once.
 *
 * Codex message ids used to embed a parse counter (`codex-user-3`), which changes when the dashboard
 * reads only part of a transcript. They now embed the record's byte offset (`codex-user-@12345`). The
 * first bookmark list of a Codex conversation streams its transcript from byte 0, maps each wanted
 * counter id to its offset id through the accumulator's `onRowCreated`, and rewrites the bookmark.
 * Ids it cannot map are left alone. It runs at most once per conversation per process.
 */
import { open } from 'node:fs/promises';
import { createCodexConversationAccumulator } from '../../dashboard/server/services/codex-conversation-parser.js';
import {
  createTranscriptLineSplitter,
  pushTranscriptLine,
} from '../../dashboard/server/services/incremental-transcript-reader.js';
import { listConversationBookmarks, renameConversationBookmarkId } from './conversation-bookmarks.js';
import { getConversationByName, type LegacyConversation as Conversation } from './conversations.js';
import { resolveSessionFile } from './conversation-reads.js';

const COUNTER_ID_RE = /^codex-(user|agent)-\d+$/;
const READ_CHUNK_BYTES = 1024 * 1024;

const migrated = new Set<string>();

export interface CodexBookmarkMigrationDeps {
  readonly resolveSessionFile: (conv: Conversation) => Promise<string | null>;
}

/** Stream `file` from byte 0 and map each wanted counter id to its offset id. */
async function mapCounterIds(file: string, wanted: ReadonlySet<string>): Promise<Map<string, string>> {
  const mapped = new Map<string, string>();
  const parser = createCodexConversationAccumulator(file, {
    historyStartOffset: 0,
    onRowCreated: (legacyId, id) => { if (wanted.has(legacyId)) mapped.set(legacyId, id); },
  });
  const splitter = createTranscriptLineSplitter(0, (line, location) => pushTranscriptLine(parser, line, location));
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

export async function migrateCodexCounterBookmarks(
  name: string,
  deps: CodexBookmarkMigrationDeps = { resolveSessionFile },
): Promise<void> {
  if (migrated.has(name)) return;
  const conv = getConversationByName(name);
  if (!conv || conv.harness !== 'codex') return;
  migrated.add(name);
  try {
    const wanted = new Set(listConversationBookmarks(name).map((b) => b.messageId).filter((id) => COUNTER_ID_RE.test(id)));
    if (wanted.size === 0) return;
    const file = await deps.resolveSessionFile(conv);
    if (!file) return;
    for (const [fromId, toId] of await mapCounterIds(file, wanted)) renameConversationBookmarkId(name, fromId, toId);
  } catch (error) {
    console.warn(`[bookmarks] Codex bookmark id migration failed for ${name}:`, error instanceof Error ? error.message : String(error));
  }
}

/** Test seam: forget which conversations were migrated. */
export function resetCodexBookmarkMigrationForTests(): void {
  migrated.clear();
}
