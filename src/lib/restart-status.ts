import { appendFile, mkdir, readFile, rename, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Data, Effect } from 'effect';
import { getOverdeckHome } from './paths.js';

const MAX_JOURNAL_ENTRIES = 200;

export type RestartTrigger = 'pan reload' | 'pan restart' | 'watchdog';

export interface RestartStatus {
  ts: string;
  trigger: RestartTrigger;
  success: boolean;
  error?: string;
  durationMs: number;
  attempts: number;
  gaveUp?: boolean;
  /** Why the restart was triggered (e.g. the watchdog's probe-failure classification). */
  reason?: string;
  /** PID of the process that wrote this entry — identifies the writer when
   *  multiple restart flows overlap (see PAN-1714 follow-up). */
  pid?: number;
  /** Overdeck actor that ran the restart (OVERDECK_AGENT_ID), e.g.
   *  'conv-20260610-8858' or 'agent-pan-1647-review'. Absent = unmanaged shell. */
  initiator?: string;
  /** Issue the initiating agent was working on (OVERDECK_ISSUE_ID). */
  issueId?: string;
}

function restartStatusPath(): string {
  return join(getOverdeckHome(), 'restart-status.json');
}

function restartEventsPath(): string {
  return join(getOverdeckHome(), 'restart-events.jsonl');
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function parseRestartEventLine(line: string): RestartStatus | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Partial<RestartStatus>;
    if (
      typeof parsed.ts !== 'string' ||
      (parsed.trigger !== 'pan reload' && parsed.trigger !== 'pan restart' && parsed.trigger !== 'watchdog') ||
      typeof parsed.success !== 'boolean' ||
      typeof parsed.durationMs !== 'number' ||
      !Number.isFinite(parsed.durationMs) ||
      typeof parsed.attempts !== 'number' ||
      !Number.isFinite(parsed.attempts) ||
      (parsed.error !== undefined && typeof parsed.error !== 'string') ||
      (parsed.gaveUp !== undefined && typeof parsed.gaveUp !== 'boolean') ||
      (parsed.reason !== undefined && typeof parsed.reason !== 'string') ||
      (parsed.pid !== undefined && typeof parsed.pid !== 'number') ||
      (parsed.initiator !== undefined && typeof parsed.initiator !== 'string') ||
      (parsed.issueId !== undefined && typeof parsed.issueId !== 'string')
    ) {
      return null;
    }
    return {
      ts: parsed.ts,
      trigger: parsed.trigger,
      success: parsed.success,
      error: parsed.error,
      durationMs: parsed.durationMs,
      attempts: parsed.attempts,
      gaveUp: parsed.gaveUp,
      reason: parsed.reason,
      pid: parsed.pid,
      initiator: parsed.initiator,
      issueId: parsed.issueId,
    };
  } catch {
    return null;
  }
}

async function appendRestartEvent(entry: RestartStatus): Promise<void> {
  try {
    const path = restartEventsPath();
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Journal append is best-effort and must never fail the primary status write.
  }
}

/** Trim the persisted journal to MAX_JOURNAL_ENTRIES using an atomic temp-file
 *  rename. A mkdir-based lock prevents concurrent compactions from racing. */
async function compactRestartEvents(): Promise<void> {
  const path = restartEventsPath();
  const lockPath = `${path}.lock`;
  try {
    await mkdir(lockPath);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'EEXIST') return;
    // Lock acquisition failed for another reason; skip compact.
    return;
  }

  try {
    const content = await readFile(path, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim() !== '');
    if (lines.length <= MAX_JOURNAL_ENTRIES) return;

    const trimmed = lines.slice(-MAX_JOURNAL_ENTRIES);
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${trimmed.join('\n')}\n`, 'utf8');
    await rename(tmp, path);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return;
    // Best-effort compact; ignore other errors.
  } finally {
    try {
      await rmdir(lockPath);
    } catch {
      // ignore
    }
  }
}

async function writeRestartStatusPromise(entry: RestartStatus): Promise<void> {
  const path = restartStatusPath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
  await appendRestartEvent(entry);
  await compactRestartEvents();
}

async function readRestartEventsPromise(limit: number = MAX_JOURNAL_ENTRIES): Promise<RestartStatus[]> {
  try {
    const content = await readFile(restartEventsPath(), 'utf8');
    const events: RestartStatus[] = [];
    for (const line of content.split('\n')) {
      const event = parseRestartEventLine(line);
      if (event) events.push(event);
    }
    if (limit >= 0 && events.length > limit) {
      return events.slice(-limit);
    }
    return events;
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readRestartStatusPromise(): Promise<RestartStatus | null> {
  try {
    const parsed = JSON.parse(await readFile(restartStatusPath(), 'utf8')) as Partial<RestartStatus>;
    if (
      typeof parsed.ts !== 'string' ||
      (parsed.trigger !== 'pan reload' && parsed.trigger !== 'pan restart' && parsed.trigger !== 'watchdog') ||
      typeof parsed.success !== 'boolean' ||
      typeof parsed.durationMs !== 'number' ||
      !Number.isFinite(parsed.durationMs) ||
      typeof parsed.attempts !== 'number' ||
      !Number.isFinite(parsed.attempts) ||
      (parsed.error !== undefined && typeof parsed.error !== 'string') ||
      (parsed.gaveUp !== undefined && typeof parsed.gaveUp !== 'boolean') ||
      (parsed.reason !== undefined && typeof parsed.reason !== 'string') ||
      (parsed.pid !== undefined && typeof parsed.pid !== 'number') ||
      (parsed.initiator !== undefined && typeof parsed.initiator !== 'string') ||
      (parsed.issueId !== undefined && typeof parsed.issueId !== 'string')
    ) {
      return null;
    }
    return {
      ts: parsed.ts,
      trigger: parsed.trigger,
      success: parsed.success,
      error: parsed.error,
      durationMs: parsed.durationMs,
      attempts: parsed.attempts,
      gaveUp: parsed.gaveUp,
      reason: parsed.reason,
      pid: parsed.pid,
      initiator: parsed.initiator,
      issueId: parsed.issueId,
    };
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return null;
    return null;
  }
}

/** Detect successful restart-status writes within `windowMs` of each other
 *  that were produced by different processes. */
export function detectConcurrentRestartWriters(
  events: RestartStatus[],
  windowMs = 60000,
): RestartStatus[] {
  const successful = events.filter((event) => event.success);
  const writers: RestartStatus[] = [];
  for (let i = 0; i < successful.length; i++) {
    for (let j = i + 1; j < successful.length; j++) {
      const a = successful[i];
      const b = successful[j];
      if (a.pid === undefined || b.pid === undefined || a.pid === b.pid) continue;
      const aTs = new Date(a.ts).getTime();
      const bTs = new Date(b.ts).getTime();
      if (!Number.isFinite(aTs) || !Number.isFinite(bTs)) continue;
      if (Math.abs(aTs - bTs) <= windowMs) {
        if (!writers.includes(a)) writers.push(a);
        if (!writers.includes(b)) writers.push(b);
      }
    }
  }
  return writers;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Tagged error for restart-status Effect variants. */
export class RestartStatusError extends Data.TaggedError('RestartStatusError')<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Effect variant of `writeRestartStatus`. */
export const writeRestartStatus = (
  entry: RestartStatus,
): Effect.Effect<void, RestartStatusError> =>
  Effect.tryPromise({
    try: () => writeRestartStatusPromise(entry),
    catch: (cause) =>
      new RestartStatusError({
        operation: 'writeRestartStatus',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `readRestartStatus`. */
export const readRestartStatus = (): Effect.Effect<RestartStatus | null, RestartStatusError> =>
  Effect.tryPromise({
    try: () => readRestartStatusPromise(),
    catch: (cause) =>
      new RestartStatusError({
        operation: 'readRestartStatus',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `readRestartEvents`. */
export const readRestartEvents = (
  limit?: number,
): Effect.Effect<RestartStatus[], RestartStatusError> =>
  Effect.tryPromise({
    try: () => readRestartEventsPromise(limit),
    catch: (cause) =>
      new RestartStatusError({
        operation: 'readRestartEvents',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

