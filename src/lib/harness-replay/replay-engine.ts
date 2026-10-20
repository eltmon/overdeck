/**
 * Deterministic JSON-RPC protocol replay engine (PAN-4563).
 *
 * Drives recorded fixture frames through real client transports without any network
 * or child process, accurately reproducing message ordering, server-initiated requests,
 * and turn completion boundaries.
 */
import type { ProtocolFixture, ProtocolFixtureFrame } from "./fixture.js";

export interface ReplayEngineOptions {
  readonly onIncoming: (message: unknown) => void;
  readonly onFinish?: () => void;
  readonly strict?: boolean;
}

interface JsonRpcMessage {
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export class ReplayEngine {
  private readonly frames: readonly ProtocolFixtureFrame[];
  private currentIndex = 0;
  private readonly recordedToClientId = new Map<
    string | number,
    string | number
  >();
  private readonly clientToRecordedId = new Map<
    string | number,
    string | number
  >();
  private finished = false;

  constructor(
    fixture: ProtocolFixture,
    private readonly options: ReplayEngineOptions,
  ) {
    this.frames = fixture.frames;
  }

  /**
   * Begin replay: flush any initial incoming frames recorded before the first client request.
   */
  start(): void {
    this.flushIncoming();
  }

  /**
   * Handle an outgoing message sent by the client.
   * Matches the frame against the fixture, records any dynamic ID mapping,
   * advances the fixture, and flushes subsequent incoming frames.
   */
  handleOutgoing(rawMessage: unknown): void {
    const clientMsg = asJsonRpc(rawMessage);

    // Find expected outgoing frame at current index or shortly after
    let frameIndex = this.findMatchingOutgoingFrame(clientMsg);
    if (frameIndex === -1) {
      if (this.options.strict) {
        throw new Error(
          `Unexpected outgoing client message: ${JSON.stringify(rawMessage)} at index ${this.currentIndex}`,
        );
      }
      return;
    }

    const recordedFrame = this.frames[frameIndex];
    const recordedMsg = asJsonRpc(recordedFrame.message);

    // Map request ID if both have IDs (e.g. client uses sequential IDs)
    if (clientMsg.id !== undefined && recordedMsg.id !== undefined) {
      this.recordedToClientId.set(recordedMsg.id, clientMsg.id);
      this.clientToRecordedId.set(clientMsg.id, recordedMsg.id);
    }

    // Advance past this outgoing frame
    this.currentIndex = frameIndex + 1;

    // Flush incoming messages that follow this outgoing frame
    this.flushIncoming();
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  getRemainingFrameCount(): number {
    return Math.max(0, this.frames.length - this.currentIndex);
  }

  isFinished(): boolean {
    return this.currentIndex >= this.frames.length;
  }

  /**
   * Flush consecutive incoming frames from the current index until:
   * - an outgoing frame is reached (waiting for client request), or
   * - a server-initiated request is emitted (waiting for client response), or
   * - the end of frames is reached.
   */
  private flushIncoming(): void {
    while (this.currentIndex < this.frames.length) {
      const frame = this.frames[this.currentIndex];

      if (frame.direction === "outgoing") {
        // Paused waiting for client
        break;
      }

      // Incoming frame
      this.currentIndex++;
      const message = this.patchIncomingMessage(frame.message);

      this.options.onIncoming(message);

      // If the incoming message is a server-initiated request (has method AND id),
      // pause delivery because the server awaits client's decision/answer.
      const rpc = asJsonRpc(message);
      if (rpc.method !== undefined && rpc.id !== undefined) {
        break;
      }
    }

    if (this.currentIndex >= this.frames.length && !this.finished) {
      this.finished = true;
      this.options.onFinish?.();
    }
  }

  private patchIncomingMessage(rawMessage: unknown): unknown {
    if (
      !rawMessage ||
      typeof rawMessage !== "object" ||
      Array.isArray(rawMessage)
    ) {
      return rawMessage;
    }

    const msg = { ...(rawMessage as Record<string, unknown>) };

    // If this is a response to a client request (id present, no method),
    // map the recorded request id back to the client's actual request id.
    if (msg.id !== undefined && msg.method === undefined) {
      const clientId = this.recordedToClientId.get(msg.id as string | number);
      if (clientId !== undefined) {
        msg.id = clientId;
      }
    }

    return msg;
  }

  private findMatchingOutgoingFrame(clientMsg: JsonRpcMessage): number {
    if (this.currentIndex >= this.frames.length) return -1;

    // First check exact current frame
    const current = this.frames[this.currentIndex];
    if (
      current.direction === "outgoing" &&
      this.matchesOutgoing(clientMsg, asJsonRpc(current.message))
    ) {
      return this.currentIndex;
    }

    // Search ahead up to 5 frames in case of minor interleaving
    const maxSearch = Math.min(this.frames.length, this.currentIndex + 5);
    for (let i = this.currentIndex; i < maxSearch; i++) {
      const f = this.frames[i];
      if (
        f.direction === "outgoing" &&
        this.matchesOutgoing(clientMsg, asJsonRpc(f.message))
      ) {
        return i;
      }
    }

    // Fallback: if current frame is outgoing, accept it to keep progressing
    if (current.direction === "outgoing") {
      return this.currentIndex;
    }

    return -1;
  }

  private matchesOutgoing(
    client: JsonRpcMessage,
    recorded: JsonRpcMessage,
  ): boolean {
    if (client.method && recorded.method) {
      return client.method === recorded.method;
    }
    // Response from client to server request
    if (client.id !== undefined && recorded.id !== undefined) {
      // Check direct match or mapped match
      const mappedRecordedId = this.clientToRecordedId.get(client.id);
      return client.id === recorded.id || mappedRecordedId === recorded.id;
    }
    return false;
  }
}

function asJsonRpc(value: unknown): JsonRpcMessage {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRpcMessage;
  }
  return {};
}
