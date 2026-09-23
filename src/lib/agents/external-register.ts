/**
 * The registration door's one core (PAN-3920 W19, FR-16).
 *
 * `pan worker register` and `POST /api/workers/register` both validate with
 * `parseExternalRegisterFields` and write with `performExternalRegistration`:
 * no second registration path. The adapter source `codex-plugin` is reserved
 * for the Codex-plugin importer (W20).
 */
import { basename, isAbsolute } from 'node:path';

import { parseIssueIdSync } from '../issue-id.js';
import { checkTranscriptPath } from './external-paths.js';
import {
  EXTERNAL_FIELD_ID_RE,
  EXTERNAL_SOURCE_RE,
  ExternalPathError,
  RESERVED_EXTERNAL_SOURCES,
  hasRecordedTranscript,
  readPidStartTime,
  recordExternalTranscript,
  registerExternalAgent,
  type ExternalRegistrationInput,
} from './external-registry.js';

const HARNESS_RE = /^[a-z0-9-]{1,32}$/;
const MAX_ID = 128;
const MAX_TEXT = 200;
const MAX_PATH = 4096;

/** Raw fields as a CLI or an HTTP body supplies them. */
export interface ExternalRegisterFields {
  source?: unknown;
  externalId?: unknown;
  harness?: unknown;
  model?: unknown;
  cwd?: unknown;
  issue?: unknown;
  parent?: unknown;
  label?: unknown;
  pid?: unknown;
  transcript?: unknown;
  sessionId?: unknown;
}

export interface ExternalRegisterRequest {
  input: Omit<ExternalRegistrationInput, 'pidStartTime'>;
  transcript: { sessionId: string; path: string | null } | null;
}

export type ParsedRegisterFields =
  | { ok: true; value: ExternalRegisterRequest }
  | { ok: false; error: string };

function optionalText(value: unknown, field: string, max: number): string | null | { error: string } {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return { error: `${field} must be a string` };
  const text = value.trim();
  if (!text) return null;
  // eslint-disable-next-line no-control-regex
  if (text.length > max || /[\u0000-\u001f]/.test(text)) return { error: `${field} is too long or holds control characters` };
  return text;
}

function optionalId(value: unknown, field: string): string | null | { error: string } {
  const text = optionalText(value, field, MAX_ID);
  if (text === null || typeof text !== 'string') return text;
  return EXTERNAL_FIELD_ID_RE.test(text) ? text : { error: `${field} must match ${EXTERNAL_FIELD_ID_RE.source}` };
}

function optionalAbsolutePath(value: unknown, field: string): string | null | { error: string } {
  const text = optionalText(value, field, MAX_PATH);
  if (text === null || typeof text !== 'string') return text;
  return isAbsolute(text) ? text : { error: `${field} must be an absolute path` };
}

const isError = (value: unknown): value is { error: string } =>
  typeof value === 'object' && value !== null && 'error' in value;

/** Validate a registration request; every id is checked before any path is built (NFR-8). */
export function parseExternalRegisterFields(fields: ExternalRegisterFields): ParsedRegisterFields {
  const source = typeof fields.source === 'string' ? fields.source.trim() : '';
  if (!EXTERNAL_SOURCE_RE.test(source)) return { ok: false, error: `source must match ${EXTERNAL_SOURCE_RE.source}` };
  if (RESERVED_EXTERNAL_SOURCES.includes(source)) {
    return { ok: false, error: `source ${source} is reserved for Overdeck's own adapter` };
  }
  const externalId = optionalId(fields.externalId, 'externalId');
  if (isError(externalId)) return { ok: false, error: externalId.error };
  if (externalId === null) return { ok: false, error: 'externalId is required' };
  const harness = typeof fields.harness === 'string' ? fields.harness.trim() : '';
  if (!HARNESS_RE.test(harness)) return { ok: false, error: `harness is required and must match ${HARNESS_RE.source}` };

  const model = optionalText(fields.model, 'model', MAX_ID);
  const label = optionalText(fields.label, 'label', MAX_TEXT);
  const cwd = optionalAbsolutePath(fields.cwd, 'cwd');
  const parent = optionalId(fields.parent, 'parent');
  const transcript = optionalAbsolutePath(fields.transcript, 'transcript');
  const sessionId = optionalId(fields.sessionId, 'sessionId');
  const issueRaw = optionalText(fields.issue, 'issue', MAX_ID);
  for (const value of [model, label, cwd, parent, transcript, sessionId, issueRaw]) {
    if (isError(value)) return { ok: false, error: value.error };
  }
  let issueId: string | null = null;
  if (typeof issueRaw === 'string') {
    if (!parseIssueIdSync(issueRaw)) return { ok: false, error: `issue ${issueRaw} is not an issue id` };
    issueId = issueRaw.toUpperCase();
  }

  let pid: number | null = null;
  if (fields.pid !== undefined && fields.pid !== null && fields.pid !== '') {
    const parsed = typeof fields.pid === 'number' ? fields.pid : Number(fields.pid);
    if (!Number.isInteger(parsed) || parsed <= 0) return { ok: false, error: 'pid must be a positive integer' };
    pid = parsed;
  }

  // A transcript path alone names its session by the file name (a Codex
  // rollout ends in its thread id; a Claude transcript is <session>.jsonl).
  const transcriptPath = typeof transcript === 'string' ? transcript : null;
  const session = typeof sessionId === 'string'
    ? sessionId
    : transcriptPath ? basename(transcriptPath).replace(/\.jsonl$/, '') : null;

  return {
    ok: true,
    value: {
      input: {
        source,
        externalId,
        harness,
        model: model as string | null,
        cwd: cwd as string | null,
        issueId,
        parentId: parent as string | null,
        label: label as string | null,
        pid,
        logFile: null,
      },
      transcript: session ? { sessionId: session, path: transcriptPath } : null,
    },
  };
}

export interface ExternalRegisterDeps {
  readPidStartTime?: (pid: number) => Promise<string | null>;
}

/**
 * Write the registration (reading the pid's start time itself) and its
 * transcript link. The transcript path is checked before anything is written
 * (a regular file under the transcript roots; `ExternalPathError` otherwise).
 * A repeat registration writes no registration; it links the transcript only
 * when none is linked yet, so a retry after a failed append repairs the link.
 */
export async function performExternalRegistration(
  request: ExternalRegisterRequest,
  deps: ExternalRegisterDeps = {},
): Promise<{ id: string; created: boolean }> {
  if (request.transcript?.path) {
    const checked = await checkTranscriptPath(request.transcript.path);
    if (!checked.ok) throw new ExternalPathError(`transcript ${checked.error}`);
  }
  const pidStartTime = request.input.pid === null
    ? null
    : await (deps.readPidStartTime ?? readPidStartTime)(request.input.pid);
  const result = await registerExternalAgent({ ...request.input, pidStartTime });
  if (request.transcript && (result.created || !(await hasRecordedTranscript(result.id)))) {
    await recordExternalTranscript(result.id, {
      sessionId: request.transcript.sessionId,
      harness: request.input.harness,
      ...(request.input.model ? { model: request.input.model } : {}),
      ...(request.transcript.path ? { path: request.transcript.path } : {}),
    });
  }
  return result;
}
