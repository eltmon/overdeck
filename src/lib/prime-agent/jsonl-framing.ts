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
  private buffered = Buffer.alloc(0);
  private readonly maxRecordBytes: number;

  constructor(options: PrimeAgentJsonlFramerOptions = {}) {
    this.maxRecordBytes = options.maxRecordBytes ?? 8 * 1024 * 1024;
    if (!Number.isInteger(this.maxRecordBytes) || this.maxRecordBytes < 1) {
      throw new PrimeAgentJsonlError('maxRecordBytes must be a positive integer');
    }
  }

  push(chunk: Uint8Array): unknown[] {
    if (chunk.byteLength === 0) return [];
    const input = this.buffered.byteLength === 0
      ? Buffer.from(chunk)
      : Buffer.concat([this.buffered, chunk], this.buffered.byteLength + chunk.byteLength);
    const records: unknown[] = [];
    let start = 0;

    for (let index = 0; index < input.byteLength; index += 1) {
      if (input[index] !== LF) continue;
      const rawEnd = index > start && input[index - 1] === CR ? index - 1 : index;
      const byteLength = rawEnd - start;
      if (byteLength > this.maxRecordBytes) this.throwOversized(byteLength);
      if (byteLength > 0) records.push(this.parse(input.subarray(start, rawEnd)));
      start = index + 1;
    }

    this.buffered = Buffer.from(input.subarray(start));
    if (this.buffered.byteLength > this.maxRecordBytes) this.throwOversized(this.buffered.byteLength);
    return records;
  }

  finish(): void {
    if (this.buffered.byteLength > 0) {
      throw new PrimeAgentJsonlError(`Prime Agent RPC stdout ended with ${this.buffered.byteLength} unterminated byte(s)`);
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
