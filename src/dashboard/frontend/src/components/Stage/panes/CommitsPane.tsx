import { PrDiffTab } from '../../CommandDeck/ZoneCOverviewTabs/PrDiffTab'
import type { PaneWrapperProps } from '../types'

/**
 * CommitsPane — paneType='commits' (PAN-1549). Renders the existing PrDiffTab
 * (git log + diff viewer) for the workspace issue. Reused as-is.
 */
export function CommitsPane({ ctx }: PaneWrapperProps) {
  return <PrDiffTab issueId={ctx.workspaceId} />
}
