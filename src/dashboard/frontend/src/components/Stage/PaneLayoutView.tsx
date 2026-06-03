import { useCallback, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { WorkspacePane } from '../../lib/panesStore'
import type { PaneLayout, SplitPath } from '../../lib/paneLayout'
import styles from './stage.module.css'

/** Where a dragged tab would land relative to a pane region. */
export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

export interface PaneLayoutViewProps {
  node: PaneLayout
  /** Path from the root to this node (for ratio updates). */
  path: SplitPath
  /** Resolve a leaf's paneId → its pane (for label + content). */
  panesById: Map<string, WorkspacePane>
  renderPaneContent: (pane: WorkspacePane) => ReactNode
  /** The focused leaf — its header is highlighted. */
  focusedPaneId: string | null
  /** Render per-leaf headers (label + close). Off when there's a single pane. */
  showHeaders: boolean
  /** The pane currently being dragged from the tab bar, or null. Enables drop zones. */
  draggingPaneId: string | null
  onFocus: (paneId: string) => void
  onCloseLeaf: (paneId: string) => void
  onRatioChange: (path: SplitPath, ratio: number) => void
  onDropTab: (targetPaneId: string, draggedPaneId: string, zone: DropZone) => void
}

/** Pick the drop zone from the pointer position within a region. */
function zoneFromPointer(rect: DOMRect, clientX: number, clientY: number): DropZone {
  const fx = (clientX - rect.left) / rect.width
  const fy = (clientY - rect.top) / rect.height
  const dist: Record<Exclude<DropZone, 'center'>, number> = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy }
  let nearest: Exclude<DropZone, 'center'> = 'left'
  for (const k of Object.keys(dist) as Array<Exclude<DropZone, 'center'>>) {
    if (dist[k] < dist[nearest]) nearest = k
  }
  // Pointer well inside the region → drop into the center (replace/move here).
  return dist[nearest] > 0.3 ? 'center' : nearest
}

/** Absolute style for the highlight covering the half a drop would occupy. */
function zoneStyle(zone: DropZone): React.CSSProperties {
  switch (zone) {
    case 'left':
      return { left: 0, top: 0, width: '50%', height: '100%' }
    case 'right':
      return { left: '50%', top: 0, width: '50%', height: '100%' }
    case 'top':
      return { left: 0, top: 0, width: '100%', height: '50%' }
    case 'bottom':
      return { left: 0, top: '50%', width: '100%', height: '50%' }
    case 'center':
      return { inset: 0 }
  }
}

/**
 * Recursively renders a {@link PaneLayout} tree. Leaves show pane content (with
 * a focus header when the deck is split); splits lay their two children out
 * along the split direction with a draggable divider between them. While a tab
 * is being dragged, each leaf shows edge drop zones for split-by-drag.
 */
export function PaneLayoutView(props: PaneLayoutViewProps) {
  const { node, path, panesById, renderPaneContent, focusedPaneId, showHeaders, draggingPaneId, onFocus, onCloseLeaf, onRatioChange, onDropTab } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoverZone, setHoverZone] = useState<DropZone | null>(null)

  const onDividerDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const el = containerRef.current
      if (!el || node.kind !== 'split') return
      const rect = el.getBoundingClientRect()
      const vertical = node.dir === 'col'
      const onMove = (ev: MouseEvent) => {
        const r = vertical ? (ev.clientY - rect.top) / rect.height : (ev.clientX - rect.left) / rect.width
        onRatioChange(path, r)
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      document.body.style.cursor = vertical ? 'row-resize' : 'col-resize'
    },
    [node, path, onRatioChange],
  )

  if (node.kind === 'leaf') {
    const pane = panesById.get(node.paneId)
    const focused = focusedPaneId === node.paneId
    const paneId = node.paneId
    return (
      <div
        className={styles.splitPanel}
        style={{ flex: '1 1 0', minWidth: 0, minHeight: 0 }}
        onMouseDownCapture={() => onFocus(paneId)}
      >
        {showHeaders && (
          <div className={`${styles.splitHeader} ${focused ? styles.splitHeaderFocused : ''}`}>
            <span className={styles.splitHeaderLabel}>{pane?.label ?? 'Pane'}</span>
            <button
              type="button"
              className={styles.splitHeaderClose}
              onClick={(e) => { e.stopPropagation(); onCloseLeaf(paneId) }}
              title="Close pane"
              aria-label="Close pane"
            >
              <X size={13} />
            </button>
          </div>
        )}
        <div className={styles.pane} style={{ position: 'relative' }}>
          {pane ? renderPaneContent(pane) : null}
          {draggingPaneId && (
            <div
              className={styles.dropOverlay}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setHoverZone(zoneFromPointer(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY))
              }}
              onDragLeave={(e) => {
                // Ignore leaves into child nodes (the indicator div).
                if (e.currentTarget.contains(e.relatedTarget as Node)) return
                setHoverZone(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                const dragged = e.dataTransfer.getData('application/x-pane-id') || draggingPaneId
                const zone = hoverZone ?? zoneFromPointer(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY)
                setHoverZone(null)
                if (dragged) onDropTab(paneId, dragged, zone)
              }}
            >
              {hoverZone && <div className={styles.dropIndicator} style={zoneStyle(hoverZone)} />}
            </div>
          )}
        </div>
      </div>
    )
  }

  const vertical = node.dir === 'col'
  return (
    <div
      ref={containerRef}
      className={styles.layoutSplit}
      style={{ flexDirection: vertical ? 'column' : 'row' }}
    >
      <div className={styles.splitPanel} style={{ flexGrow: node.ratio, flexBasis: 0 }}>
        <PaneLayoutView {...props} node={node.a} path={[...path, 'a']} />
      </div>
      <div
        className={`${styles.splitDivider} ${vertical ? styles.splitDividerVertical : ''}`}
        onMouseDown={onDividerDown}
        role="separator"
        aria-orientation={vertical ? 'horizontal' : 'vertical'}
        title="Drag to resize"
      />
      <div className={styles.splitPanel} style={{ flexGrow: 1 - node.ratio, flexBasis: 0 }}>
        <PaneLayoutView {...props} node={node.b} path={[...path, 'b']} />
      </div>
    </div>
  )
}
