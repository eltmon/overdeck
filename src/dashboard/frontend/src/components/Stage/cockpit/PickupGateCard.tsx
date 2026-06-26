import { CockpitCard } from './CockpitCard'
import { PickupGateControls } from '../../backlog/PickupGateControls'

/**
 * PickupGateCard — the backlog pickup controls (Plan → Release, AI objection,
 * Ready / Park / Blocks-main, planning mode, pickup gate) on the issue cockpit,
 * so the operator can do all the "backlog stuff" from the issue itself (PAN-2059).
 * Renders the shared <PickupGateControls> used by the backlog drawer and overlay.
 */
export function PickupGateCard({ issueId }: { issueId: string }) {
  return (
    <CockpitCard tone="info" title="Pickup">
      <PickupGateControls issueId={issueId} />
    </CockpitCard>
  )
}
