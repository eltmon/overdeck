## Status — 2 of 4 placements landed on `main` (2026-06-09)

**Landed** (commits `ae318340f`, `9eb1287a4`; verified live on the running dashboard):
- Shared `AutoMergeToggle` component (`segmented` + `badge` variants, optimistic store patch mirroring the deacon-ignore toggle).
- **D · Awaiting Merge** — segmented Auto/Hold control next to the Merge button. Screenshot-verified rendering on the live dashboard.
- **A · Issue slide-out** — Auto/Hold control in the `IssueHeader` gates/PR/cost strip (the primary per-issue placement).

**Remaining:**
- **B · Flywheel "Merge policy" roster** — needs the pipeline-issue list plumbing on `FlywheelPage`.
- **C · Pipeline page row badge** — needs a trailing slot on the shared `IssueRow` component.

The backend (the `autoMerge` flag + `POST /api/workspaces/:id/auto-merge` endpoint + contract) from PAN-1691 is fully landed, so B and C are render-only follow-ups against the existing endpoint.
