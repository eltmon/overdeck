import { Effect, Queue, Stream } from 'effect';
import type { ConversationEvent, PanRpcError } from '@overdeck/contracts';
import { contextUsageFromParseResult, gateSnapshotEmission, watchConversation } from './conversation-service.js';
import { startSubagentListPolling } from './conversation/subagents.js';
import { parseStateFromSnapshot, sharedTranscriptParser } from './shared-transcript-parser.js';

/**
 * Claude transcript stream for `subscribeConversationMessages`: a worker-backed
 * initial parse, then incremental deltas from the file watcher. Subagent list
 * polling runs only for the main transcript.
 */

const claudeInitialSnapshot = sharedTranscriptParser('claude-initial');

export function streamClaudeTranscript(
  sessionFile: string,
  conversationName: string,
  model: string | null,
  agentId?: string,
): Stream.Stream<ConversationEvent, PanRpcError> {
  return Stream.callback<ConversationEvent, PanRpcError>((queue) =>
    Effect.acquireRelease(
      Effect.promise(async () => {
        const offer = (event: ConversationEvent) => {
          try { Queue.offerUnsafe(queue, event); } catch { /* disconnected */ }
        };
        const initial = await claudeInitialSnapshot(sessionFile);
        let currentByteOffset = initial.byteOffset;
        let currentContextUsage = contextUsageFromParseResult(initial, model);
        let highWaterCount = initial.messages.length;
        if (initial.messages.length === 0 && initial.workLog.length === 0 && currentByteOffset > 0) {
          console.warn(`[conv-stream] initial parse of ${conversationName} yielded no transcript content despite byteOffset=${currentByteOffset}`);
        }
        const priorState = parseStateFromSnapshot(initial);
        offer({
          kind: 'messages',
          messages: initial.messages,
          workLog: [...initial.workLog, ...initial.pendingToolUse.values()],
          streaming: initial.streaming,
          snapshot: true,
          proposedPlan: initial.proposedPlan,
          compactBoundaries: initial.compactBoundaries?.length ? initial.compactBoundaries : undefined,
          contextUsage: currentContextUsage,
        });
        let pendingSubagentToolUseIds = new Set(initial.pendingToolUse.keys());
        const subagentPoller = agentId ? null : await startSubagentListPolling(
          sessionFile,
          () => pendingSubagentToolUseIds,
          offer,
        );
        const handle = watchConversation(sessionFile, (result) => {
          const fileWasReset = result.byteOffset < currentByteOffset;
          const gate = gateSnapshotEmission(fileWasReset, result.messages.length, highWaterCount);
          highWaterCount = gate.highWaterCount;
          currentByteOffset = result.byteOffset;
          currentContextUsage = contextUsageFromParseResult(result, model);
          pendingSubagentToolUseIds = new Set(result.pendingToolUse.keys());
          void subagentPoller?.refresh();
          if (gate.suppressedShrink) {
            console.warn(`[conv-stream] suppressed shrinking reset for ${conversationName}`);
          }
          offer({
            kind: 'messages',
            messages: result.messages,
            workLog: result.workLog,
            streaming: result.streaming,
            snapshot: gate.snapshot,
            proposedPlan: result.proposedPlan,
            compactBoundaries: result.compactBoundaries?.length ? result.compactBoundaries : undefined,
            contextUsage: currentContextUsage,
          });
        }, { byteOffset: initial.byteOffset, priorState });
        return { stop() { handle.stop(); subagentPoller?.stop(); } };
      }),
      (handle) => Effect.sync(() => handle.stop()),
    ),
  );
}
