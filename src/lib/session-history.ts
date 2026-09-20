import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getOverdeckHome } from './paths.js';
import { getHarnessBehavior } from './runtimes/behavior.js';
import type { RuntimeName } from './runtimes/types.js';
import { logAgentLifecycleSync } from './persistent-logger.js';

export const SESSION_RESET_MARKER = 'session-reset';

export function isSessionResetMarker(agentId: string): boolean {
  return existsSync(join(getOverdeckHome(), 'agents', agentId, SESSION_RESET_MARKER));
}

export function clearSessionResetMarker(agentId: string): void {
  try {
    unlinkSync(join(getOverdeckHome(), 'agents', agentId, SESSION_RESET_MARKER));
  } catch {
    // The marker is absent for normal launches.
  }
}

/**
 * Append-only session index. New entries carry their observation time and
 * source; string entries remain readable for compatibility with older files.
 */
export interface SessionIndexEntry {
  sessionId: string;
  at: string;
  source: string;
}

function parseSessionIndex(raw: unknown): SessionIndexEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value): SessionIndexEntry[] => {
    if (typeof value === 'string' && value.trim()) {
      return [{ sessionId: value.trim(), at: '', source: 'legacy-index' }];
    }
    if (!value || typeof value !== 'object') return [];
    const entry = value as Partial<SessionIndexEntry>;
    if (typeof entry.sessionId !== 'string' || !entry.sessionId.trim()) return [];
    return [{
      sessionId: entry.sessionId.trim(),
      at: typeof entry.at === 'string' ? entry.at : '',
      source: typeof entry.source === 'string' ? entry.source : 'unknown',
    }];
  });
}

const SESSION_INDEX_LOCK_DELAYS_MS = [5, 10, 20, 40, 80, 160, 320] as const;

function acquireSessionIndexLock(dir: string): string {
  const lockDir = join(dir, 'sessions.lock');
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt <= SESSION_INDEX_LOCK_DELAYS_MS.length; attempt++) {
    try {
      mkdirSync(lockDir, { mode: 0o700 });
      try {
        writeFileSync(join(lockDir, 'pid'), `${process.pid}\n`, 'utf8');
      } catch (error) {
        rmSync(lockDir, { recursive: true, force: true });
        throw error;
      }
      return lockDir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const owner = Number.parseInt(readFileSync(join(lockDir, 'pid'), 'utf8').trim(), 10);
        if (Number.isInteger(owner) && owner > 0 && owner !== process.pid) process.kill(owner, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
          rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      }
      const delay = SESSION_INDEX_LOCK_DELAYS_MS[attempt];
      if (delay === undefined) break;
      Atomics.wait(sleeper, 0, 0, delay);
    }
  }
  throw new Error(`sessions.json is locked: ${lockDir}`);
}

function writeSessionIndexAtomic(file: string, entries: SessionIndexEntry[]): void {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(entries), { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export function readSessionIndexSync(agentId: string): SessionIndexEntry[] {
  try {
    const file = join(getOverdeckHome(), 'agents', agentId, 'sessions.json');
    if (!existsSync(file)) return [];
    return parseSessionIndex(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return [];
  }
}

export function readSessionIdHistorySync(agentId: string): string[] {
  return readSessionIndexSync(agentId).map((entry) => entry.sessionId);
}

export function readLegacySessionIdSync(agentId: string): string | null {
  const file = join(getOverdeckHome(), 'agents', agentId, 'session.id'); // legacy read-only fallback
  try {
    const value = readFileSync(file, 'utf8').trim();
    return value || null;
  } catch {
    return null;
  }
}

export function readLatestIndexedSessionIdSync(agentId: string): string | null {
  const file = join(getOverdeckHome(), 'agents', agentId, 'sessions.json');
  const entries = readSessionIndexSync(agentId);
  if (entries.length > 0) return entries.at(-1)?.sessionId ?? null;
  return existsSync(file) ? null : readLegacySessionIdSync(agentId);
}

export function appendSessionIdToHistory(
  agentId: string,
  sessionId: string,
  source = 'observed',
): void {
  sessionId = sessionId.trim();
  if (!sessionId) return;
  const dir = join(getOverdeckHome(), 'agents', agentId);
  mkdirSync(dir, { recursive: true });
  const lockDir = acquireSessionIndexLock(dir);
  try {
    const file = join(dir, 'sessions.json');
    const entries = existsSync(file) ? parseSessionIndex(JSON.parse(readFileSync(file, 'utf8'))) : [];
    if (entries.some((entry) => entry.sessionId === sessionId)) return;
    entries.push({ sessionId, at: new Date().toISOString(), source });
    writeSessionIndexAtomic(file, entries);
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

/**
 * Allocate and durably record a fresh Claude work-agent UUID before launch.
 * This makes transcript discovery independent of lifecycle hooks and jq.
 */
export function createFreshSessionIdentity(agentId: string, harness: RuntimeName): string | undefined {
  if (getHarnessBehavior(harness).sessionIdSource !== 'launcher-session-id') return undefined;
  const sessionId = randomUUID();
  appendSessionIdToHistory(agentId, sessionId, 'launcher');
  const dir = join(getOverdeckHome(), 'agents', agentId);
  logAgentLifecycleSync(
    agentId,
    `session identity allocated: harness=${harness} sessionId=${sessionId} `
      + `indexPersisted=${existsSync(join(dir, 'sessions.json'))}`,
  );
  return sessionId;
}

export function logLauncherSessionPinned(agentId: string, sessionId: string, launcher: string): void {
  logAgentLifecycleSync(
    agentId,
    `launcher session pinned: sessionId=${sessionId} flag=--session-id launcher=${launcher}`,
  );
}
