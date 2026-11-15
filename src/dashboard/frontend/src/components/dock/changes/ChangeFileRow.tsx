// One changed file in the Changes tab (PAN-5289 §6.4, FR-6): the path with a
// dimmed folder, +/−, and Open diff / Open beside / Reveal in files.

import type { ReactNode } from 'react'
import { Columns2, FileDiff, LocateFixed } from 'lucide-react'

import { baseName, parentPath } from '../../explorer/tree/explorer-tree-model'

export interface ChangeFileRowProps {
  /** The path shown (repo or root path). */
  path: string
  additions?: number
  deletions?: number
  /** Null disables Open beside and Reveal (the file is outside the dock root). */
  rootPath: string | null
  onDiff(): void
  onOpenBeside(): void
  onReveal(): void
  /** Extra content under the row (the shared-file note). */
  children?: ReactNode
  /** Indent under a group header (default); false for the turn card's flat list (PAN-5295 D2-8). */
  inset?: boolean
}

function RowButton({ label, onClick, disabled, children }: { label: string; onClick(): void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  )
}

export function ChangeFileRow({ path, additions, deletions, rootPath, onDiff, onOpenBeside, onReveal, children, inset = true }: ChangeFileRowProps) {
  const dir = parentPath(path)
  return (
    <div data-change-path={path}>
      <div className={`group flex items-center gap-2 py-1 ${inset ? 'pl-8' : 'pl-3'} pr-2 text-[12.5px] hover:bg-accent`}>
        <button type="button" onClick={onDiff} className="min-w-0 flex-1 truncate text-left font-mono text-xs" title={path}>
          {dir && <span className="text-muted-foreground">{dir}/</span>}
          <span className="text-foreground">{baseName(path)}</span>
        </button>
        {(additions !== undefined || deletions !== undefined) && (
          <span className="shrink-0 font-mono text-[11px] group-hover:hidden">
            <span className="text-success-foreground">+{additions ?? 0}</span> <span className="text-destructive-foreground">−{deletions ?? 0}</span>
          </span>
        )}
        <span className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
          <RowButton label="Open diff" onClick={onDiff}>
            <FileDiff className="h-3.5 w-3.5" />
          </RowButton>
          <RowButton label="Open the file beside the chat" onClick={onOpenBeside} disabled={rootPath === null}>
            <Columns2 className="h-3.5 w-3.5" />
          </RowButton>
          <RowButton label="Reveal in files" onClick={onReveal} disabled={rootPath === null}>
            <LocateFixed className="h-3.5 w-3.5" />
          </RowButton>
        </span>
      </div>
      {children}
    </div>
  )
}
