import type { PaneWrapperProps } from '../types'
import styles from '../stage.module.css'

/** Only allow http(s) URLs into the iframe — rejects javascript:, data:, and
 * other schemes that could execute in the dashboard origin if localStorage were
 * poisoned (e.g. via an XSS-planted browserInitialUrl). */
function safeHttpUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

/**
 * BrowserPane — paneType='browser' (PAN-1549). An embedded web view: an iframe
 * to the pane's `browserInitialUrl` (set by the launcher's "Search the web"
 * intent / the ActionDock "Web" button). The URL is scheme-validated and the
 * iframe sandbox omits `allow-same-origin`, so a poisoned URL cannot reach the
 * dashboard's DOM. Shows a neutral empty state when no valid URL is set.
 */
export function BrowserPane({ pane }: PaneWrapperProps) {
  const url = safeHttpUrl(pane.browserInitialUrl)
  if (!url) {
    return <div className={styles.placeholder}>No web page to display.</div>
  }
  return (
    <iframe
      className={styles.browserFrame}
      src={url}
      title={pane.label}
      sandbox="allow-scripts allow-forms allow-popups"
    />
  )
}
