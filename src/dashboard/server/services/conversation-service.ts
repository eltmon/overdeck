/**
 * Conversation Service (PAN-451)
 *
 * Provides JSONL session file discovery, parsing, and file watching for
 * structured conversation message rendering in Mission Control.
 *
 * All file I/O uses fs/promises (no sync calls).
 */

import { stat, watch, open } from 'node:fs/promises';
import type { ContextUsage } from '@overdeck/contracts';
import { MODEL_CAPABILITIES, resolveModelIdSync } from '../../../lib/model-capabilities.js';
import { getHarnessBehavior } from '../../../lib/runtimes/behavior.js';
import { parseCodexConversationMessages } from './codex-conversation-parser.js';
import { findLastCompactBoundary } from './conversation/compact-boundary.js';
import { parseConversationMessages, parseFromLastCompactBoundary } from './conversation/parser.js';
import {
  type ConversationActivitySummary,
  type JsonlEntry,
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
export { findLastCompactBoundary } from './conversation/compact-boundary.js';
export { parseConversationMessages, parseEntireConversation, parseFromLastCompactBoundary } from './conversation/parser.js';
export { snapshotSessionFiles, discoverSessionFile } from './conversation/session-files.js';

type ModelCapability = (typeof MODEL_CAPABILITIES)[keyof typeof MODEL_CAPABILITIES];

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

/**
 * Compute "how full is the context window right now?" from the JSONL.
 *
 * Approach (matches Claude Code's terminal indicator):
 *   1. Find the last compact boundary so we only count tokens in the current
 *      window (post-compaction). For never-compacted sessions, scan the whole
 *      file.
 *   2. Find the last assistant message after the boundary with `usage` data.
 *   3. Sum `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`
 *      from that message — those are the tokens the model actually saw on
 *      its most recent turn, i.e. the live context size.
 *   4. Compare against the model's context window. If observed input ever
 *      exceeded the model's default (e.g. Claude Code 1M extended-context
 *      mode for Opus / Sonnet), promote the effective window to 1M.
 *
 * Previous implementation used `fileBytes / 4` as a token estimate. That
 * counts every byte of every tool result, MCP payload, and cached file
 * content in the JSONL, which routinely overshoots actual `input_tokens` by
 * 4-10x. Removed.
 *
 * Returns null when the model is unknown. Returns a zero-token snapshot when
 * the active window has no assistant usage yet.
 */
function resolveContextCapability(model: string | null): ModelCapability | null {
  const normalizedModel = model?.trim();
  if (!normalizedModel) return null;

  const resolvedModel = resolveModelIdSync(normalizedModel);
  return Object.prototype.hasOwnProperty.call(MODEL_CAPABILITIES, resolvedModel)
    ? MODEL_CAPABILITIES[resolvedModel as keyof typeof MODEL_CAPABILITIES]
    : null;
}

function buildContextUsage(
  capability: ModelCapability,
  activeBytes: number,
  usageSummary: LatestAssistantUsage | null,
): ContextUsage {
  if (!usageSummary) {
    // No assistant message with usage yet — return zeros against the
    // declared window so the meter renders an empty ring instead of nothing.
    return {
      activeBytes,
      estimatedTokens: 0,
      contextWindow: capability.contextWindow,
      percentUsed: 0,
    };
  }

  // input + cache_read + cache_creation = total context the model received
  // on the last turn. output_tokens is the next-turn input from the model's
  // perspective, but for "how full is my window NOW?" the input side is the
  // honest answer — Claude Code's terminal uses the same convention.
  const liveContextTokens =
    usageSummary.lastInputTokens +
    usageSummary.lastCacheReadTokens +
    usageSummary.lastCacheCreationTokens;

  // 1M-context detection. Claude Code's extended-context mode (the
  // `context-1m-2025-08-07` beta) lets Opus / Sonnet see up to 1,000,000
  // tokens. We can't read the request headers, but if we've ever seen the
  // model accept more than its default window we know extended context is
  // active. Round up to the next plausible tier rather than guessing.
  const observedCeiling = Math.max(usageSummary.maxObservedInputTokens, liveContextTokens);
  const effectiveContextWindow =
    observedCeiling > capability.contextWindow
      ? Math.max(1_000_000, capability.contextWindow)
      : capability.contextWindow;

  const percentUsed = Math.min(
    100,
    Math.max(0, (liveContextTokens / effectiveContextWindow) * 100),
  );

  return {
    activeBytes,
    estimatedTokens: liveContextTokens,
    contextWindow: effectiveContextWindow,
    percentUsed,
    lastInputTokens: usageSummary.lastInputTokens,
    lastCacheReadTokens: usageSummary.lastCacheReadTokens,
    lastCacheCreationTokens: usageSummary.lastCacheCreationTokens,
    maxObservedInputTokens: usageSummary.maxObservedInputTokens,
    lastModel: usageSummary.lastModel,
    lastTurnAt: usageSummary.lastTimestamp,
  };
}

export function contextUsageFromParseResult(
  result: Pick<ParseResult, 'contextActiveBytes' | 'latestAssistantUsage'>,
  model: string | null,
): ContextUsage | null {
  const capability = resolveContextCapability(model);
  if (!capability) return null;
  return buildContextUsage(capability, result.contextActiveBytes, result.latestAssistantUsage);
}

export async function computeContextUsage(sessionFile: string, model: string | null): Promise<ContextUsage | null> {
  const capability = resolveContextCapability(model);
  if (!capability) return null;

  const boundaryOffset = await findLastCompactBoundary(sessionFile);
  const fileStats = await stat(sessionFile);
  const activeBytes = Math.max(0, fileStats.size - boundaryOffset);

  const usageSummary = await readLatestAssistantUsage(sessionFile, boundaryOffset, activeBytes);
  return buildContextUsage(capability, activeBytes, usageSummary);
}

/**
 * Stream the JSONL between `boundaryOffset` and EOF, returning usage data
 * from the most recent assistant message + the highest input_tokens ever
 * observed (used for 1M-context detection).
 *
 * Async, line-buffered. Skips malformed lines silently.
 */
async function readLatestAssistantUsage(
  sessionFile: string,
  boundaryOffset: number,
  activeBytes: number,
): Promise<LatestAssistantUsage | null> {
  if (activeBytes <= 0) return null;
  const fh = await open(sessionFile, 'r');
  try {
    const buffer = Buffer.alloc(activeBytes);
    await fh.read(buffer, 0, activeBytes, boundaryOffset);
    const lines = buffer.toString('utf-8').split('\n');

    let result: LatestAssistantUsage | null = null;
    let maxObservedInputTokens = 0;

    for (const line of lines) {
      if (!line.trim()) continue;
      let entry: JsonlEntry;
      try {
        entry = JSON.parse(line.replace(/\r$/, '')) as JsonlEntry;
      } catch {
        continue;
      }
      if (entry.type !== 'assistant' || !entry.message?.usage) continue;
      const u = entry.message.usage;
      const input = u.input_tokens ?? 0;
      const cacheRead = u.cache_read_input_tokens ?? 0;
      const cacheCreate = u.cache_creation_input_tokens ?? 0;
      // Track ceiling across the whole window so a one-off >200k turn flips
      // us to 1M-mode even if the latest turn dropped back down.
      const turnInput = input + cacheRead + cacheCreate;
      if (turnInput > maxObservedInputTokens) maxObservedInputTokens = turnInput;
      // Always replace — we want the *last* one in file order.
      result = {
        lastInputTokens: input,
        lastCacheReadTokens: cacheRead,
        lastCacheCreationTokens: cacheCreate,
        maxObservedInputTokens,
        lastModel: entry.message.model ?? null,
        lastTimestamp: entry.timestamp ?? null,
      };
    }

    if (result) result.maxObservedInputTokens = maxObservedInputTokens;
    return result;
  } finally {
    await fh.close();
  }
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
