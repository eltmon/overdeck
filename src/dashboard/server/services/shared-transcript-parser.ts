/** Coalesce full-parser jobs and reuse unchanged snapshots across browser subscribers. */
import { stat } from 'node:fs/promises';
import type { ParseResult, ParseState } from './conversation/types.js';
import { runDashboardDbJob } from './dashboard-db-task.js';
import {
  estimateParseResultChars,
  TRANSCRIPT_CACHE_MAX_RETAINED_CHARS,
  TRANSCRIPT_ENTRY_MAX_RETAINED_CHARS,
} from './conversation/tool-result-bounds.js';

type Parser = 'pi' | 'ohmypi' | 'codex' | 'acp' | 'muse' | 'kimi' | 'prime-agent' | 'claude-initial';
interface CachedParse {
  signature: string;
  /** PAN-5211: retained characters of the settled result; 0 while the job is pending. */
  retainedChars: number;
  result: Promise<ParseResult>;
}
const MAX_SNAPSHOTS = 8;
const snapshots = new Map<string, CachedParse>();

/** A cached snapshot is shared; the incremental parser mutates priorState containers in place. */
export function parseStateFromSnapshot(initial: ParseResult): ParseState {
  return {
    pendingToolUse: new Map(initial.pendingToolUse),
    unresolvedResults: new Map(initial.unresolvedResults),
    lastSequence: initial.lastSequence,
    planToolUseIds: new Set(initial.planToolUseIds),
    proposedPlan: initial.proposedPlan,
    latestAssistantUsage: initial.latestAssistantUsage,
    observedEffort: initial.observedEffort,
    contextBoundaryOffset: initial.contextBoundaryOffset,
    permissionMode: initial.permissionMode,
    countedUsageIds: new Set(initial.countedUsageIds),
    fileEditsByAssistantId: new Map([...(initial.fileEditsByAssistantId ?? [])].map(([id, edits]) => [id, [...edits]])),
    pendingAssistantId: initial.pendingAssistantId,
    orphanToolUseIds: new Set(initial.orphanToolUseIds),
  };
}

export function sharedTranscriptParser(parser: Parser) {
  return async (sessionFile: string): Promise<ParseResult> => {
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(sessionFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // A freshly spawned conversation subscribes before its transcript exists.
        // The worker parser tolerates this (returns an empty result) and
        // watchConversation then polls, so dispatch uncached rather than throw.
        return runDashboardDbJob<ParseResult>('parseTranscriptSnapshot', { sessionFile, parser });
      }
      throw error;
    }
    const key = `${parser}:${sessionFile}`;
    const signature = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
    const cached = snapshots.get(key);
    if (cached?.signature === signature) {
      snapshots.delete(key);
      snapshots.set(key, cached);
      return cached.result;
    }
    const result = runDashboardDbJob<ParseResult>('parseTranscriptSnapshot', { sessionFile, parser });
    const entry: CachedParse = { signature, retainedChars: 0, result };
    snapshots.delete(key);
    snapshots.set(key, entry);
    let parsed: ParseResult;
    try { parsed = await result; }
    catch (error) {
      if (snapshots.get(key) === entry) snapshots.delete(key);
      throw error;
    }
    // PAN-5211: budgets count retained characters. A result over the hard cap is returned but
    // not kept, so concurrent subscribers share it only while its job is pending.
    entry.retainedChars = estimateParseResultChars(parsed);
    if (entry.retainedChars > TRANSCRIPT_ENTRY_MAX_RETAINED_CHARS && snapshots.get(key) === entry) snapshots.delete(key);
    let retained = 0;
    for (const item of snapshots.values()) retained += item.retainedChars;
    for (const [oldKey, old] of snapshots) {
      if (snapshots.size <= MAX_SNAPSHOTS && retained <= TRANSCRIPT_CACHE_MAX_RETAINED_CHARS) break;
      if (oldKey === key) continue;
      retained -= old.retainedChars;
      snapshots.delete(oldKey);
    }
    return parsed;
  };
}
