import { Effect, Queue, Stream } from 'effect';
import { stat } from 'node:fs/promises';
import type { ConversationEvent, ConversationResume, PanRpcError } from '@overdeck/contracts';
import { contextUsageFromParseResult, gateSnapshotEmission, watchConversation } from './conversation-service.js';
import { startSubagentListPolling } from './conversation/subagents.js';
import { projectWorkLog } from './conversation/wire-projection.js';
import { selectInitialWindow, selectResumeDelta, transcriptIdOf } from './conversation/window.js';
import { parseStateFromSnapshot, sharedTranscriptParser } from './shared-transcript-parser.js';

/**
 * Claude transcript stream for `subscribeConversationMessages`: a worker-backed
 * initial parse, then incremental deltas from the file watcher. Subagent list
 * polling runs only for the main transcript.
 *
 * PAN-4558: the first event is a windowed snapshot (newest rows plus a
 * `window` cursor), or, when the client's `resume` still matches the file,
 * only the rows it lacks. Every later snapshot is windowed and every delta is
 * wire-projected.
 */

async function transcriptIdAt(sessionFile: string): Promise<string | undefined> {
  return stat(sessionFile).then(transcriptIdOf, () => undefined);
}

const claudeInitialSnapshot = sharedTranscriptParser('claude-initial');

export function streamClaudeTranscript(
  sessionFile: string,
  conversationName: string,
  model: string | null,
  agentId?: string,
  resume?: ConversationResume,
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
        const transcript = await transcriptIdAt(sessionFile);
        const rows = { messages: initial.messages, workLog: [...initial.workLog, ...initial.pendingToolUse.values()] };
        const initialMetadata = {
          streaming: initial.streaming,
          proposedPlan: initial.proposedPlan,
          compactBoundaries: initial.compactBoundaries?.length ? initial.compactBoundaries : undefined,
          contextUsage: currentContextUsage,
        };
        const resumed = resume ? selectResumeDelta(rows, resume, transcript) : null;
        if (resumed) {
          offer({ kind: 'messages', ...resumed, ...initialMetadata, snapshot: false, metadataSnapshot: true });
        } else {
          offer({
            kind: 'messages',
            ...selectInitialWindow(rows, transcript),
            ...initialMetadata,
            snapshot: true,
            // An empty fallback never wipes what the client already shows.
            ...(resume && rows.messages.length + rows.workLog.length > 0 ? { reset: true } : {}),
          });
        }
        let pendingSubagentToolUseIds = new Set(initial.pendingToolUse.keys());
        const subagentPoller = agentId ? null : await startSubagentListPolling(
          sessionFile,
          () => pendingSubagentToolUseIds,
          offer,
        );
        const handle = watchConversation(sessionFile, async (result) => {
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
          const metadata = {
            streaming: result.streaming,
            proposedPlan: result.proposedPlan,
            compactBoundaries: result.compactBoundaries?.length ? result.compactBoundaries : undefined,
            contextUsage: currentContextUsage,
          };
          if (gate.snapshot) {
            // A reset may have replaced the file, so its transcript id is read again.
            const windowed = selectInitialWindow(result, await transcriptIdAt(sessionFile));
            offer({ kind: 'messages', ...windowed, ...metadata, snapshot: true, ...(fileWasReset ? { reset: true } : {}) });
            return;
          }
          offer({ kind: 'messages', messages: result.messages, workLog: projectWorkLog(result.workLog), ...metadata, snapshot: false });
        }, { byteOffset: initial.byteOffset, priorState });
        return { stop() { handle.stop(); subagentPoller?.stop(); } };
      }),
      (handle) => Effect.sync(() => handle.stop()),
    ),
  );
}
