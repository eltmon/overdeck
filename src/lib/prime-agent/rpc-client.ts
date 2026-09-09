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
}

export class PrimeAgentRpcClient {
  private readonly framer: PrimeAgentJsonlFramer;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly requestTimeoutMs: number;
  private readonly maxPendingRequests: number;
  private readonly stdin: Pick<Writable, 'write'>;
  private readonly onEvent: (event: Record<string, unknown>) => void;
  private nextId = 1;
  private closedError: Error | null = null;

  constructor(options: PrimeAgentRpcClientOptions) {
    this.stdin = options.stdin;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.maxPendingRequests = options.maxPendingRequests ?? 128;
    this.onEvent = options.onEvent ?? (() => undefined);
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

  acceptStdout(chunk: Uint8Array): void {
    for (const value of this.framer.push(chunk)) this.route(value);
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
