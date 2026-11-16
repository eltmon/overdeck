/**
 * Edit-workspace HTTP client (PAN-5191, WI-F12).
 *
 * The calls under /api/explorer/edit-workspaces/:workspaceId. POSTs send
 * the dashboard CSRF header. A non-2xx answer throws ExplorerHttpError with
 * the server's `{ error, code }`. The status query polls only for the editor
 * bar, every 15 s, and only while GitHub is still deciding whether an open PR
 * can merge (PAN-5290 C-D6), or while it can merge but its checks have not
 * all passed (PAN-5391); otherwise it is refreshed after a push, a merge
 * attempt and on Refresh. The changes
 * query (what will land, PAN-5290 C-D5) refetches on every explorer watch
 * batch of the edit root; its route never calls gh.
 */
import type {
  EditWorkspaceChanges,
  EditWorkspaceCreatePrInput,
  EditWorkspaceCreatePrResult,
  EditWorkspacePr,
  EditWorkspaceStatus,
} from '@overdeck/contracts'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport'
import { ExplorerHttpError } from '../explorer-http'
import { parseRootId } from '../explorer-rpc'
import { useExplorerWatch } from '../watch/useExplorerWatch'

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

export async function fetchEditWorkspaceChanges(workspaceId: string): Promise<EditWorkspaceChanges> {
  return answer<EditWorkspaceChanges>(await fetch(`${base(workspaceId)}/changes`), 'Reading what the edit workspace will land')
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

/** Each status read calls gh, so 15 s is the floor (PAN-5290 C-D6). */
export const PR_STATUS_REFETCH_MS = 15_000

/**
 * True while GitHub is still deciding whether an open PR can merge, or while
 * it can merge but its checks have not all passed (UNSTABLE, PAN-5391). A
 * draft, conflicting (DIRTY) or out-of-date (BEHIND) PR cannot change by itself.
 */
export function shouldPollPr(pr: EditWorkspacePr | null | undefined): boolean {
  if (!pr || pr.state !== 'OPEN' || pr.isDraft) return false
  if (pr.canMerge) return !pr.checksPassing
  return pr.mergeable === 'UNKNOWN' || pr.mergeStateStatus === 'UNKNOWN' || pr.mergeStateStatus === 'BLOCKED'
}

export function useEditWorkspaceStatus(workspaceId: string, { poll = false }: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: editWorkspaceStatusKey(workspaceId),
    queryFn: () => fetchEditWorkspaceStatus(workspaceId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
    refetchInterval: (query) => (poll && shouldPollPr(query.state.data?.pr) ? PR_STATUS_REFETCH_MS : false),
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

export const editWorkspaceChangesKey = (workspaceId: string) => ['explorer', 'edit-workspace-changes', workspaceId] as const

/** What the edit workspace will land; refetched on every explorer watch batch of its root. */
export function useEditWorkspaceChanges(workspaceId: string | null) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: editWorkspaceChangesKey(workspaceId ?? ''),
    queryFn: () => fetchEditWorkspaceChanges(workspaceId ?? ''),
    enabled: workspaceId !== null,
    staleTime: 2000,
    retry: false,
  })
  const refresh = (): void => {
    if (workspaceId !== null) void queryClient.invalidateQueries({ queryKey: editWorkspaceChangesKey(workspaceId), exact: true })
  }
  useExplorerWatch(workspaceId !== null ? `workspace:${workspaceId}` : undefined, { onDirsChanged: refresh, onResync: refresh })
  return query
}
