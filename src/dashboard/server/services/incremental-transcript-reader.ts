/** Bounded worker-local parser state: append reads avoid decoding the history again. */
import { open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import type { ParseResult } from './conversation/types.js';

interface Accumulator {
  push(line: string): void;
  result(size: number, mtimeMs: number): ParseResult;
}
interface Entry {
  generation: number;
  head: Buffer;
  tail: Buffer;
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  parser: Accumulator;
  pending: string;
  decoder: StringDecoder;
  result?: ParseResult;
}

export function createIncrementalTranscriptReader(create: (file: string) => Accumulator) {
  const cache = new Map<string, Entry>();
  const pending = new Map<string, Promise<ParseResult>>();
  let generation = 0;
  const maxBytes = 32 * 1024 * 1024;
  const maxFiles = 8;

  const read = async (file: string): Promise<ParseResult> => {
    const handle = await open(file, 'r');
    try {
      const stats = await handle.stat();
      let entry = cache.get(file);
      cache.delete(file);
      // Verify both ends of the consumed prefix. This catches normal rewrites
      // that grow past the old EOF without rescanning the history on appends.
      const bytesAt = async (offset: number, length: number) => {
        const bytes = Buffer.alloc(length);
        const { bytesRead } = await handle.read(bytes, 0, length, offset);
        return bytes.subarray(0, bytesRead);
      };
      const prefixChanged = entry && stats.size >= entry.size && (
        !entry.head.equals(await bytesAt(0, entry.head.length)) ||
        !entry.tail.equals(await bytesAt(entry.size - entry.tail.length, entry.tail.length))
      );
      if (!entry || entry.dev !== stats.dev || entry.ino !== stats.ino || stats.size < entry.size ||
        (stats.size === entry.size && stats.mtimeMs !== entry.mtimeMs) || prefixChanged) {
        entry = { generation: ++generation, head: Buffer.alloc(0), tail: Buffer.alloc(0), dev: stats.dev, ino: stats.ino, size: 0, mtimeMs: stats.mtimeMs,
          parser: create(file), pending: '', decoder: new StringDecoder('utf8') };
      }
      if (stats.size !== entry.size || !entry.result) {
        const buffer = Buffer.alloc(Math.min(1024 * 1024, Math.max(1, stats.size - entry.size)));
        while (entry.size < stats.size) {
          const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, stats.size - entry.size), entry.size);
          if (!bytesRead) throw new Error('Transcript changed during incremental read');
          entry.size += bytesRead;
          const text = entry.pending + entry.decoder.write(buffer.subarray(0, bytesRead));
          let from = 0;
          for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n', from)) {
            entry.parser.push(text.slice(from, end));
            from = end + 1;
          }
          entry.pending = text.slice(from);
        }
        // Historical fixtures/files may omit the final newline. Accept a complete
        // JSON value, but keep incomplete writes until the next append arrives.
        if (entry.pending.trim()) {
          try {
            JSON.parse(entry.pending);
            entry.parser.push(entry.pending);
            entry.pending = '';
          } catch { /* incomplete final record */ }
        }
        entry.mtimeMs = stats.mtimeMs;
        entry.head = await bytesAt(0, Math.min(4096, stats.size));
        entry.tail = await bytesAt(Math.max(0, stats.size - 4096), Math.min(4096, stats.size));
        entry.result = { ...entry.parser.result(stats.size, stats.mtimeMs), transcriptGeneration: entry.generation };
      }
      cache.set(file, entry);
      let bytes = [...cache.values()].reduce((sum, item) => sum + item.size, 0);
      for (const [key, item] of cache) {
        if (cache.size <= maxFiles && (bytes <= maxBytes || cache.size === 1)) break;
        bytes -= item.size;
        cache.delete(key);
      }
      return entry.result!;
    } finally {
      await handle.close();
    }
  };
  return (file: string): Promise<ParseResult> => {
    const active = pending.get(file);
    if (active) return active;
    const job = read(file).finally(() => pending.delete(file));
    pending.set(file, job);
    return job;
  };
}
