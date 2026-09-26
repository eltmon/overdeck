/**
 * Strict-LF JSONL framing for the Prime Agent RPC stdio protocol (PAN-3668 WI-9,
 * FR-6, NFR-2). Records split on `\n` only, with one trailing `\r` stripped. Node
 * `readline` is not used because it also splits on U+2028 and U+2029, which are
 * valid inside JSON strings (Prime `docs/rpc.md` "Framing").
 */

/** Default bound on one RPC record (NFR-2). */
export const PRIME_AGENT_MAX_RECORD_BYTES = 16 * 1024 * 1024;

const LF = 0x0a;
const CR = 0x0d;

export class PrimeAgentJsonlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrimeAgentJsonlError';
  }
}

export interface PrimeAgentJsonlFramerOptions {
  maxRecordBytes?: number;
}

export interface PrimeAgentJsonlPushResult {
  /** Every record that parsed, in stream order. */
  records: unknown[];
  /** One entry per record that did not parse. The stream continues past each. */
  errors: PrimeAgentJsonlError[];
}

/** Incremental strict-LF JSONL decoder. It intentionally does not use readline. */
export class PrimeAgentJsonlFramer {
  private chunks: Buffer[] = [];
  private bufferedBytes = 0;
  private readonly maxRecordBytes: number;

  constructor(options: PrimeAgentJsonlFramerOptions = {}) {
    this.maxRecordBytes = options.maxRecordBytes ?? PRIME_AGENT_MAX_RECORD_BYTES;
    if (!Number.isInteger(this.maxRecordBytes) || this.maxRecordBytes < 1) {
      throw new PrimeAgentJsonlError('maxRecordBytes must be a positive integer');
    }
  }

  /**
   * A malformed record is reported and skipped, never thrown (rpc-framing.ac3:
   * "a malformed JSON record yields a per-record error while later records
   * still parse"). The buffered prefix and the record boundary are reset
   * BEFORE the record is parsed, so a parse failure cannot leave stale state
   * behind and corrupt every record after it.
   */
  push(chunk: Uint8Array): PrimeAgentJsonlPushResult {
    if (chunk.byteLength === 0) return { records: [], errors: [] };
    const input = Buffer.from(chunk);
    const records: unknown[] = [];
    const errors: PrimeAgentJsonlError[] = [];
    let start = 0;

    for (let index = 0; index < input.byteLength; index += 1) {
      if (input[index] !== LF) continue;
      const piece = input.subarray(start, index);
      const byteLength = this.bufferedBytes + piece.byteLength;
      const oversized = byteLength > this.maxRecordBytes;
      const record = this.chunks.length === 0
        ? piece
        : Buffer.concat([...this.chunks, piece], byteLength);
      // Reset first: everything below this line may fail on THIS record, and
      // the next record's boundary must not depend on whether it did.
      this.chunks = [];
      this.bufferedBytes = 0;
      start = index + 1;
      if (oversized) {
        errors.push(this.oversizedError(byteLength));
        continue;
      }
      const rawEnd = record.byteLength > 0 && record[record.byteLength - 1] === CR ? record.byteLength - 1 : record.byteLength;
      if (rawEnd === 0) continue;
      try {
        records.push(this.parse(record.subarray(0, rawEnd)));
      } catch (error) {
        errors.push(error as PrimeAgentJsonlError);
      }
    }

    if (start < input.byteLength) {
      const tail = input.subarray(start);
      this.chunks.push(tail);
      this.bufferedBytes += tail.byteLength;
      if (this.bufferedBytes > this.maxRecordBytes) {
        // An unterminated prefix past the cap cannot be recovered per record —
        // there is no boundary yet. Drop it and report, so the framer keeps
        // bounded memory and resynchronises on the next newline.
        this.chunks = [];
        this.bufferedBytes = 0;
        errors.push(this.oversizedError(tail.byteLength));
      }
    }
    return { records, errors };
  }

  finish(): void {
    if (this.bufferedBytes > 0) {
      throw new PrimeAgentJsonlError(`Prime Agent RPC stdout ended with ${this.bufferedBytes} unterminated byte(s)`);
    }
  }

  private parse(record: Uint8Array): unknown {
    try {
      return JSON.parse(Buffer.from(record).toString('utf8')) as unknown;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new PrimeAgentJsonlError(`Malformed Prime Agent RPC JSON record (${record.byteLength} bytes): ${message}`);
    }
  }

  private oversizedError(byteLength: number): PrimeAgentJsonlError {
    return new PrimeAgentJsonlError(
      `Prime Agent RPC JSON record exceeded the ${this.maxRecordBytes}-byte limit (${byteLength} bytes received)`,
    );
  }
}

export function encodePrimeAgentJsonl(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
}
