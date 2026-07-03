import { open, stat } from 'node:fs/promises';
import type { ContextUsage } from '@overdeck/contracts';
import { MODEL_CAPABILITIES, resolveModelIdSync } from '../../../../lib/model-capabilities.js';
import { findLastCompactBoundary } from './compact-boundary.js';
import type { JsonlEntry, LatestAssistantUsage, ParseResult } from './types.js';

type ModelCapability = (typeof MODEL_CAPABILITIES)[keyof typeof MODEL_CAPABILITIES];

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
