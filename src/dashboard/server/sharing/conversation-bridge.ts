/**
 * Streams one shared conversation to the peers of a Shared Sessions hub (PRD PAN-4474 WI-5).
 *
 * The first `attach` starts the bridge: it resolves the conversation's Claude JSONL, parses the whole
 * file once (the `'claude-initial'` worker job, so `history` is the full transcript), and watches it
 * with `watchConversation`. Every sink gets one `history` payload when it attaches, then `append`
 * for each new message id and `update` for each known message whose mapped form changed, in
 * transcript order (D-9, D-10). A genuine transcript reset sends a new `history`; a suppressed
 * shrink merges like a delta. Only `toSharedMessage`'s allow-list crosses the wire (D-21).
 *
 * Claude JSONL transcripts only, resolved like `ws-rpc.ts`'s `subscribeConversationMessages`
 * without a harness comparison (D-11). The last detach stops the watcher; the next attach starts
 * again. Nothing here logs.
 *
 * Author attribution (PRD PAN-4476 D-10): `expectAuthor` records who sent a shared prompt; the first
 * appended user message whose trimmed text equals it is stamped with that `author`, and every later
 * `history` keeps the stamp. A transcript text that differs from the delivered text stays unattributed.
 */
import { toSharedMessage, type ConversationPayload, type SharedMessage } from '@overdeck/contracts';

import { readLauncherPinnedSessionId } from '../../../lib/agents/transcript-resolver.js';
import type { LegacyConversation } from '../../../lib/overdeck/conversations.js';
import { sessionFilePath } from '../../../lib/runtimes/storage/claude-code.js';
import { gateSnapshotEmission, watchConversation } from '../services/conversation-service.js';
import type { ParseResult, ParseState } from '../services/conversation/types.js';
import { runDashboardDbJob } from '../services/dashboard-db-task.js';
import { isPiSessionFile } from '../services/pi-conversation-parser.js';
import { parseStateFromSnapshot, sharedTranscriptParser } from '../services/shared-transcript-parser.js';

export interface ConversationSink {
  send(payload: ConversationPayload): void;
}

export interface ConversationBridgeDeps {
  /** The conversation's Claude JSONL path, or null (unknown conversation, no session id, or a Pi file); a path whose file does not exist yet is still returned. */
  resolveSessionFile(conversationName: string): Promise<string | null>;
  parseInitial(sessionFile: string): Promise<ParseResult>;
  watch(
    sessionFile: string,
    callback: (result: ParseResult) => void | Promise<void>,
    options: { byteOffset: number; priorState: ParseState },
  ): { stop(): void };
}

interface BridgeState {
  messages: Map<string, SharedMessage>;
  sent: Map<string, string>;
  byteOffset: number;
  highWaterCount: number;
  watcher: { stop(): void } | null;
}

interface SinkEntry {
  readonly sink: ConversationSink;
}

type SharedAuthor = NonNullable<SharedMessage['author']>;

interface ExpectedAuthor {
  readonly text: string;
  readonly author: SharedAuthor;
}

/** The most authors waiting for their user message; the oldest is dropped first. */
export const MAX_PENDING_AUTHORS = 20;

const NO_OP = (): void => undefined;

export class ConversationBridge {
  private readonly sinks = new Set<SinkEntry>();
  private start: Promise<BridgeState | null> | null = null;
  private state: BridgeState | null = null;
  private generation = 0;
  private closed = false;
  private readonly pending: ExpectedAuthor[] = [];
  private readonly authors = new Map<string, SharedAuthor>();

  constructor(
    private readonly conversationName: string,
    private readonly deps: ConversationBridgeDeps,
  ) {}

  /** Sends `history` (or `unavailable`) to the sink, then live payloads; resolves to a detach function. */
  async attach(sink: ConversationSink): Promise<() => void> {
    if (this.closed) return NO_OP;
    const generation = this.generation;
    const start = (this.start ??= this.begin(generation));
    const state = await start;
    if (this.closed) return NO_OP;
    // The last sink detached while this attach waited: the bridge restarted, so attach again.
    if (generation !== this.generation) return this.attach(sink);
    if (state === null) {
      if (this.start === start) this.start = null;
      try {
        sink.send({ kind: 'unavailable', reason: 'transcript_not_found' });
      } catch {
        // A failing sink only loses its own payload.
      }
      return NO_OP;
    }
    const entry: SinkEntry = { sink };
    this.sinks.add(entry);
    this.deliver(entry, { kind: 'history', messages: [...state.messages.values()] });
    return () => this.removeSink(entry);
  }

  /** Stamps `author` on the next appended user message whose trimmed text equals `text`; returns a cancel. */
  expectAuthor(text: string, author: SharedAuthor): () => void {
    if (this.closed) return NO_OP;
    const entry: ExpectedAuthor = { text: text.trim(), author: { login: author.login, avatarUrl: author.avatarUrl } };
    this.pending.push(entry);
    if (this.pending.length > MAX_PENDING_AUTHORS) this.pending.shift();
    return () => {
      const index = this.pending.indexOf(entry);
      if (index >= 0) this.pending.splice(index, 1);
    };
  }

  /** Stops the watcher and forgets every sink. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.sinks.clear();
    this.pending.length = 0;
    this.authors.clear();
    this.reset();
  }

  private async begin(generation: number): Promise<BridgeState | null> {
    let sessionFile: string | null;
    let initial: ParseResult;
    try {
      sessionFile = await this.deps.resolveSessionFile(this.conversationName);
      if (sessionFile === null) return null;
      initial = await this.deps.parseInitial(sessionFile);
    } catch {
      return null;
    }
    if (generation !== this.generation) return null;
    const state: BridgeState = {
      messages: new Map(),
      sent: new Map(),
      byteOffset: initial.byteOffset,
      highWaterCount: initial.messages.length,
      watcher: null,
    };
    replaceMessages(state, initial.messages, this.authors);
    this.state = state;
    state.watcher = this.deps.watch(sessionFile, (result) => this.onResult(state, result), {
      byteOffset: initial.byteOffset,
      priorState: parseStateFromSnapshot(initial),
    });
    return state;
  }

  private onResult(state: BridgeState, result: ParseResult): void {
    if (this.state !== state) return;
    const fileWasReset = result.byteOffset < state.byteOffset;
    const gate = gateSnapshotEmission(fileWasReset, result.messages.length, state.highWaterCount);
    state.highWaterCount = gate.highWaterCount;
    state.byteOffset = result.byteOffset;
    if (gate.snapshot) {
      replaceMessages(state, result.messages, this.authors);
      this.broadcast({ kind: 'history', messages: [...state.messages.values()] });
      return;
    }
    for (const message of result.messages) {
      if (this.state !== state) return;
      const previous = state.sent.get(message.id);
      if (previous === undefined && message.role === 'user') this.claimAuthor(message.id, message.text);
      const shared = withAuthor(toSharedMessage(message), this.authors);
      const json = JSON.stringify(shared);
      if (previous === json) continue;
      state.messages.set(shared.id, shared);
      state.sent.set(shared.id, json);
      this.broadcast({ kind: previous === undefined ? 'append' : 'update', message: shared });
    }
  }

  private claimAuthor(id: string, text: string): void {
    if (this.authors.has(id)) return;
    const trimmed = text.trim();
    const index = this.pending.findIndex((entry) => entry.text === trimmed);
    if (index < 0) return;
    const [entry] = this.pending.splice(index, 1);
    if (entry) this.authors.set(id, entry.author);
  }

  private broadcast(payload: ConversationPayload): void {
    for (const entry of [...this.sinks]) this.deliver(entry, payload);
  }

  private deliver(entry: SinkEntry, payload: ConversationPayload): void {
    try {
      entry.sink.send(payload);
    } catch {
      this.removeSink(entry);
    }
  }

  private removeSink(entry: SinkEntry): void {
    if (!this.sinks.delete(entry)) return;
    if (this.sinks.size === 0) this.reset();
  }

  /** Stops the watcher and forgets the transcript; an in-flight start is abandoned by the generation bump. */
  private reset(): void {
    this.generation++;
    this.state?.watcher?.stop();
    this.state = null;
    this.start = null;
  }
}

function withAuthor(shared: SharedMessage, authors: ReadonlyMap<string, SharedAuthor>): SharedMessage {
  const author = authors.get(shared.id);
  return author ? { ...shared, author } : shared;
}

function replaceMessages(state: BridgeState, messages: ParseResult['messages'], authors: ReadonlyMap<string, SharedAuthor>): void {
  state.messages.clear();
  state.sent.clear();
  for (const message of messages) {
    const shared = withAuthor(toSharedMessage(message), authors);
    state.messages.set(shared.id, shared);
    state.sent.set(shared.id, JSON.stringify(shared));
  }
}

export async function resolveClaudeSessionFile(conversationName: string): Promise<string | null> {
  const conv = await runDashboardDbJob<LegacyConversation | null>('getConversationByName', conversationName);
  if (!conv) return null;
  const pinned = conv.tmuxSession ? await readLauncherPinnedSessionId(conv.tmuxSession) : null;
  const sessionId = pinned ?? conv.claudeSessionId;
  if (!sessionId) return null;
  const sessionFile = sessionFilePath(conv.cwd, sessionId);
  if (isPiSessionFile(sessionFile)) return null;
  // No existence check: a fresh conversation's JSONL appears after its first prompt (D-11).
  return sessionFile;
}

export function productionBridgeDeps(): ConversationBridgeDeps {
  return {
    resolveSessionFile: resolveClaudeSessionFile,
    parseInitial: sharedTranscriptParser('claude-initial'),
    watch: watchConversation,
  };
}

export async function conversationLabel(conversationName: string): Promise<string> {
  const conv = await runDashboardDbJob<LegacyConversation | null>('getConversationByName', conversationName);
  return conv?.title || conversationName;
}
