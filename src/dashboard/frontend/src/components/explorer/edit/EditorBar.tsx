/**
 * The editor bar (PAN-5290 FR-8 to FR-11, C-D9, C-D11): one line under a
 * code pane's header on a project or edit-workspace root. Issue roots and
 * other roots get no bar.
 *
 * On a project root it says the main checkout is never changed and offers
 * Start editing, which creates (or reuses) an edit workspace and moves the
 * panes onto it; while that runs it reads "Creating edit workspace…". Right
 * after a merge, a pipeline send or a discard brought the panes back to main
 * it shows the landed note from edit-workspace-store instead, with Dismiss
 * and Close tab.
 *
 * On an edit-workspace root it names the workspace and branch with what will
 * land (files, +/−) and the save state, and offers Discard… and Create PR.
 * Once a PR is open it follows it: the merge verdict's reason while GitHub
 * blocks it (the status refetches every 15 s while GitHub is still deciding,
 * C-D6), then an enabled Merge. Merge, a pipeline send and a discard set the
 * project's landed note and move the panes back to main
 * (leaveEditWorkspace). A workspace that is not an edit workspace gets no
 * bar; one that no longer exists calls `onStale` (C-D13b).
 *
 * `paneId` is set by a code pane; the Files tab mounts the bar without it,
 * so Close tab renders only in a code pane.
 */
import type { EditWorkspaceChanges, EditWorkspaceCreatePrResult, EditWorkspacePr, EditWorkspaceStatus } from '@overdeck/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { usePanesStore } from '../../../lib/panesStore'
import { draftKey, isDraftDirty, useCodeDrafts, type CodeDraft } from '../code/code-drafts'
import { ExplorerHttpError } from '../explorer-http'
import { explorerErrorMessage, parseRootId } from '../explorer-rpc'
import { CreatePrDialog } from './CreatePrDialog'
import { DiscardDialog } from './DiscardDialog'
import {
  editWorkspaceChangesKey,
  mergeEditWorkspace,
  refreshEditWorkspaceStatus,
  useEditWorkspaceChanges,
  useEditWorkspaceStatus,
  workspaceIdOf,
} from './edit-workspace-http'
import { useEditWorkspaceStore, type LandedNote } from './edit-workspace-store'
import { ensureEditRoot, leaveEditWorkspace } from './edit-workspace-switch'

export const UNCOMMITTED_REASON = 'Commit and push your changes first.'
export const UNSAVED_REASON = 'Save or discard your unsaved edits first.'

export const MAIN_CHECKOUT_SENTENCE =
  'This is the main checkout. Start typing and Overdeck moves your edits to a new edit workspace, so main never changes until a PR merges.'
export const CREATING_EDIT_NOTE = 'Creating edit workspace…'

export const BUTTON =
  'h-6 shrink-0 rounded border border-border px-2 text-xs text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40'
export const PRIMARY_BUTTON =
  'h-6 shrink-0 rounded border border-primary bg-primary px-2 text-xs text-primary-foreground transition-colors hover:opacity-90 disabled:pointer-events-none disabled:opacity-40'

const ROW = 'flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground'

export type BarDot = 'editing' | 'live' | 'done' | 'rest'

const DOT_CLASS: Record<BarDot, string> = {
  editing: 'bg-state-needs-you',
  live: 'bg-state-live',
  done: 'bg-state-done',
  rest: 'bg-muted-foreground',
}

export function StatusDot({ dot }: { dot: BarDot }) {
  return <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[dot]}`} data-dot={dot} />
}

/** The bar's one row: a leading mark, a growing sentence and buttons on the right. */
export function BarRow({ lead, children, actions }: { lead: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className={ROW} data-testid="editor-bar">
      {lead}
      <span className="min-w-0 grow" data-testid="editor-bar-sentence">
        {children}
      </span>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  )
}

const Strong = ({ children }: { children: ReactNode }) => <span className="font-medium text-foreground">{children}</span>
export const Mono = ({ children }: { children: ReactNode }) => <span className="font-mono text-foreground">{children}</span>

function EditSentence({ status }: { status: EditWorkspaceStatus }) {
  return (
    <span data-testid="edit-workspace-sentence">
      Editing in edit workspace <span className="font-mono text-foreground">{status.workspace.name}</span> (branch{' '}
      <span className="font-mono text-foreground">{status.workspace.branch}</span>). The main checkout is not changed.
    </span>
  )
}

/** The one-line note a code pane on an edit root shows (no buttons). */
export function EditWorkspaceNote({ rootId }: { rootId: string }) {
  const status = useEditWorkspaceStatus(workspaceIdOf(rootId) ?? '')
  if (!status.data) return null
  return (
    <div className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground" data-testid="code-pane-edit-note">
      <EditSentence status={status.data} />
    </div>
  )
}

function LandedSentence({ note }: { note: LandedNote }) {
  if (note.kind === 'merged') {
    return (
      <>
        Merged PR <Strong>#{note.prNumber}</Strong> into <Mono>{note.defaultBranch}</Mono>. The edit workspace and its branch were
        removed; this tab now shows main.
      </>
    )
  }
  if (note.kind === 'pipeline') {
    return (
      <>
        Sent through the pipeline as <Strong>{note.issueId}</Strong> · PR <Strong>#{note.prNumber}</Strong>. Review agents will check
        it.
      </>
    )
  }
  return (
    <>
      Discarded edit workspace <Strong>{note.workspaceName}</Strong>. This tab now shows main.
    </>
  )
}

const LANDED_DOT: Record<LandedNote['kind'], BarDot> = { merged: 'done', pipeline: 'live', discarded: 'rest' }

export interface EditorBarProps {
  rootId: string
  deckKey: string
  path?: string
  /** Set by a code pane: enables Close tab. */
  paneId?: string
  /** The edit workspace no longer exists (PAN-5290 C-D13b). */
  onStale?: () => void
}

function ProjectBar({ projectKey, rootId, deckKey, paneId }: { projectKey: string; rootId: string; deckKey: string; paneId?: string }) {
  const landed = useEditWorkspaceStore((s) => s.landed[projectKey])
  const creating = useEditWorkspaceStore((s) => s.creating[projectKey] === true)

  if (landed) {
    const closeTab = paneId
      ? () => usePanesStore.getState().closePane(deckKey, paneId)
      : undefined
    return (
      <BarRow
        lead={<StatusDot dot={LANDED_DOT[landed.kind]} />}
        actions={
          <>
            {landed.kind === 'pipeline' ? (
              <button type="button" className={BUTTON} onClick={() => window.open(landed.prUrl, '_blank', 'noopener')}>
                Open PR
              </button>
            ) : null}
            <button type="button" className={BUTTON} onClick={() => useEditWorkspaceStore.getState().setLanded(projectKey, null)}>
              Dismiss
            </button>
            {closeTab ? (
              <button type="button" className={BUTTON} onClick={closeTab}>
                Close tab
              </button>
            ) : null}
          </>
        }
      >
        <LandedSentence note={landed} />
      </BarRow>
    )
  }

  if (creating) {
    return <BarRow lead={<StatusDot dot="live" />}>{CREATING_EDIT_NOTE}</BarRow>
  }

  return (
    <BarRow
      lead={<Lock size={12} aria-hidden className="shrink-0 text-muted-foreground" />}
      actions={
        <button type="button" className={BUTTON} onClick={() => void ensureEditRoot(rootId).catch(() => {})}>
          Start editing
        </button>
      }
    >
      This is the <Strong>main checkout</Strong>. Start typing and Overdeck moves your edits to a new edit workspace, so main never
      changes until a PR merges.
    </BarRow>
  )
}

export function prStateWord(pr: EditWorkspacePr): string {
  if (pr.state === 'MERGED') return 'Merged'
  if (pr.state === 'CLOSED') return 'Closed'
  return pr.isDraft ? 'Draft' : 'Open'
}

/** Root paths with unsaved drafts on `rootId`. */
export function unsavedPathsIn(drafts: Record<string, CodeDraft>, rootId: string): string[] {
  const prefix = draftKey(rootId, '')
  return Object.entries(drafts)
    .filter(([key, draft]) => key.startsWith(prefix) && isDraftDirty(draft))
    .map(([key]) => key.slice(prefix.length))
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof ExplorerHttpError && error.code === code
}

function sentenceEnd(text: string): string {
  return text.replace(/\.+$/, '') + '.'
}

function FilesChanged({ changes }: { changes: EditWorkspaceChanges | undefined }) {
  if (!changes) return null
  const n = changes.files.length
  return (
    <>
      {' · '}
      {n} {n === 1 ? 'file' : 'files'} changed{' '}
      <span className="font-mono text-foreground">
        +{changes.additions} −{changes.deletions}
      </span>
    </>
  )
}

function EditingSentence({ status, changes, saving }: { status: EditWorkspaceStatus; changes: EditWorkspaceChanges | undefined; saving: boolean }) {
  return (
    <>
      Editing in <Strong>{status.workspace.name}</Strong> on <Mono>{status.workspace.branch}</Mono>
      <FilesChanged changes={changes} />
      {' · '}
      {saving ? 'Saving…' : 'All edits saved'}
    </>
  )
}

function WorkspaceBar({ rootId, workspaceId, onStale }: { rootId: string; workspaceId: string; onStale?: () => void }) {
  const queryClient = useQueryClient()
  const status = useEditWorkspaceStatus(workspaceId, { poll: true })
  const changes = useEditWorkspaceChanges(workspaceId)
  const [dialog, setDialog] = useState<'pr' | 'discard' | null>(null)
  const [merging, setMerging] = useState(false)
  // Unsaved code-pane edits never reach a commit, and leaving the edit workspace drops
  // its drafts, so merge, Create PR and Push changes wait until they are saved.
  const unsavedList = useCodeDrafts((s) => unsavedPathsIn(s.drafts, rootId).join('\n'))
  const unsavedPaths = unsavedList === '' ? [] : unsavedList.split('\n')
  const stale = hasCode(status.error, 'ROOT_NOT_FOUND') || hasCode(changes.error, 'ROOT_NOT_FOUND')
  useEffect(() => {
    if (stale) onStale?.()
  }, [stale, onStale])

  const refresh = () => {
    void refreshEditWorkspaceStatus(queryClient, workspaceId)
    void queryClient.invalidateQueries({ queryKey: editWorkspaceChangesKey(workspaceId), exact: true })
  }

  if (stale || status.isPending) return null
  if (status.isError) {
    if (hasCode(status.error, 'NOT_AN_EDIT_WORKSPACE')) return null
    return (
      <BarRow
        lead={<StatusDot dot="rest" />}
        actions={
          <button type="button" className={BUTTON} onClick={refresh}>
            Retry
          </button>
        }
      >
        Couldn't read this edit workspace: {explorerErrorMessage(status.error)}
      </BarRow>
    )
  }

  const data = status.data
  const projectKey = data.workspace.projectKey
  const defaultBranch = data.workspace.defaultBranch
  const pr = data.pr
  const landed = useEditWorkspaceStore.getState().setLanded
  const leave = () => leaveEditWorkspace(rootId, projectKey)
  const uncommitted = changes.data?.uncommittedPaths ?? []
  const needsPush = uncommitted.length > 0 || data.unpushedCommits

  const openPrDialog = () => {
    if (unsavedPaths.length > 0) {
      toast.error(`Save or discard your unsaved edits first: ${unsavedPaths.join(', ')}.`)
      return
    }
    setDialog('pr')
  }

  const merge = async () => {
    if (!pr || unsavedPaths.length > 0) return
    setMerging(true)
    try {
      await mergeEditWorkspace(workspaceId)
      toast.success(`Merged PR #${pr.number}. The edit workspace was removed.`)
      landed(projectKey, { kind: 'merged', prNumber: pr.number, defaultBranch })
      leave()
    } catch (error) {
      toast.error(explorerErrorMessage(error))
      refresh()
    } finally {
      setMerging(false)
    }
  }

  const onPrDone = (result: EditWorkspaceCreatePrResult) => {
    setDialog(null)
    if (result.mode === 'direct') {
      toast.success(result.created ? `Opened PR #${result.number}.` : `Pushed your changes to PR #${result.number}.`)
      refresh()
      return
    }
    toast.success(
      `Created ${result.issueId} and opened PR #${result.prNumber}. Overdeck is setting up its pipeline workspace and will start review.`,
      { action: { label: 'Open PR', onClick: () => window.open(result.prUrl, '_blank', 'noopener') } },
    )
    landed(projectKey, { kind: 'pipeline', issueId: result.issueId, prNumber: result.prNumber, prUrl: result.prUrl })
    leave()
  }

  const onDiscarded = () => {
    setDialog(null)
    toast(`Discarded edit workspace ${data.workspace.name}.`)
    landed(projectKey, { kind: 'discarded', workspaceName: data.workspace.name })
    leave()
  }

  const discardButton = (
    <button type="button" className={BUTTON} onClick={() => setDialog('discard')}>
      Discard…
    </button>
  )
  const createButton = (
    <button type="button" className={PRIMARY_BUTTON} onClick={openPrDialog}>
      Create PR
    </button>
  )
  const viewButton = pr ? (
    <a href={pr.url} target="_blank" rel="noreferrer" className={`${BUTTON} inline-flex items-center`}>
      View on GitHub
    </a>
  ) : null
  const refreshButton = (
    <button type="button" className={BUTTON} onClick={refresh}>
      Refresh
    </button>
  )

  let row: ReactNode
  if (pr?.state === 'OPEN') {
    const blocked = !pr.canMerge
      ? (pr.reason ?? 'GitHub does not allow this merge.')
      : unsavedPaths.length > 0
        ? UNSAVED_REASON
        : needsPush
          ? UNCOMMITTED_REASON
          : null
    row = (
      <BarRow
        lead={<StatusDot dot={blocked ? 'live' : 'done'} />}
        actions={
          <>
            {viewButton}
            {needsPush ? (
              <button type="button" className={BUTTON} onClick={openPrDialog}>
                Push changes
              </button>
            ) : null}
            {refreshButton}
            {discardButton}
            <button
              type="button"
              className={blocked ? BUTTON : PRIMARY_BUTTON}
              disabled={blocked !== null || merging}
              title={blocked ?? undefined}
              onClick={() => void merge()}
            >
              {merging ? 'Merging…' : 'Merge'}
            </button>
          </>
        }
      >
        {blocked ? (
          <>
            PR <Strong>#{pr.number}</Strong> is {pr.isDraft ? 'a draft' : 'open'} · <span data-testid="edit-pr-merge-reason">{sentenceEnd(blocked)}</span>
          </>
        ) : (
          <>
            PR <Strong>#{pr.number}</Strong> · no conflicts. Merging squashes it into <Mono>{defaultBranch}</Mono>.
          </>
        )}
      </BarRow>
    )
  } else if (pr?.state === 'MERGED') {
    row = (
      <BarRow lead={<StatusDot dot="done" />} actions={<>{viewButton}{discardButton}</>}>
        PR <Strong>#{pr.number}</Strong> was merged on GitHub.
      </BarRow>
    )
  } else {
    row = (
      <BarRow lead={<StatusDot dot="editing" />} actions={<>{discardButton}{createButton}</>}>
        {pr?.state === 'CLOSED' ? (
          <>
            PR <Strong>#{pr.number}</Strong> was closed.{' '}
          </>
        ) : null}
        <EditingSentence status={data} changes={changes.data} saving={unsavedPaths.length > 0} />
      </BarRow>
    )
  }

  return (
    <>
      {row}
      {dialog === 'pr' && (
        <CreatePrDialog
          status={data}
          changedPaths={changes.data?.files.map((f) => f.path) ?? []}
          onClose={() => setDialog(null)}
          onDone={onPrDone}
        />
      )}
      {dialog === 'discard' && (
        <DiscardDialog
          status={data}
          uncommittedPaths={uncommitted}
          unsavedPaths={unsavedPaths}
          onClose={() => setDialog(null)}
          onDiscarded={onDiscarded}
        />
      )}
    </>
  )
}

export function EditorBar({ rootId, deckKey, paneId, onStale }: EditorBarProps) {
  const parsed = parseRootId(rootId)
  if (parsed?.kind === 'project') return <ProjectBar projectKey={parsed.key} rootId={rootId} deckKey={deckKey} paneId={paneId} />
  if (parsed?.kind === 'workspace') return <WorkspaceBar rootId={rootId} workspaceId={parsed.key} onStale={onStale} />
  return null
}
