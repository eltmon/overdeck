/**
 * The Stage's entry to the code pane (PAN-5187, NFR-8).
 *
 * The code pane, and with it Monaco's all-language bundle, loads only when
 * a code pane first renders. The key remounts the pane when a preview tab is
 * retargeted to another file (same pane id, new path), so the read, the
 * draft binding and the per-file subscriptions follow the new path.
 */
import { lazy, Suspense } from 'react'
import styles from '../../Stage/stage.module.css'
import type { PaneWrapperProps } from '../../Stage/types'

const CodePane = lazy(() => import('./CodePane').then((m) => ({ default: m.CodePane })))

export function CodePaneSlot({ pane, ctx }: PaneWrapperProps) {
  return (
    <Suspense fallback={<div className={styles.placeholder}>Loading editor…</div>}>
      <CodePane key={`${pane.explorerRootId}\u0000${pane.explorerPath}`} pane={pane} ctx={ctx} />
    </Suspense>
  )
}
