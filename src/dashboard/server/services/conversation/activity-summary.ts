import { stat } from 'node:fs/promises';
import { getHarnessBehavior } from '../../../../lib/runtimes/behavior.js';
import { parseCodexConversationMessages } from '../codex-conversation-parser.js';
import { isOhmypiSessionFile, parseOhmypiConversationMessages } from '../ohmypi-conversation-parser.js';
import { isPiSessionFile, parsePiConversationMessages } from '../pi-conversation-parser.js';
import { parseFromLastCompactBoundary } from './parser.js';
import type { ConversationActivitySummary } from './types.js';

/**
 * PAN-1635: a conversation whose JSONL hasn't been written in this long is no
 * longer "working" — even if its last entry is a trailing user/meta line (e.g. a
 * post-compaction summary whose follow-up prompt was eaten by the compaction).
 * Generous enough not to flap a slow-but-live turn; finite so a stranded session
 * can't spin forever.
 */
const WORKING_STALENESS_MS = 180_000;

/** In-memory cache mapping sessionFile path → { mtimeMs, size, summary } */
const ACTIVITY_SUMMARY_CACHE_MAX = 100;
const activitySummaryCache = new Map<string, { mtimeMs: number; size: number; summary: ConversationActivitySummary }>();

export async function summarizeConversationActivity(
  sessionFile: string,
  options: { harness?: string | null } = {},
): Promise<ConversationActivitySummary> {
  const fileStats = await stat(sessionFile);
  const cacheKey = `${options.harness ?? 'claude-code'}:${sessionFile}`;
  const behavior = getHarnessBehavior(options.harness as Parameters<typeof getHarnessBehavior>[0]);
  const cached = activitySummaryCache.get(cacheKey);
  if (cached && cached.mtimeMs === fileStats.mtimeMs && cached.size === fileStats.size) {
    return cached.summary;
  }

  const parsed = behavior.transcriptKind === 'codex-rollout-jsonl' ? await parseCodexConversationMessages(sessionFile)
    : behavior.transcriptKind === 'ohmypi-jsonl' || isOhmypiSessionFile(sessionFile) ? await parseOhmypiConversationMessages(sessionFile)
    : isPiSessionFile(sessionFile) ? await parsePiConversationMessages(sessionFile)
      // Parse from the last compact boundary instead of the full file — avoids
      // re-reading potentially megabytes of history on every list enrichment tick.
      // Pass an empty priorState so pendingToolUse stays populated rather than being
      // flushed into workLog. This lets us detect genuinely pending tools.
      : await parseFromLastCompactBoundary(
          sessionFile,
          { pendingToolUse: new Map(), unresolvedResults: new Map(), lastSequence: 0 },
        );
  const { messages, streaming, pendingToolUse, workLog, mtimeMs } = parsed;
  const lastMsg = messages[messages.length - 1];
  // Agent is idle only when the last message is an assistant message with a terminal
  // completedAt (stop_reason was end_turn/max_tokens/stop_sequence). Any other state
  // — empty history, last message is user (tool result or prompt), or last message is
  // an assistant still streaming / waiting on tool_use — means the agent is working.
  //
  // PAN-1635: guard on file recency. After a compaction the only post-boundary
  // entries are user-role meta lines (compact summary, /compact echoes) with no
  // following assistant turn, so the raw heuristic below pegs isWorking true
  // forever. A session whose JSONL has been idle for WORKING_STALENESS_MS is not
  // working — mirrors the `fileRecent` guards on `streaming` and `currentTool`.
  // The window is generous (covers a long compaction / deep think that writes
  // nothing for a while); during a real in-progress compaction the PreCompact
  // hook's activity event keeps the card "working" independently.
  const workingFileRecent = Date.now() - mtimeMs < WORKING_STALENESS_MS;
  const isWorking = workingFileRecent && (
    messages.length === 0 ||
    lastMsg?.role === 'user' ||
    (lastMsg?.role === 'assistant' && !lastMsg.completedAt));

  // Find the most recent pending tool (tool_use sent but tool_result not yet received).
  // pendingToolUse holds the actual unpaired tool_uses, so this works correctly for
  // parallel tool calls where multiple tools are in flight simultaneously.
  // Time-bound: if the file hasn't been modified in 30s, the agent has likely crashed
  // and pending tools are stale — don't report a stale currentTool.
  const fileRecent = Date.now() - mtimeMs < 30_000;

  let currentTool: string | null = null;
  if (fileRecent) {
    let maxSequence = -1;
    for (const entry of pendingToolUse.values()) {
      if (entry.toolTitle && (entry.sequence ?? -1) > maxSequence) {
        maxSequence = entry.sequence ?? -1;
        currentTool = entry.toolTitle;
      }
    }
    if (!currentTool && behavior.transcriptKind === 'codex-rollout-jsonl') {
      for (const entry of workLog) {
        if (entry.tone === 'tool' && !entry.result && (entry.sequence ?? -1) > maxSequence) {
          maxSequence = entry.sequence ?? -1;
          currentTool = entry.label;
        }
      }
    }
  }

  const summary: ConversationActivitySummary = { messages, streaming, isWorking, currentTool };
  activitySummaryCache.set(cacheKey, { mtimeMs, size: fileStats.size, summary });
  if (activitySummaryCache.size > ACTIVITY_SUMMARY_CACHE_MAX) {
    const firstKey = activitySummaryCache.keys().next().value;
    if (firstKey !== undefined) {
      activitySummaryCache.delete(firstKey);
    }
  }
  return summary;
}
