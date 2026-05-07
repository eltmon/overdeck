/**
 * Diff panel — full diff viewer with turn navigation, unified/split views.
 * Adapted from T3Code's DiffPanel.tsx for Panopticon's routing and state.
 */

import { parsePatchFiles } from '@pierre/diffs'
import { FileDiff, type FileDiffMetadata, Virtualizer } from '@pierre/diffs/react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  ExternalLink,
  Rows3,
  WrapText,
  X,
} from 'lucide-react'
import {
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cn } from '../lib/utils'
import { useTheme } from '../hooks/useTheme'
import { useDiffPreferences, type DiffRenderMode } from '../hooks/useDiffPreferences'
import { parseDiffRouteSearch } from '../lib/diffRouteSearch'
import { buildPatchCacheKey, resolveDiffThemeName } from '../lib/diffRendering'
import type { TurnDiffFileChange, TurnDiffSummary } from './chat/chat-types'
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from './DiffPanelShell'

// ─── Types ────────────────────────────────────────────────────────────────────

type DiffThemeType = 'light' | 'dark'

const DIFF_PANEL_UNSAFE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-light-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-dark-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  --diffs-bg-context-override: color-mix(in srgb, var(--background) 97%, var(--foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--background) 95%, var(--foreground));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--background) 90%, var(--foreground));

  --diffs-bg-addition-override: color-mix(in srgb, var(--background) 92%, #22c55e);
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--background) 88%, #22c55e);
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--background) 85%, #22c55e);
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--background) 80%, #22c55e);

  --diffs-bg-deletion-override: color-mix(in srgb, var(--background) 92%, #ef4444);
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--background) 88%, #ef4444);
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--background) 85%, #ef4444);
  --diffs-bg-deletion-emphasis-override: color-mix(in srgb, var(--background) 80%, #ef4444);

  background-color: var(--diffs-bg) !important;
}

[data-file-info] {
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-bottom: 1px solid var(--border) !important;
}

[data-title] {
  cursor: pointer;
  transition:
    color 120ms ease,
    text-decoration-color 120ms ease;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
}

[data-title]:hover {
  color: color-mix(in srgb, var(--foreground) 84%, var(--primary)) !important;
  text-decoration-color: currentColor;
}
`

// ─── Patch parsing ────────────────────────────────────────────────────────────

type RenderablePatch =
  | { kind: 'files'; files: FileDiffMetadata[] }
  | { kind: 'raw'; text: string; reason: string }

function getRenderablePatch(
  patch: string | undefined,
  cacheScope = 'diff-panel',
): RenderablePatch | null {
  if (!patch) return null
  const normalizedPatch = patch.trim()
  if (normalizedPatch.length === 0) return null

  try {
    const parsedPatches = parsePatchFiles(
      normalizedPatch,
      buildPatchCacheKey(normalizedPatch, cacheScope),
    )
    const files = parsedPatches.flatMap((parsedPatch) => parsedPatch.files)
    if (files.length > 0) {
      return { kind: 'files', files }
    }

    return {
      kind: 'raw',
      text: normalizedPatch,
      reason: 'Unsupported diff format. Showing raw patch.',
    }
  } catch {
    return {
      kind: 'raw',
      text: normalizedPatch,
      reason: 'Failed to parse patch. Showing raw patch.',
    }
  }
}

function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? ''
  if (raw.startsWith('a/') || raw.startsWith('b/')) {
    return raw.slice(2)
  }
  return raw
}

function buildFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? 'none'}:${fileDiff.name}`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatShortTimestamp(iso: string): string {
  try {
    const date = new Date(iso)
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

// ─── URL helpers (Panopticon uses window.history directly) ────────────────────

function readDiffParamsFromUrl(): { diff?: string; diffTurnId?: string; diffFilePath?: string } {
  return parseDiffRouteSearch(
    Object.fromEntries(new URLSearchParams(window.location.search)),
  )
}

function writeDiffParamsToUrl(params: {
  diff?: string
  diffTurnId?: string
  diffFilePath?: string
}) {
  const searchParams = new URLSearchParams(window.location.search)
  // Strip existing diff params
  searchParams.delete('diff')
  searchParams.delete('diffTurnId')
  searchParams.delete('diffFilePath')
  // Set new ones
  if (params.diff) searchParams.set('diff', params.diff)
  if (params.diffTurnId) searchParams.set('diffTurnId', params.diffTurnId)
  if (params.diffFilePath) searchParams.set('diffFilePath', params.diffFilePath)

  const query = searchParams.toString()
  const url = query
    ? `${window.location.pathname}?${query}`
    : window.location.pathname
  window.history.pushState({}, '', url)
}

function clearDiffParamsFromUrl() {
  const searchParams = new URLSearchParams(window.location.search)
  searchParams.delete('diff')
  searchParams.delete('diffTurnId')
  searchParams.delete('diffFilePath')
  const query = searchParams.toString()
  const url = query
    ? `${window.location.pathname}?${query}`
    : window.location.pathname
  window.history.pushState({}, '', url)
}

// ─── Simple toggle button ─────────────────────────────────────────────────────

function ToggleButton(props: {
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
  ariaLabel: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="button"
      aria-label={props.ariaLabel}
      title={props.title}
      aria-pressed={props.pressed}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md border text-muted-foreground transition-colors',
        props.pressed
          ? 'border-border bg-accent text-accent-foreground'
          : 'border-border/70 bg-background/70 hover:border-border hover:text-foreground/80',
      )}
      onClick={() => props.onPressedChange(!props.pressed)}
    >
      {props.children}
    </button>
  )
}

// ─── File picker (shown when no file is selected) ───────────────────────────

function DiffFilePickerList({ files, onSelectFile, isLoading }: {
  files: TurnDiffFileChange[]
  onSelectFile: (path: string) => void
  isLoading: boolean
}) {
  if (isLoading) return <DiffPanelLoadingState label="Loading file list..." />
  if (files.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
        No changed files in this selection.
      </div>
    )
  }
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }))
  return (
    <div className="flex-1 overflow-auto px-2 py-2">
      <p className="mb-2 px-1 text-[11px] text-muted-foreground/70">
        {files.length} changed file{files.length !== 1 ? 's' : ''} — select a file to view its diff
      </p>
      <div className="space-y-px">
        {sorted.map((file) => {
          const parts = file.path.split('/')
          const fileName = parts.pop() ?? file.path
          const dirPath = parts.join('/')
          return (
            <button
              key={file.path}
              type="button"
              className="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] transition-colors hover:bg-accent"
              onClick={() => onSelectFile(file.path)}
            >
              <span className="min-w-0 flex-1 truncate">
                {dirPath && <span className="text-muted-foreground/60">{dirPath}/</span>}
                <span className="text-foreground/90">{fileName}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                {file.additions != null && file.additions > 0 && (
                  <span className="text-green-500">+{file.additions}</span>
                )}
                {file.deletions != null && file.deletions > 0 && (
                  <span className="ml-1 text-red-400">-{file.deletions}</span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── DiffPanel ────────────────────────────────────────────────────────────────

interface DiffPanelProps {
  mode?: DiffPanelMode
  agentId: string
  turnDiffSummaries: TurnDiffSummary[]
  onClose?: () => void
  diffUrlPrefix?: string
}

export function DiffPanel({
  mode = 'inline',
  agentId,
  turnDiffSummaries,
  onClose,
  diffUrlPrefix,
}: DiffPanelProps) {
  const { resolvedTheme } = useTheme()
  const { prefs: diffPrefs, update: updateDiffPrefs } = useDiffPreferences()
  const diffRenderMode = diffPrefs.diffRenderMode
  const diffWordWrap = diffPrefs.diffWordWrap
  const patchViewportRef = useRef<HTMLDivElement>(null)
  const turnStripRef = useRef<HTMLDivElement>(null)
  const [canScrollTurnStripLeft, setCanScrollTurnStripLeft] = useState(false)
  const [canScrollTurnStripRight, setCanScrollTurnStripRight] = useState(false)
  const [urlParams, setUrlParams] = useState(readDiffParamsFromUrl)

  // Listen for URL changes (popstate)
  useEffect(() => {
    const onPopState = () => setUrlParams(readDiffParamsFromUrl())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const diffOpen = urlParams.diff === '1'
  const selectedTurnId = urlParams.diffTurnId ?? null
  const selectedFilePath = selectedTurnId !== null ? (urlParams.diffFilePath ?? null) : null

  // Sort summaries by turn count (newest first)
  const orderedTurnDiffSummaries = useMemo(
    () =>
      [...turnDiffSummaries].sort((left, right) => {
        const leftCount = left.checkpointTurnCount ?? 0
        const rightCount = right.checkpointTurnCount ?? 0
        if (leftCount !== rightCount) return rightCount - leftCount
        return right.completedAt.localeCompare(left.completedAt)
      }),
    [turnDiffSummaries],
  )

  const isVsMain = selectedTurnId === 'vs-main'
  const selectedTurn =
    selectedTurnId === null || isVsMain
      ? undefined
      : (orderedTurnDiffSummaries.find((s) => s.turnId === selectedTurnId) ??
        orderedTurnDiffSummaries[0])

  // Fetch the diff for the selected turn, vs-main, or full conversation
  // When no file is selected, skip the expensive full-diff fetch for turn diffs
  // (the file list is already in the summary). For vs-main/full, fetch file list only.
  const baseUrl = diffUrlPrefix ?? `/api/agents/${encodeURIComponent(agentId)}/diffs`
  const needsFilePicker = !selectedFilePath
  const skipTurnDiffFetch = needsFilePicker && !!selectedTurn

  const { data: diffResponse, isLoading: isLoadingDiff } = useQuery({
    queryKey: isVsMain
      ? ['diff-vs-main', agentId, selectedFilePath ?? null]
      : selectedTurn
        ? ['diff-turn', agentId, selectedTurn.turnId, selectedFilePath ?? null]
        : ['diff-full', agentId, selectedFilePath ?? null],
    queryFn: async () => {
      let url = isVsMain
        ? `${baseUrl}/vs-main`
        : selectedTurn
          ? `${baseUrl}/${encodeURIComponent(selectedTurn.turnId)}`
          : `${baseUrl}/full`
      if (selectedFilePath) {
        url += `?file=${encodeURIComponent(selectedFilePath)}`
      }
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch diff')
      return res.json() as Promise<{ diff?: string; files?: TurnDiffFileChange[] }>
    },
    enabled: diffOpen && !skipTurnDiffFetch,
  })

  // For turn diffs without a file selected, use the summary's file list
  const filePickerFiles: TurnDiffFileChange[] | undefined = needsFilePicker
    ? (selectedTurn?.files ?? diffResponse?.files)
    : undefined

  const selectedPatch = diffResponse?.diff
  const hasResolvedPatch = typeof selectedPatch === 'string'
  const hasNoNetChanges = hasResolvedPatch && selectedPatch.trim().length === 0

  const renderablePatch = useMemo(
    () => getRenderablePatch(selectedPatch, `diff-panel:${resolvedTheme}`),
    [resolvedTheme, selectedPatch],
  )

  const renderableFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== 'files') return []
    return [...renderablePatch.files].sort((left, right) =>
      resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
    )
  }, [renderablePatch])

  // Scroll to selected file
  useEffect(() => {
    if (!selectedFilePath || !patchViewportRef.current) return
    const target = Array.from(
      patchViewportRef.current.querySelectorAll<HTMLElement>('[data-diff-file-path]'),
    ).find((element) => element.dataset.diffFilePath === selectedFilePath)
    target?.scrollIntoView({ block: 'nearest' })
  }, [selectedFilePath, renderableFiles])

  // ─── Turn strip scroll management ─────────────────────────────────────────

  const updateTurnStripScrollState = useCallback(() => {
    const element = turnStripRef.current
    if (!element) {
      setCanScrollTurnStripLeft(false)
      setCanScrollTurnStripRight(false)
      return
    }
    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth)
    setCanScrollTurnStripLeft(element.scrollLeft > 4)
    setCanScrollTurnStripRight(element.scrollLeft < maxScrollLeft - 4)
  }, [])

  const scrollTurnStripBy = useCallback((offset: number) => {
    const element = turnStripRef.current
    if (!element) return
    element.scrollBy({ left: offset, behavior: 'smooth' })
  }, [])

  const onTurnStripWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const element = turnStripRef.current
    if (!element) return
    if (element.scrollWidth <= element.clientWidth + 1) return
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    event.preventDefault()
    element.scrollBy({ left: event.deltaY, behavior: 'auto' })
  }, [])

  useEffect(() => {
    const element = turnStripRef.current
    if (!element) return
    const frameId = window.requestAnimationFrame(() => updateTurnStripScrollState())
    const onScroll = () => updateTurnStripScrollState()
    element.addEventListener('scroll', onScroll, { passive: true })
    const resizeObserver = new ResizeObserver(() => updateTurnStripScrollState())
    resizeObserver.observe(element)
    return () => {
      window.cancelAnimationFrame(frameId)
      element.removeEventListener('scroll', onScroll)
      resizeObserver.disconnect()
    }
  }, [updateTurnStripScrollState])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => updateTurnStripScrollState())
    return () => window.cancelAnimationFrame(frameId)
  }, [orderedTurnDiffSummaries, selectedTurnId, updateTurnStripScrollState])

  useEffect(() => {
    const element = turnStripRef.current
    if (!element) return
    const selectedChip = element.querySelector<HTMLElement>("[data-turn-chip-selected='true']")
    selectedChip?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [selectedTurn?.turnId, selectedTurnId])

  // ─── Navigation ───────────────────────────────────────────────────────────

  const selectTurn = (turnId: string) => {
    writeDiffParamsToUrl({ diff: '1', diffTurnId: turnId })
    setUrlParams(readDiffParamsFromUrl())
  }

  const selectFile = (filePath: string) => {
    const turnId = selectedTurnId ?? undefined
    writeDiffParamsToUrl({ diff: '1', ...(turnId && { diffTurnId: turnId }), diffFilePath: filePath })
    setUrlParams(readDiffParamsFromUrl())
  }

  const selectWholeConversation = () => {
    writeDiffParamsToUrl({ diff: '1' })
    setUrlParams(readDiffParamsFromUrl())
  }

  const selectVsMain = () => {
    writeDiffParamsToUrl({ diff: '1', diffTurnId: 'vs-main' })
    setUrlParams(readDiffParamsFromUrl())
  }

  const handleClose = () => {
    clearDiffParamsFromUrl()
    setUrlParams(readDiffParamsFromUrl())
    onClose?.()
  }

  // ─── Header with turn strip and controls ──────────────────────────────────

  const headerRow = (
    <>
      <div className="relative min-w-0 flex-1">
        {canScrollTurnStripLeft && (
          <div className="pointer-events-none absolute inset-y-0 left-8 z-10 w-7 bg-gradient-to-r from-card to-transparent" />
        )}
        {canScrollTurnStripRight && (
          <div className="pointer-events-none absolute inset-y-0 right-8 z-10 w-7 bg-gradient-to-l from-card to-transparent" />
        )}
        <button
          type="button"
          className={cn(
            'absolute left-0 top-1/2 z-20 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors',
            canScrollTurnStripLeft
              ? 'border-border/70 hover:border-border hover:text-foreground'
              : 'cursor-not-allowed border-border/40 text-muted-foreground/40',
          )}
          onClick={() => scrollTurnStripBy(-180)}
          disabled={!canScrollTurnStripLeft}
          aria-label="Scroll turn list left"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <button
          type="button"
          className={cn(
            'absolute right-0 top-1/2 z-20 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors',
            canScrollTurnStripRight
              ? 'border-border/70 hover:border-border hover:text-foreground'
              : 'cursor-not-allowed border-border/40 text-muted-foreground/40',
          )}
          onClick={() => scrollTurnStripBy(180)}
          disabled={!canScrollTurnStripRight}
          aria-label="Scroll turn list right"
        >
          <ChevronRight className="size-3.5" />
        </button>
        <div
          ref={turnStripRef}
          className="turn-chip-strip flex gap-1 overflow-x-auto px-8 py-0.5"
          onWheel={onTurnStripWheel}
        >
          <button
            type="button"
            className="shrink-0 rounded-md"
            onClick={selectWholeConversation}
            data-turn-chip-selected={selectedTurnId === null}
          >
            <div
              className={cn(
                'rounded-md border px-2 py-1 text-left transition-colors',
                selectedTurnId === null
                  ? 'border-border bg-accent text-accent-foreground'
                  : 'border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80',
              )}
            >
              <div className="text-[10px] leading-tight font-medium">All turns</div>
            </div>
          </button>
          <button
            type="button"
            className="shrink-0 rounded-md"
            onClick={selectVsMain}
            data-turn-chip-selected={isVsMain}
          >
            <div
              className={cn(
                'rounded-md border px-2 py-1 text-left transition-colors',
                isVsMain
                  ? 'border-border bg-accent text-accent-foreground'
                  : 'border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80',
              )}
            >
              <div className="text-[10px] leading-tight font-medium">vs main</div>
            </div>
          </button>
          {orderedTurnDiffSummaries.map((summary, index) => (
            <button
              key={summary.turnId}
              type="button"
              className="shrink-0 rounded-md"
              onClick={() => selectTurn(summary.turnId)}
              title={summary.turnId}
              data-turn-chip-selected={summary.turnId === selectedTurn?.turnId}
            >
              <div
                className={cn(
                  'rounded-md border px-2 py-1 text-left transition-colors',
                  summary.turnId === selectedTurn?.turnId
                    ? 'border-border bg-accent text-accent-foreground'
                    : 'border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80',
                )}
              >
                <div className="flex items-center gap-1">
                  <span className="text-[10px] leading-tight font-medium">
                    Turn {summary.checkpointTurnCount ?? orderedTurnDiffSummaries.length - index}
                  </span>
                  <span className="text-[9px] leading-tight opacity-70">
                    {formatShortTimestamp(summary.completedAt)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ToggleButton
          pressed={diffRenderMode === 'stacked'}
          onPressedChange={() => updateDiffPrefs({ diffRenderMode: 'stacked' })}
          ariaLabel="Stacked diff view"
        >
          <Rows3 className="size-3" />
        </ToggleButton>
        <ToggleButton
          pressed={diffRenderMode === 'split'}
          onPressedChange={() => updateDiffPrefs({ diffRenderMode: 'split' })}
          ariaLabel="Split diff view"
        >
          <Columns2 className="size-3" />
        </ToggleButton>
        <ToggleButton
          pressed={diffWordWrap}
          onPressedChange={(v) => updateDiffPrefs({ diffWordWrap: v })}
          ariaLabel={diffWordWrap ? 'Disable diff line wrapping' : 'Enable diff line wrapping'}
          title={diffWordWrap ? 'Disable line wrapping' : 'Enable line wrapping'}
        >
          <WrapText className="size-3" />
        </ToggleButton>
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded-md border border-border/70 bg-background/70 text-muted-foreground transition-colors hover:border-border hover:text-foreground/80"
          onClick={() => {
            const params = new URLSearchParams(window.location.search)
            params.set('diff', '1')
            if (selectedTurnId) params.set('diffTurnId', selectedTurnId)
            window.open(`${window.location.pathname}?${params.toString()}`, '_blank', 'width=1000,height=800')
          }}
          aria-label="Open diff in new window"
          title="Pop out"
        >
          <ExternalLink className="size-3" />
        </button>
        {onClose && (
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-md border border-border/70 bg-background/70 text-muted-foreground transition-colors hover:border-border hover:text-foreground/80"
            onClick={handleClose}
            aria-label="Close diff panel"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
    </>
  )

  // ─── Render ───────────────────────────────────────────────────────────────

  if (!diffOpen) return null

  return (
    <DiffPanelShell mode={mode} header={headerRow}>
      {orderedTurnDiffSummaries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          No completed turns yet.
        </div>
      ) : needsFilePicker ? (
        <DiffFilePickerList files={filePickerFiles ?? []} onSelectFile={selectFile} isLoading={isLoadingDiff && !filePickerFiles} />
      ) : (
        <div
          ref={patchViewportRef}
          className="diff-panel-viewport min-h-0 min-w-0 flex-1 overflow-hidden"
        >
          {!renderablePatch ? (
            isLoadingDiff ? (
              <DiffPanelLoadingState label="Loading checkpoint diff..." />
            ) : (
              <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                <p>
                  {hasNoNetChanges
                    ? 'No net changes in this selection.'
                    : 'No patch available for this selection.'}
                </p>
              </div>
            )
          ) : renderablePatch.kind === 'files' ? (
            <Virtualizer
              className="diff-render-surface h-full min-h-0 overflow-auto px-2 pb-2"
              config={{
                overscrollSize: 600,
                intersectionObserverMargin: 1200,
              }}
            >
              {renderableFiles.map((fileDiff) => {
                const filePath = resolveFileDiffPath(fileDiff)
                const fileKey = buildFileDiffRenderKey(fileDiff)
                const themedFileKey = `${fileKey}:${resolvedTheme}`
                return (
                  <div
                    key={themedFileKey}
                    data-diff-file-path={filePath}
                    className="diff-render-file mb-2 rounded-md first:mt-2 last:mb-0"
                  >
                    <FileDiff
                      fileDiff={fileDiff}
                      options={{
                        diffStyle: diffPrefs.diffRenderMode === 'split' ? 'split' : 'unified',
                        lineDiffType: diffPrefs.lineDiffType,
                        overflow: diffPrefs.diffWordWrap ? 'wrap' : 'scroll',
                        diffIndicators: diffPrefs.diffIndicators,
                        hunkSeparators: diffPrefs.hunkSeparators,
                        expandUnchanged: diffPrefs.expandUnchanged,
                        collapsedContextThreshold: diffPrefs.collapsedContextThreshold,
                        lineHoverHighlight: diffPrefs.lineHoverHighlight,
                        disableLineNumbers: diffPrefs.disableLineNumbers,
                        enableLineSelection: diffPrefs.enableLineSelection,
                        theme: resolveDiffThemeName(resolvedTheme),
                        themeType: resolvedTheme as DiffThemeType,
                        unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
                      }}
                    />
                  </div>
                )
              })}
            </Virtualizer>
          ) : (
            <div className="h-full overflow-auto p-2">
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground/75">{renderablePatch.reason}</p>
                <pre
                  className={cn(
                    'max-h-[72vh] rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90',
                    diffWordWrap
                      ? 'overflow-auto whitespace-pre-wrap break-words'
                      : 'overflow-auto',
                  )}
                >
                  {renderablePatch.text}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </DiffPanelShell>
  )
}
