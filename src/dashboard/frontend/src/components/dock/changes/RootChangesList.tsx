// The Changes tab for an issue or edit-workspace root (PAN-5289 §6.4, FR-6).
//
// The explorer's git status gives two groups: "Not committed yet" (its
// entries) and "Committed on <branch>" (files committed on the branch). Paths
// are already root paths. A committed row's diff compares the issue root
// against main.

import { GitCommitHorizontal, Pencil } from 'lucide-react'

import { useExplorerGitStatus } from '../../explorer/git/useExplorerGitStatus'
import { useStageDeck } from '../../Stage/StageDeckContext'
import { useWorkDockStore, type DockDiffTarget } from '../workDockStore'
import { ChangeFileRow } from './ChangeFileRow'
import { ChangeGroup } from './ChangeGroup'

export interface RootChangesListProps {
  deckKey: string
  rootId: string
}

export function RootChangesList({ deckKey, rootId }: RootChangesListProps) {
  const deck = useStageDeck()
  const git = useExplorerGitStatus(rootId)

  if (git.errorCode === 'NOT_A_GIT_REPO') return <p className="px-3 py-3 text-xs text-muted-foreground">Not a git repository, so there are no changes to show.</p>
  if (git.errorMessage && !git.result) return <p className="px-3 py-3 text-xs text-destructive">Couldn't read git status: {git.errorMessage}</p>
  if (!git.result) return <p className="px-3 py-3 text-xs text-muted-foreground">Loading changes…</p>

  const { entries, committed, branch } = git.result
  if (entries.length === 0 && committed.length === 0) return <p className="px-3 py-3 text-xs text-muted-foreground">No changes on this root.</p>

  const row = (path: string, diff: DockDiffTarget) => (
    <ChangeFileRow
      key={`${diff.committedVsMain ? 'committed' : 'work'}:${path}`}
      path={path}
      rootPath={path}
      onDiff={() => useWorkDockStore.getState().openDock(deckKey, { tab: 'changes', diff })}
      onOpenBeside={() => deck?.openBeside?.({ rootId, path })}
      onReveal={() => useWorkDockStore.getState().openDock(deckKey, { tab: 'files', reveal: { rootId, path } })}
    />
  )

  return (
    <div>
      {entries.length > 0 && (
        <ChangeGroup
          label="Not committed yet"
          header={
            <>
              <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-state-needs-you">Not committed yet</span>
            </>
          }
        >
          {entries.map((e) => row(e.path, { path: e.path }))}
        </ChangeGroup>
      )}
      {committed.length > 0 && (
        <ChangeGroup
          label={`Committed on ${branch ?? 'this branch'}`}
          header={
            <>
              <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                Committed on <span className="font-mono">{branch ?? 'this branch'}</span>
              </span>
            </>
          }
        >
          {committed.map((e) => row(e.path, { path: e.path, committedVsMain: true }))}
        </ChangeGroup>
      )}
    </div>
  )
}
