/**
 * Explorer error helpers (PAN-5183).
 *
 * Every explorer service throws a PanRpcError whose `code` is one of
 * EXPLORER_ERROR_CODES. `explorerError` builds one; `toExplorerRpcError`
 * maps anything else a service or the filesystem throws onto that set.
 */
import { PanRpcError, type ExplorerErrorCode } from '@overdeck/contracts';

export function explorerError(code: ExplorerErrorCode, message: string): PanRpcError {
  return new PanRpcError({ code, message });
}

/** PanRpcError passes through; errno ENOENT/ENOTDIR → NOT_FOUND, EEXIST → ALREADY_EXISTS; anything else → EXPLORER_FAILED. */
export function toExplorerRpcError(error: unknown): PanRpcError {
  if (error instanceof PanRpcError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const errno = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (errno === 'ENOENT' || errno === 'ENOTDIR') return explorerError('NOT_FOUND', message);
  if (errno === 'EEXIST') return explorerError('ALREADY_EXISTS', message);
  return explorerError('EXPLORER_FAILED', message);
}
