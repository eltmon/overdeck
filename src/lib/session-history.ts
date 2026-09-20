import { randomUUID } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { writeFile } from 'node:fs/promises';
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

export interface SessionIndexEntry {
  sessionId: string;
  at: string;
  source: string;
  harness?: string;
  model?: string;
}

export type TranscriptCandidateKind = 'claude' | 'codex' | 'pi' | 'ohmypi' | 'acp' | 'kimi' | 'muse';
export interface TranscriptCandidate { kind: TranscriptCandidateKind; path: string }

export interface TranscriptCandidateSources {
  entries: readonly SessionIndexEntry[];
  currentHarness?: string | null;
  indexedPaths: ReadonlyMap<string, string>;
  launcherPinned?: TranscriptCandidate | null;
  stateDerived?: readonly TranscriptCandidate[];
  freshestInProjectDir?: TranscriptCandidate | null;
}

export function transcriptCandidateKey(kind: TranscriptCandidateKind, sessionId: string): string {
  return `${kind}:${sessionId}`;
}

export function transcriptCandidateKind(harness: string | null | undefined): TranscriptCandidateKind {
  const transcriptKind = getHarnessBehavior(harness as Parameters<typeof getHarnessBehavior>[0]).transcriptKind;
  if (transcriptKind === 'codex-rollout-jsonl') return 'codex';
  if (transcriptKind === 'ohmypi-jsonl') return harness === 'pi' ? 'pi' : 'ohmypi';
  if (transcriptKind === 'acp-jsonl') return 'acp';
  if (transcriptKind === 'kimi-wire-jsonl') return 'kimi';
  if (transcriptKind === 'muse-jsonl') return 'muse';
  return 'claude';
}

/** Pure authority ordering shared by sync and async transcript adapters. */
export function orderedTranscriptCandidates(sources: TranscriptCandidateSources): TranscriptCandidate[] {
  const candidates: TranscriptCandidate[] = [];
  for (const entry of [...sources.entries].reverse()) {
    const kind = transcriptCandidateKind(entry.harness ?? sources.currentHarness);
    const path = sources.indexedPaths.get(transcriptCandidateKey(kind, entry.sessionId));
    if (path) candidates.push({ kind, path });
  }
  if (sources.launcherPinned) candidates.push(sources.launcherPinned);
  candidates.push(...sources.stateDerived ?? []);
  if (sources.freshestInProjectDir) candidates.push(sources.freshestInProjectDir);

  const seen = new Set<string>();
  return candidates.filter(({ kind, path }) => {
    const key = `${kind}:${path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeSessionEntry(value: unknown, legacy = false): SessionIndexEntry | null {
  if (legacy && typeof value === 'string' && value.trim()) {
    return { sessionId: value.trim(), at: '', source: 'legacy-index' };
  }
  if (!value || typeof value !== 'object') return null;
  const entry = value as Partial<SessionIndexEntry>;
  if (typeof entry.sessionId !== 'string' || !entry.sessionId.trim()) return null;
  return {
    sessionId: entry.sessionId.trim(),
    at: typeof entry.at === 'string' ? entry.at : '',
    source: typeof entry.source === 'string' ? entry.source : 'unknown',
    ...(typeof entry.harness === 'string' && entry.harness.trim() ? { harness: entry.harness.trim() } : {}),
    ...(typeof entry.model === 'string' && entry.model.trim() ? { model: entry.model.trim() } : {}),
  };
}

export function parseSessionIndex(contents: string): SessionIndexEntry[] {
  const trimmed = contents.trimStart();
  let entries: SessionIndexEntry[] = [];
  let jsonLines = contents;
  if (trimmed.startsWith('[')) {
    const arrayEnd = trimmed.lastIndexOf(']');
    if (arrayEnd < 0) return [];
    try {
      const parsed: unknown = JSON.parse(trimmed.slice(0, arrayEnd + 1));
      entries = Array.isArray(parsed)
        ? parsed.flatMap((value) => {
            const entry = normalizeSessionEntry(value, true);
            return entry ? [entry] : [];
          })
        : [];
    } catch {
      return [];
    }
    jsonLines = trimmed.slice(arrayEnd + 1);
  }
  entries.push(...jsonLines.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const entry = normalizeSessionEntry(JSON.parse(line));
      return entry ? [entry] : [];
    } catch {
      return [];
    }
  }));

  const newestById = new Map<string, SessionIndexEntry>();
  for (const entry of entries) {
    newestById.delete(entry.sessionId);
    newestById.set(entry.sessionId, entry);
  }
  return [...newestById.values()];
}

export function readSessionIndexSync(agentId: string): SessionIndexEntry[] {
  try {
    const file = join(getOverdeckHome(), 'agents', agentId, 'sessions.json');
    if (!existsSync(file)) return [];
    return parseSessionIndex(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

export function readSessionIndexWithLegacySync(agentId: string): SessionIndexEntry[] {
  const file = join(getOverdeckHome(), 'agents', agentId, 'sessions.json');
  if (existsSync(file)) return readSessionIndexSync(agentId);
  const sessionId = readLegacySessionIdSync(agentId);
  return sessionId ? [{ sessionId, at: '', source: 'legacy-pointer' }] : [];
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
  return readSessionIndexWithLegacySync(agentId).at(-1)?.sessionId ?? null;
}

export function appendSessionIdToHistory(
  agentId: string,
  sessionId: string,
  source = 'observed',
  metadata: { harness?: string; model?: string } = {},
): void {
  sessionId = sessionId.trim();
  if (!sessionId) return;
  const dir = join(getOverdeckHome(), 'agents', agentId);
  mkdirSync(dir, { recursive: true });
  let recorded: { harness?: unknown; model?: unknown } = {};
  try { recorded = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')); } catch { /* legacy/no state */ }
  const harness = metadata.harness?.trim()
    || (typeof recorded.harness === 'string' ? recorded.harness.trim() : '')
    || 'unknown';
  const model = metadata.model?.trim()
    || (typeof recorded.model === 'string' ? recorded.model.trim() : '')
    || 'unknown';
  const line = `${JSON.stringify({ sessionId, at: new Date().toISOString(), source, harness, model })}\n`;
  if (Buffer.byteLength(line) > 4096) throw new Error('sessions.json entry exceeds PIPE_BUF');
  appendFileSync(join(dir, 'sessions.json'), line, { flag: 'a' });
}

/** Explicit operator reset is the only operation allowed to truncate the append-only index. */
export async function resetSessionIndex(
  agentId: string,
  dir = join(getOverdeckHome(), 'agents', agentId),
): Promise<void> {
  mkdirSync(dir, { recursive: true });
  await writeFile(join(dir, 'sessions.json'), '', { flag: 'w' });
}

export function createFreshSessionIdentity(agentId: string, harness: RuntimeName, model?: string): string | undefined {
  if (getHarnessBehavior(harness).sessionIdSource !== 'launcher-session-id') return undefined;
  const sessionId = randomUUID();
  appendSessionIdToHistory(agentId, sessionId, 'launcher', { harness, model });
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
