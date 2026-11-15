// Changes tab of the work dock (PAN-5289 §6.4, FR-6): what changed in the scope.
//
// A conversation scope lists its own changes (ConversationChangesList); the
// other scopes are filled by the changes-roots item. useChangesCount gives the
// tab label its count, only while the dock is open (NFR-2).

import { useMemo } from 'react'

import { useExplorerGitStatus } from '../explorer/git/useExplorerGitStatus'
import { ConversationChangesList } from './changes/ConversationChangesList'
import type { DockScope } from './dockScope'
import { useConversationChanges } from './useConversationChanges'

export interface ChangesTabProps {
  deckKey: string
  scope: DockScope
}

export function ChangesTab({ deckKey, scope }: ChangesTabProps) {
  if (scope.changes.kind === 'conversation') {
    return <ConversationChangesList key={scope.changes.conversation.name} deckKey={deckKey} scope={scope} conversation={scope.changes.conversation} />
  }
  return <p className="px-3 py-4 text-xs text-muted-foreground">The files changed in this scope show here.</p>
}

/** The count on the Changes tab label, or null while unknown or closed. */
export function useChangesCount(scope: DockScope, { open }: { open: boolean }): number | null {
  const conversation = scope.changes.kind === 'conversation' ? scope.changes.conversation : null
  const rootChangesId = scope.changes.kind === 'root' ? scope.changes.rootId : undefined
  const { data } = useConversationChanges(conversation, 'conversation', { rootId: scope.rootId, enabled: open && conversation !== null })
  const git = useExplorerGitStatus(open ? rootChangesId : undefined)
  return useMemo(() => {
    if (!open) return null
    if (conversation) return data ? data.totals.files : null
    if (rootChangesId && git.result) {
      return new Set([...git.result.entries.map((e) => e.path), ...git.result.committed.map((e) => e.path)]).size
    }
    return null
  }, [open, conversation, data, rootChangesId, git.result])
}
