/**
 * LayoutPresetBar — the All projects deck's Layout presets (PAN-5343 H-D7).
 *
 * Four buttons at the right end of the tab strip arrange agent panes into an
 * equal layout: One, Two side by side, Three columns, Grid of four. The
 * candidates, in order, are the visible agent leaves, then the other agent
 * panes by focus history (most recent first), then the rest in tab order
 * (the only order left after a reload, when the history is empty). Button n
 * is disabled with fewer than n candidates; the pressed button is the
 * layout's preset.
 */
import { useDeckLayoutStore } from '../../lib/deckLayoutStore'
import { collectLeafIds, presetLayout, presetOf, type LayoutPreset, type PaneLayout } from '../../lib/paneLayout'
import { usePanesStore, type PaneId, type WorkspacePane } from '../../lib/panesStore'

const PRESETS: ReadonlyArray<{ n: LayoutPreset; title: string; path: string | null }> = [
  { n: 1, title: 'One', path: null },
  { n: 2, title: 'Two side by side', path: 'M9 1v12' },
  { n: 3, title: 'Three columns', path: 'M6.2 1v12M11.8 1v12' },
  { n: 4, title: 'Grid of four', path: 'M9 1v12M1 7h16' },
]

/** H-D7 candidate order: visible agent leaves, then focus history, then tab order. */
export function layoutCandidates(
  panes: readonly WorkspacePane[],
  layout: PaneLayout | null,
  activePaneId: PaneId | null,
  focusHistory: readonly PaneId[],
): PaneId[] {
  const agentIds = new Set(panes.filter((p) => p.paneType === 'agent').map((p) => p.paneId))
  const visible = layout ? collectLeafIds(layout) : activePaneId ? [activePaneId] : []
  const ordered: PaneId[] = []
  const push = (id: PaneId) => {
    if (agentIds.has(id) && !ordered.includes(id)) ordered.push(id)
  }
  visible.forEach(push)
  focusHistory.forEach(push)
  panes.forEach((p) => push(p.paneId))
  return ordered
}

const EMPTY_HISTORY: readonly PaneId[] = []

export function LayoutPresetBar({ deckKey, panes, layout, activePaneId }: {
  deckKey: string
  panes: readonly WorkspacePane[]
  layout: PaneLayout | null
  activePaneId: PaneId | null
}) {
  const focusHistory = useDeckLayoutStore((s) => s.focusHistoryByDeck[deckKey] ?? EMPTY_HISTORY)
  const candidates = layoutCandidates(panes, layout, activePaneId, focusHistory)
  const current = presetOf(layout)

  const apply = (n: LayoutPreset) => {
    useDeckLayoutStore.getState().setLayout(deckKey, n === 1 ? null : presetLayout(candidates, n))
    if (!activePaneId || !candidates.slice(0, n).includes(activePaneId)) {
      usePanesStore.getState().setActivePane(deckKey, candidates[0]!)
    }
  }

  return (
    <div role="group" aria-label="Layout" className="flex shrink-0 items-center gap-0.5 px-2" data-testid="layout-preset-bar">
      <span className="mr-1 text-[11px] text-muted-foreground">Layout</span>
      {PRESETS.map(({ n, title, path }) => (
        <button
          key={n}
          type="button"
          title={title}
          aria-label={title}
          aria-pressed={current === n}
          disabled={candidates.length < n}
          onClick={() => apply(n)}
          className={`flex h-6 w-7 items-center justify-center rounded ${current === n ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'} disabled:cursor-not-allowed disabled:opacity-40`}
        >
          <svg viewBox="0 0 18 14" width="18" height="14" fill="none" stroke="currentColor" aria-hidden="true">
            <rect x=".5" y=".5" width="17" height="13" rx="2" />
            {path && <path d={path} />}
          </svg>
        </button>
      ))}
    </div>
  )
}
