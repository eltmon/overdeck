import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Data, Effect } from 'effect';
import { getPanopticonHome } from './paths.js';

export type RestartTrigger = 'pan reload' | 'pan restart' | 'watchdog';

export interface RestartStatus {
  ts: string;
  trigger: RestartTrigger;
  success: boolean;
  error?: string;
  durationMs: number;
  attempts: number;
  gaveUp?: boolean;
}

function restartStatusPath(): string {
  return join(getPanopticonHome(), 'restart-status.json');
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}async function writeRestartStatusPromise(entry: RestartStatus): Promise<void> {
  const path = restartStatusPath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}async function readRestartStatusPromise(): Promise<RestartStatus | null> {
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
      (parsed.gaveUp !== undefined && typeof parsed.gaveUp !== 'boolean')
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
    };
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return null;
    return null;
  }
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

