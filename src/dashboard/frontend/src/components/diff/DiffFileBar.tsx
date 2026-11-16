// The file bar above the diff/preview viewport (PAN-5338 D-3, WI-4); the DiffViewSwitch
// tablist is also reused by the dock diff view (PAN-5341 D-5).

import { FileText } from 'lucide-react'

import styles from '../Stage/stage.module.css'

export type DiffFileView = 'diff' | 'preview'

export interface DiffFileBarProps {
  path: string
  /** Markdown, not deleted, patch resolved. */
  previewable: boolean
  view: DiffFileView
  onView(view: DiffFileView): void
  /** Absent → no Open file button. */
  onOpenFile?: () => void
}

/** The Diff | Preview tablist, shared by DiffFileBar and the dock diff view (PAN-5341 D-5). */
export function DiffViewSwitch({ view, onView }: { view: DiffFileView; onView(view: DiffFileView): void }) {
  return (
    <div role="tablist" aria-label="View" className="flex shrink-0">
      {(['diff', 'preview'] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view === v}
          className={`${styles.subTab} ${view === v ? styles.subTabActive : ''}`}
          onClick={() => onView(v)}
        >
          {v === 'diff' ? 'Diff' : 'Preview'}
        </button>
      ))}
    </div>
  )
}

export function DiffFileBar({ path, previewable, view, onView, onOpenFile }: DiffFileBarProps) {
  return (
    <div data-testid="diff-file-bar" className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1 text-xs">
      <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={path}>
        {path}
      </span>
      {previewable ? <DiffViewSwitch view={view} onView={onView} /> : null}
      <span className="ml-auto" />
      {onOpenFile ? (
        <button
          type="button"
          aria-label="Open file"
          onClick={onOpenFile}
          className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <FileText className="h-3.5 w-3.5" aria-hidden />
          Open file
        </button>
      ) : null}
    </div>
  )
}
