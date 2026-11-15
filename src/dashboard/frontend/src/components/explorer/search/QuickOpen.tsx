// Quick open (PAN-5186, WI-B11; FR-6): find a file in a root by name.
//
// Queries explorerSearchFiles 120 ms after the last keystroke, never for an
// empty query, and drops answers to stale queries with a request sequence
// number (D-B14). Props only, so PAN-5187 can mount it in a code pane. It
// portals to document.body so a clipping or transformed Stage ancestor cannot
// confine the overlay; React events still bubble to the mounting pane.
//
// PAN-5289 (§6.6, FR-9): it asks for 200 paths, ranks them by match tier with
// files changed here first (rankFileMatches), shows 50, highlights the match,
// tags changed paths "changed here", and Shift+Enter reveals in Files.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Command } from 'cmdk'
import { FileText, Search } from 'lucide-react'

import { explorerErrorMessage, searchFiles } from '../explorer-rpc'
import { baseName, parentPath } from '../tree/explorer-tree-model'
import { matchRanges, rankFileMatches, type MatchRange } from './fileMatch'

export const QUICK_OPEN_DEBOUNCE_MS = 120
/** Paths asked of the server; ranking needs more than it shows. */
export const QUICK_OPEN_REQUEST_LIMIT = 200
/** Rows shown. */
export const QUICK_OPEN_SHOW = 50
const NO_PATHS: ReadonlySet<string> = new Set()
const MARK_CLASS = 'match-mark'

/** `text` (which starts at `offset` in the path) with the ranges that fall inside it marked. */
function highlight(text: string, offset: number, ranges: readonly MatchRange[]): ReactNode {
  const parts: ReactNode[] = []
  let at = 0
  for (const [start, end] of ranges) {
    const s = Math.max(start - offset, at)
    const e = Math.min(end - offset, text.length)
    if (e <= s) continue
    if (s > at) parts.push(text.slice(at, s))
    parts.push(
      <mark key={s} className={MARK_CLASS}>
        {text.slice(s, e)}
      </mark>,
    )
    at = e
  }
  if (at < text.length) parts.push(text.slice(at))
  return parts
}

export interface QuickOpenProps {
  rootId: string
  open: boolean
  onClose(): void
  onPick(path: string): void
  /** Root paths changed here: they rank first within a tier and carry a tag. */
  changedPaths?: ReadonlySet<string>
  /** Shift+Enter: reveal the selected file in Files. */
  onReveal?(path: string): void
}

export function QuickOpen({ rootId, open, onClose, onPick, changedPaths = NO_PATHS, onReveal }: QuickOpenProps) {
  const [query, setQuery] = useState('')
  const [paths, setPaths] = useState<string[]>([])
  // The query the shown paths answered, so ranking and marks match them.
  const [answered, setAnswered] = useState('')
  const [selected, setSelected] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const seq = useRef(0)

  // Reset when the dialog opens.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setPaths([])
    setAnswered('')
    setSelected('')
    setError(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    const mySeq = ++seq.current
    if (!q) {
      setPaths([])
      setSearching(false)
      return
    }
    // Results belong to the query that produced them: clear them now, so Enter
    // during the debounce cannot open a file the new query does not match.
    setPaths([])
    setSearching(true)
    const timer = setTimeout(() => {
      searchFiles(rootId, q, QUICK_OPEN_REQUEST_LIMIT).then(
        (result) => {
          if (mySeq !== seq.current) return
          setPaths([...result.paths])
          setAnswered(q)
          setError(null)
          setSearching(false)
        },
        (e: unknown) => {
          if (mySeq !== seq.current) return
          setPaths([])
          setError(explorerErrorMessage(e))
          setSearching(false)
        },
      )
    }, QUICK_OPEN_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [open, query, rootId])

  const ranked = useMemo(() => rankFileMatches(paths, answered, changedPaths).slice(0, QUICK_OPEN_SHOW), [paths, answered, changedPaths])

  if (!open) return null

  const pick = (path: string) => {
    onPick(path)
    onClose()
  }

  const onCommandKeyDown = (e: KeyboardEvent) => {
    // Shift+Enter reveals instead of opening; preventDefault stops cmdk's own Enter.
    if (e.key !== 'Enter' || !e.shiftKey || !onReveal) return
    e.preventDefault()
    const path = ranked.find((p) => p === selected) ?? ranked[0]
    if (!path) return
    onReveal(path)
    onClose()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  const empty = !query.trim()
    ? 'Type to search files'
    : error
      ? `Couldn't search files: ${error}`
      : searching
        ? 'Searching…'
        : `No files match "${query.trim()}"`

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[15vh]" onClick={onClose} onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        role="dialog"
        aria-label="Quick open"
        className="relative w-full max-w-xl overflow-hidden rounded-xl border border-border bg-card shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={false} label="Quick open" value={selected} onValueChange={setSelected} onKeyDown={onCommandKeyDown}>
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Go to file…"
              aria-label="Go to file"
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              autoFocus
            />
          </div>
          <Command.List className="max-h-[420px] overflow-y-auto py-1">
            {ranked.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">{empty}</div>
            ) : (
              ranked.map((path) => {
                const dir = parentPath(path)
                const base = baseName(path)
                const ranges = matchRanges(path, answered)
                return (
                  <Command.Item
                    key={path}
                    value={path}
                    onSelect={() => pick(path)}
                    className="mx-1 flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-xs data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate text-foreground">{highlight(base, path.length - base.length, ranges)}</span>
                    {dir && <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{highlight(dir, 0, ranges)}</span>}
                    {changedPaths.has(path) && (
                      <span className="ml-auto shrink-0 rounded-md border border-border px-1.5 text-[10px] text-muted-foreground">changed here</span>
                    )}
                  </Command.Item>
                )
              })
            )}
          </Command.List>
          <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            Enter open beside the chat · Shift Enter reveal in files · Files changed here rank first
          </div>
        </Command>
      </div>
    </div>,
    document.body,
  )
}
