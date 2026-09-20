/**
 * Durable session history and transcript-candidate ordering.
 *
 * `sessions.json` is append-only, including explicit reset boundaries. The
 * separate reset marker prevents compatibility fallbacks from reviving an old
 * transcript before the next launch has established a new session identity.
 */
import { randomUUID } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
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
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return; // absent for normal launches
    throw error;
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
export interface TranscriptCandidate { kind: TranscriptCandidateKind; path: string; model?: string }

export interface TranscriptCandidateSources {
  entries: readonly SessionIndexEntry[];
  currentHarness?: string | null;
  indexedPaths: ReadonlyMap<string, string>;
  launcherPinned?: TranscriptCandidate | null;
  stateDerived?: readonly TranscriptCandidate[];
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

/** Untagged legacy entries predate harness metadata and may belong to Claude. */
export function transcriptCandidateKinds(
  entryHarness: string | null | undefined,
  currentHarness: string | null | undefined,
): TranscriptCandidateKind[] {
  if (entryHarness) return [transcriptCandidateKind(entryHarness)];
  const current = transcriptCandidateKind(currentHarness);
  return current === 'claude' ? ['claude'] : [current, 'claude'];
}

/** Pure authority ordering shared by transcript adapters. */
export function orderedTranscriptCandidates(sources: TranscriptCandidateSources): TranscriptCandidate[] {
  const candidates: TranscriptCandidate[] = [];
  const legacyClaudeFallbacks: TranscriptCandidate[] = [];
  for (const entry of [...sources.entries].reverse()) {
    for (const kind of transcriptCandidateKinds(entry.harness, sources.currentHarness)) {
      const path = sources.indexedPaths.get(transcriptCandidateKey(kind, entry.sessionId));
      if (!path) continue;
      const candidate = { kind, path, ...(entry.model ? { model: entry.model } : {}) };
      if (!entry.harness && kind === 'claude' && transcriptCandidateKind(sources.currentHarness) !== 'claude') {
        legacyClaudeFallbacks.push(candidate);
      } else candidates.push(candidate);
    }
  }
  if (sources.launcherPinned) candidates.push(sources.launcherPinned);
  candidates.push(...sources.stateDerived ?? []);
  candidates.push(...legacyClaudeFallbacks);

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
  const applyRecord = (value: unknown, legacy = false): void => {
    if (value && typeof value === 'object' && (value as { reset?: unknown }).reset === true) {
      entries = [];
      return;
    }
    const entry = normalizeSessionEntry(value, legacy);
    if (entry) entries.push(entry);
  };
  if (trimmed.startsWith('[')) {
    const arrayEnd = trimmed.lastIndexOf(']');
    if (arrayEnd < 0) return [];
    try {
      const parsed: unknown = JSON.parse(trimmed.slice(0, arrayEnd + 1));
      if (Array.isArray(parsed)) parsed.forEach((value) => applyRecord(value, true));
    } catch {
      return [];
    }
    jsonLines = trimmed.slice(arrayEnd + 1);
  }
  for (const line of jsonLines.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      applyRecord(JSON.parse(line));
    } catch {
      // Append-only readers skip malformed observations and continue.
    }
  }

  const newestById = new Map<string, SessionIndexEntry>();
  for (const entry of entries) {
    newestById.delete(entry.sessionId);
    newestById.set(entry.sessionId, entry);
  }
  return [...newestById.values()];
}

export function latestSessionResetTime(contents: string): number | null {
  let latest: number | null = null;
  for (const line of contents.split(/\r?\n/)) {
    try {
      const value = JSON.parse(line) as { reset?: unknown; at?: unknown };
      if (value.reset === true && typeof value.at === 'string') {
        const timestamp = Date.parse(value.at);
        if (Number.isFinite(timestamp)) latest = timestamp;
      }
    } catch { /* legacy arrays and malformed observations are not reset boundaries */ }
  }
  return latest;
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

/**
 * Record an explicit reset without truncating concurrent observations, then
 * block compatibility fallbacks until a successful launch clears the marker.
 */
export async function resetSessionIndex(
  agentId: string,
  dir = join(getOverdeckHome(), 'agents', agentId),
): Promise<void> {
  mkdirSync(dir, { recursive: true });
  // A leading newline is intentional: legacy indexes were JSON arrays and did
  // not necessarily end with one. This keeps the reset independently parseable
  // without rewriting or truncating the append-only file.
  const line = `\n${JSON.stringify({ reset: true, at: new Date().toISOString(), source: 'operator-reset' })}\n`;
  appendFileSync(join(dir, 'sessions.json'), line, { flag: 'a' });
  writeFileSync(join(dir, SESSION_RESET_MARKER), '');
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
