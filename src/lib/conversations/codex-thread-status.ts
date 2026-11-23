/**
 * Whether a Codex rollout's newest turn is still running (PAN-3920 W2), and
 * whether it failed (PAN-5633).
 *
 * Reads only the rollout's last 128 KiB and walks it backwards to the newest
 * `task_started` / `task_complete` / `turn_aborted` event. Lives in `src/lib`
 * so lib modules can ask without importing dashboard-server code.
 *
 * A failed turn is a `task_complete` that carries an `error` object, with the
 * structured code in `error.codex_error_info` (snake_case in the rollout, for
 * example `unauthorized` or `context_window_exceeded`). A successful
 * `task_complete` has no `error` key.
 *
 * Opens with O_NONBLOCK and refuses anything but a regular file, so a path
 * that names a FIFO can never block the caller (PAN-3920 #4038 review).
 *
 * Import leaf: this module imports only `node:fs`, so `codex-auth.ts` can take
 * its types without pulling in an agent or conversation store (PAN-5633 D9).
 */
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue {
  if (typeof value === 'string') {
    try { return object(JSON.parse(value)); } catch { return {}; }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
}

export type CodexTurnFailureKind = 'auth' | 'context-window' | 'other';

export interface CodexTurnFailure {
  /** The error message, trimmed, at most 300 characters. */
  readonly message: string;
  /** The record's `timestamp` (ISO), or '' when absent. */
  readonly at: string;
  /** Raw `codex_error_info`: the string, or an object variant's first key; null when absent. */
  readonly code: string | null;
  readonly kind: CodexTurnFailureKind;
}

/** PAN-5633: a live Codex session whose newest turn failed on sign-in. Built by auth-failure-scan.ts, read by codex-auth.ts. */
export interface CodexAuthFailure {
  readonly id: string;
  readonly at: string;
  readonly message: string;
}

export interface CodexLastTurn {
  readonly status: 'running' | 'done';
  /** Set only when the newest turn-end event is a task_complete carrying `error`. */
  readonly failure: CodexTurnFailure | null;
}

const MAX_MESSAGE_CHARS = 300;
const AUTH_MESSAGE = /refresh token|could not be refreshed|sign in again|log out and sign in/i;

export function classifyCodexTurnFailure(code: string | null, message: string): CodexTurnFailureKind {
  if (code === 'unauthorized') return 'auth';
  if (code === 'context_window_exceeded' || code === 'contextWindowExceeded') return 'context-window';
  return AUTH_MESSAGE.test(message) ? 'auth' : 'other';
}

/** `codex_error_info` is a string, or an object variant such as `{"response_stream_disconnected":{}}`. */
function errorCode(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value)[0] ?? null;
  }
  return null;
}

function turnFailure(error: unknown, timestamp: unknown): CodexTurnFailure | null {
  if (error === null || typeof error !== 'object' || Array.isArray(error)) return null;
  const record = error as ObjectValue;
  const message = typeof record.message === 'string' ? record.message.trim().slice(0, MAX_MESSAGE_CHARS) : '';
  const code = errorCode(record.codex_error_info);
  return {
    message,
    at: typeof timestamp === 'string' ? timestamp : '',
    code,
    kind: classifyCodexTurnFailure(code, message),
  };
}

export async function readCodexLastTurn(file: string): Promise<CodexLastTurn> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`${file} is not a regular file`);
    const { size } = info;
    const start = Math.max(0, size - 128 * 1024);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    for (const line of lines.reverse()) {
      const entry = object(line);
      if (entry.type !== 'event_msg') continue;
      const payload = object(entry.payload);
      if (payload.type === 'task_started') return { status: 'running', failure: null };
      if (payload.type === 'turn_aborted') return { status: 'done', failure: null };
      if (payload.type === 'task_complete') {
        return { status: 'done', failure: turnFailure(payload.error, entry.timestamp) };
      }
    }
    return { status: 'running', failure: null };
  } finally { await handle.close(); }
}

export async function codexThreadStatus(file: string): Promise<'running' | 'done'> {
  return (await readCodexLastTurn(file)).status;
}
