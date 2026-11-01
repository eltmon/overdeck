/**
 * Client for the overdeck.ai directory routes (PAN-2356): `GET /api/directory` and the operator's
 * directory actions. Every fetcher returns `{ status, body }` (see anywhereApi.ts) so a panel can
 * show the server's error text.
 */
import type { DirectoryResponse } from '@overdeck/contracts';

import { apiError, type ApiResult, isOk } from './anywhereApi';

export type { DirectoryApprovalView, DirectoryJoinView, DirectoryMachineView, DirectoryResponse } from '@overdeck/contracts';

export const DIRECTORY_QUERY_KEY = ['anywhere-directory'] as const;

async function readResult<T>(response: Response): Promise<ApiResult<T>> {
  const body = (await response.json().catch(() => null)) as T | { error?: string } | null;
  return { status: response.status, body };
}

export async function fetchDirectory(): Promise<ApiResult<DirectoryResponse>> {
  return readResult(await fetch('/api/directory'));
}

/** Query function for `['anywhere-directory']`: the directory state, or a thrown error. */
export async function loadDirectory(): Promise<DirectoryResponse> {
  const result = await fetchDirectory();
  if (!isOk(result)) throw new Error(apiError(result));
  return result.body;
}

/** The directory inbox needs a connected directory and the Anywhere plan. */
export function inboxAvailable(directory: DirectoryResponse | undefined): boolean {
  return directory?.state === 'online' && directory.plan === 'tester';
}
