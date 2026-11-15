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
 * `paneId` is set by a code pane; the Files tab mounts the bar without it,
 * so Close tab renders only in a code pane.
 */
import type { EditWorkspaceStatus } from '@overdeck/contracts'
import { Lock } from 'lucide-react'
import type { ReactNode } from 'react'

import { usePanesStore } from '../../../lib/panesStore'
import { parseRootId } from '../explorer-rpc'
import { useEditWorkspaceStatus, workspaceIdOf } from './edit-workspace-http'
import { useEditWorkspaceStore, type LandedNote } from './edit-workspace-store'
import { ensureEditRoot } from './edit-workspace-switch'

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

export function EditorBar({ rootId, deckKey, paneId }: EditorBarProps) {
  const parsed = parseRootId(rootId)
  if (parsed?.kind === 'project') return <ProjectBar projectKey={parsed.key} rootId={rootId} deckKey={deckKey} paneId={paneId} />
  if (parsed?.kind === 'workspace') return <EditWorkspaceNote rootId={rootId} />
  return null
}
