import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AppServerTransport } from '../app-server-transport.js';

export interface FakeAppServer {
  child: ChildProcessWithoutNullStreams;
  messages: Array<Record<string, unknown>>;
  send(message: unknown): void;
}

export function createFakeAppServer(onMessage?: (message: Record<string, unknown>, fake: FakeAppServer) => void): FakeAppServer {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const emitter = new EventEmitter();
  const messages: Array<Record<string, unknown>> = [];
  let buffered = '';
  const fake = {
    child: Object.assign(emitter, { stdin, stdout, stderr, kill: () => true }) as unknown as ChildProcessWithoutNullStreams,
    messages,
    send(message: unknown) {
      stdout.write(`${JSON.stringify(message)}\n`);
    },
  };
  stdin.on('data', chunk => {
    buffered += String(chunk);
    for (;;) {
      const newline = buffered.indexOf('\n');
      if (newline < 0) break;
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      const message = JSON.parse(line) as Record<string, unknown>;
      messages.push(message);
      onMessage?.(message, fake);
    }
  });
  return fake;
}

export interface FakeNativeTransport {
  transport: AppServerTransport;
  messages: Array<Record<string, unknown>>;
  send(message: unknown): void;
  close(reason?: string): void;
  closedByClient: boolean;
}

/** An in-memory native (WebSocket-framed) transport for manager tests (PAN-3835). */
export function createFakeNativeTransport(
  onMessage?: (message: Record<string, unknown>, fake: FakeNativeTransport) => void,
): FakeNativeTransport {
  let handler: ((text: string) => void) | undefined;
  let closeHandler: ((reason: string) => void) | undefined;
  const fake: FakeNativeTransport = {
    messages: [],
    closedByClient: false,
    transport: {
      send(message) {
        const record = JSON.parse(JSON.stringify(message)) as Record<string, unknown>;
        fake.messages.push(record);
        queueMicrotask(() => onMessage?.(record, fake));
      },
      onMessage(next) { handler = next; },
      onClose(next) { closeHandler = next; },
      close() { fake.closedByClient = true; },
    },
    send(message) { handler?.(JSON.stringify(message)); },
    close(reason = 'websocket closed (1006)') { closeHandler?.(reason); },
  };
  return fake;
}
