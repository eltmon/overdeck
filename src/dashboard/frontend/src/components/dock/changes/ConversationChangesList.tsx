// The Changes tab for a conversation scope (PAN-5289 §6.4, FR-6; PAN-5284 D-5).
//
// Chips pick the server scope: This conversation, Last turn, Not committed or
// All of main today. The list shows a "Not committed yet" group first, then
// one group per commit. Paths in the answer are repo paths; every explorer
// action (open beside, reveal, the diff) maps them to root paths first.

import { useEffect, useState, type ReactElement } from 'react'
import { GitCommitHorizontal, Pencil } from 'lucide-react'
import type { ChangeCommit, ChangeScope, ChangedFile, ConversationChanges, UncommittedFile } from '@overdeck/contracts'

import type { Conversation } from '../../CommandDeck/ConversationList'
import { useExplorerStore } from '../../explorer/explorerStore'
import { useStageDeck } from '../../Stage/StageDeckContext'
import { toRootPath } from '../changes-model'
import type { DockScope } from '../dockScope'
import { useConversationChanges } from '../useConversationChanges'
import { useWorkDockStore, type DockDiffTarget } from '../workDockStore'
import { ChangeFileRow } from './ChangeFileRow'
import { ChangeGroup, ChangeTag, commitTime } from './ChangeGroup'

const CHIPS: ReadonlyArray<{ scope: ChangeScope; label: string }> = [
  { scope: 'conversation', label: 'This conversation' },
  { scope: 'turn', label: 'Last turn' },
  { scope: 'uncommitted', label: 'Not committed' },
  { scope: 'main', label: 'All of main today' },
]

export interface ConversationChangesListProps {
  deckKey: string
  scope: DockScope
  conversation: Conversation
}

/** The shared-file note on an uncommitted row (PAN-5284 D-5). */
export function sharedFileNote(file: UncommittedFile): string | null {
  if (file.attribution === 'file') return 'Edited by this conversation. Line attribution needs edit records, which only Claude Code writes.'
  if (!file.otherLines || file.otherLines <= 0) return null
  const names = (file.otherConversations ?? []).map((c) => c.title || c.name).filter(Boolean)
  const who = names.length > 0 ? names.join(' and ') : 'other sessions'
  return `Shared file. ${file.otherLines} other uncommitted lines come from ${who}. Only this conversation's lines are counted.`
}

function commitWho(commit: ChangeCommit): string {
  if (commit.by?.isThisConversation) return 'this chat'
  return commit.by?.title ?? commit.by?.id ?? 'unattributed'
}

export function ConversationChangesList({ deckKey, scope, conversation }: ConversationChangesListProps) {
  const deck = useStageDeck()
  const initial = useWorkDockStore((s) => s.byDeck[deckKey]?.changesScope) ?? 'conversation'
  const [chip, setChip] = useState<ChangeScope>(initial)
  // A repeat openDock with a changesScope (header Changes, "N files not
  // committed") moves the chip even while this list stays mounted (PAN-5291 D1-15).
  const openSeq = useWorkDockStore((s) => s.byDeck[deckKey]?.openSeq)
  useEffect(() => {
    const requested = useWorkDockStore.getState().byDeck[deckKey]?.changesScope
    if (requested) setChip(requested)
  }, [deckKey, openSeq])
  const rootId = scope.rootId
  const query = useConversationChanges(conversation, chip, { rootId, enabled: true })
  const rootAbs = useExplorerStore((s) => (rootId ? (s.roots[rootId]?.dirs['']?.absPath ?? null) : null))

  const data = query.data
  const rootPathOf = (repoPath: string): string | null => (data && rootId ? toRootPath(data.repoRoot, rootAbs, repoPath) : null)

  const targetOf = (file: ChangedFile, commit?: ChangeCommit): DockDiffTarget => {
    const rootPath = rootPathOf(file.path)
    const target: DockDiffTarget = { path: rootPath ?? file.path, repoPath: file.path }
    if (data) target.repoRoot = data.repoRoot
    if (commit) {
      target.sha = commit.sha
      target.pushed = commit.pushed
    }
    if (rootPath === null) target.outsideRoot = true
    return target
  }
  // Every row in display order, for the diff view's i/N and previous/next.
  const targets: DockDiffTarget[] = data
    ? [...data.uncommitted.map((f) => targetOf(f)), ...data.commits.flatMap((c) => c.files.map((f) => targetOf(f, c)))]
    : []

  const row = (file: ChangedFile, commit: ChangeCommit | undefined, note?: string | null) => {
    const rootPath = rootPathOf(file.path)
    const sha = commit?.sha
    return (
      <ChangeFileRow
        key={`${sha ?? 'work'}:${file.path}`}
        path={rootPath ?? file.path}
        additions={file.additions}
        deletions={file.deletions}
        rootPath={rootPath}
        onDiff={() => useWorkDockStore.getState().openDock(deckKey, { tab: 'changes', diff: targetOf(file, commit), diffList: targets, changesScope: chip })}
        onOpenBeside={() => {
          if (rootId && rootPath) deck?.openBeside?.({ rootId, path: rootPath })
        }}
        onReveal={() => {
          if (rootId && rootPath) useWorkDockStore.getState().openDock(deckKey, { tab: 'files', reveal: { rootId, path: rootPath } })
        }}
      >
        {note && (
          <p className="badge-bg-state-needs-you badge-border-state-needs-you mx-3 mb-2 ml-8 rounded-md border px-2.5 py-1.5 text-[11.5px] leading-normal text-body-foreground">
            {note.startsWith('Shared file.') ? (
              <>
                <b className="font-medium">Shared file.</b>
                {note.slice('Shared file.'.length)}
              </>
            ) : (
              note
            )}
          </p>
        )}
      </ChangeFileRow>
    )
  }

  let body
  if (query.isPending) body = <p className="px-3 py-3 text-xs text-muted-foreground">Loading changes…</p>
  else if (query.isError) body = <p className="px-3 py-3 text-xs text-destructive">Couldn't load changes: {query.error.message}</p>
  else if (data) body = <ChangeGroups data={data} chip={chip} row={row} />

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap gap-1.5 px-3 py-2" role="radiogroup" aria-label="Which changes">
        {CHIPS.map((c) => (
          <button
            key={c.scope}
            type="button"
            role="radio"
            aria-checked={chip === c.scope}
            onClick={() => setChip(c.scope)}
            className={`h-6 rounded-md border px-2 text-[11.5px] ${
              chip === c.scope ? 'border-foreground/40 bg-card text-foreground' : 'border-border bg-background text-muted-foreground hover:text-foreground'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      {body}
      {data && chip !== 'main' && (
        <p className="border-t border-border px-3 py-2.5 text-[11.5px] leading-normal text-muted-foreground" data-testid="changes-footnote">
          Commits carry <span className="font-mono">Overdeck-Conversation: {conversation.tmuxSession}</span>; uncommitted lines come from the
          agent's own edit records. Other conversations' work on <span className="font-mono">{data.branch ?? 'this branch'}</span> is left out.
        </p>
      )}
    </div>
  )
}

function ChangeGroups({
  data,
  chip,
  row,
}: {
  data: ConversationChanges
  chip: ChangeScope
  row: (file: ChangedFile, commit: ChangeCommit | undefined, note?: string | null) => ReactElement
}) {
  if (data.uncommitted.length === 0 && data.commits.length === 0) {
    return <p className="px-3 py-3 text-xs text-muted-foreground">No changes in this scope.</p>
  }
  return (
    <div>
      {data.uncommitted.length > 0 && (
        <ChangeGroup
          label="Not committed yet"
          header={
            <>
              <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-state-needs-you">Not committed yet</span>
            </>
          }
        >
          {data.uncommitted.map((file) => row(file, undefined, sharedFileNote(file)))}
        </ChangeGroup>
      )}
      {data.commits.map((commit) => (
        <ChangeGroup
          key={commit.sha}
          label={`${commit.shortSha} ${commit.subject}`}
          defaultOpen={chip !== 'main'}
          header={
            <>
              <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="shrink-0 font-mono text-[11.5px] text-primary-ink">{commit.shortSha}</span>
              <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
              {chip === 'main' ? <ChangeTag>{commitWho(commit)}</ChangeTag> : <ChangeTag>{commit.pushed ? 'pushed' : 'not pushed'}</ChangeTag>}
              <span className="shrink-0 text-[11px] text-muted-foreground">{commitTime(commit.authoredAt)}</span>
            </>
          }
        >
          {commit.files.map((file) => row(file, commit))}
        </ChangeGroup>
      ))}
    </div>
  )
}
