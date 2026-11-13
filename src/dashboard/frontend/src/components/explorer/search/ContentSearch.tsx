// Content search in an explorer root (PAN-5186, WI-B13; FR-6).
//
// Searches 300 ms after the last change to the query or a toggle, when the
// query has at least 2 characters, and at once on Enter (D-B14). Answers to
// stale requests are dropped. Results group by file in first-seen order.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { ExplorerSearchContentMatch } from '@overdeck/contracts'

import { explorerErrorMessage, searchContent } from '../explorer-rpc'

export const CONTENT_SEARCH_DEBOUNCE_MS = 300
const CONTENT_SEARCH_LIMIT = 500
const MIN_QUERY = 2

export interface ContentSearchTarget {
  path: string
  line: number
  column: number
}

export interface ContentSearchProps {
  rootId: string
  scopePath?: string
  onScopeClear(): void
  onClose(): void
  onPick(target: ContentSearchTarget): void
}

interface SearchState {
  matches: readonly ExplorerSearchContentMatch[]
  truncated: boolean
  error: string | null
  searching: boolean
}

const IDLE: SearchState = { matches: [], truncated: false, error: null, searching: false }

function Toggle({ label, title, pressed, onClick }: { label: string; title: string; pressed: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`h-6 min-w-6 rounded px-1.5 font-mono text-[11px] transition-colors ${
        pressed ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

export function ContentSearch({ rootId, scopePath, onScopeClear, onClose, onPick }: ContentSearchProps) {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [state, setState] = useState<SearchState>(IDLE)
  const seq = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const run = useCallback(() => {
    const q = query.trim()
    const mySeq = ++seq.current
    if (q.length < MIN_QUERY) {
      setState(IDLE)
      return
    }
    setState((s) => ({ ...s, searching: true }))
    searchContent({ rootId, query: q, scopePath, regex, caseSensitive, limit: CONTENT_SEARCH_LIMIT }).then(
      (result) => {
        if (mySeq !== seq.current) return
        setState({ matches: result.matches, truncated: result.truncated, error: null, searching: false })
      },
      (e: unknown) => {
        if (mySeq !== seq.current) return
        setState({ matches: [], truncated: false, error: explorerErrorMessage(e), searching: false })
      },
    )
  }, [query, rootId, scopePath, regex, caseSensitive])

  useEffect(() => {
    if (query.trim().length < MIN_QUERY) {
      seq.current += 1
      setState(IDLE)
      return
    }
    timer.current = setTimeout(run, CONTENT_SEARCH_DEBOUNCE_MS)
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
    }
  }, [run, query])

  const groups = useMemo(() => {
    const byPath = new Map<string, ExplorerSearchContentMatch[]>()
    for (const match of state.matches) {
      const list = byPath.get(match.path)
      if (list) list.push(match)
      else byPath.set(match.path, [match])
    }
    return [...byPath.entries()]
  }, [state.matches])

  const status =
    state.error !== null
      ? state.error
      : query.trim().length < MIN_QUERY
        ? 'Type at least 2 characters to search.'
        : state.searching && state.matches.length === 0
          ? 'Searching…'
          : state.matches.length === 0
            ? 'No matches.'
            : null

  return (
    <section aria-label="Search in files" className="flex min-h-0 flex-1 flex-col border-t border-border">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              // Enter searches now; the pending debounced search is dropped.
              if (timer.current !== null) clearTimeout(timer.current)
              timer.current = null
              run()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
          placeholder="Search in files"
          aria-label="Search in files"
          autoFocus
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
        />
        <Toggle label="Aa" title="Match case" pressed={caseSensitive} onClick={() => setCaseSensitive((v) => !v)} />
        <Toggle label=".*" title="Use regular expression" pressed={regex} onClick={() => setRegex((v) => !v)} />
        <button
          type="button"
          title="Close search"
          aria-label="Close search"
          onClick={onClose}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {scopePath && (
        <div className="flex items-center gap-1 px-2 pt-1.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5">
            in <span className="font-mono text-foreground">{scopePath}/</span>
            <button type="button" aria-label="Clear folder scope" title="Clear folder scope" onClick={onScopeClear} className="hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto py-1 text-xs">
        {status !== null ? (
          <p className={`px-3 py-2 ${state.error !== null ? 'text-destructive' : 'text-muted-foreground'}`}>{status}</p>
        ) : (
          <>
            {groups.map(([path, matches]) => (
              <div key={path} role="group" aria-label={path}>
                <div className="flex items-center gap-2 px-3 pt-1.5 text-foreground">
                  <span className="min-w-0 truncate font-mono">{path}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{matches.length}</span>
                </div>
                {matches.map((m) => (
                  <button
                    key={`${m.line}:${m.column}`}
                    type="button"
                    onClick={() => onPick({ path: m.path, line: m.line, column: m.column })}
                    className="list-row flex w-full items-baseline gap-2 px-3 py-0.5 pl-6 text-left"
                  >
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {m.line}:{m.column}
                    </span>
                    <span className="min-w-0 truncate font-mono text-[11px] text-foreground">{m.preview}</span>
                  </button>
                ))}
              </div>
            ))}
            {state.truncated && <p className="px-3 py-2 italic text-faint-foreground">Showing the first 500 matches.</p>}
          </>
        )}
      </div>
    </section>
  )
}
