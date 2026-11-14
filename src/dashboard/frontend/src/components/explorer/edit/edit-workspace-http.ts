/**
 * Edit-workspace HTTP client (PAN-5191, WI-F12).
 *
 * The four calls under /api/explorer/edit-workspaces/:workspaceId. POSTs send
 * the dashboard CSRF header. A non-2xx answer throws ExplorerHttpError with
 * the server's `{ error, code }`. The status query never polls: the banner
 * refreshes it after a push, a merge attempt and on Refresh.
 */
import type {
  EditWorkspaceCreatePrInput,
  EditWorkspaceCreatePrResult,
  EditWorkspaceStatus,
} from '@overdeck/contracts'
import { useQuery, type QueryClient } from '@tanstack/react-query'

import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport'
import { ExplorerHttpError } from '../explorer-http'
import { parseRootId } from '../explorer-rpc'

const base = (workspaceId: string) => `/api/explorer/edit-workspaces/${encodeURIComponent(workspaceId)}`

async function answer<T>(response: Response, what: string): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string }
  if (!response.ok) throw new ExplorerHttpError(body.error ?? `${what} failed (${response.status})`, response.status, body.code)
  return body as T
}

async function post<T>(url: string, body: unknown, what: string): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...(await dashboardMutationJsonHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return answer<T>(response, what)
}

export async function fetchEditWorkspaceStatus(workspaceId: string): Promise<EditWorkspaceStatus> {
  return answer<EditWorkspaceStatus>(await fetch(base(workspaceId)), 'Reading the edit workspace')
}

export function createEditWorkspacePr(workspaceId: string, input: EditWorkspaceCreatePrInput): Promise<EditWorkspaceCreatePrResult> {
  return post(`${base(workspaceId)}/pr`, input, 'Creating the PR')
}

export function mergeEditWorkspace(workspaceId: string): Promise<{ merged: true }> {
  return post(`${base(workspaceId)}/merge`, {}, 'Merging')
}

export function discardEditWorkspace(workspaceId: string, closePr: boolean): Promise<{ removed: true; prClosed: boolean }> {
  return post(`${base(workspaceId)}/discard`, { closePr }, 'Discarding')
}

export const editWorkspaceStatusKey = (workspaceId: string) => ['explorer', 'edit-workspace', workspaceId] as const

export function useEditWorkspaceStatus(workspaceId: string) {
  return useQuery({
    queryKey: editWorkspaceStatusKey(workspaceId),
    queryFn: () => fetchEditWorkspaceStatus(workspaceId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

export function refreshEditWorkspaceStatus(queryClient: QueryClient, workspaceId: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: editWorkspaceStatusKey(workspaceId) })
}

/** The workspace id of a `workspace:<id>` root, else null. */
export function workspaceIdOf(rootId: string): string | null {
  const parsed = parseRootId(rootId)
  return parsed?.kind === 'workspace' ? parsed.key : null
}
