// Quick open (PAN-5186, WI-B11; FR-6): find a file in a root by name.
//
// Queries explorerSearchFiles 120 ms after the last keystroke, never for an
// empty query, and drops answers to stale queries with a request sequence
// number (D-B14). Props only, so PAN-5187 can mount it in a code pane.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Command } from 'cmdk'
import { FileText, Search } from 'lucide-react'

import { explorerErrorMessage, searchFiles } from '../explorer-rpc'
import { baseName, parentPath } from '../tree/explorer-tree-model'

export const QUICK_OPEN_DEBOUNCE_MS = 120
const QUICK_OPEN_LIMIT = 50

export interface QuickOpenProps {
  rootId: string
  open: boolean
  onClose(): void
  onPick(path: string): void
}

export function QuickOpen({ rootId, open, onClose, onPick }: QuickOpenProps) {
  const [query, setQuery] = useState('')
  const [paths, setPaths] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const seq = useRef(0)

  // Reset when the dialog opens.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setPaths([])
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
    const timer = setTimeout(() => {
      setSearching(true)
      searchFiles(rootId, q, QUICK_OPEN_LIMIT).then(
        (result) => {
          if (mySeq !== seq.current) return
          setPaths([...result.paths])
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

  if (!open) return null

  const pick = (path: string) => {
    onPick(path)
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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[15vh]" onClick={onClose} onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        role="dialog"
        aria-label="Quick open"
        className="relative w-full max-w-xl overflow-hidden rounded-xl border border-border bg-card shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={false} label="Quick open">
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
            {paths.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">{empty}</div>
            ) : (
              paths.map((path) => {
                const dir = parentPath(path)
                return (
                  <Command.Item
                    key={path}
                    value={path}
                    onSelect={() => pick(path)}
                    className="mx-1 flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-xs data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate text-foreground">{baseName(path)}</span>
                    {dir && <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{dir}</span>}
                  </Command.Item>
                )
              })
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  )
}
