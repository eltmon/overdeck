import { XTerminal } from '../../XTerminal'
import type { PaneWrapperProps } from '../types'
import styles from '../stage.module.css'

/**
 * TerminalPane — paneType='terminal' (PAN-1549). Mounts the existing XTerminal
 * bound to the pane's tmux session (`terminalId`). Reused as-is: unmounting the
 * pane does NOT kill the tmux session — the server keeps it alive (terminal
 * lifecycle rules), so re-opening reattaches to the same session.
 */
export function TerminalPane({ pane }: PaneWrapperProps) {
  if (!pane.terminalId) {
    return <div className={styles.placeholder}>No terminal session attached.</div>
  }
  return (
    <div className={styles.terminalPane}>
      <XTerminal sessionName={pane.terminalId} />
    </div>
  )
}
