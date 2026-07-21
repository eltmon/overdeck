import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

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
