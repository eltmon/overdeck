import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { AcpToolCallState } from "./runtime-model.js";

export type AcpTranscriptRole = "user" | "assistant" | "tool" | "system";

export interface AcpTranscriptEntry {
  readonly timestamp: string;
  readonly role: AcpTranscriptRole;
  readonly content: string;
  readonly sessionId?: string;
  readonly toolCalls?: ReadonlyArray<AcpToolCallState>;
  readonly source?: "orchestrator" | "agent";
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
