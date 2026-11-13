/**
 * External-change banner for a code pane (PAN-5187, FR-8).
 *
 * changed  — disk has content the pane did not write, and the pane has
 *            unsaved edits (or a save was refused with DISK_CONFLICT).
 * deleted  — the file is gone; saving recreates it.
 * renamed  — the file moved on disk; Open follows it.
 *
 * Colors (style guide): amber for changed (a human must decide), red for
 * deleted, neutral for renamed.
 */
import type { ExternalChangeState } from './external-change'

const BUTTON = 'rounded-md border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted'

export const CHANGED_TEXT = 'This file changed on disk, and you have unsaved edits.'
export const DELETED_TEXT = 'This file was deleted on disk. Save (Ctrl+S) recreates it.'

export interface ExternalChangeBannerProps {
  state: ExternalChangeState
  comparing: boolean
  onCompare(): void
  onReload(): void
  onKeepMine(): void
  onOverwrite(): void
  onOpen(newPath: string): void
}

export function ExternalChangeBanner(props: ExternalChangeBannerProps) {
  const { state } = props
  if (state.kind === 'clean') return null

  if (state.kind === 'deleted') {
    return (
      <div
        role="status"
        data-testid="external-change-banner"
        className="badge-bg-destructive badge-border-destructive border-b px-3 py-1.5 text-xs text-destructive-foreground"
      >
        {DELETED_TEXT}
      </div>
    )
  }

  if (state.kind === 'renamed') {
    return (
      <div
        role="status"
        data-testid="external-change-banner"
        className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground"
      >
        <span className="min-w-0 truncate">
          This file was renamed on disk to <span className="font-mono">{state.newPath}</span>.
        </span>
        <button type="button" className={BUTTON} onClick={() => props.onOpen(state.newPath)}>
          Open {state.newPath}
        </button>
      </div>
    )
  }

  return (
    <div
      role="status"
      data-testid="external-change-banner"
      className="badge-bg-warning badge-border-warning flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-xs text-warning-foreground"
    >
      <span className="min-w-0 flex-1">{CHANGED_TEXT}</span>
      <button type="button" aria-pressed={props.comparing} className={BUTTON} onClick={props.onCompare}>
        Compare
      </button>
      <button type="button" className={BUTTON} onClick={props.onReload}>
        Reload from disk
      </button>
      <button type="button" className={BUTTON} onClick={props.onKeepMine}>
        Keep my edits
      </button>
      <button type="button" className={BUTTON} onClick={props.onOverwrite}>
        Overwrite
      </button>
    </div>
  )
}
