/**
 * PAN-5111: the needs-you push history at `<OVERDECK_HOME>/logs/push-sent.jsonl`.
 *
 * Append-only JSONL with two line types joined by a per-entry `id` (D-2):
 * `{ v: 1, type: 'sent', ...PushSentRecord }` for every delivered push and
 * `{ v: 1, type: 'resolved', ...PushResolutionRecord }` when a pushed question or
 * approval leaves the pending set. Reads fold `resolved` lines onto `sent` lines
 * by id, in any order.
 *
 * A line stores the title and the delivery outcome codes only; question text
 * (`body`) and provider `detail` never reach disk (D-4). The file rotates to
 * `push-sent.jsonl.1` before it would pass 5 MiB, and loading reads `.1` first so
 * the newest entries span a rotation (D-5).
 *
 * Memory updates synchronously so the dispatcher can adopt entries at once
 * (`openEntryIdFor`, D-8); disk work runs on one serialized promise chain with
 * `fs/promises` only. Write errors are logged and never thrown (NFR-1).
 */
import { appendFile, mkdir, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { getOverdeckHome } from '../paths.js';
import type {
  PushDelivery,
  PushHistorySink,
  PushResolutionOutcome,
  PushResolutionRecord,
  PushSentRecord,
} from './types.js';

export const PUSH_HISTORY_FILE = 'push-sent.jsonl';
export const PUSH_HISTORY_MAX_BYTES = 5 * 1024 * 1024;
export const PUSH_HISTORY_RECENT_LIMIT = 50;
/** How many `sent` records stay in memory. */
const MEMORY_LIMIT = 200;

export type PushEntryState = 'open' | 'answered' | 'resolved-without-answer' | null;

export interface PushHistoryEntry extends PushSentRecord {
  resolution: { outcome: PushResolutionOutcome; ts: string } | null;
}

export interface PushHistory extends PushHistorySink {
  /** Newest first, at most `limit` (default 50), resolutions folded in. */
  recent(limit?: number): Promise<PushHistoryEntry[]>;
  /** Resolves when the initial load finished (the service awaits it at start). */
  ready(): Promise<void>;
  /** Resolves when every queued write has landed (tests). */
  flush(): Promise<void>;
}

type Resolution = { outcome: PushResolutionOutcome; ts: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/** Keeps only the stored delivery fields; `detail` and any other property are dropped (D-4). */
function storedDelivery(d: PushDelivery): PushDelivery {
  const out: PushDelivery = { provider: String(d.provider), target: String(d.target), ok: d.ok === true };
  if (typeof d.reason === 'string') out.reason = d.reason;
  if (typeof d.status === 'number') out.status = d.status;
  return out;
}

/** Keeps only the `PushSentRecord` fields; `body`, `publicTitle` and any other property are dropped (D-4). */
function storedSent(r: PushSentRecord): PushSentRecord {
  return {
    id: String(r.id),
    ts: String(r.ts),
    kind: r.kind,
    category: r.category,
    key: String(r.key),
    subject: typeof r.subject === 'string' ? r.subject : null,
    title: typeof r.title === 'string' ? r.title : '',
    issueId: typeof r.issueId === 'string' ? r.issueId : null,
    url: typeof r.url === 'string' ? r.url : '',
    deliveries: Array.isArray(r.deliveries) ? r.deliveries.map(storedDelivery) : [],
  };
}

function isOutcome(value: unknown): value is PushResolutionOutcome {
  return value === 'answered' || value === 'resolved-without-answer';
}

export function createPushHistory(opts: { dir?: string; maxBytes?: number } = {}): PushHistory {
  const dir = opts.dir ?? join(getOverdeckHome(), 'logs');
  const maxBytes = opts.maxBytes ?? PUSH_HISTORY_MAX_BYTES;
  const path = join(dir, PUSH_HISTORY_FILE);
  const rotatedPath = `${path}.1`;

  /** Oldest first. */
  let sent: PushSentRecord[] = [];
  let resolutions = new Map<string, Resolution>();
  let currentBytes = 0;

  function trim(): void {
    if (sent.length <= MEMORY_LIMIT) return;
    for (const dropped of sent.slice(0, sent.length - MEMORY_LIMIT)) resolutions.delete(dropped.id);
    sent = sent.slice(sent.length - MEMORY_LIMIT);
  }

  async function readLines(file: string): Promise<{ text: string; lines: string[] }> {
    try {
      const text = await readFile(file, 'utf8');
      return { text, lines: text.split('\n') };
    } catch (error) {
      if (!isMissing(error)) console.warn('[push] history read failed:', errorMessage(error));
      return { text: '', lines: [] };
    }
  }

  async function load(): Promise<void> {
    const loadedSent: PushSentRecord[] = [];
    const loadedResolutions = new Map<string, Resolution>();
    const rotated = await readLines(rotatedPath);
    const current = await readLines(path);
    currentBytes = Buffer.byteLength(current.text, 'utf8');
    for (const line of [...rotated.lines, ...current.lines]) {
      if (!line.trim()) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') continue;
      if (parsed.type === 'sent') {
        loadedSent.push(storedSent(parsed as unknown as PushSentRecord));
      } else if (parsed.type === 'resolved' && isOutcome(parsed.outcome)) {
        loadedResolutions.set(parsed.id, { outcome: parsed.outcome, ts: String(parsed.ts) });
      }
    }
    // Records made before the load finished are newer than anything on disk.
    sent = [...loadedSent, ...sent];
    trim();
    const merged = new Map<string, Resolution>([...loadedResolutions, ...resolutions]);
    const kept = new Set(sent.map((r) => r.id));
    resolutions = new Map([...merged].filter(([id]) => kept.has(id)));
  }

  let chain: Promise<void> = load().catch((error: unknown) => {
    console.warn('[push] history load failed:', errorMessage(error));
  });
  const loaded = chain;

  async function append(line: string): Promise<void> {
    const data = `${line}\n`;
    const bytes = Buffer.byteLength(data, 'utf8');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (currentBytes > 0 && currentBytes + bytes > maxBytes) {
      try {
        await rename(path, rotatedPath);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      currentBytes = 0;
    }
    await appendFile(path, data, { mode: 0o600 });
    currentBytes += bytes;
  }

  function enqueue(line: string): void {
    chain = chain
      .then(() => append(line))
      .catch((error: unknown) => {
        console.warn('[push] history write failed:', errorMessage(error));
      });
  }

  return {
    recordSent(record) {
      const stored = storedSent(record);
      sent.push(stored);
      trim();
      enqueue(JSON.stringify({ v: 1, type: 'sent', ...stored }));
    },
    recordResolution(record) {
      if (!isOutcome(record.outcome)) return;
      const stored: PushResolutionRecord = { id: String(record.id), ts: String(record.ts), outcome: record.outcome };
      resolutions.set(stored.id, { outcome: stored.outcome, ts: stored.ts });
      enqueue(JSON.stringify({ v: 1, type: 'resolved', ...stored }));
    },
    openEntryIdFor(subject, key) {
      const globalKey = key.startsWith('auq:') || key.startsWith('plan:');
      for (let i = sent.length - 1; i >= 0; i--) {
        const r = sent[i]!;
        if (r.key !== key || resolutions.has(r.id)) continue;
        if (!globalKey && r.subject !== subject) continue;
        return { id: r.id, ts: r.ts };
      }
      return null;
    },
    async recent(limit = PUSH_HISTORY_RECENT_LIMIT) {
      await chain;
      const count = Math.max(0, Math.floor(limit));
      return sent
        .slice(Math.max(0, sent.length - count))
        .reverse()
        .map((r) => ({ ...r, deliveries: r.deliveries.map((d) => ({ ...d })), resolution: resolutions.get(r.id) ?? null }));
    },
    ready() {
      return loaded;
    },
    flush() {
      return chain;
    },
  };
}

let singleton: PushHistory | null = null;

/** The process singleton under `join(getOverdeckHome(), 'logs')`. */
export function getPushHistory(): PushHistory {
  singleton ??= createPushHistory();
  return singleton;
}

export interface PushStateContext {
  trackedIds: ReadonlySet<string>;
  /** True when the running dispatcher has this key pending for this subject now. */
  isPending: (subject: string, key: string) => boolean;
  /** D-8: 60 s since service start and one completed conversation scan. */
  warm: boolean;
}

/** D-8: the derived state of one entry. Nothing stores `open`; it is read-time only. */
export function pushEntryState(entry: PushHistoryEntry, ctx: PushStateContext): PushEntryState {
  if (!entry.key.startsWith('auq:') && !entry.key.startsWith('plan:') && !entry.key.startsWith('perm:')) return null;
  if (entry.resolution) return entry.resolution.outcome;
  if (ctx.trackedIds.has(entry.id)) return 'open';
  if (entry.subject !== null && ctx.isPending(entry.subject, entry.key)) return 'open';
  return ctx.warm ? 'resolved-without-answer' : null;
}
