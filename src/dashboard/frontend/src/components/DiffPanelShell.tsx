/**
 * Diff panel shell — layout wrapper for the diff viewer.
 * Adapted from T3Code's DiffPanelShell.tsx for Panopticon (no Electron drag region).
 */

import { useCallback, useRef, useState, type ReactNode } from 'react'
import { cn } from '../lib/utils'

export type DiffPanelMode = 'inline' | 'sheet' | 'sidebar'

const STORAGE_KEY = 'panopticon.ui.diffPanelWidth'
const DEFAULT_WIDTH = 560
const MIN_WIDTH = 320
const MAX_WIDTH_RATIO = 0.75

function getStoredWidth(): number {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return DEFAULT_WIDTH
  const parsed = Number(stored)
  return Number.isFinite(parsed) && parsed >= MIN_WIDTH ? parsed : DEFAULT_WIDTH
}

function getDiffPanelHeaderRowClassName(mode: DiffPanelMode) {
  return cn(
    'flex items-center justify-between gap-2 px-4',
    mode === 'sheet' ? 'h-12' : 'h-12 border-b border-border',
  )
}

function ResizeHandle({ widthRef, onWidthChange }: {
  widthRef: React.RefObject<number>
  onWidthChange: (width: number) => void
}) {
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = widthRef.current ?? DEFAULT_WIDTH
      const maxWidth = window.innerWidth * MAX_WIDTH_RATIO
      const onMove = (me: PointerEvent) => {
        const delta = startX - me.clientX
        const newWidth = Math.round(Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth + delta)))
        onWidthChange(newWidth)
      }
      const onUp = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [widthRef, onWidthChange],
  )

  return (
    <div
      className="group absolute inset-y-0 left-0 z-30 flex w-2 -translate-x-1/2 cursor-col-resize items-center justify-center"
      onPointerDown={handlePointerDown}
    >
      <div className="h-8 w-1 rounded-full bg-border/50 transition-colors group-hover:bg-primary/60 group-active:bg-primary" />
    </div>
  )
}

export function DiffPanelShell(props: {
  mode: DiffPanelMode
  header: ReactNode
  children: ReactNode
}) {
  const [width, setWidth] = useState(getStoredWidth)
  const widthRef = useRef(width)

  const handleWidthChange = useCallback((newWidth: number) => {
    widthRef.current = newWidth
    setWidth(newWidth)
    localStorage.setItem(STORAGE_KEY, String(newWidth))
  }, [])

  const isInline = props.mode === 'inline'

  return (
    <div
      className={cn(
        'relative flex h-full min-w-0 flex-col bg-background',
        isInline
          ? 'shrink-0 border-l border-border'
          : 'w-full',
      )}
      style={isInline ? { width: `${width}px`, minWidth: `${MIN_WIDTH}px` } : undefined}
    >
      {isInline && <ResizeHandle widthRef={widthRef} onWidthChange={handleWidthChange} />}
      <div className="border-b border-border">
        <div className={getDiffPanelHeaderRowClassName(props.mode)}>{props.header}</div>
      </div>
      {props.children}
    </div>
  )
}

export function DiffPanelHeaderSkeleton() {
  return (
    <>
      <div className="relative min-w-0 flex-1">
        <div className="absolute left-0 top-1/2 size-6 -translate-y-1/2 rounded-md border border-border/50 bg-muted animate-pulse" />
        <div className="absolute right-0 top-1/2 size-6 -translate-y-1/2 rounded-md border border-border/50 bg-muted animate-pulse" />
        <div className="flex gap-1 overflow-hidden px-8 py-0.5">
          <div className="h-6 w-16 shrink-0 rounded-md bg-muted animate-pulse" />
          <div className="h-6 w-24 shrink-0 rounded-md bg-muted animate-pulse" />
          <div className="h-6 w-24 shrink-0 rounded-md bg-muted animate-pulse max-sm:hidden" />
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <div className="size-7 rounded-md bg-muted animate-pulse" />
        <div className="size-7 rounded-md bg-muted animate-pulse" />
      </div>
    </>
  )
}

export function DiffPanelLoadingState(props: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/60 bg-card/25"
        role="status"
        aria-live="polite"
        aria-label={props.label}
      >
        <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
          <div className="h-4 w-32 rounded-full bg-muted animate-pulse" />
          <div className="ml-auto h-4 w-20 rounded-full bg-muted animate-pulse" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-3 py-4">
          <div className="space-y-2">
            <div className="h-3 w-full rounded-full bg-muted animate-pulse" />
            <div className="h-3 w-full rounded-full bg-muted animate-pulse" />
            <div className="h-3 w-10/12 rounded-full bg-muted animate-pulse" />
            <div className="h-3 w-11/12 rounded-full bg-muted animate-pulse" />
            <div className="h-3 w-9/12 rounded-full bg-muted animate-pulse" />
          </div>
          <span className="sr-only">{props.label}</span>
        </div>
      </div>
    </div>
  )
}
