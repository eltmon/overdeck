/**
 * PAN-2398 — "The plan, as a map": full-width DAG card below the cockpit feed
 * (mockup §DAG, shared PAN-2400 renderer). Teal = done, blue = happening now.
 */

import { PlanMapViewer } from '../../xbrief/PlanMapViewer'
import { IssueViewFullscreenButton } from '../../issue-view/IssueView'
import { useDashboardStore } from '../../../lib/store'

export function PlanMapCard({ issueId }: { issueId: string }) {
  const openXbriefViewer = useDashboardStore((state) => state.openXbriefViewer)
  return (
    <div className="rounded-[14px] border border-border bg-card p-4" data-testid="plan-map-card" data-section="PlanMapCard">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="font-['Space_Grotesk'] text-[13.5px] font-semibold text-foreground">The plan, as a map</div>
        <div className="flex items-center gap-2">
          <div className="text-[11px] text-muted-foreground">each box is one task — arrows show what waits on what</div>
          <IssueViewFullscreenButton
            ariaLabel="Expand xBRIEF full screen"
            onClick={() => openXbriefViewer(issueId)}
            className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          />
        </div>
      </div>
      <PlanMapViewer issueId={issueId} />
    </div>
  )
}

export default PlanMapCard
