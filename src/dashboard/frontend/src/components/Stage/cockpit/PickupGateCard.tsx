import { CockpitCard } from './CockpitCard'
import { PickupGateControls } from '../../backlog/PickupGateControls'

/**
 * PickupGateCard — the backlog pickup controls (Plan → Release, AI objection,
 * Ready / Park / Blocks-main, planning mode, pickup gate) on the issue cockpit,
 * so the operator can do all the "backlog stuff" from the issue itself (PAN-2059).
 * Renders the shared <PickupGateControls> used by the backlog drawer and overlay.
 * PAN-2398 copy rule: the card title is plain language; the controls inside
 * define each pipeline term inline, which keeps the operator-copy rule intact.
 */
export function PickupGateCard({ issueId }: { issueId: string }) {
  return (
    <CockpitCard tone="info" title="When work can start">
      <PickupGateControls issueId={issueId} />
    </CockpitCard>
  )
}
