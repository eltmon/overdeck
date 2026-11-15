// What a conversation changed, from GET /api/conversations/:name/changes (PAN-5289 §6.5).
//
// The query refetches every 5 s only while the conversation is working (NFR-2)
// and again on every explorer watch batch for the root. `useScopeChangedPaths`
// turns the scope=conversation answer into the root paths the Files tab dots
// and the palette rank first; it shares the Changes tab's cache.

import { useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { ChangeScope, ConversationChanges } from '@overdeck/contracts'

import type { Conversation } from '../CommandDeck/ConversationList'
import { listDir } from '../explorer/explorer-rpc'
import { useExplorerStore } from '../explorer/explorerStore'
import { useExplorerWatch } from '../explorer/watch/useExplorerWatch'
import { changedPathsOf } from './changes-model'
import type { DockScope } from './dockScope'

export const CHANGES_REFETCH_MS = 5000
const CHANGES_STALE_MS = 4000

export function conversationChangesKey(name: string, scope: ChangeScope, turnId?: string): readonly unknown[] {
  return ['conversation-changes', name, scope, turnId ?? null]
}

async function fetchConversationChanges(name: string, scope: ChangeScope, turnId?: string): Promise<ConversationChanges> {
  const url =
    '/api/conversations/' + encodeURIComponent(name) + '/changes?scope=' + scope + (turnId ? '&turnId=' + encodeURIComponent(turnId) : '')
  const res = await fetch(url)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? 'Failed to load changes')
  }
  return (await res.json()) as ConversationChanges
}

export function useConversationChanges(
  conversation: Pick<Conversation, 'name' | 'isWorking'> | null,
  scope: ChangeScope,
  opts: { rootId: string | null; enabled: boolean; turnId?: string },
): UseQueryResult<ConversationChanges> {
  const queryClient = useQueryClient()
  const name = conversation?.name ?? ''
  const key = conversationChangesKey(name, scope, opts.turnId)
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchConversationChanges(name, scope, opts.turnId),
    enabled: opts.enabled && conversation !== null,
    refetchInterval: conversation?.isWorking ? CHANGES_REFETCH_MS : false,
    staleTime: CHANGES_STALE_MS,
  })
  const keyRef = useRef(key)
  keyRef.current = key
  const enabledRef = useRef(opts.enabled && conversation !== null)
  enabledRef.current = opts.enabled && conversation !== null
  const refresh = (): void => {
    if (enabledRef.current) void queryClient.invalidateQueries({ queryKey: keyRef.current, exact: true })
  }
  useExplorerWatch(opts.rootId ?? undefined, { onDirsChanged: refresh, onResync: refresh })
  return query
}

const NO_PATHS: ReadonlySet<string> = new Set()

/** Root paths the scope's conversation changed; empty for other scopes or while the dock is closed. */
export function useScopeChangedPaths(scope: DockScope, { open }: { open: boolean }): ReadonlySet<string> {
  const conversation = scope.changes.kind === 'conversation' ? scope.changes.conversation : null
  const rootId = scope.rootId
  const enabled = open && conversation !== null
  const { data } = useConversationChanges(conversation, 'conversation', { rootId, enabled })
  const rootDir = useExplorerStore((s) => (rootId ? s.roots[rootId]?.dirs[''] : undefined))
  const rootAbs = rootDir?.absPath ?? null

  // The root's absolute path comes from its listing; list it once when nothing has.
  const listed = useRef<string | null>(null)
  useEffect(() => {
    if (!enabled || !rootId || rootDir || listed.current === rootId) return
    listed.current = rootId
    listDir(rootId, '').then(
      (result) => {
        if (useExplorerStore.getState().roots[rootId]?.dirs['']?.status === 'ready') return
        useExplorerStore.getState().setDir(rootId, '', { status: 'ready', entries: result.entries, truncated: result.truncated, absPath: result.absPath })
      },
      () => {
        // The Files tab reports listing errors; without absPath the paths map unchanged.
      },
    )
  }, [enabled, rootId, rootDir])

  return useMemo(() => (enabled && data ? changedPathsOf(data, rootAbs) : NO_PATHS), [enabled, data, rootAbs])
}
