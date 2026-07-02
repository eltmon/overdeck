/**
 * Conversation Service (PAN-451)
 *
 * Provides JSONL session file discovery, parsing, and file watching for
 * structured conversation message rendering in Mission Control.
 *
 * All file I/O uses fs/promises (no sync calls).
 */

import { watch } from 'node:fs/promises';
import { parseConversationMessages } from './conversation/parser.js';
import {
  type ConversationActivitySummary,
  type LatestAssistantUsage,
  type ParseResult,
  type ParseState,
} from './conversation/types.js';

export type {
  ConversationActivitySummary,
  LatestAssistantUsage,
  ParseResult,
  ParseState,
} from './conversation/types.js';
export { summarizeConversationActivity } from './conversation/activity-summary.js';
export { contextUsageFromParseResult, computeContextUsage } from './conversation/context-usage.js';
export { findLastCompactBoundary } from './conversation/compact-boundary.js';
export { parseConversationMessages, parseEntireConversation, parseFromLastCompactBoundary } from './conversation/parser.js';
export { snapshotSessionFiles, discoverSessionFile } from './conversation/session-files.js';

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
