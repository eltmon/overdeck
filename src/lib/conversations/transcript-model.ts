/**
 * The model a transcript last ran on, read from its tail (PAN-3920).
 *
 * Claude Code assistant records carry `message.model`; Codex rollouts carry
 * `turn_context.payload.model`. Only the last 64 KiB is read, newest record
 * first, and the answer is memoized per (file, mtime) so a directory rebuild
 * every few seconds re-reads a file only after it changed. Read-only; async
 * fs only.
 */
import { open } from 'node:fs/promises';

const TAIL_BYTES = 64 * 1024;
const CACHE_MAX = 2048;
const cache = new Map<string, string | null>();

function modelOf(line: string): string | null {
  if (!line.includes('"model"')) return null;
  let entry: unknown;
  try { entry = JSON.parse(line); } catch { return null; }
  if (typeof entry !== 'object' || entry === null) return null;
  const record = entry as { type?: unknown; message?: { model?: unknown }; payload?: { model?: unknown } };
  const claude = record.message?.model;
  // Claude Code stamps harness-injected assistant lines with `<synthetic>`.
  if (typeof claude === 'string' && claude && !claude.startsWith('<')) return claude;
  const codex = record.type === 'turn_context' ? record.payload?.model : undefined;
  return typeof codex === 'string' && codex ? codex : null;
}

/** The newest model named in the transcript's tail, or null when none is found or the file is unreadable. */
export async function readTranscriptModel(file: string, mtimeMs: number | null): Promise<string | null> {
  const key = `${file}\u0000${mtimeMs ?? ''}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let model: string | null = null;
  try {
    const handle = await open(file, 'r');
    try {
      const { size } = await handle.stat();
      const start = Math.max(0, size - TAIL_BYTES);
      const buffer = Buffer.alloc(size - start);
      await handle.read(buffer, 0, buffer.length, start);
      const lines = buffer.toString('utf8').split('\n');
      if (start > 0) lines.shift();
      for (let i = lines.length - 1; i >= 0 && model === null; i--) model = modelOf(lines[i]!);
    } finally {
      await handle.close();
    }
  } catch {
    model = null;
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, model);
  return model;
}
