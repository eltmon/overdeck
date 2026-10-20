import { parseMuseConversationMessages } from '../muse-conversation-parser.js';
import { parsePrimeAgentConversationMessages } from '../prime-agent-conversation-parser.js';
import { stat } from 'node:fs/promises';
import { getHarnessBehavior } from '../../../../lib/runtimes/behavior.js';
import { projectAcpConversationActivity } from '../acp-conversation-parser.js';
import { parseCodexConversationMessages } from '../codex-conversation-parser.js';
import { isOhmypiSessionFile, parseOhmypiConversationMessages } from '../ohmypi-conversation-parser.js';
import { isPiSessionFile, parsePiConversationMessages } from '../pi-conversation-parser.js';
import { parseKimiConversationMessages } from '../kimi-conversation-parser.js';
import { parseFromLastCompactBoundary } from './parser.js';
import type { ConversationActivitySummary, ParseResult } from './types.js';
import type { HarnessTranscriptKind } from '@overdeck/contracts';

/**
 * PAN-1635: a conversation whose JSONL hasn't been written in this long is no
 * longer "working" — even if its last entry is a trailing user/meta line (e.g. a
 * post-compaction summary whose follow-up prompt was eaten by the compaction).
 * Generous enough not to flap a slow-but-live turn; finite so a stranded session
 * can't spin forever.
 */
const WORKING_STALENESS_MS = 180_000;
export const ACP_STALLED_TURN_MS = 300_000;

type ActivitySource =
  | { readonly kind: 'projected' } // ACP: projectAcpConversationActivity + stall window
  | { readonly kind: 'parsed'; readonly parse: (sessionFile: string) => Promise<ParseResult>; readonly toolsInWorkLog: boolean };

/** Rows without a harness read as claude-code, so sniff legacy Pi transcripts before the Claude parser. */
function parseClaudeOrLegacyPiActivity(sessionFile: string): Promise<ParseResult> {
  if (isOhmypiSessionFile(sessionFile)) return parseOhmypiConversationMessages(sessionFile);
  if (isPiSessionFile(sessionFile)) return parsePiConversationMessages(sessionFile);
  // Parse from the last compact boundary instead of the full file — avoids
  // re-reading potentially megabytes of history on every list enrichment tick.
  // Pass an empty priorState so pendingToolUse stays populated rather than being
  // flushed into workLog. This lets us detect genuinely pending tools.
  return parseFromLastCompactBoundary(sessionFile, { pendingToolUse: new Map(), unresolvedResults: new Map(), lastSequence: 0 });
}

/** Where each transcript kind's activity comes from (PAN-4562). toolsInWorkLog = pending tools surface only in the workLog. */
const ACTIVITY_SOURCES: Record<HarnessTranscriptKind, ActivitySource> = {
  'acp-jsonl': { kind: 'projected' },
  'codex-rollout-jsonl': { kind: 'parsed', parse: parseCodexConversationMessages, toolsInWorkLog: true },
  'ohmypi-jsonl': { kind: 'parsed', parse: parseOhmypiConversationMessages, toolsInWorkLog: false },
  'muse-jsonl': { kind: 'parsed', parse: parseMuseConversationMessages, toolsInWorkLog: false },
  'prime-agent-jsonl': { kind: 'parsed', parse: parsePrimeAgentConversationMessages, toolsInWorkLog: false },
  'kimi-wire-jsonl': { kind: 'parsed', parse: parseKimiConversationMessages, toolsInWorkLog: false },
  'claude-jsonl': { kind: 'parsed', parse: parseClaudeOrLegacyPiActivity, toolsInWorkLog: false },
};

/** In-memory cache mapping sessionFile path → { mtimeMs, size, summary } */
const ACTIVITY_SUMMARY_CACHE_MAX = 100;
const activitySummaryCache = new Map<string, { mtimeMs: number; size: number; summary: ConversationActivitySummary }>();

function cacheActivitySummary(
  cacheKey: string,
  mtimeMs: number,
  size: number,
  summary: ConversationActivitySummary,
): ConversationActivitySummary {
  activitySummaryCache.set(cacheKey, { mtimeMs, size, summary });
  if (activitySummaryCache.size > ACTIVITY_SUMMARY_CACHE_MAX) {
    const firstKey = activitySummaryCache.keys().next().value;
    if (firstKey !== undefined) activitySummaryCache.delete(firstKey);
  }
  return summary;
}

export async function summarizeConversationActivity(
  sessionFile: string,
  options: { harness?: string | null } = {},
): Promise<ConversationActivitySummary> {
  const fileStats = await stat(sessionFile);
  const cacheKey = `${options.harness ?? 'claude-code'}:${sessionFile}`;
  const source = ACTIVITY_SOURCES[getHarnessBehavior(options.harness as Parameters<typeof getHarnessBehavior>[0]).transcriptKind];
  const cached = activitySummaryCache.get(cacheKey);
  if (cached && cached.mtimeMs === fileStats.mtimeMs && cached.size === fileStats.size) {
    if (source.kind === 'projected') {
      const fileAgeMs = Date.now() - cached.mtimeMs;
      return {
        ...cached.summary,
        currentTool: fileAgeMs < 30_000 ? cached.summary.currentTool : null,
        stalledSince: cached.summary.isWorking && fileAgeMs > ACP_STALLED_TURN_MS
          ? new Date(cached.mtimeMs).toISOString()
          : undefined,
      };
    }
    return cached.summary;
  }

  if (source.kind === 'projected') {
    const projected = await projectAcpConversationActivity(sessionFile);
    const fileAgeMs = Date.now() - projected.mtimeMs;
    const lastMsg = projected.messages[projected.messages.length - 1];
    const isWorking = !projected.lastTurnCompletedAt && (
      projected.streaming
      || projected.pendingToolCount > 0
      || projected.messages.length === 0
      || lastMsg?.role === 'user'
      || (lastMsg?.role === 'assistant' && !lastMsg.completedAt)
    );
    const fileRecent = fileAgeMs < 30_000;
    const summary: ConversationActivitySummary = {
      // Reuse the parser's existing message view instead of cloning the complete
      // transcript for activity-only enrichment on every append.
      messages: projected.messages,
      streaming: projected.streaming,
      isWorking,
      currentTool: fileRecent ? projected.currentTool : null,
      stalledSince: isWorking && fileAgeMs > ACP_STALLED_TURN_MS
        ? new Date(projected.mtimeMs).toISOString()
        : undefined,
    };
    return cacheActivitySummary(cacheKey, fileStats.mtimeMs, fileStats.size, summary);
  }

  const parsed = await source.parse(sessionFile);
  const { messages, streaming, lastTurnCompletedAt, pendingToolUse, workLog, mtimeMs } = parsed;
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
  // Codex-style gap signal (PAN-3770): harnesses that append COMPLETE messages
  // mid-turn narrate ("Checking the branch first.") before running tools, so a
  // completed-looking tail plus tool/workLog activity newer than the last
  // message still means working. Recency-guarded like everything above.
  const lastWork = workLog[workLog.length - 1];
  let workGapWorking = false;
  if (lastWork) {
    const workTs = Date.parse(lastWork.createdAt || '');
    if (!Number.isNaN(workTs) && Date.now() - workTs < WORKING_STALENESS_MS) {
      const msgTs = Date.parse(lastMsg?.completedAt || lastMsg?.createdAt || '');
      workGapWorking = Number.isNaN(msgTs) || workTs >= msgTs;
    }
  }
  const isWorking = workingFileRecent && !lastTurnCompletedAt && (
    streaming ||
    pendingToolUse.size > 0 ||
    messages.length === 0 ||
    lastMsg?.role === 'user' ||
    (lastMsg?.role === 'assistant' && !lastMsg.completedAt) ||
    workGapWorking);

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
    if (!currentTool && source.toolsInWorkLog) {
      for (const entry of workLog) {
        if (entry.tone === 'tool' && !entry.result && (entry.sequence ?? -1) > maxSequence) {
          maxSequence = entry.sequence ?? -1;
          currentTool = entry.label;
        }
      }
    }
  }

  const summary: ConversationActivitySummary = { messages, streaming, isWorking, currentTool };
  return cacheActivitySummary(cacheKey, mtimeMs, fileStats.size, summary);
}
