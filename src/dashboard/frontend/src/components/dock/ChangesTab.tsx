// Changes tab of the work dock (PAN-5289 §6.4, FR-6): what changed in the scope.
//
// A conversation scope lists its own changes (ConversationChangesList); an
// issue or edit-workspace root lists its git status (RootChangesList); a
// project root lists today's commits on its default branch
// (ProjectMainChangesList). useChangesCount gives the tab label its count,
// only while the dock is open (NFR-2).

import { useMemo } from 'react'

import { useExplorerGitStatus } from '../explorer/git/useExplorerGitStatus'
import { ConversationChangesList } from './changes/ConversationChangesList'
import { ProjectMainChangesList } from './changes/ProjectMainChangesList'
import { RootChangesList } from './changes/RootChangesList'
import type { DockScope } from './dockScope'
import { useConversationChanges } from './useConversationChanges'

export interface ChangesTabProps {
  deckKey: string
  scope: DockScope
}

export function ChangesTab({ deckKey, scope }: ChangesTabProps) {
  const { changes } = scope
  if (changes.kind === 'conversation') {
    return <ConversationChangesList key={changes.conversation.name} deckKey={deckKey} scope={scope} conversation={changes.conversation} />
  }
  if (changes.kind === 'root') return <RootChangesList key={changes.rootId} deckKey={deckKey} rootId={changes.rootId} />
  if (changes.kind === 'project-main') return <ProjectMainChangesList key={changes.projectKey} deckKey={deckKey} projectKey={changes.projectKey} />
  return <p className="px-3 py-4 text-xs text-muted-foreground">No project is selected, so there are no changes to show.</p>
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
