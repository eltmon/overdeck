/**
 * Conversation Service (PAN-451)
 *
 * Provides JSONL session file discovery, parsing, and file watching for
 * structured conversation message rendering in Mission Control.
 *
 * All file I/O uses fs/promises (no sync calls).
 */

import { stat, watch } from 'node:fs/promises';
import { getHarnessBehavior } from '../../../lib/runtimes/behavior.js';
import { parseCodexConversationMessages } from './codex-conversation-parser.js';
import { findLastCompactBoundary } from './conversation/compact-boundary.js';
import { parseConversationMessages, parseFromLastCompactBoundary } from './conversation/parser.js';
import {
  type ConversationActivitySummary,
  type LatestAssistantUsage,
  type ParseResult,
  type ParseState,
} from './conversation/types.js';
import { isPiSessionFile, parsePiConversationMessages } from './pi-conversation-parser.js';
import { isOhmypiSessionFile, parseOhmypiConversationMessages } from './ohmypi-conversation-parser.js';

export type {
  ConversationActivitySummary,
  LatestAssistantUsage,
  ParseResult,
  ParseState,
} from './conversation/types.js';
export { contextUsageFromParseResult, computeContextUsage } from './conversation/context-usage.js';
export { findLastCompactBoundary } from './conversation/compact-boundary.js';
export { parseConversationMessages, parseEntireConversation, parseFromLastCompactBoundary } from './conversation/parser.js';
export { snapshotSessionFiles, discoverSessionFile } from './conversation/session-files.js';

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

export function gateSnapshotEmission(
  fileWasReset: boolean,
  newMessageCount: number,
  highWaterCount: number,
): { snapshot: boolean; highWaterCount: number; suppressedShrink: boolean } {
  if (!fileWasReset) {
    // Normal incremental delta — always a merge, never touches the high-water mark.
    return { snapshot: false, highWaterCount, suppressedShrink: false };
  }
  if (newMessageCount < highWaterCount) {
    // Transient truncate-rewrite read — downgrade to merge so the client keeps
    // its history. Do not lower the high-water mark.
    return { snapshot: false, highWaterCount, suppressedShrink: true };
  }
  // A genuine, non-shrinking full re-parse — safe to assert as the snapshot.
  return { snapshot: true, highWaterCount: newMessageCount, suppressedShrink: false };
}

// ─── File watcher ─────────────────────────────────────────────────────────────

export interface ConversationWatchHandle {
  stop: () => void;
}

/**
 * Watch a JSONL session file for appends. Calls `callback` with parse results
 * when new content is detected. Uses fs.watch with 500ms polling fallback.
 *
 * Returns a handle with `stop()` to clean up.
 */
export function watchConversation(
  sessionFile: string,
  callback: (result: ParseResult) => void | Promise<void>,
  options: { byteOffset?: number; priorState?: ParseState } = {},
): ConversationWatchHandle {
  let byteOffset = options.byteOffset ?? 0;
  let priorState: ParseState | undefined = options.priorState;
  let stopped = false;
  let isParsing = false;
  let abortController: AbortController | null = null;
  let pollInterval: ReturnType<typeof setTimeout> | null = null;

  async function handleChange(): Promise<void> {
    if (stopped || isParsing) return;
    isParsing = true;
    try {
      const result = await parseConversationMessages(sessionFile, byteOffset, priorState);
      if (result.byteOffset < byteOffset) {
        // File was truncated or rotated — reset to full re-parse
        byteOffset = 0;
        priorState = undefined;
        const fullResult = await parseConversationMessages(sessionFile, 0);
        if (fullResult.byteOffset > 0) {
          byteOffset = fullResult.byteOffset;
          priorState = {
            pendingToolUse: fullResult.pendingToolUse,
            unresolvedResults: fullResult.unresolvedResults,
            lastSequence: fullResult.lastSequence,
            planToolUseIds: fullResult.planToolUseIds,
            proposedPlan: fullResult.proposedPlan,
            latestAssistantUsage: fullResult.latestAssistantUsage,
            contextBoundaryOffset: fullResult.contextBoundaryOffset,
            permissionMode: fullResult.permissionMode,
            countedUsageIds: fullResult.countedUsageIds,
            fileEditsByAssistantId: fullResult.fileEditsByAssistantId,
            pendingAssistantId: fullResult.pendingAssistantId,
            orphanToolUseIds: fullResult.orphanToolUseIds,
          };
          // Include in-flight tools so the live view shows pending work
          const workLog = [...fullResult.workLog, ...fullResult.pendingToolUse.values()];
          await callback({ ...fullResult, workLog });
        }
      } else if (result.byteOffset > byteOffset) {
        byteOffset = result.byteOffset;
        priorState = {
          pendingToolUse: result.pendingToolUse,
          unresolvedResults: result.unresolvedResults,
          lastSequence: result.lastSequence,
          planToolUseIds: result.planToolUseIds,
          proposedPlan: result.proposedPlan,
          latestAssistantUsage: result.latestAssistantUsage,
          contextBoundaryOffset: result.contextBoundaryOffset,
          permissionMode: result.permissionMode,
          countedUsageIds: result.countedUsageIds,
          fileEditsByAssistantId: result.fileEditsByAssistantId,
          pendingAssistantId: result.pendingAssistantId,
          orphanToolUseIds: result.orphanToolUseIds,
        };
        // Include in-flight tools so the live view shows pending work
        const workLog = [...result.workLog, ...result.pendingToolUse.values()];
        await callback({ ...result, workLog });
      }
    } catch {
      // File may have been rotated or is temporarily unavailable
    } finally {
      isParsing = false;
    }
  }

  // Try fs.watch first (inotify on Linux)
  // Create AbortController synchronously so stop() can always abort,
  // even if called before the async startWatch() body runs.
  abortController = new AbortController();

  async function startWatch(): Promise<void> {
    try {
      const watcher = watch(sessionFile, { signal: abortController!.signal });
      for await (const _event of watcher) {
        await handleChange();
      }
    } catch (err) {
      if (!stopped) {
        // Fallback to polling on watch failure
        startPolling();
      }
    }
  }

  function startPolling(): void {
    async function poll(): Promise<void> {
      if (stopped) return;
      await handleChange();
      pollInterval = setTimeout(poll, 500);
    }
    pollInterval = setTimeout(poll, 500);
  }

  // Start watch; polling is only a fallback when fs.watch itself fails.
  startWatch();

  return {
    stop() {
      stopped = true;
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      if (pollInterval !== null) {
        clearTimeout(pollInterval);
        pollInterval = null;
      }
    },
  };
}
