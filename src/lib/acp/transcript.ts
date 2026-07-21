import { appendFile, mkdir, readFile } from "node:fs/promises";
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
  readonly promptId?: string;
  /** Durable lifecycle record for queued, failed, and completed prompts. */
  readonly event?: "prompt_queued" | "prompt_failed" | "turn_completed";
  readonly stopReason?: AcpTranscriptStopReason;
}

export type AcpTranscriptEntryInput = Omit<AcpTranscriptEntry, "timestamp"> & {
  readonly timestamp?: string;
};

export interface OwedAcpPrompt {
  readonly promptId: string;
  readonly content: string;
  readonly started: boolean;
}

export async function readOwedAcpPrompts(path: string): Promise<ReadonlyArray<OwedAcpPrompt>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const owed = new Map<string, OwedAcpPrompt>();
  const legacyOrder: string[] = [];
  let legacyIndex = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry: Partial<AcpTranscriptEntry>;
    try {
      entry = JSON.parse(line) as Partial<AcpTranscriptEntry>;
    } catch {
      continue;
    }
    if (entry.event === "prompt_queued" && typeof entry.content === "string") {
      const promptId = entry.promptId
        ?? `legacy:${entry.timestamp ?? "unknown"}:${legacyIndex++}`;
      owed.set(promptId, { promptId, content: entry.content, started: false });
      if (!entry.promptId) legacyOrder.push(promptId);
      continue;
    }
    if (entry.role === "user") {
      if (entry.promptId) {
        const queued = owed.get(entry.promptId);
        if (queued) owed.set(entry.promptId, { ...queued, started: true });
      } else {
        const promptId = legacyOrder.find((id) => owed.get(id)?.started === false);
        const queued = promptId ? owed.get(promptId) : undefined;
        if (promptId && queued) owed.set(promptId, { ...queued, started: true });
      }
      continue;
    }
    if (entry.event === "turn_completed" || entry.event === "prompt_failed") {
      if (entry.promptId) {
        owed.delete(entry.promptId);
      } else {
        const promptId = legacyOrder.shift();
        if (promptId) owed.delete(promptId);
      }
    }
  }
  return [...owed.values()];
}

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
      ...(entry.promptId ? { promptId: entry.promptId } : {}),
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
