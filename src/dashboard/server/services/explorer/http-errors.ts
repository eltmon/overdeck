/**
 * HTTP error mapping for the explorer routes (PAN-5188, PRD §6.4).
 *
 * The explorer services throw a PanRpcError carrying an explorer `code`, or a
 * raw Node errno error. `explorerErrorResponse` turns either into a JSON body
 * `{ error, code }` with the matching HTTP status; anything unmapped is a 500
 * without a code, and its message is logged.
 */
import type { HttpServerResponse } from 'effect/unstable/http';
import { jsonResponse } from '../../http-helpers.js';

const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  PATH_OUTSIDE_ROOT: 400,
  PATH_IN_GIT_DIR: 400,
  INVALID_NAME: 400,
  ROOT_NOT_FOUND: 404,
  NOT_FOUND: 404,
  EDIT_WORKSPACE_REQUIRED: 409,
  ALREADY_EXISTS: 409,
  FILE_TOO_LARGE: 413,
};

const CODE_BY_ERRNO: Readonly<Record<string, string>> = {
  ENOENT: 'NOT_FOUND',
  ENOTDIR: 'NOT_FOUND',
  EEXIST: 'ALREADY_EXISTS',
};

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { _tag, code } = error as { _tag?: unknown; code?: unknown };
  if (typeof code !== 'string') return undefined;
  if (_tag === 'PanRpcError') return code;
  return Object.hasOwn(CODE_BY_ERRNO, code) ? CODE_BY_ERRNO[code] : undefined;
}

export function explorerErrorResponse(error: unknown): HttpServerResponse.HttpServerResponse {
  const raw = (error as { message?: unknown } | null | undefined)?.message;
  const message = typeof raw === 'string' ? raw : String(error);
  const code = errorCode(error);
  if (code !== undefined && Object.hasOwn(STATUS_BY_CODE, code)) {
    return jsonResponse({ error: message, code }, { status: STATUS_BY_CODE[code] });
  }
  console.error(`[explorer] ${message}`);
  return jsonResponse({ error: message }, { status: 500 });
}
