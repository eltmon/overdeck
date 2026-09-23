/**
 * External agents in the Agents Directory (PAN-3920 W21, FR-18, D3, D21).
 *
 * One entry per registration under `~/.overdeck/agents/ext-*`. Everything
 * but the registration's own facts is derived on read (D1):
 *
 *   state — the recorded pid is alive (same start time)      → working
 *           else the transcript's last turn is complete       → done
 *           else, with no pid to ask, the transcript was
 *           written in the last 120 s                          → working
 *           else                                              → stopped
 *   lastActivityAt — transcript mtime, else registeredAt
 *   transcript     — the agent route, when a transcript candidate exists
 *
 * The pid-less rule is the subagent rule (D3) applied to registrations that
 * carry no pid, so a registered agent that is still writing is not shown as
 * stopped. Transcript tails are read through a size+mtime cache, so an
 * unchanged transcript costs one `stat` per directory build.
 */
import { stat } from 'node:fs/promises';

import type { DirectoryEntry, DirectoryEntryState } from '@overdeck/contracts';

import {
  cachedTranscriptTurnComplete,
  externalLiveness,
  listExternalRegistrations,
  type ExternalLiveness,
  type ExternalRegistration,
} from '../../../lib/agents/external-registry.js';
import { resolveAgentTranscriptCandidate } from '../../../lib/agents/transcript-resolver.js';
import { withConcurrencyLimitPromise } from '../../../lib/concurrency.js';
import type { TranscriptCandidate, TranscriptCandidateKind } from '../../../lib/session-history.js';

/** A registration still writing its transcript this recently counts as working when it has no pid. */
export const EXTERNAL_WORKING_MTIME_MS = 120_000;
const EXTERNAL_CONCURRENCY = 8;
const LABEL_MAX = 80;

export interface ExternalDirectoryCandidate {
  readonly entry: DirectoryEntry;
  /** Used for the D5 project fallback; never leaves the server. */
  readonly cwd: string | null;
}

export interface ExternalDirectorySources {
  readonly listRegistrations: () => Promise<readonly ExternalRegistration[]>;
  readonly liveness: (registration: ExternalRegistration) => Promise<ExternalLiveness>;
  readonly resolveTranscript: (registration: ExternalRegistration) => Promise<TranscriptCandidate | null>;
  readonly mtimeMs: (path: string) => Promise<number | null>;
  readonly turnComplete: (kind: TranscriptCandidateKind, path: string) => Promise<boolean>;
}

export const defaultExternalDirectorySources: ExternalDirectorySources = {
  listRegistrations: listExternalRegistrations,
  liveness: (registration) => externalLiveness(registration),
  // Directory reads never write lifecycle log lines (D1).
  resolveTranscript: (registration) =>
    resolveAgentTranscriptCandidate(registration.id, registration.cwd ?? '', { logDiagnostic: () => {} }),
  mtimeMs: (path) => stat(path).then((info) => info.mtimeMs, () => null),
  turnComplete: cachedTranscriptTurnComplete,
};

function truncate(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

export function externalState(
  liveness: ExternalLiveness,
  turnComplete: boolean,
  transcriptAgeMs: number | null,
): DirectoryEntryState {
  if (liveness === 'alive') return 'working';
  if (turnComplete) return 'done';
  if (liveness === 'unknown' && transcriptAgeMs !== null && transcriptAgeMs <= EXTERNAL_WORKING_MTIME_MS) return 'working';
  return 'stopped';
}

async function externalCandidate(
  registration: ExternalRegistration,
  now: number,
  sources: ExternalDirectorySources,
): Promise<ExternalDirectoryCandidate> {
  const [liveness, transcript] = await Promise.all([
    sources.liveness(registration).catch((): ExternalLiveness => 'unknown'),
    sources.resolveTranscript(registration).catch(() => null),
  ]);
  const mtime = transcript ? await sources.mtimeMs(transcript.path) : null;
  const complete = liveness !== 'alive' && transcript
    ? await sources.turnComplete(transcript.kind, transcript.path).catch(() => false)
    : false;
  const lastActivityMs = mtime ?? Date.parse(registration.registeredAt);
  return {
    cwd: registration.cwd,
    entry: {
      id: registration.id,
      kind: 'external',
      label: truncate(registration.label ?? registration.externalId, LABEL_MAX),
      location: 'local',
      projectKey: 'unassigned',
      issueId: registration.issueId ? registration.issueId.toUpperCase() : null,
      issueTitle: null,
      parentId: registration.parentId,
      role: null,
      harness: registration.harness,
      model: registration.model ?? transcript?.model ?? 'unknown',
      state: externalState(liveness, complete, mtime === null ? null : now - mtime),
      startedAt: registration.registeredAt,
      lastActivityAt: Number.isFinite(lastActivityMs) ? new Date(lastActivityMs).toISOString() : registration.registeredAt,
      costUsd: null,
      source: registration.source,
      transcript: transcript ? { route: 'agent', agentId: registration.id } : null,
    },
  };
}

/** Every registration as a directory candidate; the directory applies D4–D6. */
export async function listExternalCandidates(
  now: number,
  sources: ExternalDirectorySources = defaultExternalDirectorySources,
): Promise<ExternalDirectoryCandidate[]> {
  const registrations = await sources.listRegistrations();
  return withConcurrencyLimitPromise(
    registrations.map((registration) => () => externalCandidate(registration, now, sources)),
    EXTERNAL_CONCURRENCY,
  );
}
