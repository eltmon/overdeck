/**
 * Client for the overdeck.ai directory routes (PAN-2356): `GET /api/directory` and the operator's
 * directory actions. Every fetcher returns `{ status, body }` (see anywhereApi.ts) so a panel can
 * show the server's error text.
 */
import type { DirectoryResponse } from '@overdeck/contracts';

import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport';
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

async function post<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  return readResult(await fetch(path, {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}

const enc = encodeURIComponent;

/** Ask one machine (or every machine of the account) to approve this one. */
export function joinDirectory(to: string | null): Promise<ApiResult<{ requestId: string }>> {
  return post('/api/directory/join', to ? { to } : {});
}

export function acceptJoin(requestId: string): Promise<ApiResult<{ ok: true }>> {
  return post(`/api/directory/joins/${enc(requestId)}/accept`);
}

export function rejectJoin(requestId: string): Promise<ApiResult<{ ok: true }>> {
  return post(`/api/directory/joins/${enc(requestId)}/reject`);
}

/** Open the approval channel; answers the code both screens must show. */
export function openApproval(requestId: string): Promise<ApiResult<{ sas: string; fingerprint: string }>> {
  return post(`/api/directory/approvals/${enc(requestId)}/open`);
}

export function approveApproval(requestId: string): Promise<ApiResult<{ approving: true }>> {
  return post(`/api/directory/approvals/${enc(requestId)}/approve`);
}

export function rejectApproval(requestId: string): Promise<ApiResult<{ ok: true }>> {
  return post(`/api/directory/approvals/${enc(requestId)}/reject`);
}

export function forgetDirectoryMachine(environmentId: string): Promise<ApiResult<{ ok: true }>> {
  return post('/api/directory/forget', { environmentId });
}
