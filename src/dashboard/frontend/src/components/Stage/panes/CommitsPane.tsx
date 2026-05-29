import { PrDiffTab } from '../../CommandDeck/ZoneCOverviewTabs/PrDiffTab'
import type { PaneWrapperProps } from '../types'

/**
 * CommitsPane — paneType='commits' (PAN-1549). Renders the existing PrDiffTab
 * (git log + diff viewer) for the workspace issue. Reused as-is.
 */
export function CommitsPane({ pane, ctx }: PaneWrapperProps) {
  // PAN-1561: the deck is project-scoped, so prefer the pane's own issue id.
  return <PrDiffTab issueId={pane.issueId ?? ctx.workspaceId} />
}
