/**
 * Prime Agent RPC client (PAN-3668 WI-9, FR-6, FR-17). Correlates request ids, routes
 * events, bounds pending requests and record size, times requests out, rejects every
 * pending request when the child exits, and never throws from its stdout handler.
 * Every outgoing command passes the managed-session denylist first (D11).
 */
import type { Writable } from 'node:stream';
import { encodePrimeAgentJsonl, PrimeAgentJsonlFramer } from './jsonl-framing.js';
import { assertPrimeAgentManagedCommandAllowed } from './policy.js';

export interface PrimeAgentRpcResponse<T = unknown> {
  type: 'response';
  id: string;
  command: string;
  success: boolean;
  data?: T;
  error?: string;
}

interface PendingRequest {
  command: string;
  resolve: (response: PrimeAgentRpcResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface PrimeAgentRpcClientOptions {
  stdin: Pick<Writable, 'write'>;
  requestTimeoutMs?: number;
  maxPendingRequests?: number;
  maxRecordBytes?: number;
  onEvent?: (event: Record<string, unknown>) => void;
  /**
   * Called once per record the client could not decode or route. Stdout is a
   * shared channel — an upstream banner or a warning line is not a reason to
   * lose the session — so these are reported, not thrown.
   */
  onRecordError?: (error: Error) => void;
}

export class PrimeAgentRpcClient {
  private readonly framer: PrimeAgentJsonlFramer;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly requestTimeoutMs: number;
  private readonly maxPendingRequests: number;
  private readonly stdin: Pick<Writable, 'write'>;
  private readonly onEvent: (event: Record<string, unknown>) => void;
  private readonly onRecordError: (error: Error) => void;
  private nextId = 1;
  private closedError: Error | null = null;

  constructor(options: PrimeAgentRpcClientOptions) {
    this.stdin = options.stdin;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.maxPendingRequests = options.maxPendingRequests ?? 128;
    this.onEvent = options.onEvent ?? (() => undefined);
    this.onRecordError = options.onRecordError ?? (() => undefined);
    this.framer = new PrimeAgentJsonlFramer({ maxRecordBytes: options.maxRecordBytes });
  }

  request<T = unknown>(command: Record<string, unknown> & { type: string }): Promise<PrimeAgentRpcResponse<T>> {
    assertPrimeAgentManagedCommandAllowed(command.type);
    if (this.closedError) return Promise.reject(this.closedError);
    if (this.pending.size >= this.maxPendingRequests) {
      return Promise.reject(new Error(`Prime Agent RPC has ${this.pending.size} pending requests; refusing unbounded growth`));
    }
    const id = `overdeck-${this.nextId++}`;
    return new Promise<PrimeAgentRpcResponse<T>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Prime Agent RPC ${command.type} request ${id} timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { command: command.type, resolve: resolve as (response: PrimeAgentRpcResponse) => void, reject, timeout });
      this.stdin.write(encodePrimeAgentJsonl({ ...command, id }), (error?: Error | null) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(id);
        reject(new Error(`Prime Agent RPC could not write ${command.type} request ${id}: ${error.message}`));
      });
    });
  }

  /**
   * Write a one-way record that has no response, such as the
   * `extension_ui_response` that cancels a dialog (D10). The denylist still applies.
   */
  notify(record: Record<string, unknown> & { type: string }): void {
    assertPrimeAgentManagedCommandAllowed(record.type);
    if (this.closedError) return;
    this.stdin.write(encodePrimeAgentJsonl(record), (error?: Error | null) => {
      if (error) this.onRecordError(new Error(`Prime Agent RPC could not write ${record.type} record: ${error.message}`));
    });
  }

  /**
   * Never throws. This runs inside the host's stdout `'data'` listener, where a
   * synchronous throw becomes an uncaught exception that kills the host process
   * and orphans the Prime child without writing a launch-error file.
   */
  acceptStdout(chunk: Uint8Array): void {
    const { records, errors } = this.framer.push(chunk);
    for (const error of errors) this.onRecordError(error);
    for (const value of records) {
      try {
        this.route(value);
      } catch (error) {
        this.onRecordError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  close(cause: Error = new Error('Prime Agent RPC process exited')): void {
    if (this.closedError) return;
    this.closedError = cause;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(cause);
    }
    this.pending.clear();
  }

  private route(value: unknown): void {
    if (!value || typeof value !== 'object') throw new Error('Prime Agent RPC emitted a non-object record');
    const record = value as Record<string, unknown>;
    if (record.type !== 'response') {
      this.onEvent(record);
      return;
    }
    if (typeof record.id !== 'string') throw new Error('Prime Agent RPC response omitted its correlation id');
    const pending = this.pending.get(record.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(record.id);
    const response = record as unknown as PrimeAgentRpcResponse;
    if (response.command !== pending.command) {
      pending.reject(new Error(`Prime Agent RPC response ${record.id} named ${response.command}, expected ${pending.command}`));
    } else if (!response.success) {
      pending.reject(new Error(`Prime Agent RPC ${pending.command} request failed: ${response.error ?? 'unknown error'}`));
    } else {
      pending.resolve(response);
    }
  }
}
