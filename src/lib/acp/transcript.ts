import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type AcpTranscriptRole = "user" | "assistant" | "tool" | "system";
export type AcpTranscriptStopReason =
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled";

export interface AcpTranscriptToolCallState {
  readonly toolCallId: string;
  readonly kind?: string;
  readonly title?: string;
  readonly status?: "pending" | "inProgress" | "completed" | "failed";
  readonly command?: string;
  readonly detail?: string;
  readonly data: Record<string, unknown>;
}

export interface AcpTranscriptEntry {
  readonly timestamp: string;
  readonly role: AcpTranscriptRole;
  readonly content: string;
  readonly sessionId?: string;
  readonly toolCalls?: ReadonlyArray<AcpTranscriptToolCallState>;
  readonly source?: "orchestrator" | "agent";
  /** Durable, non-display lifecycle record for queued and completed prompts. */
  readonly event?: "prompt_queued" | "turn_completed";
  readonly stopReason?: AcpTranscriptStopReason;
}

export type AcpTranscriptEntryInput = Omit<AcpTranscriptEntry, "timestamp"> & {
  readonly timestamp?: string;
};

export class AcpTranscriptWriter {
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  append(entry: AcpTranscriptEntryInput): Promise<void> {
    const completeEntry: AcpTranscriptEntry = {
      timestamp: entry.timestamp ?? new Date().toISOString(),
      role: entry.role,
      content: entry.content,
      ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
      ...(entry.toolCalls ? { toolCalls: entry.toolCalls } : {}),
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.event ? { event: entry.event } : {}),
      ...(entry.stopReason ? { stopReason: entry.stopReason } : {}),
    };
    this.pending = this.pending.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, `${JSON.stringify(completeEntry)}\n`, "utf-8");
    });
    return this.pending;
  }

  flush(): Promise<void> {
    return this.pending;
  }
}
