import { useCallback, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { WorkspacePane } from '../../lib/panesStore'
import type { PaneLayout, SplitPath } from '../../lib/paneLayout'
import styles from './stage.module.css'

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
  onFocus: (paneId: string) => void
  onCloseLeaf: (paneId: string) => void
  onRatioChange: (path: SplitPath, ratio: number) => void
}

/**
 * Recursively renders a {@link PaneLayout} tree. Leaves show pane content (with
 * a focus header when the deck is split); splits lay their two children out
 * along the split direction with a draggable divider between them.
 */
export function PaneLayoutView(props: PaneLayoutViewProps) {
  const { node, path, panesById, renderPaneContent, focusedPaneId, showHeaders, onFocus, onCloseLeaf, onRatioChange } = props
  const containerRef = useRef<HTMLDivElement>(null)

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
    return (
      <div
        className={styles.splitPanel}
        style={{ minWidth: 0, minHeight: 0 }}
        onMouseDownCapture={() => onFocus(node.paneId)}
      >
        {showHeaders && (
          <div className={`${styles.splitHeader} ${focused ? styles.splitHeaderFocused : ''}`}>
            <span className={styles.splitHeaderLabel}>{pane?.label ?? 'Pane'}</span>
            <button
              type="button"
              className={styles.splitHeaderClose}
              onClick={(e) => { e.stopPropagation(); onCloseLeaf(node.paneId) }}
              title="Close pane"
              aria-label="Close pane"
            >
              <X size={13} />
            </button>
          </div>
        )}
        <div className={styles.pane}>{pane ? renderPaneContent(pane) : null}</div>
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
