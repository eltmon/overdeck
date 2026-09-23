/**
 * External agent registry (PAN-3920 W18, D20, D21).
 *
 * An external agent is one another tool launched (for example the Codex
 * plugin's detached `codex` job). Overdeck did not launch it and cannot stop
 * or message it; it can only show it. A registration records facts, never
 * status:
 *
 *   ~/.overdeck/agents/ext-<source>-<slug>/registration.json  write-once (`wx`)
 *   ~/.overdeck/agents/ext-<source>-<slug>/sessions.json      append-only index
 *
 * Later facts (thread id, transcript path) are appended to `sessions.json`, so
 * the agent transcript route (`/api/agents/:id/conversation`) reads external
 * agents with no change. Liveness is derived on every read from the recorded
 * pid and its start time; nothing here ever writes a state.
 *
 * Async fs only: the dashboard server imports this module.
 */
import { createHash } from 'node:crypto';
import { access, mkdir, open, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { codexThreadStatus } from '../conversations/codex-thread-status.js';
import { getOverdeckHome } from '../paths.js';
import {
  appendSessionIdToHistory,
  parseSessionIndex,
  type SessionIndexEntry,
  type TranscriptCandidateKind,
} from '../session-history.js';

export const EXTERNAL_AGENT_PREFIX = 'ext-';
export const REGISTRATION_FILE = 'registration.json';
/** Sources other tools may register under; `codex-plugin` is the adapter's own. */
export const EXTERNAL_SOURCE_RE = /^[a-z0-9-]{1,32}$/;
export const RESERVED_EXTERNAL_SOURCES: readonly string[] = ['codex-plugin'];
/** NFR-8: ids from callers are validated before any path is built. */
export const EXTERNAL_FIELD_ID_RE = /^[A-Za-z0-9_:.-]+$/;
const MAX_ID_LENGTH = 80;
const SOURCE_TAG = 'external-register';

export type ExternalSource = 'registered' | 'codex-plugin';

export interface ExternalRegistration {
  /** ext-<source>-<slug> */
  id: string;
  source: ExternalSource;
  /** The caller's id (plugin job id, …). */
  externalId: string;
  /** The name the caller registered under (`--source`); equals `source` for the adapter. */
  registeredBy: string;
  /** 'codex', 'claude-code', … */
  harness: string;
  model: string | null;
  cwd: string | null;
  issueId: string | null;
  /** Agent id, conversation tmux session, or `claude-session:<uuid>`. */
  parentId: string | null;
  label: string | null;
  pid: number | null;
  /** Field 22 of /proc/<pid>/stat, read when the pid was recorded. */
  pidStartTime: string | null;
  logFile: string | null;
  registeredAt: string;
}

export type ExternalRegistrationInput = Omit<ExternalRegistration, 'id' | 'registeredAt' | 'source' | 'registeredBy'> & {
  /** `codex-plugin` for the adapter; any other valid source name is a `registered` entry. */
  source: string;
};

export type ExternalLiveness = 'alive' | 'dead' | 'unknown';

function agentsRoot(): string {
  return join(getOverdeckHome(), 'agents');
}

export function isExternalAgentId(id: string): boolean {
  return id.startsWith(EXTERNAL_AGENT_PREFIX);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/**
 * `ext-<source>-<slug>`: the slug is the external id when it is already a
 * clean lowercase slug that fits; otherwise a lossy slug plus a short hash of
 * the raw id, so two different external ids never share a directory.
 */
export function externalAgentId(source: string, externalId: string): string {
  const prefix = `${EXTERNAL_AGENT_PREFIX}${slugify(source)}-`;
  const room = MAX_ID_LENGTH - prefix.length;
  const clean = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(externalId) && externalId.length <= room;
  if (clean) return `${prefix}${externalId}`;
  const hash = createHash('sha256').update(externalId).digest('hex').slice(0, 8);
  const slug = slugify(externalId).slice(0, room - hash.length - 1).replace(/-$/, '');
  return `${prefix}${slug ? `${slug}-` : ''}${hash}`;
}

export function externalAgentDir(id: string): string {
  return join(agentsRoot(), id);
}

function sourceKind(source: string): ExternalSource {
  return source === 'codex-plugin' ? 'codex-plugin' : 'registered';
}

/**
 * Write the registration once. A second registration of the same
 * `(source, externalId)` returns the existing id and writes nothing (FR-16).
 */
export async function registerExternalAgent(
  input: ExternalRegistrationInput,
  now: () => Date = () => new Date(),
): Promise<{ id: string; created: boolean }> {
  if (!EXTERNAL_SOURCE_RE.test(input.source)) throw new Error(`invalid source ${JSON.stringify(input.source)}`);
  if (!input.externalId.trim()) throw new Error('externalId is required');
  const id = externalAgentId(input.source, input.externalId);
  const dir = externalAgentDir(id);
  const registration: ExternalRegistration = {
    id,
    source: sourceKind(input.source),
    externalId: input.externalId,
    registeredBy: input.source,
    harness: input.harness,
    model: input.model,
    cwd: input.cwd,
    issueId: input.issueId,
    parentId: input.parentId,
    label: input.label,
    pid: input.pid,
    pidStartTime: input.pidStartTime,
    logFile: input.logFile,
    registeredAt: now().toISOString(),
  };
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(join(dir, REGISTRATION_FILE), `${JSON.stringify(registration, null, 2)}\n`, { flag: 'wx' });
    return { id, created: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { id, created: false };
    throw error;
  }
}

async function readIndex(id: string): Promise<SessionIndexEntry[]> {
  try {
    return parseSessionIndex(await readFile(join(externalAgentDir(id), 'sessions.json'), 'utf8'));
  } catch {
    return [];
  }
}

/** True when the registration's session index already names a transcript path. */
export async function hasRecordedTranscript(id: string): Promise<boolean> {
  return (await readIndex(id)).some((entry) => Boolean(entry.path));
}

/**
 * Append the transcript facts to `sessions.json` (D20). Skipped when the index
 * already holds the same session with a path, so repeated scans write nothing.
 */
export async function recordExternalTranscript(
  id: string,
  transcript: { sessionId: string; harness: string; model?: string; path?: string },
): Promise<boolean> {
  const existing = (await readIndex(id)).find((entry) => entry.sessionId === transcript.sessionId.trim());
  if (existing && (existing.path || !transcript.path)) return false;
  appendSessionIdToHistory(id, transcript.sessionId, SOURCE_TAG, {
    harness: transcript.harness,
    ...(transcript.model ? { model: transcript.model } : {}),
    ...(transcript.path ? { path: transcript.path } : {}),
  });
  return true;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Parse one registration.json; null for anything that is not a registration. */
export function parseRegistration(raw: string): ExternalRegistration | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  const id = str(r.id);
  const externalId = str(r.externalId);
  const harness = str(r.harness);
  const registeredAt = str(r.registeredAt);
  if (!id || !isExternalAgentId(id) || !externalId || !harness || !registeredAt) return null;
  const pid = typeof r.pid === 'number' && Number.isInteger(r.pid) && r.pid > 0 ? r.pid : null;
  return {
    id,
    source: r.source === 'codex-plugin' ? 'codex-plugin' : 'registered',
    externalId,
    registeredBy: str(r.registeredBy) ?? (r.source === 'codex-plugin' ? 'codex-plugin' : 'registered'),
    harness,
    model: str(r.model),
    cwd: str(r.cwd),
    issueId: str(r.issueId),
    parentId: str(r.parentId),
    label: str(r.label),
    pid,
    pidStartTime: str(r.pidStartTime),
    logFile: str(r.logFile),
    registeredAt,
  };
}

export async function readExternalRegistration(id: string): Promise<ExternalRegistration | null> {
  if (!isExternalAgentId(id) || !EXTERNAL_FIELD_ID_RE.test(id)) return null;
  try {
    return parseRegistration(await readFile(join(externalAgentDir(id), REGISTRATION_FILE), 'utf8'));
  } catch {
    return null;
  }
}

export async function listExternalRegistrations(): Promise<ExternalRegistration[]> {
  let names: string[];
  try {
    names = (await readdir(agentsRoot(), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && isExternalAgentId(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  const registrations = await Promise.all(names.map((name) => readExternalRegistration(name)));
  return registrations.filter((registration): registration is ExternalRegistration => registration !== null);
}

// ─── liveness (D21) ──────────────────────────────────────────────────────────

/** Field 22 (starttime) of a /proc/<pid>/stat line. The comm field may hold spaces and parens. */
export function parseProcStatStartTime(stat: string): string | null {
  const close = stat.lastIndexOf(')');
  if (close < 0) return null;
  // Fields after comm start at field 3 (state); field 22 is index 19 of the rest.
  const rest = stat.slice(close + 1).trim().split(/\s+/);
  return rest[19] ?? null;
}

export interface ProcReader {
  /** Contents of /proc/<pid>/stat, or null when the process does not exist. */
  readStat: (pid: number) => Promise<string | null>;
  /** Whether this platform has /proc at all. */
  hasProc: () => Promise<boolean>;
  /** `process.kill(pid, 0)` succeeded (or failed with EPERM). */
  signalZero: (pid: number) => boolean;
}

export const defaultProcReader: ProcReader = {
  readStat: (pid) => readFile(`/proc/${pid}/stat`, 'utf8').catch(() => null),
  hasProc: () => access('/proc/self/stat').then(() => true, () => false),
  signalZero: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  },
};

/** The start time to record next to a pid, or null when it cannot be read. */
export async function readPidStartTime(pid: number, proc: ProcReader = defaultProcReader): Promise<string | null> {
  const stat = await proc.readStat(pid);
  return stat ? parseProcStatStartTime(stat) : null;
}

/**
 * D21: alive = /proc/<pid>/stat exists and its start time equals the recorded
 * one (a reused pid is dead). Without /proc: `kill(pid, 0)`. No pid, or a pid
 * with no recorded start time on a /proc platform, is `unknown`.
 */
export async function externalLiveness(
  registration: Pick<ExternalRegistration, 'pid' | 'pidStartTime'>,
  proc: ProcReader = defaultProcReader,
): Promise<ExternalLiveness> {
  const { pid, pidStartTime } = registration;
  if (pid === null) return 'unknown';
  if (!(await proc.hasProc())) return proc.signalZero(pid) ? 'alive' : 'dead';
  const stat = await proc.readStat(pid);
  if (stat === null) return 'dead';
  if (pidStartTime === null) return 'unknown';
  return parseProcStatStartTime(stat) === pidStartTime ? 'alive' : 'dead';
}

// ─── transcript completion ───────────────────────────────────────────────────

const CLAUDE_TAIL_BYTES = 64 * 1024;

async function readTail(path: string, bytes: number): Promise<string[]> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines;
  } finally {
    await handle.close();
  }
}

async function claudeTurnComplete(path: string): Promise<boolean> {
  for (const line of (await readTail(path, CLAUDE_TAIL_BYTES)).reverse()) {
    if (!line.trim()) continue;
    let record: { type?: unknown; message?: { stop_reason?: unknown } };
    try { record = JSON.parse(line); } catch { continue; }
    if (record.type !== 'assistant') continue;
    return record.message?.stop_reason === 'end_turn';
  }
  return false;
}

/**
 * Whether the transcript's last turn finished: Codex by its newest task event,
 * Claude by the last assistant record's `end_turn`. Other kinds: false.
 */
export async function transcriptTurnComplete(kind: TranscriptCandidateKind, path: string): Promise<boolean> {
  try {
    if (kind === 'codex') return (await codexThreadStatus(path)) === 'done';
    if (kind === 'claude') return await claudeTurnComplete(path);
  } catch {
    return false;
  }
  return false;
}

const TURN_CACHE_MAX = 2048;
const turnCache = new Map<string, boolean>();

/**
 * `transcriptTurnComplete`, cached by path + size + mtime so a directory read
 * re-reads a transcript tail only when the file changed.
 */
export async function cachedTranscriptTurnComplete(kind: TranscriptCandidateKind, path: string): Promise<boolean> {
  let key: string;
  try {
    const info = await stat(path);
    key = `${kind}:${path}:${info.size}:${info.mtimeMs}`;
  } catch {
    return false;
  }
  const cached = turnCache.get(key);
  if (cached !== undefined) return cached;
  const complete = await transcriptTurnComplete(kind, path);
  if (turnCache.size >= TURN_CACHE_MAX) turnCache.delete(turnCache.keys().next().value!);
  turnCache.set(key, complete);
  return complete;
}
