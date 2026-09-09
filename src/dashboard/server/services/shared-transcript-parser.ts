/** Coalesce full-parser jobs and reuse unchanged snapshots across browser subscribers. */
import { stat } from 'node:fs/promises';
import type { ParseResult } from './conversation/types.js';
import { runDashboardDbJob } from './dashboard-db-task.js';

type Parser = 'pi' | 'ohmypi' | 'codex' | 'acp' | 'muse' | 'kimi';
interface CachedParse {
  signature: string;
  bytes: number;
  result: Promise<ParseResult>;
}
const snapshots = new Map<string, CachedParse>();

export function sharedTranscriptParser(parser: Parser) {
  return async (sessionFile: string): Promise<ParseResult> => {
    const info = await stat(sessionFile);
    const key = `${parser}:${sessionFile}`;
    const signature = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
    const cached = snapshots.get(key);
    if (cached?.signature === signature) {
      snapshots.delete(key);
      snapshots.set(key, cached);
      return cached.result;
    }
    const result = runDashboardDbJob<ParseResult>('parseTranscriptSnapshot', { sessionFile, parser });
    const entry = { signature, bytes: info.size, result };
    snapshots.delete(key);
    snapshots.set(key, entry);
    // Keep one oversized active transcript: evicting it on every append would
    // defeat coalescing precisely for the histories that need it most.
    let bytes = [...snapshots.values()].reduce((sum, item) => sum + item.bytes, 0);
    for (const [oldKey, old] of snapshots) {
      if (snapshots.size <= 8 && (bytes <= 32 * 1024 * 1024 || snapshots.size === 1)) break;
      bytes -= old.bytes;
      snapshots.delete(oldKey);
    }
    try { return await result; }
    catch (error) {
      if (snapshots.get(key) === entry) snapshots.delete(key);
      throw error;
    }
  };
}
