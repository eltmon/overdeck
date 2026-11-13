/** Bounded worker-local parser state: append reads avoid decoding the history again. */
import { open } from 'node:fs/promises';
import type { ParseResult, RecordLocation } from './conversation/types.js';
import {
  RECORD_PARSE_MAX_BYTES,
  TRANSCRIPT_CACHE_MAX_RETAINED_CHARS,
  TRANSCRIPT_ENTRY_MAX_RETAINED_CHARS,
  scrubImageDataUrls,
} from './conversation/tool-result-bounds.js';

/** Bytes of an oversized record's start that `pushOversized` receives, decoded. */
const OVERSIZED_HEAD_BYTES = 4096;

export interface Accumulator {
  push(line: string, location?: RecordLocation): void;
  /** PAN-5211: a record over `recordParseMaxBytes` after the scrub; only its first bytes are decoded. */
  pushOversized?(head: string, location: RecordLocation): void;
  result(size: number, mtimeMs: number): ParseResult;
  /** PAN-5211: retained characters of the rows this accumulator holds. */
  retainedChars(): number;
}

export interface AccumulatorOptions {
  /** Byte offset of the first record the accumulator will receive. */
  readonly historyStartOffset: number;
}

export interface IncrementalTranscriptReaderOptions {
  readonly maxEntryRetainedChars?: number;
  readonly maxCacheRetainedChars?: number;
  readonly tailReadBytes?: number;
  readonly recordParseMaxBytes?: number;
}

export interface TranscriptLineSplitter {
  /** Split a chunk on `0x0A`; complete lines go to `onLine`, the rest is kept. */
  write(chunk: Buffer): void;
  /** Emit a final record that has no newline yet, when it is a complete JSON value. */
  flushComplete(): void;
  /** Bytes of the partial last line, not yet emitted. */
  pending(): Buffer[];
}

function isCompleteJson(bytes: Buffer): boolean {
  const text = scrubImageDataUrls(bytes).toString('utf8');
  if (!text.trim()) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * PAN-5211: split transcript bytes into lines without decoding them. `0x0A` never occurs inside a UTF-8
 * multibyte sequence, so a byte split is safe; each line arrives with its absolute byte location.
 */
export function createTranscriptLineSplitter(
  startOffset: number,
  onLine: (line: Buffer, location: RecordLocation) => void,
): TranscriptLineSplitter {
  let pieces: Buffer[] = [];
  let lineStart = startOffset;

  const emit = (line: Buffer): void => {
    onLine(line, { offset: lineStart, length: line.length });
  };

  return {
    write(chunk: Buffer): void {
      let from = 0;
      for (let end = chunk.indexOf(10, from); end !== -1; end = chunk.indexOf(10, from)) {
        const segment = chunk.subarray(from, end);
        const line = pieces.length === 0 ? segment : Buffer.concat([...pieces, segment]);
        pieces = [];
        emit(line);
        lineStart += line.length + 1;
        from = end + 1;
      }
      // The caller reuses its read buffer, so keep a copy of the partial line.
      if (from < chunk.length) pieces.push(Buffer.from(chunk.subarray(from)));
    },
    flushComplete(): void {
      if (pieces.length === 0) return;
      const line = pieces.length === 1 ? pieces[0]! : Buffer.concat(pieces);
      if (!isCompleteJson(line)) return;
      pieces = [];
      emit(line);
      // No newline yet: the next append's leading `\n` closes this record as an empty line.
      lineStart += line.length;
    },
    pending(): Buffer[] {
      return pieces;
    },
  };
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
  splitter: TranscriptLineSplitter;
  result?: ParseResult;
}

export function createIncrementalTranscriptReader(
  create: (file: string, options: AccumulatorOptions) => Accumulator,
  options: IncrementalTranscriptReaderOptions = {},
) {
  const recordParseMaxBytes = options.recordParseMaxBytes ?? RECORD_PARSE_MAX_BYTES;
  const maxEntryRetainedChars = options.maxEntryRetainedChars ?? TRANSCRIPT_ENTRY_MAX_RETAINED_CHARS;
  const maxCacheRetainedChars = options.maxCacheRetainedChars ?? TRANSCRIPT_CACHE_MAX_RETAINED_CHARS;
  const cache = new Map<string, Entry>();
  const pending = new Map<string, Promise<ParseResult>>();
  let generation = 0;
  const maxFiles = 8;

  const newEntry = (file: string, stats: { dev: number; ino: number; mtimeMs: number }, start: number): Entry => {
    const parser = create(file, { historyStartOffset: start });
    const splitter = createTranscriptLineSplitter(start, (line, location) => {
      if (line.length === 0) return;
      const scrubbed = scrubImageDataUrls(line);
      if (scrubbed.length > recordParseMaxBytes) {
        parser.pushOversized?.(scrubbed.toString('utf8', 0, OVERSIZED_HEAD_BYTES), location);
      } else {
        parser.push(scrubbed.toString('utf8'), location);
      }
    });
    return {
      generation: ++generation, head: Buffer.alloc(0), tail: Buffer.alloc(0), dev: stats.dev, ino: stats.ino,
      size: start, mtimeMs: stats.mtimeMs, parser, splitter,
    };
  };

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
        entry = newEntry(file, stats, 0);
      }
      if (stats.size !== entry.size || !entry.result) {
        const buffer = Buffer.alloc(Math.min(1024 * 1024, Math.max(1, stats.size - entry.size)));
        while (entry.size < stats.size) {
          const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, stats.size - entry.size), entry.size);
          if (!bytesRead) throw new Error('Transcript changed during incremental read');
          entry.size += bytesRead;
          entry.splitter.write(buffer.subarray(0, bytesRead));
        }
        // Historical fixtures/files may omit the final newline. Accept a complete
        // JSON value, but keep incomplete writes until the next append arrives.
        entry.splitter.flushComplete();
        entry.mtimeMs = stats.mtimeMs;
        entry.head = await bytesAt(0, Math.min(4096, stats.size));
        entry.tail = await bytesAt(Math.max(0, stats.size - 4096), Math.min(4096, stats.size));
        entry.result = { ...entry.parser.result(stats.size, stats.mtimeMs), transcriptGeneration: entry.generation };
      }
      // PAN-5211: an entry over the hard cap is returned but never cached, so no single
      // transcript can hold more than the cap between reads.
      if (entry.parser.retainedChars() > maxEntryRetainedChars) return entry.result!;
      cache.set(file, entry);
      let retained = 0;
      for (const item of cache.values()) retained += item.parser.retainedChars();
      for (const [key, item] of cache) {
        if (cache.size <= maxFiles && retained <= maxCacheRetainedChars) break;
        if (key === file) continue;
        retained -= item.parser.retainedChars();
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
