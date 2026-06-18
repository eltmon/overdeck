import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { toast } from 'sonner'
import { Plus, SquareSplitHorizontal, TerminalSquare, Trash2, X as XIcon } from 'lucide-react'
import { XTerminal } from '../XTerminal'
import {
  useTerminalStateStore,
  selectThreadTerminalState,
} from './terminalStateStore'
import {
  DEFAULT_THREAD_TERMINAL_ID,
  MAX_TERMINALS_PER_GROUP,
  type ThreadTerminalGroup,
} from './types'

/**
 * TerminalDrawer — a resizable terminal drawer stacked below the deck content
 * (PAN-1561). UI/state vendored from t3code's ThreadTerminalDrawer +
 * terminalStateStore so upstream fixes merge cleanly; the one adapted seam is
 * the viewport: each terminal is a Overdeck tmux session rendered by
 * <XTerminal>, created/killed via /api/terminals. The RPC-backed viewport
 * (t3code's TerminalViewport) lands later under PAN-1536.
 */

const MIN_DRAWER_HEIGHT = 180
const MAX_DRAWER_HEIGHT_RATIO = 0.75

function maxDrawerHeight(): number {
  if (typeof window === 'undefined') return 280
  return Math.max(MIN_DRAWER_HEIGHT, Math.floor(window.innerHeight * MAX_DRAWER_HEIGHT_RATIO))
}

function clampDrawerHeight(height: number): number {
  return Math.min(Math.max(height, MIN_DRAWER_HEIGHT), maxDrawerHeight())
}

// ─── Backend seam: ad-hoc tmux sessions via /api/terminals (PAN-1545) ──────────
async function createTerminalSession(cwd?: string): Promise<string | undefined> {
  try {
    const res = await fetch('/api/terminals', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cwd ? { cwd } : {}),
    })
    if (!res.ok) return undefined
    const data = (await res.json()) as { sessionName?: string }
    return data.sessionName
  } catch {
    return undefined
  }
}

function killTerminalSession(name: string): void {
  // Fire-and-forget; the tmux session is the source of truth.
  void fetch(`/api/terminals/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    credentials: 'include',
  }).catch(() => {})
}

/** Force xterm instances to refit after a layout change (height/split). */
function pokeResize(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('resize'))
}

function TerminalActionButton({
  className,
  onClick,
  label,
  disabled,
  children,
}: {
  className: string
  onClick: () => void
  label: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button type="button" className={className} onClick={onClick} title={label} aria-label={label} disabled={disabled}>
      {children}
    </button>
  )
}

export interface TerminalDrawerProps {
  /** Scope key — the project deck. */
  threadId: string
  /** Working directory for new terminals (the project path). */
  cwd?: string
}

export function TerminalDrawer({ threadId, cwd }: TerminalDrawerProps) {
  const state = useTerminalStateStore((s) => selectThreadTerminalState(s.terminalStateByThreadId, threadId))
  const setTerminalHeight = useTerminalStateStore((s) => s.setTerminalHeight)
  const setActiveTerminal = useTerminalStateStore((s) => s.setActiveTerminal)
  const newTerminal = useTerminalStateStore((s) => s.newTerminal)
  const splitTerminal = useTerminalStateStore((s) => s.splitTerminal)
  const closeTerminal = useTerminalStateStore((s) => s.closeTerminal)

  const { terminalIds, activeTerminalId, terminalGroups, activeTerminalGroupId, terminalHeight } = state

  // ── Derivations (mirrors t3code ThreadTerminalDrawer) ───────────────────────
  const normalizedTerminalIds = useMemo(() => {
    const cleaned = [...new Set(terminalIds.map((id) => id.trim()).filter((id) => id.length > 0))]
    return cleaned.length > 0 ? cleaned : [DEFAULT_THREAD_TERMINAL_ID]
  }, [terminalIds])

  const resolvedActiveTerminalId = normalizedTerminalIds.includes(activeTerminalId)
    ? activeTerminalId
    : (normalizedTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID)

  const resolvedTerminalGroups = useMemo<ThreadTerminalGroup[]>(() => {
    const valid = new Set(normalizedTerminalIds)
    const assigned = new Set<string>()
    const used = new Set<string>()
    const groups: ThreadTerminalGroup[] = []
    const uniq = (gid: string): string => {
      if (!used.has(gid)) { used.add(gid); return gid }
      let s = 2
      while (used.has(`${gid}-${s}`)) s += 1
      const out = `${gid}-${s}`; used.add(out); return out
    }
    for (const g of terminalGroups) {
      const ids = [...new Set(g.terminalIds.map((id) => id.trim()).filter((id) => id.length > 0))]
        .filter((id) => valid.has(id) && !assigned.has(id))
      if (ids.length === 0) continue
      for (const id of ids) assigned.add(id)
      const base = g.id.trim().length > 0 ? g.id.trim() : `group-${ids[0] ?? DEFAULT_THREAD_TERMINAL_ID}`
      groups.push({ id: uniq(base), terminalIds: ids })
    }
    for (const id of normalizedTerminalIds) {
      if (assigned.has(id)) continue
      groups.push({ id: uniq(`group-${id}`), terminalIds: [id] })
    }
    return groups.length > 0 ? groups : [{ id: `group-${resolvedActiveTerminalId}`, terminalIds: [resolvedActiveTerminalId] }]
  }, [normalizedTerminalIds, resolvedActiveTerminalId, terminalGroups])

  const resolvedActiveGroupIndex = useMemo(() => {
    const byId = resolvedTerminalGroups.findIndex((g) => g.id === activeTerminalGroupId)
    if (byId >= 0) return byId
    const byTerminal = resolvedTerminalGroups.findIndex((g) => g.terminalIds.includes(resolvedActiveTerminalId))
    return byTerminal >= 0 ? byTerminal : 0
  }, [activeTerminalGroupId, resolvedActiveTerminalId, resolvedTerminalGroups])

  const visibleTerminalIds = resolvedTerminalGroups[resolvedActiveGroupIndex]?.terminalIds ?? [resolvedActiveTerminalId]
  const hasTerminalSidebar = normalizedTerminalIds.length > 1
  const isSplitView = visibleTerminalIds.length > 1
  const showGroupHeaders =
    resolvedTerminalGroups.length > 1 || resolvedTerminalGroups.some((g) => g.terminalIds.length > 1)
  const hasReachedSplitLimit = visibleTerminalIds.length >= MAX_TERMINALS_PER_GROUP
  const terminalLabelById = useMemo(
    () => new Map(normalizedTerminalIds.map((id, i) => [id, `Terminal ${i + 1}`])),
    [normalizedTerminalIds],
  )

  // ── Bootstrap: replace the placeholder "default" with a real tmux session ───
  // Surfaces failures (e.g. an expired dashboard session → 401) with a Retry
  // affordance instead of hanging forever on "Starting terminal…".
  const bootstrappingRef = useRef(false)
  const [bootstrapError, setBootstrapError] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  useEffect(() => {
    const hasReal = normalizedTerminalIds.some((id) => id !== DEFAULT_THREAD_TERMINAL_ID)
    if (hasReal || bootstrappingRef.current) return
    bootstrappingRef.current = true
    setBootstrapError(false)
    void createTerminalSession(cwd)
      .then((name) => {
        if (name) {
          newTerminal(threadId, name)
          closeTerminal(threadId, DEFAULT_THREAD_TERMINAL_ID)
        } else {
          setBootstrapError(true)
        }
      })
      .finally(() => { bootstrappingRef.current = false })
  }, [normalizedTerminalIds, cwd, threadId, newTerminal, closeTerminal, retryNonce])

  // ── Action handlers ─────────────────────────────────────────────────────────
  const handleNew = useCallback(() => {
    void createTerminalSession(cwd).then((name) => {
      if (name) { newTerminal(threadId, name); pokeResize() }
      else toast.error('Could not start terminal (dashboard session expired?)')
    })
  }, [cwd, threadId, newTerminal])

  const handleSplit = useCallback(() => {
    if (hasReachedSplitLimit) return
    void createTerminalSession(cwd).then((name) => {
      if (name) { splitTerminal(threadId, name); pokeResize() }
      else toast.error('Could not start terminal (dashboard session expired?)')
    })
  }, [cwd, threadId, splitTerminal, hasReachedSplitLimit])

  const handleClose = useCallback((terminalId: string) => {
    closeTerminal(threadId, terminalId)
    if (terminalId !== DEFAULT_THREAD_TERMINAL_ID) killTerminalSession(terminalId)
    pokeResize()
  }, [closeTerminal, threadId])

  // ── Resize (drag the top handle) ────────────────────────────────────────────
  const drawerHeight = clampDrawerHeight(terminalHeight)
  const dragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null)
  const onResizeDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { pointerId: e.pointerId, startY: e.clientY, startHeight: clampDrawerHeight(terminalHeight) }
  }, [terminalHeight])
  const onResizeMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    e.preventDefault()
    setTerminalHeight(threadId, clampDrawerHeight(d.startHeight + (d.startY - e.clientY)))
  }, [setTerminalHeight, threadId])
  const onResizeEnd = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    pokeResize()
  }, [])

  function renderViewport(terminalId: string) {
    if (terminalId === DEFAULT_THREAD_TERMINAL_ID) {
      if (bootstrapError) {
        return (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <span>Couldn't start a terminal.</span>
            <button
              type="button"
              className="rounded border border-border px-2 py-1 text-foreground hover:bg-accent"
              onClick={() => setRetryNonce((n) => n + 1)}
            >
              Retry
            </button>
          </div>
        )
      }
      return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Starting terminal…</div>
    }
    return <XTerminal sessionName={terminalId} embedded onDisconnect={() => handleClose(terminalId)} />
  }

  return (
    <aside
      className="thread-terminal-drawer relative flex min-w-0 shrink-0 flex-col overflow-hidden border-t border-border/80 bg-background"
      style={{ height: `${drawerHeight}px` }}
      data-testid="terminal-drawer"
    >
      <div
        className="absolute inset-x-0 top-0 z-20 h-1.5 cursor-row-resize"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      />

      {!hasTerminalSidebar && (
        <div className="pointer-events-none absolute right-2 top-2 z-20">
          <div className="pointer-events-auto inline-flex items-center overflow-hidden rounded-md border border-border/80 bg-background/70">
            <TerminalActionButton
              className={`p-1 text-foreground/90 transition-colors ${hasReachedSplitLimit ? 'cursor-not-allowed opacity-45' : 'hover:bg-accent'}`}
              onClick={handleSplit}
              disabled={hasReachedSplitLimit}
              label={hasReachedSplitLimit ? `Split Terminal (max ${MAX_TERMINALS_PER_GROUP} per group)` : 'Split Terminal'}
            >
              <SquareSplitHorizontal className="size-3.5" />
            </TerminalActionButton>
            <div className="h-4 w-px bg-border/80" />
            <TerminalActionButton className="p-1 text-foreground/90 transition-colors hover:bg-accent" onClick={handleNew} label="New Terminal">
              <Plus className="size-3.5" />
            </TerminalActionButton>
            <div className="h-4 w-px bg-border/80" />
            <TerminalActionButton className="p-1 text-foreground/90 transition-colors hover:bg-accent" onClick={() => handleClose(resolvedActiveTerminalId)} label="Close Terminal">
              <Trash2 className="size-3.5" />
            </TerminalActionButton>
          </div>
        </div>
      )}

      <div className="min-h-0 w-full flex-1">
        <div className={`flex h-full min-h-0 ${hasTerminalSidebar ? 'gap-1.5' : ''}`}>
          <div className="min-w-0 flex-1">
            {isSplitView ? (
              <div
                className="grid h-full w-full min-w-0 gap-0 overflow-hidden"
                style={{ gridTemplateColumns: `repeat(${visibleTerminalIds.length}, minmax(0, 1fr))` }}
              >
                {visibleTerminalIds.map((terminalId) => (
                  <div
                    key={terminalId}
                    className={`min-h-0 min-w-0 border-l first:border-l-0 ${terminalId === resolvedActiveTerminalId ? 'border-border' : 'border-border/70'}`}
                    onMouseDown={() => { if (terminalId !== resolvedActiveTerminalId) setActiveTerminal(threadId, terminalId) }}
                  >
                    <div className="h-full p-1">{renderViewport(terminalId)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full p-1">{renderViewport(resolvedActiveTerminalId)}</div>
            )}
          </div>

          {hasTerminalSidebar && (
            <aside className="flex w-36 min-w-36 flex-col border border-border/70 bg-muted/10">
              <div className="flex h-[22px] items-stretch justify-end border-b border-border/70">
                <div className="inline-flex h-full items-stretch">
                  <TerminalActionButton
                    className={`inline-flex h-full items-center px-1 text-foreground/90 transition-colors ${hasReachedSplitLimit ? 'cursor-not-allowed opacity-45' : 'hover:bg-accent/70'}`}
                    onClick={handleSplit}
                    disabled={hasReachedSplitLimit}
                    label={hasReachedSplitLimit ? `Split Terminal (max ${MAX_TERMINALS_PER_GROUP} per group)` : 'Split Terminal'}
                  >
                    <SquareSplitHorizontal className="size-3.5" />
                  </TerminalActionButton>
                  <TerminalActionButton className="inline-flex h-full items-center border-l border-border/70 px-1 text-foreground/90 transition-colors hover:bg-accent/70" onClick={handleNew} label="New Terminal">
                    <Plus className="size-3.5" />
                  </TerminalActionButton>
                  <TerminalActionButton className="inline-flex h-full items-center border-l border-border/70 px-1 text-foreground/90 transition-colors hover:bg-accent/70" onClick={() => handleClose(resolvedActiveTerminalId)} label="Close Terminal">
                    <Trash2 className="size-3.5" />
                  </TerminalActionButton>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
                {resolvedTerminalGroups.map((group, groupIndex) => {
                  const isGroupActive = group.terminalIds.includes(resolvedActiveTerminalId)
                  const groupActiveTerminalId = isGroupActive ? resolvedActiveTerminalId : (group.terminalIds[0] ?? resolvedActiveTerminalId)
                  return (
                    <div key={group.id} className="pb-0.5">
                      {showGroupHeaders && (
                        <button
                          type="button"
                          className={`flex w-full items-center rounded px-1 py-0.5 text-[10px] uppercase tracking-[0.08em] ${isGroupActive ? 'bg-accent/70 text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`}
                          onClick={() => setActiveTerminal(threadId, groupActiveTerminalId)}
                        >
                          {group.terminalIds.length > 1 ? `Split ${groupIndex + 1}` : `Terminal ${groupIndex + 1}`}
                        </button>
                      )}
                      <div className={showGroupHeaders ? 'ml-1 border-l border-border/60 pl-1.5' : ''}>
                        {group.terminalIds.map((terminalId) => {
                          const isActive = terminalId === resolvedActiveTerminalId
                          return (
                            <div
                              key={terminalId}
                              className={`group flex items-center gap-1 rounded px-1 py-0.5 text-[11px] ${isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`}
                            >
                              {showGroupHeaders && <span className="text-[10px] text-muted-foreground/80">└</span>}
                              <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={() => setActiveTerminal(threadId, terminalId)}>
                                <TerminalSquare className="size-3 shrink-0" />
                                <span className="truncate">{terminalLabelById.get(terminalId) ?? 'Terminal'}</span>
                              </button>
                              {normalizedTerminalIds.length > 1 && (
                                <button
                                  type="button"
                                  className="inline-flex size-3.5 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-100"
                                  onClick={() => handleClose(terminalId)}
                                  title={`Close ${terminalLabelById.get(terminalId) ?? 'terminal'}`}
                                  aria-label={`Close ${terminalLabelById.get(terminalId) ?? 'terminal'}`}
                                >
                                  <XIcon className="size-2.5" />
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </aside>
          )}
        </div>
      </div>
    </aside>
  )
}
