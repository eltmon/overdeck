/**
 * The edit-workspace banner (PAN-5191, FR-5, FR-9 to FR-13, D-F16).
 *
 * On an edit root the explorer pane shows the sentence "Editing in edit
 * workspace <name> (branch <branch>). The main checkout is not changed."
 * with Create PR, Discard and New edit workspace, and the PR row once a PR
 * exists. Code panes show the sentence only (EditWorkspaceNote). Neither
 * renders anything for a workspace root that is not an edit workspace.
 * After a merge, a discard or a pipeline send every pane on the edit root
 * returns to the project root (leaveEditWorkspace).
 */
import type { EditWorkspaceCreatePrResult, EditWorkspaceStatus } from '@overdeck/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { draftKey, isDraftDirty, useCodeDrafts, type CodeDraft } from '../code/code-drafts'
import { ExplorerHttpError } from '../explorer-http'
import { explorerErrorMessage } from '../explorer-rpc'
import { CreatePrDialog } from './CreatePrDialog'
import { DiscardDialog } from './DiscardDialog'
import {
  mergeEditWorkspace,
  refreshEditWorkspaceStatus,
  useEditWorkspaceStatus,
  workspaceIdOf,
} from './edit-workspace-http'
import { leaveEditWorkspace, openNewEditWorkspace } from './edit-workspace-switch'
import { PrStatusRow } from './PrStatusRow'

const BUTTON =
  'h-6 rounded border border-border px-2 text-xs text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40'

function isNotEditWorkspace(error: unknown): boolean {
  return error instanceof ExplorerHttpError && error.code === 'NOT_AN_EDIT_WORKSPACE'
}

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

function unsavedPathsIn(drafts: Record<string, CodeDraft>, rootId: string): string[] {
  const prefix = draftKey(rootId, '')
  return Object.entries(drafts)
    .filter(([key, draft]) => key.startsWith(prefix) && isDraftDirty(draft))
    .map(([key]) => key.slice(prefix.length))
}

export interface EditWorkspaceBannerProps {
  rootId: string
  deckKey: string
  paneId: string
  /** Git status paths: uncommitted entries, then committed ones. */
  changedPaths: readonly string[]
  /** Git status shows uncommitted changes. */
  hasChanges: boolean
  /** Paths with uncommitted changes, listed by the Discard dialog. */
  uncommittedPaths: readonly string[]
  /** Re-read git status, after a commit. */
  onGitChanged?(): void
}

export function EditWorkspaceBanner({
  rootId,
  deckKey,
  paneId,
  changedPaths,
  hasChanges,
  uncommittedPaths,
  onGitChanged,
}: EditWorkspaceBannerProps) {
  const workspaceId = workspaceIdOf(rootId) ?? ''
  const queryClient = useQueryClient()
  const status = useEditWorkspaceStatus(workspaceId)
  const [dialog, setDialog] = useState<'pr' | 'discard' | null>(null)
  const [merging, setMerging] = useState(false)
  // Unsaved code-pane edits never reach a commit, and leaving the edit workspace drops
  // its drafts, so merge, Create PR and Push changes wait until they are saved.
  const unsavedList = useCodeDrafts((s) => unsavedPathsIn(s.drafts, rootId).join('\n'))
  const unsavedPaths = unsavedList === '' ? [] : unsavedList.split('\n')
  const refresh = () => void refreshEditWorkspaceStatus(queryClient, workspaceId)

  if (status.isPending) return null
  if (status.isError) {
    if (isNotEditWorkspace(status.error)) return null
    return (
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground" data-testid="edit-workspace-banner">
        <span>Couldn't read this edit workspace: {explorerErrorMessage(status.error)}</span>
        <button type="button" className={BUTTON} onClick={refresh}>
          Retry
        </button>
      </div>
    )
  }

  const data = status.data
  const projectKey = data.workspace.projectKey
  const pr = data.pr
  const leave = () => leaveEditWorkspace(rootId, projectKey)

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
      onGitChanged?.()
      refresh()
      return
    }
    toast.success(
      `Created ${result.issueId} and opened PR #${result.prNumber}. Overdeck is setting up its pipeline workspace and will start review.`,
      { action: { label: 'Open PR', onClick: () => window.open(result.prUrl, '_blank', 'noopener') } },
    )
    leave()
  }

  const onDiscarded = () => {
    setDialog(null)
    leave()
    toast(`Discarded edit workspace ${data.workspace.name}.`)
  }

  const newWorkspace = () => {
    void openNewEditWorkspace(projectKey, deckKey, paneId).catch(() => {}) // ensureEditRoot shows the toast
  }

  return (
    <div className="flex flex-col gap-1.5 border-b border-border px-3 py-1.5 text-xs text-muted-foreground" data-testid="edit-workspace-banner">
      <div className="flex flex-wrap items-center gap-2">
        <EditSentence status={data} />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {pr?.state !== 'OPEN' && (
            <button type="button" className={BUTTON} onClick={openPrDialog}>
              Create PR
            </button>
          )}
          <button type="button" className={BUTTON} onClick={() => setDialog('discard')}>
            Discard
          </button>
          <button type="button" className={BUTTON} onClick={newWorkspace}>
            New edit workspace
          </button>
        </div>
      </div>
      {pr && (
        <PrStatusRow
          pr={pr}
          hasChanges={hasChanges}
          unpushedCommits={data.unpushedCommits}
          hasUnsavedEdits={unsavedPaths.length > 0}
          merging={merging}
          onMerge={() => void merge()}
          onRefresh={refresh}
          onPush={openPrDialog}
        />
      )}
      {dialog === 'pr' && (
        <CreatePrDialog status={data} changedPaths={changedPaths} onClose={() => setDialog(null)} onDone={onPrDone} />
      )}
      {dialog === 'discard' && (
        <DiscardDialog
          status={data}
          uncommittedPaths={uncommittedPaths}
          unsavedPaths={unsavedPaths}
          onClose={() => setDialog(null)}
          onDiscarded={onDiscarded}
        />
      )}
    </div>
  )
}
