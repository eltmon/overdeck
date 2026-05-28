import type { PaneWrapperProps } from '../types'
import styles from '../stage.module.css'

/**
 * BrowserPane — paneType='browser' (PAN-1549). An embedded web view: an iframe
 * to the pane's `browserInitialUrl` (set by the launcher's "Search the web"
 * intent / the ActionDock "Web" button). Shows a neutral empty state when no
 * URL is set.
 */
export function BrowserPane({ pane }: PaneWrapperProps) {
  if (!pane.browserInitialUrl) {
    return <div className={styles.placeholder}>No web page to display.</div>
  }
  return (
    <iframe
      className={styles.browserFrame}
      src={pane.browserInitialUrl}
      title={pane.label}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    />
  )
}
