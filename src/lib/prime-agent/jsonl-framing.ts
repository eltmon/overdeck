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

/** Incremental strict-LF JSONL decoder. It intentionally does not use readline. */
export class PrimeAgentJsonlFramer {
  private chunks: Buffer[] = [];
  private bufferedBytes = 0;
  private readonly maxRecordBytes: number;

  constructor(options: PrimeAgentJsonlFramerOptions = {}) {
    this.maxRecordBytes = options.maxRecordBytes ?? 8 * 1024 * 1024;
    if (!Number.isInteger(this.maxRecordBytes) || this.maxRecordBytes < 1) {
      throw new PrimeAgentJsonlError('maxRecordBytes must be a positive integer');
    }
  }

  push(chunk: Uint8Array): unknown[] {
    if (chunk.byteLength === 0) return [];
    const input = Buffer.from(chunk);
    const records: unknown[] = [];
    let start = 0;

    for (let index = 0; index < input.byteLength; index += 1) {
      if (input[index] !== LF) continue;
      const piece = input.subarray(start, index);
      const byteLength = this.bufferedBytes + piece.byteLength;
      if (byteLength > this.maxRecordBytes) this.throwOversized(byteLength);
      const record = this.chunks.length === 0
        ? piece
        : Buffer.concat([...this.chunks, piece], byteLength);
      const rawEnd = record.byteLength > 0 && record[record.byteLength - 1] === CR ? record.byteLength - 1 : record.byteLength;
      if (rawEnd > 0) records.push(this.parse(record.subarray(0, rawEnd)));
      this.chunks = [];
      this.bufferedBytes = 0;
      start = index + 1;
    }

    if (start < input.byteLength) {
      const tail = input.subarray(start);
      this.chunks.push(tail);
      this.bufferedBytes += tail.byteLength;
      if (this.bufferedBytes > this.maxRecordBytes) this.throwOversized(this.bufferedBytes);
    }
    return records;
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

  private throwOversized(byteLength: number): never {
    throw new PrimeAgentJsonlError(
      `Prime Agent RPC JSON record exceeded the ${this.maxRecordBytes}-byte limit (${byteLength} bytes received)`,
    );
  }
}

export function encodePrimeAgentJsonl(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
}
