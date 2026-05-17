import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
}

export function writeRestartStatus(entry: RestartStatus): void {
  const path = restartStatusPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

export function readRestartStatus(): RestartStatus | null {
  try {
    const parsed = JSON.parse(readFileSync(restartStatusPath(), 'utf8')) as Partial<RestartStatus>;
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
