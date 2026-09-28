/**
 * Session Vault continuity check (PAN-2609, FR-11).
 *
 * Every settlement compares the live native transcript with the tail the vault
 * saved last time. Per-line hashes travel with each chunk, so the check never
 * needs to download or decrypt earlier chunks: the saved tail carries the last
 * 16 line hashes and they are compared against the same positions in the live file.
 *
 * Verdicts: `noop` (nothing new), `append` (the live file only grew), `diverged`
 * (a saved line changed or the file shrank). Imports only Node built-ins.
 */
import { createHash } from 'node:crypto';

/** How many trailing line hashes a tail keeps. */
export const TAIL_HASH_COUNT = 16;

/** The saved position in a native transcript after a settlement. */
export interface Tail {
  /** Number of settled lines. */
  lineCount: number;
  /** Byte offset just past the last settled line's newline. */
  byteOffset: number;
  /** `lineHash` of the last up-to-16 settled lines, oldest first. */
  lastHashes: string[];
}

export type ContinuityVerdict = 'noop' | 'append' | 'diverged';

export type ContinuityResult =
  | { verdict: 'noop' }
  | { verdict: 'append'; newLines: string[] }
  | { verdict: 'diverged'; reason: string };

/** First 16 hex chars of SHA-256 over the raw line bytes (no trailing newline). */
export function lineHash(line: string | Uint8Array): string {
  return createHash('sha256').update(line).digest('hex').slice(0, 16);
}

export interface SettleableLines {
  /** Complete JSON lines, in order. */
  lines: string[];
  /** Bytes consumed from the start of `buffer`, ending after the last kept line's newline. */
  consumedBytes: number;
}

function isCompleteJson(line: string): boolean {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
}

/**
 * Split a transcript buffer into settleable lines. A trailing line that is not
 * complete JSON (a write still in progress) is dropped; a later call that sees
 * the completed line returns it. `consumedBytes` tells the caller where the
 * next read may start.
 */
export function splitSettleableLines(buffer: Uint8Array | string): SettleableLines {
  const text = typeof buffer === 'string' ? buffer : Buffer.from(buffer).toString('utf8');
  const parts = text.split('\n');
  const endsWithNewline = text.endsWith('\n');
  if (endsWithNewline) parts.pop();
  const lines = parts.filter((line) => line.length > 0);
  if (lines.length > 0 && !isCompleteJson(lines[lines.length - 1]!)) {
    lines.pop();
  }
  let consumedBytes = 0;
  for (const line of lines) consumedBytes += Buffer.byteLength(line, 'utf8') + 1;
  return { lines, consumedBytes };
}

/** The tail that describes `lines` after they are all settled. */
export function tailOf(lines: string[], byteOffset: number): Tail {
  const start = Math.max(0, lines.length - TAIL_HASH_COUNT);
  return {
    lineCount: lines.length,
    byteOffset,
    lastHashes: lines.slice(start).map((line) => lineHash(line)),
  };
}

/**
 * Compare the saved tail against the live file's settleable lines.
 * `liveLines` is the complete list of settleable lines in the live file.
 */
export function checkContinuity(tail: Tail, liveLines: readonly string[]): ContinuityResult {
  if (liveLines.length < tail.lineCount) {
    return {
      verdict: 'diverged',
      reason: `live file has ${liveLines.length} lines but ${tail.lineCount} were settled`,
    };
  }
  const compareCount = Math.min(tail.lastHashes.length, tail.lineCount);
  const firstIndex = tail.lineCount - compareCount;
  const savedHashes = tail.lastHashes.slice(tail.lastHashes.length - compareCount);
  for (let i = 0; i < compareCount; i++) {
    const position = firstIndex + i;
    if (lineHash(liveLines[position]!) !== savedHashes[i]) {
      return {
        verdict: 'diverged',
        reason: `line ${position + 1} differs from the settled copy`,
      };
    }
  }
  if (liveLines.length === tail.lineCount) return { verdict: 'noop' };
  return { verdict: 'append', newLines: liveLines.slice(tail.lineCount) };
}
