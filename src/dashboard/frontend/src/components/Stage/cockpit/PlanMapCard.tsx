/**
 * PAN-2398 — "The plan, as a map": full-width DAG card below the cockpit feed
 * (mockup §DAG, shared PAN-2400 renderer). Teal = done, blue = happening now.
 */

import { PlanMapViewer } from '../../vbrief/PlanMapViewer'

export function PlanMapCard({ issueId }: { issueId: string }) {
  return (
    <div className="rounded-[14px] border border-border bg-card p-4" data-testid="plan-map-card" data-section="PlanMapCard">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="font-['Space_Grotesk'] text-[13.5px] font-semibold text-foreground">The plan, as a map</div>
        <div className="text-[11px] text-muted-foreground">each box is one task — arrows show what waits on what</div>
      </div>
      <PlanMapViewer issueId={issueId} />
    </div>
  )
}

export default PlanMapCard
